import type { GeoPoint } from '../core/types';
import {
  fetchCoordinatedMap,
  fetchCoordinatedMapChanges,
  fetchCoordinatedMapManifest,
  loadMapSyncConfig,
  publishCoordinatedMap,
  publishCoordinatedObjectChanges,
  type CoordinatedObjectChange,
  type MapAdminCredential,
} from './map-sync-service';

export type DistrictObjectKind = 'building' | 'hydrant' | 'reservoir';
export type HydrantStatus = 'unknown' | 'serviceable' | 'faulty' | 'disabled';
export type HydrantNetwork = 'ring' | 'dead-end' | 'ring-with-dead-ends';
export type HydrantType = 'standard' | 'foam' | 'dry-riser';
export type HydrantPattern = 'moscow' | 'leningrad' | 'german' | 'other';
export type FireReservoirType = 'artificial' | 'natural' | 'foam' | 'foam-solution';
export type DistrictBuildingMapRole = 'ordinary' | 'response-boundary' | 'rescue-service';

type DistrictObjectBase = Readonly<{
  id: string;
  kind: DistrictObjectKind;
  point: GeoPoint;
  note: string;
  updatedAtIso: string;
}>;

export type DistrictNamedUnit = Readonly<{
  id: string;
  fullName: string;
  shortName: string;
}>;

export type DistrictPlanningDocumentKind = 'ПТП' | 'КТП' | 'ПМЛА' | 'ПЛРН';
export type DistrictPlanningDocument = Readonly<{
  id: string;
  kind: DistrictPlanningDocumentKind;
  number: string;
}>;

export type DistrictBuilding = DistrictObjectBase & Readonly<{
  kind: 'building';
  objectType: 'building' | 'territory' | 'installation' | 'demolished';
  mapRole?: DistrictBuildingMapRole;
  contour: readonly GeoPoint[];
  territoryNames: readonly DistrictNamedUnit[];
  number: string;
  installationName?: string;
  inventoryNumber?: string;
  planningDocuments: readonly DistrictPlanningDocument[];
  workshopFull: string;
  workshopShort: string;
  departments: readonly DistrictNamedUnit[];
  sites: readonly DistrictNamedUnit[];
}>;

export type DistrictHydrant = DistrictObjectBase & Readonly<{
  kind: 'hydrant';
  number: string;
  owner: string;
  status: HydrantStatus;
  faultDescription: string;
  network: HydrantNetwork;
  hydrantType: HydrantType;
  pattern: HydrantPattern;
  diameterMm: number | null;
  pressureAtm: number | null;
  heightMm: number | null;
  signDistanceLeftM: number | null;
  signDistanceRightM: number | null;
  signDistanceForwardM: number | null;
  lastInspectionDate: string;
}>;

export type DistrictFireReservoir = DistrictObjectBase & Readonly<{
  kind: 'reservoir';
  number: string;
  owner: string;
  status: HydrantStatus;
  volumeM3: number | null;
  faultDescription: string;
  reservoirType: FireReservoirType;
}>;

export type DistrictMapObject = DistrictBuilding | DistrictHydrant | DistrictFireReservoir;

export type DistrictMapObjectCounts = Readonly<{
  buildings: number;
  territories: number;
  installations: number;
  demolished: number;
  waterSources: number;
  standardHydrants: number;
  foamHydrants: number;
  reservoirs: number;
  total: number;
}>;

export type DistrictMapObjectComparison = Readonly<{
  localOnly: number;
  sharedOnly: number;
  changed: number;
}>;

export function districtMapObjectCounts(objects: readonly DistrictMapObject[]): DistrictMapObjectCounts {
  const buildings = objects.filter((object) => object.kind === 'building' && object.objectType === 'building').length;
  const territories = objects.filter((object) => object.kind === 'building' && object.objectType === 'territory').length;
  const installations = objects.filter((object) => object.kind === 'building' && object.objectType === 'installation').length;
  const demolished = objects.filter((object) => object.kind === 'building' && object.objectType === 'demolished').length;
  const standardHydrants = objects.filter((object) => object.kind === 'hydrant' && object.hydrantType !== 'foam').length;
  const foamHydrants = objects.filter((object) => object.kind === 'hydrant' && object.hydrantType === 'foam').length;
  const reservoirs = objects.filter((object) => object.kind === 'reservoir').length;
  return {
    buildings,
    territories,
    installations,
    demolished,
    waterSources: standardHydrants + foamHydrants + reservoirs,
    standardHydrants,
    foamHydrants,
    reservoirs,
    total: objects.length,
  };
}

