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
import { DistrictMapMarker, FireReservoirPlanSymbol, HydrantPlanSymbol } from './DistrictMapMarker';
import { declutterDistrictMarkers } from './district-marker-layout';
import { FireDispatchTicket } from './FireDispatchTicket';
import { HydrantIndicatorPlate } from './HydrantIndicatorPlate';
import type {
  DistrictBuilding,
  DistrictBuildingMapRole,
  DistrictFireReservoir,
  DistrictHydrant,
  DistrictMapObject,
  DistrictMapProject,
  DistrictNamedUnit,
  DistrictPlanningDocument,
  DistrictPlanningDocumentKind,
} from './district-map-model';
import {
  districtObjectTitle,
  buildingPrefix,
  FIRE_RESERVOIR_TYPE_LABELS,
  HYDRANT_STATUS_LABELS,
  HYDRANT_TYPE_LABELS,
  parseDistrictMapBackup,
  serializeDistrictMapBackup,
} from './district-map-model';
import { alignOrthogonalContour } from './district-contour-geometry';
import { DistrictObjectToolbar } from './DistrictObjectToolbar';
import { OfflineBasemap } from './OfflineBasemap';
import type { Basemap } from './MapCanvas';
import { UiIcon } from './UiIcon';
import { appAssetUrl } from './app-url';
import { CompassRose } from './CompassRose';
import { parseHydrantActFile, type HydrantActParseResult } from './hydrant-act-import';
import { MapRulerOverlay } from './MapRulerOverlay';
import { DistrictContourHoverCard, DistrictObjectContour } from './DistrictObjectContour';
import { DistrictMapLegend } from './DistrictMapLegend';
import {
  BUILDING_LAYER_KEYS,
  DISTRICT_LAYER_KEYS,
  NPPV_LAYER_KEYS,
  districtLayerKey,
  districtObjectFocusPoint,
  districtObjectMarkerPoint,
  districtResponseBoundaryCenter,
  hasDistrictMarker,
  isBuildingWithContour,
  pointInsideDistrictContour,
  twoTierBuildingMarkerScales,
  type DistrictLayerKey,
} from './district-map-visuals';
import type { MapSyncStatus } from './map-sync-service';

type Props = Readonly<{
  project: DistrictMapProject;
  objects: readonly DistrictMapObject[];
  adminMode: boolean;
  basemap: Basemap;
  onBasemapChange: (value: Basemap) => void;
  onObjectsChange: (objects: readonly DistrictMapObject[]) => void;
  onObjectChangeStart: () => void;
  onTransientHistory: (label: string, undo: () => void, redo: () => void) => void;
  onClearTransientHistory: () => void;
  onCommitObjects: (objects: readonly DistrictMapObject[]) => void;
  managementOpen: boolean;
  onCloseManagement: () => void;
  onExitAdmin: () => void;
  syncStatus: MapSyncStatus;
  localPendingOperations: number;
  syncCheckBusy: boolean;
  onCheckSynchronization: () => void;
  publishBusy: boolean;
  onPublishForAll: () => Promise<Readonly<{ success: boolean; message: string }>>;
  conflictBackupCount: number;
  onDownloadConflictBackup: () => void;
  onClearConflictBackup: () => void;
}>;

type ContourDragState =
  | {
    pointerId: number;
    mode: 'vertex';
    index: number;
    clientX: number;
    clientY: number;
    startPoints: readonly GeoPoint[];
    moved: boolean;
  }
  | {
    pointerId: number;
    mode: 'edge';
    startIndex: number;
    endIndex: number;
    startPointer: GeoPoint;
    startPoints: readonly GeoPoint[];
    moved: boolean;
  };

type ContourDraft = Readonly<{
  objectType: 'building' | 'territory' | 'installation' | 'demolished';
  mapRole: DistrictBuildingMapRole;
  points: readonly GeoPoint[];
  source: 'automatic' | 'manual' | 'editing';
  editingObjectId: string | null;
}>;

const KM_PER_LATITUDE_DEGREE = 111.32;
const CENTER_LATITUDE = (MAP_BOUNDS.north + MAP_BOUNDS.south) / 2;
const KM_PER_LONGITUDE_DEGREE = KM_PER_LATITUDE_DEGREE * Math.cos((CENTER_LATITUDE * Math.PI) / 180);
const BASE_WIDTH_KM = (MAP_BOUNDS.east - MAP_BOUNDS.west) * KM_PER_LONGITUDE_DEGREE;
const BASE_HEIGHT_KM = (MAP_BOUNDS.north - MAP_BOUNDS.south) * KM_PER_LATITUDE_DEGREE;

function synchronizationTime(value: string): string {
  if (value === '') return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function localSynchronizationPacketCount(count: number): string {
  if (count === 0) return 'Все изменения отправлены';
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? 'пакетов' : last === 1 ? 'пакет' : last >= 2 && last <= 4 ? 'пакета' : 'пакетов';
  const verb = last === 1 && lastTwo !== 11 ? 'не отправлен' : 'не отправлены';
  return `${count} ${noun} ${verb}`;
}

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

function pointCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? 'точек' : last === 1 ? 'точка' : last >= 2 && last <= 4 ? 'точки' : 'точек';
  return `${count} ${noun}`;
}

const FIXED_WORKSHOPS: Readonly<Record<string, Readonly<{ full: string; short: string }>>> = {
  '2': { full: 'Цех электролиза никеля', short: 'ЦЭН' },
  '3': { full: 'Рафинировочный цех', short: 'РЦ' },
  '4': { full: 'Химико-металлургический цех', short: 'ХМЦ' },
  '5': { full: 'Цех энергообеспечения', short: 'ЦЭО' },
  '6': { full: 'Цех материально-технического обеспечения', short: 'ЦМТО' },
  '7': { full: 'Транспортный цех', short: 'ТЦ' },
  '8': { full: 'Печенгастрой', short: 'ПС' },
};

const PREFIX_ONE_WORKSHOPS = [
  ['Управление хозяйственной деятельности', 'УХД'],
  ['Контрольно-аналитический центр', 'КАЦ'],
  ['Департамент безопасности', 'ДБ'],
  ['Научно-технический центр', 'НТЦ'],
  ['Центр технического контроля', 'ЦТК'],
] as const;

function buildingWithNumber(object: DistrictBuilding, number: string): DistrictBuilding {
  if (object.objectType === 'installation') return { ...object, number: '0' };
  const prefix = buildingPrefix(number);
  const previousPrefix = buildingPrefix(object.number);
  const fixed = FIXED_WORKSHOPS[prefix];
  if (fixed !== undefined) return { ...object, number, objectType: 'building', workshopFull: fixed.full, workshopShort: fixed.short };
  if (prefix === '0') return { ...object, number, objectType: 'territory', workshopFull: '', workshopShort: '', departments: [], sites: [] };
  if ((prefix === '1' || prefix === '9') && prefix !== previousPrefix) {
    return { ...object, number, objectType: 'building', workshopFull: '', workshopShort: '' };
  }
  return { ...object, number, objectType: 'building' };
}

