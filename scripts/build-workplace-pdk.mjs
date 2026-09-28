import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as cheerio from 'cheerio';

const root = process.cwd();
const snapshotPath = join(root, 'tmp', 'normative', 'sanpin-1.2.3685-21-current.html');
const outputPath = join(root, 'public', 'data', 'workplace-pdk-sanpin-1.2.3685-21.json');
const sourceUrl = 'https://base.garant.ru/400274954/';

async function loadSnapshot() {
  try {
    const cached = readFileSync(snapshotPath, 'utf8');
    if (cached.includes('СанПиН')) return cached;
  } catch {
    // Снимок создаётся ниже.
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Не удалось получить СанПиН: HTTP ${response.status}`);
  const html = new TextDecoder('windows-1251').decode(await response.arrayBuffer());
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, html, 'utf8');
  return html;
}

const clean = (value) => String(value ?? '').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
const html = await loadSnapshot();
const $ = cheerio.load(html);
const block = $('div[gtitle]').filter((_, node) => /^Таблица\s+2\.1\..*ПДК.*воздухе\s+рабочей\s+зоны/iu.test(clean($(node).attr('gtitle')))).first();
if (block.length === 0) throw new Error('В нормативном снимке не найдена таблица 2.1');
const tables = block.find('table');
if (tables.length === 0) throw new Error('В блоке таблицы 2.1 не найдена таблица данных');

const rows = [];
tables.find('tr').each((_, tr) => {
  const cells = $(tr).find(':scope > td').map((__, cell) => clean($(cell).text())).get();
  if (cells.length < 8 || !/^\d+\.?$/u.test(cells[0] ?? '')) return;
  rows.push({
    rowNumber: (cells[0] ?? '').replace(/\D/gu, ''),
    name: cells[1] ?? '',
    cas: cells[2] ?? '',
    formula: cells[3] ?? '',
    workplacePdk: cells[4] ?? '',
    airborneState: cells[5] ?? '',
    hazardClass: cells[6] ?? '',
    healthEffects: cells[7] ?? '',
  });
});

if (rows.length < 2000) throw new Error(`Из таблицы 2.1 извлечено только ${rows.length} строк`);
const payload = {
  schemaVersion: 1,
  title: 'Предельно допустимые концентрации загрязняющих веществ в воздухе рабочей зоны',
  regulation: 'СанПиН 1.2.3685-21, таблица 2.1',
  revision: 'ред. от 24.12.2025',
  officialPublicationUrl: 'http://publication.pravo.gov.ru/Document/View/0001202102030022',
  consolidatedSourceUrl: sourceUrl,
  generatedAt: new Date().toISOString(),
  rows,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ rows: rows.length, outputPath }, null, 2));
