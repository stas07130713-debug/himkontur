import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { GeoPoint } from '../core/types';
import { round } from '../core/math';
import { MAP_BOUNDS, MAP_INITIAL_CENTER } from './defaults';
import { DistrictMapMarker, HydrantPlanSymbol } from './DistrictMapMarker';
import { declutterDistrictMarkers } from './district-marker-layout';
import { HydrantIndicatorPlate } from './HydrantIndicatorPlate';
import type {
  DistrictBuilding,
  DistrictHydrant,
  DistrictMapObject,
  DistrictMapProject,
  DistrictNamedUnit,
  DistrictPlanningDocument,
  DistrictPlanningDocumentKind,
} from './district-map-model';
import {
  districtObjectTitle,
  HYDRANT_STATUS_LABELS,
  HYDRANT_TYPE_LABELS,
} from './district-map-model';
import { DistrictObjectToolbar } from './DistrictObjectToolbar';
import { OfflineBasemap } from './OfflineBasemap';
import type { Basemap } from './MapCanvas';
import { UiIcon } from './UiIcon';
import { appAssetUrl } from './app-url';
import { CompassRose } from './CompassRose';
import { parseHydrantActFile, type HydrantActParseResult } from './hydrant-act-import';
import { MapRulerOverlay } from './MapRulerOverlay';

type Props = Readonly<{
  project: DistrictMapProject;
  objects: readonly DistrictMapObject[];
  adminMode: boolean;
  basemap: Basemap;
  onBasemapChange: (value: Basemap) => void;
  onObjectsChange: (objects: readonly DistrictMapObject[]) => void;
  onObjectChangeStart: () => void;
  onCommitObjects: (objects: readonly DistrictMapObject[]) => void;
  managementOpen: boolean;
  onCloseManagement: () => void;
  onExitAdmin: () => void;
}>;

const KM_PER_LATITUDE_DEGREE = 111.32;
const CENTER_LATITUDE = (MAP_BOUNDS.north + MAP_BOUNDS.south) / 2;
const KM_PER_LONGITUDE_DEGREE = KM_PER_LATITUDE_DEGREE * Math.cos((CENTER_LATITUDE * Math.PI) / 180);
const BASE_WIDTH_KM = (MAP_BOUNDS.east - MAP_BOUNDS.west) * KM_PER_LONGITUDE_DEGREE;
const BASE_HEIGHT_KM = (MAP_BOUNDS.north - MAP_BOUNDS.south) * KM_PER_LATITUDE_DEGREE;

function worldCoordinate(point: GeoPoint): Readonly<{ x: number; y: number }> {
  const radians = (Math.max(-85.05112878, Math.min(85.05112878, point.latitude)) * Math.PI) / 180;
  return { x: (point.longitude + 180) / 360, y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 };
}

function geoFromWorld(x: number, y: number): GeoPoint {
  const normalizedY = Math.max(0, Math.min(1, y));
  return {
    longitude: x * 360 - 180,
    latitude: (Math.atan(Math.sinh(Math.PI * (1 - 2 * normalizedY))) * 180) / Math.PI,
  };
}

function clampCenter(point: GeoPoint): GeoPoint {
  return {
    latitude: Math.max(MAP_BOUNDS.south, Math.min(MAP_BOUNDS.north, point.latitude)),
    longitude: Math.max(MAP_BOUNDS.west, Math.min(MAP_BOUNDS.east, point.longitude)),
  };
}

function niceScale(value: number): number {
  const exponent = 10 ** Math.floor(Math.log10(Math.max(value, 0.001)));
  const normalized = value / exponent;
  return (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * exponent;
}

function initialBuilding(point: GeoPoint): DistrictBuilding {
  return {
    id: crypto.randomUUID(),
    kind: 'building',
    point,
    number: '',
    inventoryNumber: '',
    planningDocuments: [],
    workshopFull: '',
    workshopShort: '',
    departments: [{ id: crypto.randomUUID(), fullName: '', shortName: '' }],
    sites: [{ id: crypto.randomUUID(), fullName: '', shortName: '' }],
    note: '',
    updatedAtIso: new Date().toISOString(),
  };
}

const HYDRANT_ACT_SOURCE_PREFIX = 'Источник сведений о состоянии ПГ:';
const HYDRANT_ADMIN_SOURCE_PREFIX = 'Изменения внесены администратором';
const ADMIN_CHANGE_PREFIX = 'Изменения внесены в раздел';

function noteWithoutSourceLines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter((line) =>
    line !== '' && !line.startsWith(HYDRANT_ACT_SOURCE_PREFIX) && !line.startsWith(HYDRANT_ADMIN_SOURCE_PREFIX) && !line.startsWith(ADMIN_CHANGE_PREFIX),
  );
}

function comparable(value: unknown): string {
  return JSON.stringify(value);
}

function changedObjectSections(previous: DistrictMapObject, next: DistrictMapObject): string[] {
  if (previous.kind !== next.kind) return ['Тип объекта'];
  const fields: (readonly [string, unknown, unknown])[] = previous.kind === 'building' && next.kind === 'building'
    ? [
      ['Номер здания', previous.number, next.number],
      ['Инвентарный номер', previous.inventoryNumber ?? '', next.inventoryNumber ?? ''],
      ['Документы предварительного планирования', previous.planningDocuments, next.planningDocuments],
      ['Цех', [previous.workshopFull, previous.workshopShort], [next.workshopFull, next.workshopShort]],
      ['Отделения', previous.departments, next.departments],
      ['Участки', previous.sites, next.sites],
      ['Примечание', noteWithoutSourceLines(previous.note), noteWithoutSourceLines(next.note)],
    ]
    : previous.kind === 'hydrant' && next.kind === 'hydrant'
      ? [
        ['Номер гидранта', previous.number, next.number],
        ['Принадлежность', previous.owner, next.owner],
        ['Техническое состояние', previous.status, next.status],
        ['Характер неисправности', previous.faultDescription, next.faultDescription],
        ['Тип сети', previous.network, next.network],
        ['Вид пожарного гидранта', previous.hydrantType, next.hydrantType],
        ['Образец таблички', previous.pattern, next.pattern],
        ['Диаметр сети', previous.diameterMm, next.diameterMm],
        ['Давление', previous.pressureAtm, next.pressureAtm],
        ['Расстояния на табличке', [previous.signDistanceLeftM, previous.signDistanceRightM, previous.signDistanceForwardM], [next.signDistanceLeftM, next.signDistanceRightM, next.signDistanceForwardM]],
        ['Примечание', noteWithoutSourceLines(previous.note), noteWithoutSourceLines(next.note)],
      ]
      : [];
  return fields.filter(([, before, after]) => comparable(before) !== comparable(after)).map(([label]) => label);
}

