import type { GeoPoint } from '../core/types';
import { cumulativeDistanceMeters, distanceMeters, formatRulerDistance } from './map-ruler';

export function MapRulerOverlay({ points, project }: Readonly<{
  points: readonly GeoPoint[];
  project: (point: GeoPoint) => Readonly<{ x: number; y: number }>;
}>) {
  const projected = points.map(project);
  if (projected.length === 0) return null;
  return <g className="map-ruler-overlay" aria-label="Измеренное расстояние">
    {projected.slice(1).map((point, index) => {
      const previous = projected[index];
      const firstGeo = points[index];
      const secondGeo = points[index + 1];
      if (previous === undefined || firstGeo === undefined || secondGeo === undefined) return null;
      return <g key={`ruler-segment-${index}`}>
        <line x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} />
        <text x={(previous.x + point.x) / 2} y={(previous.y + point.y) / 2 - 7} textAnchor="middle">{formatRulerDistance(distanceMeters(firstGeo, secondGeo))}</text>
      </g>;
    })}
    {projected.map((point, index) => <circle key={`ruler-point-${index}`} cx={point.x} cy={point.y} r="5" />)}
    {projected.length > 1 && (() => {
      const last = projected.at(-1);
      if (last === undefined) return null;
      return <text className="map-ruler-total" x={last.x + 10} y={last.y + 20}>{formatRulerDistance(cumulativeDistanceMeters(points))}</text>;
    })()}
  </g>;
}
