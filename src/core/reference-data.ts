import type { Stability, Substance } from './types';

export const METHOD_SOURCE =
  'СП 165.1325800.2014 (ред. 12.04.2023, Изменения № 1-3), приложения Б-В';

export const METHOD_VERSION = 'SP165-2014-ZM1-3-2023-04-12';
export const TABLE_V3_SOURCE = 'СП 165.1325800.2014, приложение В, таблица В.3';
export const MISSING_TABLE_V3_DATA_MESSAGE =
  'Расчёт невозможен: отсутствуют нормативные данные таблицы В.3 для выбранного вещества.';

const TEMPERATURES = [-40, -20, 0, 20, 40] as const;
type K7Pair = number | readonly [primary: number, secondary: number];

function tableV3Substance(
  tableV3Row: string,
  id: string,
  name: string,
  densityGasTPerM3: number | null,
  densityLiquidTPerM3: number,
  boilingPointC: number | null,
  thresholdToxicDoseMgMinPerL: number,
  toxicDoseEstimated: boolean,
  k1: number,
  k2: number,
  k3: number,
  k7Values: readonly [K7Pair, K7Pair, K7Pair, K7Pair, K7Pair]
): Substance {
  return {
    tableV3Row,
    id,
    name,
    densityGasTPerM3,
    densityLiquidTPerM3,
    boilingPointC,
    thresholdToxicDoseMgMinPerL,
    toxicDoseEstimated,
    k1,
    k2,
    k3,
    temperatureFactors: TEMPERATURES.map((temperatureC, index) => {
      const value: K7Pair = k7Values[index] ?? 1;
      const primary = typeof value === 'number' ? value : value[0];
      const secondary = typeof value === 'number' ? value : value[1];
      return { temperatureC, primary, secondary };
    }),
    status: 'verified',
    source: `${TABLE_V3_SOURCE}, строка ${tableV3Row} «${name}»`
  };
}

