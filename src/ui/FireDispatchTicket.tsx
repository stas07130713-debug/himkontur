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
const MAP_PADDING = 110;
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

function EmergencyTypeField({ value, onChange }: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return <div className={`fire-dispatch-emergency-combobox${open ? ' open' : ''}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <div className="fire-dispatch-emergency-control">
      <input ref={inputRef}
        role="combobox"
        aria-label="2. Объект пожара (характер ЧС)"
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

function fitMap(points: readonly GeoPoint[]): Readonly<{ center: GeoPoint; zoom: number; project: (point: GeoPoint) => ScreenPoint }> {
  const worlds = points.map(worldCoordinate);
  const minX = Math.min(...worlds.map((point) => point.x));
  const maxX = Math.max(...worlds.map((point) => point.x));
  const minY = Math.min(...worlds.map((point) => point.y));
  const maxY = Math.max(...worlds.map((point) => point.y));
  const spanX = Math.max(maxX - minX, 1e-8);
  const spanY = Math.max(maxY - minY, 1e-8);
  const zoom = Math.max(12, Math.min(20.5, Math.log2(Math.min(
    (MAP_WIDTH - MAP_PADDING * 2) / (spanX * 512),
    (MAP_HEIGHT - MAP_PADDING * 2) / (spanY * 512),
  ))));
  const centerWorld = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const worldPixels = 512 * 2 ** zoom;
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
type ScreenSegment = Readonly<{ start: ScreenPoint; end: ScreenPoint }>;

function readableLineAngle(start: ScreenPoint, end: ScreenPoint): number {
  let angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

function boxAt(point: ScreenPoint, width: number, height: number): LabelBox {
  return { left: point.x - width / 2, right: point.x + width / 2, top: point.y - height / 2, bottom: point.y + height / 2 };
}

function boxesOverlap(first: LabelBox, second: LabelBox, padding = 4): boolean {
  return first.left < second.right + padding && first.right > second.left - padding && first.top < second.bottom + padding && first.bottom > second.top - padding;
}

function pointToSegmentDistance(point: ScreenPoint, segment: ScreenSegment): number {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const position = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (segment.start.x + dx * position), point.y - (segment.start.y + dy * position));
}

function measurementContour(contour: readonly GeoPoint[]): readonly GeoPoint[] {
  if (contour.length < 4) return contour;
  let current = [...contour];
  let changed = true;
  while (changed && current.length > 3) {
    changed = false;
    const next = current.filter((point, index) => {
      const previous = current[(index - 1 + current.length) % current.length];
      const following = current[(index + 1) % current.length];
      if (previous === undefined || following === undefined) return true;
      const latitudeScale = Math.PI / 180 * EARTH_RADIUS_M;
      const longitudeScale = latitudeScale * Math.cos(point.latitude * Math.PI / 180);
      const first = {
        x: (point.longitude - previous.longitude) * longitudeScale,
        y: (point.latitude - previous.latitude) * latitudeScale,
      };
      const second = {
        x: (following.longitude - point.longitude) * longitudeScale,
        y: (following.latitude - point.latitude) * latitudeScale,
      };
      const firstLength = Math.hypot(first.x, first.y);
      const secondLength = Math.hypot(second.x, second.y);
      if (firstLength < 1.2 || secondLength < 1.2) {
        changed = true;
        return false;
      }
      const cosine = (first.x * second.x + first.y * second.y) / (firstLength * secondLength);
      if (cosine > .985) {
        changed = true;
        return false;
      }
      return true;
    });
    current = next;
  }
  return current;
}

function edgeLabels(
  contour: readonly GeoPoint[],
  project: (point: GeoPoint) => ScreenPoint,
  fixedObstacles: readonly LabelBox[],
  waterSegments: readonly ScreenSegment[],
): readonly EdgeLabel[] {
  const measured = measurementContour(contour);
  const projected = measured.map(project);
  const center = projected.reduce<{ x: number; y: number }>((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= Math.max(1, projected.length);
  center.y /= Math.max(1, projected.length);
  const edgeMetrics = measured.map((point, index) => ({
    index,
    distance: distanceMeters(point, measured[(index + 1) % measured.length] ?? point),
  }));
  const longestEdge = Math.max(0, ...edgeMetrics.map((edge) => edge.distance));
  const minimumVisibleDistance = Math.max(6, longestEdge * .075);
  const placed: EdgeLabel[] = [];
  const occupied = [...fixedObstacles];
  edgeMetrics.filter((edge) => edge.distance >= minimumVisibleDistance).sort((left, right) => right.distance - left.distance).forEach(({ index, distance }) => {
    const start = projected[index];
    const end = projected[(index + 1) % projected.length];
    if (start === undefined || end === undefined) return;
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
    const labelWidth = Math.max(34, text.length * 8);
    const candidates: ScreenPoint[] = [];
    for (const offset of [17, 27, 38, 50]) {
      for (const tangentShift of [0, 24, -24, 45, -45]) {
        candidates.push({ x: midpoint.x + outward.x * offset + tangent.x * tangentShift, y: midpoint.y + outward.y * offset + tangent.y * tangentShift });
      }
    }
    const selected = candidates.find((candidate) => {
      const candidateBox = boxAt(candidate, labelWidth, 18);
      const insideMap = candidateBox.left >= 5 && candidateBox.right <= MAP_WIDTH - 5 && candidateBox.top >= 5 && candidateBox.bottom <= MAP_HEIGHT - 5;
      return insideMap && occupied.every((box) => !boxesOverlap(candidateBox, box)) && waterSegments.every((segment) => pointToSegmentDistance(candidate, segment) > 18);
    }) ?? candidates[0] ?? midpoint;
    occupied.push(boxAt(selected, labelWidth, 18));
    placed.push({
      key: `edge-${index}`,
      x: Math.max(22, Math.min(MAP_WIDTH - 22, selected.x)),
      y: Math.max(16, Math.min(MAP_HEIGHT - 16, selected.y)),
      text,
      angle: readableLineAngle(start, end),
    });
  });
  return placed;
}

function DispatchMap({ building, objects, basemap }: Readonly<{ building: DistrictBuilding; objects: readonly DistrictMapObject[]; basemap: Basemap }>) {
  const [mapProjector, setMapProjector] = useState<((point: GeoPoint) => ScreenPoint) | null>(null);
  const dispatchSelection = useMemo(() => {
    const ranked = objects
      .filter((object): object is WaterSource => object.kind === 'hydrant' || object.kind === 'reservoir')
      .map((source) => ({ source, target: closestPointOnContour(source.point, building.contour) }))
      .sort((left, right) => left.target.distanceM - right.target.distanceM);
    const nearest = ranked.slice(0, 3);
    // The three nearest sources define a stable, readable crop. Once that crop is
    // known, also show every other source that physically falls inside it instead
    // of silently omitting hydrants visible on the same fragment of the map.
    const fitPoints = [...building.contour, building.point, ...nearest.map(({ source }) => source.point)];
    const projection = fitMap(fitPoints);
    return { ranked, fitPoints, projection };
  }, [building, objects]);
  const { ranked, fitPoints, projection } = dispatchSelection;
  const receiveProjector = useCallback((projector: ((point: GeoPoint) => ScreenPoint) | null) => {
    setMapProjector(() => projector === null ? null : (point: GeoPoint) => {
      const normalized = projector(point);
      return { x: normalized.x * MAP_WIDTH, y: normalized.y * MAP_HEIGHT };
    });
  }, []);
  const project = mapProjector ?? projection.project;
  const sources = useMemo(() => ranked.filter((entry, index) => {
    if (index < 3) return true;
    const point = project(entry.source.point);
    return point.x >= 0 && point.x <= MAP_WIDTH && point.y >= 0 && point.y <= MAP_HEIGHT;
  }), [project, ranked]);
  const contour = building.contour.map((point) => {
    const screen = project(point);
    return `${screen.x},${screen.y}`;
  }).join(' ');
  const buildingPoint = project(building.point);
  const markerScale = fittedBuildingMarkerScale(building, .9, project);
  // The hydrant badge is wider than the symbol itself. Keep a generous safety
  // area around every visible source so a distance label can never sit on top
  // of the «ПГ-… / К-…» plates.
  const markerObstacles = sources.map(({ source }) => boxAt(project(source.point), 132, 68));
  const waterLabelObstacles: LabelBox[] = [];
  // All sources inside the displayed fragment remain visible, but the route
  // distance is intentionally shown only for the three nearest ones.
  const waterLinks = ranked.slice(0, 3).map(({ source, target }) => {
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
    for (const fraction of [.5, .62, .74, .38]) {
      for (const offset of [24, 36, 48, -24, -36, -48]) {
        candidates.push({ x: from.x + (to.x - from.x) * fraction + normal.x * offset, y: from.y + (to.y - from.y) * fraction + normal.y * offset });
      }
    }
    const width = Math.max(40, text.length * 9);
    const label = candidates.find((candidate) => {
      const candidateBox = boxAt(candidate, width, 20);
      return candidateBox.left > 5 && candidateBox.right < MAP_WIDTH - 5 && candidateBox.top > 5 && candidateBox.bottom < MAP_HEIGHT - 5
        && markerObstacles.every((box) => !boxesOverlap(candidateBox, box))
        && waterLabelObstacles.every((box) => !boxesOverlap(candidateBox, box));
    }) ?? candidates[0] ?? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    waterLabelObstacles.push(boxAt(label, width, 20));
    return { source, from, to, label, text, angle: readableLineAngle(from, to) };
  });
  const fixedObstacles = [
    ...markerObstacles,
    ...waterLinks.map((link) => boxAt(link.label, Math.max(40, link.text.length * 9), 20)),
    boxAt(buildingPoint, 64, 40),
    { left: MAP_WIDTH - 105, top: 0, right: MAP_WIDTH, bottom: 105 },
  ];
  const labels = edgeLabels(building.contour, project, fixedObstacles, waterLinks.map((link) => ({ start: link.from, end: link.to })));
  return <>
    <h3 className="fire-dispatch-map-heading">Схема объекта и ближайших водоисточников</h3>
    <div className="fire-dispatch-map" aria-label="Схема объекта и ближайших водоисточников">
    <OfflineBasemap center={projection.center} zoom={projection.zoom} basemap={basemap} fitPoints={fitPoints} onProjectorReady={receiveProjector} />
    <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label={`Объект ${building.number} и водоисточники в пределах схемы`}>
      <defs>
        <marker id="dispatch-water-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path className="fire-dispatch-water-arrow" d="M0,0 L0,6 L7,3 z" /></marker>
      </defs>
      {waterLinks.map(({ source, from, to, label, text, angle }) => {
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
            <line className="hydrant-network-line" x1="-42" y1="0" x2="42" y2="0" />
            <rect className="hydrant-label-back" x="-48" y="-18" width="34" height="15" rx="3" />
            <rect className="hydrant-label-back" x="14" y="-18" width="34" height="15" rx="3" />
            <text className="hydrant-map-label" x="-31" y="-7" textAnchor="middle">{sourceLabel(source)}</text>
            <text className="hydrant-map-label" x="31" y="-7" textAnchor="middle">{hydrantNetworkCode(source)}</text>
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
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  useEffect(() => { warmDispatchExport(); }, []);
  const print = async () => {
    if (busy || sheetRef.current === null) return;
    setBusy(true);
    setSaveStatus('Подготавливается печать…');
    try {
      const imageDataUrl = await captureDispatchSnapshot(sheetRef.current, { scale: 1.35 });
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
      const imageDataUrl = await captureDispatchSnapshot(sheetRef.current, { scale: 1.65 });
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
    <section className="fire-dispatch-ticket-dialog" role="dialog" aria-modal="true" aria-labelledby="fire-dispatch-ticket-title">
      <div className="fire-dispatch-screen-actions">
        {saveStatus !== '' && <span className="fire-dispatch-save-status" role="status">{saveStatus}</span>}
        <button type="button" className="primary" disabled={busy} onClick={() => { void print(); }}>{busy ? 'Подождите…' : 'Распечатать'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void savePdf(); }}>Загрузить PDF в папку</button>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}><UiIcon name="close" /> Закрыть</button>
      </div>
      <article className="fire-dispatch-ticket-sheet" ref={sheetRef}>
        <header>
          <h1 id="fire-dispatch-ticket-title">ПУТЁВКА</h1>
          <h2>для выезда профессионального аварийно-спасательного формирования</h2>
          <div className="fire-dispatch-row division-row"><label data-complete={division.trim() !== ''}>Подразделение<input value={division} onChange={(event) => setDivision(event.currentTarget.value)} /></label><label data-complete={crew.trim() !== ''}>Дежурное отделение<select value={crew} onChange={(event) => setCrew(event.currentTarget.value)}><option value="">Указать отделение</option><option value="1-е отделение">1-е отделение</option><option value="2-е отделение">2-е отделение</option><option value="3-е отделение">3-е отделение</option><option value="4-е отделение">4-е отделение</option></select></label></div>
        </header>
        <div className="fire-dispatch-form">
          <label data-complete={place.trim() !== ''}><span>1. Место выезда, адрес</span><textarea rows={2} value={place} onChange={(event) => setPlace(event.currentTarget.value)} /></label>
          <label data-complete={emergencyType.trim() !== ''}><span>2. Объект пожара (характер ЧС)</span><EmergencyTypeField value={emergencyType} onChange={setEmergencyType} /></label>
          <div className="fire-dispatch-row">
            <label data-complete={date.trim() !== ''}><span>3. Дата сообщения</span><input type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} /></label>
            <label data-complete={time.trim() !== ''}><span>Время получения сообщения</span><input type="time" value={time} onChange={(event) => setTime(event.currentTarget.value)} /></label>
          </div>
          <div className="fire-dispatch-row applicant">
            <label data-complete={applicantName.trim() !== ''}><span>4. Фамилия, имя, отчество заявителя (Фамилия И.О.)</span><input value={applicantName} onChange={(event) => setApplicantName(event.currentTarget.value)} /></label>
            <label data-complete={applicantPhone.trim() !== ''}><span>Номер телефона</span><input type="tel" value={applicantPhone} onChange={(event) => setApplicantPhone(event.currentTarget.value)} /></label>
          </div>
          <div className="fire-dispatch-row dispatcher"><label data-complete={dispatcher.trim() !== ''}><span>5. Дежурный диспетчер подразделения (Фамилия И.О.)</span><input value={dispatcher} placeholder="Фамилия И.О." onChange={(event) => setDispatcher(event.currentTarget.value)} /></label><label><span>Подпись дежурного диспетчера</span><input aria-label="Подпись дежурного диспетчера" /></label></div>
        </div>
        <DispatchMap building={building} objects={objects} basemap={basemap} />
        <section className="fire-dispatch-planning-documents" aria-label="Документы предварительного планирования">
          <strong>Документы предварительного планирования</strong>
          <div>{planningDocuments.length === 0
            ? <span className="empty">На объект не разработаны</span>
            : planningDocuments.map((document, index) => <span key={`${document.kind}-${document.number}-${index}`}>{planningDocumentText(document)}</span>)}</div>
        </section>
        <p className="fire-dispatch-verification-note">* Перед выдачей путёвки диспетчер обязан самостоятельно проверить правильность заполнения данных и соответствие схемы выбранному объекту.</p>
        <footer><span>Сформировано системой «ХИМКОНТУР»</span></footer>
      </article>
    </section>
  </div>;
}
