import JSZip from 'jszip';
import type { HydrantStatus } from './district-map-model';

export type HydrantActRow = Readonly<{
  number: string;
  status: HydrantStatus;
  statusSource: string;
  faultDescription: string;
  correctiveAction: string;
  networkLabel: string;
  pressureLabel: string;
  owner: string;
}>;

export type HydrantActParseResult = Readonly<{
  rows: readonly HydrantActRow[];
  duplicateNumbers: readonly string[];
  inspectionDate: string;
  format: 'docx' | 'delimited-text';
}>;

function cleanText(value: string): string {
  return value.replace(/\u00A0/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function matches(xml: string, expression: RegExp): string[] {
  return Array.from(xml.matchAll(expression), (match) => match[1] ?? '');
}

function textFromXmlFragment(xml: string): string {
  const paragraphs = matches(xml, /<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/giu);
  const fragments = paragraphs.length === 0 ? [xml] : paragraphs;
  return cleanText(fragments.map((paragraph) => matches(paragraph, /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/giu)
    .map(decodeXmlEntities)
    .join('')).join(' '));
}

function tablesFromDocumentXml(xml: string): readonly (readonly (readonly string[])[])[] {
  const tables: string[][][] = [];
  let tableDepth = 0;
  let rowOpen = false;
  let cellOpen = false;
  let textOpen = false;
  let table: string[][] = [];
  let row: string[] = [];
  let cellText: string[] = [];
  const tokens = xml.match(/<[^>]+>|[^<]+/gu) ?? [];
  const tagName = (token: string): string => /^<\/?(?:\w+:)?([\w-]+)/u.exec(token)?.[1]?.toLocaleLowerCase('en-US') ?? '';
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      if (tableDepth === 1 && rowOpen && cellOpen && textOpen) cellText.push(decodeXmlEntities(token));
      continue;
    }
    const name = tagName(token);
    const closing = token.startsWith('</');
    const selfClosing = /\/\s*>$/u.test(token);
    if (name === 'tbl') {
      if (closing) {
        if (tableDepth === 1) tables.push(table);
        tableDepth = Math.max(0, tableDepth - 1);
      } else if (!selfClosing) {
        if (tableDepth === 0) table = [];
        tableDepth += 1;
      }
      continue;
    }
    if (tableDepth !== 1) continue;
    if (name === 'tr') {
      if (closing) {
        if (rowOpen) table.push(row);
        rowOpen = false;
      } else if (!selfClosing) {
        row = [];
        rowOpen = true;
      }
      continue;
    }
    if (!rowOpen) continue;
    if (name === 'tc') {
      if (closing) {
        if (cellOpen) row.push(cleanText(cellText.join(' ')));
        cellOpen = false;
      } else if (!selfClosing) {
        cellText = [];
        cellOpen = true;
      }
      continue;
    }
    if (!cellOpen) continue;
    if (name === 't') textOpen = !closing && !selfClosing;
    else if ((name === 'p' || name === 'br') && (closing || selfClosing)) cellText.push(' ');
  }
  return tables;
}

function hydrantStatus(value: string): HydrantStatus | null {
  const normalized = cleanText(value).toLocaleLowerCase('ru-RU');
  const compact = normalized.replace(/\s+/gu, '');
  if (/непровер|необслед|неизвест|неустанов|незаполн|нетдан/iu.test(compact)) return 'unknown';
  if (/неисправ|дефект/iu.test(compact)) return 'faulty';
  if (/отключ|неэксплуат/iu.test(compact)) return 'disabled';
  if (/исправ/iu.test(compact)) return 'serviceable';
  return null;
}

function hydrantNumber(value: string): string {
  const normalized = cleanText(value).replace(/^пг\s*(?:№|N|-)?\s*/iu, '');
  const match = /^(\d{1,4})(?:[а-яa-z])?$/iu.exec(normalized);
  return match?.[1] ?? '';
}

function isOwnerRow(cells: readonly string[]): boolean {
  const values = Array.from(new Set(cells.map(cleanText).filter(Boolean)));
  if (values.length !== 1) return false;
  return !/^(?:\d+|№|пг|сеть|состояние|причина|мероприятия)$/iu.test(values[0] ?? '');
}

type HydrantTableColumns = Readonly<{
  number: number;
  network: number;
  pressure: number;
  status: number;
  fault: number;
  correctiveAction: number;
}>;

function tableColumns(cells: readonly string[]): HydrantTableColumns | null {
  const headings = cells.map((cell) => cleanText(cell).toLocaleLowerCase('ru-RU'));
  const number = headings.findIndex((cell) => /(?:№|номер).*?(?:пг|гидрант)|^(?:№\s*)?пг$/iu.test(cell));
  const network = headings.findIndex((cell) => /сеть|диаметр/iu.test(cell));
  const pressure = headings.findIndex((cell) => /(?:^|\s)[рp]\s*,?\s*атм|давлен/iu.test(cell));
  const status = headings.findIndex((cell) => /состояни/iu.test(cell));
  const fault = headings.findIndex((cell) => /неисправ|дефект|характер/iu.test(cell));
  const correctiveAction = headings.findIndex((cell) => /мероприяти|устранен/iu.test(cell));
  return number < 0 || status < 0 ? null : { number, network, pressure, status, fault, correctiveAction };
}

