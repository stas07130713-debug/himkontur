import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inputPath = resolve(process.argv[2] ?? 'Объекты20230307_2ГИС.kml');
const outputPath = resolve(process.argv[3] ?? 'public/data/district-map.json');
const source = readFileSync(inputPath, 'utf8');
const existing = JSON.parse(readFileSync(outputPath, 'utf8'));
const importedAtIso = '2026-10-14T00:00:00.000Z';

function decodeEntities(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function cleanText(value) {
  return decodeEntities(value.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim());
}

function field(description, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = description.match(new RegExp(`${escaped}:\\s*([^<\\r\\n]*)`, 'iu'));
  return match === null ? '' : cleanText(match[1]);
}

function numericField(description, label) {
  const value = field(description, label).replace(',', '.').match(/-?\d+(?:\.\d+)?/u)?.[0];
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseName(name) {
  const normalized = cleanText(name);
  const number = normalized.match(/(?:^|\s)(\d{1,4})(?=\s|$)/u)?.[1] ?? '';
  const patternCode = (normalized.match(/(?:^|\s)(МО|ЛО|НО)(?=\s|$)/iu)?.[1] ?? '').toLocaleUpperCase('ru-RU');
  const networkMatch = normalized.match(/(?:^|\s)(КТ|К|Т)\s*-\s*(\d+)(?=\s|$)/iu);
  const pattern = patternCode === 'ЛО' ? 'leningrad' : patternCode === 'НО' ? 'german' : patternCode === 'МО' ? 'moscow' : 'other';
  const networkCode = (networkMatch?.[1] ?? '').toLocaleUpperCase('ru-RU');
  const network = networkCode === 'Т' ? 'dead-end' : networkCode === 'КТ' ? 'ring-with-dead-ends' : 'ring';
  const diameterMm = networkMatch === null ? null : Number(networkMatch[2]);
  return { normalized, number, pattern, network, diameterMm };
}

const placemarks = [];
const placemarkPattern = /<Placemark\b([^>]*)>([\s\S]*?)<\/Placemark>/gu;
for (const match of source.matchAll(placemarkPattern)) {
  const attributes = match[1];
  const body = match[2];
  const id = attributes.match(/\bid="([^"]+)"/u)?.[1] ?? `row-${placemarks.length + 1}`;
  const name = body.match(/<name>([\s\S]*?)<\/name>/u)?.[1] ?? '';
  const coordinates = body.match(/<Point>[\s\S]*?<coordinates>\s*([^<]+?)\s*<\/coordinates>[\s\S]*?<\/Point>/u)?.[1] ?? '';
  if (coordinates === '') continue;
  const [longitude, latitude] = coordinates.split(',').map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
  const description = body.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/u)?.[1] ?? '';
  placemarks.push({ id, name, latitude, longitude, description });
}

const diagnostics = { missingNumber: [], duplicateNumbers: new Map(), unsupportedNetwork: [] };
const hydrants = placemarks.flatMap((placemark) => {
  const parsed = parseName(placemark.name);
  if (parsed.number === '') {
    diagnostics.missingNumber.push(cleanText(placemark.name) || placemark.id);
    return [];
  }
  const previous = diagnostics.duplicateNumbers.get(parsed.number) ?? [];
  diagnostics.duplicateNumbers.set(parsed.number, [...previous, placemark.id]);
  if (parsed.diameterMm === null) diagnostics.unsupportedNetwork.push(parsed.normalized);
  const originalNote = field(placemark.description, 'Примечание');
  const signLocation = field(placemark.description, 'Место нахождения таблички');
  const notes = [
    originalNote,
    signLocation === '' ? '' : `Место нахождения таблички: ${signLocation}`,
    parsed.diameterMm === null ? `Исполнение в исходном файле: ${parsed.normalized}` : '',
  ].filter(Boolean);
  return [{
    id: `kml-hydrant-${placemark.id.toLocaleLowerCase('ru-RU')}`,
    kind: 'hydrant',
    point: { latitude: placemark.latitude, longitude: placemark.longitude },
    number: `ПГ-${parsed.number}`,
    owner: field(placemark.description, 'Принадлежность'),
    status: 'unknown',
    faultDescription: '',
    network: parsed.network,
    hydrantType: 'standard',
    pattern: parsed.pattern,
    diameterMm: parsed.diameterMm,
    pressureAtm: null,
    heightMm: null,
    signDistanceLeftM: numericField(placemark.description, 'Расстояние от таблички влево'),
    signDistanceRightM: numericField(placemark.description, 'Расстояние от таблички вправо'),
    signDistanceForwardM: numericField(placemark.description, 'Расстояние от таблички прямо'),
    lastInspectionDate: '',
    note: notes.join('\n'),
    updatedAtIso: importedAtIso,
  }];
});

const buildings = existing.published.filter((object) => object.kind === 'building');
const objects = [...buildings, ...hydrants];
const revision = 20261014;
const project = {
  id: 'district-map-main',
  name: 'Карта района выезда',
  revision,
  draftSavedAtIso: importedAtIso,
  publishedAtIso: importedAtIso,
  draft: objects,
  published: objects,
};
writeFileSync(outputPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');

const duplicates = [...diagnostics.duplicateNumbers.entries()].filter(([, ids]) => ids.length > 1);
console.log(JSON.stringify({
  inputPath,
  outputPath,
  pointPlacemarks: placemarks.length,
  importedHydrants: hydrants.length,
  missingNumber: diagnostics.missingNumber,
  duplicateNumbers: duplicates,
  namesWithoutNetworkDiameter: [...new Set(diagnostics.unsupportedNetwork)],
  ownerCount: hydrants.filter((hydrant) => hydrant.owner !== '').length,
  exactCoordinateCount: hydrants.filter((hydrant) => Number.isFinite(hydrant.point.latitude) && Number.isFinite(hydrant.point.longitude)).length,
}, null, 2));
