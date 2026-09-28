import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWorkplacePdk, workplacePdkUnavailableText } from '../src/core/substances/workplacePdk.ts';
import { SUBSTANCE_PRESENTATION } from '../src/ui/substance-display.ts';
import { ADDITIONAL_FORMULA_BY_UN } from '../src/core/substances/transportFormulaCatalog.ts';

const root = process.cwd();
const reportDirectory = join(root, 'reports');
const pdkDatabase = JSON.parse(readFileSync(join(root, 'public', 'data', 'workplace-pdk-sanpin-1.2.3685-21.json'), 'utf8'));
const formulaByUN = Object.values(SUBSTANCE_PRESENTATION).reduce((result, item) => {
  if (item.un.length > 0 && result[item.un] === undefined) result[item.un] = item.formula;
  return result;
}, { ...ADDITIONAL_FORMULA_BY_UN });
const lines = readFileSync(join(root, 'public', 'data', 'dangerous-goods.tsv'), 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).slice(1).filter(Boolean);
const rows = [...new Map(lines.map((line) => {
  const columns = line.split('\t');
  const item = { name: columns[0] ?? '', un: columns[1] ?? '', formula: formulaByUN[columns[1] ?? ''] ?? '' };
  return [`${item.un}\u0000${item.name}`, item];
})).values()].filter((row) => /^\d{4}$/u.test(row.un)).map((row) => {
  const resolution = resolveWorkplacePdk(pdkDatabase.rows, row.name, row.formula);
  return resolution === undefined
    ? { ...row, status: 'NOT_ESTABLISHED_FOR_TRANSPORT_POSITION', value: workplacePdkUnavailableText(row.name), sourceRow: '', matchedName: '', method: '' }
    : { ...row, status: 'MATCHED_SANPIN_2_1', value: resolution.displayValue, sourceRow: resolution.row.rowNumber, matchedName: resolution.row.name, method: resolution.method };
});
const summary = {
  generatedAt: new Date().toISOString(),
  regulationRows: pdkDatabase.rows.length,
  transportEntries: rows.length,
  matched: rows.filter((row) => row.status === 'MATCHED_SANPIN_2_1').length,
  notEstablishedOrNotUniquelyMatched: rows.filter((row) => row.status !== 'MATCHED_SANPIN_2_1').length,
  formulaMatches: rows.filter((row) => row.method === 'formula').length,
  nameMatches: rows.filter((row) => row.method === 'name').length,
};
mkdirSync(reportDirectory, { recursive: true });
writeFileSync(join(reportDirectory, 'workplace-pdk-coverage.json'), `${JSON.stringify({ summary, rows }, null, 2)}\n`, 'utf8');
const csv = [['UN', 'Название', 'Формула', 'Статус', 'ПДК', 'Строка СанПиН', 'Сопоставленное наименование', 'Метод'], ...rows.map((row) => [row.un, row.name, row.formula, row.status, row.value, row.sourceRow, row.matchedName, row.method])]
  .map((row) => row.map((value) => `"${String(value).replace(/"/gu, '""')}"`).join(';')).join('\r\n');
writeFileSync(join(reportDirectory, 'workplace-pdk-coverage.csv'), `\uFEFF${csv}\r\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