function withAdminChangeNote(object: DistrictMapObject, sections: readonly string[]): DistrictMapObject {
  if (sections.length === 0) return object;
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const retained = noteWithoutSourceLines(object.note);
  const sectionLabel = sections.length === 1 ? `раздел «${sections[0]}»` : `разделы: ${sections.map((section) => `«${section}»`).join(', ')}`;
  return { ...object, note: [...retained, `Изменения внесены в ${sectionLabel} администратором ${date}.`].join('\n') };
}

function initialHydrant(point: GeoPoint): DistrictHydrant {
  return {
    id: crypto.randomUUID(),
    kind: 'hydrant',
    point,
    number: '',
    owner: '',
    status: 'unknown',
    faultDescription: '',
    network: 'ring',
    hydrantType: 'standard',
    pattern: 'moscow',
    diameterMm: null,
    pressureAtm: null,
    heightMm: null,
    signDistanceLeftM: null,
    signDistanceRightM: null,
    signDistanceForwardM: null,
    lastInspectionDate: '',
    note: '',
    updatedAtIso: new Date().toISOString(),
  };
}

function normalizedHydrantNumber(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/пг/gu, '').replace(/[^0-9а-яa-z]+/gu, '');
}

function networkFromAct(value: string, fallback: DistrictHydrant['network']): DistrictHydrant['network'] {
  const normalized = value.trim().toLocaleUpperCase('ru-RU').replace(/\s+/gu, '');
  if (normalized.startsWith('КТ') || normalized.startsWith('К-Т')) return 'ring-with-dead-ends';
  if (normalized.startsWith('Т')) return 'dead-end';
  if (normalized.startsWith('К')) return 'ring';
  return fallback;
}

function diameterFromAct(value: string, fallback: number | null): number | null {
  const match = /(?:^|[-–—\s])(\d{2,4})(?:\D|$)/u.exec(value.trim());
  return match?.[1] === undefined ? fallback : Number.parseInt(match[1], 10);
}

