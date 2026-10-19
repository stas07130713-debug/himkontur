import { useState } from 'react';
import type { GeoPoint } from '../core/types';
import type { DistrictBuilding } from './district-map-model';
import { buildingPrefix } from './district-map-model';

type ScreenPoint = Readonly<{ x: number; y: number }>;
type Project = (point: GeoPoint) => ScreenPoint;

function edgeDistanceMeters(start: GeoPoint, end: GeoPoint): number {
  const radians = Math.PI / 180;
  const firstLatitude = start.latitude * radians;
  const secondLatitude = end.latitude * radians;
  const latitudeDelta = (end.latitude - start.latitude) * radians;
  const longitudeDelta = (end.longitude - start.longitude) * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function distanceLabel(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters)} м`;
  return `${(meters / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} км`;
}

function readableLineAngle(start: ScreenPoint, end: ScreenPoint): number {
  let angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

/** Construction points on one straight wall are ignored for measurement. */
function logicalCorners(points: readonly GeoPoint[]): readonly GeoPoint[] {
  if (points.length <= 3) return points;
  const latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitudeScale = Math.cos(latitude * Math.PI / 180);
  const corners = points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    if (previous === undefined || next === undefined) return true;
    const first = { x: (point.longitude - previous.longitude) * longitudeScale, y: point.latitude - previous.latitude };
    const second = { x: (next.longitude - point.longitude) * longitudeScale, y: next.latitude - point.latitude };
    const firstLength = Math.hypot(first.x, first.y);
    const secondLength = Math.hypot(second.x, second.y);
    if (firstLength < 1e-10 || secondLength < 1e-10) return false;
    const turn = Math.abs(Math.atan2(first.x * second.y - first.y * second.x, first.x * second.x + first.y * second.y)) * 180 / Math.PI;
    return turn >= 6;
  });
  return corners.length >= 3 ? corners : points;
}

export function DistrictObjectContour({ object, project, selected = false, highlighted = false, interactionDisabled = false, onSelect, onHoverChange }: Readonly<{
  object: DistrictBuilding;
  project: Project;
  selected?: boolean;
  highlighted?: boolean;
  interactionDisabled?: boolean;
  onSelect?: () => void;
  onHoverChange?: (hovered: boolean) => void;
}>) {
  const [hovered, setHovered] = useState(false);
  const [hoveredWall, setHoveredWall] = useState<number | null>(null);
  const responseBoundary = object.mapRole === 'response-boundary';
  if (object.contour.length < (responseBoundary ? 2 : 3)) return null;
  const contourPoints = object.contour.map((point) => {
    const projected = project(point);
    return `${projected.x},${projected.y}`;
  }).join(' ');
  const corners = responseBoundary ? object.contour : logicalCorners(object.contour);
  const walls = corners.map((start, index) => {
    const end = responseBoundary ? corners[index + 1] : corners[(index + 1) % corners.length];
    if (end === undefined) return null;
    return { start, end, projectedStart: project(start), projectedEnd: project(end) };
  }).filter((wall): wall is NonNullable<typeof wall> => wall !== null);
  const wall = hoveredWall === null ? null : walls[hoveredWall] ?? null;
  const roleClass = responseBoundary
    ? ' response-boundary'
    : object.mapRole === 'rescue-service'
      ? ' rescue-service'
      : '';
  return <g
    className={`district-object-contour-group${interactionDisabled ? ' interaction-disabled' : ''}`}
    onPointerEnter={() => { if (!interactionDisabled) { setHovered(true); onHoverChange?.(true); } }}
    onPointerLeave={() => { setHovered(false); setHoveredWall(null); onHoverChange?.(false); }}
  >
    {responseBoundary
      ? <polyline
          points={contourPoints}
          className={`district-object-contour prefix-${buildingPrefix(object.number)} territory${roleClass}${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}${highlighted ? ' search-highlight' : ''}`}
          onClick={(event) => { if (!interactionDisabled) { event.stopPropagation(); onSelect?.(); } }}
        />
      : <polygon
          points={contourPoints}
          className={`district-object-contour prefix-${buildingPrefix(object.number)}${object.objectType === 'territory' || buildingPrefix(object.number) === '0' ? ' territory' : ''}${roleClass}${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}${highlighted ? ' search-highlight' : ''}`}
          onClick={(event) => { if (!interactionDisabled) { event.stopPropagation(); onSelect?.(); } }}
          onPointerDown={(event) => { if (!interactionDisabled && event.button === 0) event.stopPropagation(); }}
        />}
    {walls.map((edge, index) => <line
      key={`measure-${index}`}
      className="district-contour-edge-measure"
      x1={edge.projectedStart.x}
      y1={edge.projectedStart.y}
      x2={edge.projectedEnd.x}
      y2={edge.projectedEnd.y}
      onPointerEnter={() => { if (!interactionDisabled) setHoveredWall(index); }}
      onPointerLeave={() => setHoveredWall((current) => current === index ? null : current)}
      onClick={(event) => { if (!interactionDisabled) { event.stopPropagation(); onSelect?.(); } }}
      onPointerDown={(event) => { if (!interactionDisabled && event.button === 0) event.stopPropagation(); }}
    />)}
    {wall !== null && <text
      className="district-contour-length-label"
      x="0"
      y="-7"
      textAnchor="middle"
      transform={`translate(${(wall.projectedStart.x + wall.projectedEnd.x) / 2} ${(wall.projectedStart.y + wall.projectedEnd.y) / 2}) rotate(${readableLineAngle(wall.projectedStart, wall.projectedEnd)})`}
    >{distanceLabel(edgeDistanceMeters(wall.start, wall.end))}</text>}
  </g>;
}
