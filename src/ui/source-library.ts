import type { SpillKind } from '../core/types';

export type SourceKind = 'rail' | 'truck' | 'tank' | 'rail-tanks' | 'cylinder' | 'process' | 'custom';

export type SourceConfiguration = Readonly<{
  id: string;
  kind: SourceKind;
  label: string;
  substanceId: string;
  volumeM3: number;
  spillKind: SpillKind;
  bundHeightM: number;
  commonBundAreaM2: number;
  enabledContainerUnits?: readonly [boolean, boolean];
  calculationMode?: 'vessel' | 'pipeline';
  conversionTPerM3?: number;
  pipelineLengthM?: number;
  pipelineDiameterMm?: number;
  imageDataUrl?: string;
}>;

export const CAPACITY_MASS_COEFFICIENT = 1.25;
export const CHLORINE_DENSITY_T_PER_M3 = 1.553;

export function massFromCapacity(volumeM3: number, densityTPerM3: number): number {
  return Math.max(0, volumeM3) * Math.max(0, densityTPerM3) / CAPACITY_MASS_COEFFICIENT;
}

export function pipelineVolumeM3(lengthM: number, diameterMm: number): number {
  const diameterM = Math.max(0, diameterMm) / 1000;
  return Math.PI * diameterM ** 2 / 4 * Math.max(0, lengthM);
}

export function quantityFractionDigits(value: number): number {
  const absolute = Math.abs(value);
  if (absolute === 0 || absolute >= 0.01) return 2;
  if (absolute >= 0.001) return 5;
  return 6;
}

export function formatCalculatedQuantity(value: number): string {
  const digits = quantityFractionDigits(value);
  return value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function massFromSource(source: SourceConfiguration, fallbackDensityTPerM3: number): number {
  const coefficient = source.conversionTPerM3 ?? fallbackDensityTPerM3;
  return source.calculationMode === 'pipeline'
    ? Math.max(0, source.volumeM3) * Math.max(0, coefficient)
    : massFromCapacity(source.volumeM3, coefficient);
}

export const DEFAULT_SOURCE: SourceConfiguration = {
  id: 'rail', kind: 'rail', label: 'ЖД цистерна', substanceId: 'chlorine', volumeM3: 54 * CAPACITY_MASS_COEFFICIENT / CHLORINE_DENSITY_T_PER_M3, spillKind: 'free', bundHeightM: 1, commonBundAreaM2: 100
};

export const SOURCE_LIBRARY: readonly SourceConfiguration[] = [
  DEFAULT_SOURCE,
  { id: 'truck', kind: 'truck', label: 'Автоцистерна', substanceId: 'chlorine', volumeM3: 0, spillKind: 'free', bundHeightM: 1, commonBundAreaM2: 100 },
  { id: 'tank', kind: 'tank', label: 'Стационарный танк', substanceId: 'chlorine', volumeM3: 40, spillKind: 'separateBund', bundHeightM: 1, commonBundAreaM2: 100 },
  { id: 'rail-tanks', kind: 'rail-tanks', label: 'ЖД контейнеры', substanceId: 'chlorine', volumeM3: 2 * 26 * CAPACITY_MASS_COEFFICIENT / CHLORINE_DENSITY_T_PER_M3, spillKind: 'free', bundHeightM: 1, commonBundAreaM2: 100, enabledContainerUnits: [true, true] },
  { id: 'cylinder', kind: 'cylinder', label: 'Газовый баллон', substanceId: 'chlorine', volumeM3: 0.06, spillKind: 'free', bundHeightM: 1, commonBundAreaM2: 100 },
  { id: 'process', kind: 'process', label: 'Хлорный трубопровод', substanceId: 'chlorine', volumeM3: 0, spillKind: 'free', bundHeightM: 1, commonBundAreaM2: 100, calculationMode: 'pipeline', conversionTPerM3: CHLORINE_DENSITY_T_PER_M3, pipelineLengthM: 0, pipelineDiameterMm: 0 }
] as const;