function pressureFromAct(value: string, fallback: number | null): number | null {
  const match = /(\d+(?:[.,]\d+)?)/u.exec(value.replace(/\s+/gu, '').trim());
  if (match?.[1] === undefined) return fallback;
  const parsed = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function NamedUnitsEditor({ label, units, onChange }: Readonly<{
  label: 'Отделение' | 'Участок';
  units: readonly DistrictNamedUnit[];
  onChange: (units: readonly DistrictNamedUnit[]) => void;
}>) {
  const rows = units.length === 0 ? [{ id: crypto.randomUUID(), fullName: '', shortName: '' }] : units;
  const patch = (id: string, changes: Partial<DistrictNamedUnit>) => onChange(rows.map((unit) => unit.id === id ? { ...unit, ...changes } : unit));
  return (
    <fieldset className="district-repeatable-fields">
      <legend><span>{label}</span><button type="button" aria-label={`Добавить ${label.toLocaleLowerCase('ru-RU')}`} title={`Добавить ${label.toLocaleLowerCase('ru-RU')}`} onClick={() => onChange([...rows, { id: crypto.randomUUID(), fullName: '', shortName: '' }])}><UiIcon name="plus" /></button></legend>
      {rows.map((unit, index) => (
        <div className="paired-field repeatable-row" key={unit.id}>
          <label>{label} {rows.length > 1 ? index + 1 : ''} — полное название<input value={unit.fullName} onChange={(event) => patch(unit.id, { fullName: event.currentTarget.value })} /></label>
          <label>Сокращённо<input value={unit.shortName} placeholder="Необязательно" onChange={(event) => patch(unit.id, { shortName: event.currentTarget.value })} /></label>
          {rows.length > 1 && <button type="button" className="remove-unit" aria-label={`Удалить ${label.toLocaleLowerCase('ru-RU')} ${index + 1}`} onClick={() => onChange(rows.filter((item) => item.id !== unit.id))}><UiIcon name="close" /></button>}
        </div>
      ))}
    </fieldset>
  );
}

function PlanningDocumentsEditor({ documents, onChange }: Readonly<{
  documents: readonly DistrictPlanningDocument[];
  onChange: (documents: readonly DistrictPlanningDocument[]) => void;
}>) {
  const patch = (id: string, changes: Partial<DistrictPlanningDocument>) => onChange(documents.map((document) => document.id === id ? { ...document, ...changes } : document));
  const kinds: readonly DistrictPlanningDocumentKind[] = ['ПТП', 'КТП', 'ПМЛА', 'ПЛРН'];
  return (
    <fieldset className="district-repeatable-fields planning-document-fields">
      <legend><span>Документы предварительного планирования</span><button type="button" aria-label="Добавить документ" title="Добавить документ" onClick={() => onChange([...documents, { id: crypto.randomUUID(), kind: 'ПТП', number: '' }])}><UiIcon name="plus" /></button></legend>
      {documents.map((document, index) => (
        <div className="paired-field repeatable-row" key={document.id}>
          <label>Вид документа {documents.length > 1 ? index + 1 : ''}<select value={document.kind} onChange={(event) => patch(document.id, { kind: event.currentTarget.value as DistrictPlanningDocumentKind })}>{kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          <label>Номер документа<input value={document.number} placeholder="Необязательно" onChange={(event) => patch(document.id, { number: event.currentTarget.value })} /></label>
          <button type="button" className="remove-unit" aria-label={`Удалить документ ${index + 1}`} onClick={() => onChange(documents.filter((item) => item.id !== document.id))}><UiIcon name="close" /></button>
        </div>
      ))}
    </fieldset>
  );
}

function ObjectEditor({ object, objects, onSave, onClose }: Readonly<{
  object: DistrictMapObject;
  objects: readonly DistrictMapObject[];
  onSave: (object: DistrictMapObject) => void;
  onClose: () => void;
}>) {
  const [value, setValue] = useState<DistrictMapObject>(object);
  const [error, setError] = useState('');
  const patch = (changes: Partial<DistrictMapObject>) => setValue((current) => ({ ...current, ...changes }) as DistrictMapObject);
  const save = () => {
    const number = value.number.trim();
    if (number === '') { setError('Укажите номер объекта.'); return; }
    if (value.kind === 'building' && !/^\d+\.\d+$/u.test(number)) { setError('Номер здания должен иметь формат 3.15.'); return; }
    if (objects.some((item) => item.id !== value.id && item.kind === value.kind && item.number.trim().toLocaleLowerCase('ru-RU') === number.toLocaleLowerCase('ru-RU'))) {
      setError('Объект с таким номером уже существует.');
      return;
    }
    if (value.kind === 'building' && value.workshopFull.trim() === '') {
      setError('Заполните полное название цеха.');
      return;
    }
    if (value.kind === 'hydrant' && value.owner.trim() === '') { setError('Укажите принадлежность гидранта.'); return; }
    let normalized: DistrictMapObject = value.kind === 'building' ? {
      ...value,
      departments: value.departments.filter((unit) => unit.fullName.trim() !== '' || unit.shortName.trim() !== ''),
      sites: value.sites.filter((unit) => unit.fullName.trim() !== '' || unit.shortName.trim() !== ''),
      planningDocuments: value.planningDocuments.filter((document) => document.number.trim() !== ''),
    } : value;
    const previous = objects.find((item) => item.id === value.id);
    if (previous !== undefined) normalized = withAdminChangeNote(normalized, changedObjectSections(previous, normalized));
    onSave({ ...normalized, number, updatedAtIso: new Date().toISOString() });
  };

  return (
    <div className="dialog-backdrop district-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="district-object-editor" role="dialog" aria-modal="true" aria-labelledby="district-editor-title">
        <button className="dialog-close" aria-label="Закрыть" onClick={onClose}><UiIcon name="close" /></button>
        <div className="district-editor-heading">
          {value.kind === 'building'
            ? <span className="editor-building-symbol">№</span>
            : <HydrantPlanSymbol object={value} className="editor-hydrant-symbol" />}
          <div><small>Карточка объекта</small><h2 id="district-editor-title">{value.kind === 'building' ? 'Здание' : 'Пожарный гидрант'}</h2></div>
        </div>
        {value.kind === 'building' ? (
          <div className="district-editor-fields">
            <label className="number-field">Номер здания<input autoFocus value={value.number} placeholder="Например, 3.15" onChange={(event) => patch({ number: event.currentTarget.value })} /></label>
            <div className="building-reference-fields">
              <label>Инвентарный номер здания<input value={value.inventoryNumber ?? ''} placeholder="Необязательно" onChange={(event) => patch({ inventoryNumber: event.currentTarget.value })} /></label>
            </div>
            <PlanningDocumentsEditor documents={value.planningDocuments} onChange={(planningDocuments) => patch({ planningDocuments })} />
            <div className="paired-field"><label>Цех — полное название<input value={value.workshopFull} onChange={(event) => patch({ workshopFull: event.currentTarget.value })} /></label><label>Сокращённо<input value={value.workshopShort} placeholder="—" onChange={(event) => patch({ workshopShort: event.currentTarget.value })} /></label></div>
            <NamedUnitsEditor label="Отделение" units={value.departments} onChange={(departments) => patch({ departments })} />
            <NamedUnitsEditor label="Участок" units={value.sites} onChange={(sites) => patch({ sites })} />
          </div>
        ) : (
          <div className="district-editor-fields hydrant-editor-layout">
            <HydrantIndicatorPlate object={value} editable onChange={(changes) => patch(changes)} />
            <div className="paired-field equal"><label>Номер гидранта<input autoFocus value={value.number} placeholder="ПГ-17" onChange={(event) => patch({ number: event.currentTarget.value })} /></label><label>Принадлежность<input value={value.owner} onChange={(event) => patch({ owner: event.currentTarget.value })} /></label></div>
            <div className="paired-field equal"><label>Состояние<select value={value.status} onChange={(event) => patch({ status: event.currentTarget.value as DistrictHydrant['status'] })}><option value="unknown">Не заполнено</option><option value="serviceable">Исправен</option><option value="faulty">Неисправен</option><option value="disabled">Временно отключён</option></select></label><label>Вид пожарного гидранта<select value={value.hydrantType} onChange={(event) => patch({ hydrantType: event.currentTarget.value as DistrictHydrant['hydrantType'] })}><option value="standard">Обычный пожарный гидрант</option><option value="foam">Пенный пожарный гидрант</option><option value="dry-riser">Пожарный гидрант в виде сухотруба</option></select></label></div>
            <label>Давление, атм.<input type="number" min="0" step="0.1" value={value.pressureAtm ?? ''} placeholder="Заполняется вручную или из акта проверки" onChange={(event) => patch({ pressureAtm: event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber })} /></label>
            <label>Характер неисправности<input value={value.faultDescription} placeholder="Заполняется вручную или из акта проверки" onChange={(event) => patch({ faultDescription: event.currentTarget.value })} /></label>
          </div>
        )}
        <label className="district-editor-note">Примечание<textarea value={value.note} rows={3} onChange={(event) => patch({ note: event.currentTarget.value })} /></label>
        <p className="district-coordinate">Координаты: {value.point.latitude.toFixed(6)}° с.ш., {value.point.longitude.toFixed(6)}° в.д.</p>
        {error !== '' && <p className="district-editor-error">{error}</p>}
        <div className="district-editor-actions"><button className="secondary" onClick={onClose}>Отмена</button><button className="primary" onClick={save}>Сохранить объект</button></div>
      </section>
    </div>
  );
}

function ObjectDetails({ object, adminMode, onEdit, onDelete }: Readonly<{
  object: DistrictMapObject | null;
  adminMode: boolean;
  onEdit: () => void;
  onDelete: () => void;
}>) {
  if (object === null) return null;
  return (
    <article className={`district-details-card ${object.kind}`}>
      <div className="district-details-title">
        {object.kind === 'building' ? <span>{object.number}</span> : null}
        <div><small>{object.kind === 'building' ? 'Здание' : 'Пожарный гидрант'}</small><h2>{districtObjectTitle(object)}</h2></div>
      </div>
      {object.kind === 'building' ? (
        <dl>
          <div><dt>Цех</dt><dd>{object.workshopFull}<small>{object.workshopShort || '—'}</small></dd></div>
          {(object.inventoryNumber ?? '').trim() !== '' && <div><dt>Инвентарный номер здания</dt><dd>{object.inventoryNumber}</dd></div>}
          {object.planningDocuments.map((document) => <div key={document.id}><dt>{document.kind}</dt><dd>{document.number}</dd></div>)}
          {object.departments.map((unit, index) => <div key={unit.id}><dt>Отделение{object.departments.length > 1 ? ` ${index + 1}` : ''}</dt><dd>{unit.fullName || '—'}<small>{unit.shortName || 'Без сокращения'}</small></dd></div>)}
          {object.sites.map((unit, index) => <div key={unit.id}><dt>Участок{object.sites.length > 1 ? ` ${index + 1}` : ''}</dt><dd>{unit.fullName || '—'}<small>{unit.shortName || 'Без сокращения'}</small></dd></div>)}
        </dl>
      ) : (
        <>
          <HydrantIndicatorPlate object={object} />
          <dl>
            <div><dt>Номер</dt><dd>{object.number}</dd></div>
            <div><dt>Принадлежность</dt><dd>{object.owner}</dd></div>
            <div><dt>Состояние</dt><dd><span className={`hydrant-status ${object.status}`}>{HYDRANT_STATUS_LABELS[object.status]}</span></dd></div>
            {object.hydrantType !== 'standard' && <div><dt>Вид ПГ</dt><dd>{HYDRANT_TYPE_LABELS[object.hydrantType]}</dd></div>}
            {object.pressureAtm !== null && <div><dt>Давление</dt><dd>{object.pressureAtm.toLocaleString('ru-RU')} атм.</dd></div>}
            <div className="district-details-long-row"><dt>Характер неисправности</dt><dd>{object.faultDescription.trim() || 'Не выявлен'}</dd></div>
          </dl>
        </>
      )}
      {object.note !== '' && <div className="district-details-note"><strong>Примечание</strong><p>{object.note}</p></div>}
      <p className="district-details-coordinates">{object.point.latitude.toFixed(6)}° с.ш.<br />{object.point.longitude.toFixed(6)}° в.д.</p>
      {adminMode && <div className="district-details-actions"><button onClick={onEdit}>Редактировать</button><button className="danger" onClick={onDelete}>Удалить</button></div>}
    </article>
  );
}

export function DistrictMapPage(props: Props) {
  const [center, setCenter] = useState<GeoPoint>(MAP_INITIAL_CENTER);
  const [zoom, setZoom] = useState(1.65);
  const [viewSize, setViewSize] = useState({ width: 1000, height: 700 });
  const [showBuildings, setShowBuildings] = useState(true);
  const [showHydrants, setShowHydrants] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchHighlightedId, setSearchHighlightedId] = useState<string | null>(null);
  const [editorObject, setEditorObject] = useState<DistrictMapObject | null>(null);
  const [contextMenu, setContextMenu] = useState<{ point: GeoPoint; x: number; y: number } | null>(null);
  const [actImportStatus, setActImportStatus] = useState('');
  const [actImporting, setActImporting] = useState(false);
  const [pendingHydrantAct, setPendingHydrantAct] = useState<Readonly<{ fileName: string; result: HydrantActParseResult }> | null>(null);
  const [panning, setPanning] = useState(false);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<readonly GeoPoint[]>([]);
  const [searchResetSignal, setSearchResetSignal] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const actInputRef = useRef<HTMLInputElement>(null);
  const panRef = useRef<{ pointerId: number; clientX: number; clientY: number; center: GeoPoint } | null>(null);
  const rulerRightPanRef = useRef<{ pointerId: number; clientX: number; clientY: number; center: GeoPoint; timer: number; active: boolean } | null>(null);
  const suppressRulerContextMenuRef = useRef(false);
  const touchPointsRef = useRef(new Map<number, { clientX: number; clientY: number }>());
  const touchTapRef = useRef(new Map<number, { clientX: number; clientY: number; moved: boolean }>());
  const touchHadMultipleRef = useRef(false);
  const pinchRef = useRef<{ distance: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; objectId: string; clientX: number; clientY: number; active: boolean } | null>(null);
  const markerInteractionRef = useRef(false);
  const objectsRef = useRef(props.objects);
  objectsRef.current = props.objects;

  useEffect(() => {
    const element = stageRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setViewSize({ width: Math.max(1, Math.round(entry.contentRect.width)), height: Math.max(1, Math.round(entry.contentRect.height)) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const projection = useMemo(() => {
    const scale = zoom * Math.min(viewSize.width / BASE_WIDTH_KM, viewSize.height / BASE_HEIGHT_KM);
    const centerWorld = worldCoordinate(center);
    const circumferenceAtCenterKm = 40_075 * Math.cos((center.latitude * Math.PI) / 180);
    const worldPixels = scale * circumferenceAtCenterKm;
    return {
      scale,
      worldPixels,
      project: (point: GeoPoint) => {
        const world = worldCoordinate(point);
        return { x: viewSize.width / 2 + (world.x - centerWorld.x) * worldPixels, y: viewSize.height / 2 + (world.y - centerWorld.y) * worldPixels };
      },
      unproject: (x: number, y: number) => geoFromWorld(centerWorld.x + (x - viewSize.width / 2) / worldPixels, centerWorld.y + (y - viewSize.height / 2) / worldPixels),
    };
  }, [center, viewSize.height, viewSize.width, zoom]);
  const mapLibreZoom = Math.max(0, Math.min(22, Math.log2(projection.worldPixels / 512)));
  const markerDetailLevel = zoom >= 4.2 ? 'full' : 'compact';
  const markerScale = Math.max(0.2, Math.min(1, zoom / 4.8));
  const scaleDistanceKm = niceScale(viewSize.width / projection.scale / 5);
  const scalePixels = scaleDistanceKm * projection.scale;
  const selected = props.objects.find((object) => object.id === selectedId) ?? null;
  const visibleObjects = props.objects.filter((object) => object.id === searchHighlightedId || (object.kind === 'building' ? showBuildings : showHydrants));
  const markerPlacements = useMemo(() => {
    const raw = visibleObjects.map((object) => ({ object, ...projection.project(object.point) }));
    return declutterDistrictMarkers(raw, viewSize.width, viewSize.height);
  }, [projection, viewSize.height, viewSize.width, visibleObjects]);
  const orderedMarkerPlacements = [...markerPlacements].sort((left, right) => {
    const priority = (id: string) => id === hoveredId ? 2 : id === selectedId || id === searchHighlightedId ? 1 : 0;
    return priority(left.object.id) - priority(right.object.id);
  });

  const locate = (clientX: number, clientY: number): GeoPoint | null => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect === undefined) return null;
    return projection.unproject((clientX - rect.left) / rect.width * viewSize.width, (clientY - rect.top) / rect.height * viewSize.height);
  };
  const focusObject = (object: DistrictMapObject) => {
    setCenter(object.point);
    setZoom((current) => Math.max(current, 4.5));
    setSelectedId(object.id);
  };
  const clearMapSelection = () => {
    setSelectedId(null);
    setSearchHighlightedId(null);
    setSearchResetSignal((current) => current + 1);
  };
  const changeZoom = (factor: number, anchor?: GeoPoint) => setZoom((currentZoom) => {
    const nextZoom = Math.max(0.45, Math.min(24, currentZoom * factor));
    const appliedFactor = nextZoom / currentZoom;
    if (anchor !== undefined && Math.abs(appliedFactor - 1) > 0.0001) {
      setCenter((currentCenter) => {
        const anchorWorld = worldCoordinate(anchor);
        const currentWorld = worldCoordinate(currentCenter);
        return clampCenter(geoFromWorld(
          anchorWorld.x - (anchorWorld.x - currentWorld.x) / appliedFactor,
          anchorWorld.y - (anchorWorld.y - currentWorld.y) / appliedFactor,
        ));
      });
    }
    return nextZoom;
  });
  useEffect(() => {
    const element = stageRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = (event.clientX - rect.left) / rect.width * viewSize.width;
      const y = (event.clientY - rect.top) / rect.height * viewSize.height;
      const anchor = worldCoordinate(projection.unproject(x, y));
      const nextZoom = Math.max(0.45, Math.min(24, zoom * (event.deltaY < 0 ? 1.16 : 1 / 1.16)));
      if (Math.abs(nextZoom - zoom) < 0.0001) return;
      const firstWorldPixels = projection.worldPixels * nextZoom / zoom;
      const firstCenter = geoFromWorld(anchor.x - (x - viewSize.width / 2) / firstWorldPixels, anchor.y - (y - viewSize.height / 2) / firstWorldPixels);
      const scale = nextZoom * Math.min(viewSize.width / BASE_WIDTH_KM, viewSize.height / BASE_HEIGHT_KM);
      const refinedWorldPixels = scale * 40_075 * Math.cos((firstCenter.latitude * Math.PI) / 180);
      setCenter(clampCenter(geoFromWorld(anchor.x - (x - viewSize.width / 2) / refinedWorldPixels, anchor.y - (y - viewSize.height / 2) / refinedWorldPixels)));
      setZoom(nextZoom);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [projection, viewSize.height, viewSize.width, zoom]);
  const upsertObject = (object: DistrictMapObject) => {
    const next = props.objects.some((item) => item.id === object.id) ? props.objects.map((item) => item.id === object.id ? object : item) : [...props.objects, object];
    props.onCommitObjects(next);
    setSelectedId(object.id);
    setEditorObject(null);
  };
  const deleteSelected = () => {
    if (selected === null || !window.confirm(`Удалить «${districtObjectTitle(selected)}» из проекта?`)) return;
    props.onCommitObjects(props.objects.filter((item) => item.id !== selected.id));
    setSelectedId(null);
  };
  const importHydrantAct = async (file: File) => {
    setActImporting(true);
    setPendingHydrantAct(null);
    setActImportStatus(`Читаю акт «${file.name}»…`);
    try {
      const result = await parseHydrantActFile(file);
      if (result.rows.length === 0) {
        setActImportStatus('В акте не найдены строки с номером и состоянием пожарного гидранта. Данные карты не изменены.');
        return;
      }
      const duplicateNumbers = new Set(result.duplicateNumbers);
      const rows = result.rows.filter((row) => !duplicateNumbers.has(row.number));
      const rowsByNumber = new Map(rows.map((row) => [normalizedHydrantNumber(row.number), row]));
      const mapNumbers = new Set(props.objects
        .filter((object): object is DistrictHydrant => object.kind === 'hydrant')
        .map((object) => normalizedHydrantNumber(object.number)));
      const matched = props.objects
        .filter((object): object is DistrictHydrant => object.kind === 'hydrant')
        .filter((object) => rowsByNumber.has(normalizedHydrantNumber(object.number)))
        .length;
      const actOnly = rows.filter((row) => !mapNumbers.has(normalizedHydrantNumber(row.number))).map((row) => `ПГ-${row.number}`);
      const mapOnly = props.objects
        .filter((object): object is DistrictHydrant => object.kind === 'hydrant')
        .filter((object) => !rowsByNumber.has(normalizedHydrantNumber(object.number)))
        .map((object) => object.number);
      const serviceable = rows.filter((row) => row.status === 'serviceable').length;
      const faulty = rows.filter((row) => row.status === 'faulty').length;
      const notChecked = rows.filter((row) => row.status === 'unknown').length;
      setPendingHydrantAct({ fileName: file.name, result });
      const details = [
        `Акт прочитан: строк — ${result.rows.length}, совпадений с картой — ${matched}. Исправных — ${serviceable}, неисправных — ${faulty}, не проверено — ${notChecked}.`,
        actOnly.length === 0 ? '' : `Нет на карте: ${actOnly.join(', ')}.`,
        mapOnly.length === 0 ? '' : `Нет в акте: ${mapOnly.join(', ')}.`,
        result.duplicateNumbers.length === 0 ? '' : `Не обновлены повторяющиеся номера: ${result.duplicateNumbers.map((number) => `ПГ-${number}`).join(', ')}.`,
        'Проверьте итог и нажмите кнопку применения данных.',
      ].filter(Boolean);
      setActImportStatus(details.join(' '));
    } catch (error) {
      setActImportStatus(`Не удалось обработать акт: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
    } finally {
      setActImporting(false);
    }
  };

  const applyHydrantAct = () => {
    if (pendingHydrantAct === null) return;
    const duplicateNumbers = new Set(pendingHydrantAct.result.duplicateNumbers);
    const rows = pendingHydrantAct.result.rows.filter((row) => !duplicateNumbers.has(row.number));
    const rowsByNumber = new Map(rows.map((row) => [normalizedHydrantNumber(row.number), row]));
    const loadedAt = new Date();
    const loadedAtIso = loadedAt.toISOString();
    const loadedAtLabel = loadedAt.toLocaleDateString('ru-RU');
    const sourceNote = `${HYDRANT_ACT_SOURCE_PREFIX} акт проверки наружного противопожарного водоснабжения «${pendingHydrantAct.fileName}». Дата загрузки: ${loadedAtLabel}.`;
    let updated = 0;
    const next = props.objects.map((object) => {
      if (object.kind !== 'hydrant') return object;
      const row = rowsByNumber.get(normalizedHydrantNumber(object.number));
      if (row === undefined) return object;
      updated += 1;
      const retainedNote = noteWithoutSourceLines(object.note);
      return {
        ...object,
        status: row.status,
        faultDescription: row.faultDescription,
        network: networkFromAct(row.networkLabel, object.network),
        diameterMm: diameterFromAct(row.networkLabel, object.diameterMm),
        pressureAtm: pressureFromAct(row.pressureLabel, object.pressureAtm),
        hydrantType: /в\s*виде\s*пс/iu.test(row.networkLabel) ? 'dry-riser' : object.hydrantType,
        lastInspectionDate: pendingHydrantAct.result.inspectionDate || object.lastInspectionDate,
        note: [...retainedNote, sourceNote].join('\n'),
        updatedAtIso: loadedAtIso,
      };
    });
    props.onCommitObjects(next);
    setPendingHydrantAct(null);
    setActImportStatus(`Данные акта применены к ${updated} пожарным гидрантам. Состояние, причина неисправности, сеть, диаметр, давление и источник сведений записаны в карточки.`);
  };

  const onMapPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (rulerActive && event.button === 2) {
      event.preventDefault();
      const held = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        center,
        timer: 0,
        active: false,
      };
      held.timer = window.setTimeout(() => {
        if (rulerRightPanRef.current?.pointerId !== event.pointerId) return;
        rulerRightPanRef.current.active = true;
        setPanning(true);
      }, 320);
      rulerRightPanRef.current = held;
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || dragRef.current !== null) return;
    if (event.pointerType === 'touch') {
      event.preventDefault();
      if (touchPointsRef.current.size === 0) touchHadMultipleRef.current = false;
      touchPointsRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      touchTapRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY, moved: false });
      if (touchPointsRef.current.size >= 2) {
        touchHadMultipleRef.current = true;
        panRef.current = null;
        setPanning(false);
        const [first, second] = [...touchPointsRef.current.values()];
        if (first !== undefined && second !== undefined) {
          pinchRef.current = { distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)) };
        }
      } else {
        setContextMenu(null);
        panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, center };
        setPanning(true);
      }
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (rulerActive) {
      event.preventDefault();
      const point = locate(event.clientX, event.clientY);
      if (point !== null) setRulerPoints((current) => [...current, point]);
      return;
    }
    markerInteractionRef.current = (event.target as Element).closest('.district-map-marker') !== null;
    setContextMenu(null);
    panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, center };
    svgRef.current?.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rulerPan = rulerRightPanRef.current;
    if (rulerPan?.pointerId === event.pointerId) {
      if (!rulerPan.active) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const startWorld = worldCoordinate(rulerPan.center);
      setCenter(clampCenter(geoFromWorld(
        startWorld.x - ((event.clientX - rulerPan.clientX) / rect.width * viewSize.width) / projection.worldPixels,
        startWorld.y - ((event.clientY - rulerPan.clientY) / rect.height * viewSize.height) / projection.worldPixels,
      )));
      return;
    }
    if (event.pointerType === 'touch' && touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      const tap = touchTapRef.current.get(event.pointerId);
      if (tap !== undefined && Math.hypot(event.clientX - tap.clientX, event.clientY - tap.clientY) > 8) tap.moved = true;
      if (touchPointsRef.current.size >= 2) {
        const [first, second] = [...touchPointsRef.current.values()];
        if (first !== undefined && second !== undefined) {
          const distance = Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY));
          const prior = pinchRef.current?.distance ?? distance;
          const anchor = locate((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2);
          if (Math.abs(distance - prior) > 1) changeZoom(distance / prior, anchor ?? undefined);
          pinchRef.current = { distance };
        }
        return;
      }
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      if (!dragRef.current.active) {
        if (Math.hypot(event.clientX - dragRef.current.clientX, event.clientY - dragRef.current.clientY) < 8) return;
        dragRef.current.active = true;
        props.onObjectChangeStart();
      }
      const point = locate(event.clientX, event.clientY);
      if (point !== null) {
        const next = objectsRef.current.map((item) => item.id === dragRef.current?.objectId ? { ...item, point, updatedAtIso: new Date().toISOString() } : item);
        objectsRef.current = next;
        props.onObjectsChange(next);
      }
      return;
    }
    const pan = panRef.current;
    if (pan?.pointerId !== event.pointerId) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const startWorld = worldCoordinate(pan.center);
    setCenter(clampCenter(geoFromWorld(
      startWorld.x - ((event.clientX - pan.clientX) / rect.width * viewSize.width) / projection.worldPixels,
      startWorld.y - ((event.clientY - pan.clientY) / rect.height * viewSize.height) / projection.worldPixels,
    )));
  };
  const finishPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (rulerRightPanRef.current?.pointerId === event.pointerId) {
      const completed = rulerRightPanRef.current;
      window.clearTimeout(completed.timer);
      rulerRightPanRef.current = null;
      if (completed.active) suppressRulerContextMenuRef.current = true;
      else setRulerPoints([]);
    }
    const touchTap = event.pointerType === 'touch' ? touchTapRef.current.get(event.pointerId) : undefined;
    const shouldAddRulerPoint = rulerActive
      && event.type !== 'pointercancel'
      && touchTap !== undefined
      && !touchTap.moved
      && !touchHadMultipleRef.current;
    touchTapRef.current.delete(event.pointerId);
    touchPointsRef.current.delete(event.pointerId);
    if (touchPointsRef.current.size < 2) pinchRef.current = null;
    if (touchPointsRef.current.size === 0) touchHadMultipleRef.current = false;
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    if (shouldAddRulerPoint) {
      const point = locate(event.clientX, event.clientY);
      if (point !== null) setRulerPoints((current) => [...current, point]);
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      const completedDrag = dragRef.current;
      dragRef.current = null;
      if (completedDrag.active) {
        const changed = objectsRef.current.map((item) => item.id === completedDrag.objectId
          ? withAdminChangeNote(item, ['Координаты объекта'])
          : item);
        objectsRef.current = changed;
        props.onCommitObjects(changed);
      }
    }
    setPanning(false);
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  };

  return (
    <div className={`district-workspace${selected === null ? '' : ' details-open'}`}>
      <main className="district-map-column">
        <div className="district-map-topbar">
          <div className="segmented district-basemap-switch">
            <button className={props.basemap === 'standard' ? 'active' : ''} onClick={() => props.onBasemapChange('standard')}>Карта</button>
            <button className={props.basemap === 'satellite' ? 'active' : ''} onClick={() => props.onBasemapChange('satellite')}>Спутник</button>
          </div>
          <DistrictObjectToolbar
            objects={props.objects}
            showBuildings={showBuildings}
            showHydrants={showHydrants}
            onShowBuildingsChange={setShowBuildings}
            onShowHydrantsChange={setShowHydrants}
            onFocus={focusObject}
            onSearchSelectionChange={(object) => setSearchHighlightedId(object?.id ?? null)}
            resetSignal={searchResetSignal}
            compact
          />
        </div>
        <div className={`district-map-surface ${props.basemap}`} ref={stageRef}>
          <OfflineBasemap center={center} zoom={mapLibreZoom} basemap={props.basemap} />
          <svg
            ref={svgRef}
            className={`${panning ? 'panning' : ''}${rulerActive ? ' ruler-active' : ''}`.trim()}
            viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}
            onPointerDown={onMapPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
            onLostPointerCapture={finishPointer}
            onContextMenu={(event) => {
              event.preventDefault();
              if (suppressRulerContextMenuRef.current) {
                suppressRulerContextMenuRef.current = false;
                return;
              }
              if (rulerActive) {
                setRulerPoints([]);
                return;
              }
              if (!props.adminMode) return;
              const point = locate(event.clientX, event.clientY);
              const rect = stageRef.current?.getBoundingClientRect();
              if (point !== null && rect !== undefined) setContextMenu({ point, x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
            onClick={(event) => {
              if (markerInteractionRef.current) {
                markerInteractionRef.current = false;
                return;
              }
              const target = event.target as SVGElement;
              if (target === event.currentTarget || target.classList.contains('map-base')) clearMapSelection();
            }}
            aria-label="Карта района выезда"
          >
            <rect width={viewSize.width} height={viewSize.height} className="map-base" />
            {orderedMarkerPlacements.map(({ object, x, y }) => {
              const dragProps = props.adminMode ? {
                onPointerDown: (event: ReactPointerEvent<SVGGElement>) => {
                  if (rulerActive || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  markerInteractionRef.current = true;
                  dragRef.current = { pointerId: event.pointerId, objectId: object.id, clientX: event.clientX, clientY: event.clientY, active: false };
                  svgRef.current?.setPointerCapture(event.pointerId);
                  setSelectedId(object.id);
                },
              } : {};
              return <DistrictMapMarker key={object.id} object={object} x={x} y={y} selected={selectedId === object.id} highlighted={searchHighlightedId === object.id} editing={props.adminMode} detailLevel={markerDetailLevel} scale={markerScale} interactionDisabled={rulerActive} onSelect={() => setSelectedId(object.id)} onHoverChange={(hovered) => setHoveredId(hovered ? object.id : null)} {...dragProps} />;
            })}
            <MapRulerOverlay points={rulerPoints} project={projection.project} />
          </svg>
          {contextMenu !== null && <div className="district-add-menu" style={{ left: contextMenu.x, top: contextMenu.y }}><strong>Добавить на карту</strong><button onClick={() => { setEditorObject(initialBuilding(contextMenu.point)); setContextMenu(null); }}>Номер здания</button><button onClick={() => { setEditorObject(initialHydrant(contextMenu.point)); setContextMenu(null); }}>Пожарный гидрант</button><button className="secondary" onClick={() => setContextMenu(null)}>Отмена</button></div>}
          <CompassRose className="district-compass" />
          <div className="zoom district-zoom"><button aria-label="Отдалить" onClick={() => changeZoom(1 / 1.4)}>−</button><span>{round(zoom * 100, 0)}%</span><button aria-label="Приблизить" onClick={() => changeZoom(1.4)}>+</button></div>
          <button type="button" className={`map-ruler-control district-ruler-control${rulerActive ? ' active' : ''}`} aria-pressed={rulerActive} title="Линейка: ЛКМ — точки; удержание ПКМ — перемещение карты; короткая ПКМ — сброс" aria-label="Измерить расстояние" onClick={() => { setRulerActive((current) => !current); setRulerPoints([]); }}><img src={appAssetUrl('assets/ruler-glossy.png')} alt="" /></button>
          <div className="map-scale district-map-scale" style={{ width: `${(scalePixels / viewSize.width) * 100}%` }}><span>{scaleDistanceKm < 1 ? `${round(scaleDistanceKm * 1000, 0)} м` : `${scaleDistanceKm} км`}</span></div>
          <div className="district-map-legend" aria-label="Условные обозначения"><strong>Условные обозначения</strong><span><i className="district-legend-building">3.15</i> Здание</span><span><i className="district-legend-hydrant" /> Пожарный гидрант</span></div>
          <div className="district-map-attribution">{props.basemap === 'standard' ? '© OpenStreetMap contributors' : 'Спутник: Esri World Imagery · автономная копия'}</div>
        </div>
      </main>
      {selected !== null && <aside className="district-details-panel">
        <div className="district-panel-heading"><span>Объекты района выезда</span></div>
        <ObjectDetails object={selected} adminMode={props.adminMode} onEdit={() => setEditorObject(selected)} onDelete={deleteSelected} />
      </aside>}
      {props.adminMode && props.managementOpen && <div className="dialog-backdrop district-management-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onCloseManagement(); }}>
        <section className="district-management-dialog" role="dialog" aria-modal="true" aria-labelledby="district-management-title">
          <button type="button" className="dialog-close" aria-label="Закрыть" onClick={props.onCloseManagement}><UiIcon name="close" /></button>
          <div className="admin-login-icon"><UiIcon name="settings" /></div>
          <h2 id="district-management-title">Настройка карты</h2>
          <p>Выберите действие. Режим добавления объектов позволяет ставить здания и гидранты правой кнопкой мыши, а также перемещать их по карте.</p>
          <div className="district-management-actions">
            <button className="primary" onClick={props.onCloseManagement}><UiIcon name="pin" /><span><strong>Перейти к настройке карты</strong><small>Добавление, редактирование и перемещение объектов</small></span></button>
            <button type="button" className="district-act-upload" disabled={actImporting} onClick={() => actInputRef.current?.click()}><UiIcon name="upload" /><span><strong>{actImporting ? 'Обрабатываю акт…' : 'Загрузить акт проверки наружного противопожарного водоснабжения'}</strong><small>Word (.docx): состояние и причина неисправности сопоставляются строго по номеру ПГ</small></span></button>
            <input ref={actInputRef} className="district-act-file-input" type="file" accept=".docx,.csv,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,text/plain" aria-label="Выбрать файл акта проверки пожарных гидрантов" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file !== undefined) void importHydrantAct(file); }} />
          </div>
          {actImportStatus !== '' && <p className="district-act-status">{actImportStatus}</p>}
          {pendingHydrantAct !== null && <button type="button" className="primary district-act-apply" onClick={applyHydrantAct}><UiIcon name="check" /><span>Применить данные акта к пожарным гидрантам на карте</span></button>}
          <button className="secondary exit-admin" onClick={() => { props.onCloseManagement(); props.onExitAdmin(); }}>Завершить режим настройки</button>
        </section>
      </div>}
      {editorObject !== null && <ObjectEditor object={editorObject} objects={props.objects} onSave={upsertObject} onClose={() => setEditorObject(null)} />}
    </div>
  );
}