// Каждая запись ниже однозначно соответствует одной расчетной строке таблицы В.3.
// «-» в нормативной таблице хранится как null, а не подменяется произвольным нулём.
export const SUBSTANCES: readonly Substance[] = [
  tableV3Substance('1', 'acrolein', 'Акролеин', null, 0.839, 52.7, 0.2, true, 0, 0.013, 0.75, [0.1, 0.2, 0.4, 1, 2.2]),
  tableV3Substance('2а', 'ammonia-pressurized', 'Аммиак — хранение под давлением', 0.0008, 0.681, -33.42, 15, false, 0.18, 0.025, 0.04, [[0, 0.9], [0.3, 1], [0.6, 1], [1, 1], [1.4, 1]]),
  tableV3Substance('2б', 'ammonia-isothermal', 'Аммиак — изотермическое хранение', null, 0.681, -33.42, 15, false, 0.01, 0.025, 0.04, [[0, 0.9], [1, 1], [1, 1], [1, 1], [1, 1]]),
  tableV3Substance('3', 'acetonitrile', 'Ацетонитрил', null, 0.786, 81.6, 21.6, true, 0, 0.004, 0.028, [0.02, 0.1, 0.3, 1, 2.6]),
  tableV3Substance('4', 'acetone-cyanohydrin', 'Ацетонциангидрин', null, 0.932, 120, 1.9, true, 0, 0.002, 0.316, [0, 0, 0.3, 1, 1.5]),
  tableV3Substance('5', 'arsine', 'Водород мышьяковистый', 0.0035, 1.64, -62.47, 0.2, true, 0.17, 0.054, 0.857, [[0.3, 1], [0.5, 1], [0.8, 1], [1, 1], [1.2, 1]]),
  tableV3Substance('6', 'hydrogen-fluoride', 'Водород фтористый', null, 0.989, 19.52, 4, false, 0, 0.028, 0.15, [0.1, 0.2, 0.5, 1, 1]),
  tableV3Substance('7', 'hydrogen-chloride', 'Водород хлористый', 0.0016, 1.191, -85.1, 2, false, 0.28, 0.037, 0.3, [[0.4, 1], [0.6, 1], [0.8, 1], [1, 1], [1.2, 1]]),
  tableV3Substance('8', 'hydrogen-bromide', 'Водород бромистый', 0.0036, 1.49, -66.77, 2.4, true, 0.13, 0.055, 6, [[0.2, 1], [0.5, 1], [0.8, 1], [1, 1], [1.2, 1]]),
  tableV3Substance('9', 'hydrogen-cyanide', 'Водород цианистый', null, 0.687, 25.7, 0.2, false, 0, 0.026, 3, [0, 0, 0.4, 1, 1.3]),
  tableV3Substance('10', 'dimethylamine', 'Диметиламин', 0.002, 0.68, 6.9, 1.2, true, 0.06, 0.041, 0.5, [[0, 0.1], [0, 0.3], [0, 0.8], [1, 1], [2.5, 1]]),
  tableV3Substance('11', 'methylamine', 'Метиламин', 0.0014, 0.699, -6.5, 1.2, true, 0.13, 0.034, 0.5, [[0, 0.3], [0, 0.7], [0.5, 1], [1, 1], [2.5, 1]]),
  tableV3Substance('12', 'methyl-bromide', 'Метил бромистый', null, 1.732, 3.6, 1.2, true, 0.04, 0.039, 0.5, [[0, 0.2], [0, 0.4], [0, 0.9], [1, 1], [2.3, 1]]),
  tableV3Substance('13', 'methyl-chloride', 'Метил хлористый', 0.0023, 0.983, -23.76, 10.8, true, 0.125, 0.044, 0.056, [[0, 0.5], [0.1, 1], [0.6, 1], [1, 1], [1.5, 1]]),
  tableV3Substance('14', 'methyl-acrylate', 'Метилакрилат', null, 0.953, 80.2, 6, true, 0, 0.005, 0.025, [0.1, 0.2, 0.4, 1, 3.1]),
  tableV3Substance('15', 'methyl-mercaptan', 'Метилмеркаптан', null, 0.867, 5.95, 1.7, true, 0.06, 0.043, 0.353, [[0, 0.1], [0, 0.3], [0, 0.8], [1, 1], [2.4, 1]]),
  tableV3Substance('16', 'acrylonitrile', 'Нитрил акриловой кислоты', null, 0.806, 77.3, 0.75, false, 0, 0.007, 0.8, [0.04, 0.1, 0.4, 1, 2.4]),
  tableV3Substance('17', 'nitrogen-oxides', 'Окислы азота', null, 1.491, 21, 1.5, false, 0, 0.04, 0.4, [0, 0, 0.4, 1, 1]),
  tableV3Substance('18', 'ethylene-oxide', 'Окись этилена', null, 0.882, 10.7, 2.2, true, 0.05, 0.041, 0.27, [[0, 0.1], [0, 0.3], [0, 0.7], [1, 1], [3.2, 1]]),
  tableV3Substance('19', 'sulfur-dioxide', 'Сернистый ангидрид', 0.0029, 1.462, -10.1, 1.8, false, 0.11, 0.049, 0.333, [[0, 0.2], [0, 0.5], [0.3, 1], [1, 1], [1.7, 1]]),
  tableV3Substance('20', 'hydrogen-sulfide', 'Сероводород', 0.0015, 0.964, -60.35, 16.1, false, 0.27, 0.042, 0.036, [[0.3, 1], [0.5, 1], [0.8, 1], [1, 1], [1.2, 1]]),
  tableV3Substance('21', 'carbon-disulfide', 'Сероуглерод', null, 1.263, 46.2, 45, false, 0, 0.021, 0.013, [0.1, 0.2, 0.4, 1, 2.1]),
  tableV3Substance('22', 'hydrochloric-acid', 'Соляная кислота (концентрированная)', null, 1.198, null, 2, false, 0, 0.021, 0.3, [0, 0.1, 0.3, 1, 1.6]),
  tableV3Substance('23', 'trimethylamine', 'Триметиламин', null, 0.671, 2.9, 6, true, 0.07, 0.047, 0.1, [[0, 0.1], [0, 0.4], [0, 0.9], [1, 1], [2.2, 1]]),
  tableV3Substance('24', 'formaldehyde', 'Формальдегид', null, 0.815, -19, 0.6, true, 0.19, 0.034, 1, [[0, 0.4], [0, 1], [0.5, 1], [1, 1], [1.5, 1]]),
  tableV3Substance('25', 'phosgene', 'Фосген', 0.0035, 1.432, 8.2, 0.6, false, 0.05, 0.061, 1, [[0, 0.1], [0, 0.3], [0, 0.7], [1, 1], [2.7, 1]]),
  tableV3Substance('26', 'fluorine', 'Фтор', 0.0017, 1.512, -188.2, 0.2, true, 0.95, 0.038, 3, [[0.7, 1], [0.8, 1], [0.9, 1], [1, 1], [1.1, 1]]),
  tableV3Substance('27', 'phosphorus-trichloride', 'Фосфор треххлористый', null, 1.57, 75.3, 3, false, 0, 0.01, 0.2, [0.1, 0.2, 0.4, 1, 2.3]),
  tableV3Substance('28', 'phosphoryl-chloride', 'Фосфора хлорокись', null, 1.675, 107.2, 0.06, true, 0, 0.003, 10, [0.05, 0.1, 0.3, 1, 2.6]),
  tableV3Substance('29', 'chlorine', 'Хлор', 0.0032, 1.553, -34.1, 0.6, false, 0.18, 0.052, 1, [[0, 0.9], [0.3, 1], [0.6, 1], [1, 1], [1.4, 1]]),
  tableV3Substance('30', 'chloropicrin', 'Хлорпикрин', null, 1.658, 112.3, 0.02, false, 0, 0.002, 30, [0.03, 0.1, 0.3, 1, 2.9]),
  tableV3Substance('31', 'cyanogen-chloride', 'Хлорциан', 0.0021, 1.22, 12.6, 0.75, false, 0.04, 0.048, 0.8, [[0, 0], [0, 0], [0, 0.6], [1, 1], [3.9, 1]]),
  tableV3Substance('32', 'ethyleneimine', 'Этиленимин', null, 0.838, 55, 4.8, false, 0, 0.009, 0.125, [0.05, 0.1, 0.4, 1, 2.2]),
  tableV3Substance('33', 'ethylene-sulfide', 'Этиленсульфид', null, 1.005, 55, 0.1, true, 0, 0.013, 6, [0.05, 0.1, 0.4, 1, 2.2]),
  tableV3Substance('34', 'ethyl-mercaptan', 'Этилмеркаптан', null, 0.839, 35, 2.2, true, 0, 0.028, 0.27, [0.1, 0.2, 0.5, 1, 1.7])
];

