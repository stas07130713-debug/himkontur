import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { evaluateControlPoint } from "../core/geo";
import { round } from "../core/math";
import { buildPlumeBands } from "../core/plume-shape";
import type { CalculationResult, GeoPoint } from "../core/types";
import { MAP_BOUNDS } from "./defaults";
import { MapLegend } from "./MapLegend";
import type { ControlTemplate } from "./ControlPalette";
import type { SourceConfiguration, SourceKind } from "./source-library";
import { appAssetUrl } from "./app-url";

export type ControlPoint = Readonly<{
  id: string;
  name: string;
  point: GeoPoint;
  kind?: ControlTemplate["kind"];
}>;
export type Basemap = "standard" | "satellite";
type Props = Readonly<{
  result: CalculationResult | null;
  calculationStarted: boolean;
  sourcePlaced: boolean;
  sourcePoint: GeoPoint;
  sourceLabel: string;
  sourceKind: SourceKind;
  sourceImageDataUrl?: string | undefined;
  windFromDegrees: number;
  windSpeedMps: number;
  controls: readonly ControlPoint[];
  basemap: Basemap;
  onBasemapChange: (basemap: Basemap) => void;
  onSourceChange: (point: GeoPoint) => void;
  onSourceDragStart?: () => void;
  onSourceDelete: () => void;
  onSourceDrop: (source: SourceConfiguration, point: GeoPoint) => void;
  onControlDrop: (template: ControlTemplate, point: GeoPoint) => void;
  onControlChange: (id: string, point: GeoPoint) => void;
  onControlDelete: (control: ControlPoint) => void;
  onControlDragStart?: (control: ControlPoint) => void;
}>;

const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 680;
const CENTER = {
  longitude: (MAP_BOUNDS.west + MAP_BOUNDS.east) / 2,
  latitude: (MAP_BOUNDS.south + MAP_BOUNDS.north) / 2,
};
const KM_PER_LATITUDE_DEGREE = 111.32;
const KM_PER_LONGITUDE_DEGREE =
  KM_PER_LATITUDE_DEGREE * Math.cos((CENTER.latitude * Math.PI) / 180);
const BASE_WIDTH_KM =
  (MAP_BOUNDS.east - MAP_BOUNDS.west) * KM_PER_LONGITUDE_DEGREE;
const BASE_HEIGHT_KM =
  (MAP_BOUNDS.north - MAP_BOUNDS.south) * KM_PER_LATITUDE_DEGREE;
const SOURCE_KINDS: readonly SourceKind[] = [
  "rail",
  "truck",
  "tank",
  "rail-tanks",
  "cylinder",
  "process",
  "custom",
];
const SOURCE_IMAGE_PATHS: Readonly<
  Record<Exclude<SourceKind, "custom">, string>
> = {
  rail: appAssetUrl("assets/sources/rail-v3.png"),
  truck: appAssetUrl("assets/sources/truck-v3.png"),
  tank: appAssetUrl("assets/sources/tank-v3.png"),
  "rail-tanks": appAssetUrl("assets/sources/rail-tanks.png"),
  cylinder: appAssetUrl("assets/sources/cylinder-v2.png"),
  process: appAssetUrl("assets/sources/pipeline.svg?v=2"),
};
const WIND_NAMES = [
  "Северный",
  "Северо-восточный",
  "Восточный",
  "Юго-восточный",
  "Южный",
  "Юго-западный",
  "Западный",
  "Северо-западный",
] as const;
const CONTROL_IMAGE_PATHS: Readonly<Record<ControlTemplate["kind"], string>> = {
  administrative: appAssetUrl("assets/controls/administrative-v4.png"),
  industrial: appAssetUrl("assets/controls/industrial-v4.png"),
  residential: appAssetUrl("assets/controls/residential-v4.png"),
};

