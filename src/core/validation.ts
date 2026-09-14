import { hasCompleteTableV3Data, MISSING_TABLE_V3_DATA_MESSAGE, SUBSTANCES } from './reference-data';
import type { CalculationInput, Substance } from './types';

export class CalculationInputError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join(' '));
    this.name = 'CalculationInputError';
    this.problems = problems;
  }
}

export function validateInput(input: CalculationInput): Substance {
  const problems: string[] = [];
  const substance = SUBSTANCES.find((item) => item.id === input.substanceId);
  if (substance === undefined || !hasCompleteTableV3Data(substance)) problems.push(MISSING_TABLE_V3_DATA_MESSAGE);
  if (!Number.isFinite(input.massT) || input.massT <= 0) problems.push('Масса должна быть больше нуля.');
  if (!Number.isFinite(input.windSpeedMps) || input.windSpeedMps <= 0) problems.push('Скорость ветра должна быть больше нуля.');
  if (input.windSpeedMps > 4 && input.stability !== 'isothermy') {
    problems.push('При скорости ветра более 4 м/с таблица В.1 предусматривает изотермию.');
  }
  if (input.windFromDegrees < 0 || input.windFromDegrees >= 360) problems.push('Направление ветра должно быть от 0 до 359,999°');
  if (input.elapsedHours <= 0 || input.elapsedHours > 4) problems.push('Время прогноза должно быть больше нуля и не превышать 4 часов.');
  if (input.temperatureC < -60 || input.temperatureC > 60) problems.push('Температура выходит за допустимый диапазон интерфейса.');
  if (input.spillKind === 'separateBund' && input.bundHeightM <= 0.2) problems.push('Высота отдельного поддона должна быть больше 0,2 м.');
  if (input.spillKind === 'commonBund' && input.commonBundAreaM2 <= 0) problems.push('Площадь общего поддона должна быть больше нуля.');
  if (!Number.isFinite(input.sourcePoint.latitude) || Math.abs(input.sourcePoint.latitude) > 90) problems.push('Некорректная широта источника.');
  if (!Number.isFinite(input.sourcePoint.longitude) || Math.abs(input.sourcePoint.longitude) > 180) problems.push('Некорректная долгота источника.');
  if (Number.isNaN(Date.parse(input.accidentTimeIso))) problems.push('Некорректное время аварии.');
  if (problems.length > 0 || substance === undefined) throw new CalculationInputError(problems);
  return substance;
}