export function hasCompleteTableV3Data(substance: Substance): boolean {
  return substance.status === 'verified'
    && substance.tableV3Row.length > 0
    && (substance.densityGasTPerM3 === null || Number.isFinite(substance.densityGasTPerM3) && substance.densityGasTPerM3 > 0)
    && Number.isFinite(substance.densityLiquidTPerM3) && substance.densityLiquidTPerM3 > 0
    && (substance.boilingPointC === null || Number.isFinite(substance.boilingPointC))
    && Number.isFinite(substance.thresholdToxicDoseMgMinPerL) && substance.thresholdToxicDoseMgMinPerL > 0
    && Number.isFinite(substance.k1) && substance.k1 >= 0
    && Number.isFinite(substance.k2) && substance.k2 > 0
    && Number.isFinite(substance.k3) && substance.k3 > 0
    && substance.temperatureFactors.length === 5
    && substance.temperatureFactors.every((factor, index) => factor.temperatureC === TEMPERATURES[index]
      && Number.isFinite(factor.primary) && factor.primary >= 0
      && Number.isFinite(factor.secondary) && factor.secondary >= 0);
}

export const EQUIVALENT_MASS_T = [
  0.01, 0.05, 0.1, 0.5, 1, 3, 5, 10, 20, 30, 50, 70, 100, 300, 500, 700, 1000, 2000
] as const;