export function parseHydrantActTables(tables: readonly (readonly (readonly string[])[])[]): readonly HydrantActRow[] {
  const rows: HydrantActRow[] = [];
  for (const table of tables) {
    let owner = '';
    let columns: HydrantTableColumns | null = null;
    for (const rawCells of table) {
      const cells = rawCells.map(cleanText);
      const detectedColumns = tableColumns(cells);
      if (detectedColumns !== null) {
        columns = detectedColumns;
        continue;
      }
      if (isOwnerRow(cells)) {
        owner = cells.find(Boolean) ?? owner;
        continue;
      }
      if (columns !== null) {
        const number = hydrantNumber(cells[columns.number] ?? '');
        if (number === '') continue;
        const fixedStatusSource = cells[columns.status] ?? '';
        const detectedStatusIndex = hydrantStatus(fixedStatusSource) === null
          ? cells.findIndex((cell) => hydrantStatus(cell) !== null)
          : columns.status;
        const statusIndex = detectedStatusIndex < 0 ? columns.status : detectedStatusIndex;
        const statusSource = cells[statusIndex] ?? '';
        const shifted = statusIndex !== columns.status;
        rows.push({
          number,
          status: hydrantStatus(statusSource) ?? 'unknown',
          statusSource,
          networkLabel: shifted ? (cells[statusIndex - 2] ?? '') : (columns.network < 0 ? '' : (cells[columns.network] ?? '')),
          pressureLabel: shifted ? (cells[statusIndex - 1] ?? '') : (columns.pressure < 0 ? '' : (cells[columns.pressure] ?? '')),
          faultDescription: shifted ? (cells[statusIndex + 1] ?? '') : (columns.fault < 0 ? '' : (cells[columns.fault] ?? '')),
          correctiveAction: shifted ? (cells[statusIndex + 2] ?? '') : (columns.correctiveAction < 0 ? '' : (cells[columns.correctiveAction] ?? '')),
          owner,
        });
        continue;
      }
      const statusIndex = cells.findIndex((cell) => hydrantStatus(cell) !== null);
      if (statusIndex < 3) continue;
      const statusSource = cells[statusIndex] ?? '';
      const status = hydrantStatus(statusSource);
      const number = hydrantNumber(cells[statusIndex - 3] ?? '');
      if (status === null || number === '') continue;
      rows.push({
        number,
        status,
        statusSource,
        networkLabel: cells[statusIndex - 2] ?? '',
        pressureLabel: cells[statusIndex - 1] ?? '',
        faultDescription: cells[statusIndex + 1] ?? '',
        correctiveAction: cells[statusIndex + 2] ?? '',
        owner,
      });
    }
  }
  return rows;
}

function dateToIso(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value);
  return match === null ? '' : `${match[3]}-${match[2]}-${match[1]}`;
}

function inspectionDateFromDocument(xml: string): string {
  const documentText = textFromXmlFragment(xml);
  const period = /(?:в\s+период\s+)?с\s+(\d{2}\.\d{2}\.\d{4})\s+(?:года?\s+)?по\s+(\d{2}\.\d{2}\.\d{4})/iu.exec(documentText);
  return period === null ? '' : dateToIso(period[2] ?? '');
}

function finalize(rows: readonly HydrantActRow[], inspectionDate: string, format: HydrantActParseResult['format']): HydrantActParseResult {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.number, (counts.get(row.number) ?? 0) + 1);
  const duplicateNumbers = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
    .sort((left, right) => Number(left) - Number(right));
  return { rows, duplicateNumbers, inspectionDate, format };
}

export async function parseHydrantActDocx(data: ArrayBuffer): Promise<HydrantActParseResult> {
  const archive = await JSZip.loadAsync(data);
  const documentFile = archive.file('word/document.xml');
  if (documentFile === null) throw new Error('В файле Word не найден основной документ.');
  const xml = await documentFile.async('string');
  const rows = parseHydrantActTables(tablesFromDocumentXml(xml));
  return finalize(rows, inspectionDateFromDocument(xml), 'docx');
}

function detectDelimiter(line: string): string {
  const variants = ['\t', ';', ','];
  return variants.sort((left, right) => line.split(right).length - line.split(left).length)[0] ?? ';';
}

export function parseHydrantActText(text: string): HydrantActParseResult {
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u).map(cleanText).filter(Boolean);
  const header = lines[0];
  if (header === undefined) return finalize([], '', 'delimited-text');
  const delimiter = detectDelimiter(header);
  const headings = header.split(delimiter).map((cell) => cleanText(cell).toLocaleLowerCase('ru-RU'));
  const numberIndex = headings.findIndex((cell) => /номер|№|гидрант/iu.test(cell));
  const statusIndex = headings.findIndex((cell) => cell.includes('состояни'));
  const faultIndex = headings.findIndex((cell) => /неисправ|дефект|характер/iu.test(cell));
  if (numberIndex < 0 || statusIndex < 0) return finalize([], '', 'delimited-text');
  const rows = lines.slice(1).map((line): HydrantActRow | null => {
    const cells = line.split(delimiter).map((cell) => cleanText(cell.replace(/^"|"$/gu, '')));
    const number = hydrantNumber(cells[numberIndex] ?? '');
    const statusSource = cells[statusIndex] ?? '';
    const status = hydrantStatus(statusSource);
    if (number === '' || status === null) return null;
    return {
      number,
      status,
      statusSource,
      faultDescription: faultIndex < 0 ? '' : (cells[faultIndex] ?? ''),
      correctiveAction: '',
      networkLabel: '',
      pressureLabel: '',
      owner: '',
    };
  }).filter((row): row is HydrantActRow => row !== null);
  return finalize(rows, '', 'delimited-text');
}

export async function parseHydrantActFile(file: File): Promise<HydrantActParseResult> {
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('ru-RU') ?? '';
  if (extension === 'docx') return parseHydrantActDocx(await file.arrayBuffer());
  if (extension === 'csv' || extension === 'txt') return parseHydrantActText(await file.text());
  throw new Error('Поддерживаются файлы Word .docx, а также .csv и .txt.');
}
