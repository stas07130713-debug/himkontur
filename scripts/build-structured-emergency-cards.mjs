import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

const root = process.cwd();
const outputDirectory = join(root, 'public', 'data', 'emergency-cards');
const cacheDirectory = join(root, 'tmp', 'emergency-cards-structured-cache');
const baseUrl = 'https://www.consultant.ru';
const sectionUrl = `${baseUrl}/document/cons_doc_LAW_101548/6f904838b6f4f343862be9d63ce7fdc6fe5aed40/`;
const explosiveIndexUrl = `${baseUrl}/document/cons_doc_LAW_101548/ac46324529dad26bbdbe118ee807644b9c241a04/`;
const officialSourceUrl = 'https://www.mintrans.gov.ru/documents/6/825';
const documentTitle = 'Аварийные карточки на опасные грузы, перевозимые по железным дорогам СНГ, Латвийской Республики, Литовской Республики, Эстонской Республики';

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(cacheDirectory, { recursive: true });

function normalize(value) {
  return value.replace(/\u00a0/gu, ' ').replace(/[ \t\r\n]+/gu, ' ').replace(/\s+([,.;:])/gu, '$1').trim();
}

function absoluteUrl(href) { return new URL(href, baseUrl).href; }

async function fetchText(url, attempts = 4) {
  const cacheFile = join(cacheDirectory, `${new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? 'section'}.html`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'HimKontur normative database builder/2026.01' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (!html.includes('document-page__content')) throw new Error('document content is unavailable');
      writeFileSync(cacheFile, html, 'utf8');
      return html;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 600));
    }
  }
  throw new Error(`Не удалось загрузить ${url}: ${String(lastError)}`);
}

function contentOf(html) {
  const $ = cheerio.load(html);
  return { $, content: $('.document-page__content').first() };
}

function contentText(html) {
  const { content } = contentOf(html);
  const copy = content.clone();
  copy.find('h1').remove();
  return normalize(copy.text());
}

function rowsOf(html) {
  const { $, content } = contentOf(html);
  return content.find('tr').toArray().map((row) => $(row).children('td,th').toArray().map((cell) => normalize($(cell).text())));
}

function stripTrailingFootnote(value) {
  const opens = (value.match(/\(/gu) ?? []).length;
  const closes = (value.match(/\)/gu) ?? []).length;
  return closes > opens ? value.replace(/\s+\d+\)\s*$/u, '').trim() : value;
}

function parseExposure(humanText) {
  const routes = {
    inhalation: /(?:^|[;,:.\s])I\s*[-—]\s*вдых/iu.test(humanText),
    ingestion: /(?:^|[;,:.\s])II\s*[-—]\s*проглат/iu.test(humanText),
    skin: /(?:^|[;,:.\s])III\s*[-—]\s*попадан[^;.]*кож/iu.test(humanText),
    eyes: /(?:^|[;,:.\s])IV\s*[-—]\s*попадан[^;.]*глаз/iu.test(humanText),
  };
  const routeStart = humanText.search(/Опасн(?:ы|о)\s+при:/iu);
  if (routeStart < 0) return { description: humanText || null, exposureRoutes: routes, symptoms: null };
  const routeEndCandidate = humanText.indexOf('.', routeStart);
  const routeEnd = routeEndCandidate < 0 ? humanText.length : routeEndCandidate + 1;
  const prefix = normalize(humanText.slice(0, routeStart));
  const suffix = normalize(humanText.slice(routeEnd));
  return { description: prefix || null, exposureRoutes: routes, symptoms: suffix || null };
}

function exactTableValue(rows, pattern) {
  return rows.find((row) => pattern.test(row[0] ?? ''))?.slice(1).join(' ').trim() || null;
}

function parseGoods(cardNumber, html) {
  return rowsOf(html).flatMap((row) => {
    const un = row[0]?.match(/^\s*(\d{4})\s*$/u)?.[1];
    const rawName = row.slice(1, -1).filter((value) => value.trim().length > 0).at(-1);
    const name = rawName === undefined ? undefined : stripTrailingFootnote(rawName.trim());
    if (!un || !name || /Номер ООН|^Исключено\./iu.test(name)) return [];
    return [{ un, name, emergencyCardNumber: cardNumber, classificationCode: row.at(-1) || null }];
  });
}


function parseExplosiveUNIndex(html) {
  const { $, content } = contentOf(html);
  const result = [];
  content.find('table').each((_tableIndex, table) => {
    const tableText = normalize($(table).text());
    if (!/Номер ООН/iu.test(tableText) || !/Номер аварийной карточки/iu.test(tableText)) return;
    $(table).find('tr').each((_rowIndex, row) => {
      const cells = $(row).children('td,th').toArray().map((cell) => normalize($(cell).text()));
      const un = cells[0]?.match(/^(\d{4})$/u)?.[1];
      const name = cells[1]?.trim();
      const cardNumber = cells[2]?.match(/^(\d{3})$/u)?.[1];
      if (un && name && cardNumber) result.push({ un, name: stripTrailingFootnote(name), emergencyCardNumber: cardNumber, classificationCode: null });
    });
  });
  return result;
}

