import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Укажите путь к официальной выгрузке BAM ADR25_csv.txt.');

const rows = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(Boolean).map((line) => line.split('\t'));
const localRows = rows(resolve(root, 'public/data/dangerous-goods.tsv'));
const bamRows = rows(resolve(sourcePath));
const localHeader = localRows.shift();
const bamHeader = bamRows.shift();
if (!localHeader || !bamHeader) throw new Error('Не удалось прочитать заголовки таблиц.');

const column = (header, name) => {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`В таблице отсутствует столбец ${name}.`);
  return index;
};
const bam = {
  un: column(bamHeader, 'S_UNNR'),
  className: column(bamHeader, 'S_KLASSE'),
  code: column(bamHeader, 'S_KLASSIFIZIERUNGSCODE'),
  packingGroup: column(bamHeader, 'S_VP_GRUPPE'),
  labels: [1, 2, 3, 4].map((number) => column(bamHeader, `S_KENN${number}`)),
};
const local = {
  description: column(localHeader, 'Описание'),
  un: column(localHeader, '№ ООН'),
  className: column(localHeader, 'Класс'),
  code: column(localHeader, 'Код'),
  packingGroup: column(localHeader, 'Группа упаковки'),
};
const signature = (row, indexes) => [row[indexes.un], row[indexes.className], row[indexes.code], row[indexes.packingGroup]].join('\u0000');
const bamBySignature = new Map();
for (const row of bamRows) {
  const key = signature(row, bam);
  const bucket = bamBySignature.get(key) ?? [];
  bucket.push(row);
  bamBySignature.set(key, bucket);
}

const used = new Map();
const result = localRows.map((row, rowIndex) => {
  const key = signature(row, local);
  const candidates = bamBySignature.get(key) ?? [];
  const ordinal = used.get(key) ?? 0;
  const source = candidates[ordinal] ?? (candidates.length === 1 ? candidates[0] : undefined);
  used.set(key, ordinal + 1);
  const codes = source === undefined ? [] : bam.labels.map((index) => source[index]?.trim() ?? '').filter((code) => code.length > 0 && code !== 'keine');
  return {
    rowIndex,
    un: row[local.un],
    description: row[local.description],
    className: row[local.className],
    classificationCode: row[local.code],
    packingGroup: row[local.packingGroup],
    hazardLabels: codes.map((rawCode, index) => ({ code: rawCode.replace(/^\((.+)\)$/u, '$1'), primary: index === 0, conditional: /^\(.+\)$/u.test(rawCode) })),
    verificationStatus: source === undefined ? 'not-matched-in-adr-2025' : 'verified-adr-2025',
  };
});

const expected = new Map([
  ['1005', '2.3+8'],
  ['1017', '2.3+5.1+8'],
  ['1073', '2.2+5.1'],
  ['1972', '2.1'],
  ['1203', '3'],
  ['1824', '8'],
]);
for (const [un, labels] of expected) {
  const found = result.find((item) => item.un === un);
  const actual = found?.hazardLabels.map((item) => item.code).join('+');
  if (actual !== labels) throw new Error(`Контроль ADR 2025 не пройден: UN ${un}, ожидалось ${labels}, получено ${actual ?? 'нет данных'}.`);
}

writeFileSync(resolve(root, 'public/data/adr-2025-hazard-labels.json'), `${JSON.stringify({
  meta: {
    standard: 'ADR 2025',
    table: 'Глава 3.2, таблица A, столбец (5)',
    publisher: 'Bundesanstalt für Materialforschung und -prüfung (BAM)',
    sourceUrl: 'https://tes.bam.de/datenbank-gefahrgut/produkte/gefahrgutdatenservice',
    generatedAt: new Date().toISOString(),
  },
  rows: result,
}, null, 2)}\n`, 'utf8');
console.log(`Сохранено ${result.length} проверенных строк ADR 2025.`);
console.log(`Строк без назначенного знака в исходной таблице: ${result.filter((item) => item.hazardLabels.length === 0).length}.`);
console.log(`Строк, не сопоставленных с ADR 2025: ${result.filter((item) => item.verificationStatus !== 'verified-adr-2025').length}.`);