export const DEPTH_KM: readonly (readonly number[])[] = [
  [0.38, 0.85, 1.25, 3.16, 4.75, 9.18, 12.53, 19.2, 29.56, 38.13, 52.67, 65.23, 81.91, 166, 231, 288, 363, 572],
  [0.26, 0.59, 0.84, 1.92, 2.84, 5.35, 7.2, 10.83, 16.44, 21.02, 28.73, 35.35, 44.09, 87.79, 121, 150, 189, 295],
  [0.22, 0.48, 0.68, 1.53, 2.17, 3.99, 5.34, 7.96, 11.94, 15.18, 20.59, 25.21, 31.3, 61.47, 84.5, 104, 130, 202],
  [0.19, 0.42, 0.59, 1.33, 1.88, 3.28, 4.36, 6.46, 9.62, 12.18, 16.43, 20.05, 24.8, 48.18, 65.92, 81.17, 101, 157],
  [0.17, 0.38, 0.53, 1.19, 1.68, 2.91, 3.75, 5.53, 8.19, 10.33, 13.88, 16.89, 20.82, 40.11, 54.67, 67.15, 83.6, 129],
  [0.15, 0.34, 0.48, 1.09, 1.53, 2.66, 3.43, 4.88, 7.2, 9.06, 12.14, 14.79, 18.13, 34.67, 47.09, 56.72, 71.7, 110],
  [0.14, 0.32, 0.45, 1, 1.42, 2.46, 3.17, 4.49, 6.48, 8.14, 10.87, 13.17, 16.17, 30.73, 41.63, 50.93, 63.16, 96.3],
  [0.13, 0.3, 0.42, 0.94, 1.33, 2.3, 2.97, 4.2, 5.92, 7.42, 9.9, 11.98, 14.68, 27.75, 37.49, 45.79, 56.7, 86.2],
  [0.12, 0.28, 0.4, 0.88, 1.25, 2.17, 2.8, 3.96, 5.6, 6.86, 9.12, 11.03, 13.5, 25.39, 34.24, 41.76, 51.6, 78.3],
  [0.12, 0.26, 0.38, 0.84, 1.19, 2.06, 2.66, 3.76, 5.31, 6.5, 8.5, 10.23, 12.54, 23.49, 31.61, 38.5, 47.53, 71.9],
  [0.11, 0.25, 0.36, 0.8, 1.13, 1.96, 2.53, 3.58, 5.06, 6.2, 8.01, 9.61, 11.74, 21.91, 29.44, 35.81, 44.15, 66.62],
  [0.11, 0.24, 0.34, 0.76, 1.08, 1.88, 2.42, 3.43, 4.85, 5.94, 7.67, 9.07, 11.06, 20.58, 27.61, 35.55, 41.3, 62.2],
  [0.1, 0.23, 0.33, 0.74, 1.04, 1.8, 2.37, 3.29, 4.66, 5.7, 7.37, 8.72, 10.48, 19.45, 26.04, 31.62, 38.9, 58.44],
  [0.1, 0.22, 0.32, 0.71, 1, 1.74, 2.24, 3.17, 4.49, 5.5, 7.1, 8.4, 10.04, 18.46, 24.69, 29.95, 36.81, 55.2],
  [0.1, 0.22, 0.31, 0.69, 0.97, 1.68, 2.17, 3.07, 4.34, 5.31, 6.86, 8.11, 9.7, 17.6, 23.5, 28.48, 34.98, 52.37]
];

export const K4_BY_WIND = [
  { windMps: 1, k4: 1 },
  { windMps: 2, k4: 1.33 },
  { windMps: 3, k4: 1.67 },
  { windMps: 4, k4: 2 },
  { windMps: 5, k4: 2.34 },
  { windMps: 6, k4: 2.67 },
  { windMps: 7, k4: 3 },
  { windMps: 8, k4: 3.34 },
  { windMps: 9, k4: 3.67 },
  { windMps: 10, k4: 4 },
  { windMps: 15, k4: 5.68 }
] as const;

export const TRANSFER_SPEED_KMH: Readonly<Record<Stability, readonly number[]>> = {
  inversion: [5, 10, 16, 21],
  isothermy: [6, 12, 18, 24, 29, 35, 41, 47, 53, 59, 65, 71, 76, 82, 88],
  convection: [7, 14, 21, 28]
};

export const STABILITY_FACTOR: Readonly<Record<Stability, number>> = {
  inversion: 1,
  isothermy: 0.23,
  convection: 0.08
};
