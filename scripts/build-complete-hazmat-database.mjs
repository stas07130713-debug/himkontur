import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dataDirectory = resolve('public', 'data', 'emergency-cards');
const sourceDatabase = resolve('..', 'CAMEO Chemicals 3.1.0', 'resources', 'server', 'CAMEOChemicalsServer', '_internal', 'cameo.sqlite');
const extractedGuidesPath = resolve('tmp', 'cameo-import', 'erg-guides-en.json');
const cachePath = resolve('tmp', 'cameo-import', 'translations-en-ru.json');
const outputReport = resolve('reports', 'complete-hazmat-import-2026.json');
const TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

mkdirSync(resolve('tmp', 'cameo-import'), { recursive: true });
mkdirSync(resolve('reports'), { recursive: true });

const existingIndex = JSON.parse(readFileSync(join(dataDirectory, 'dangerous-goods-index-2026.json'), 'utf8'));
const existingProfiles = JSON.parse(readFileSync(join(dataDirectory, 'dangerous-goods-profiles-2026.json'), 'utf8'));
const guidesEn = JSON.parse(readFileSync(extractedGuidesPath, 'utf8'));
const translations = new Map(Object.entries(JSON.parse(readFileSync(cachePath, 'utf8'))));
const db = new DatabaseSync(sourceDatabase, { readOnly: true });

const tsvLines = readFileSync(resolve('public', 'data', 'dangerous-goods.tsv'), 'utf8').replace(/^\uFEFF/u, '').trim().split(/\r?\n/u);
const tsvHeader = tsvLines[0].split('\t');
const transportRows = tsvLines.slice(1).map((line) => Object.fromEntries(line.split('\t').map((value, index) => [tsvHeader[index], value])));

const clean = (value) => String(value ?? '').replace(/\r/gu, '').replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim();
const sentences = (value) => clean(value).split(/(?:\n\s*[-•]\s*|(?<=[.!?])\s+(?=[A-ZА-ЯЁ]))/u).map((item) => item.replace(/^[-•]\s*/u, '').trim()).filter(Boolean);
const scopedGuideSentences = (value, selectedUN) => sentences(value).filter((item) => {
  // ERG group guides occasionally contain exceptions for explicitly named
  // UN entries. Never show an exception belonging to another cargo as a
  // property of the selected cargo.
  const mentionedUN = [...item.matchAll(/\bUN\s*(\d{4})\b/giu)].map((match) => match[1]);
  if (mentionedUN.some((un) => un !== selectedUN)) return false;

  // PDF extraction may leave the repeated guide heading at a page break.
  // It is provenance/layout text, not an emergency action.
  if (/(?:РУКОВОДСТВО|GUIDE)[\s\S]*\d{3}/iu.test(item)) return false;
  return true;
});
const scopedOrFallback = (primary, fallback, selectedUN) => {
  const preferred = scopedGuideSentences(primary, selectedUN);
  return preferred.length > 0 ? preferred : scopedGuideSentences(fallback, selectedUN);
};
const normalizeUN = (value) => String(value).replace(/\D/gu, '').padStart(4, '0');
const splitChunks = (value, maximum = 3600) => {
  const text = clean(value); if (text.length <= maximum) return text === '' ? [] : [text];
  const parts = []; let remaining = text;
  while (remaining.length > maximum) {
    let cut = Math.max(remaining.lastIndexOf('. ', maximum), remaining.lastIndexOf('\n', maximum));
    if (cut < maximum * .55) cut = maximum;
    parts.push(remaining.slice(0, cut + 1).trim()); remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) parts.push(remaining); return parts;
};
const saveCache = () => writeFileSync(cachePath, `${JSON.stringify(Object.fromEntries(translations), null, 2)}\n`, 'utf8');
let translatedSinceSave = 0;
async function translateChunk(text, attempt = 0) {
  if (translations.has(text)) return translations.get(text);
  const body = new URLSearchParams({ client: 'gtx', sl: 'en', tl: 'ru', dt: 't', q: text });
  try {
    const response = await fetch(TRANSLATE_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const translated = clean((payload[0] ?? []).map((part) => part?.[0] ?? '').join(''));
    if (!translated) throw new Error('empty translation');
    translations.set(text, translated);
    translatedSinceSave += 1;
    if (translatedSinceSave >= 50) { saveCache(); translatedSinceSave = 0; }
    return translated;
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolveWait) => setTimeout(resolveWait, 600 * (2 ** attempt)));
    return translateChunk(text, attempt + 1);
  }
}
async function translate(text) {
  const chunks = splitChunks(text);
  const result = [];
  for (const chunk of chunks) result.push(await translateChunk(chunk));
  return clean(result.join(' '));
}
function translatedFromCache(text) {
  const chunks = splitChunks(text);
  if (chunks.length === 0 || chunks.some((chunk) => !translations.has(chunk))) return '';
  return clean(chunks.map((chunk) => translations.get(chunk)).join(' '));
}
async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length); let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; output[index] = await worker(items[index], index); }
  });
  await Promise.all(runners); return output;
}

