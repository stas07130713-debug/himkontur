import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dataDirectory = join(root, 'public', 'data', 'emergency-cards');
const reportDirectory = join(root, 'reports');
const index = [
  ...JSON.parse(readFileSync(join(dataDirectory, 'dangerous-goods-index-2026.json'), 'utf8')),
  ...JSON.parse(readFileSync(join(dataDirectory, 'erg-dangerous-goods-index-2024.json'), 'utf8')),
];
const cards = [
  ...JSON.parse(readFileSync(join(dataDirectory, 'emergency-cards-2026.json'), 'utf8')),
  ...JSON.parse(readFileSync(join(dataDirectory, 'erg-emergency-cards-2024.json'), 'utf8')),
];
const profiles = [
  ...JSON.parse(readFileSync(join(dataDirectory, 'dangerous-goods-profiles-2026.json'), 'utf8')),
  ...JSON.parse(readFileSync(join(dataDirectory, 'cameo-profiles-3.1.0.json'), 'utf8')),
];
const validatedPilotSource = readFileSync(join(root, 'src', 'core', 'substances', 'validatedSubstancesPilot.ts'), 'utf8');
const validatedPilotUN = new Set([...validatedPilotSource.matchAll(/pilot\(\{\s*un:\s*'(?<un>\d{4})'/gu)].map((match) => match.groups?.un).filter(Boolean));
const transportLines = readFileSync(join(root, 'public', 'data', 'dangerous-goods.tsv'), 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).slice(1).filter(Boolean);
const transportRows = transportLines.map((line) => { const columns = line.split('\t'); return { name: columns[0] ?? '', un: columns[1] ?? '', classificationCode: columns[3] ?? '' }; }).filter((row) => /^\d{4}$/u.test(row.un));
const cardsByNumber = new Map(cards.map((card) => [card.cardNumber, card]));
const profilesByUN = new Map(profiles.map((profile) => [profile.un, profile]));
const unByCard = new Map();
for (const row of index) unByCard.set(row.emergencyCardNumber, new Set([...(unByCard.get(row.emergencyCardNumber) ?? []), row.un]));

const text = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const normalized = (value) => text(value).toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е');
const listText = (values) => values.map(text).filter(Boolean).join(' ');
const uniqueRows = [...new Map(index.map((row) => [`${row.un}\u0000${row.name}\u0000${row.emergencyCardNumber}`, row])).values()];
const indexByUN = new Map();
for (const row of index) indexByUN.set(row.un, [...(indexByUN.get(row.un) ?? []), row]);
const resolveTransport = (row) => {
  const candidates = indexByUN.get(row.un) ?? [];
  if (new Set(candidates.map((item) => item.emergencyCardNumber)).size === 1) return candidates[0];
  const byCode = candidates.filter((item) => item.classificationCode === row.classificationCode);
  if (new Set(byCode.map((item) => item.emergencyCardNumber)).size === 1) return byCode[0];
  const exact = candidates.filter((item) => normalized(item.name) === normalized(row.name));
  if (new Set(exact.map((item) => item.emergencyCardNumber)).size === 1) return exact[0];
  return undefined;
};
const unmatchedTransportRows = transportRows.filter((row) => resolveTransport(row) === undefined);
const entries = uniqueRows.map((row) => {
  const card = cardsByNumber.get(row.emergencyCardNumber);
  if (card === undefined) return { ...row, status: 'CRITICAL', issues: ['Назначенная аварийная карточка отсутствует'], groupCard: false, individualProfile: false };
  const individualProfile = profilesByUN.has(row.un);
  const groupCard = (unByCard.get(row.emergencyCardNumber)?.size ?? 0) > 1;
  const sections = {
    mainProperties: text(card.mainProperties).length > 0,
    fireExplosionHazard: text(card.fireExplosionHazard).length > 0,
    humanHazard: listText([card.humanHazard?.description, card.humanHazard?.symptoms]).length > 0,
    ppe: listText(Object.values(card.ppe ?? {})).length > 0,
    actions: listText(Object.values(card.actions ?? {})).length > 0,
    consequenceControl: text(card.neutralization).length > 0,
    firstAid: text(card.firstAid).length > 0,
  };
  const issues = Object.entries(sections).filter(([, available]) => !available).map(([name]) => `В официальной АК отсутствует раздел: ${name}`);
  return {
    un: row.un,
    name: row.name,
    emergencyCardNumber: row.emergencyCardNumber,
    classificationCode: row.classificationCode,
    groupCard,
    groupSize: unByCard.get(row.emergencyCardNumber)?.size ?? 1,
    individualProfile,
    source: card.source?.sourceUrl ?? null,
    revision: card.source?.revision ?? null,
    sections,
    status: issues.length === 0 ? 'READY' : 'READY_WITH_SOURCE_GAPS',
    issues,
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  indexRows: index.length,
  uniqueDisplayCards: entries.length,
  uniqueUN: new Set(index.map((row) => row.un)).size,
  officialEmergencyCards: cards.length,
  missingCardMappings: entries.filter((entry) => entry.status === 'CRITICAL').length,
  ready: entries.filter((entry) => entry.status === 'READY').length,
  readyWithSourceGaps: entries.filter((entry) => entry.status === 'READY_WITH_SOURCE_GAPS').length,
  individualProfiles: new Set([...profiles.map((profile) => profile.un), ...validatedPilotUN]).size,
  groupScoped: entries.filter((entry) => entry.groupCard).length,
  selectableTransportRows: transportRows.length,
  selectableUniqueUN: new Set(transportRows.map((row) => row.un)).size,
  selectableRowsWithOfficialCard: transportRows.length - unmatchedTransportRows.length,
  selectableRowsWithoutOfficialCard: unmatchedTransportRows.length,
};

mkdirSync(reportDirectory, { recursive: true });
writeFileSync(join(reportDirectory, 'dangerous-goods-card-coverage-2026.json'), `${JSON.stringify({ summary, entries }, null, 2)}\n`, 'utf8');
const csv = [
  ['UN', 'Название', '№ АК', 'Тип АК', 'Размер группы', 'Индивидуальный профиль', 'Статус', 'Замечания'],
  ...entries.map((entry) => [entry.un, entry.name, entry.emergencyCardNumber, entry.groupCard ? 'групповая' : 'индивидуальная', entry.groupSize ?? 0, entry.individualProfile ? 'да' : 'нет', entry.status, entry.issues.join(' | ')]),
].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/gu, '""')}"`).join(';')).join('\r\n');
writeFileSync(join(reportDirectory, 'dangerous-goods-card-coverage-2026.csv'), `\uFEFF${csv}\r\n`, 'utf8');
const unmatchedCsv = [['UN', 'Название', 'Классификационный код'], ...unmatchedTransportRows.map((row) => [row.un, row.name, row.classificationCode])].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/gu, '""')}"`).join(';')).join('\r\n');
writeFileSync(join(reportDirectory, 'dangerous-goods-without-official-card-2026.csv'), `\uFEFF${unmatchedCsv}\r\n`, 'utf8');
writeFileSync(join(reportDirectory, 'dangerous-goods-card-coverage-2026.md'), `# Покрытие аварийных карточек опасных грузов\n\n- Строк автономного транспортного справочника: ${summary.selectableTransportRows}.\n- Уникальных UN в транспортном справочнике: ${summary.selectableUniqueUN}.\n- Строк, однозначно сопоставленных официальной АК: ${summary.selectableRowsWithOfficialCard}.\n- Строк, для которых официальная АК в нормативном комплекте не найдена или назначение неоднозначно: ${summary.selectableRowsWithoutOfficialCard}.\n- Строк исходного индекса АК: ${summary.indexRows}.\n- Уникальных вариантов отображения UN + наименование + АК: ${summary.uniqueDisplayCards}.\n- Уникальных UN с назначенной АК: ${summary.uniqueUN}.\n- Официальных АК: ${summary.officialEmergencyCards}.\n- Потерянных связей внутри официального индекса UN → АК: ${summary.missingCardMappings}.\n- Исходная АК содержит все семь разделов: ${summary.ready}.\n- В исходной АК один или несколько разделов не выделены отдельно; интерфейс показывает связанное общее требование этой же АК без жёлтой заглушки: ${summary.readyWithSourceGaps}.\n- Групповых назначений: ${summary.groupScoped}.\n- Индивидуально уточнённых профилей: ${summary.individualProfiles}.\n\nКарточка в программе всегда строится из назначенной официальной АК. Во всех семи рабочих разделах выводится текст этой карточки; проверенные индивидуальные сведения имеют приоритет. Для групповой АК область действия обозначена прямо, чтобы общий текст не выдавался за индивидуальное свойство вещества. Строки без официального назначения перечислены отдельно и не получают выдуманную карточку.\n`, 'utf8');

console.log(JSON.stringify(summary, null, 2));
if (summary.missingCardMappings > 0) process.exitCode = 1;