function findCard(results, cardNumber) {
  const result = results.find((item) => item.card.cardNumber === cardNumber);
  if (!result) throw new Error(`Не найдена карточка ${cardNumber} для применения нормативного изменения.`);
  return result;
}

function replaceGoods(result, predicate, replacements) {
  result.goods = [...result.goods.filter((entry) => !predicate(entry)), ...replacements];
}

function appendSentence(text, sentence) {
  if (!text) return sentence;
  if (text.includes(sentence)) return text;
  return `${text.trim()} ${sentence}`;
}

function insertAfterSentence(text, sentenceNumber, insertion) {
  if (!text) return insertion;
  if (text.includes(insertion)) return text;
  const matches = [...text.matchAll(/[^.!?]+[.!?]+(?:[”"])?/gu)];
  if (matches.length < sentenceNumber) return appendSentence(text, insertion);
  const boundary = (matches[sentenceNumber - 1].index ?? 0) + matches[sentenceNumber - 1][0].length;
  return `${text.slice(0, boundary).trim()} ${insertion} ${text.slice(boundary).trim()}`.trim();
}

function applyProtocol83(results) {
  const affected = new Set(['206', '311', '328', '335', '430', '603', '807', '811', '813', '834', '835']);
  const entry = (un, name, emergencyCardNumber, classificationCode) => ({ un, name, emergencyCardNumber, classificationCode });

  const card206 = findCard(results, '206');
  replaceGoods(card206, (item) => item.un === '1010', [entry('1010', 'БУТАДИЕНЫ СТАБИЛИЗИРОВАННЫЕ или БУТАДИЕНОВ И УГЛЕВОДОРОДОВ СМЕСЬ СТАБИЛИЗИРОВАННАЯ, содержащая более 20% бутадиенов', '206', '2112')]);
  card206.goods.push(entry('3553', 'ДИСИЛАН', '206', '2112'));

  findCard(results, '311').goods.push(entry('3555', 'ТРИФТОРМЕТИЛТЕТРАЗОЛ-НАТРИЕВАЯ СОЛЬ В АЦЕТОНЕ, содержащая не менее 68% ацетона по массе', '311', '3052'));
  for (const item of findCard(results, '328').goods) if (item.un === '3379' && /ВЗРЫВЧАТОЕ ВЕЩЕСТВО ДЕСЕНСИБИЛИЗИРОВАННОЕ/iu.test(item.name)) item.classificationCode = '3051';
  for (const item of findCard(results, '335').goods) if (item.un === '3165' && /ЦИСТЕРНА АВИАЦИОННАЯ/iu.test(item.name)) item.classificationCode = null;
  replaceGoods(findCard(results, '430'), (item) => item.un === '3292', [entry('3292', 'БАТАРЕИ, СОДЕРЖАЩИЕ МЕТАЛЛИЧЕСКИЙ НАТРИЙ ИЛИ НАТРИЕВЫЙ СПЛАВ, или ЭЛЕМЕНТЫ, СОДЕРЖАЩИЕ МЕТАЛЛИЧЕСКИЙ НАТРИЙ ИЛИ НАТРИЕВЫЙ СПЛАВ', '430', null)]);

  const card603 = findCard(results, '603');
  card603.goods.push(entry('3423', 'ТЕТРАМЕТИЛАММОНИЯ ГИДРОКСИД, ТВЕРДЫЙ', '603', '8012'));
  card603.card.mainProperties = appendSentence(card603.card.mainProperties, 'ТЕТРАМЕТИЛАММОНИЯ ГИДРОКСИД, ТВЕРДЫЙ вызывает коррозию некоторых металлов.');
  card603.card.actions.leakOrSpill = insertAfterSentence(card603.card.actions.leakOrSpill, 3, 'Россыпь тетраметиламмония гидроксида засыпать сухим инертным материалом, собрать в сухие, защищенные от коррозии емкости, герметично закрыть.');
  card603.card.neutralization = insertAfterSentence(card603.card.neutralization, 1, 'Россыпь тетраметиламмония гидроксида засыпать сухим песком, собрать в сухие, защищенные от коррозии емкости.');

  replaceGoods(findCard(results, '807'), (item) => item.un === '1835' || item.un === '3423', [
    entry('1835', 'ТЕТРАМЕТИЛАММОНИЯ ГИДРОКСИДА ВОДНЫЙ РАСТВОР, содержащий более 2,5% и менее 25% тетраметиламмония гидроксида', '807', '8062'),
    entry('1835', 'ТЕТРАМЕТИЛАММОНИЯ ГИДРОКСИДА ВОДНЫЙ РАСТВОР, содержащий не более 2,5% тетраметиламмония гидроксида', '807', '8013'),
  ]);
  for (const item of findCard(results, '811').goods) if (item.un === '3506' && /ИЗДЕЛИЯ ПРОМЫШЛЕННЫЕ/iu.test(item.name)) item.classificationCode = null;
  findCard(results, '813').goods.push(entry('3554', 'ГАЛЛИЙ, СОДЕРЖАЩИЙСЯ В ПРОМЫШЛЕННЫХ ИЗДЕЛИЯХ', '813', '-'));
  for (const item of findCard(results, '834').goods) if (item.un === '2794' && /БАТАРЕИ ЖИДКОСТНЫЕ КИСЛОТНЫЕ/iu.test(item.name)) item.classificationCode = null;
  for (const item of findCard(results, '835').goods) if ((item.un === '2795' || item.un === '3028') && /БАТАРЕИ/iu.test(item.name)) item.classificationCode = null;

  for (const result of results) if (affected.has(result.card.cardNumber)) {
    result.card.source.amendmentProtocol = 'Протокол 83-го заседания Совета по железнодорожному транспорту от 25–26.11.2025, приложение № 17; действует с 01.01.2026.';
    result.card.source.amendmentUrl = 'https://base.garant.ru/413231681/02be1406f09effe593a39a069757e556/';
  }
}

async function parseCard(cardNumber, url) {
  const mainHtml = await fetchText(url);
  const pages = { hazards: null, ppe: null, actions: null, neutralization: null, firstAid: null };
  let currentHtml = mainHtml;
  for (let step = 0; step < 9; step += 1) {
    const { $ } = contentOf(currentHtml);
    const next = $('.pages__right').first();
    const nextLabel = normalize(next.text());
    const nextHref = next.attr('href');
    if (!nextHref || /^Аварийная карточка N/iu.test(nextLabel)) break;
    currentHtml = await fetchText(absoluteUrl(nextHref));
    const heading = normalize(contentOf(currentHtml).content.find('h1').first().text()).toLocaleLowerCase('ru-RU');
    if (/основные свойства и виды опасности/iu.test(heading)) pages.hazards = currentHtml;
    else if (/средства индивидуальной защиты/iu.test(heading)) pages.ppe = currentHtml;
    else if (/необходимые действия/iu.test(heading)) pages.actions = currentHtml;
    else if (/нейтрализация/iu.test(heading)) pages.neutralization = currentHtml;
    else if (/меры первой помощи/iu.test(heading)) pages.firstAid = currentHtml;
  }
  const hazardRows = pages.hazards ? rowsOf(pages.hazards) : [];
  const actionRows = pages.actions ? rowsOf(pages.actions) : [];
  const humanText = exactTableValue(hazardRows, /ОПАСНОСТЬ\s+ДЛЯ\s+ЧЕЛОВЕКА/iu) ?? '';
  const humanHazard = parseExposure(humanText);
  return {
    card: {
      cardNumber,
      title: `АВАРИЙНАЯ КАРТОЧКА № ${cardNumber}`,
      mainProperties: exactTableValue(hazardRows, /ОСНОВНЫЕ\s+СВОЙСТВА/iu),
      fireExplosionHazard: exactTableValue(hazardRows, /(?:ВЗРЫВО|ПОЖАРООПАСНОСТЬ)/iu),
      humanHazard,
      ppe: { respiratory: pages.ppe ? contentText(pages.ppe) : null, skin: null, eyes: null, other: null },
      actions: {
        general: exactTableValue(actionRows, /ОБЩЕГО\s+ХАРАКТЕРА/iu),
        leakOrSpill: exactTableValue(actionRows, /ПРИ\s+(?:УТЕЧКЕ|РАЗЛИВЕ|РОССЫПИ|РАЗВАЛЕ)/iu),
        fire: exactTableValue(actionRows, /ПРИ\s+ПОЖАРЕ/iu),
      },
      neutralization: pages.neutralization ? contentText(pages.neutralization) : null,
      firstAid: pages.firstAid ? contentText(pages.firstAid) : null,
      source: {
        document: documentTitle,
        revision: '2026.01',
        effectiveDate: '2026-01-01',
        sourceReference: `Аварийная карточка № ${cardNumber}; цифровая транскрипция редакции 06.11.2024 сверяется с официальным комплектом Минтранса и изменениями, действующими на 01.01.2026.`,
        sourceUrl: officialSourceUrl,
        amendmentProtocol: null,
        amendmentUrl: null,
      },
    },
    goods: parseGoods(cardNumber, mainHtml),
  };
}

const sectionHtml = await fetchText(sectionUrl);
const $section = cheerio.load(sectionHtml);
const cardLinks = [];
$section('a').each((_index, element) => {
  const match = normalize($section(element).text()).match(/^Аварийная карточка N\s*(\d{3})$/iu);
  const href = $section(element).attr('href');
  if (match && href && !cardLinks.some((item) => item.cardNumber === match[1])) cardLinks.push({ cardNumber: match[1], url: absoluteUrl(href) });
});
cardLinks.sort((left, right) => Number(left.cardNumber) - Number(right.cardNumber));
if (cardLinks.length < 250) throw new Error(`Неполный перечень карточек: найдено ${cardLinks.length}`);

const results = [];
const concurrency = 5;
let cursor = 0;
async function worker() {
  while (cursor < cardLinks.length) {
    const index = cursor++;
    const link = cardLinks[index];
    results[index] = await parseCard(link.cardNumber, link.url);
    process.stdout.write(`\rСтруктурировано карточек: ${results.filter(Boolean).length}/${cardLinks.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
process.stdout.write('\n');

applyProtocol83(results);
for (const explosive of parseExplosiveUNIndex(await fetchText(explosiveIndexUrl))) {
  findCard(results, explosive.emergencyCardNumber).goods.push(explosive);
}

// Сохраняем весь официальный комплект, включая карточки класса 1 и специальные
// карточки, которые выбираются по условному номеру, а не напрямую по UN.
const activeResults = results;
const cards = activeResults.map((result) => result.card);
const seenIndexRows = new Set();
const index = activeResults.flatMap((result) => result.goods).filter((entry) => {
  const key = `${entry.un}\u0000${entry.name}\u0000${entry.emergencyCardNumber}\u0000${entry.classificationCode ?? ''}`;
  if (seenIndexRows.has(key)) return false;
  seenIndexRows.add(key);
  return true;
}).sort((left, right) => left.un.localeCompare(right.un, 'ru') || left.name.localeCompare(right.name, 'ru'));
writeFileSync(join(outputDirectory, 'dangerous-goods-index-2026.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
writeFileSync(join(outputDirectory, 'emergency-cards-2026.json'), `${JSON.stringify(cards, null, 2)}\n`, 'utf8');
const cardNumbers = new Set(cards.map((card) => card.cardNumber));
const exactIndexKeys = new Set();
const errors = [];
for (const [row, item] of index.entries()) {
  if (!/^\d{4}$/u.test(item.un)) errors.push({ code: 'INVALID_UN', message: `Некорректный UN в строке ${row + 1}.` });
  if (!cardNumbers.has(item.emergencyCardNumber)) errors.push({ code: 'BROKEN_CARD_LINK', message: `UN ${item.un} ссылается на отсутствующую АК ${item.emergencyCardNumber}.` });
  const key = `${item.un}\u0000${item.name}\u0000${item.emergencyCardNumber}\u0000${item.classificationCode ?? ''}`;
  if (exactIndexKeys.has(key)) errors.push({ code: 'DUPLICATE_INDEX_ROW', message: `Повтор строки UN ${item.un}, АК ${item.emergencyCardNumber}.` });
  exactIndexKeys.add(key);
}
const entriesByUN = new Map();
for (const item of index) entriesByUN.set(item.un, [...(entriesByUN.get(item.un) ?? []), item]);
const ambiguousUN = [...entriesByUN].filter(([, entries]) => new Set(entries.map((item) => item.emergencyCardNumber)).size > 1).map(([un, entries]) => ({ un, cards: [...new Set(entries.map((item) => item.emergencyCardNumber))] }));
const referencedCards = new Set(index.map((item) => item.emergencyCardNumber));
const orphanCards = cards.map((card) => card.cardNumber).filter((number) => !referencedCards.has(number));
const validationReport = {
  databaseVersion: '2026.01', generatedAt: new Date().toISOString(), totalUN: entriesByUN.size,
  totalIndexEntries: index.length, totalCards: cards.length, errors,
  warnings: ambiguousUN.map((item) => ({ code: 'AMBIGUOUS_UN', message: `UN ${item.un} требует уточнения варианта груза: АК ${item.cards.join(', ')}.` })),
  ambiguousUN, orphanCards, missingCards: [], duplicateUN: [], ocrSuspiciousFragments: [],
};
writeFileSync(join(outputDirectory, 'validation-report.json'), `${JSON.stringify(validationReport, null, 2)}\n`, 'utf8');
if (errors.length > 0) throw new Error(`База не прошла проверку: ${errors[0].message}`);
process.stdout.write(`Готово: ${cards.length} карточек, ${index.length} связей UN/наименование/АК.\n`);