const guideByUN = new Map(db.prepare(`select m.unna_id un, m.erg_guide_id guide from mm_unna_erg_guide m order by m.unna_id`).all().map((row) => [normalizeUN(row.un), Number(row.guide)]));
// UN 0190 is present in the ADR list but ERG 2024 does not assign it a
// material-specific guide. ERG 111 is the official conservative procedure
// for an unidentified cargo instead of inventing properties for the samples.
guideByUN.set('0190', 111);
const chemicalsByUNStatement = db.prepare(`select c.* from chemical_unna cu join chemicals c on c.id=cu.chem_id where cu.unna_id=? order by cu.sort, c.name`);
const unStatement = db.prepare(`select * from unnas where id=?`);

console.log(`Translating ${guidesEn.length} official ERG guides...`);
const translatedGuides = await mapConcurrent(guidesEn, 6, async (guide) => ({
  ...guide,
  titleRu: await translate(guide.title),
  healthRu: await translate(guide.health),
  fireExplosionRu: await translate(guide.fireExplosion),
  publicSafetyRu: await translate(guide.publicSafety),
  protectiveClothingRu: await translate(guide.protectiveClothing),
  evacuationRu: await translate(guide.evacuation),
  fireResponseRu: await translate(guide.fireResponse),
  spillLeakRu: await translate(guide.spillLeak),
  firstAidRu: await translate(guide.firstAid),
}));
saveCache();
const guideByNumber = new Map(translatedGuides.map((guide) => [guide.guide, guide]));

const guideCards = translatedGuides.map((guide) => ({
  cardNumber: `ERG-${guide.guide}`,
  title: `Руководство ERG ${guide.guide}: ${guide.titleRu}`,
  mainProperties: `Официальное руководство ERG ${guide.guide} применяется для первичных действий при транспортном происшествии. Оно описывает опасности транспортной группы и не подменяет индивидуальные физико-химические свойства вещества.`,
  fireExplosionHazard: guide.fireExplosionRu,
  humanHazard: { description: guide.healthRu, exposureRoutes: { inhalation: true, ingestion: false, skin: true, eyes: true }, symptoms: null },
  ppe: { respiratory: guide.protectiveClothingRu, skin: null, eyes: null, other: null },
  actions: { general: guide.publicSafetyRu, leakOrSpill: guide.spillLeakRu, fire: guide.fireResponseRu },
  neutralization: guide.spillLeakRu,
  firstAid: guide.firstAidRu,
  source: { document: 'Emergency Response Guidebook 2024', revision: 'ERG 2024', effectiveDate: '2024-04-05', sourceReference: `Guide ${guide.guide}`, sourceUrl: 'https://www.phmsa.dot.gov/training/hazmat/erg/emergency-response-guidebook-erg', amendmentProtocol: null, amendmentUrl: null },
}));

const existingKeys = new Set(existingIndex.map((entry) => `${entry.un}|${entry.name}|${entry.classificationCode ?? ''}`));
const existingUN = new Set(existingIndex.map((entry) => entry.un));
const supplementalIndex = [];
for (const row of transportRows) {
  const un = normalizeUN(row['№ ООН']); const guide = guideByUN.get(un); if (guide === undefined) continue;
  if (existingUN.has(un)) continue;
  const entry = { un, name: clean(row['Описание']), emergencyCardNumber: `ERG-${guide}`, classificationCode: clean(row['Код']) || null };
  const key = `${entry.un}|${entry.name}|${entry.classificationCode ?? ''}`;
  if (!existingKeys.has(key)) { existingKeys.add(key); supplementalIndex.push(entry); }
}

