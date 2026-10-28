import type { DistrictMapObject, DistrictMapObjectCounts, DistrictMapProject } from './district-map-model';

const MAP_SYNC_CONFIG_URL = './data/map-sync.json';
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const COMPRESS_REQUEST_THRESHOLD_BYTES = 32 * 1024;

export type MapSyncProvider = 'yandex' | 'cloudflare' | 'local';
export type MapSyncMode = 'primary' | 'backup' | 'recovering' | 'offline' | 'conflict' | 'disabled';

export type MapSyncStatus = Readonly<{
  enabled: boolean;
  mode: MapSyncMode;
  activeProvider: MapSyncProvider;
  primaryAvailable: boolean | null;
  backupAvailable: boolean | null;
  synchronized: boolean;
  pendingOperations: number;
  sharedRevision: number | null;
  sharedUpdatedAtIso: string;
  lastSuccessAtIso: string;
  message: string;
}>;

export type MapSyncConfig = Readonly<{
  primaryApiUrl: string;
  coordinatorUrl: string;
  coordinatorEnabled: boolean;
  pollIntervalMs: number;
  legacyGist: Readonly<{ gistId: string; owner: string; fileName: string }> | null;
}>;

export type MapAdminCredential = Readonly<{
  password: string;
  sessionToken: string;
}>;

export type CoordinatedMapResponse = Readonly<{
  project: unknown;
  status: MapSyncStatus;
}>;

type MapProviderResult = Readonly<{
  provider: 'yandex' | 'cloudflare';
  response: CoordinatedMapResponse | null;
  error: unknown;
}>;

export type MapSyncObjectIndex = Readonly<{
  id: string;
  kind: string;
  objectType: string;
  hydrantType: string;
  updatedAtIso: string;
}>;

export type MapSyncManifest = Readonly<{
  revision: number;
  checksum: string;
  publishedAtIso: string;
  counts: DistrictMapObjectCounts;
  objects: readonly MapSyncObjectIndex[];
  queued: number;
}>;

export type CoordinatedObjectChange = Readonly<{
  objectId: string;
  baseObject: DistrictMapObject | null;
  object: DistrictMapObject | null;
  updatedAtIso: string;
  targetRevision: number;
}>;

export type CoordinatedObjectChangeResponse = Readonly<{
  revision: number;
  publishedAtIso: string;
  activeObject: DistrictMapObject | null;
  conflict: Readonly<{ objectId: string; local: DistrictMapObject | null; remote: DistrictMapObject | null; activeSource: 'local' | 'remote' }> | null;
  status: MapSyncStatus;
}>;

export type CoordinatedObjectBatchResponse = Readonly<{
  revision: number;
  publishedAtIso: string;
  conflicts: NonNullable<CoordinatedObjectChangeResponse['conflict']>[];
  status: MapSyncStatus;
}>;

export type CoordinatedChangesResponse = Readonly<{
  changes: readonly Readonly<{
    baseRevision: number;
    targetRevision: number;
    objectId: string;
    object: DistrictMapObject | null;
    updatedAtIso: string;
  }>[];
  nextRevision: number;
  complete: boolean;
  requiresSnapshot: boolean;
  manifest: MapSyncManifest;
}>;

export type CoordinatedPublishRequest = Readonly<{
  operationId: string;
  baseRevision: number;
  project: DistrictMapProject;
  credential: MapAdminCredential;
  signal?: AbortSignal;
}>;

type JsonRecord = Record<string, unknown>;

export class MapSyncRequestError extends Error {
  readonly status: number;
  readonly kind: 'authorization' | 'conflict' | 'unavailable' | 'limit' | 'invalid';

  constructor(message: string, status = 0, kind: MapSyncRequestError['kind'] = 'unavailable') {
    super(message);
    this.name = 'MapSyncRequestError';
    this.status = status;
    this.kind = kind;
  }
}

function isObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeStatus(value: unknown, fallback: Partial<MapSyncStatus> = {}): MapSyncStatus {
  const source = isObject(value) ? value : {};
  const mode = source.mode === 'primary' || source.mode === 'backup' || source.mode === 'recovering'
    || source.mode === 'offline' || source.mode === 'conflict' || source.mode === 'disabled'
    ? source.mode
    : fallback.mode ?? 'offline';
  const activeProvider = source.activeProvider === 'yandex' || source.activeProvider === 'cloudflare' || source.activeProvider === 'local'
    ? source.activeProvider
    : fallback.activeProvider ?? 'local';
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled ?? true,
    mode,
    activeProvider,
    primaryAvailable: booleanOrNull(source.primaryAvailable) ?? fallback.primaryAvailable ?? null,
    backupAvailable: booleanOrNull(source.backupAvailable) ?? fallback.backupAvailable ?? null,
    synchronized: typeof source.synchronized === 'boolean' ? source.synchronized : fallback.synchronized ?? false,
    pendingOperations: typeof source.pendingOperations === 'number' && Number.isFinite(source.pendingOperations)
      ? Math.max(0, Math.trunc(source.pendingOperations))
      : fallback.pendingOperations ?? 0,
    sharedRevision: typeof source.sharedRevision === 'number' && Number.isSafeInteger(source.sharedRevision)
      ? source.sharedRevision
      : fallback.sharedRevision ?? null,
    sharedUpdatedAtIso: stringValue(source.sharedUpdatedAtIso) !== ''
      ? stringValue(source.sharedUpdatedAtIso)
      : (fallback.sharedUpdatedAtIso ?? ''),
    lastSuccessAtIso: stringValue(source.lastSuccessAtIso) !== ''
      ? stringValue(source.lastSuccessAtIso)
      : (fallback.lastSuccessAtIso ?? ''),
    message: stringValue(source.message) !== '' ? stringValue(source.message) : (fallback.message ?? ''),
  };
}

export function disabledMapSyncStatus(message = 'Резервный облачный сервис пока не включён.'): MapSyncStatus {
  return normalizeStatus(null, {
    enabled: false,
    mode: 'disabled',
    activeProvider: 'yandex',
    primaryAvailable: null,
    backupAvailable: null,
    synchronized: false,
    pendingOperations: 0,
    sharedRevision: null,
    sharedUpdatedAtIso: '',
    lastSuccessAtIso: '',
    message,
  });
}

let cachedConfig: Promise<MapSyncConfig | null> | null = null;

export function clearMapSyncConfigCache(): void {
  cachedConfig = null;
}

