import type { DistrictMapObject } from './district-map-model';

export type DistrictMarkerPlacement = Readonly<{
  object: DistrictMapObject;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
}>;

type ScreenObject = Readonly<{ object: DistrictMapObject; x: number; y: number }>;
/** Every sign stays exactly on its geographic coordinate; zoom controls readability. */
export function declutterDistrictMarkers(items: readonly ScreenObject[], width: number, height: number): readonly DistrictMarkerPlacement[] {
  if (width <= 0 || height <= 0) return [];
  return items.map(({ object, x, y }) => ({ object, anchorX: x, anchorY: y, x, y }));
}