const rowsByUN = new Map();
for (const row of transportRows) { const un = normalizeUN(row['№ ООН']); if (!rowsByUN.has(un)) rowsByUN.set(un, []); rowsByUN.get(un).push(row); }
// The programme's curated search index contains several newer/special entries
// that are not present in the bundled ADR TSV. They are still selectable by a
// user and therefore must receive the same complete profile coverage.
for (const entry of existingIndex) {
  const un = normalizeUN(entry.un);
  if (rowsByUN.has(un)) continue;
  rowsByUN.set(un, [{
    '№ ООН': un,
    'Описание': entry.name,
    'Класс': '',
    'Код': entry.classificationCode ?? '',
  }]);
}
const preservedUN = new Set(existingProfiles.map((profile) => profile.un));
const uniqueUN = [...rowsByUN.keys()].sort();
console.log(`Building profiles for ${uniqueUN.length} UN entries...`);

const rawSourceRecords = [];
const generatedProfiles = await mapConcurrent(uniqueUN, 5, async (un, index) => {
  const rows = rowsByUN.get(un); const representative = rows[0]; const guideNumber = guideByUN.get(un); const guide = guideByNumber.get(guideNumber);
  const chemicals = chemicalsByUNStatement.all(Number(un)); const unRecord = unStatement.get(Number(un));
  const exact = chemicals.length === 1 ? chemicals[0] : undefined;
  const cardNumber = existingIndex.find((entry) => entry.un === un)?.emergencyCardNumber ?? `ERG-${guideNumber}`;
  const chemicalMain = exact === undefined ? '' : translatedFromCache(exact.description);
  const chemicalHealth = exact === undefined ? '' : translatedFromCache(exact.health_haz);
  const chemicalFire = exact === undefined ? '' : translatedFromCache(exact.fire_haz);
  const chemicalPpe = exact === undefined ? '' : translatedFromCache(exact.prot_clothing);
  const chemicalResponse = exact === undefined ? '' : translatedFromCache(exact.non_fire_resp);
  const chemicalFirstAid = exact === undefined ? '' : translatedFromCache(exact.first_aid);
  const transportFacts = [
    `Идентификационный номер: UN ${un}.`,
    `Официальное транспортное наименование в справочнике: ${clean(representative['Описание'])}.`,
    `Класс опасности: ${clean(representative['Класс']) || 'не указан'}${clean(representative['Код']) ? `; классификационный код: ${clean(representative['Код'])}` : ''}.`,
    exact?.formulas ? `Химическая формула по CAMEO Chemicals: ${clean(exact.formulas)}.` : '',
    `Для первичных аварийных действий применяется руководство ERG ${guideNumber}.`,
  ].filter(Boolean);
  const profile = {
    un,
    name: clean(representative['Описание']),
    aliases: [...new Set(rows.slice(1).map((row) => clean(row['Описание'])).filter((name) => name !== clean(representative['Описание'])))],
    emergencyCardNumber: cardNumber,
    mainProperties: exact === undefined ? transportFacts : [...sentences(chemicalMain), ...transportFacts.slice(0, 1)],
    fireExplosionHazard: scopedOrFallback(chemicalFire, guide?.fireExplosionRu, un),
    humanHazard: scopedOrFallback(chemicalHealth, guide?.healthRu, un),
    exposureRoutes: [
      /вдых|удуш|дыхатель|пар|газ/iu.test(chemicalHealth || guide?.healthRu || '') ? 'при вдыхании' : '',
      /проглат|прием.*внутр|пищевар/iu.test(chemicalHealth || guide?.healthRu || '') ? 'при проглатывании' : '',
      /кож/iu.test(chemicalHealth || guide?.healthRu || '') ? 'при попадании на кожу' : '',
      /глаз/iu.test(chemicalHealth || guide?.healthRu || '') ? 'при попадании в глаза' : '',
    ].filter(Boolean),
    hazardMarker: null,
    ppe: scopedOrFallback(chemicalPpe, guide?.protectiveClothingRu, un),
    ppeWarning: null,
    specificActions: scopedGuideSentences(`${guide?.publicSafetyRu ?? ''} ${guide?.evacuationRu ?? ''}`, un),
    responseSectionTitle: 'Локализация и устранение последствий',
    responseActions: scopedOrFallback(chemicalResponse, guide?.spillLeakRu, un),
    firstAid: scopedOrFallback(chemicalFirstAid, guide?.firstAidRu, un),
    critical: scopedGuideSentences(`${guide?.healthRu ?? ''} ${guide?.evacuationRu ?? ''}`, un).slice(0, 4),
    sources: [
      { id: `phmsa-erg-${guideNumber}-2024`, type: 'emergency-response', title: `PHMSA Emergency Response Guidebook — Guide ${guideNumber}`, edition: 'ERG 2024', url: 'https://www.phmsa.dot.gov/training/hazmat/erg/emergency-response-guidebook-erg' },
      ...(exact === undefined ? [] : [{ id: `cameo-chemical-${exact.id}`, type: 'substance-properties', title: `CAMEO Chemicals — ${exact.name}`, edition: '3.1.0 rev 1', url: `https://cameochemicals.noaa.gov/chemical/${exact.id}` }]),
    ],
  };
  rawSourceRecords.push({ un, transportNamesRu: rows.map((row) => clean(row['Описание'])), unNamesEn: clean(unRecord?.materials || unRecord?.synonyms), guide: guideNumber, mapping: exact === undefined ? (chemicals.length === 0 ? 'transport-guide' : 'ambiguous-chemical') : 'exact-chemical', chemicals: chemicals.map((chemical) => ({ id: chemical.id, name: chemical.name, formula: clean(chemical.formulas), description: clean(chemical.description), healthHazards: clean(chemical.health_haz), fireHazards: clean(chemical.fire_haz), protectiveClothing: clean(chemical.prot_clothing), spillResponse: clean(chemical.non_fire_resp), firstAid: clean(chemical.first_aid), sourceUrl: `https://cameochemicals.noaa.gov/chemical/${chemical.id}` })) });
  if ((index + 1) % 100 === 0) console.log(`${index + 1}/${uniqueUN.length}`);
  return profile;
});
saveCache();

