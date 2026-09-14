import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { createScheduler, createWorker } from 'tesseract.js';

const root = process.cwd();
const sourceRoot = join(root, 'tmp', 'pdfs', 'official-cards', 'part-2');
const cacheRoot = join(root, 'tmp', 'pdfs', 'official-cards', 'ocr-cache');
const renderRoot = join(root, 'tmp', 'pdfs', 'official-cards', 'ocr-render');
const outputFile = join(root, 'public', 'data', 'emergency-cards.json');
const poppler = 'C:\\Users\\Svyt0\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe';
const sourceUrl = 'https://www.mintrans.gov.ru/documents/6/825';
const referenceUns = new Set(readFileSync(join(root, 'public', 'data', 'dangerous-goods.tsv'), 'utf8').split(/\r?\n/u).slice(1).map((line) => line.split('\t')[1]).filter((value) => /^\d{4}$/u.test(value)));

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : entry.name.toLowerCase().endsWith('.pdf') ? [path] : [];
  });
}

function clean(text) {
  return text
    .replace(/\r/gu, '')
    .replace(/-\n(?=[а-яё])/giu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function primarySections(text) {
  const mainHeading = /ОСНОВНЫЕ\s+СВОЙСТВА\s+И\s+ВИДЫ\s+ОПАСНОСТИ/iu.exec(text);
  const actionHeading = /НЕОБХОДИМЫЕ\s+ДЕЙСТВИЯ/iu.exec(text);
  const body = text.slice(mainHeading?.index ?? 0, actionHeading?.index ?? text.length);
  const values = { properties: [], fireExplosion: [], humanHazard: [], protection: [] };
  let section = null;
  for (const originalLine of body.split('\n')) {
    let line = originalLine.trim();
    if (/^ОСНОВНЫЕ(?:\s|$)/u.test(line) && !/^ОСНОВНЫЕ\s+СВОЙСТВА\s+И\s+ВИДЫ/u.test(line)) { section = 'properties'; line = line.replace(/^ОСНОВНЫЕ(?:\s+СВОЙСТВА)?\s*/u, ''); }
    else if (section === 'properties' && /^СВОЙСТВА(?:\s|$)/u.test(line)) line = line.replace(/^СВОЙСТВА\s*/u, '');
    else if (/^ВЗРЫВО/iu.test(line)) { section = 'fireExplosion'; line = line.replace(/^ВЗРЫВО[^А-ЯA-Zа-яa-z0-9]*(?:И\s+)?/iu, ''); }
    else if (/^ПОЖАРООПАСНОСТЬ/iu.test(line)) { section = 'fireExplosion'; line = line.replace(/^ПОЖАРООПАСНОСТЬ\s*/iu, ''); }
    else if (/^ОПАСНОСТЬ\s+ДЛЯ/iu.test(line)) { section = 'humanHazard'; line = line.replace(/^ОПАСНОСТЬ\s+ДЛЯ\s*/iu, ''); }
    else if (/^ЧЕЛОВЕКА(?:\s|$)/iu.test(line)) { section = 'humanHazard'; line = line.replace(/^ЧЕЛОВЕКА\s*/iu, ''); }
    else if (/^СРЕДСТВА\s+ИНДИВИДУАЛЬНОЙ\s+ЗАЩИТЫ/iu.test(line)) { section = 'protection'; line = line.replace(/^СРЕДСТВА\s+ИНДИВИДУАЛЬНОЙ\s+ЗАЩИТЫ\s*/iu, ''); }
    if (section !== null && line.length > 0) values[section].push(line);
  }
  return Object.fromEntries(Object.entries(values).map(([key, lines]) => [key, clean(lines.join('\n'))]));
}

function sectionsFrom(text) {
  const result = primarySections(text);
  const actionHeading = /НЕОБХОДИМЫЕ\s+ДЕЙСТВИЯ/iu.exec(text);
  const actionText = text.slice(actionHeading?.index ?? text.length);
  const actionValues = { generalActions: [], leakActions: [], fireActions: [], neutralization: [], firstAid: [] };
  let section = null;
  for (const originalLine of actionText.split('\n')) {
    let line = originalLine.trim();
    if (/^ОБЩЕГО(?:\s|$)/u.test(line)) { section = 'generalActions'; line = line.replace(/^ОБЩЕГО\s*/u, ''); }
    else if (section === 'generalActions' && /^ХАРАКТЕРА(?:\s|$)/u.test(line)) line = line.replace(/^ХАРАКТЕРА\s*/u, '');
    else if (/^ПРИ\s+ПОЖАРЕ(?:\s|$)/u.test(line)) { section = 'fireActions'; line = line.replace(/^ПРИ\s+ПОЖАРЕ\s*/u, ''); }
    else if (/^ПРИ(?:\s+[А-ЯЁ|,\-/]+)+(?:\s|$)/u.test(line)) { section = 'leakActions'; line = line.replace(/^ПРИ(?:\s+[А-ЯЁ|,\-/]+)+\s*/u, ''); }
    else if (section === 'leakActions' && /^(?:РАЗЛИВЕ|РАЗВАЛЕ|РОССЫПИ|ПРОСЫПИ)(?:\s|$)/u.test(line)) line = line.replace(/^(?:РАЗЛИВЕ|РАЗВАЛЕ|РОССЫПИ|ПРОСЫПИ)(?:\s+И)?\s*/u, '');
    else if (/^НЕЙТРАЛИЗАЦИЯ(?:\s|$)/u.test(line)) { section = 'neutralization'; line = line.replace(/^НЕЙТРАЛИЗАЦИЯ\s*/u, ''); }
    else if (/^МЕРЫ\s+ПЕРВОЙ\s+ПОМОЩИ(?:\s|$)/u.test(line)) { section = 'firstAid'; line = line.replace(/^МЕРЫ\s+ПЕРВОЙ\s+ПОМОЩИ\s*/u, ''); }
    if (section !== null && line.length > 0 && !/^НЕОБХОДИМЫЕ\s+ДЕЙСТВИЯ$/u.test(line)) actionValues[section].push(line);
  }
  for (const [key, lines] of Object.entries(actionValues)) result[key] = clean(lines.join('\n'));
  return result;
}

function parseCard(cardNumber, text, confidence, sourceFile) {
  const dangerHeading = /ОСНОВНЫЕ\s+СВОЙСТВА\s+И\s+ВИДЫ\s+ОПАСНОСТИ/iu.exec(text);
  const header = dangerHeading === null ? text.slice(0, 5000) : text.slice(0, dangerHeading.index);
  const unNumbers = [...new Set([...header.matchAll(/^\s*(\d{4})\s+/gmu)].map((match) => match[1]).filter((un) => referenceUns.has(un)))].sort();
  const sections = sectionsFrom(text);
  const required = ['properties', 'fireExplosion', 'humanHazard', 'protection', 'generalActions', 'leakActions', 'fireActions', 'neutralization', 'firstAid'];
  const complete = unNumbers.length > 0 && required.every((key) => typeof sections[key] === 'string' && sections[key].length > 15);
  return {
    cardNumber,
    unNumbers,
    ...sections,
    officialText: clean(text),
    source: 'Министерство транспорта Российской Федерации — официальный комплект аварийных карточек, утверждённый протоколом Совета по железнодорожному транспорту от 30.05.2008 № 48',
    sourceUrl,
    sourceFile: relative(sourceRoot, sourceFile).replace(/\\/gu, '/'),
    digitization: { method: 'OCR официального PDF', confidence: Math.round(confidence * 100) / 100, complete }
  };
}

if (!existsSync(sourceRoot)) throw new Error(`Official card directory not found: ${sourceRoot}`);
mkdirSync(cacheRoot, { recursive: true });
mkdirSync(renderRoot, { recursive: true });
const pdfFiles = filesIn(sourceRoot).sort((a, b) => Number.parseInt(basename(a), 10) - Number.parseInt(basename(b), 10));
const scheduler = createScheduler();
for (let index = 0; index < 4; index += 1) scheduler.addWorker(await createWorker('rus'));

for (let batchStart = 0; batchStart < pdfFiles.length; batchStart += 8) {
  const batch = pdfFiles.slice(batchStart, batchStart + 8);
  const pending = batch.map(async (pdfFile) => {
    const className = basename(dirname(pdfFile));
    const cardNumber = basename(pdfFile, '.pdf');
    const cacheFile = join(cacheRoot, `${className}-${cardNumber}.json`);
    if (existsSync(cacheFile)) return;
    const cardRenderDirectory = join(renderRoot, `${className}-${cardNumber}`);
    mkdirSync(cardRenderDirectory, { recursive: true });
    const prefix = join(cardRenderDirectory, 'page');
    execFileSync(poppler, ['-r', '200', '-png', pdfFile, prefix], { stdio: 'ignore' });
    const images = readdirSync(cardRenderDirectory).filter((name) => name.endsWith('.png')).sort().map((name) => join(cardRenderDirectory, name));
    const results = await Promise.all(images.map((image) => scheduler.addJob('recognize', image)));
    const text = results.map((result) => result.data.text).join('\n\n');
    const confidence = results.reduce((sum, result) => sum + result.data.confidence, 0) / Math.max(results.length, 1);
    writeFileSync(cacheFile, JSON.stringify({ text, confidence, sourceFile: relative(root, pdfFile) }), 'utf8');
    rmSync(cardRenderDirectory, { recursive: true, force: true });
  });
  await Promise.all(pending);
  process.stdout.write(`OCR ${Math.min(batchStart + batch.length, pdfFiles.length)}/${pdfFiles.length}\n`);
}

await scheduler.terminate();
const cards = pdfFiles.map((pdfFile) => {
  const className = basename(dirname(pdfFile));
  const cardNumber = basename(pdfFile, '.pdf');
  const cache = JSON.parse(readFileSync(join(cacheRoot, `${className}-${cardNumber}.json`), 'utf8'));
  return parseCard(cardNumber, cache.text, cache.confidence, pdfFile);
}).sort((a, b) => Number.parseInt(a.cardNumber, 10) - Number.parseInt(b.cardNumber, 10));

const byUn = {};
for (const card of cards) for (const un of card.unNumbers) (byUn[un] ??= []).push(card.cardNumber);
writeFileSync(outputFile, `${JSON.stringify({ schemaVersion: 1, generatedFrom: sourceUrl, cards, byUn }, null, 2)}\n`, 'utf8');
const complete = cards.filter((card) => card.digitization.complete).length;
process.stdout.write(`Wrote ${cards.length} cards (${complete} structurally complete), ${Object.keys(byUn).length} UN mappings to ${outputFile}\n`);
