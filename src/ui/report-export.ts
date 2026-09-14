import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, PageBreak, PageOrientation, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import pdfMake from 'pdfmake/build/pdfmake';
import { vfs } from 'pdfmake/build/vfs_fonts';
import type { Content } from 'pdfmake/interfaces';
import type { CalculationResult, VerificationResult } from '../core/types';

pdfMake.vfs = vfs;

export type ReportContext = Readonly<{
  weatherSource: string;
  mapImageDataUrl?: string;
  mapAspectRatio?: number;
}>;

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#22d6c7"/><stop offset="1" stop-color="#006d72"/></linearGradient></defs><rect width="64" height="64" rx="13" fill="#062a3b"/><path fill="url(#g)" d="M31 5 6 51c-2 4 1 8 5 8h16l7-12H20l17-31-6-11Zm9 8 14 24H30l10-17 5 8h-3l-5 9h22L45 13h-5Z"/><path fill="#9eeef0" stroke="#e8ffff" stroke-width="2" d="M30 51h20a7 7 0 0 0 1-14 11 11 0 0 0-21 3 6 6 0 0 0 0 11Z"/></svg>';

function filename(extension: 'pdf' | 'docx'): string {
  const stamp = new Date().toLocaleString('ru-RU').replaceAll(/[.:,\s]/g, '-');
  return `ХИМКОНТУР_расчёт_${stamp}.${extension}`;
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toFixed(2)).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function compactNumbers(text: string): string {
  return text.replace(/-?\d+[.,]\d{3,}/g, (raw) => {
    const value = Number(raw.replace(',', '.'));
    if (!Number.isFinite(value)) return raw;
    return compactNumber(value);
  });
}

function compactReportText(text: string): string {
  const protectedValues: string[] = [];
  const protectedText = text.replace(/\b(?:\d{2}\.\d{2}\.\d{4}|165\.1325800\.2014)\b/g, (value) => {
    protectedValues.push(value);
    return `§${protectedValues.length - 1}§`;
  });
  return compactNumbers(protectedText).replace(/§(\d+)§/g, (_, index: string) => protectedValues[Number(index)] ?? '');
}

