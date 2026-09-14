export type Stability = 'inversion' | 'isothermy' | 'convection';
export type SpillKind = 'free' | 'separateBund' | 'commonBund';
export type ProvenanceKind = 'user' | 'weatherApi' | 'template' | 'normative';

export type GeoPoint = Readonly<{ latitude: number; longitude: number }>;

export type TemperatureFactor = Readonly<{
  temperatureC: number;
  primary: number;
  secondary: number;
}>;

export type Substance = Readonly<{
  id: string;
  name: string;
  tableV3Row: string;
  densityGasTPerM3: number | null;
  densityLiquidTPerM3: number;
  boilingPointC: number | null;
  thresholdToxicDoseMgMinPerL: number;
  toxicDoseEstimated: boolean;
  k1: number;
  k2: number;
  k3: number;
  temperatureFactors: readonly TemperatureFactor[];
  status: 'verified' | 'blocked';
  source: string;
  blockingReason?: string;
}>;

export type CalculationInput = Readonly<{
  substanceId: string;
  massT: number;
  spillKind: SpillKind;
  bundHeightM: number;
  commonBundAreaM2: number;
  temperatureC: number;
  windSpeedMps: number;
  windFromDegrees: number;
  cloudCoverPercent: number;
  snowCover: boolean;
  stability: Stability;
  elapsedHours: number;
  accidentTimeIso: string;
  sourcePoint: GeoPoint;
}>;

export type TraceOperand = Readonly<{
  symbol: string;
  value: number | string;
  unit: string;
  origin: string;
  calculation?: string;
}>;

export type TraceStep = Readonly<{
  id: string;
  title: string;
  formula: string;
  substitution: string;
  result: number;
  unit: string;
  operands: readonly TraceOperand[];
}>;

export type CalculationResult = Readonly<{
  input: CalculationInput;
  substance: Substance;
  primaryEquivalentT: number;
  secondaryEquivalentT: number;
  evaporationHours: number;
  primaryDepthKm: number;
  secondaryDepthKm: number;
  primaryDepthAtForecastKm: number;
  secondaryDepthAtForecastKm: number;
  combinedDepthKm: number;
  transportLimitKm: number;
  finalDepthKm: number;
  potentialDepthKm: number;
  possibleAreaKm2: number;
  transferSpeedKmh: number;
  sectorAngleDegrees: number;
  plumeToDegrees: number;
  warnings: readonly string[];
  trace: readonly TraceStep[];
}>;

export type VerificationResult = Readonly<{
  status: 'verified' | 'warning' | 'failed';
  checkedAtIso: string;
  differences: readonly string[];
}>;

export type ControlPointResult = Readonly<{
  distanceKm: number;
  bearingDegrees: number;
  insideSector: boolean;
  insideDepth: boolean;
  insidePotentialDepth: boolean;
  reachedByForecast: boolean;
  willBeAffected: boolean;
  arrivalHours: number | null;
  arrivalMinutesAfterAccident: number | null;
  arrivalTimeIso: string | null;
}>;