export function compareDistrictMapObjects(
  localObjects: readonly DistrictMapObject[],
  sharedObjects: readonly DistrictMapObject[],
): DistrictMapObjectComparison {
  const localById = new Map(localObjects.map((object) => [object.id, object]));
  const sharedById = new Map(sharedObjects.map((object) => [object.id, object]));
  let changed = 0;
  for (const [id, localObject] of localById) {
    const sharedObject = sharedById.get(id);
    if (sharedObject !== undefined && JSON.stringify(localObject) !== JSON.stringify(sharedObject)) changed += 1;
  }
  return {
    localOnly: [...localById.keys()].filter((id) => !sharedById.has(id)).length,
    sharedOnly: [...sharedById.keys()].filter((id) => !localById.has(id)).length,
    changed,
  };
}

export function buildingPrefix(number: string): string {
  return /^\s*([0-9])(?:\.|$)/u.exec(number)?.[1] ?? '1';
}

export type DistrictMapProject = Readonly<{
  id: string;
  name: string;
  revision: number;
  draft: readonly DistrictMapObject[];
  published: readonly DistrictMapObject[];
  draftSavedAtIso: string;
  publishedAtIso: string;
}>;

export type DistrictMapBackup = Readonly<{
  format: 'himkontur-district-map-backup';
  version: 1;
  exportedAtIso: string;
  project: DistrictMapProject;
}>;

export type PendingDistrictMapOperation = Readonly<{
  operationId: string;
  baseRevision: number;
  baseProject?: DistrictMapProject;
  project: DistrictMapProject;
  createdAtIso: string;
}>;

export type DistrictMapPublishResult = Readonly<{
  project: DistrictMapProject;
  conflicts: readonly Readonly<{
    objectId: string;
    local: DistrictMapObject | null;
    remote: DistrictMapObject | null;
    activeSource: 'local' | 'remote';
  }>[];
}>;

const STORAGE_KEY = 'himkontur-district-map-project-v1';
const PENDING_SYNC_STORAGE_KEY = 'himkontur-district-map-pending-sync-v1';
const GIST_CONFIG_URL = './data/gist-sync.json';
const GITHUB_DATA_API = 'https://api.github.com/repos/stas07130713-debug/himkontur/contents/public/data/district-map.json?ref=main';
const PUBLISHED_DATA_URLS = [
  'https://stas07130713-debug.github.io/himkontur/data/district-map.json',
  'https://raw.githubusercontent.com/stas07130713-debug/himkontur/main/public/data/district-map.json',
] as const;

type GistSyncConfig = Readonly<{
  gistId: string;
  owner: string;
  fileName: string;
}>;

const PREVIEW_OBJECTS: readonly DistrictMapObject[] = [
  {
    id: 'preview-building-315',
    kind: 'building',
    objectType: 'building',
    contour: [],
    territoryNames: [],
    point: { latitude: 67.9318, longitude: 32.849 },
    number: '3.15',
    inventoryNumber: '',
    planningDocuments: [],
    workshopFull: 'Химико-металлургический цех',
    workshopShort: 'ХМЦ',
    departments: [{ id: 'department-315-1', fullName: 'Производственное отделение', shortName: 'ПО' }],
    sites: [{ id: 'site-315-1', fullName: 'Участок корпуса № 15', shortName: 'Участок 15' }],
    note: 'Демонстрационная запись для согласования внешнего вида.',
    updatedAtIso: new Date().toISOString(),
  },
  {
    id: 'preview-building-316',
    kind: 'building',
    objectType: 'building',
    contour: [],
    territoryNames: [],
    point: { latitude: 67.919, longitude: 32.8835 },
    number: '3.16',
    inventoryNumber: '',
    planningDocuments: [],
    workshopFull: 'Химико-металлургический цех',
    workshopShort: 'ХМЦ',
    departments: [{ id: 'department-316-1', fullName: 'Складское отделение', shortName: 'СО' }],
    sites: [{ id: 'site-316-1', fullName: 'Участок хранения реагентов', shortName: 'Склад' }],
    note: 'Демонстрационная запись.',
    updatedAtIso: new Date().toISOString(),
  },
  {
    id: 'preview-hydrant-17',
    kind: 'hydrant',
    point: { latitude: 67.9258, longitude: 32.868 },
    number: 'ПГ-17',
    owner: 'Химико-металлургический цех',
    status: 'serviceable',
    faultDescription: '',
    network: 'ring',
    hydrantType: 'standard',
    pattern: 'moscow',
    diameterMm: 150,
    pressureAtm: null,
    heightMm: 1750,
    signDistanceLeftM: null,
    signDistanceRightM: 12,
    signDistanceForwardM: null,
    lastInspectionDate: '2026-09-18',
    note: 'Демонстрационная запись.',
    updatedAtIso: new Date().toISOString(),
  },
];

