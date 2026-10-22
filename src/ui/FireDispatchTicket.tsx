import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoPoint } from '../core/types';
import { distanceMeters, formatRulerDistance } from './map-ruler';
import type { Basemap } from './MapCanvas';
import type { DistrictBuilding, DistrictFireReservoir, DistrictHydrant, DistrictMapObject, DistrictPlanningDocument } from './district-map-model';
import { hydrantNetworkCode } from './district-map-model';
import { buildingPrefix } from './district-map-model';
import { fittedBuildingMarkerScale } from './district-map-visuals';
import { OfflineBasemap } from './OfflineBasemap';
import { UiIcon } from './UiIcon';
import { CompassRose } from './CompassRose';
import { canChooseDispatchPdfDirectory, captureDispatchSnapshot, createDispatchPdf, prepareDispatchPdfDirectory, printDispatchSnapshot, saveDispatchPdf, warmDispatchExport } from './dispatch-pdf';

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 680;
const BUILDING_TARGET_WIDTH_RATIO = .68;
const BUILDING_TARGET_HEIGHT_RATIO = .62;
const REQUIRED_SOURCE_PADDING_X = 78;
const REQUIRED_SOURCE_PADDING_Y = 38;
const EARTH_RADIUS_M = 6_371_000;

type WaterSource = DistrictHydrant | DistrictFireReservoir;
type ScreenPoint = Readonly<{ x: number; y: number }>;

const EMERGENCY_TYPES = [
  'Сработка АПС',
  'Пожар',
  'Задымление',
  'Взрыв',
  'Разлив или выброс опасного вещества',
  'Авария на технологическом оборудовании',
  'Обрушение конструкции',
  'Другое',
] as const;

const DISPATCHER_HISTORY_KEY = 'himkontur-dispatcher-history';