function elapsedText(hours: number): string {
  if (!Number.isFinite(hours)) return 'не наступает при заданных условиях';
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

function verificationText(verification: VerificationResult): string {
  if (verification.status === 'verified') return 'расчёт совпал с контрольным пересчётом';
  if (verification.status === 'warning') return 'расчёт совпал, имеются предупреждения';
  return 'обнаружено расхождение';
}

function summary(result: CalculationResult, context: ReportContext): string[] {
  const forecastDate = new Date(new Date(result.input.accidentTimeIso).getTime() + result.input.elapsedHours * 3_600_000);
  return [
    `Отчёт сформирован на момент прогноза: ${forecastDate.toLocaleString('ru-RU')}, через ${elapsedText(result.input.elapsedHours)} после начала аварии.`,
    `Погодные данные: ${compactReportText(context.weatherSource)}.`,
    `Вещество: ${result.substance.name}. Масса: ${compactNumber(result.input.massT)} т.`,
    `Нормативные параметры: ${result.substance.source}.`,
    `Начало аварии: ${new Date(result.input.accidentTimeIso).toLocaleString('ru-RU')}.`,
    `Ветер: ${compactNumber(result.input.windSpeedMps)} м/с, направление от ${compactNumber(result.input.windFromDegrees)}°. Температура: ${compactNumber(result.input.temperatureC)} °C.`,
    `Глубина зоны: ${compactNumber(result.finalDepthKm)} км.`,
    `Первичное облако на момент прогноза: ${compactNumber(result.primaryDepthAtForecastKm)} км.`,
    `Вторичное облако на момент прогноза: ${compactNumber(result.secondaryDepthAtForecastKm)} км.`,
    `Полная площадь зоны возможного химического заражения Sв: ${compactNumber(result.possibleAreaKm2)} км².`,
    `Полное испарение разлива: ${elapsedText(result.evaporationHours)} (${compactNumber(result.evaporationHours)} ч).`
  ];
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function imageBytes(dataUrl: string): Uint8Array {
  const payload = dataUrl.split(',')[1] ?? '';
  const binary = atob(payload);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function logoBytes(): Promise<Uint8Array> {
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`;
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  canvas.getContext('2d')?.drawImage(image, 0, 0, 192, 192);
  return imageBytes(canvas.toDataURL('image/png'));
}

export async function exportCalculationPdf(result: CalculationResult, verification: VerificationResult, context: ReportContext): Promise<void> {
  const content: Content[] = [];
  content.push({ table: { widths: [66, '*'], body: [[{ svg: LOGO_SVG, width: 50, fillColor: '#062a3b', margin: [8, 7, 4, 7] }, { fillColor: '#062a3b', margin: [0, 9, 8, 7], stack: [{ text: 'ХИМКОНТУР', style: 'brand' }, { text: 'Система поддержки принятия решений при ЧС', style: 'brandSubtitle' }] }]] }, layout: 'noBorders', margin: [0, 0, 0, 14] });
  content.push({ text: 'Отчёт по прогнозированию зоны химического заражения', style: 'title' });
  content.push({ text: `Дата формирования: ${new Date().toLocaleString('ru-RU')}`, color: '#5a7379', margin: [0, 0, 0, 10] });
  content.push({ text: 'Исходные данные и результаты', style: 'heading' });
  summary(result, context).forEach((text) => content.push({ text, margin: [0, 2, 0, 2] }));
  content.push({ text: 'Ход расчёта', style: 'heading', pageBreak: 'before' });
  result.trace.forEach((step, index) => {
    content.push({ text: `${index + 1}. ${step.title}`, style: 'step' });
    content.push({ text: `Формула: ${compactNumbers(step.formula)}` });
    content.push({ text: `Подстановка: ${compactNumbers(step.substitution)}` });
    content.push({ text: `Результат: ${compactNumber(step.result)} ${step.unit}`, margin: [0, 0, 0, 3] });
    step.operands.forEach((operand) => {
      content.push({ text: `${operand.symbol} = ${typeof operand.value === 'number' ? compactNumber(operand.value) : compactNumbers(operand.value)} ${operand.unit} — ${compactReportText(operand.origin)}`, fontSize: 8, color: '#425b63' });
      if (operand.calculation !== undefined) content.push({ text: `Расчёт коэффициента: ${compactNumbers(operand.calculation)}`, fontSize: 8, color: '#08717e', margin: [10, 0, 0, 2] });
    });
  });
  content.push({ text: 'Приложение 1. Схема зоны на местности', style: 'heading', fontSize: 13, margin: [0, 0, 0, 4], pageBreak: 'before', pageOrientation: 'landscape' });
  content.push(context.mapImageDataUrl === undefined
    ? { text: 'Схема не была получена. Повторите формирование отчёта при открытой карте.', color: '#a14332' }
    : { image: context.mapImageDataUrl, fit: [780, 490], alignment: 'center', margin: [0, 0, 0, 0] });
  const pdf = pdfMake.createPdf({
    pageSize: 'A4',
    pageMargins: [30, 28, 30, 30],
    defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.18 },
    footer: (page, pages) => ({ text: `ХИМКОНТУР · ${page} / ${pages} · ${verificationText(verification)}`, alignment: 'center', color: '#698087', fontSize: 7, margin: [0, 12, 0, 0] }),
    styles: {
      brand: { fontSize: 22, bold: true, color: '#ffffff', margin: [0, 2, 0, 1] },
      brandSubtitle: { fontSize: 8, color: '#d5eef1' },
      title: { fontSize: 16, bold: true, color: '#082d3a', margin: [0, 4, 0, 6] },
      heading: { fontSize: 13, bold: true, color: '#073b58', margin: [0, 12, 0, 6] },
      step: { fontSize: 10, bold: true, color: '#006d72', margin: [0, 9, 0, 3] }
    },
    content
  });
  const blob = await new Promise<Blob>((resolve) => pdf.getBlob(resolve));
  saveBlob(blob, filename('pdf'));
}

export async function exportCalculationWord(result: CalculationResult, verification: VerificationResult, context: ReportContext): Promise<void> {
  const logo = await logoBytes();
  const noBorder = { style: BorderStyle.NONE, size: 0, color: '062A3B' };
  const children: (Paragraph | Table)[] = [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
      rows: [new TableRow({ children: [
        new TableCell({ width: { size: 16, type: WidthType.PERCENTAGE }, shading: { fill: '062A3B', type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: logo, transformation: { width: 52, height: 52 }, type: 'png' })] })] }),
        new TableCell({ width: { size: 84, type: WidthType.PERCENTAGE }, shading: { fill: '062A3B', type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'ХИМКОНТУР', bold: true, size: 40, color: 'FFFFFF' })] }), new Paragraph({ children: [new TextRun({ text: 'Система поддержки принятия решений при ЧС', size: 18, color: 'D5EEF1' })] })] })
      ] })]
    }),
    new Paragraph({ text: 'Отчёт по прогнозированию зоны химического заражения', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
    new Paragraph(`Дата формирования: ${new Date().toLocaleString('ru-RU')}`),
    new Paragraph({ text: 'Исходные данные и результаты', heading: HeadingLevel.HEADING_2 }),
    ...summary(result, context).map((text) => new Paragraph(text)),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ text: 'Ход расчёта', heading: HeadingLevel.HEADING_1 })
  ];
  result.trace.forEach((step, index) => {
    children.push(
      new Paragraph({ text: `${index + 1}. ${step.title}`, heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ children: [new TextRun({ text: 'Формула: ', bold: true }), new TextRun(compactNumbers(step.formula))] }),
      new Paragraph({ children: [new TextRun({ text: 'Подстановка: ', bold: true }), new TextRun(compactNumbers(step.substitution))] }),
      new Paragraph({ children: [new TextRun({ text: 'Результат: ', bold: true }), new TextRun(`${compactNumber(step.result)} ${step.unit}`)] }),
      ...step.operands.flatMap((operand) => [
        new Paragraph({ text: `${operand.symbol} = ${typeof operand.value === 'number' ? compactNumber(operand.value) : compactNumbers(operand.value)} ${operand.unit}; источник: ${compactReportText(operand.origin)}`, bullet: { level: 0 } }),
        ...(operand.calculation === undefined ? [] : [new Paragraph({ children: [new TextRun({ text: 'Расчёт коэффициента: ', bold: true, color: '08717E' }), new TextRun(compactNumbers(operand.calculation))], indent: { left: 720 } })])
      ])
    );
  });
  const appendix: (Paragraph | Table)[] = [new Paragraph({ text: 'Приложение 1. Схема зоны на местности', heading: HeadingLevel.HEADING_1 })];
  if (context.mapImageDataUrl !== undefined) {
    const width = 900;
    const height = Math.min(540, Math.round(width / (context.mapAspectRatio ?? 1.45)));
    appendix.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: imageBytes(context.mapImageDataUrl), transformation: { width, height }, type: 'png' })] }));
  } else {
    appendix.push(new Paragraph('Схема не была получена. Повторите формирование отчёта при открытой карте.'));
  }
  appendix.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Автоматическая проверка: ${verificationText(verification)}`, size: 16, color: '698087' })] }));
  const blob = await Packer.toBlob(new Document({
    creator: 'ХИМКОНТУР',
    title: 'Отчёт по прогнозированию зоны химического заражения',
    styles: { paragraphStyles: [
      { id: 'Heading1', name: 'Заголовок 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: '082D3A' }, paragraph: { spacing: { before: 240, after: 120 } } },
      { id: 'Heading2', name: 'Заголовок 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '073B58' }, paragraph: { spacing: { before: 180, after: 80 } } }
    ] },
    sections: [
      { properties: { page: { margin: { top: 720, right: 756, bottom: 756, left: 756 } } }, children },
      { properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 540, right: 540, bottom: 540, left: 540 } } }, children: appendix }
    ]
  }));
  saveBlob(blob, filename('docx'));
}