function isSourceKind(value: string): value is SourceKind {
  return SOURCE_KINDS.some((kind) => kind === value);
}
function mapTileUrl(basemap: Basemap, zoom: number, tileX: number, tileY: number): string {
  const local = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (local) return basemap === "standard" ? `/map-tiles/osm/${zoom}/${tileX}/${tileY}.png` : `/map-tiles/esri/${zoom}/${tileY}/${tileX}`;
  return basemap === "standard"
    ? `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`
    : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${tileX}`;
}
function longitudeToTile(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * 2 ** zoom;
}
function latitudeToTile(latitude: number, zoom: number): number {
  const radians = (latitude * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom;
}
function tileToLongitude(tile: number, zoom: number): number {
  return (tile / 2 ** zoom) * 360 - 180;
}
function tileToLatitude(tile: number, zoom: number): number {
  return (
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * tile) / 2 ** zoom))) * 180) /
    Math.PI
  );
}
function windName(degrees: number): string {
  return (
    WIND_NAMES[Math.round((((degrees % 360) + 360) % 360) / 45) % 8] ??
    "Северный"
  );
}
function niceScale(value: number): number {
  const exponent = 10 ** Math.floor(Math.log10(value));
  const normalized = value / exponent;
  return (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * exponent;
}
function readableLineAngle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}
function MapBuildingIcon({
  kind,
}: Readonly<{ kind: ControlTemplate["kind"] }>) {
  return (
    <image
      className="map-building-image"
      href={CONTROL_IMAGE_PATHS[kind]}
      x="-27"
      y="-62"
      width="54"
      height="52"
      preserveAspectRatio="xMidYMid meet"
    />
  );
}
function CompassRose({ rotation }: Readonly<{ rotation: number }>) {
  return (
    <div
      className="compass-rose"
      title="Стороны света"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <radialGradient id="compass-face" cx="42%" cy="35%">
            <stop offset="0" stopColor="#164d5f" />
            <stop offset="1" stopColor="#031e2c" />
          </radialGradient>
          <filter id="compass-glow">
            <feDropShadow
              dx="0"
              dy="2"
              stdDeviation="2"
              floodColor="#00151f"
              floodOpacity=".65"
            />
          </filter>
        </defs>
        <circle className="compass-bezel" cx="60" cy="60" r="55" />
        <circle className="compass-disc" cx="60" cy="60" r="49" />
        <circle className="compass-ring" cx="60" cy="60" r="38" />
        <path
          className="compass-minor-ticks"
          d="M60 13v5M60 102v5M13 60h5M102 60h5M27 27l4 4M89 89l4 4M93 27l-4 4M31 89l-4 4"
        />
        <path className="compass-north" d="M60 23 69 60 60 54 51 60Z" />
        <path className="compass-south" d="M60 97 69 60 60 66 51 60Z" />
        <circle className="compass-hub-outer" cx="60" cy="60" r="6" />
        <circle className="compass-hub" cx="60" cy="60" r="3" />
        <g className="compass-cardinals">
          <text x="60" y="12">
            С
          </text>
          <text x="60" y="111">
            Ю
          </text>
          <text x="11" y="63">
            З
          </text>
          <text x="109" y="63">
            В
          </text>
        </g>
      </svg>
    </div>
  );
}
function plumePath(
  x: number,
  y: number,
  radius: number,
  bearing: number,
  angle: number,
): string {
  const point = (direction: number) => ({
    x: x + Math.sin((direction * Math.PI) / 180) * radius,
    y: y - Math.cos((direction * Math.PI) / 180) * radius,
  });
  if (angle >= 360)
    return `M ${x - radius} ${y} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
  const start = point(bearing - angle / 2);
  const end = point(bearing + angle / 2);
  return `M ${x} ${y} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${angle > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
}
function plumeBandPath(
  x: number,
  y: number,
  innerRadius: number,
  outerRadius: number,
  bearing: number,
  angle: number,
): string {
  if (innerRadius <= 0) return plumePath(x, y, outerRadius, bearing, angle);
  if (angle >= 360)
    return `${plumePath(x, y, outerRadius, bearing, angle)} ${plumePath(x, y, innerRadius, bearing, angle)}`;
  const point = (radius: number, direction: number) => ({
    x: x + Math.sin((direction * Math.PI) / 180) * radius,
    y: y - Math.cos((direction * Math.PI) / 180) * radius,
  });
  const outerStart = point(outerRadius, bearing - angle / 2);
  const outerEnd = point(outerRadius, bearing + angle / 2);
  const innerStart = point(innerRadius, bearing - angle / 2);
  const innerEnd = point(innerRadius, bearing + angle / 2);
  const largeArc = angle > 180 ? 1 : 0;
  return `M ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`;
}

export function MapCanvas(props: Props) {
  const [zoom, setZoom] = useState(1);
  const [mapCenter, setMapCenter] = useState<GeoPoint>(props.sourcePoint);
  const [rotation, setRotation] = useState(0);
  const [showPrimary, setShowPrimary] = useState(true);
  const [showSecondary, setShowSecondary] = useState(true);
  const [objectsLocked, setObjectsLocked] = useState(false);
  const [draggingSource, setDraggingSource] = useState(false);
  const [panning, setPanning] = useState(false);
  const [contextMenu, setContextMenu] = useState<
    | { target: "control"; control: ControlPoint; x: number; y: number }
    | { target: "source"; x: number; y: number }
    | { target: "map"; point: GeoPoint; x: number; y: number }
    | null
  >(null);
  const [mapControlKind, setMapControlKind] =
    useState<ControlTemplate["kind"]>("administrative");
  const [viewSize, setViewSize] = useState({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sourcePointerRef = useRef<number | null>(null);
  const controlPointerRef = useRef<{ pointerId: number; id: string } | null>(
    null,
  );
  const panRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    center: GeoPoint;
  } | null>(null);
  const viewWidth = viewSize.width;
  const viewHeight = viewSize.height;
  const projection = useMemo(() => {
    const scale =
      zoom * Math.min(viewWidth / BASE_WIDTH_KM, viewHeight / BASE_HEIGHT_KM);
    const visibleWidthKm = viewWidth / scale;
    const project = (point: GeoPoint) => ({
      x:
        viewWidth / 2 +
        (point.longitude - mapCenter.longitude) *
          KM_PER_LONGITUDE_DEGREE *
          scale,
      y:
        viewHeight / 2 -
        (point.latitude - mapCenter.latitude) * KM_PER_LATITUDE_DEGREE * scale,
    });
    const unproject = (x: number, y: number): GeoPoint => ({
      longitude:
        mapCenter.longitude +
        (x - viewWidth / 2) / scale / KM_PER_LONGITUDE_DEGREE,
      latitude:
        mapCenter.latitude -
        (y - viewHeight / 2) / scale / KM_PER_LATITUDE_DEGREE,
    });
    return { scale, visibleWidthKm, project, unproject };
  }, [mapCenter, viewHeight, viewWidth, zoom]);
  const changeZoom = useCallback(
    (factor: number, anchor?: GeoPoint) => {
      const nextZoom = Math.max(0.2, Math.min(8, zoom * factor));
      const appliedFactor = nextZoom / zoom;
      if (anchor !== undefined)
        setMapCenter((current) => ({
          longitude:
            anchor.longitude -
            (anchor.longitude - current.longitude) / appliedFactor,
          latitude:
            anchor.latitude -
            (anchor.latitude - current.latitude) / appliedFactor,
        }));
      setZoom(nextZoom);
    },
    [zoom],
  );
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setViewSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height)),
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setObjectsLocked(props.calculationStarted);
  }, [props.calculationStarted]);
  useEffect(() => {
    const depth = props.result?.finalDepthKm;
    if (depth === undefined) return;
    const safeDiameterKm = Math.max(0.5, depth * 2.35);
    setZoom(
      Math.max(
        0.2,
        Math.min(
          1,
          BASE_WIDTH_KM / safeDiameterKm,
          BASE_HEIGHT_KM / safeDiameterKm,
        ),
      ),
    );
  }, [props.result?.finalDepthKm]);
  const tiles = useMemo(() => {
    const circumference =
      40_075 * Math.cos((mapCenter.latitude * Math.PI) / 180);
    const tileZoom = Math.max(
      10,
      Math.min(
        18,
        Math.round(Math.log2((projection.scale * circumference) / 256)),
      ),
    );
    const nw = projection.unproject(0, 0);
    const se = projection.unproject(viewWidth, viewHeight);
    const output: {
      key: string;
      x: number;
      y: number;
      width: number;
      height: number;
      tileX: number;
      tileY: number;
      zoom: number;
    }[] = [];
    for (
      let tileY = Math.floor(latitudeToTile(nw.latitude, tileZoom));
      tileY <= Math.floor(latitudeToTile(se.latitude, tileZoom));
      tileY += 1
    )
      for (
        let tileX = Math.floor(longitudeToTile(nw.longitude, tileZoom));
        tileX <= Math.floor(longitudeToTile(se.longitude, tileZoom));
        tileX += 1
      ) {
        const a = projection.project({
          longitude: tileToLongitude(tileX, tileZoom),
          latitude: tileToLatitude(tileY, tileZoom),
        });
        const b = projection.project({
          longitude: tileToLongitude(tileX + 1, tileZoom),
          latitude: tileToLatitude(tileY + 1, tileZoom),
        });
        output.push({
          key: `${tileZoom}-${tileX}-${tileY}`,
          x: a.x,
          y: a.y,
          width: b.x - a.x,
          height: b.y - a.y,
          tileX,
          tileY,
          zoom: tileZoom,
        });
      }
    return output;
  }, [mapCenter.latitude, projection, viewHeight, viewWidth]);
  const rotationRadians = (rotation * Math.PI) / 180;
  const rotationCoverScale =
    Math.abs(Math.cos(rotationRadians)) + Math.abs(Math.sin(rotationRadians));
  const inverseRotation = (x: number, y: number) => {
    const angle = (rotation * Math.PI) / 180;
    return {
      x: x * Math.cos(angle) + y * Math.sin(angle),
      y: -x * Math.sin(angle) + y * Math.cos(angle),
    };
  };
  const locate = (clientX: number, clientY: number): GeoPoint | null => {
    const stage = stageRef.current;
    if (stage === null) return null;
    const rect = stage.getBoundingClientRect();
    const local = inverseRotation(
      clientX - rect.left - rect.width / 2,
      clientY - rect.top - rect.height / 2,
    );
    return projection.unproject(
      (local.x / rotationCoverScale / rect.width + 0.5) * viewWidth,
      (local.y / rotationCoverScale / rect.height + 0.5) * viewHeight,
    );
  };
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const anchor = locate(event.clientX, event.clientY);
      changeZoom(event.deltaY < 0 ? 1.16 : 1 / 1.16, anchor ?? undefined);
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  });
  const onDrop = (event: DragEvent<SVGSVGElement>) => {
    event.preventDefault();
    const point = locate(event.clientX, event.clientY);
    if (point === null) return;
    const controlValue = event.dataTransfer.getData(
      "application/x-ahov-control",
    );
    if (controlValue !== "") {
      try {
        props.onControlDrop(JSON.parse(controlValue) as ControlTemplate, point);
      } catch {
        /* ignore external data */
      }
      return;
    }
    const value = event.dataTransfer.getData(
      "application/x-ahov-source-config",
    );
    if (value !== "")
      try {
        const source = JSON.parse(value) as SourceConfiguration;
        if (isSourceKind(source.kind)) props.onSourceDrop(source, point);
      } catch {
        /* ignore external data */
      }
  };
  const onSourcePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 || objectsLocked) return;
    props.onSourceDragStart?.();
    sourcePointerRef.current = event.pointerId;
    svgRef.current?.setPointerCapture(event.pointerId);
    setDraggingSource(true);
  };
  const onControlPointerDown = (
    event: ReactPointerEvent<SVGGElement>,
    control: ControlPoint,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 || objectsLocked) return;
    props.onControlDragStart?.(control);
    controlPointerRef.current = { pointerId: event.pointerId, id: control.id };
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const onMapPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    setContextMenu(null);
    if (
      event.button !== 0 ||
      sourcePointerRef.current !== null ||
      controlPointerRef.current !== null
    )
      return;
    event.preventDefault();
    panRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      center: mapCenter,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (sourcePointerRef.current === event.pointerId) {
      const point = locate(event.clientX, event.clientY);
      if (point !== null) props.onSourceChange(point);
      return;
    }
    if (controlPointerRef.current?.pointerId === event.pointerId) {
      const point = locate(event.clientX, event.clientY);
      if (point !== null)
        props.onControlChange(controlPointerRef.current.id, point);
      return;
    }
    const pan = panRef.current;
    const stage = stageRef.current;
    if (pan?.pointerId !== event.pointerId || stage === null) return;
    const rect = stage.getBoundingClientRect();
    const delta = inverseRotation(
      event.clientX - pan.clientX,
      event.clientY - pan.clientY,
    );
    setMapCenter({
      longitude:
        pan.center.longitude -
        ((delta.x / rotationCoverScale) * viewWidth) /
          rect.width /
          projection.scale /
          KM_PER_LONGITUDE_DEGREE,
      latitude:
        pan.center.latitude +
        ((delta.y / rotationCoverScale) * viewHeight) /
          rect.height /
          projection.scale /
          KM_PER_LATITUDE_DEGREE,
    });
  };
  const finishPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (sourcePointerRef.current === event.pointerId) {
      sourcePointerRef.current = null;
      setDraggingSource(false);
    }
    if (controlPointerRef.current?.pointerId === event.pointerId)
      controlPointerRef.current = null;
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      setPanning(false);
    }
    if (svgRef.current?.hasPointerCapture(event.pointerId))
      svgRef.current.releasePointerCapture(event.pointerId);
  };
  const sourceScreen = projection.project(props.sourcePoint);
  const scaleDistanceKm = niceScale(projection.visibleWidthKm / 5);
  const scalePixels = scaleDistanceKm * projection.scale;
  const markerScale = Math.max(0.7, Math.min(1, Math.sqrt(0.3 / zoom)));
  const dimensions = useMemo(() => {
    if (props.result === null) return null;
    const bearing = (props.result.plumeToDegrees * Math.PI) / 180;
    const halfAngle =
      ((Math.min(props.result.sectorAngleDegrees, 180) / 2) * Math.PI) / 180;
    const radius = props.result.finalDepthKm * projection.scale;
    const polar = (angle: number) => ({
      x: sourceScreen.x + Math.sin(angle) * radius,
      y: sourceScreen.y - Math.cos(angle) * radius,
    });
    const front = polar(bearing);
    const left =
      props.result.sectorAngleDegrees >= 360
        ? polar(bearing - Math.PI / 2)
        : polar(bearing - halfAngle);
    const right =
      props.result.sectorAngleDegrees >= 360
        ? polar(bearing + Math.PI / 2)
        : polar(bearing + halfAngle);
    const normalCandidate = { x: Math.cos(bearing), y: Math.sin(bearing) };
    const normalDirection =
      normalCandidate.y < 0 ||
      (Math.abs(normalCandidate.y) < 0.001 && normalCandidate.x < 0)
        ? -1
        : 1;
    const labelNormal = {
      x: normalCandidate.x * normalDirection,
      y: normalCandidate.y * normalDirection,
    };
    const alongDepth = (fraction: number) => ({
      x: sourceScreen.x + (front.x - sourceScreen.x) * fraction,
      y: sourceScreen.y + (front.y - sourceScreen.y) * fraction,
    });
    const sharedAnchor = alongDepth(0.56);
    const widthMidpoint = {
      x: (left.x + right.x) / 2,
      y: (left.y + right.y) / 2,
    };
    const compact = radius < 230;
    const labelOffset = compact ? 10 : 15;
    return {
      front,
      left,
      right,
      compact,
      showLabels: radius >= 90,
      showAreaLabel: radius >= 170,
      labelSize: Math.max(7, Math.min(12, radius / 22)),
      depthLabel: {
        x: sharedAnchor.x + labelNormal.x * labelOffset,
        y: sharedAnchor.y + labelNormal.y * labelOffset,
      },
      widthLabel: widthMidpoint,
      depthRotation: readableLineAngle(
        sourceScreen.x,
        sourceScreen.y,
        front.x,
        front.y,
      ),
      widthRotation: readableLineAngle(left.x, left.y, right.x, right.y),
      areaAnchor: {
        x: sharedAnchor.x - labelNormal.x * labelOffset,
        y: sharedAnchor.y - labelNormal.y * labelOffset,
      },
      depthKm: props.result.finalDepthKm,
      possibleAreaKm2: props.result.possibleAreaKm2,
      widthKm:
        props.result.sectorAngleDegrees >= 360
          ? 2 * props.result.finalDepthKm
          : 2 * props.result.finalDepthKm * Math.sin(halfAngle),
    };
  }, [projection.scale, props.result, sourceScreen.x, sourceScreen.y]);
  const plumeBands = useMemo(
    () =>
      props.result === null
        ? []
        : buildPlumeBands(
            showPrimary ? props.result.primaryDepthAtForecastKm : 0,
            showSecondary ? props.result.secondaryDepthAtForecastKm : 0,
            props.result.finalDepthKm,
          ),
    [props.result, showPrimary, showSecondary],
  );
  const plumeBearing = props.result?.plumeToDegrees ?? 0;
  const plumeAngle = props.result?.sectorAngleDegrees ?? 0;
  const sourceBearingRadians = (plumeBearing * Math.PI) / 180;
  const sourceDecoration =
    props.result === null
      ? { x: 0, y: -44 }
      : {
          x: -Math.sin(sourceBearingRadians) * 44,
          y: Math.cos(sourceBearingRadians) * 44,
        };
  const sourceImageHref =
    props.sourceImageDataUrl === undefined
      ? props.sourceKind === "custom"
        ? undefined
        : SOURCE_IMAGE_PATHS[props.sourceKind]
      : appAssetUrl(props.sourceImageDataUrl);
  const hasControls = props.controls.length > 0;
  return (
    <main className="map-column">
      <div className="map-toolbar">
        <div className="map-tool-group">
          <div className="segmented">
            <button
              className={props.basemap === "standard" ? "active" : ""}
              onClick={() => props.onBasemapChange("standard")}
            >
              Карта
            </button>
            <button
              className={props.basemap === "satellite" ? "active" : ""}
              onClick={() => props.onBasemapChange("satellite")}
            >
              Спутник
            </button>
          </div>
          <div className="layer-toggles">
            <label>
              <input
                type="checkbox"
                checked={showPrimary}
                onChange={(event) =>
                  setShowPrimary(event.currentTarget.checked)
                }
              />
              Первичное облако АХОВ
            </label>
            <label>
              <input
                type="checkbox"
                checked={showSecondary}
                onChange={(event) =>
                  setShowSecondary(event.currentTarget.checked)
                }
              />
              Вторичное облако АХОВ
            </label>
          </div>
        </div>
        {props.sourcePlaced && (
          <div className="toolbar-wind-summary">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <g
                transform={`rotate(${((props.windFromDegrees + 180) % 360) + rotation} 22 22)`}
              >
                <path d="M22 39V8M22 8 13 20M22 8l9 12" />
              </g>
            </svg>
            <div>
              <strong>{windName(props.windFromDegrees)} ветер</strong>
              <span>{round(props.windSpeedMps, 1)} м/с</span>
            </div>
          </div>
        )}
        <div className="rotation-controls" aria-label="Поворот карты">
          <button
            title="Повернуть карту на 15° против часовой стрелки"
            onClick={() => setRotation((value) => (value + 345) % 360)}
          >
            −15°
          </button>
          <button
            title="Сбросить поворот: север вверх"
            onClick={() => setRotation(0)}
          >
            Север ↑ · {rotation}°
          </button>
          <button
            title="Повернуть карту на 15° по часовой стрелке"
            onClick={() => setRotation((value) => (value + 15) % 360)}
          >
            +15°
          </button>
        </div>
        <div className="zoom">
          <button
            aria-label="Уменьшить карту"
            onClick={() => changeZoom(1 / 1.4)}
          >
            −
          </button>
          <span>{round(zoom * 100, 0)}%</span>
          <button aria-label="Увеличить карту" onClick={() => changeZoom(1.4)}>
            +
          </button>
        </div>
        <button
          type="button"
          className="source-focus"
          aria-label="Вернуться к точке аварии"
          title="Вернуться к точке аварии и приблизить карту"
          disabled={!props.sourcePlaced}
          onClick={() => {
            setMapCenter(props.sourcePoint);
            setZoom(3);
          }}
        />
        <button
          aria-label={
            objectsLocked
              ? "Объекты закреплены"
              : "Перемещение объектов разрешено"
          }
          title={
            objectsLocked
              ? "Объекты закреплены"
              : "Перемещение объектов разрешено"
          }
          className={objectsLocked ? "source-lock locked" : "source-lock"}
          onClick={() => setObjectsLocked((value) => !value)}
        />
      </div>
      <div className={`map-surface ${props.basemap}`}>
        <div className="map-stage" ref={stageRef}>
          <div
            className="map-rotatable"
            style={{
              transform: `rotate(${rotation}deg) scale(${rotationCoverScale})`,
            }}
          >
            <div className="basemap-tile-layer" aria-hidden="true">
              {tiles.map((tile) => (
                <img
                  key={tile.key}
                  alt=""
                  draggable={false}
                  style={{
                    left: `${(tile.x / viewWidth) * 100}%`,
                    top: `${(tile.y / viewHeight) * 100}%`,
                    width: `${((tile.width + 1) / viewWidth) * 100}%`,
                    height: `${((tile.height + 1) / viewHeight) * 100}%`,
                  }}
                  crossOrigin="anonymous"
                  src={mapTileUrl(props.basemap, tile.zoom, tile.tileX, tile.tileY)}
                />
              ))}
            </div>
            <svg
              ref={svgRef}
              className={panning ? "panning" : ""}
              viewBox={`0 0 ${viewWidth} ${viewHeight}`}
              onDrop={onDrop}
              onDragOver={(event) => event.preventDefault()}
              onPointerDown={onMapPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              onContextMenu={(event) => {
                event.preventDefault();
                const rect = stageRef.current?.getBoundingClientRect();
                const point = locate(event.clientX, event.clientY);
                if (rect !== undefined && point !== null)
                  setContextMenu({
                    target: "map",
                    point,
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  });
              }}
              aria-label="Карта расчётной зоны"
            >
              <defs>
                <marker
                  id="dimension-arrow"
                  viewBox="0 0 10 10"
                  refX="5"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 10 5 0 10Z" />
                </marker>
              </defs>
              <rect
                width={viewWidth}
                height={viewHeight}
                className="map-base"
              />
              {props.result !== null && (
                <>
                  <path
                    d={plumePath(
                      sourceScreen.x,
                      sourceScreen.y,
                      props.result.finalDepthKm * projection.scale,
                      props.result.plumeToDegrees,
                      props.result.sectorAngleDegrees,
                    )}
                    className="final-plume-outline"
                  />
                </>
              )}
              {props.result !== null && (
                <g className="calculated-plume-shape">
                  {plumeBands.map((band) => (
                    <path
                      key={`${band.fromKm}-${band.toKm}-${band.kind}`}
                      d={plumeBandPath(
                        sourceScreen.x,
                        sourceScreen.y,
                        band.fromKm * projection.scale,
                        band.toKm * projection.scale,
                        plumeBearing,
                        plumeAngle,
                      )}
                      className={`plume-band plume-band-${band.kind}`}
                      fillRule="evenodd"
                      data-from-km={band.fromKm}
                      data-to-km={band.toKm}
                    />
                  ))}
                </g>
              )}
              {props.result !== null && (
                <>
                  {showSecondary && (
                    <path
                      d={plumePath(
                        sourceScreen.x,
                        sourceScreen.y,
                        props.result.secondaryDepthAtForecastKm *
                          projection.scale,
                        plumeBearing,
                        plumeAngle,
                      )}
                      className="secondary-plume"
                    />
                  )}
                  {showPrimary && (
                    <path
                      d={plumePath(
                        sourceScreen.x,
                        sourceScreen.y,
                        props.result.primaryDepthAtForecastKm *
                          projection.scale,
                        plumeBearing,
                        plumeAngle,
                      )}
                      className="primary-plume"
                    />
                  )}
                </>
              )}
              {dimensions !== null && (
                <>
                  <g
                    className={`plume-dimensions plume-dimensions-top${dimensions.compact ? " compact-labels" : ""}`}
                  >
                    <line
                      className="dimension-depth-line"
                      x1={sourceScreen.x}
                      y1={sourceScreen.y}
                      x2={dimensions.front.x}
                      y2={dimensions.front.y}
                    />
                    {dimensions.showLabels && (
                      <text
                        className="map-measure-label dimension-depth-label"
                        style={{ fontSize: dimensions.labelSize }}
                        x={dimensions.depthLabel.x}
                        y={dimensions.depthLabel.y}
                        textAnchor="middle"
                        transform={`rotate(${dimensions.depthRotation} ${dimensions.depthLabel.x} ${dimensions.depthLabel.y})`}
                      >
                        L = {round(dimensions.depthKm, 2)} км
                      </text>
                    )}
                    <line
                      className="dimension-width-line"
                      x1={dimensions.left.x}
                      y1={dimensions.left.y}
                      x2={dimensions.right.x}
                      y2={dimensions.right.y}
                    />
                    {dimensions.showLabels && (
                      <text
                        className="map-measure-label dimension-width-label"
                        style={{ fontSize: dimensions.labelSize }}
                        x={dimensions.widthLabel.x}
                        y={dimensions.widthLabel.y}
                        textAnchor="middle"
                        transform={`rotate(${dimensions.widthRotation} ${dimensions.widthLabel.x} ${dimensions.widthLabel.y})`}
                      >
                        W = {round(dimensions.widthKm, 2)} км
                      </text>
                    )}
                  </g>
                  {dimensions.showAreaLabel && (
                    <g
                      className="plume-area-labels"
                      transform={`rotate(${dimensions.depthRotation} ${dimensions.areaAnchor.x} ${dimensions.areaAnchor.y})`}
                    >
                      <text
                        className="map-measure-label"
                        style={{ fontSize: dimensions.labelSize }}
                        x={dimensions.areaAnchor.x}
                        y={dimensions.areaAnchor.y}
                      >
                        S = {round(dimensions.possibleAreaKm2, 2)} км²
                      </text>
                    </g>
                  )}
                </>
              )}
              {props.sourcePlaced && (
                <g
                  transform={`translate(${sourceScreen.x} ${sourceScreen.y})`}
                  className={`source-marker${draggingSource ? " dragging" : ""}${objectsLocked ? " locked" : ""}`}
                  onPointerDown={onSourcePointerDown}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = stageRef.current?.getBoundingClientRect();
                    if (rect !== undefined)
                      setContextMenu({
                        target: "source",
                        x: event.clientX - rect.left,
                        y: event.clientY - rect.top,
                      });
                  }}
                >
                  <title>
                    {objectsLocked
                      ? "Правая кнопка мыши — меню источника"
                      : "Зажмите и переместите; правая кнопка — меню"}
                  </title>
                  <circle r="24" className="source-hit-area" />
                  <g transform={`scale(${markerScale})`}>
                    <circle r="12" />
                    <circle r="4" />
                    {sourceImageHref !== undefined && (
                      <g
                        className="source-map-photo-svg"
                        transform={`translate(${sourceDecoration.x} ${sourceDecoration.y})`}
                      >
                        <image
                          href={sourceImageHref}
                          x="-40"
                          y="-23"
                          width="80"
                          height="46"
                          preserveAspectRatio="xMidYMid meet"
                        />
                      </g>
                    )}
                    <text
                      x={sourceImageHref === undefined ? 0 : sourceDecoration.x}
                      y={
                        sourceImageHref === undefined
                          ? -20
                          : sourceDecoration.y +
                            (sourceDecoration.y >= 0 ? 33 : -31)
                      }
                      textAnchor="middle"
                    >
                      {props.sourceLabel}
                    </text>
                  </g>
                </g>
              )}
              {props.controls.map((control) => {
                const screen = projection.project(control.point);
                const kind = control.kind ?? "administrative";
                const evaluated =
                  props.result === null
                    ? null
                    : evaluateControlPoint(props.result, control.point);
                const arrival =
                  evaluated?.arrivalTimeIso == null
                    ? null
                    : new Date(evaluated.arrivalTimeIso).toLocaleTimeString(
                        "ru-RU",
                        { hour: "2-digit", minute: "2-digit" },
                      );
                const arrivalMinutes =
                  evaluated?.arrivalMinutesAfterAccident ?? null;
                const affectedNow = evaluated?.reachedByForecast ?? false;
                const future =
                  evaluated?.willBeAffected === true && !affectedNow;
                const status = affectedNow
                  ? `в зоне · через ${arrivalMinutes} мин · ${arrival}`
                  : future
                    ? `угроза через ${arrivalMinutes} мин · ${arrival}`
                    : "угрозы нет";
                return (
                  <g
                    key={control.id}
                    transform={`translate(${screen.x} ${screen.y})`}
                    className={`control-marker control-${kind}${affectedNow ? " affected" : ""}${future ? " future-affected" : ""}${objectsLocked ? " locked" : ""}`}
                    onPointerDown={(event) =>
                      onControlPointerDown(event, control)
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = stageRef.current?.getBoundingClientRect();
                      if (rect !== undefined)
                        setContextMenu({
                          target: "control",
                          control,
                          x: event.clientX - rect.left,
                          y: event.clientY - rect.top,
                        });
                    }}
                  >
                    <circle className="control-hit-area" r="24" />
                    <circle className="control-point-dot" r="10" />
                    <circle className="control-point-core" r="3.5" />
                    <MapBuildingIcon kind={kind} />
                    {evaluated !== null && (
                      <g
                        className={`control-label-group${affectedNow ? " affected-label" : future ? " future-label" : " safe-label"}`}
                      >
                        <text
                          x="0"
                          y="25"
                          textAnchor="middle"
                          className="control-distance-label"
                        >
                          {round(evaluated.distanceKm, 2)} км
                        </text>
                        <text
                          x="0"
                          y="36"
                          textAnchor="middle"
                          className="control-status-label"
                        >
                          {status}
                        </text>
                      </g>
                    )}
                    <title>
                      {control.name}. Правая кнопка мыши — меню объекта
                    </title>
                  </g>
                );
              })}
            </svg>
          </div>
          {contextMenu !== null && contextMenu.target === "map" && (
            <div
              className="map-context-menu add-control-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <strong>Контрольная точка</strong>
              <select
                value={mapControlKind}
                onChange={(event) =>
                  setMapControlKind(
                    event.currentTarget.value as ControlTemplate["kind"],
                  )
                }
              >
                <option value="administrative">Административное здание</option>
                <option value="industrial">Производственное здание</option>
                <option value="residential">Жилое здание</option>
              </select>
              <button
                onClick={() => {
                  const labels = {
                    administrative: "Административное здание",
                    industrial: "Производственное здание",
                    residential: "Жилое здание",
                  } as const;
                  props.onControlDrop(
                    { kind: mapControlKind, name: labels[mapControlKind] },
                    contextMenu.point,
                  );
                  setContextMenu(null);
                }}
              >
                Добавить
              </button>
              <button onClick={() => setContextMenu(null)}>Отмена</button>
            </div>
          )}
          {contextMenu !== null && contextMenu.target !== "map" && (
            <div
              className="map-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <strong>
                {contextMenu.target === "source"
                  ? props.sourceLabel
                  : contextMenu.control.name}
              </strong>
              <button
                onClick={() => {
                  if (contextMenu.target === "source") props.onSourceDelete();
                  else props.onControlDelete(contextMenu.control);
                  setContextMenu(null);
                }}
              >
                Удалить
              </button>
              <button onClick={() => setContextMenu(null)}>Отмена</button>
            </div>
          )}
          <CompassRose rotation={rotation} />
          <div
            className="map-scale"
            style={{ width: `${(scalePixels / viewWidth) * 100}%` }}
          >
            <span>
              {scaleDistanceKm < 1
                ? `${round(scaleDistanceKm * 1000, 0)} м`
                : `${scaleDistanceKm} км`}
            </span>
          </div>
          <MapLegend
            compact
            hasSource={props.sourcePlaced}
            showOverlap={false}
            showPrimary={props.result !== null && showPrimary}
            showSecondary={props.result !== null && showSecondary}
            showCombined={props.result !== null}
            hasControls={hasControls}
          />
          <div className="map-coordinate-bar">
            ⌖{" "}
            {props.sourcePlaced
              ? `${props.sourcePoint.latitude.toFixed(5)}° с.ш. · ${props.sourcePoint.longitude.toFixed(5)}° в.д.`
              : "Источник не размещён"}
          </div>
          <div className="map-attribution-html">
            {props.basemap === "standard"
              ? "© OpenStreetMap contributors"
              : "Источник снимков: Esri World Imagery"}
          </div>
        </div>
      </div>
    </main>
  );
}