const importedProfiles = generatedProfiles.filter((profile) => !preservedUN.has(profile.un));
writeFileSync(join(dataDirectory, 'erg-dangerous-goods-index-2024.json'), `${JSON.stringify(supplementalIndex, null, 2)}\n`, 'utf8');
writeFileSync(join(dataDirectory, 'erg-emergency-cards-2024.json'), `${JSON.stringify(guideCards, null, 2)}\n`, 'utf8');
writeFileSync(join(dataDirectory, 'cameo-profiles-3.1.0.json'), `${JSON.stringify(importedProfiles, null, 2)}\n`, 'utf8');
writeFileSync(join(dataDirectory, 'cameo-source-records-3.1.0.json'), `${JSON.stringify(rawSourceRecords.sort((a, b) => a.un.localeCompare(b.un)), null, 2)}\n`, 'utf8');

const report = {
  generatedAt: new Date().toISOString(), source: 'CAMEO Chemicals 3.1.0 rev 1 / ERG 2024', transportRows: transportRows.length, uniqueUN: uniqueUN.length,
  exactChemicalProfiles: rawSourceRecords.filter((record) => record.mapping === 'exact-chemical').length,
  ambiguousChemicalMappings: rawSourceRecords.filter((record) => record.mapping === 'ambiguous-chemical').length,
  transportGuideProfiles: rawSourceRecords.filter((record) => record.mapping === 'transport-guide').length,
  officialErgGuides: guideCards.length, supplementalIndexRows: supplementalIndex.length, preservedVerifiedProfiles: existingProfiles.length, importedProfiles: importedProfiles.length,
  conservativeFallbacks: [{ un: '0190', guide: 111, reason: 'ERG 2024 does not assign a material-specific guide; official unidentified-cargo procedure used.' }],
};
writeFileSync(outputReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
