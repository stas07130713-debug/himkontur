import { evaluateControlPoint } from '../core/geo';
import type { CalculationResult, ControlPointResult, GeoPoint } from '../core/types';
import type { DistrictBuilding, DistrictMapObject } from './district-map-model';
import { districtObjectFocusPoint, pointInsideDistrictContour } from './district-map-visuals';

export type RescueServiceWarning = Readonly<{ building: DistrictBuilding; status: ControlPointResult }>;

export function evaluateRescueServiceWarning(
  result: CalculationResult | null,
  objects: readonly DistrictMapObject[],
): RescueServiceWarning | null {
  if (result === null) return null;
  const building = objects.find((object): object is DistrictBuilding => object.kind === 'building' && object.mapRole === 'rescue-service');
  if (building === undefined) return null;
  const contourMidpoints = building.contour.map((point, index) => {
    const next = building.contour[(index + 1) % building.contour.length] ?? point;
    return { latitude: (point.latitude + next.latitude) / 2, longitude: (point.longitude + next.longitude) / 2 };
  });
  const latitudes = building.contour.map((point) => point.latitude);
  const longitudes = building.contour.map((point) => point.longitude);
  const interiorSamples: GeoPoint[] = building.contour.length < 3 ? [] : Array.from({ length: 16 }, (_, index) => ({
    latitude: Math.min(...latitudes) + (Math.max(...latitudes) - Math.min(...latitudes)) * (Math.floor(index / 4) + 0.5) / 4,
    longitude: Math.min(...longitudes) + (Math.max(...longitudes) - Math.min(...longitudes)) * (index % 4 + 0.5) / 4,
  })).filter((point) => pointInsideDistrictContour(point, building.contour));
  const samples = [districtObjectFocusPoint(building), ...building.contour, ...contourMidpoints, ...interiorSamples];
  const affected = samples.map((point) => evaluateControlPoint(result, point)).filter((status) => status.willBeAffected);
  if (affected.length === 0) return null;
  const status = affected.reduce((earliest, candidate) =>
    (candidate.arrivalMinutesAfterAccident ?? Number.POSITIVE_INFINITY) < (earliest.arrivalMinutesAfterAccident ?? Number.POSITIVE_INFINITY) ? candidate : earliest,
  );
  return { building, status };
}
