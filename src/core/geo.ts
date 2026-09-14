import type { CalculationResult, ControlPointResult, GeoPoint } from './types';
import { calculate } from './calculation';

const EARTH_RADIUS_KM = 6371.0088;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue: number): number {
  return (radiansValue * 180) / Math.PI;
}

export function distanceKm(from: GeoPoint, to: GeoPoint): number {
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude);
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

export function angularDifferenceDegrees(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function firstCalculatedReachMinute(result: CalculationResult, distance: number): number | null {
  if (distance <= 1e-9) return 0;
  const depthAtMinute = (minute: number) => calculate({ ...result.input, elapsedHours: minute / 60 }).finalDepthKm;
  const lastMinute = 240;
  if (depthAtMinute(lastMinute) + 1e-9 < distance) return null;
  let low = 1;
  let high = lastMinute;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (depthAtMinute(middle) + 1e-9 >= distance) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function evaluateControlPoint(result: CalculationResult, point: GeoPoint): ControlPointResult {
  const distance = distanceKm(result.input.sourcePoint, point);
  const bearing = bearingDegrees(result.input.sourcePoint, point);
  const insideSector =
    result.sectorAngleDegrees === 360 ||
    angularDifferenceDegrees(bearing, result.plumeToDegrees) <= result.sectorAngleDegrees / 2;
  const insideDepth = distance <= result.finalDepthKm;
  const reachedByForecast = insideSector && insideDepth;
  const arrivalMinutesAfterAccident = insideSector ? firstCalculatedReachMinute(result, distance) : null;
  const insidePotentialDepth = arrivalMinutesAfterAccident !== null;
  const willBeAffected = insideSector && insidePotentialDepth;
  const arrivalHours = arrivalMinutesAfterAccident === null ? null : arrivalMinutesAfterAccident / 60;
  const arrivalTimeIso =
    arrivalMinutesAfterAccident === null
      ? null
      : new Date(Date.parse(result.input.accidentTimeIso) + arrivalMinutesAfterAccident * 60_000).toISOString();
  return { distanceKm: distance, bearingDegrees: bearing, insideSector, insideDepth, insidePotentialDepth, reachedByForecast, willBeAffected, arrivalHours, arrivalMinutesAfterAccident, arrivalTimeIso };
}