function initialBuilding(
  point: GeoPoint,
  objectType: 'building' | 'territory' | 'installation' | 'demolished' = 'building',
  contour: readonly GeoPoint[] = [],
  mapRole: DistrictBuildingMapRole = 'ordinary',
): DistrictBuilding {
  const responseBoundary = mapRole === 'response-boundary';
  const rescueService = mapRole === 'rescue-service';
  return {
    id: crypto.randomUUID(),
    kind: 'building',
    objectType,
    mapRole,
    contour,
    territoryNames: objectType === 'territory' ? [{ id: crypto.randomUUID(), fullName: responseBoundary ? 'Граница района выезда' : '', shortName: '' }] : [],
    point,
    number: responseBoundary ? '0.0' : objectType === 'territory' ? '0.' : objectType === 'installation' || objectType === 'demolished' ? '0' : '',
    installationName: '',
    inventoryNumber: '',
    planningDocuments: [],
    workshopFull: rescueService ? 'Аварийно-спасательная служба' : '',
    workshopShort: rescueService ? 'АСС' : '',
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
      ['Тип объекта', previous.objectType, next.objectType],
      ['Назначение контура на карте', previous.mapRole ?? 'ordinary', next.mapRole ?? 'ordinary'],
      ['Контур объекта', previous.contour, next.contour],
      ['Названия территории', previous.territoryNames, next.territoryNames],
      ['Название наружной установки', previous.installationName ?? '', next.installationName ?? ''],
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
      : previous.kind === 'reservoir' && next.kind === 'reservoir'
        ? [
          ['Номер пожарного водоёма', previous.number, next.number],
          ['Принадлежность', previous.owner, next.owner],
          ['Техническое состояние', previous.status, next.status],
          ['Вид пожарного водоёма', previous.reservoirType, next.reservoirType],
          ['Объём', previous.volumeM3, next.volumeM3],
          ['Характер неисправности', previous.faultDescription, next.faultDescription],
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

function initialFireReservoir(point: GeoPoint): DistrictFireReservoir {
  return {
    id: crypto.randomUUID(),
    kind: 'reservoir',
    point,
    number: '',
    owner: '',
    status: 'unknown',
    volumeM3: null,
    faultDescription: '',
    reservoirType: 'artificial',
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
  label: 'Отделение' | 'Участок' | 'Название территории';
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

function ObjectEditor({ object, objects, onSave, onEditContour, onClose }: Readonly<{
  object: DistrictMapObject;
  objects: readonly DistrictMapObject[];
  onSave: (object: DistrictMapObject) => void;
  onEditContour?: (object: DistrictBuilding) => void;
  onClose: () => void;
}>) {
  const [value, setValue] = useState<DistrictMapObject>(() => {
    if (object.kind === 'building' && object.mapRole === 'rescue-service') {
      const legacyName = object.territoryNames.find((unit) => unit.fullName.trim() !== '' || unit.shortName.trim() !== '');
      const currentFullName = object.workshopFull.trim();
      const currentShortName = object.workshopShort.trim();
      const legacyFullName = legacyName?.fullName.trim() ?? '';
      const legacyShortName = legacyName?.shortName.trim() ?? '';
      return {
        ...object,
        objectType: 'building',
        workshopFull: currentFullName !== '' ? currentFullName : legacyFullName !== '' ? legacyFullName : 'Аварийно-спасательная служба',
        workshopShort: currentShortName !== '' ? currentShortName : legacyShortName !== '' ? legacyShortName : 'АСС',
      };
    }
    return object.kind === 'building'
      && buildingPrefix(object.number) === '1'
      && object.workshopFull.trim().toLocaleLowerCase('ru-RU') === 'другое'
      ? { ...object, workshopFull: '', workshopShort: '' }
      : object;
  });
  const [customPrefixOne, setCustomPrefixOne] = useState(() => object.kind === 'building'
    && buildingPrefix(object.number) === '1'
    && !PREFIX_ONE_WORKSHOPS.some(([full]) => full === object.workshopFull));
  const [error, setError] = useState('');
  const patch = (changes: Partial<DistrictMapObject>) => setValue((current) => ({ ...current, ...changes }) as DistrictMapObject);
  const save = () => {
    const number = value.kind === 'building' && value.objectType === 'installation' ? '0' : value.number.trim();
    if (number === '') { setError('Укажите номер объекта.'); return; }
    if (value.kind === 'building' && value.objectType !== 'installation' && !/^\d+\.\d+$/u.test(number)) { setError('Номер здания должен иметь формат 3.15'); return; }
    if (!(value.kind === 'building' && value.objectType === 'installation') && objects.some((item) => item.id !== value.id && item.kind === value.kind && item.number.trim().toLocaleLowerCase('ru-RU') === number.toLocaleLowerCase('ru-RU'))) {
      setError('Объект с таким номером уже существует.');
      return;
    }
    if (value.kind === 'building' && value.mapRole !== undefined && value.mapRole !== 'ordinary'
      && objects.some((item) => item.id !== value.id && item.kind === 'building' && item.mapRole === value.mapRole)) {
      setError(value.mapRole === 'response-boundary' ? 'Граница района выезда уже сохранена.' : 'Объект аварийно-спасательной службы уже сохранён.');
      return;
    }
    if (value.kind === 'building' && value.objectType === 'territory' && !value.territoryNames.some((unit) => unit.fullName.trim() !== '' || unit.shortName.trim() !== '')) {
      setError('Укажите хотя бы одно название территории.');
      return;
    }
    if (value.kind === 'building' && value.objectType === 'building' && value.workshopFull.trim() === '') {
      setError('Заполните полное название цеха.');
      return;
    }
    if (value.kind === 'building' && value.objectType === 'installation' && (value.installationName?.trim() ?? '') === '') {
      setError('Укажите название наружной установки.');
      return;
    }
    if (value.kind === 'building' && value.objectType === 'installation' && value.workshopFull.trim() === '') {
      setError('Укажите цех, к которому относится наружная установка.');
      return;
    }
    if (value.kind !== 'building' && value.owner.trim() === '') { setError('Укажите принадлежность элемента НППВ.'); return; }
    let normalized: DistrictMapObject = value.kind === 'building' ? {
      ...value,
      territoryNames: value.territoryNames.filter((unit) => unit.fullName.trim() !== '' || unit.shortName.trim() !== ''),
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
            ? <span className={`editor-building-symbol prefix-${buildingPrefix(value.number)}${value.mapRole === 'rescue-service' ? ' rescue-service' : ''}`}>{value.mapRole === 'rescue-service' ? 'АСС' : '№'}</span>
            : value.kind === 'hydrant'
              ? <HydrantPlanSymbol object={value} className="editor-hydrant-symbol" />
              : <FireReservoirPlanSymbol object={value} className="editor-reservoir-symbol" />}
          <div><small>Карточка объекта</small><h2 id="district-editor-title">{value.kind === 'building'
            ? value.mapRole === 'response-boundary'
              ? 'Граница района выезда'
              : value.mapRole === 'rescue-service'
                ? 'Объект АСС'
                : value.objectType === 'territory'
                  ? 'Территория'
                  : value.objectType === 'installation' ? 'Наружная установка' : 'Здание'
            : value.kind === 'hydrant' ? 'Пожарный гидрант' : 'Пожарный водоём'}</h2></div>
        </div>
        {value.kind === 'building' && value.mapRole === 'response-boundary' && <p className="district-special-role-banner">Постоянная граница района выезда. После сохранения она будет показана на обеих картах.</p>}
        {value.kind === 'building' && value.mapRole === 'rescue-service' && <p className="district-special-role-banner">Постоянно выделяемый объект аварийно-спасательной службы. После сохранения он будет показан на обеих картах.</p>}
        {value.kind === 'building' ? (
          <div className="district-editor-fields">
            {value.mapRole !== 'rescue-service' && value.objectType !== 'installation' && <label className="number-field">{value.objectType === 'territory' ? 'Номер территории' : 'Номер здания'}<input autoFocus value={value.number} placeholder={value.objectType === 'territory' ? 'Например, 0.1' : 'Например, 3.15'} onChange={(event) => {
              const number = event.currentTarget.value;
              setValue((current) => {
                if (current.kind !== 'building') return current;
                const nextPrefix = buildingPrefix(number);
                if (nextPrefix !== '1' || buildingPrefix(current.number) !== '1') setCustomPrefixOne(false);
                return buildingWithNumber(current, number);
              });
            }} /></label>}
            {value.objectType === 'territory' && value.mapRole !== 'rescue-service' ? (
              <NamedUnitsEditor label="Название территории" units={value.territoryNames} onChange={(territoryNames) => patch({ territoryNames })} />
            ) : value.objectType === 'installation' ? <>
              <div className="district-installation-index"><span>Индекс на карте</span><strong>0</strong></div>
              <label>Название наружной установки<input autoFocus value={value.installationName ?? ''} placeholder="Например, открытая насосная установка" onChange={(event) => patch({ installationName: event.currentTarget.value })} /></label>
              <div className="paired-field"><label>Цех — полное название<input value={value.workshopFull} placeholder="Укажите цех" onChange={(event) => patch({ workshopFull: event.currentTarget.value })} /></label><label>Сокращённое название цеха<input value={value.workshopShort} placeholder="Необязательно" onChange={(event) => patch({ workshopShort: event.currentTarget.value })} /></label></div>
              <PlanningDocumentsEditor documents={value.planningDocuments} onChange={(planningDocuments) => patch({ planningDocuments })} />
            </> : <>
            <div className="building-reference-fields">
              <label>Инвентарный номер здания<input value={value.inventoryNumber ?? ''} placeholder="Необязательно" onChange={(event) => patch({ inventoryNumber: event.currentTarget.value })} /></label>
            </div>
            <PlanningDocumentsEditor documents={value.planningDocuments} onChange={(planningDocuments) => patch({ planningDocuments })} />
            {value.mapRole !== 'rescue-service' && buildingPrefix(value.number) === '1' ? <div className="building-prefix-one-selector"><label>Подразделение<select value={PREFIX_ONE_WORKSHOPS.some(([full]) => full === value.workshopFull) ? value.workshopFull : customPrefixOne ? 'other' : ''} onChange={(event) => { const selected = PREFIX_ONE_WORKSHOPS.find(([full]) => full === event.currentTarget.value); if (selected === undefined) { setCustomPrefixOne(true); patch({ workshopFull: '', workshopShort: '' }); } else { setCustomPrefixOne(false); patch({ workshopFull: selected[0], workshopShort: selected[1] }); } }}><option value="" disabled>Выберите подразделение</option>{PREFIX_ONE_WORKSHOPS.map(([full, short]) => <option key={short} value={full}>{full} ({short})</option>)}<option value="other">Другое — указать вручную</option></select></label></div> : null}
            {(value.mapRole === 'rescue-service' || buildingPrefix(value.number) === '9' || (buildingPrefix(value.number) === '1' && customPrefixOne)) && <div className="paired-field"><label>{value.mapRole === 'rescue-service' ? 'Наименование формирования' : buildingPrefix(value.number) === '9' ? 'Организация — полное название' : 'Подразделение — полное название'}<input value={value.workshopFull} placeholder="Введите полное название" onChange={(event) => patch({ workshopFull: event.currentTarget.value })} /></label><label>Сокращённое название<input value={value.workshopShort} placeholder="АСС" onChange={(event) => patch({ workshopShort: event.currentTarget.value })} /></label></div>}
            {value.mapRole !== 'rescue-service' && FIXED_WORKSHOPS[buildingPrefix(value.number)] !== undefined && <div className="district-auto-workshop"><span>Цех определён по номеру:</span><strong>{value.workshopFull} ({value.workshopShort})</strong></div>}
            <NamedUnitsEditor label="Отделение" units={value.departments} onChange={(departments) => patch({ departments })} />
            <NamedUnitsEditor label="Участок" units={value.sites} onChange={(sites) => patch({ sites })} />
            </>}
          </div>
        ) : value.kind === 'hydrant' ? (
          <div className="district-editor-fields hydrant-editor-layout">
            <HydrantIndicatorPlate object={value} editable onChange={(changes) => patch(changes)} />
            <div className="paired-field equal"><label>Номер гидранта<input autoFocus value={value.number} placeholder="ПГ-17" onChange={(event) => patch({ number: event.currentTarget.value })} /></label><label>Принадлежность<input value={value.owner} onChange={(event) => patch({ owner: event.currentTarget.value })} /></label></div>
            <div className="paired-field equal"><label>Состояние<select value={value.status} onChange={(event) => patch({ status: event.currentTarget.value as DistrictHydrant['status'] })}><option value="unknown">Не заполнено</option><option value="serviceable">Исправен</option><option value="faulty">Неисправен</option><option value="disabled">Временно отключён</option></select></label><label>Вид пожарного гидранта<select value={value.hydrantType} onChange={(event) => patch({ hydrantType: event.currentTarget.value as DistrictHydrant['hydrantType'] })}><option value="standard">Обычный пожарный гидрант</option><option value="foam">Пенный пожарный гидрант</option><option value="dry-riser">Пожарный гидрант в виде сухотруба</option></select></label></div>
            <label>Давление, атм.<input type="number" min="0" step="0.1" value={value.pressureAtm ?? ''} placeholder="Заполняется вручную или из акта проверки" onChange={(event) => patch({ pressureAtm: event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber })} /></label>
            <label>Характер неисправности<input value={value.faultDescription} placeholder="Заполняется вручную или из акта проверки" onChange={(event) => patch({ faultDescription: event.currentTarget.value })} /></label>
          </div>
        ) : (
          <div className="district-editor-fields reservoir-editor-layout">
            <div className="paired-field equal"><label>Номер пожарного водоёма<input autoFocus value={value.number} placeholder="ПВ-1" onChange={(event) => patch({ number: event.currentTarget.value })} /></label><label>Принадлежность<input value={value.owner} onChange={(event) => patch({ owner: event.currentTarget.value })} /></label></div>
            <div className="paired-field equal"><label>Состояние<select value={value.status} onChange={(event) => patch({ status: event.currentTarget.value as DistrictFireReservoir['status'] })}><option value="unknown">Не заполнено</option><option value="serviceable">Исправен</option><option value="faulty">Неисправен</option><option value="disabled">Временно отключён</option></select></label><label>Вид пожарного водоёма<select value={value.reservoirType} onChange={(event) => patch({ reservoirType: event.currentTarget.value as DistrictFireReservoir['reservoirType'] })}><option value="artificial">Искусственный пожарный водоём</option><option value="natural">Естественный пожарный водоём</option><option value="foam">Пенный пожарный водоём</option><option value="foam-solution">Пожарный водоём раствора пенообразователя</option></select></label></div>
            <label>Объём, м³<input type="number" min="0" step="0.1" value={value.volumeM3 ?? ''} placeholder="Укажите объём водоёма" onChange={(event) => patch({ volumeM3: event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber })} /></label>
            <label>Характер неисправности<input value={value.faultDescription} placeholder="Укажите при наличии" onChange={(event) => patch({ faultDescription: event.currentTarget.value })} /></label>
          </div>
        )}
        <label className="district-editor-note">Примечание<textarea value={value.note} rows={3} onChange={(event) => patch({ note: event.currentTarget.value })} /></label>
        <p className="district-coordinate">Координаты: {value.point.latitude.toFixed(6)}° с.ш., {value.point.longitude.toFixed(6)}° в.д.</p>
        {error !== '' && <p className="district-editor-error">{error}</p>}
        <div className="district-editor-actions">
          {value.kind === 'building' && value.contour.length >= (value.mapRole === 'response-boundary' ? 2 : 3) && onEditContour !== undefined && <button className="secondary edit-contour" onClick={() => onEditContour(value)}>Изменить границы на карте</button>}
          <button className="secondary" onClick={onClose}>Отмена</button><button className="primary" onClick={save}>Сохранить объект</button>
        </div>
      </section>
    </div>
  );
}

function ObjectDetails({ object, adminMode, onEdit, onDelete, onOpenDispatch }: Readonly<{
  object: DistrictMapObject | null;
  adminMode: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenDispatch: () => void;
}>) {
  if (object === null) return null;
  const departmentLabels = object.kind === 'building'
    ? object.departments
      .map((unit) => ({ label: unit.shortName.trim() || unit.fullName.trim(), fullName: unit.fullName.trim() }))
      .filter((unit) => unit.label !== '')
    : [];
  const buildingHeaderLabels = object.kind === 'building' && (object.mapRole ?? 'ordinary') === 'ordinary' && object.objectType === 'building'
    ? departmentLabels.length > 0
      ? departmentLabels
      : [{ label: object.workshopShort.trim() || object.workshopFull.trim() || 'Без отделения', fullName: object.workshopFull.trim() }]
    : [];
  return (
    <article className={`district-details-card ${object.kind}${object.kind === 'building' ? ` prefix-${buildingPrefix(object.number)}${object.mapRole === 'rescue-service' ? ' rescue-service' : ''}` : ''}`}>
      <div className="district-details-title">
        {object.kind === 'building' ? <span className={object.mapRole === 'rescue-service' ? 'rescue-service' : ''}>{object.mapRole === 'rescue-service' ? 'АСС' : object.number}</span> : null}
        <div><small>{object.kind === 'building'
          ? object.mapRole === 'response-boundary'
            ? 'Граница района выезда'
            : object.mapRole === 'rescue-service'
              ? 'Объект АСС'
              : object.objectType === 'territory'
                ? 'Территория'
                : object.objectType === 'installation' ? 'Наружная установка' : 'Здание'
          : object.kind === 'hydrant' ? 'Пожарный гидрант' : 'Пожарный водоём'}</small>{buildingHeaderLabels.length > 0
            ? <h2 className="district-details-department-title">{buildingHeaderLabels.map((unit, index) => <span className={unit.label.length > 18 ? 'long' : ''} title={unit.fullName || unit.label} key={`${unit.label}-${index}`}>{unit.label}</span>)}</h2>
            : <h2>{districtObjectTitle(object)}</h2>}</div>
      </div>
      {object.kind === 'building' && object.objectType === 'territory' && object.mapRole !== 'rescue-service' ? (
        <dl>{object.territoryNames.map((unit, index) => <div key={unit.id}><dt>Название{object.territoryNames.length > 1 ? ` ${index + 1}` : ''}</dt><dd>{unit.fullName || '—'}{unit.shortName.trim() !== '' && <small>{unit.shortName}</small>}</dd></div>)}</dl>
      ) : object.kind === 'building' && object.objectType === 'installation' ? (
        <dl>
          <div><dt>Индекс</dt><dd>0</dd></div>
          <div className="district-details-unit"><dt>Наружная установка</dt><dd>{(object.installationName?.trim() ?? '') !== '' ? object.installationName?.trim() : '—'}</dd></div>
          <div className="district-details-unit"><dt>Цех</dt><dd>{object.workshopFull.trim() || '—'}<small>{object.workshopShort.trim() || 'Без сокращения'}</small></dd></div>
          <div className="district-details-section-heading"><dt>Документы предварительного планирования</dt></div>
          {object.planningDocuments.length === 0 && <div className="district-details-document empty"><dt>Документы</dt><dd>На объект не разработаны</dd></div>}
          {object.planningDocuments.map((document) => <div className="district-details-document" key={document.id}><dt>{document.kind}</dt><dd>№ {document.number.replace(/^№\s*/u, '')}</dd></div>)}
        </dl>
      ) : object.kind === 'building' ? (
        <dl>
          <div className="district-details-unit"><dt>{object.mapRole === 'rescue-service' ? 'Формирование' : 'Цех'}</dt><dd>{object.workshopFull.trim() || (object.mapRole === 'rescue-service' ? 'Аварийно-спасательная служба' : '—')}<small>{object.workshopShort.trim() || (object.mapRole === 'rescue-service' ? 'АСС' : '—')}</small></dd></div>
          {object.departments.map((unit, index) => <div className="district-details-unit" key={unit.id}><dt>Отделение{object.departments.length > 1 ? ` ${index + 1}` : ''}</dt><dd>{unit.fullName || '—'}<small>{unit.shortName || 'Без сокращения'}</small></dd></div>)}
          {object.sites.map((unit, index) => <div className="district-details-unit" key={unit.id}><dt>Участок{object.sites.length > 1 ? ` ${index + 1}` : ''}</dt><dd>{unit.fullName || '—'}<small>{unit.shortName || 'Без сокращения'}</small></dd></div>)}
          {(object.inventoryNumber ?? '').trim() !== '' && <div><dt>Инвентарный номер здания</dt><dd>{object.inventoryNumber}</dd></div>}
          <div className="district-details-section-heading"><dt>Документы предварительного планирования</dt></div>
          {object.planningDocuments.length === 0 && <div className="district-details-document empty"><dt>Документы</dt><dd>На объект не разработаны</dd></div>}
          {object.planningDocuments.map((document) => <div className="district-details-document" key={document.id}><dt>{document.kind}</dt><dd>№ {document.number.replace(/^№\s*/u, '')}</dd></div>)}
        </dl>
      ) : object.kind === 'hydrant' ? (
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
      ) : (
        <>
          <div className="district-reservoir-card-symbol" aria-label={`Пожарный водоём ${object.number}, объём ${object.volumeM3 === null ? 'не указан' : `${object.volumeM3.toLocaleString('ru-RU')} м³`}`}>
            <FireReservoirPlanSymbol object={object} />
            <div className="district-reservoir-card-values"><strong>{object.number}</strong><span>V = {object.volumeM3 === null ? '—' : object.volumeM3.toLocaleString('ru-RU')} м³</span></div>
          </div>
          <dl>
            <div><dt>Номер</dt><dd>{object.number}</dd></div>
            <div><dt>Принадлежность</dt><dd>{object.owner}</dd></div>
            <div><dt>Состояние</dt><dd><span className={`hydrant-status ${object.status}`}>{HYDRANT_STATUS_LABELS[object.status]}</span></dd></div>
            <div><dt>Вид ПВ</dt><dd>{FIRE_RESERVOIR_TYPE_LABELS[object.reservoirType]}</dd></div>
            {object.volumeM3 !== null && <div><dt>Объём</dt><dd>{object.volumeM3.toLocaleString('ru-RU')} м³</dd></div>}
            <div className="district-details-long-row"><dt>Характер неисправности</dt><dd>{object.faultDescription.trim() || 'Не выявлен'}</dd></div>
          </dl>
        </>
      )}
      {object.note !== '' && <div className="district-details-note"><strong>Примечание</strong><p>{object.note}</p></div>}
      <p className="district-details-coordinates">{object.point.latitude.toFixed(6)}° с.ш.<br />{object.point.longitude.toFixed(6)}° в.д.</p>
      {adminMode && <div className="district-details-actions"><button onClick={onEdit}>Редактировать</button><button className="danger" onClick={onDelete}>Удалить</button></div>}
      {object.kind === 'building' && object.mapRole !== 'response-boundary' && <button type="button" className="district-emergency-button" onClick={onOpenDispatch}>Пожар / Авария</button>}
    </article>
  );
}

export function DistrictMapPage(props: Props) {
  const compactViewport = () => window.matchMedia('(max-width: 720px)').matches;
  const [center, setCenter] = useState<GeoPoint>(() => districtResponseBoundaryCenter(props.objects) ?? MAP_INITIAL_CENTER);
  const [zoom, setZoom] = useState(1.65);
  const [viewSize, setViewSize] = useState({ width: 1000, height: 700 });
  const [visibleLayers, setVisibleLayers] = useState<ReadonlySet<DistrictLayerKey>>(() => {
    const layers = new Set<DistrictLayerKey>(DISTRICT_LAYER_KEYS);
    layers.delete('building-0');
    if (compactViewport()) for (const key of NPPV_LAYER_KEYS) layers.delete(key);
    return layers;
  });
  const [legendCollapsed, setLegendCollapsed] = useState(compactViewport);
  const [districtToolsOpen, setDistrictToolsOpen] = useState(() => !compactViewport());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchHighlightedId, setSearchHighlightedId] = useState<string | null>(null);
  const [editorObject, setEditorObject] = useState<DistrictMapObject | null>(null);
  const [contextMenu, setContextMenu] = useState<{ point: GeoPoint; x: number; y: number } | null>(null);
  const [contourDraft, setContourDraftState] = useState<ContourDraft | null>(null);
  const [actImportStatus, setActImportStatus] = useState('');
  const [actImporting, setActImporting] = useState(false);
  const [mapBackupStatus, setMapBackupStatus] = useState('');
  const [sharedPublishStatus, setSharedPublishStatus] = useState<Readonly<{ success: boolean; message: string }> | null>(null);
  const [contourStatus, setContourStatus] = useState('');
  const [pendingHydrantAct, setPendingHydrantAct] = useState<Readonly<{ fileName: string; result: HydrantActParseResult }> | null>(null);
  const [panning, setPanning] = useState(false);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<readonly GeoPoint[]>([]);
  const [searchResetSignal, setSearchResetSignal] = useState(0);
  const [dispatchBuilding, setDispatchBuilding] = useState<DistrictBuilding | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const detailsPanelRef = useRef<HTMLElement>(null);
  const suppressNextDetailsScrollRef = useRef(false);
  const initialViewportFittedRef = useRef(false);
  const actInputRef = useRef<HTMLInputElement>(null);
  const mapBackupInputRef = useRef<HTMLInputElement>(null);
  const panRef = useRef<{ pointerId: number; clientX: number; clientY: number; center: GeoPoint } | null>(null);
  const rulerRightPanRef = useRef<{ pointerId: number; clientX: number; clientY: number; center: GeoPoint; timer: number; active: boolean } | null>(null);
  const suppressRulerContextMenuRef = useRef(false);
  const touchPointsRef = useRef(new Map<number, { clientX: number; clientY: number }>());
  const touchTapRef = useRef(new Map<number, { clientX: number; clientY: number; moved: boolean }>());
  const touchHadMultipleRef = useRef(false);
  const pinchRef = useRef<{ distance: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; objectId: string; clientX: number; clientY: number; active: boolean } | null>(null);
  const markerInteractionRef = useRef(false);

  const publishForAllDevices = async () => {
    setSharedPublishStatus(null);
    const result = await props.onPublishForAll();
    setSharedPublishStatus(result);
  };
  const buildingContourResolverRef = useRef<((point: GeoPoint) => readonly GeoPoint[] | null) | null>(null);
  const contourDragRef = useRef<ContourDragState | null>(null);
  const contourDraftRef = useRef<ContourDraft | null>(null);
  const objectsRef = useRef(props.objects);
  objectsRef.current = props.objects;

  const setContourDraft = (value: ContourDraft | null) => {
    contourDraftRef.current = value;
    setContourDraftState(value);
  };
  const cloneContourDraft = (value: ContourDraft): ContourDraft => ({ ...value, points: value.points.map((point) => ({ ...point })) });
  const applyContourStep = (before: ContourDraft, after: ContourDraft, label: string) => {
    const previous = cloneContourDraft(before);
    const next = cloneContourDraft(after);
    setContourDraft(next);
    props.onTransientHistory(
      label,
      () => { setContourDraft(previous); setContourStatus('Отменено последнее изменение контура.'); },
      () => { setContourDraft(next); setContourStatus('Изменение контура возвращено.'); },
    );
  };

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
  const mapLibreZoom = Math.max(0, Math.min(24, Math.log2(projection.worldPixels / 512)));
  const markerDetailLevel = zoom >= 4.2 ? 'full' : 'compact';
  const markerScale = Math.max(0.2, Math.min(1, zoom / 4.8));
  const scaleDistanceKm = niceScale(viewSize.width / projection.scale / 5);
  const scalePixels = scaleDistanceKm * projection.scale;
  const selected = props.objects.find((object) => object.id === selectedId) ?? null;
  const selectObject = (id: string) => {
    setSelectedId(id);
    setLegendCollapsed(true);
  };
  const showBuildings = BUILDING_LAYER_KEYS.every((key) => visibleLayers.has(key));
  const showHydrants = NPPV_LAYER_KEYS.every((key) => visibleLayers.has(key));
  const setLayerVisibility = (key: DistrictLayerKey, visible: boolean) => setVisibleLayers((current) => {
    const next = new Set(current);
    if (visible) next.add(key); else next.delete(key);
    return next;
  });
  const setLayerGroupVisibility = (keys: readonly DistrictLayerKey[], visible: boolean) => setVisibleLayers((current) => {
    const next = new Set(current);
    for (const key of keys) {
      if (visible) next.add(key); else next.delete(key);
    }
    return next;
  });
  const visibleObjects = props.objects.filter((object) => object.id === searchHighlightedId
    || visibleLayers.has(districtLayerKey(object)));
  const buildingMarkerScales = twoTierBuildingMarkerScales(visibleObjects, projection.project);
  const markerPlacements = useMemo(() => {
    const raw = visibleObjects
      .filter(hasDistrictMarker)
      .map((object) => ({ object, ...projection.project(isBuildingWithContour(object) ? districtObjectMarkerPoint(object) : object.point) }));
    const anchored = raw.filter(({ object }) => isBuildingWithContour(object));
    const floating = raw.filter(({ object }) => !isBuildingWithContour(object));
    return [...anchored, ...declutterDistrictMarkers(floating, viewSize.width, viewSize.height)];
  }, [projection, viewSize.height, viewSize.width, visibleObjects]);
  const orderedMarkerPlacements = [...markerPlacements].sort((left, right) => {
    const priority = (id: string) => id === hoveredId ? 2 : id === selectedId || id === searchHighlightedId ? 1 : 0;
    return priority(left.object.id) - priority(right.object.id);
  });
  const hoveredContourObject = visibleObjects.find((object): object is DistrictBuilding => object.kind === 'building'
    && object.id === hoveredId
    && (object.objectType === 'territory' || object.objectType === 'installation' || object.objectType === 'demolished')) ?? null;

  const locate = (clientX: number, clientY: number): GeoPoint | null => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect === undefined) return null;
    return projection.unproject((clientX - rect.left) / rect.width * viewSize.width, (clientY - rect.top) / rect.height * viewSize.height);
  };
  const removeContourPoint = (index: number) => {
    const current = contourDraftRef.current;
    if (current === null) return;
    const minimum = current.mapRole === 'response-boundary' ? 2 : 3;
    if (current.points.length <= minimum) {
      setContourStatus(`Для этого контура необходимо оставить не менее ${minimum} точек.`);
      return;
    }
    applyContourStep(current, { ...current, points: current.points.filter((_, pointIndex) => pointIndex !== index) }, 'Удалена точка контура');
    setContourStatus('Лишняя точка удалена.');
  };
  const alignContour = () => {
    const current = contourDraftRef.current;
    if (current === null || current.mapRole === 'response-boundary') return;
    const aligned = alignOrthogonalContour(current.points);
    if (aligned === null) {
      setContourStatus('Контур оставлен без изменений: программа не уверена, что его стороны должны быть параллельны.');
      return;
    }
    applyContourStep(current, { ...current, points: aligned }, 'Автоматически выровнен контур');
    setContourStatus('Параллельные стороны выровнены, прямые углы и парные размеры восстановлены.');
  };
  const finishContour = () => {
    if (contourDraft === null || contourDraft.points.length < (contourDraft.mapRole === 'response-boundary' ? 2 : 3)) return;
    const finalPoints = contourDraft.mapRole === 'response-boundary'
      ? contourDraft.points
      : alignOrthogonalContour(contourDraft.points) ?? contourDraft.points;
    if (contourDraft.editingObjectId !== null) {
      const previous = props.objects.find((object): object is DistrictBuilding => object.id === contourDraft.editingObjectId && object.kind === 'building');
      if (previous !== undefined) {
        const updated = withAdminChangeNote({ ...previous, contour: [...finalPoints], updatedAtIso: new Date().toISOString() }, ['Контур объекта']);
        props.onClearTransientHistory();
        props.onCommitObjects(props.objects.map((object) => object.id === previous.id ? updated : object));
        selectObject(previous.id);
      }
      setContourDraft(null);
      setContourStatus('');
      return;
    }
    const point = {
      latitude: finalPoints.reduce((sum, item) => sum + item.latitude, 0) / finalPoints.length,
      longitude: finalPoints.reduce((sum, item) => sum + item.longitude, 0) / finalPoints.length,
    };
    if (contourDraft.objectType === 'demolished') {
      const created = initialBuilding(point, 'demolished', finalPoints, contourDraft.mapRole);
      props.onClearTransientHistory();
      props.onCommitObjects([...props.objects, created]);
      setContourDraft(null);
      setContourStatus('Демонтированный объект добавлен на карту.');
      return;
    }
    setEditorObject(initialBuilding(point, contourDraft.objectType, finalPoints, contourDraft.mapRole));
    props.onClearTransientHistory();
    setContourDraft(null);
    setContourStatus('');
  };
  const startContour = (objectType: 'building' | 'territory' | 'installation' | 'demolished', mapRole: DistrictBuildingMapRole = 'ordinary') => {
    if (contextMenu === null) return;
    props.onClearTransientHistory();
    const automatic = objectType === 'territory' ? null : buildingContourResolverRef.current?.(contextMenu.point) ?? null;
    setContourDraft({ objectType, mapRole, points: automatic ?? [contextMenu.point], source: automatic === null ? 'manual' : 'automatic', editingObjectId: null });
    setContourStatus('');
    setContextMenu(null);
    setSelectedId(null);
  };
  const startContourEdit = (object: DistrictBuilding) => {
    if (object.contour.length < (object.mapRole === 'response-boundary' ? 2 : 3)) return;
    props.onClearTransientHistory();
    setEditorObject(null);
    selectObject(object.id);
    setCenter(districtObjectFocusPoint(object));
    setZoom((current) => Math.max(current, 5));
    setContourDraft({
      objectType: object.objectType,
      mapRole: object.mapRole ?? 'ordinary',
      points: [...object.contour],
      source: 'editing',
      editingObjectId: object.id,
    });
    setContourStatus('');
  };
  const focusObject = (object: DistrictMapObject) => {
    setCenter(districtObjectFocusPoint(object));
    if (isBuildingWithContour(object)) {
      const latitudeSpanKm = (Math.max(...object.contour.map((point) => point.latitude)) - Math.min(...object.contour.map((point) => point.latitude))) * KM_PER_LATITUDE_DEGREE;
      const longitudeSpanKm = (Math.max(...object.contour.map((point) => point.longitude)) - Math.min(...object.contour.map((point) => point.longitude))) * KM_PER_LONGITUDE_DEGREE;
      const basePixelsPerKm = Math.min(viewSize.width / BASE_WIDTH_KM, viewSize.height / BASE_HEIGHT_KM);
      const fittedZoom = Math.min(
        (viewSize.width * 0.56) / Math.max(longitudeSpanKm, 0.025),
        (viewSize.height * 0.56) / Math.max(latitudeSpanKm, 0.025),
      ) / basePixelsPerKm;
      setZoom(Math.max(4.5, Math.min(18, fittedZoom)));
    } else {
      setZoom(9);
    }
    selectObject(object.id);
    if (compactViewport()) window.requestAnimationFrame(() => detailsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const previewObject = (object: DistrictMapObject) => {
    suppressNextDetailsScrollRef.current = true;
    setCenter(districtObjectFocusPoint(object));
    if (isBuildingWithContour(object)) {
      const latitudeSpanKm = (Math.max(...object.contour.map((point) => point.latitude)) - Math.min(...object.contour.map((point) => point.latitude))) * KM_PER_LATITUDE_DEGREE;
      const longitudeSpanKm = (Math.max(...object.contour.map((point) => point.longitude)) - Math.min(...object.contour.map((point) => point.longitude))) * KM_PER_LONGITUDE_DEGREE;
      const basePixelsPerKm = Math.min(viewSize.width / BASE_WIDTH_KM, viewSize.height / BASE_HEIGHT_KM);
      const fittedZoom = Math.min((viewSize.width * 0.56) / Math.max(longitudeSpanKm, 0.025), (viewSize.height * 0.56) / Math.max(latitudeSpanKm, 0.025)) / basePixelsPerKm;
      setZoom(Math.max(4.5, Math.min(18, fittedZoom)));
    } else setZoom(9);
    selectObject(object.id);
  };
  const clearMapSelection = () => {
    setSelectedId(null);
    setSearchHighlightedId(null);
    setSearchResetSignal((current) => current + 1);
  };
  useEffect(() => {
    if (selectedId === null || !compactViewport()) return;
    if (suppressNextDetailsScrollRef.current) {
      suppressNextDetailsScrollRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => detailsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);
  const changeZoom = (factor: number, anchor?: GeoPoint) => {
    if (compactViewport()) setLegendCollapsed(true);
    setZoom((currentZoom) => {
    const nextZoom = Math.max(0.45, Math.min(64, currentZoom * factor));
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
  };
  useEffect(() => {
    if (initialViewportFittedRef.current) return;
    const boundaryPoints = props.objects
      .filter((object): object is DistrictBuilding => object.kind === 'building' && object.mapRole === 'response-boundary')
      .flatMap((object) => object.contour);
    const boundaryCenter = districtResponseBoundaryCenter(props.objects);
    if (boundaryCenter === null || boundaryPoints.length < 2) return;
    const stageRect = stageRef.current?.getBoundingClientRect();
    const width = Math.max(1, stageRect?.width ?? viewSize.width);
    const height = Math.max(1, stageRect?.height ?? viewSize.height);
    const latitudeSpanKm = (Math.max(...boundaryPoints.map((point) => point.latitude)) - Math.min(...boundaryPoints.map((point) => point.latitude))) * KM_PER_LATITUDE_DEGREE;
    const longitudeSpanKm = (Math.max(...boundaryPoints.map((point) => point.longitude)) - Math.min(...boundaryPoints.map((point) => point.longitude))) * KM_PER_LONGITUDE_DEGREE;
    const basePixelsPerKm = Math.min(width / BASE_WIDTH_KM, height / BASE_HEIGHT_KM);
    const fittedZoom = Math.min(
      (width * .82) / Math.max(longitudeSpanKm, .2),
      (height * .82) / Math.max(latitudeSpanKm, .2),
    ) / basePixelsPerKm;
    setCenter(boundaryCenter);
    setZoom(Math.max(.65, Math.min(8, fittedZoom)));
    initialViewportFittedRef.current = true;
  }, [props.objects, viewSize.height, viewSize.width]);
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
      const nextZoom = Math.max(0.45, Math.min(64, zoom * (event.deltaY < 0 ? 1.16 : 1 / 1.16)));
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
    selectObject(object.id);
    setEditorObject(null);
  };
  const deleteSelected = () => {
    if (selected === null || !window.confirm(`Удалить «${districtObjectTitle(selected)}» из проекта?`)) return;
    props.onCommitObjects(props.objects.filter((item) => item.id !== selected.id));
    setSelectedId(null);
  };
  const downloadMapBackup = () => {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('-');
    const blob = new Blob([serializeDistrictMapBackup(props.project)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `HIMKONTUR-map-${stamp}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMapBackupStatus(`Резервная копия сохранена: ${props.objects.length} объектов. Существующие данные карты не изменены.`);
  };
  const importMapBackup = async (file: File) => {
    setMapBackupStatus(`Проверяю резервную копию «${file.name}»…`);
    try {
      const backup = parseDistrictMapBackup(await file.text());
      if (backup === null) {
        setMapBackupStatus('Файл не является резервной копией карты ХИМКОНТУР. Текущая карта не изменена.');
        return;
      }
      if (!window.confirm(`Загрузить из файла ${backup.draft.length} объектов? Текущая карта будет заменена только после подтверждения.`)) {
        setMapBackupStatus('Загрузка отменена. Текущая карта не изменена.');
        return;
      }
      props.onCommitObjects([...backup.draft]);
      setSelectedId(null);
      setEditorObject(null);
      setMapBackupStatus(`Загружено ${backup.draft.length} объектов. Они сохранены в этом браузере и поставлены в очередь синхронизации.`);
    } catch {
      setMapBackupStatus('Не удалось прочитать файл. Текущая карта не изменена.');
    }
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
    if (compactViewport()) setLegendCollapsed(true);
    if (contourDraft !== null && event.button === 2) {
      event.preventDefault();
      rulerRightPanRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        center,
        timer: 0,
        active: true,
      };
      setPanning(true);
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
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
    if (contourDraft !== null && contourDraft.source === 'manual' && event.button === 0 && event.pointerType !== 'touch') {
      event.preventDefault();
      const point = locate(event.clientX, event.clientY);
      const rect = stageRef.current?.getBoundingClientRect();
      if (point === null || rect === undefined) return;
      const first = projection.project(contourDraft.points[0] ?? point);
      const localX = (event.clientX - rect.left) / rect.width * viewSize.width;
      const localY = (event.clientY - rect.top) / rect.height * viewSize.height;
      if (contourDraft.points.length >= 3 && Math.hypot(localX - first.x, localY - first.y) <= 18) {
        finishContour();
      } else {
        applyContourStep(contourDraft, { ...contourDraft, points: [...contourDraft.points, point], source: 'manual' }, 'Добавлена точка контура');
      }
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
    const contourDrag = contourDragRef.current;
    if (contourDrag?.pointerId === event.pointerId) {
      const point = locate(event.clientX, event.clientY);
      if (point === null) return;
      if (contourDrag.mode === 'vertex') {
        if (!contourDrag.moved && Math.hypot(event.clientX - contourDrag.clientX, event.clientY - contourDrag.clientY) <= 3) return;
        contourDrag.moved = true;
        const current = contourDraftRef.current;
        if (current !== null) setContourDraft({ ...current, points: current.points.map((item, itemIndex) => itemIndex === contourDrag.index ? point : item) });
      } else {
        contourDrag.moved = true;
        const latitudeDelta = point.latitude - contourDrag.startPointer.latitude;
        const longitudeDelta = point.longitude - contourDrag.startPointer.longitude;
        const current = contourDraftRef.current;
        if (current !== null) setContourDraft({
          ...current,
          points: contourDrag.startPoints.map((item, itemIndex) => itemIndex === contourDrag.startIndex || itemIndex === contourDrag.endIndex
            ? { latitude: item.latitude + latitudeDelta, longitude: item.longitude + longitudeDelta }
            : item),
        });
      }
      return;
    }
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
        const next = objectsRef.current.map((item) => {
          if (item.id !== dragRef.current?.objectId) return item;
          if (item.kind === 'building' && item.contour.length >= 3 && !pointInsideDistrictContour(point, item.contour)) return item;
          return { ...item, point, updatedAtIso: new Date().toISOString() };
        });
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
    const contourDrag = contourDragRef.current;
    if (contourDrag?.pointerId === event.pointerId) {
      contourDragRef.current = null;
      const currentDraft = contourDraftRef.current;
      if (contourDrag.moved && currentDraft !== null) {
        const before = { ...currentDraft, points: contourDrag.startPoints };
        const after = cloneContourDraft(currentDraft);
        props.onTransientHistory(
          contourDrag.mode === 'vertex' ? 'Перемещена точка контура' : 'Перемещена сторона контура',
          () => { setContourDraft(before); setContourStatus('Отменено последнее изменение контура.'); },
          () => { setContourDraft(after); setContourStatus('Изменение контура возвращено.'); },
        );
      }
      if (event.type !== 'pointercancel' && !contourDrag.moved) {
        if (contourDrag.mode === 'edge') {
          const point = locate(event.clientX, event.clientY);
          const current = contourDraftRef.current;
          if (point !== null && current !== null) {
            const points = [...current.points];
            points.splice(contourDrag.startIndex + 1, 0, point);
            applyContourStep(current, { ...current, points }, 'Добавлена точка контура');
          }
        } else if (contourDrag.index === 0 && contourDraft?.source === 'manual' && contourDraft.mapRole !== 'response-boundary' && contourDraft.points.length >= 3) {
          finishContour();
        }
      }
    }
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
          ? withAdminChangeNote(item, [item.kind === 'building' && item.contour.length >= 3 ? 'Расположение таблички' : 'Координаты объекта'])
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
          <div className="district-map-primary-tools mobile-map-command-bar">
            <div className="segmented district-basemap-switch">
              <button className={props.basemap === 'standard' ? 'active' : ''} onClick={() => props.onBasemapChange('standard')}>Карта</button>
              <button className={props.basemap === 'satellite' ? 'active' : ''} onClick={() => props.onBasemapChange('satellite')}>Спутник</button>
            </div>
            <button type="button" className={`district-tools-toggle${districtToolsOpen ? ' active' : ''}`} aria-expanded={districtToolsOpen} title="Поиск и отображение объектов района выезда" aria-label="Показать поиск зданий и элементов НППВ" onClick={() => setDistrictToolsOpen((current) => !current)}><UiIcon name="chevronDown" /></button>
          </div>
          {districtToolsOpen && <DistrictObjectToolbar
            objects={props.objects}
            showBuildings={showBuildings}
            showHydrants={showHydrants}
            onShowBuildingsChange={(visible) => setLayerGroupVisibility(BUILDING_LAYER_KEYS, visible)}
            onShowHydrantsChange={(visible) => setLayerGroupVisibility(NPPV_LAYER_KEYS, visible)}
            onFocus={focusObject}
            onPreview={previewObject}
            onSearchSelectionChange={(object) => setSearchHighlightedId(object?.id ?? null)}
            resetSignal={searchResetSignal}
            compact
            twoStepSelection={compactViewport()}
          />}
        </div>
        <div className={`district-map-surface ${props.basemap}`} ref={stageRef}>
          <OfflineBasemap center={center} zoom={mapLibreZoom} basemap={props.basemap} onBuildingContourResolver={(resolver) => { buildingContourResolverRef.current = resolver; }} />
          <svg
            ref={svgRef}
            className={`${panning ? 'panning' : ''}${rulerActive ? ' ruler-active' : ''}${contourDraft?.source === 'manual' ? ' contour-drawing' : ''}`.trim()}
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
              if (contourDraft !== null) return;
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
            {visibleObjects.filter((object): object is DistrictBuilding => object.kind === 'building').map((object) => <DistrictObjectContour key={`${object.id}-contour`} object={object} project={projection.project} selected={selectedId === object.id && searchHighlightedId !== object.id} highlighted={searchHighlightedId === object.id} interactionDisabled={rulerActive || contourDraft !== null} onSelect={() => {
              if (object.objectType !== 'demolished') selectObject(object.id);
            }} onHoverChange={(hovered) => setHoveredId(hovered ? object.id : null)} />)}
            {contourDraft !== null && <g className={`district-contour-draft ${contourDraft.source}${contourDraft.objectType === 'demolished' ? ' demolished-draft' : ''}${contourDraft.mapRole === 'response-boundary' ? ' response-boundary-draft' : ''}`}>
              {contourDraft.mapRole === 'response-boundary'
                ? <polyline points={contourDraft.points.map((point) => { const projected = projection.project(point); return `${projected.x},${projected.y}`; }).join(' ')} />
                : <polygon points={contourDraft.points.map((point) => { const projected = projection.project(point); return `${projected.x},${projected.y}`; }).join(' ')} />}
              {contourDraft.points.length >= 2 && contourDraft.points.map((point, index) => {
                const nextIndex = contourDraft.mapRole === 'response-boundary' ? index + 1 : (index + 1) % contourDraft.points.length;
                const nextPoint = contourDraft.points[nextIndex];
                if (nextPoint === undefined || (contourDraft.source === 'manual' && contourDraft.points.length < 3 && index === contourDraft.points.length - 1)) return null;
                const start = projection.project(point);
                const end = projection.project(nextPoint);
                const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
                const showAddPoint = Math.hypot(end.x - start.x, end.y - start.y) >= 28;
                return <g key={`edge-${index}`}>
                  <line
                    className="district-contour-edge-hit"
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const startPointer = locate(event.clientX, event.clientY);
                      if (startPointer === null) return;
                      contourDragRef.current = { pointerId: event.pointerId, mode: 'edge', startIndex: index, endIndex: nextIndex, startPointer, startPoints: [...contourDraft.points], moved: false };
                      svgRef.current?.setPointerCapture(event.pointerId);
                    }}
                  />
                  {showAddPoint && <g
                    className="district-contour-add-point"
                    transform={`translate(${midpoint.x} ${midpoint.y})`}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const inserted = {
                        latitude: (point.latitude + nextPoint.latitude) / 2,
                        longitude: (point.longitude + nextPoint.longitude) / 2,
                      };
                      const current = contourDraftRef.current;
                      if (current !== null) {
                        const points = [...current.points];
                        points.splice(index + 1, 0, inserted);
                        applyContourStep(current, { ...current, points }, 'Добавлена точка контура');
                      }
                    }}
                  >
                    <circle r="7" />
                    <path d="M -3.5 0 H 3.5 M 0 -3.5 V 3.5" />
                  </g>}
                </g>;
              })}
              {contourDraft.points.map((point, index) => {
                const projected = projection.project(point);
                return <g
                  key={`vertex-${index}`}
                  className="district-contour-vertex"
                  transform={`translate(${projected.x} ${projected.y})`}
                  role="button"
                  aria-label={`Точка ${index + 1}. Правая кнопка мыши удаляет точку`}
                  onPointerDown={(event) => {
                    if (event.button === 2) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    contourDragRef.current = { pointerId: event.pointerId, mode: 'vertex', index, clientX: event.clientX, clientY: event.clientY, startPoints: [...contourDraft.points], moved: false };
                    svgRef.current?.setPointerCapture(event.pointerId);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeContourPoint(index);
                  }}
                >
                  <circle className="district-contour-vertex-hit" r="10" />
                  <rect className="district-contour-vertex-dot" x="-2.5" y="-2.5" width="5" height="5" rx=".5" transform="rotate(45)" />
                  <circle className="district-contour-vertex-center" r=".7" />
                </g>;
              })}
            </g>}
            {orderedMarkerPlacements.map(({ object, x, y }) => {
              const dragProps = props.adminMode ? {
                onPointerDown: (event: ReactPointerEvent<SVGGElement>) => {
                  if (rulerActive || contourDraft !== null || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  markerInteractionRef.current = true;
                  dragRef.current = { pointerId: event.pointerId, objectId: object.id, clientX: event.clientX, clientY: event.clientY, active: false };
                  svgRef.current?.setPointerCapture(event.pointerId);
                  selectObject(object.id);
                },
              } : {};
              const contourSearch = searchHighlightedId === object.id && isBuildingWithContour(object);
              const buildingScale = object.kind === 'building' ? buildingMarkerScales.get(object.id) : undefined;
              if (object.kind === 'building' && buildingScale === undefined) return null;
              return <DistrictMapMarker key={object.id} object={object} x={x} y={y} selected={selectedId === object.id && !contourSearch} highlighted={searchHighlightedId === object.id && !contourSearch} editing={props.adminMode} detailLevel={markerDetailLevel} scale={buildingScale ?? markerScale} interactionDisabled={rulerActive || contourDraft !== null} onSelect={() => selectObject(object.id)} onHoverChange={(hovered) => setHoveredId(hovered ? object.id : null)} {...dragProps} />;
            })}
            <MapRulerOverlay points={rulerPoints} project={projection.project} />
            {hoveredContourObject !== null && <DistrictContourHoverCard object={hoveredContourObject} project={projection.project} viewSize={viewSize} />}
          </svg>
          {contextMenu !== null && <div className="district-add-menu" style={{ left: contextMenu.x, top: contextMenu.y }}><strong>Добавить на карту</strong><button onClick={() => startContour('building')}>Здание с контуром</button><button onClick={() => startContour('installation')}>Наружная установка с контуром</button><button onClick={() => startContour('territory')}>Территория с контуром</button><button onClick={() => { setEditorObject(initialHydrant(contextMenu.point)); setContextMenu(null); }}>Пожарный гидрант</button><button onClick={() => { setEditorObject(initialFireReservoir(contextMenu.point)); setContextMenu(null); }}>Пожарный водоём</button><button onClick={() => startContour('demolished')}>Демонтированный объект</button><button className="secondary" onClick={() => setContextMenu(null)}>Отмена</button></div>}
          {contourDraft !== null && <div className="district-contour-panel">
            <strong>{contourDraft.mapRole === 'response-boundary' ? `Граница района выезда: ${pointCountLabel(contourDraft.points.length)}` : contourDraft.source === 'editing' ? 'Изменение границ объекта' : contourDraft.source === 'automatic' ? 'Контур найден автоматически' : `Ручная обводка: ${pointCountLabel(contourDraft.points.length)}`}</strong>
            <span>{contourDraft.mapRole === 'response-boundary' ? 'Ставьте точки вдоль границы. ПКМ по точке удаляет её; удерживайте ПКМ на карте и тяните для перемещения.' : 'Точки и стороны можно перетаскивать; «+» добавляет угол, ПКМ по точке удаляет его. Удерживайте ПКМ на свободном месте и тяните карту.'}</span>
            {contourStatus !== '' && <p className="district-contour-status">{contourStatus}</p>}
            <div>
              {contourDraft.source === 'automatic' && <button type="button" className="secondary" onClick={() => { applyContourStep(contourDraft, { ...contourDraft, points: [], source: 'manual' }, 'Включено ручное рисование контура'); setContourStatus(''); }}>Нарисовать вручную</button>}
              {contourDraft.mapRole !== 'response-boundary' && contourDraft.points.length >= 4 && <button type="button" className="secondary" onClick={alignContour}>Выровнять автоматически</button>}
              <button type="button" className="primary" disabled={contourDraft.points.length < (contourDraft.mapRole === 'response-boundary' ? 2 : 3)} onClick={finishContour}>{contourDraft.source === 'editing' ? 'Сохранить границы' : 'Принять контур'}</button>
              <button type="button" className="secondary" onClick={() => { props.onClearTransientHistory(); setContourDraft(null); setContourStatus(''); }}>Отмена</button>
            </div>
          </div>}
          <CompassRose className="district-compass" />
          <div className="zoom district-zoom"><button aria-label="Отдалить" onClick={() => changeZoom(1 / 1.4)}>−</button><span>{round(zoom * 100, 0)}%</span><button aria-label="Приблизить" onClick={() => changeZoom(1.4)}>+</button></div>
          <button type="button" className={`map-ruler-control district-ruler-control${rulerActive ? ' active' : ''}`} aria-pressed={rulerActive} title="Линейка: ЛКМ — точки; удержание ПКМ — перемещение карты; короткая ПКМ — сброс" aria-label="Измерить расстояние" onClick={() => { setRulerActive((current) => !current); setRulerPoints([]); }}><img src={appAssetUrl('assets/ruler-glossy.png')} alt="" /></button>
          <div className="map-scale district-map-scale" style={{ width: `${(scalePixels / viewSize.width) * 100}%` }}><span>{scaleDistanceKm < 1 ? `${round(scaleDistanceKm * 1000, 0)} м` : `${scaleDistanceKm} км`}</span></div>
          <DistrictMapLegend basemap={props.basemap} visibleLayers={visibleLayers} collapsed={legendCollapsed} onCollapsedChange={setLegendCollapsed} onLayerChange={setLayerVisibility} onAllChange={(visible) => setVisibleLayers(visible ? new Set(DISTRICT_LAYER_KEYS) : new Set())} />
          <div className="district-map-attribution">{props.basemap === 'standard' ? '© OpenStreetMap contributors' : 'Спутник: Esri World Imagery · автономная копия'}</div>
        </div>
      </main>
      {selected !== null && <aside className="district-details-panel" ref={detailsPanelRef}>
        <div className="district-panel-heading"><span>Объекты района выезда</span></div>
        <ObjectDetails object={selected} adminMode={props.adminMode} onEdit={() => setEditorObject(selected)} onDelete={deleteSelected} onOpenDispatch={() => { if (selected.kind === 'building') setDispatchBuilding(selected); }} />
      </aside>}
      {props.adminMode && props.managementOpen && <div className="dialog-backdrop district-management-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onCloseManagement(); }}>
        <section className="district-management-dialog" role="dialog" aria-modal="true" aria-labelledby="district-management-title">
          <button type="button" className="dialog-close" aria-label="Закрыть" onClick={props.onCloseManagement}><UiIcon name="close" /></button>
          <div className="admin-login-icon"><UiIcon name="settings" /></div>
          <h2 id="district-management-title">Настройка карты</h2>
          <p>Выберите действие. Режим добавления объектов позволяет ставить здания и элементы НППВ правой кнопкой мыши, а также перемещать их по карте.</p>
          <div className="district-management-actions">
            <button className="primary" onClick={props.onCloseManagement}><UiIcon name="pin" /><span><strong>Перейти к настройке карты</strong><small>Добавление, редактирование и перемещение объектов</small></span></button>
            <button type="button" onClick={downloadMapBackup}><UiIcon name="save" /><span><strong>Сохранить резервную копию карты</strong><small>Все здания, территории, НППВ и контуры сохранятся в один файл на компьютере</small></span></button>
            <button type="button" onClick={() => mapBackupInputRef.current?.click()}><UiIcon name="open" /><span><strong>Загрузить резервную копию карты</strong><small>Перенос актуальной карты в другой браузер или на другой компьютер</small></span></button>
            <input ref={mapBackupInputRef} className="district-act-file-input" type="file" accept=".json,application/json" aria-label="Выбрать резервную копию карты" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file !== undefined) void importMapBackup(file); }} />
            <button type="button" className="district-act-upload" disabled={actImporting} onClick={() => actInputRef.current?.click()}><UiIcon name="upload" /><span><strong>{actImporting ? 'Обрабатываю акт…' : 'Загрузить акт проверки наружного противопожарного водоснабжения'}</strong><small>Word (.docx): состояние и причина неисправности сопоставляются строго по номеру ПГ</small></span></button>
            <input ref={actInputRef} className="district-act-file-input" type="file" accept=".docx,.csv,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,text/plain" aria-label="Выбрать файл акта проверки пожарных гидрантов" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file !== undefined) void importHydrantAct(file); }} />
          </div>
          <section className="district-sync-diagnostics" aria-label="Состояние синхронизации карты">
            <div className="district-sync-diagnostics-heading">
              <div><strong>Синхронизация карты</strong><small>{props.syncStatus.backupAvailable === true ? 'Общая карта доступна. Другие устройства получают актуальную версию автоматически.' : props.syncStatus.message || 'Проверка облачных сервисов карты.'}</small></div>
              <button type="button" className="secondary" disabled={props.syncCheckBusy} onClick={props.onCheckSynchronization}>{props.syncCheckBusy ? 'Проверяю…' : 'Проверить'}</button>
            </div>
            <div className="district-sync-diagnostics-grid">
              <span><small>Сервис Яндекс</small><strong className={props.syncStatus.primaryAvailable === false ? 'is-error' : ''}>{props.syncStatus.primaryAvailable === true ? 'Доступен' : props.syncStatus.primaryAvailable === false ? 'Недоступен' : 'Не проверен'}</strong></span>
              <span><small>Сервис Cloudflare</small><strong className={props.syncStatus.backupAvailable === false ? 'is-error' : ''}>{props.syncStatus.backupAvailable === true ? 'Доступен' : props.syncStatus.backupAvailable === false ? 'Недоступен' : 'Не включён'}</strong></span>
              <span className="district-sync-shared-state"><small>Общая карта на сервере</small><strong className={props.syncStatus.backupAvailable === false ? 'is-error' : ''}>{props.syncStatus.backupAvailable === true ? 'Данные сохранены' : 'Сервер недоступен'}</strong>{props.syncStatus.sharedUpdatedAtIso !== '' && <em>Обновлено {synchronizationTime(props.syncStatus.sharedUpdatedAtIso)}</em>}</span>
              <span className="district-sync-local-state"><small>Только на этом устройстве</small><strong className={props.localPendingOperations > 0 ? 'is-error' : ''}>{localSynchronizationPacketCount(props.localPendingOperations)}</strong></span>
            </div>
            <small className="district-sync-queue-note">После изменения объекта программа сразу сохраняет новую редакцию общей карты в доступном облачном сервисе. Поэтому значение «Все изменения отправлены» означает, что актуальная карта уже доступна другим устройствам. Обмен между облачными сервисами выполняется автоматически и не требует ожидания пользователя.</small>
            {props.conflictBackupCount > 0 && <div className="district-conflict-backup"><p>Это журнал уже разрешённых конфликтов. Для каждого объекта в общую карту выбрана его более поздняя редакция, а обе версии оставлены здесь для проверки. Очистка удалит только записи журнала и не изменит карту.</p><div><button type="button" className="secondary" onClick={props.onDownloadConflictBackup}>Скачать журнал ({props.conflictBackupCount})</button><button type="button" className="secondary danger" onClick={props.onClearConflictBackup}>Очистить журнал</button></div></div>}
          </section>
          {mapBackupStatus !== '' && <p className="district-act-status district-map-backup-status">{mapBackupStatus}</p>}
          {actImportStatus !== '' && <p className="district-act-status">{actImportStatus}</p>}
          {pendingHydrantAct !== null && <button type="button" className="primary district-act-apply" onClick={applyHydrantAct}><UiIcon name="check" /><span>Применить данные акта к пожарным гидрантам на карте</span></button>}
          {sharedPublishStatus !== null && <p className={`district-publish-status ${sharedPublishStatus.success ? 'is-success' : 'is-error'}`} role="status">{sharedPublishStatus.message}</p>}
          <div className="district-management-footer-actions">
            <button type="button" className="primary publish-shared-map" disabled={props.publishBusy} onClick={() => void publishForAllDevices()}><UiIcon name="upload" /><span>{props.publishBusy ? 'Загружаю изменения…' : 'Опубликовать для всех устройств'}</span></button>
            <button className="secondary exit-admin" onClick={() => { props.onCloseManagement(); props.onExitAdmin(); }}>Завершить режим настройки</button>
          </div>
        </section>
      </div>}
      {editorObject !== null && <ObjectEditor object={editorObject} objects={props.objects} onSave={upsertObject} onEditContour={startContourEdit} onClose={() => setEditorObject(null)} />}
      {dispatchBuilding !== null && <FireDispatchTicket building={dispatchBuilding} objects={props.objects} basemap={props.basemap} onClose={() => setDispatchBuilding(null)} />}
    </div>
  );
}
