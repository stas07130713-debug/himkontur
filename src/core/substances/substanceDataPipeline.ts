import { VALIDATED_SUBSTANCES_PILOT } from './validatedSubstancesPilot';
import { validateSubstanceRecord } from './validatedSubstanceValidator';
import type { ValidatedSubstanceRecord } from './validatedSubstanceTypes';

export type RawSourceSnapshot = Readonly<{
  unNumber: string;
  sourceId: string;
  sourceVersion: string;
  importedAt: string;
  rawTransportRow: Readonly<Record<string, string>>;
}>;

export type SubstanceDataLayers = Readonly<{
  raw: readonly RawSourceSnapshot[];
  normalized: readonly ValidatedSubstanceRecord[];
  published: readonly ValidatedSubstanceRecord[];
  rejected: readonly Readonly<{ recordId: string; reasons: readonly string[] }>[];
}>;

const IMPORTED_AT = '2026-09-14';
const raw = (unNumber: string, name: string, hazardClass: string, code: string, kemler: string): RawSourceSnapshot => ({
  unNumber,
  sourceId: 'adr-2025',
  sourceVersion: 'ADR 2025, таблица A главы 3.2',
  importedAt: IMPORTED_AT,
  rawTransportRow: { unNumber, name, hazardClass, classificationCode: code, kemlerCode: kemler },
});

// Raw snapshots stay immutable. Normalization never overwrites them.
export const PILOT_RAW_SOURCE_DATA: readonly RawSourceSnapshot[] = [
  raw('1017', 'ХЛОР', '2', '2TOC', '265'),
  raw('1005', 'АММИАК БЕЗВОДНЫЙ', '2', '2TC', '268'),
  raw('1050', 'ВОДОРОДА ХЛОРИД БЕЗВОДНЫЙ', '2', '2TC', '268'),
  raw('1824', 'НАТРИЯ ГИДРОКСИДА РАСТВОР', '8', 'C5', '80'),
  raw('1972', 'МЕТАН ОХЛАЖДЁННЫЙ ЖИДКИЙ', '2', '3F', '223'),
];

export function buildSubstanceDataLayers(
  rawRecords: readonly RawSourceSnapshot[],
  normalizedRecords: readonly ValidatedSubstanceRecord[],
): SubstanceDataLayers {
  const rawUN = new Set(rawRecords.map((record) => record.unNumber));
  const published: ValidatedSubstanceRecord[] = [];
  const rejected: { recordId: string; reasons: string[] }[] = [];
  for (const record of normalizedRecords) {
    const result = validateSubstanceRecord(record);
    const un = record.transport.unNumber.value ?? '';
    const reasons = [...result.issues.map((issue) => `${issue.severity}: ${issue.code}`)];
    if (!rawUN.has(un)) reasons.push('CRITICAL: RAW_SOURCE_MISSING');
    if (result.validForPublication && reasons.length === 0) published.push(record);
    else rejected.push({ recordId: record.recordId, reasons });
  }
  return { raw: rawRecords, normalized: normalizedRecords, published, rejected };
}

export const PILOT_SUBSTANCE_DATA = buildSubstanceDataLayers(PILOT_RAW_SOURCE_DATA, VALIDATED_SUBSTANCES_PILOT);

export function getPublishedSubstanceByUN(unNumber: string): ValidatedSubstanceRecord | undefined {
  const un = unNumber.replace(/\D/gu, '').padStart(4, '0');
  return PILOT_SUBSTANCE_DATA.published.find((record) => record.transport.unNumber.value === un);
}
