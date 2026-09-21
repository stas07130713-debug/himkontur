import type { SourcedValue, SubstanceValidationIssue, SubstanceValidationResult, ValidatedSubstanceRecord } from './validatedSubstanceTypes';

const OTHER_SUBSTANCE_PATTERNS: Readonly<Record<string, readonly RegExp[]>> = {
  '1017': [/аммиак/iu, /метан/iu, /натри[яй]\s+гидроксид/iu],
  '1005': [/хлор(?!ид)/iu, /метан/iu, /натри[яй]\s+гидроксид/iu],
  '1050': [/аммиак/iu, /метан/iu, /натри[яй]\s+гидроксид/iu],
  '1824': [/пары?\s+аммиака/iu, /аммиак\s+легче\s+воздуха/iu, /метан\s+охлажден/iu],
  '1972': [/ацетилен/iu, /этилен(?!глик)/iu, /газы?[,\s]+содержащие\s+водород/iu, /аммиак/iu],
};

function textValues(record: ValidatedSubstanceRecord): string {
  const fields = [record.emergency.mainProperties, record.emergency.fireExplosionHazards, record.emergency.healthHazards,
    record.emergency.ppe, record.emergency.emergencyActions, record.emergency.firstAid];
  return fields.flatMap((field) => field.value ?? []).join('\n');
}

function sourceCheck<T>(field: SourcedValue<T>, path: string, sourceIds: ReadonlySet<string>, issues: SubstanceValidationIssue[]): void {
  if (field.value !== null && field.sourceIds.length === 0) issues.push({ severity: 'CRITICAL', code: 'VALUE_WITHOUT_SOURCE', message: 'Значение не связано с источником.', path });
  for (const sourceId of field.sourceIds) if (!sourceIds.has(sourceId)) issues.push({ severity: 'CRITICAL', code: 'UNKNOWN_SOURCE', message: `Неизвестный источник ${sourceId}.`, path });
  if (field.status === 'conflict' || field.status === 'manual_review_required') issues.push({ severity: 'HIGH', code: 'UNRESOLVED_FIELD', message: 'Поле требует ручной проверки и не может публиковаться.', path });
}

export function validateSubstanceRecord(record: ValidatedSubstanceRecord): SubstanceValidationResult {
  const issues: SubstanceValidationIssue[] = [];
  const sourceIds = new Set(record.sources.map((source) => source.id));
  const sourcedFields: readonly [SourcedValue<unknown>, string][] = [
    [record.chemical.name, 'chemical.name'], [record.chemical.casNumber, 'chemical.casNumber'], [record.chemical.formula, 'chemical.formula'],
    [record.productForm.displayName, 'productForm.displayName'], [record.productForm.physicalForm, 'productForm.physicalForm'], [record.productForm.concentration, 'productForm.concentration'],
    [record.transport.unNumber, 'transport.unNumber'], [record.transport.officialTransportName, 'transport.officialTransportName'], [record.transport.hazardClass, 'transport.hazardClass'],
    [record.transport.classificationCode, 'transport.classificationCode'], [record.transport.kemlerCode, 'transport.kemlerCode'], [record.transport.packingGroup, 'transport.packingGroup'], [record.transport.hazardLabels, 'transport.hazardLabels'],
    [record.emergency.mainProperties, 'emergency.mainProperties'], [record.emergency.fireExplosionHazards, 'emergency.fireExplosionHazards'], [record.emergency.healthHazards, 'emergency.healthHazards'],
    [record.emergency.ppe, 'emergency.ppe'], [record.emergency.emergencyActions, 'emergency.emergencyActions'], [record.emergency.consequenceControl, 'emergency.consequenceControl'], [record.emergency.firstAid, 'emergency.firstAid'],
  ];
  for (const [field, path] of sourcedFields) sourceCheck(field, path, sourceIds, issues);
  const un = record.transport.unNumber.value ?? '';
  if (!/^\d{4}$/u.test(un)) issues.push({ severity: 'CRITICAL', code: 'INVALID_UN', message: 'UN должен состоять из четырёх цифр.', path: 'transport.unNumber' });
  if (record.productForm.isSolution && (record.productForm.concentration.value ?? '').trim() === '') issues.push({ severity: 'HIGH', code: 'SOLUTION_CONCENTRATION_NOT_SPECIFIED', message: 'Для раствора не указан диапазон концентрации; свойства, зависящие от концентрации, публиковать нельзя.', path: 'productForm.concentration' });
  if (record.productForm.isAnhydrous && record.productForm.isSolution) issues.push({ severity: 'CRITICAL', code: 'ANHYDROUS_SOLUTION_CONFLICT', message: 'Безводная форма ошибочно отмечена как раствор.', path: 'productForm' });
  if (record.productForm.isRefrigeratedLiquid && !record.emergency.flags.isCryogenic) issues.push({ severity: 'CRITICAL', code: 'CRYOGENIC_FLAG_MISSING', message: 'Для охлаждённой жидкости отсутствует признак криогенной опасности.', path: 'emergency.flags.isCryogenic' });
  if ((record.transport.hazardLabels.value ?? []).length === 0) issues.push({ severity: 'HIGH', code: 'HAZARD_LABELS_MISSING', message: 'Знаки опасности не подтверждены транспортным источником.', path: 'transport.hazardLabels' });
  const rail = record.transportInstructions.rail.value;
  if (rail?.cardType === 'group' && record.emergency.mainProperties.sourceIds.some((sourceId) => sourceId.startsWith('rail-'))) issues.push({ severity: 'CRITICAL', code: 'GROUP_CARD_CONTAMINATION', message: 'Текст групповой железнодорожной АК попал в индивидуальные свойства.', path: 'emergency.mainProperties' });
  for (const pattern of OTHER_SUBSTANCE_PATTERNS[un] ?? []) if (pattern.test(textValues(record))) issues.push({ severity: 'CRITICAL', code: 'FOREIGN_SUBSTANCE_IN_PROFILE', message: `В индивидуальном профиле UN ${un} найдено название другого вещества: ${pattern.source}.`, path: 'emergency' });
  if (record.emergency.flags.isCryogenic && !/холод|обморож/iu.test(textValues(record))) issues.push({ severity: 'HIGH', code: 'CRYOGENIC_INJURY_MISSING', message: 'В криогенном профиле не указано холодовое поражение или обморожение.', path: 'emergency.healthHazards' });
  if (record.emergency.consequenceControl.value?.operation === 'neutralization' && record.emergency.flags.isFlammable && !record.emergency.flags.isCorrosive) issues.push({ severity: 'MEDIUM', code: 'QUESTIONABLE_NEUTRALIZATION', message: 'Для горючего некоррозионного вещества требуется проверка применимости химической нейтрализации.', path: 'emergency.consequenceControl' });
  return { validForPublication: !issues.some((issue) => issue.severity === 'CRITICAL' || issue.severity === 'HIGH'), issues };
}