function previewProject(): DistrictMapProject {
  const now = new Date().toISOString();
  return {
    id: 'district-map-main',
    name: 'Карта района выезда',
    revision: 1,
    draft: PREVIEW_OBJECTS,
    published: PREVIEW_OBJECTS,
    draftSavedAtIso: now,
    publishedAtIso: now,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validDistrictObject(value: unknown): value is DistrictMapObject {
  if (!isObject(value) || !isObject(value.point)) return false;
  if (value.kind !== 'building' && value.kind !== 'hydrant' && value.kind !== 'reservoir') return false;
  return typeof value.id === 'string'
    && typeof value.number === 'string'
    && typeof value.point.latitude === 'number'
    && Number.isFinite(value.point.latitude)
    && Math.abs(value.point.latitude) <= 90
    && typeof value.point.longitude === 'number'
    && Number.isFinite(value.point.longitude)
    && Math.abs(value.point.longitude) <= 180;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function withoutCoordinateSourceNote(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('Источник координат и характеристик:'))
    .join('\n');
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function geoPoints(value: unknown): GeoPoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((point) => (
    typeof point.latitude === 'number' && Number.isFinite(point.latitude)
      && typeof point.longitude === 'number' && Number.isFinite(point.longitude)
      ? [{ latitude: point.latitude, longitude: point.longitude }]
      : []
  ));
}

function namedUnits(value: unknown, legacyFull: unknown, legacyShort: unknown, prefix: string): DistrictNamedUnit[] {
  if (Array.isArray(value)) return value
    .filter(isObject)
    .map((unit, index) => ({
      id: text(unit.id) || `${prefix}-${index + 1}`,
      fullName: text(unit.fullName),
      shortName: text(unit.shortName),
    }));
  const fullName = text(legacyFull);
  const shortName = text(legacyShort);
  return fullName === '' && shortName === '' ? [] : [{ id: `${prefix}-1`, fullName, shortName }];
}

const PLANNING_DOCUMENT_KINDS: readonly DistrictPlanningDocumentKind[] = ['ПТП', 'КТП', 'ПМЛА', 'ПЛРН'];

function planningDocuments(value: unknown, legacy: Record<string, unknown>, prefix: string): DistrictPlanningDocument[] {
  if (Array.isArray(value)) return value
    .filter(isObject)
    .map((document, index) => ({
      id: text(document.id) || `${prefix}-${index + 1}`,
      kind: PLANNING_DOCUMENT_KINDS.includes(document.kind as DistrictPlanningDocumentKind)
        ? document.kind as DistrictPlanningDocumentKind
        : 'ПТП',
      number: text(document.number),
    }));
  const migrated: DistrictPlanningDocument[] = [];
  const add = (kind: DistrictPlanningDocumentKind, number: unknown) => {
    const normalized = text(number).trim();
    if (normalized !== '') migrated.push({ id: `${prefix}-${migrated.length + 1}`, kind, number: normalized });
  };
  add('ПТП', legacy.firePlanNumber);
  add('ПМЛА', legacy.pmlaNumber);
  add('ПЛРН', legacy.plrnNumber);
  return migrated;
}

function normalizeDistrictObject(value: unknown): DistrictMapObject | null {
  if (!validDistrictObject(value)) return null;
  const base = {
    id: value.id,
    point: { latitude: value.point.latitude, longitude: value.point.longitude },
    note: text(value.note),
    updatedAtIso: text(value.updatedAtIso) || new Date().toISOString(),
  };
  if (value.kind === 'building') {
    const legacy = value as unknown as Record<string, unknown>;
    const objectType = value.objectType === 'demolished'
      ? 'demolished'
      : value.objectType === 'installation'
      ? 'installation'
      : value.objectType === 'territory' || buildingPrefix(text(value.number)) === '0'
        ? 'territory'
        : 'building';
    const normalizedTerritoryNames = namedUnits(value.territoryNames, legacy.territoryFull, legacy.territoryShort, `${value.id}-territory`);
    const migratedTerritoryNames = objectType === 'territory' && normalizedTerritoryNames.length === 0
      && (text(value.workshopFull).trim() !== '' || text(value.workshopShort).trim() !== '')
      ? [{ id: `${value.id}-territory-1`, fullName: text(value.workshopFull), shortName: text(value.workshopShort) }]
      : normalizedTerritoryNames;
    return {
      ...base,
      kind: 'building',
      objectType,
      mapRole: value.mapRole === 'response-boundary' || value.mapRole === 'rescue-service' ? value.mapRole : 'ordinary',
      contour: geoPoints(value.contour),
      territoryNames: migratedTerritoryNames,
      number: text(value.number),
      installationName: text(value.installationName),
      inventoryNumber: text(value.inventoryNumber),
      planningDocuments: planningDocuments(value.planningDocuments, legacy, `${value.id}-document`),
      workshopFull: text(value.workshopFull),
      workshopShort: text(value.workshopShort),
      departments: namedUnits(value.departments, legacy.departmentFull, legacy.departmentShort, `${value.id}-department`),
      sites: namedUnits(value.sites, legacy.buildingFull, legacy.buildingShort, `${value.id}-site`),
    };
  }
  const status: HydrantStatus = value.status === 'faulty' || value.status === 'disabled' || value.status === 'serviceable' ? value.status : 'unknown';
  if (value.kind === 'reservoir') {
    const reservoirType: FireReservoirType = value.reservoirType === 'natural'
      || value.reservoirType === 'foam'
      || value.reservoirType === 'foam-solution'
      ? value.reservoirType
      : 'artificial';
    return {
      ...base,
      kind: 'reservoir',
      number: text(value.number),
      owner: text(value.owner),
      status,
      volumeM3: finiteNumberOrNull(value.volumeM3),
      faultDescription: text(value.faultDescription),
      reservoirType,
    };
  }
  const network: HydrantNetwork = value.network === 'dead-end' || value.network === 'ring-with-dead-ends' ? value.network : 'ring';
  const hydrantType: HydrantType = value.hydrantType === 'foam' || value.hydrantType === 'dry-riser'
    ? value.hydrantType
    : 'standard';
  const pattern: HydrantPattern = value.pattern === 'leningrad' || value.pattern === 'german' || value.pattern === 'other' ? value.pattern : 'moscow';
  return {
    ...base,
    note: withoutCoordinateSourceNote(base.note),
    kind: 'hydrant',
    number: text(value.number),
    owner: text(value.owner),
    status,
    faultDescription: text(value.faultDescription),
    network,
    hydrantType,
    pattern,
    diameterMm: finiteNumberOrNull(value.diameterMm),
    pressureAtm: finiteNumberOrNull(value.pressureAtm),
    heightMm: finiteNumberOrNull(value.heightMm),
    signDistanceLeftM: finiteNumberOrNull(value.signDistanceLeftM),
    signDistanceRightM: finiteNumberOrNull(value.signDistanceRightM),
    signDistanceForwardM: finiteNumberOrNull(value.signDistanceForwardM),
    lastInspectionDate: text(value.lastInspectionDate),
  };
}

export function loadDistrictMapProject(): DistrictMapProject {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return previewProject();
    return normalizeDistrictMapProject(JSON.parse(raw)) ?? previewProject();
  } catch {
    return previewProject();
  }
}

export function loadPendingDistrictMapOperations(): PendingDistrictMapOperation[] {
  try {
    const raw = window.localStorage.getItem(PENDING_SYNC_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (isObject(parsed) && (parsed.version === 2 || parsed.version === 3) && Array.isArray(parsed.operations)) {
      const operations = parsed.operations.flatMap((value) => {
        if (!isObject(value)) return [];
        const project = normalizeDistrictMapProject(value.project);
        const baseProject = normalizeDistrictMapProject(value.baseProject);
        const operationId = text(value.operationId);
        if (project === null || operationId === '') return [];
        return [{
          operationId,
          baseRevision: typeof value.baseRevision === 'number' && Number.isSafeInteger(value.baseRevision)
            ? Math.max(0, value.baseRevision)
            : Math.max(0, project.revision - 1),
          ...(baseProject === null ? {} : { baseProject }),
          project,
          createdAtIso: text(value.createdAtIso) || project.publishedAtIso,
        }];
      });
      if (operations.length <= 1) return operations;
      const first = operations[0];
      const last = operations.at(-1);
      if (first === undefined || last === undefined) return [];
      // Older releases stored a complete map for every click. Keep the newest
      // local result and the oldest common base instead of exhausting storage.
      return [{
        ...last,
        baseRevision: first.baseRevision,
        ...(first.baseProject === undefined ? {} : { baseProject: first.baseProject }),
        createdAtIso: first.createdAtIso,
      }];
    }
    // Migration from releases <= 0.3.31, which stored just the last project.
    const legacyProject = normalizeDistrictMapProject(parsed);
    return legacyProject === null ? [] : [{
      operationId: `legacy-${legacyProject.revision}`,
      baseRevision: Math.max(0, legacyProject.revision - 1),
      project: legacyProject,
      createdAtIso: legacyProject.publishedAtIso,
    }];
  } catch {
    return [];
  }
}

function normalizeDistrictMapProject(parsed: unknown): DistrictMapProject | null {
  if (!isObject(parsed) || !Array.isArray(parsed.draft) || !Array.isArray(parsed.published)) return null;
  const draft = parsed.draft.map(normalizeDistrictObject);
  const published = parsed.published.map(normalizeDistrictObject);
  if (draft.some((object) => object === null) || published.some((object) => object === null)) return null;
  return {
    id: text(parsed.id) || 'district-map-main',
    name: text(parsed.name) || 'Карта района выезда',
    revision: typeof parsed.revision === 'number' && Number.isFinite(parsed.revision) ? parsed.revision : 1,
    draft: draft as DistrictMapObject[],
    published: published as DistrictMapObject[],
    draftSavedAtIso: text(parsed.draftSavedAtIso) || new Date().toISOString(),
    publishedAtIso: text(parsed.publishedAtIso) || new Date().toISOString(),
  };
}

export function serializeDistrictMapBackup(project: DistrictMapProject): string {
  const backup: DistrictMapBackup = {
    format: 'himkontur-district-map-backup',
    version: 1,
    exportedAtIso: new Date().toISOString(),
    project,
  };
  return JSON.stringify(backup, null, 2);
}

export function parseDistrictMapBackup(raw: string): DistrictMapProject | null {
  const parsed: unknown = JSON.parse(raw);
  if (isObject(parsed) && parsed.format === 'himkontur-district-map-backup') {
    if (parsed.version !== 1) return null;
    return normalizeDistrictMapProject(parsed.project);
  }
  return normalizeDistrictMapProject(parsed);
}

async function fetchBundledDistrictMapProject(): Promise<DistrictMapProject | null> {
  try {
    const response = await fetch('./data/district-map.json', { cache: 'no-store' });
    if (!response.ok) return null;
    return normalizeDistrictMapProject(await response.json());
  } catch {
    return null;
  }
}

async function fetchPlainDistrictMapProject(url: string): Promise<DistrictMapProject | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}ts=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return normalizeDistrictMapProject(await response.json());
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchDirectPublishedDistrictMapProject(): Promise<DistrictMapProject | null> {
  for (const url of PUBLISHED_DATA_URLS) {
    const project = await fetchPlainDistrictMapProject(url);
    if (project !== null) return project;
  }
  return null;
}

async function fetchGistSyncConfig(): Promise<GistSyncConfig | null> {
  try {
    const response = await fetch(`${GIST_CONFIG_URL}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!isObject(value)) return null;
    const config: GistSyncConfig = {
      gistId: text(value.gistId),
      owner: text(value.owner),
      fileName: text(value.fileName) || 'district-map.json',
    };
    return config.gistId === '' || config.owner === '' ? null : config;
  } catch {
    return null;
  }
}

async function fetchSynchronizedDistrictMapProject(): Promise<DistrictMapProject | null> {
  const mapConfig = await loadMapSyncConfig();
  const config = mapConfig?.legacyGist ?? await fetchGistSyncConfig();
  if (config === null) return null;
  const rawUrl = `https://gist.githubusercontent.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.gistId)}/raw/${encodeURIComponent(config.fileName)}`;
  return fetchPlainDistrictMapProject(rawUrl);
}

async function fetchCloudDistrictMapProject(): Promise<DistrictMapProject | null> {
  const config = await loadMapSyncConfig();
  if (config === null) return null;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${config.primaryApiUrl}?ts=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return isObject(payload) ? normalizeDistrictMapProject(payload.project) : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchGithubDistrictMapProject(): Promise<DistrictMapProject | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${GITHUB_DATA_API}&ts=${Date.now()}`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!isObject(payload) || typeof payload.content !== 'string') return null;
    const binary = window.atob(payload.content.replace(/\s/gu, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return normalizeDistrictMapProject(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchPublishedDistrictMapProject(): Promise<DistrictMapProject | null> {
  const config = await loadMapSyncConfig();
  const coordinated = config?.coordinatorEnabled === true
    ? await fetchCoordinatedMap().then((value) => normalizeDistrictMapProject(value.project)).catch(() => null)
    : null;
  // The coordinator is the shared map that all browsers write to. When it is
  // available, return it immediately instead of waiting for stale fallbacks or
  // an unavailable provider on every 30-second refresh.
  if (coordinated !== null) return coordinated;
  const [cloud, synchronized, bundled, direct] = await Promise.all([
    fetchCloudDistrictMapProject(),
    fetchSynchronizedDistrictMapProject(),
    fetchBundledDistrictMapProject(),
    fetchDirectPublishedDistrictMapProject(),
  ]);
  const remote = direct ?? await fetchGithubDistrictMapProject();
  return [cloud, synchronized, remote, bundled]
    .filter((project): project is DistrictMapProject => project !== null)
    .reduce<DistrictMapProject | null>((newest, project) => (
      newest === null || isPublishedProjectNewer(project, newest) ? project : newest
    ), null);
}

export async function fetchCoordinatedDistrictMapProject(): Promise<DistrictMapProject | null> {
  const coordinated = await fetchCoordinatedMap();
  return normalizeDistrictMapProject(coordinated.project);
}

function sameDistrictObject(left: DistrictMapObject | undefined, right: DistrictMapObject | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function districtMapObjectChanges(base: DistrictMapProject, target: DistrictMapProject): readonly CoordinatedObjectChange[] {
  const baseById = new Map(base.published.map((object) => [object.id, object]));
  const targetById = new Map(target.published.map((object) => [object.id, object]));
  const ids = new Set([...baseById.keys(), ...targetById.keys()]);
  return [...ids].flatMap((objectId) => {
    const baseObject = baseById.get(objectId);
    const object = targetById.get(objectId);
    if (sameDistrictObject(baseObject, object)) return [];
    return [{
      objectId,
      baseObject: baseObject ?? null,
      object: object ?? null,
      updatedAtIso: object?.updatedAtIso ?? target.publishedAtIso,
      targetRevision: target.revision,
    }];
  });
}

function replaceDistrictObject(objects: readonly DistrictMapObject[], objectId: string, object: DistrictMapObject | null): DistrictMapObject[] {
  const next = objects.filter((item) => item.id !== objectId);
  if (object !== null) next.push(object);
  return next;
}

export async function fetchCoordinatedDistrictMapUpdate(current: DistrictMapProject): Promise<DistrictMapProject | null> {
  const { manifest } = await fetchCoordinatedMapManifest();
  const localIndex = new Map(current.published.map((object) => [object.id, object.updatedAtIso]));
  const sameIndex = current.published.length === manifest.objects.length
    && manifest.objects.every((object) => localIndex.get(object.id) === object.updatedAtIso);
  if (current.revision === manifest.revision) {
    return sameIndex ? current : fetchCoordinatedDistrictMapProject();
  }
  let project = current;
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await fetchCoordinatedMapChanges(project.revision);
    if (page.requiresSnapshot) break;
    let objects = [...project.published];
    for (const change of page.changes) {
      const normalized = change.object === null ? null : normalizeDistrictObject(change.object);
      if (change.object !== null && normalized === null) throw new Error('Сервис вернул повреждённый объект карты.');
      objects = replaceDistrictObject(objects, change.objectId, normalized);
      project = {
        ...project,
        revision: change.targetRevision,
        published: objects,
        draft: objects,
        publishedAtIso: page.manifest.publishedAtIso,
        draftSavedAtIso: page.manifest.publishedAtIso,
      };
    }
    if (page.complete) return project;
    if (page.nextRevision === project.revision && page.changes.length === 0) break;
  }
  return fetchCoordinatedDistrictMapProject();
}

export async function publishDistrictMapOperation(operation: PendingDistrictMapOperation, credential: MapAdminCredential): Promise<DistrictMapPublishResult> {
  const config = await loadMapSyncConfig();
  if (config === null) throw new Error('Облачная синхронизация ещё не настроена.');
  if (config.coordinatorEnabled) {
    if (operation.baseProject !== undefined) {
      const changes = districtMapObjectChanges(operation.baseProject, operation.project);
      let project = operation.project;
      if (changes.length === 0) return { project, conflicts: [] };
      const result = await publishCoordinatedObjectChanges({
        operationId: operation.operationId,
        baseRevision: operation.baseRevision,
        changes,
        credential,
      });
      for (const conflict of result.conflicts) {
        const active = conflict.activeSource === 'remote' ? conflict.remote : conflict.local;
        const normalized = active === null ? null : normalizeDistrictObject(active);
        if (active !== null && normalized === null) throw new Error('Сервис синхронизации вернул повреждённый конфликтующий объект.');
        const objects = replaceDistrictObject(project.published, conflict.objectId, normalized);
        project = { ...project, published: objects, draft: objects };
      }
      project = {
        ...project,
        revision: result.revision,
        publishedAtIso: result.publishedAtIso,
        draftSavedAtIso: result.publishedAtIso,
      };
      return { project, conflicts: result.conflicts };
    }
    const result = await publishCoordinatedMap({ ...operation, credential });
    const published = normalizeDistrictMapProject(result.project);
    if (published === null) throw new Error('Сервис синхронизации вернул некорректные данные.');
    return { project: published, conflicts: [] };
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(config.primaryApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminPassword: credential.password,
        operationId: operation.operationId,
        baseRevision: operation.baseRevision,
        project: operation.project,
        updatedBy: 'Администратор ХИМКОНТУР',
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.status === 403) throw new Error('Неверный пароль администратора.');
    if (!response.ok) {
      const message = isObject(payload) ? text(payload.error) : '';
      throw new Error(message || `Сервис синхронизации вернул ошибку ${response.status}.`);
    }
    const published = isObject(payload) ? normalizeDistrictMapProject(payload.project) : null;
    if (published === null) throw new Error('Сервис синхронизации вернул некорректные данные.');
    return { project: published, conflicts: [] };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Сервис синхронизации не ответил вовремя.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function isPublishedProjectNewer(candidate: DistrictMapProject, current: DistrictMapProject): boolean {
  if (candidate.revision !== current.revision) return candidate.revision > current.revision;
  const candidateTime = Date.parse(candidate.publishedAtIso);
  const currentTime = Date.parse(current.publishedAtIso);
  return Number.isFinite(candidateTime) && (!Number.isFinite(currentTime) || candidateTime > currentTime);
}

export function shouldAdoptSharedDistrictMap(
  candidate: DistrictMapProject,
  current: DistrictMapProject,
  authoritative: boolean,
): boolean {
  if (!authoritative) return isPublishedProjectNewer(candidate, current);
  // With no local pending operation, the coordinator is authoritative even if
  // an old browser once stored an invalidly high local revision number.
  return candidate.revision !== current.revision || candidate.publishedAtIso !== current.publishedAtIso;
}

export function localOnlyDistrictMapObjects(
  local: DistrictMapProject,
  shared: DistrictMapProject,
): readonly DistrictMapObject[] {
  const sharedIds = new Set(shared.published.map((object) => object.id));
  return local.published.filter((object) => !sharedIds.has(object.id));
}

export function saveDistrictMapProject(project: DistrictMapProject): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function createPendingDistrictMapOperation(baseRevision: number, project: DistrictMapProject, baseProject?: DistrictMapProject): PendingDistrictMapOperation {
  const randomPart = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    operationId: `map-${randomPart}`,
    baseRevision,
    ...(baseProject === undefined ? {} : { baseProject }),
    project,
    createdAtIso: new Date().toISOString(),
  };
}

export function savePendingDistrictMapOperations(operations: readonly PendingDistrictMapOperation[]): void {
  if (operations.length === 0) {
    window.localStorage.removeItem(PENDING_SYNC_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify({ version: 3, operations }));
}

export function districtObjectTitle(object: DistrictMapObject): string {
  if (object.kind === 'hydrant') return `Пожарный гидрант ${object.number}`;
  if (object.kind === 'reservoir') return `Пожарный водоём ${object.number}`;
  if (object.mapRole === 'response-boundary') return 'Граница района выезда';
  if (object.mapRole === 'rescue-service') return 'Аварийно-спасательная служба';
  if (object.objectType === 'demolished') return 'Демонтированный объект';
  if (object.objectType === 'installation') {
    const name = object.installationName?.trim() ?? '';
    return name === '' ? 'Наружная установка' : name;
  }
  if (object.objectType === 'territory') {
    const name = object.territoryNames.find((item) => item.shortName.trim() !== '' || item.fullName.trim() !== '');
    const suffix = name === undefined ? '' : (name.shortName.trim() || name.fullName.trim());
    return suffix === '' ? object.number : `${object.number} · ${suffix}`;
  }
  const site = object.sites.find((item) => item.shortName.trim() !== '' || item.fullName.trim() !== '');
  const suffix = site === undefined
    ? (object.workshopShort.trim() || object.workshopFull.trim())
    : (site.shortName.trim() || site.fullName.trim());
  return suffix === '' ? object.number : `${object.number} · ${suffix}`;
}

export function districtObjectSearchDescription(object: DistrictMapObject): string {
  if (object.kind === 'hydrant') return [object.owner, object.faultDescription].filter(Boolean).join(' · ') || 'Пожарный гидрант';
  if (object.kind === 'reservoir') return [object.owner, object.faultDescription].filter(Boolean).join(' · ') || 'Пожарный водоём';
  if (object.mapRole === 'response-boundary') return 'Постоянная граница района выезда';
  if (object.mapRole === 'rescue-service') return ['Аварийно-спасательная служба', object.workshopFull, object.workshopShort].filter(Boolean).join(' · ');
  if (object.objectType === 'demolished') return 'Снесённый объект, обозначенный штрихованным контуром';
  if (object.objectType === 'installation') return [object.installationName, object.workshopFull, object.workshopShort].filter(Boolean).join(' · ');
  if (object.objectType === 'territory') return object.territoryNames.flatMap((unit) => [unit.fullName, unit.shortName]).map((item) => item.trim()).filter(Boolean).join(' · ');
  const parts = [
    object.workshopFull,
    ...object.departments.flatMap((unit) => [unit.fullName, unit.shortName]),
    ...object.sites.flatMap((unit) => [unit.fullName, unit.shortName]),
  ].map((item) => item.trim()).filter(Boolean);
  return parts.join(' · ');
}

export function planningDocumentLabel(document: DistrictPlanningDocument): string {
  const number = document.number.trim();
  if (number.toLocaleUpperCase('ru-RU').startsWith(document.kind)) return number;
  return `${document.kind}-${number}`;
}

export function districtObjectSearchText(object: DistrictMapObject): string {
  if (object.kind === 'hydrant') return [object.number, object.owner, object.faultDescription, object.note].join(' ').toLocaleLowerCase('ru-RU');
  if (object.kind === 'reservoir') return [
    object.number,
    object.owner,
    FIRE_RESERVOIR_TYPE_LABELS[object.reservoirType],
    object.volumeM3 === null ? '' : String(object.volumeM3),
    object.faultDescription,
    object.note,
  ].join(' ').toLocaleLowerCase('ru-RU');
  return [
    object.number,
    object.mapRole === 'response-boundary' ? 'граница района выезда периметр' : '',
    object.mapRole === 'rescue-service' ? 'аварийно-спасательная служба АСС' : '',
    object.objectType === 'installation' ? `наружная установка ${object.installationName ?? ''}` : '',
    object.objectType === 'demolished' ? 'демонтированный снесенный объект' : '',
    ...object.territoryNames.flatMap((unit) => [unit.fullName, unit.shortName]),
    object.inventoryNumber ?? '',
    ...object.planningDocuments.flatMap((document) => [document.kind, document.number, planningDocumentLabel(document)]),
    object.workshopFull,
    object.workshopShort,
    ...object.departments.flatMap((unit) => [unit.fullName, unit.shortName]),
    ...object.sites.flatMap((unit) => [unit.fullName, unit.shortName]),
    object.note,
  ].join(' ').toLocaleLowerCase('ru-RU');
}

export const HYDRANT_STATUS_LABELS: Readonly<Record<HydrantStatus, string>> = {
  unknown: 'Не заполнено',
  serviceable: 'Исправен',
  faulty: 'Неисправен',
  disabled: 'Временно отключён',
};

export const HYDRANT_NETWORK_LABELS: Readonly<Record<HydrantNetwork, string>> = {
  ring: 'Кольцевая',
  'dead-end': 'Тупиковая',
  'ring-with-dead-ends': 'Кольцевая с тупиковыми участками',
};

export const HYDRANT_NETWORK_SHORT: Readonly<Record<HydrantNetwork, string>> = {
  ring: 'К',
  'dead-end': 'Т',
  'ring-with-dead-ends': 'КТ',
};

export const HYDRANT_TYPE_LABELS: Readonly<Record<HydrantType, string>> = {
  standard: 'Обычный пожарный гидрант',
  foam: 'Пенный пожарный гидрант',
  'dry-riser': 'Пожарный гидрант в виде сухотруба',
};

export const FIRE_RESERVOIR_TYPE_LABELS: Readonly<Record<FireReservoirType, string>> = {
  artificial: 'Искусственный пожарный водоём',
  natural: 'Естественный пожарный водоём',
  foam: 'Пенный пожарный водоём',
  'foam-solution': 'Пожарный водоём раствора пенообразователя',
};

export const HYDRANT_PATTERN_LABELS: Readonly<Record<HydrantPattern, string>> = {
  moscow: 'Московского образца',
  leningrad: 'Ленинградского образца',
  german: 'Немецкого образца',
  other: 'Другой',
};

export const HYDRANT_PATTERN_SHORT: Readonly<Record<HydrantPattern, string>> = {
  moscow: 'МО',
  leningrad: 'ЛО',
  german: 'НО',
  other: '',
};

export function hydrantNetworkCode(object: DistrictHydrant): string {
  const network = (HYDRANT_NETWORK_SHORT as Partial<Record<string, string>>)[object.network] ?? 'К';
  return typeof object.diameterMm !== 'number' || !Number.isFinite(object.diameterMm) ? network : `${network}-${object.diameterMm}`;
}