function loadDispatcherHistory(): readonly string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(DISPATCHER_HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function EmergencyTypeField({ value, onChange }: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return <div className={`fire-dispatch-emergency-combobox${open ? ' open' : ''}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <div className="fire-dispatch-emergency-control">
      <input ref={inputRef}
        role="combobox"
        aria-label="2. Вид происшествия (характер ЧС)"
        aria-autocomplete="list"
        aria-expanded={open}
        value={value}
        placeholder="Выберите или введите свой вариант"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
      />
      <button type="button" aria-label={open ? 'Закрыть список' : 'Открыть полный список'} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((current) => !current)}><span aria-hidden="true" /></button>
    </div>
    {open && <div className="fire-dispatch-emergency-options" role="listbox">
      {EMERGENCY_TYPES.map((option) => <button type="button" role="option" aria-selected={option === value} key={option} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        if (option === 'Другое') {
          onChange('');
          setOpen(false);
          window.setTimeout(() => inputRef.current?.focus());
          return;
        }
        onChange(option);
        setOpen(false);
      }}>{option}</button>)}
    </div>}
  </div>;
}

function dispatchObjectShortName(building: DistrictBuilding): string {
  const parts = [
    building.mapRole === 'rescue-service' ? 'АСС' : building.number,
    building.workshopShort,
    ...building.departments.map((unit) => unit.shortName),
    ...building.sites.map((unit) => unit.shortName),
  ].map((part) => part.trim()).filter(Boolean);
  return [...new Set(parts)].join(' ');
}

function dispatchFilename(date: string, building: DistrictBuilding, emergencyType: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  const visibleDate = day !== '' && month !== '' && year !== '' ? `${day}.${month}.${year}` : date;
  const emergency = emergencyType.trim() || 'Характер ЧС не указан';
  const raw = `${visibleDate} ${dispatchObjectShortName(building)} (${emergency}).pdf`;
  return raw.replaceAll(/[\\/:*?"<>|]/gu, '_').replace(/[. ]+$/u, '').slice(0, 190) + (raw.length > 190 ? '.pdf' : '');
}

function worldCoordinate(point: GeoPoint): ScreenPoint {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.latitude)) * Math.PI / 180;
  return {
    x: (point.longitude + 180) / 360,
    y: (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2,
  };
}

function geoFromWorld(point: ScreenPoint): GeoPoint {
  return {
    longitude: point.x * 360 - 180,
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y))) * 180 / Math.PI,
  };
}

function closestPointOnContour(source: GeoPoint, contour: readonly GeoPoint[]): Readonly<{ point: GeoPoint; distanceM: number }> {
  if (contour.length < 2) return { point: contour[0] ?? source, distanceM: 0 };
  const latitudeScale = Math.PI / 180 * EARTH_RADIUS_M;
  const longitudeScale = latitudeScale * Math.cos(source.latitude * Math.PI / 180);
  const toLocal = (point: GeoPoint) => ({
    x: (point.longitude - source.longitude) * longitudeScale,
    y: (point.latitude - source.latitude) * latitudeScale,
  });
  let bestPoint = contour[0] ?? source;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < contour.length; index += 1) {
    const startGeo = contour[index];
    const endGeo = contour[(index + 1) % contour.length];
    if (startGeo === undefined || endGeo === undefined) continue;
    const start = toLocal(startGeo);
    const end = toLocal(endGeo);
    const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
    const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(start.x * (end.x - start.x) + start.y * (end.y - start.y)) / lengthSquared));
    const x = start.x + (end.x - start.x) * projection;
    const y = start.y + (end.y - start.y) * projection;
    const distance = Math.hypot(x, y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPoint = {
        longitude: source.longitude + x / longitudeScale,
        latitude: source.latitude + y / latitudeScale,
      };
    }
  }
  return { point: bestPoint, distanceM: bestDistance };
}

function sourceLabel(source: WaterSource): string {
  const number = source.number.trim();
  if (source.kind === 'hydrant') return /^пг[-\s]/iu.test(number) ? number : `ПГ-${number}`;
  return /^пв[-\s]/iu.test(number) ? number : `ПВ-${number}`;
}

function buildingAddress(building: DistrictBuilding): string {
  const parts = [
    building.mapRole === 'rescue-service' ? 'Аварийно-спасательная служба' : `Здание № ${building.number}`,
    building.workshopFull,
    ...building.departments.map((unit) => unit.fullName),
    ...building.sites.map((unit) => unit.fullName),
  ].map((part) => part.trim()).filter(Boolean);
  return [...new Set(parts)].join(', ');
}

function planningDocumentText(document: DistrictPlanningDocument): string {
  const number = document.number.trim();
  const withoutKind = number.toLocaleUpperCase('ru-RU').startsWith(document.kind)
    ? number.slice(document.kind.length).replace(/^[\s№#:-]+/u, '').trim()
    : number;
  return `${document.kind} № ${withoutKind || number}`;
}

function localDateAndTime(): Readonly<{ date: string; time: string }> {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  const local = new Date(now.getTime() - offset).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function fitMap(buildingPoints: readonly GeoPoint[], requiredSourcePoints: readonly GeoPoint[]): Readonly<{ center: GeoPoint; zoom: number; project: (point: GeoPoint) => ScreenPoint }> {
  const buildingWorlds = buildingPoints.map(worldCoordinate);
  const requiredWorlds = [...buildingWorlds, ...requiredSourcePoints.map(worldCoordinate)];
  const bounds = (points: readonly Readonly<{ x: number; y: number }>[]) => ({
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  });
  const buildingBounds = bounds(buildingWorlds);
  const requiredBounds = bounds(requiredWorlds);
  const zoomForBounds = (
    current: ReturnType<typeof bounds>,
    availableWidth: number,
    availableHeight: number,
  ) => Math.log2(Math.min(
    availableWidth / (Math.max(current.maxX - current.minX, 1e-8) * 512),
    availableHeight / (Math.max(current.maxY - current.minY, 1e-8) * 512),
  ));
  // The contour has a maximum visual share of the scheme, while the second
  // bound guarantees that all three required water-source symbols stay inside
  // the frame. Small objects therefore remain readable and large objects can
  // never be cropped by a fixed zoom increment.
  const buildingZoom = zoomForBounds(
    buildingBounds,
    MAP_WIDTH * BUILDING_TARGET_WIDTH_RATIO,
    MAP_HEIGHT * BUILDING_TARGET_HEIGHT_RATIO,
  );
  const requiredZoom = zoomForBounds(
    requiredBounds,
    MAP_WIDTH - REQUIRED_SOURCE_PADDING_X * 2,
    MAP_HEIGHT - REQUIRED_SOURCE_PADDING_Y * 2,
  );
  const zoom = Math.max(12, Math.min(20.5, buildingZoom, requiredZoom));
  const worldPixels = 512 * 2 ** zoom;
  const buildingCenter = {
    x: (buildingBounds.minX + buildingBounds.maxX) / 2,
    y: (buildingBounds.minY + buildingBounds.maxY) / 2,
  };
  const centerInterval = (min: number, max: number, size: number, padding: number) => ({
    min: max - (size / 2 - padding) / worldPixels,
    max: min + (size / 2 - padding) / worldPixels,
  });
  const xInterval = centerInterval(requiredBounds.minX, requiredBounds.maxX, MAP_WIDTH, REQUIRED_SOURCE_PADDING_X);
  const yInterval = centerInterval(requiredBounds.minY, requiredBounds.maxY, MAP_HEIGHT, REQUIRED_SOURCE_PADDING_Y);
  const centerWorld = {
    x: Math.max(xInterval.min, Math.min(xInterval.max, buildingCenter.x)),
    y: Math.max(yInterval.min, Math.min(yInterval.max, buildingCenter.y)),
  };
  return {
    center: geoFromWorld(centerWorld),
    zoom,
    project: (point) => {
      const world = worldCoordinate(point);
      return {
        x: MAP_WIDTH / 2 + (world.x - centerWorld.x) * worldPixels,
        y: MAP_HEIGHT / 2 + (world.y - centerWorld.y) * worldPixels,
      };
    },
  };
}

type EdgeLabel = Readonly<{
  key: string;
  x: number;
  y: number;
  text: string;
  angle: number;
}>;

type LabelBox = Readonly<{ left: number; top: number; right: number; bottom: number }>;

function readableLineAngle(start: ScreenPoint, end: ScreenPoint): number {
  let angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

function boxAt(point: ScreenPoint, width: number, height: number): LabelBox {
  return { left: point.x - width / 2, right: point.x + width / 2, top: point.y - height / 2, bottom: point.y + height / 2 };
}

function rotatedBoxAt(point: ScreenPoint, width: number, height: number, angle: number): LabelBox {
  const radians = angle * Math.PI / 180;
  const halfWidth = Math.abs(Math.cos(radians)) * width / 2 + Math.abs(Math.sin(radians)) * height / 2;
  const halfHeight = Math.abs(Math.sin(radians)) * width / 2 + Math.abs(Math.cos(radians)) * height / 2;
  return { left: point.x - halfWidth, right: point.x + halfWidth, top: point.y - halfHeight, bottom: point.y + halfHeight };
}

function overlapArea(first: LabelBox, second: LabelBox, padding = 4): number {
  return Math.max(0, Math.min(first.right, second.right + padding) - Math.max(first.left, second.left - padding))
    * Math.max(0, Math.min(first.bottom, second.bottom + padding) - Math.max(first.top, second.top - padding));
}

function boxesOverlap(first: LabelBox, second: LabelBox, padding = 4): boolean {
  return first.left < second.right + padding && first.right > second.left - padding && first.top < second.bottom + padding && first.bottom > second.top - padding;
}

function edgeLabels(
  contour: readonly GeoPoint[],
  project: (point: GeoPoint) => ScreenPoint,
  fixedObstacles: readonly LabelBox[],
): readonly EdgeLabel[] {
  // Every physical wall keeps its own dimension. Labels may move to the
  // inside or outside of that wall, but neighbouring short walls are never
  // merged into one value.
  const measured = contour;
  const projected = measured.map(project);
  const center = projected.reduce<{ x: number; y: number }>((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= Math.max(1, projected.length);
  center.y /= Math.max(1, projected.length);
  const edgeMetrics = measured.map((point, index) => {
    const start = projected[index] ?? { x: 0, y: 0 };
    const end = projected[(index + 1) % projected.length] ?? start;
    const length = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
    const distance = distanceMeters(point, measured[(index + 1) % measured.length] ?? point);
    const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const normal = { x: -direction.y, y: direction.x };
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const outward = ((midpoint.x - center.x) * normal.x + (midpoint.y - center.y) * normal.y) >= 0
      ? normal
      : { x: -normal.x, y: -normal.y };
    return {
      index,
      distance,
      displayDistance: distance,
      hidden: false,
      direction,
      outward,
      midpoint,
    };
  });
  const entries = edgeMetrics.filter((edge) => !edge.hidden && edge.displayDistance >= .5).sort((left, right) => right.displayDistance - left.displayDistance).flatMap(({ index, displayDistance: distance }) => {
    const start = projected[index];
    const end = projected[(index + 1) % projected.length];
    if (start === undefined || end === undefined) return [];
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const firstNormal = { x: -dy / length, y: dx / length };
    const outward = ((midpoint.x - center.x) * firstNormal.x + (midpoint.y - center.y) * firstNormal.y) >= 0
      ? firstNormal
      : { x: -firstNormal.x, y: -firstNormal.y };
    const tangent = { x: dx / length, y: dy / length };
    const text = formatRulerDistance(distance);
    const labelWidth = Math.max(32, text.length * 7.8);
    const labelHeight = 16;
    const angle = readableLineAngle(start, end);
    // A dimension must remain visually attached to its wall. Collision
    // resolution may flip it to the other side or tighten the offset, but it
    // must never drift along the tangent or far away from the measured edge.
    const offsets = [8, 12, 16, 20, 24, 28, 32];
    const shortShift = Math.min(12, length * .18);
    const longShift = Math.min(60, length * .42);
    const shifts = [0, -shortShift, shortShift, -longShift, longShift];
    const candidates = [
      ...offsets.flatMap((offset) => shifts.map((shift) => ({
        offset: offset + Math.abs(shift) * .2,
        point: { x: midpoint.x + outward.x * offset + tangent.x * shift, y: midpoint.y + outward.y * offset + tangent.y * shift },
      }))),
      ...offsets.flatMap((offset) => shifts.map((shift) => ({
        offset: offset + Math.abs(shift) * .2 + 1,
        point: { x: midpoint.x - outward.x * offset + tangent.x * shift, y: midpoint.y - outward.y * offset + tangent.y * shift },
      }))),
    ].map((candidate) => ({ ...candidate, box: rotatedBoxAt(candidate.point, labelWidth, labelHeight, angle) }));
    return [{ index, text, angle, candidates }];
  });
  const occupied: LabelBox[] = [];
  return entries.flatMap((entry) => {
    const candidateScore = (candidate: (typeof entry.candidates)[number]): number => {
      const outside = Math.max(0, 5 - candidate.box.left) + Math.max(0, candidate.box.right - MAP_WIDTH + 5)
        + Math.max(0, 5 - candidate.box.top) + Math.max(0, candidate.box.bottom - MAP_HEIGHT + 5);
      const fixedCollision = fixedObstacles.reduce((sum, obstacle) => sum + overlapArea(candidate.box, obstacle), 0);
      const labelCollision = occupied.reduce((sum, obstacle) => sum + overlapArea(candidate.box, obstacle), 0);
      return outside * 1_000_000 + labelCollision * 100_000 + fixedCollision * 1_000 + candidate.offset;
    };
    const first = entry.candidates[0];
    if (first === undefined) return [];
    const selected = entry.candidates.reduce((best, candidate) => candidateScore(candidate) < candidateScore(best) ? candidate : best, first);
    occupied.push(selected.box);
    const point = selected.point;
    return [{
      key: `edge-${entry.index}`,
      x: Math.max(22, Math.min(MAP_WIDTH - 22, point.x)),
      y: Math.max(16, Math.min(MAP_HEIGHT - 16, point.y)),
      text: entry.text,
      angle: entry.angle,
    }];
  });
}

function DispatchMap({ building, objects, basemap }: Readonly<{ building: DistrictBuilding; objects: readonly DistrictMapObject[]; basemap: Basemap }>) {
  const [mapProjector, setMapProjector] = useState<((point: GeoPoint) => ScreenPoint) | null>(null);
  const dispatchSelection = useMemo(() => {
    const ranked = objects
      .filter((object): object is WaterSource => object.kind === 'hydrant' || object.kind === 'reservoir')
      .map((source) => ({ source, target: closestPointOnContour(source.point, building.contour) }))
      .sort((left, right) => left.target.distanceM - right.target.distanceM);
    const nearestServiceable = ranked.filter(({ source }) => source.status === 'serviceable').slice(0, 3);
    // The three nearest serviceable sources define a stable, readable crop. Once that crop is
    // known, also show every other source that physically falls inside it instead
    // of silently omitting faulty or disabled hydrants visible on the same fragment.
    const requiredSourcePoints = nearestServiceable.map(({ source }) => source.point);
    const fitPoints = [...building.contour, building.point, ...requiredSourcePoints];
    const projection = fitMap([...building.contour, building.point], requiredSourcePoints);
    return { ranked, nearestServiceable, fitPoints, projection };
  }, [building, objects]);
  const { ranked, nearestServiceable, fitPoints, projection } = dispatchSelection;
  const receiveProjector = useCallback((projector: ((point: GeoPoint) => ScreenPoint) | null) => {
    setMapProjector(() => projector === null ? null : (point: GeoPoint) => {
      const normalized = projector(point);
      return { x: normalized.x * MAP_WIDTH, y: normalized.y * MAP_HEIGHT };
    });
  }, []);
  const project = mapProjector ?? projection.project;
  const sources = useMemo(() => {
    const linkedIds = new Set(nearestServiceable.map(({ source }) => source.id));
    const visible = ranked.filter((entry) => {
      const point = project(entry.source.point);
      return linkedIds.has(entry.source.id)
        || (point.x >= 0 && point.x <= MAP_WIDTH && point.y >= 0 && point.y <= MAP_HEIGHT);
    });
    const selected = visible.filter(({ source }) => linkedIds.has(source.id));
    const occupied = selected.map(({ source }) => boxAt(project(source.point), source.kind === 'hydrant' ? 132 : 104, 44));
    visible.filter(({ source }) => !linkedIds.has(source.id)).forEach((entry) => {
      const box = boxAt(project(entry.source.point), entry.source.kind === 'hydrant' ? 132 : 104, 44);
      const fullyInside = box.left >= 4 && box.right <= MAP_WIDTH - 4 && box.top >= 4 && box.bottom <= MAP_HEIGHT - 4;
      if (fullyInside && occupied.every((current) => !boxesOverlap(box, current, 5))) {
        selected.push(entry);
        occupied.push(box);
      }
    });
    return selected;
  }, [nearestServiceable, project, ranked]);
  const contour = building.contour.map((point) => {
    const screen = project(point);
    return `${screen.x},${screen.y}`;
  }).join(' ');
  const buildingPoint = project(building.point);
  const markerScale = fittedBuildingMarkerScale(building, 1, project);
  // The hydrant badge is wider than the symbol itself. Keep a generous safety
  // area around every visible source so a distance label can never sit on top
  // of the «ПГ-… / К-…» plates.
  const markerObstacles = sources.map(({ source }) => boxAt(project(source.point), source.kind === 'hydrant' ? 132 : 104, 44));
  const fixedObstacles = [
    ...markerObstacles,
    boxAt(buildingPoint, 64, 40),
    { left: MAP_WIDTH - 105, top: 0, right: MAP_WIDTH, bottom: 105 },
  ];
  const labels = edgeLabels(building.contour, project, fixedObstacles);
  const dimensionObstacles = labels.map((label) => rotatedBoxAt(
    { x: label.x, y: label.y },
    Math.max(32, label.text.length * 7.8),
    16,
    label.angle,
  ));
  const waterLabelObstacles: LabelBox[] = [];
  // The three nearest serviceable sources always receive a route distance.
  // Additional sources are shown only where their standard horizontal plates
  // have enough room, keeping the printed fragment readable without scaling.
  const waterLinks = nearestServiceable.map(({ source, target }) => {
    const from = project(source.point);
    const targetPoint = project(target.point);
    const dx = targetPoint.x - from.x;
    const dy = targetPoint.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const to = { x: targetPoint.x - dx / length * 5, y: targetPoint.y - dy / length * 5 };
    const rawNormal = { x: -dy / length, y: dx / length };
    const normal = rawNormal.y > 0 || (Math.abs(rawNormal.y) < .001 && rawNormal.x < 0)
      ? { x: -rawNormal.x, y: -rawNormal.y }
      : rawNormal;
    const text = formatRulerDistance(target.distanceM);
    const candidates: ScreenPoint[] = [];
    for (const fraction of [.5, .62, .38, .72, .28]) {
      for (const offset of [9, -9, 12, -12]) {
        candidates.push({ x: from.x + (to.x - from.x) * fraction + normal.x * offset, y: from.y + (to.y - from.y) * fraction + normal.y * offset });
      }
    }
    const width = Math.max(40, text.length * 9);
    const label = candidates.find((candidate) => {
      const candidateBox = boxAt(candidate, width, 20);
      return candidateBox.left > 5 && candidateBox.right < MAP_WIDTH - 5 && candidateBox.top > 5 && candidateBox.bottom < MAP_HEIGHT - 5
        && markerObstacles.every((box) => !boxesOverlap(candidateBox, box))
        && dimensionObstacles.every((box) => !boxesOverlap(candidateBox, box))
        && waterLabelObstacles.every((box) => !boxesOverlap(candidateBox, box));
    }) ?? candidates[0] ?? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    waterLabelObstacles.push(boxAt(label, width, 20));
    return { source, from, to, label, text, angle: readableLineAngle(from, to) };
  });
  const resolvedWaterLabelObstacles: LabelBox[] = [];
  const displayedWaterLinks = waterLinks.map((link) => {
    const width = Math.max(40, link.text.length * 9);
    const originalBox = boxAt(link.label, width, 20);
    if (dimensionObstacles.every((box) => !boxesOverlap(originalBox, box))) {
      resolvedWaterLabelObstacles.push(originalBox);
      return link;
    }
    const dx = link.to.x - link.from.x;
    const dy = link.to.y - link.from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normal = { x: -dy / length, y: dx / length };
    const candidates: ScreenPoint[] = [];
    for (const fraction of [.5, .62, .38, .72, .28, .82, .18]) {
      for (const offset of [9, -9, 16, -16, 24, -24]) {
        candidates.push({
          x: link.from.x + dx * fraction + normal.x * offset,
          y: link.from.y + dy * fraction + normal.y * offset,
        });
      }
    }
    const label = candidates.find((candidate) => {
      const candidateBox = boxAt(candidate, width, 20);
      return candidateBox.left > 5 && candidateBox.right < MAP_WIDTH - 5 && candidateBox.top > 5 && candidateBox.bottom < MAP_HEIGHT - 5
        && markerObstacles.every((box) => !boxesOverlap(candidateBox, box))
        && dimensionObstacles.every((box) => !boxesOverlap(candidateBox, box))
        && resolvedWaterLabelObstacles.every((box) => !boxesOverlap(candidateBox, box));
    }) ?? link.label;
    resolvedWaterLabelObstacles.push(boxAt(label, width, 20));
    return { ...link, label };
  });
  return <>
    <h3 className="fire-dispatch-map-heading">Схема объекта и ближайших водоисточников</h3>
    <div className="fire-dispatch-map" aria-label="Схема объекта и ближайших водоисточников">
    <OfflineBasemap
      center={projection.center}
      zoom={projection.zoom}
      basemap={basemap}
      fitPoints={fitPoints}
      fitPaddingRatio={.11}
      fitPrimaryPoints={building.contour}
      fitPrimaryWidthRatio={BUILDING_TARGET_WIDTH_RATIO}
      fitPrimaryHeightRatio={BUILDING_TARGET_HEIGHT_RATIO}
      onProjectorReady={receiveProjector}
    />
    <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label={`Объект ${building.number} и водоисточники в пределах схемы`}>
      <defs>
        <marker id="dispatch-water-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path className="fire-dispatch-water-arrow" d="M0,0 L0,6 L7,3 z" /></marker>
      </defs>
      {displayedWaterLinks.map(({ source, from, to, label, text, angle }) => {
        return <g key={source.id} className="fire-dispatch-water-link">
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#dispatch-water-arrow)" />
          <text x="0" y="0" transform={`translate(${label.x} ${label.y}) rotate(${angle})`} textAnchor="middle" dominantBaseline="middle">{text}</text>
        </g>;
      })}
      <polygon points={contour} className={`fire-dispatch-building-contour prefix-${buildingPrefix(building.number)}`} />
      {labels.map((label) => <text key={label.key} className="fire-dispatch-edge-label" x="0" y="0" transform={`translate(${label.x} ${label.y}) rotate(${label.angle})`} textAnchor="middle" dominantBaseline="middle">{label.text}</text>)}
      <g className={`fire-dispatch-building-label building-number-marker prefix-${buildingPrefix(building.number)}`} transform={`translate(${buildingPoint.x} ${buildingPoint.y})`}><g transform={`scale(${markerScale})`}><path d="M-21-13h42v26h-42z" /><text x="0" y="5" textAnchor="middle">{building.number}</text></g></g>
      {sources.map(({ source }) => {
        const point = project(source.point);
        return <g key={`marker-${source.id}`} className={`fire-dispatch-water-marker ${source.kind}`} transform={`translate(${point.x} ${point.y})`}>
          {source.kind === 'hydrant' ? <g className={`fire-dispatch-hydrant-symbol status-${source.status}`}>
            <line className="hydrant-network-line" x1="-57" y1="0" x2="57" y2="0" />
            <rect className="hydrant-label-back" x="-63" y="-19" width="49" height="16" rx="3" />
            <rect className="hydrant-label-back" x="14" y="-19" width="49" height="16" rx="3" />
            <text className="hydrant-map-label" x="-38.5" y="-7" textAnchor="middle">{sourceLabel(source)}</text>
            <text className="hydrant-map-label" x="38.5" y="-7" textAnchor="middle">{hydrantNetworkCode(source)}</text>
            <circle className="hydrant-symbol-base" r="12" />
            <path className="hydrant-symbol-half" d="M0-12A12 12 0 0 1 0 12Z" />
            <circle className="hydrant-symbol-outline" r="12" />
          </g> : <g className={`fire-dispatch-reservoir-symbol status-${source.status}`}><rect x="-15" y="-15" width="30" height="30" rx="3" /><text textAnchor="middle" dominantBaseline="middle">ПВ</text><text className="fire-dispatch-reservoir-label" x="20" y="-11">{sourceLabel(source)}</text></g>}
        </g>;
      })}
    </svg>
    <CompassRose className="fire-dispatch-standard-compass" />
  </div></>;
}

export function FireDispatchTicket({ building, objects, basemap, onClose }: Readonly<{
  building: DistrictBuilding;
  objects: readonly DistrictMapObject[];
  basemap: Basemap;
  onClose: () => void;
}>) {
  const sheetRef = useRef<HTMLElement>(null);
  const [mobileMapOnly, setMobileMapOnly] = useState(() => window.matchMedia('(max-width: 720px)').matches);
  const initial = localDateAndTime();
  const [division, setDivision] = useState('МВАСО АСС');
  const [crew, setCrew] = useState('');
  const [place, setPlace] = useState(buildingAddress(building));
  const [emergencyType, setEmergencyType] = useState('');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [applicantName, setApplicantName] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [dispatcher, setDispatcher] = useState('');
  const [dispatcherSuggestions, setDispatcherSuggestions] = useState<readonly string[]>(loadDispatcherHistory);
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const rememberDispatcher = useCallback(() => {
    const value = dispatcher.trim();
    if (value === '') return;
    const next = [value, ...dispatcherSuggestions.filter((item) => item.toLocaleLowerCase('ru-RU') !== value.toLocaleLowerCase('ru-RU'))].slice(0, 20);
    setDispatcherSuggestions(next);
    window.localStorage.setItem(DISPATCHER_HISTORY_KEY, JSON.stringify(next));
  }, [dispatcher, dispatcherSuggestions]);
  useEffect(() => {
    warmDispatchExport();
    const media = window.matchMedia('(max-width: 720px)');
    const update = () => setMobileMapOnly(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const print = async () => {
    if (busy || sheetRef.current === null) return;
    setBusy(true);
    setSaveStatus('Подготавливается печать…');
    try {
      const imageDataUrl = await captureDispatchSnapshot(sheetRef.current, { scale: 1.1 });
      setSaveStatus('Открывается окно печати…');
      printDispatchSnapshot(imageDataUrl);
    } catch (error) {
      setSaveStatus(error instanceof Error ? `Не удалось подготовить печать: ${error.message}` : 'Не удалось подготовить печать.');
    } finally {
      setBusy(false);
    }
  };
  const savePdf = async () => {
    if (busy || sheetRef.current === null) return;
    setBusy(true);
    setSaveStatus('Подготавливается папка…');
    try {
      const selectedDirectory = await prepareDispatchPdfDirectory();
      if (canChooseDispatchPdfDirectory() && selectedDirectory === null) {
        setSaveStatus('Сохранение отменено: папка не выбрана.');
        return;
      }
      setSaveStatus('Формируется PDF…');
      const imageDataUrl = await captureDispatchSnapshot(sheetRef.current, { scale: mobileMapOnly ? 1.2 : 1.35 });
      const pdf = await createDispatchPdf(imageDataUrl);
      const location = await saveDispatchPdf(pdf, dispatchFilename(date, building, emergencyType), false);
      setSaveStatus(`PDF сохранён: ${location}`);
    } catch (error) {
      setSaveStatus(error instanceof Error ? `Не удалось сохранить PDF: ${error.message}` : 'Не удалось сохранить PDF.');
    } finally {
      setBusy(false);
    }
  };
  const planningDocuments = building.planningDocuments.filter((document) => document.number.trim() !== '');
  return <div className="dialog-backdrop fire-dispatch-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="fire-dispatch-ticket-dialog" role="dialog" aria-modal="true" aria-labelledby={mobileMapOnly ? undefined : 'fire-dispatch-ticket-title'} aria-label={mobileMapOnly ? 'Схема объекта и водоисточников' : undefined}>
      <div className="fire-dispatch-screen-actions">
        {saveStatus !== '' && <span className="fire-dispatch-save-status" role="status">{saveStatus}</span>}
        {!mobileMapOnly && <button type="button" className="primary" disabled={busy} onClick={() => { void print(); }}>{busy ? 'Подождите…' : 'Распечатать'}</button>}
        <button type="button" className="secondary" disabled={busy} onClick={() => { void savePdf(); }}>{mobileMapOnly ? 'Сохранить схему PDF' : 'Загрузить PDF в папку'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}><UiIcon name="close" /> Закрыть</button>
      </div>
      <article className={`fire-dispatch-ticket-sheet${mobileMapOnly ? ' mobile-map-only' : ''}`} ref={sheetRef}>
        {!mobileMapOnly && <><header>
          <h1 id="fire-dispatch-ticket-title">ПУТЁВКА</h1>
          <h2>для выезда профессионального аварийно-спасательного формирования</h2>
          <div className="fire-dispatch-row division-row"><label data-complete={division.trim() !== ''}>Подразделение<input value={division} onChange={(event) => setDivision(event.currentTarget.value)} /></label><label data-complete={crew.trim() !== ''}>Дежурное отделение<select value={crew} onChange={(event) => setCrew(event.currentTarget.value)}><option value="">Указать отделение</option><option value="1-е отделение">1-е отделение</option><option value="2-е отделение">2-е отделение</option><option value="3-е отделение">3-е отделение</option><option value="4-е отделение">4-е отделение</option></select></label></div>
        </header>
        <div className="fire-dispatch-form">
          <label data-complete={place.trim() !== ''}><span>1. Место выезда, адрес</span><textarea rows={2} value={place} onChange={(event) => setPlace(event.currentTarget.value)} /></label>
          <label data-complete={emergencyType.trim() !== ''}><span>2. Вид происшествия (характер ЧС)</span><EmergencyTypeField value={emergencyType} onChange={setEmergencyType} /></label>
          <div className="fire-dispatch-row">
            <label data-complete={date.trim() !== ''}><span>3. Дата сообщения</span><input type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} /></label>
            <label data-complete={time.trim() !== ''}><span>Время получения сообщения</span><input type="time" value={time} onChange={(event) => setTime(event.currentTarget.value)} /></label>
          </div>
          <div className="fire-dispatch-row applicant">
            <label data-complete={applicantName.trim() !== ''}><span>4. Фамилия, имя, отчество заявителя (Фамилия И.О.)</span><input value={applicantName} placeholder="Фамилия И.О." onChange={(event) => setApplicantName(event.currentTarget.value)} /></label>
            <label data-complete={applicantPhone.trim() !== ''}><span>Номер телефона</span><input type="tel" value={applicantPhone} onChange={(event) => setApplicantPhone(event.currentTarget.value)} /></label>
          </div>
          <div className="fire-dispatch-row dispatcher"><label data-complete={dispatcher.trim() !== ''}><span>5. Дежурный диспетчер подразделения (Фамилия И.О.)</span><input value={dispatcher} list="fire-dispatch-dispatchers" placeholder="Фамилия И.О." autoComplete="off" onBlur={rememberDispatcher} onChange={(event) => setDispatcher(event.currentTarget.value)} /><datalist id="fire-dispatch-dispatchers">{dispatcherSuggestions.map((name) => <option value={name} key={name} />)}</datalist></label><label><span>Подпись дежурного диспетчера</span><input aria-label="Подпись дежурного диспетчера" /></label></div>
        </div></>}
        <DispatchMap building={building} objects={objects} basemap={basemap} />
        <section className="fire-dispatch-planning-documents" aria-label="Документы предварительного планирования">
          <strong>Документы предварительного планирования</strong>
          <div>{planningDocuments.length === 0
            ? <span className="empty">На объект не разработаны</span>
            : planningDocuments.map((document, index) => <span key={`${document.kind}-${document.number}-${index}`}>{planningDocumentText(document)}</span>)}</div>
        </section>
        {!mobileMapOnly && <p className="fire-dispatch-verification-note">* Перед выдачей путёвки диспетчер обязан самостоятельно проверить правильность заполнения данных и соответствие схемы выбранному объекту.</p>}
        {!mobileMapOnly && <><section className="fire-dispatch-return-authorization" aria-label="Разрешение на возвращение к месту дислокации">
          <strong>Возвращение на место дислокации РАЗРЕШАЮ</strong>
          <span>Ответственный руководитель по ликвидации аварии:</span>
          <div className="fire-dispatch-hand-fields">
            <span><i />Фамилия И.О.</span>
            <span><i />Должность</span>
            <span><i />Подпись</span>
            <span><i />Время</span>
          </div>
          <div className="fire-dispatch-hand-date">Дата «<i />» <i /> 20<i /> г.</div>
        </section>
        <footer><span>Сформировано системой «ХИМКОНТУР»</span></footer></>}
      </article>
    </section>
  </div>;
}
