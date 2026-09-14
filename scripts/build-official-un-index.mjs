import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScheduler, createWorker } from 'tesseract.js';

const root = process.cwd();
const pdfFile = join(root, 'tmp', 'pdfs', 'official-cards', 'index-by-un.pdf');
const renderRoot = join(root, 'tmp', 'pdfs', 'official-cards', 'un-index-render');
const cacheRoot = join(root, 'tmp', 'pdfs', 'official-cards', 'un-index-cache');
const databaseFile = join(root, 'public', 'data', 'emergency-cards.json');
const poppler = 'C:\\Users\\Svyt0\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe';

if (!existsSync(pdfFile) || !existsSync(databaseFile)) throw new Error('Official index or generated card database is missing.');
mkdirSync(renderRoot, { recursive: true });
mkdirSync(cacheRoot, { recursive: true });

const referenceUns = new Set(readFileSync(join(root, 'public', 'data', 'dangerous-goods.tsv'), 'utf8')
  .split(/\r?\n/u).slice(1).map((line) => line.split('\t')[1]).filter((value) => /^\d{4}$/u.test(value)));
const database = JSON.parse(readFileSync(databaseFile, 'utf8'));
const availableCards = new Set(database.cards.map((card) => String(card.cardNumber)));
// Section 5 of the same official collection lists these explosive materials
// directly by UN number; the other rows in that section use a railway
// conditional number and therefore must not be guessed from ADR fields.
const explosiveDirect = {
  '0029': '191', '0030': '191', '0059': '192', '0065': '192', '0099': '192',
  '0124': '192', '0161': '190', '0278': '190', '0290': '192', '0377': '191',
  '0381': '189', '0409': '189', '0439': '189', '0442': '192'
};

execFileSync(poppler, ['-r', '180', '-png', pdfFile, join(renderRoot, 'page')], { stdio: 'ignore' });
const images = readdirSync(renderRoot).filter((name) => name.endsWith('.png')).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
const scheduler = createScheduler();
for (let index = 0; index < 4; index += 1) scheduler.addWorker(await createWorker('rus'));

for (let start = 0; start < images.length; start += 8) {
  await Promise.all(images.slice(start, start + 8).map(async (imageName, offset) => {
    const page = start + offset + 1;
    const cacheFile = join(cacheRoot, `${page}.txt`);
    if (existsSync(cacheFile)) return;
    const result = await scheduler.addJob('recognize', join(renderRoot, imageName), { tessedit_pageseg_mode: '6' });
    writeFileSync(cacheFile, result.data.text, 'utf8');
  }));
  process.stdout.write(`Index OCR ${Math.min(start + 8, images.length)}/${images.length}\n`);
}
await scheduler.terminate();

const direct = {};
for (let page = 1; page <= images.length; page += 1) {
  const text = readFileSync(join(cacheRoot, `${page}.txt`), 'utf8');
  for (const line of text.split(/\r?\n/u)) {
    const unMatch = /^\s*[|Iil]*\s*(\d{4})\b/u.exec(line);
    const cardMatch = /\b(\d{3})\s*[|Iil]*\s*$/u.exec(line);
    if (unMatch === null || cardMatch === null) continue;
    const [, un] = unMatch;
    const [, card] = cardMatch;
    if (!referenceUns.has(un) || !availableCards.has(card)) continue;
    (direct[un] ??= new Set()).add(card);
  }
}

for (const [un, cards] of Object.entries(direct)) {
  const merged = new Set([...(database.byUn[un] ?? []), ...cards]);
  database.byUn[un] = [...merged].sort((left, right) => Number(left) - Number(right));
}
for (const [un, card] of Object.entries(explosiveDirect)) {
  if (!referenceUns.has(un) || !availableCards.has(card)) continue;
  database.byUn[un] = [...new Set([...(database.byUn[un] ?? []), card])].sort((left, right) => Number(left) - Number(right));
}
database.unIndex = {
  source: 'Официальный указатель аварийных карточек по номеру ООН, Министерство транспорта Российской Федерации',
  sourceUrl: database.generatedFrom,
  pages: images.length,
  method: 'OCR раздела 4 и прямые UN-связи раздела 5 официального комплекта с фильтрацией по существующим номерам UN и карточек'
};
writeFileSync(databaseFile, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
rmSync(renderRoot, { recursive: true, force: true });
process.stdout.write(`Merged ${Object.keys(direct).length} direct UN mappings; total ${Object.keys(database.byUn).length}\n`);