export async function loadMapSyncConfig(): Promise<MapSyncConfig | null> {
  if (cachedConfig !== null) return cachedConfig;
  const pending = (async () => {
    try {
      const response = await fetch(`${MAP_SYNC_CONFIG_URL}?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const value: unknown = await response.json();
      if (!isObject(value)) return null;
      const primaryValue = stringValue(value.primaryApiUrl);
      const primaryApiUrl = (primaryValue !== '' ? primaryValue : stringValue(value.apiUrl)).replace(/\/+$/u, '');
      if (primaryApiUrl === '') return null;
      const coordinatorUrl = stringValue(value.coordinatorUrl).replace(/\/+$/u, '');
      const legacy = isObject(value.legacyGist) ? value.legacyGist : null;
      const legacyGist = legacy === null ? null : {
        gistId: stringValue(legacy.gistId),
        owner: stringValue(legacy.owner),
        fileName: stringValue(legacy.fileName) || 'district-map.json',
      };
      const requestedInterval = typeof value.pollIntervalMs === 'number' && Number.isFinite(value.pollIntervalMs)
        ? value.pollIntervalMs
        : DEFAULT_POLL_INTERVAL_MS;
      return {
        primaryApiUrl,
        coordinatorUrl,
        coordinatorEnabled: value.coordinatorEnabled === true && coordinatorUrl !== '',
        pollIntervalMs: Math.max(30_000, Math.min(5 * 60_000, Math.trunc(requestedInterval))),
        legacyGist: legacyGist?.gistId && legacyGist.owner ? legacyGist : null,
      };
    } catch {
      return null;
    }
  })();
  cachedConfig = pending;
  const result = await pending;
  // A temporary failure must not disable synchronization until the next page
  // reload. The following check or queued write will request the config again.
  if (result === null && cachedConfig === pending) cachedConfig = null;
  return result;
}

function requestError(status: number, payload: unknown, fallback: string): MapSyncRequestError {
  const message = isObject(payload) ? stringValue(payload.error) || stringValue(payload.message) : '';
  if (status === 401 || status === 403) return new MapSyncRequestError(message || 'Требуется повторный вход администратора.', status, 'authorization');
  if (status === 409 || status === 412) return new MapSyncRequestError(message || 'Обнаружен конфликт версий карты.', status, 'conflict');
  if (status === 429 || status === 507) return new MapSyncRequestError(message || 'Достигнут лимит резервного облачного сервиса.', status, 'limit');
  if (status >= 400 && status < 500) return new MapSyncRequestError(message || fallback, status, 'invalid');
  return new MapSyncRequestError(message || fallback, status, 'unavailable');
}

async function coordinatorRequest(path: string, init: RequestInit, timeoutMs: number, attempts = 2): Promise<unknown> {
  const config = await loadMapSyncConfig();
  if (!config?.coordinatorEnabled) throw new MapSyncRequestError('Резервный облачный сервис ещё не включён.', 0, 'unavailable');
  let lastError: MapSyncRequestError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromOutside = () => controller.abort();
    if (externalSignal?.aborted === true) controller.abort();
    else externalSignal?.addEventListener('abort', abortFromOutside, { once: true });
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${config.coordinatorUrl}${path}`, {
        ...init,
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw requestError(response.status, payload, `Сервис синхронизации вернул ошибку ${response.status}.`);
      return payload;
    } catch (error) {
      const normalized = error instanceof MapSyncRequestError
        ? error
        : controller.signal.aborted
          ? new MapSyncRequestError('Сервис синхронизации не ответил вовремя.')
          : error instanceof TypeError
            ? new MapSyncRequestError('Не удалось связаться с сервером настройки карты. Проверьте интернет и повторите вход.')
            : new MapSyncRequestError(error instanceof Error ? error.message : 'Нет связи с сервисом синхронизации.');
      lastError = normalized;
      if (externalSignal?.aborted === true || normalized.kind !== 'unavailable' || attempt === attempts - 1) throw normalized;
    } finally {
      window.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromOutside);
    }
  }
  throw lastError ?? new MapSyncRequestError('Нет связи с сервисом синхронизации.');
}

async function encodedJsonRequest(value: unknown): Promise<Readonly<{ body: BodyInit; contentType: string }>> {
  const json = JSON.stringify(value);
  if (json.length < COMPRESS_REQUEST_THRESHOLD_BYTES || typeof CompressionStream === 'undefined') {
    return { body: json, contentType: 'application/json' };
  }
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    return {
      body: await new Response(stream).arrayBuffer(),
      contentType: 'application/vnd.himkontur+json+gzip',
    };
  } catch {
    return { body: json, contentType: 'application/json' };
  }
}

export async function fetchCoordinatedMap(): Promise<CoordinatedMapResponse> {
  // A first launch may still require the full snapshot. Slow corporate routes
  // must be allowed to finish instead of being aborted after a few seconds.
  const payload = await coordinatorRequest('/v1/map', { method: 'GET' }, 180_000, 1);
  if (!isObject(payload) || !('project' in payload)) throw new MapSyncRequestError('Резервный сервис вернул некорректную карту.', 502, 'invalid');
  return { project: payload.project, status: normalizeStatus(payload.status) };
}

async function fetchPrimaryMap(): Promise<CoordinatedMapResponse> {
  const config = await loadMapSyncConfig();
  if (config === null) throw new MapSyncRequestError('Основной облачный сервис ещё не настроен.', 0, 'unavailable');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(`${config.primaryApiUrl}?ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw requestError(response.status, payload, `Основной сервис вернул ошибку ${response.status}.`);
    if (!isObject(payload) || !('project' in payload)) {
      throw new MapSyncRequestError('Основной сервис вернул некорректную карту.', 502, 'invalid');
    }
    return {
      project: payload.project,
      status: normalizeStatus(null, {
        mode: 'primary',
        activeProvider: 'yandex',
        primaryAvailable: true,
        backupAvailable: null,
        synchronized: false,
        message: 'Карта загружена из основной базы.',
      }),
    };
  } catch (error) {
    if (error instanceof MapSyncRequestError) throw error;
    if (controller.signal.aborted) throw new MapSyncRequestError('Основной сервис синхронизации не ответил вовремя.');
    if (error instanceof TypeError) throw new MapSyncRequestError('Не удалось связаться с основной базой карты.');
    throw new MapSyncRequestError(error instanceof Error ? error.message : 'Основная база карты недоступна.');
  } finally {
    window.clearTimeout(timeout);
  }
}

function mapRevision(value: unknown): number {
  if (!isObject(value)) return 0;
  return typeof value.revision === 'number' && Number.isSafeInteger(value.revision) ? value.revision : 0;
}

function settledProviderMap(
  provider: MapProviderResult['provider'],
  request: Promise<CoordinatedMapResponse>,
): Promise<MapProviderResult> {
  return request.then(
    (response) => ({ provider, response, error: null }),
    (error: unknown) => ({ provider, response: null, error }),
  );
}

/**
 * Starts both shared-map providers at the same time. Yandex is authoritative
 * while it is healthy; Cloudflare remains a transparent fallback. No provider
 * choice is exposed to the user.
 */
export async function fetchAvailableMap(): Promise<CoordinatedMapResponse> {
  const cloudflare = settledProviderMap('cloudflare', fetchCoordinatedMap());
  const yandex = settledProviderMap('yandex', fetchPrimaryMap());
  const first = await Promise.race([cloudflare, yandex]);
  const secondPromise = first.provider === 'cloudflare' ? yandex : cloudflare;

  if (first.response === null) {
    const second = await secondPromise;
    if (second.response !== null) return second.response;
    const firstMessage = first.error instanceof Error ? first.error.message : 'сервис недоступен';
    const secondMessage = second.error instanceof Error ? second.error.message : 'сервис недоступен';
    throw new MapSyncRequestError(`Не удалось получить карту ни из одного облачного сервиса. Cloudflare: ${first.provider === 'cloudflare' ? firstMessage : secondMessage}; Яндекс: ${first.provider === 'yandex' ? firstMessage : secondMessage}`);
  }

  if (first.provider === 'yandex') {
    // A backup edit may be newer while Yandex is recovering. The compact
    // manifest lets us compare revisions without waiting for a second full map
    // when the primary response is already current.
    const backupManifest = await fetchCoordinatedMapManifest().catch(() => null);
    if (backupManifest === null || backupManifest.manifest.revision <= mapRevision(first.response.project)) {
      return first.response;
    }
    const second = await secondPromise;
    if (second.response === null) return first.response;
    return mapRevision(second.response.project) > mapRevision(first.response.project)
      ? second.response
      : first.response;
  }

  // When the coordinator reports that Yandex is healthy but its own replica is
  // behind, wait for the already-running primary request and compare revisions.
  const shouldWaitForPrimary = first.response.status.activeProvider === 'yandex'
    && first.response.status.primaryAvailable !== false
    && !first.response.status.synchronized;
  if (!shouldWaitForPrimary) return first.response;

  const second = await secondPromise;
  if (second.response === null) return first.response;
  return mapRevision(second.response.project) >= mapRevision(first.response.project)
    ? second.response
    : first.response;
}

function normalizeManifest(value: unknown): MapSyncManifest | null {
  if (!isObject(value) || !Number.isSafeInteger(value.revision) || !Array.isArray(value.objects) || !isObject(value.counts)) return null;
  const counts = value.counts;
  const count = (key: string) => typeof counts[key] === 'number' ? Math.max(0, Math.trunc(counts[key])) : 0;
  const objects = value.objects.filter(isObject).map((object) => ({
    id: stringValue(object.id), kind: stringValue(object.kind), objectType: stringValue(object.objectType),
    hydrantType: stringValue(object.hydrantType), updatedAtIso: stringValue(object.updatedAtIso),
  })).filter((object) => object.id !== '');
  return {
    revision: value.revision as number,
    checksum: stringValue(value.checksum),
    publishedAtIso: stringValue(value.publishedAtIso),
    counts: {
      buildings: count('buildings'), territories: count('territories'), installations: count('installations'),
      demolished: count('demolished'), standardHydrants: count('standardHydrants'), foamHydrants: count('foamHydrants'),
      reservoirs: count('reservoirs'), waterSources: count('standardHydrants') + count('foamHydrants') + count('reservoirs'), total: count('total'),
    },
    objects,
    queued: typeof value.queued === 'number' ? Math.max(0, Math.trunc(value.queued)) : 0,
  };
}

export async function fetchCoordinatedMapManifest(): Promise<Readonly<{ manifest: MapSyncManifest; status: MapSyncStatus }>> {
  const payload = await coordinatorRequest('/v1/manifest', { method: 'GET' }, 30_000);
  const manifest = isObject(payload) ? normalizeManifest(payload.manifest) : null;
  if (!isObject(payload) || manifest === null) throw new MapSyncRequestError('Сервис вернул некорректный состав карты.', 502, 'invalid');
  return { manifest, status: normalizeStatus(payload.status) };
}

export async function fetchCoordinatedMapChanges(sinceRevision: number): Promise<CoordinatedChangesResponse> {
  const payload = await coordinatorRequest(`/v1/changes?since=${encodeURIComponent(String(sinceRevision))}`, { method: 'GET' }, 60_000);
  const manifest = isObject(payload) ? normalizeManifest(payload.manifest) : null;
  if (!isObject(payload) || manifest === null || !Array.isArray(payload.changes)) throw new MapSyncRequestError('Сервис вернул некорректный список изменений.', 502, 'invalid');
  return {
    changes: payload.changes as CoordinatedChangesResponse['changes'],
    nextRevision: typeof payload.nextRevision === 'number' ? payload.nextRevision : sinceRevision,
    complete: payload.complete === true,
    requiresSnapshot: payload.requiresSnapshot === true,
    manifest,
  };
}

export async function authenticateMapAdmin(password: string): Promise<Readonly<{ credential: MapAdminCredential; status: MapSyncStatus }>> {
  const payload = await coordinatorRequest('/v1/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminPassword: password }),
  }, 12_000);
  if (!isObject(payload) || stringValue(payload.sessionToken) === '') throw new MapSyncRequestError('Сервис не выдал административную сессию.', 502, 'invalid');
  return {
    // Keep the password only in this in-memory credential so an expired
    // eight-hour session can be renewed without losing queued map edits.
    credential: { password, sessionToken: stringValue(payload.sessionToken) },
    status: normalizeStatus(payload.status),
  };
}

/** Retries one authorized operation with a fresh session when the eight-hour token has expired. */
export async function withRenewedMapAdminSession<T>(
  credential: MapAdminCredential,
  operation: (activeCredential: MapAdminCredential) => Promise<T>,
): Promise<Readonly<{ value: T; credential: MapAdminCredential; status: MapSyncStatus | null }>> {
  try {
    return { value: await operation(credential), credential, status: null };
  } catch (error) {
    if (!(error instanceof MapSyncRequestError) || error.kind !== 'authorization' || credential.password === '') throw error;
    const authenticated = await authenticateMapAdmin(credential.password);
    return {
      value: await operation(authenticated.credential),
      credential: authenticated.credential,
      status: authenticated.status,
    };
  }
}

export async function publishCoordinatedMap(request: CoordinatedPublishRequest): Promise<CoordinatedMapResponse> {
  const encoded = await encodedJsonRequest({
    operationId: request.operationId,
    baseRevision: request.baseRevision,
    project: request.project,
    updatedBy: 'Администратор ХИМКОНТУР',
  });
  let payload: unknown;
  try {
    payload = await coordinatorRequest('/v1/map', {
      method: 'POST',
      headers: {
        'Content-Type': encoded.contentType,
        Authorization: `Bearer ${request.credential.sessionToken}`,
      },
      body: encoded.body,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    }, 180_000);
  } catch (error) {
    if (request.signal?.aborted === true) throw error;
    if (!(error instanceof MapSyncRequestError) || error.kind !== 'unavailable') throw error;
    // A timeout can happen after D1 has already committed the operation but
    // before the response reaches the browser. Verify the idempotent operation
    // before claiming that the edit exists only on this device.
    const verified = await coordinatorRequest(`/v1/operations/${encodeURIComponent(request.operationId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${request.credential.sessionToken}` },
    }, 60_000, 1).catch(() => null);
    if (!isObject(verified) || !('project' in verified)) throw error;
    payload = verified;
  }
  if (!isObject(payload) || !('project' in payload)) throw new MapSyncRequestError('Сервис синхронизации вернул некорректный ответ.', 502, 'invalid');
  return { project: payload.project, status: normalizeStatus(payload.status) };
}

export async function publishCoordinatedObjectChange(request: Readonly<{
  operationId: string;
  baseRevision: number;
  change: CoordinatedObjectChange;
  credential: MapAdminCredential;
}>): Promise<CoordinatedObjectChangeResponse> {
  const payload = await coordinatorRequest('/v1/object', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.credential.sessionToken}` },
    body: JSON.stringify({
      operationId: request.operationId,
      baseRevision: request.baseRevision,
      change: request.change,
      updatedBy: 'Администратор ХИМКОНТУР',
    }),
  }, 120_000);
  if (!isObject(payload) || typeof payload.revision !== 'number' || !('activeObject' in payload)) {
    throw new MapSyncRequestError('Сервис синхронизации вернул некорректное подтверждение объекта.', 502, 'invalid');
  }
  return {
    revision: payload.revision,
    publishedAtIso: stringValue(payload.publishedAtIso),
    activeObject: (payload.activeObject ?? null) as DistrictMapObject | null,
    conflict: (payload.conflict ?? null) as CoordinatedObjectChangeResponse['conflict'],
    status: normalizeStatus(payload.status),
  };
}

export async function publishCoordinatedObjectChanges(request: Readonly<{
  operationId: string;
  baseRevision: number;
  changes: readonly CoordinatedObjectChange[];
  credential: MapAdminCredential;
  signal?: AbortSignal;
}>): Promise<CoordinatedObjectBatchResponse> {
  const encoded = await encodedJsonRequest({
    operationId: request.operationId,
    baseRevision: request.baseRevision,
    changes: request.changes,
    updatedBy: 'Администратор ХИМКОНТУР',
  });
  const payload = await coordinatorRequest('/v1/objects', {
    method: 'POST',
    headers: { 'Content-Type': encoded.contentType, Authorization: `Bearer ${request.credential.sessionToken}` },
    body: encoded.body,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  }, 180_000);
  if (!isObject(payload) || typeof payload.revision !== 'number' || !Array.isArray(payload.conflicts)) {
    throw new MapSyncRequestError('Сервис синхронизации вернул некорректное подтверждение пакета.', 502, 'invalid');
  }
  return {
    revision: payload.revision,
    publishedAtIso: stringValue(payload.publishedAtIso),
    conflicts: payload.conflicts as CoordinatedObjectBatchResponse['conflicts'],
    status: normalizeStatus(payload.status),
  };
}

export async function checkMapSynchronization(credential?: MapAdminCredential): Promise<MapSyncStatus> {
  const path = credential?.sessionToken ? '/v1/reconcile' : '/v1/status?deep=1';
  const payload = await coordinatorRequest(path, credential?.sessionToken ? {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential.sessionToken}` },
  } : { method: 'GET' }, 20_000);
  return normalizeStatus(isObject(payload) ? payload.status : null);
}

export function normalizeMapSyncStatus(value: unknown): MapSyncStatus {
  return normalizeStatus(value);
}
