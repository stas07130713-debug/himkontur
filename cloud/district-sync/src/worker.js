const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const AUTH_WINDOW_SECONDS = 15 * 60;
const AUTH_MAX_ATTEMPTS = 8;
const AUTH_BLOCK_SECONDS = 30 * 60;
const HISTORY_LIMIT = 40;
const EVENT_LIMIT = 250;

function jsonResponse(request, env, status, body) {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

export function isAllowedOrigin(origin, configuredOrigins) {
  const allowed = String(configuredOrigins ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    const url = new URL(origin);
    const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return localHost && (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'capacitor:');
  } catch {
    return false;
  }
}

function corsHeaders(request, env) {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  });
  const origin = request.headers.get('Origin') ?? 'null';
  if (isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function validProject(project) {
  return project !== null
    && typeof project === 'object'
    && project.id === 'district-map-main'
    && typeof project.name === 'string'
    && Number.isSafeInteger(project.revision)
    && project.revision >= 0
    && Array.isArray(project.draft)
    && Array.isArray(project.published);
}

function validMapObject(value, expectedId) {
  return value !== null
    && typeof value === 'object'
    && text(value.id) === expectedId
    && ['building', 'hydrant', 'reservoir'].includes(value.kind)
    && value.point !== null
    && typeof value.point === 'object'
    && Number.isFinite(value.point.latitude)
    && Number.isFinite(value.point.longitude);
}

function sameObject(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function objectTimestamp(value, fallback = '') {
  const timestamp = Date.parse(text(value?.updatedAtIso) || fallback);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function applyObjectChange(project, change, nowIso = new Date().toISOString()) {
  const objectId = text(change?.objectId).slice(0, 180);
  if (objectId === '') throw new HttpError(400, 'Не указан объект изменения.');
  const baseObject = change.baseObject ?? null;
  const localObject = change.object ?? null;
  if (baseObject !== null && !validMapObject(baseObject, objectId)) throw new HttpError(400, 'Некорректная базовая версия объекта.');
  if (localObject !== null && !validMapObject(localObject, objectId)) throw new HttpError(400, 'Некорректная новая версия объекта.');
  if (baseObject === null && localObject === null) throw new HttpError(400, 'Пустое изменение объекта.');

  const objects = [...project.published];
  const index = objects.findIndex((object) => object.id === objectId);
  const remoteObject = index >= 0 ? objects[index] : null;
  const remoteChanged = !sameObject(remoteObject, baseObject);
  let activeObject = localObject;
  let activeSource = 'local';
  let conflict = null;
  if (remoteChanged && !sameObject(localObject, remoteObject)) {
    if (localObject === null) {
      activeObject = remoteObject;
      activeSource = 'remote';
    } else if (remoteObject === null) {
      activeObject = localObject;
    } else if (objectTimestamp(remoteObject) > objectTimestamp(localObject, text(change.updatedAtIso))) {
      activeObject = remoteObject;
      activeSource = 'remote';
    }
    conflict = { objectId, local: localObject, remote: remoteObject, activeSource };
  }

  if (index >= 0) {
    if (activeObject === null) objects.splice(index, 1);
    else objects[index] = activeObject;
  } else if (activeObject !== null) {
    objects.push(activeObject);
  }
  const revision = Math.max(project.revision + 1, Number(change.targetRevision) || 0, Date.now());
  const publishedAtIso = nowIso;
  return {
    project: {
      ...project,
      revision,
      draft: objects,
      published: objects,
      draftSavedAtIso: publishedAtIso,
      publishedAtIso,
    },
    activeObject,
    conflict,
  };
}

function mapManifest(state, queued) {
  const objects = state?.project?.published ?? [];
  return {
    revision: state?.revision ?? null,
    checksum: state?.checksum ?? '',
    publishedAtIso: text(state?.project?.publishedAtIso),
    counts: {
      total: objects.length,
      buildings: objects.filter((object) => object?.kind === 'building' && object.objectType === 'building').length,
      territories: objects.filter((object) => object?.kind === 'building' && object.objectType === 'territory').length,
      installations: objects.filter((object) => object?.kind === 'building' && object.objectType === 'installation').length,
      demolished: objects.filter((object) => object?.kind === 'building' && object.objectType === 'demolished').length,
      standardHydrants: objects.filter((object) => object?.kind === 'hydrant' && object.hydrantType !== 'foam').length,
      foamHydrants: objects.filter((object) => object?.kind === 'hydrant' && object.hydrantType === 'foam').length,
      reservoirs: objects.filter((object) => object?.kind === 'reservoir').length,
    },
    objects: objects.map((object) => ({
      id: object.id,
      kind: object.kind,
      objectType: object.objectType ?? '',
      hydrantType: object.hydrantType ?? '',
      updatedAtIso: text(object.updatedAtIso),
    })),
    queued,
  };
}

function compactObjectResponse(state, queued, operationId, operationStatus, objectId, conflict = null, message = '') {
  const activeObject = state.project.published.find((object) => object.id === objectId) ?? null;
  return {
    operationId,
    operationStatus,
    revision: state.revision,
    publishedAtIso: text(state.project.publishedAtIso),
    activeObject,
    conflict,
    status: statusFrom(state, operationStatus === 'applied', true, queued, message),
  };
}

function compactBatchResponse(state, queued, operationId, operationStatus, conflicts = [], message = '') {
  return {
    operationId,
    operationStatus,
    revision: state.revision,
    publishedAtIso: text(state.project.publishedAtIso),
    conflicts,
    status: statusFrom(state, operationStatus === 'applied', true, queued, message),
  };
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function integer(value) {
  return Number.isSafeInteger(value) ? value : null;
}

export async function readJson(request) {
  const compressed = request.headers.get('Content-Type')?.toLowerCase().includes('application/vnd.himkontur+json+gzip') === true;
  let raw;
  try {
    if (compressed) {
      if (request.body === null) raw = '';
      else raw = await new Response(request.body.pipeThrough(new DecompressionStream('gzip'))).text();
    } else {
      raw = await request.text();
    }
  } catch {
    throw new HttpError(400, 'Не удалось распаковать данные карты.');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'Объём данных превышает 2 МБ.');
  try {
    return raw === '' ? {} : JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Некорректный JSON.');
  }
}

class HttpError extends Error {
  constructor(status, message, detail = '') {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function timingSafeTextEqual(left, right) {
  const leftHash = await hmac('himkontur-constant-time-comparison', String(left));
  const rightHash = await hmac('himkontur-constant-time-comparison', String(right));
  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < leftHash.length; index += 1) difference |= leftHash[index] ^ rightHash[index];
  return difference === 0;
}

async function issueSession(env) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ scope: 'map:write', exp: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS })));
  return `${payload}.${base64Url(await hmac(env.SESSION_SECRET, payload))}`;
}

async function requireSession(request, env) {
  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !env.SESSION_SECRET) throw new HttpError(401, 'Требуется повторный вход администратора.');
  const expected = await hmac(env.SESSION_SECRET, payload);
  const actual = decodeBase64Url(signature);
  if (actual.length !== expected.length) throw new HttpError(401, 'Недействительная административная сессия.');
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  if (difference !== 0) throw new HttpError(401, 'Недействительная административная сессия.');
  let decoded;
  try {
    decoded = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
  } catch {
    throw new HttpError(401, 'Недействительная административная сессия.');
  }
  if (decoded.scope !== 'map:write' || !Number.isSafeInteger(decoded.exp) || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, 'Срок административной сессии истёк.');
  }
}

function clientKey(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

async function checkAuthRateLimit(request, env) {
  const key = clientKey(request);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT attempts, window_started_at, blocked_until FROM auth_rate_limits WHERE client_key = ?').bind(key).first();
  if (row && Number(row.blocked_until) > now) throw new HttpError(429, 'Слишком много попыток. Повторите вход позже.');
  if (row && now - Number(row.window_started_at) <= AUTH_WINDOW_SECONDS) return { key, attempts: Number(row.attempts), startedAt: Number(row.window_started_at) };
  return { key, attempts: 0, startedAt: now };
}

async function recordFailedAuth(env, rate) {
  const attempts = rate.attempts + 1;
  const blockedUntil = attempts >= AUTH_MAX_ATTEMPTS ? Math.floor(Date.now() / 1000) + AUTH_BLOCK_SECONDS : 0;
  await env.DB.prepare('INSERT INTO auth_rate_limits (client_key, attempts, window_started_at, blocked_until) VALUES (?, ?, ?, ?) ON CONFLICT(client_key) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until')
    .bind(rate.key, attempts, rate.startedAt, blockedUntil).run();
}

async function clearAuthFailures(request, env) {
  await env.DB.prepare('DELETE FROM auth_rate_limits WHERE client_key = ?').bind(clientKey(request)).run();
}

async function event(env, level, eventType, message) {
  const safeMessage = text(message).slice(0, 500);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sync_events (level, event_type, message, created_at) VALUES (?, ?, ?, ?)').bind(level, eventType, safeMessage, new Date().toISOString()),
    env.DB.prepare('DELETE FROM sync_events WHERE id NOT IN (SELECT id FROM sync_events ORDER BY id DESC LIMIT ?)').bind(EVENT_LIMIT),
  ]);
}

async function readState(env) {
  const row = await env.DB.prepare('SELECT revision, project_json, checksum, primary_revision, mode, updated_at, last_primary_success_at, last_error FROM map_state WHERE id = 1').first();
  if (!row) return null;
  return {
    revision: Number(row.revision),
    project: JSON.parse(row.project_json),
    projectJson: row.project_json,
    checksum: row.checksum,
    primaryRevision: Number(row.primary_revision),
    mode: row.mode,
    updatedAt: row.updated_at,
    lastPrimarySuccessAt: row.last_primary_success_at,
    lastError: row.last_error,
  };
}

async function pendingCount(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM map_operations WHERE status IN ('queued', 'processing', 'conflict')").first();
  return Number(row?.count ?? 0);
}

function normalizePrimaryPayload(payload) {
  if (!payload || typeof payload !== 'object' || !validProject(payload.project)) return null;
  return {
    protocolVersion: Number(payload.protocolVersion ?? 1),
    project: payload.project,
    revision: Number(payload.project.revision),
  };
}

async function callPrimary(env, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 7000);
  try {
    const separator = env.YANDEX_API_URL.includes('?') ? '&' : '?';
    const primaryUrl = `${env.YANDEX_API_URL}${separator}ts=${Date.now()}`;
    const response = await fetch(primaryUrl, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, payload };
    const normalized = normalizePrimaryPayload(payload);
    return normalized === null ? { ok: false, status: 502, payload } : { ok: true, status: response.status, ...normalized };
  } catch (error) {
    return { ok: false, status: 0, payload: null, error: error instanceof Error ? error.message : 'primary unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeState(env, project, provider, primaryRevision, mode, lastError = '') {
  const projectJson = JSON.stringify(project);
  const checksum = await sha256(projectJson);
  const now = new Date().toISOString();
  const primarySuccess = provider === 'yandex' ? now : '';
  await env.DB.batch([
    env.DB.prepare('INSERT INTO map_state (id, revision, project_json, checksum, primary_revision, mode, updated_at, last_primary_success_at, last_error) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, project_json = excluded.project_json, checksum = excluded.checksum, primary_revision = excluded.primary_revision, mode = excluded.mode, updated_at = excluded.updated_at, last_primary_success_at = CASE WHEN excluded.last_primary_success_at = \'\' THEN map_state.last_primary_success_at ELSE excluded.last_primary_success_at END, last_error = excluded.last_error')
      .bind(project.revision, projectJson, checksum, primaryRevision, mode, now, primarySuccess, lastError),
    env.DB.prepare('INSERT OR REPLACE INTO map_history (revision, project_json, checksum, provider, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(project.revision, projectJson, checksum, provider, now),
    env.DB.prepare('DELETE FROM map_history WHERE revision NOT IN (SELECT revision FROM map_history ORDER BY revision DESC LIMIT ?)').bind(HISTORY_LIMIT),
  ]);
  return { projectJson, checksum, now };
}

async function conditionalBackupCommit(env, operation, status, primaryRevision, mode, objectChanges = []) {
  const state = await readState(env);
  if (state === null) throw new HttpError(503, 'Резервная база не инициализирована.');
  if (state.revision !== operation.baseRevision) throw new HttpError(409, 'Карта уже изменена в другом браузере. Сначала обновите данные.', `expected ${operation.baseRevision}, current ${state.revision}`);
  const projectJson = JSON.stringify(operation.project);
  const checksum = await sha256(projectJson);
  const now = new Date().toISOString();
  const compactQueued = status === 'queued';
  const queueBaseRevision = operationQueueBaseRevision(status, operation.baseRevision, primaryRevision);
  const statements = [];
  if (compactQueued) {
    // Every queued record contains a complete map snapshot. Keep only the
    // newest snapshot in the active failback queue; older records remain as
    // superseded audit entries and no longer inflate the synchronization count.
    statements.push(env.DB.prepare("UPDATE map_operations SET status = 'superseded', error = 'Объединена с более новой полной копией карты.' WHERE status = 'queued' AND EXISTS (SELECT 1 FROM map_state WHERE id = 1 AND revision = ?)")
      .bind(operation.baseRevision));
  }
  statements.push(
    env.DB.prepare('INSERT OR REPLACE INTO map_operations (operation_id, base_revision, target_revision, project_json, checksum, status, created_at, applied_at, error) SELECT ?, ?, ?, ?, ?, ?, ?, ?, \'\' WHERE EXISTS (SELECT 1 FROM map_state WHERE id = 1 AND revision = ?)')
      .bind(operation.operationId, queueBaseRevision, operation.project.revision, projectJson, checksum, status, operation.createdAt, status === 'applied' ? now : '', operation.baseRevision),
    env.DB.prepare('INSERT OR REPLACE INTO map_history (revision, project_json, checksum, provider, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM map_state WHERE id = 1 AND revision = ?)')
      .bind(operation.project.revision, projectJson, checksum, mode === 'primary' ? 'yandex' : 'cloudflare', now, operation.baseRevision),
  );
  const stateUpdateIndex = statements.length;
  statements.push(env.DB.prepare('UPDATE map_state SET revision = ?, project_json = ?, checksum = ?, primary_revision = ?, mode = ?, updated_at = ?, last_primary_success_at = CASE WHEN ? = \'primary\' THEN ? ELSE last_primary_success_at END, last_error = \'\' WHERE id = 1 AND revision = ?')
    .bind(operation.project.revision, projectJson, checksum, primaryRevision, mode, now, mode, now, operation.baseRevision));
  for (let offset = 0; offset < objectChanges.length; offset += 40) {
    const group = objectChanges.slice(offset, offset + 40);
    const placeholders = group.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const bindings = group.flatMap((change, index) => [
      objectChanges.length === 1 ? operation.operationId : `${operation.operationId}.${offset + index + 1}`,
      change.baseRevision, change.targetRevision, change.objectId,
      JSON.stringify(change.object ?? null), change.updatedAtIso, now,
    ]);
    statements.push(env.DB.prepare(`INSERT OR REPLACE INTO map_object_changes (operation_id, base_revision, target_revision, object_id, object_json, updated_at, created_at) VALUES ${placeholders}`).bind(...bindings));
  }
  statements.push(env.DB.prepare('DELETE FROM map_history WHERE revision NOT IN (SELECT revision FROM map_history ORDER BY revision DESC LIMIT ?)').bind(HISTORY_LIMIT));
  statements.push(env.DB.prepare("DELETE FROM map_operations WHERE status = 'superseded' AND operation_id NOT IN (SELECT operation_id FROM map_operations WHERE status = 'superseded' ORDER BY created_at DESC LIMIT 20)"));
  const results = await env.DB.batch(statements);
  if (Number(results[stateUpdateIndex]?.meta?.changes ?? 0) !== 1) throw new HttpError(409, 'Карта уже изменена в другом браузере. Сначала обновите данные.');
}

async function compactPendingSnapshots(env, state) {
  const queued = await env.DB.prepare("SELECT operation_id FROM map_operations WHERE status = 'queued' ORDER BY created_at DESC, operation_id DESC LIMIT 2").all();
  if (queued.results.length <= 1) return;
  const newestOperationId = queued.results[0].operation_id;
  await env.DB.batch([
    env.DB.prepare("UPDATE map_operations SET status = 'superseded', error = 'Объединена с более новой полной копией карты.' WHERE status = 'queued' AND operation_id <> ?")
      .bind(newestOperationId),
    env.DB.prepare("UPDATE map_operations SET base_revision = ?, error = '' WHERE operation_id = ? AND status = 'queued'")
      .bind(state.primaryRevision, newestOperationId),
  ]);
  await event(env, 'info', 'queue-compacted', `latest=${newestOperationId}, base=${state.primaryRevision}`);
}

function statusFrom(state, primaryAvailable, backupAvailable, queued, message = '') {
  const mode = !backupAvailable ? 'offline' : state?.mode === 'conflict' ? 'conflict' : primaryAvailable ? (queued > 0 ? 'recovering' : 'primary') : 'backup';
  return {
    enabled: true,
    mode,
    activeProvider: backupAvailable && queued > 0 ? 'cloudflare' : primaryAvailable ? 'yandex' : backupAvailable ? 'cloudflare' : 'local',
    primaryAvailable,
    backupAvailable,
    synchronized: Boolean(primaryAvailable && backupAvailable && queued === 0 && state && state.revision === state.primaryRevision),
    pendingOperations: queued,
    sharedRevision: state?.revision ?? null,
    sharedUpdatedAtIso: state?.updatedAt || '',
    lastSuccessAtIso: state?.lastPrimarySuccessAt || state?.updatedAt || '',
    message: message || state?.lastError || (mode === 'primary' ? 'Основная и резервная базы работают.' : mode === 'backup' ? 'Яндекс недоступен: используется резервная база.' : ''),
  };
}

export function needsConflictRecovery(state, conflictCount) {
  return state?.mode === 'conflict' || conflictCount > 0;
}

export function mirrorReconciliationAction(primaryRevision, sharedRevision, queued) {
  if (queued > 0 || !Number.isSafeInteger(primaryRevision) || !Number.isSafeInteger(sharedRevision)) return 'queue';
  if (primaryRevision > sharedRevision) return 'pull-primary';
  if (primaryRevision < sharedRevision) return 'keep-shared';
  return 'synchronized';
}

async function recoverSharedMapFromMirrorConflict(env, state) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE map_operations SET status = 'superseded', error = 'Расхождение с зеркалом Яндекс не блокирует общую карту Cloudflare.' WHERE status = 'conflict'"),
    env.DB.prepare("UPDATE map_state SET mode = 'backup', last_error = '' WHERE id = 1"),
  ]);
  await event(env, 'warning', 'mirror-conflict-recovered', `sharedRevision=${state?.revision ?? 'none'}, at=${now}`);
}

export function shouldUseBackupImmediately(state, queued) {
  return state !== null && (state.mode === 'backup' || queued > 0);
}

export function operationQueueBaseRevision(status, operationBaseRevision, primaryRevision) {
  return status === 'queued' ? primaryRevision : operationBaseRevision;
}

export function canRebaseLegacyOperation(operationId, incomingProject, sharedProject, queued) {
  if (!operationId.startsWith('legacy-') || queued !== 0) return false;
  const incomingPublishedAt = Date.parse(incomingProject.publishedAtIso);
  const sharedPublishedAt = Date.parse(sharedProject.publishedAtIso);
  return Number.isFinite(incomingPublishedAt)
    && (!Number.isFinite(sharedPublishedAt) || incomingPublishedAt > sharedPublishedAt);
}

export function validAuthoritativeRecovery(payload) {
  const baseRevision = integer(payload.baseRevision);
  const operationId = text(payload.operationId).slice(0, 160);
  return payload.authoritativeRecovery === true
    && baseRevision !== null
    && operationId !== ''
    && baseRevision < payload.project.revision;
}

async function reconcile(env) {
  let state = await readState(env);
  if (state === null) return { state: null, primaryAvailable: false, queued: 0, message: 'Резервная база ещё не инициализирована.' };
  const conflictRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM map_operations WHERE status = 'conflict'").first();
  if (needsConflictRecovery(state, Number(conflictRow?.count ?? 0))) {
    await recoverSharedMapFromMirrorConflict(env, state);
    state = await readState(env);
  }
  await compactPendingSnapshots(env, state);
  const primary = await callPrimary(env);
  if (!primary.ok) {
    await env.DB.prepare("UPDATE map_state SET mode = 'backup', last_error = ? WHERE id = 1").bind('Основная база Яндекс временно недоступна.').run();
    return { state: { ...state, mode: 'backup' }, primaryAvailable: false, queued: await pendingCount(env), message: 'Основная база Яндекс временно недоступна.' };
  }
  const queued = await env.DB.prepare("SELECT operation_id, base_revision, target_revision, project_json, created_at FROM map_operations WHERE status = 'queued' ORDER BY created_at ASC").all();
  if (queued.results.length === 0) {
    const action = mirrorReconciliationAction(primary.revision, state.revision, 0);
    if (action === 'pull-primary') {
      await writeState(env, primary.project, 'yandex', primary.revision, 'primary');
      await event(env, 'info', 'mirror-primary-pulled', `yandex=${primary.revision}, previousShared=${state.revision}`);
      state = await readState(env);
      return { state, primaryAvailable: true, queued: 0, message: 'Новая редакция Яндекса автоматически перенесена в резервную базу.' };
    }
    if (action === 'keep-shared') {
      await env.DB.prepare("UPDATE map_state SET primary_revision = ?, mode = 'backup', last_error = '' WHERE id = 1")
        .bind(primary.revision).run();
      await event(env, 'warning', 'mirror-revision-difference', `yandex=${primary.revision}, shared=${state.revision}`);
      state = await readState(env);
      return { state, primaryAvailable: true, queued: 0, message: 'Резервная база содержит более новую редакцию; автоматическая перезапись Яндекса остановлена для защиты данных.' };
    } else {
      await env.DB.prepare("UPDATE map_state SET primary_revision = ?, mode = 'primary', last_primary_success_at = ?, last_error = '' WHERE id = 1")
        .bind(primary.revision, new Date().toISOString()).run();
      state = await readState(env);
    }
    return { state, primaryAvailable: true, queued: 0, message: 'Основная и резервная базы синхронизированы.' };
  }
  if (primary.protocolVersion < 2 || !env.PRIMARY_SYNC_TOKEN) {
    return { state, primaryAvailable: true, queued: queued.results.length, message: 'Основная база доступна, но защищённый протокол синхронизации ещё не включён.' };
  }
  for (const row of queued.results) {
    if (primary.revision !== Number(row.base_revision)) {
      await env.DB.prepare("UPDATE map_operations SET base_revision = ?, error = '' WHERE operation_id = ?")
        .bind(primary.revision, row.operation_id).run();
      row.base_revision = primary.revision;
      await event(env, 'warning', 'mirror-operation-rebased', `operation=${row.operation_id}, yandex=${primary.revision}`);
    }
    const project = JSON.parse(row.project_json);
    const result = await callPrimary(env, {
      method: 'POST',
      timeoutMs: 15000,
      body: { coordinatorToken: env.PRIMARY_SYNC_TOKEN, operationId: row.operation_id, baseRevision: Number(row.base_revision), project, updatedBy: 'Cloudflare failback' },
    });
    if (!result.ok) return { state, primaryAvailable: false, queued: await pendingCount(env), message: 'Не удалось передать отложенные изменения в Яндекс.' };
    primary.revision = result.revision;
    primary.project = result.project;
    await env.DB.prepare("UPDATE map_operations SET status = 'applied', applied_at = ?, error = '' WHERE operation_id = ?")
      .bind(new Date().toISOString(), row.operation_id).run();
  }
  await writeState(env, primary.project, 'yandex', primary.revision, 'primary');
  await event(env, 'info', 'failback-complete', `revision=${primary.revision}`);
  state = await readState(env);
  return { state, primaryAvailable: true, queued: 0, message: 'Отложенные изменения переданы в Яндекс; базы синхронизированы.' };
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return jsonResponse(request, env, 204, {});
  if (!corsHeaders(request, env).has('Access-Control-Allow-Origin')) return jsonResponse(request, env, 403, { error: 'Источник запроса не разрешён.' });

  if (request.method === 'GET' && url.pathname === '/v1/map') {
    const state = await readState(env);
    const queued = await pendingCount(env);
    // D1 is the coordinator's authoritative read copy. Do not make every map
    // opening wait for Yandex: the scheduled reconciliation checks Yandex in
    // the background and refreshes this copy after recovery.
    if (state !== null) {
      const primaryKnownAvailable = state.mode === 'primary' && queued === 0;
      return jsonResponse(request, env, 200, {
        project: state.project,
        status: statusFrom(state, primaryKnownAvailable, true, queued),
      });
    }
    const primary = await callPrimary(env, { timeoutMs: 5000 });
    if (primary.ok) {
      ctx.waitUntil(writeState(env, primary.project, 'yandex', primary.revision, 'primary'));
      return jsonResponse(request, env, 200, { project: primary.project, status: statusFrom({ revision: primary.revision, primaryRevision: primary.revision }, true, false, 0) });
    }
    throw new HttpError(503, 'Основная и резервная базы недоступны. Используйте локальную копию.');
  }

  if (request.method === 'GET' && url.pathname === '/v1/manifest') {
    const state = await readState(env);
    if (state === null) throw new HttpError(503, 'Общая карта ещё не инициализирована.');
    const queued = await pendingCount(env);
    return jsonResponse(request, env, 200, {
      manifest: mapManifest(state, queued),
      status: statusFrom(state, state.mode === 'primary' && queued === 0, true, queued),
    });
  }

  if (request.method === 'GET' && url.pathname === '/v1/changes') {
    const since = integer(Number(url.searchParams.get('since')));
    if (since === null) throw new HttpError(400, 'Не указана версия карты для получения изменений.');
    const state = await readState(env);
    if (state === null) throw new HttpError(503, 'Общая карта ещё не инициализирована.');
    const queued = await pendingCount(env);
    if (since === state.revision) {
      return jsonResponse(request, env, 200, {
        changes: [], nextRevision: since, complete: true, requiresSnapshot: false,
        manifest: mapManifest(state, queued),
      });
    }
    if (since > state.revision) {
      return jsonResponse(request, env, 200, {
        changes: [], nextRevision: since, complete: false, requiresSnapshot: true,
        manifest: mapManifest(state, queued),
      });
    }
    const rows = await env.DB.prepare('SELECT base_revision, target_revision, object_id, object_json, updated_at FROM map_object_changes WHERE target_revision > ? ORDER BY sequence ASC LIMIT 50')
      .bind(since).all();
    const changes = [];
    let cursor = since;
    for (const row of rows.results) {
      if (Number(row.base_revision) !== cursor) break;
      cursor = Number(row.target_revision);
      changes.push({
        baseRevision: Number(row.base_revision), targetRevision: cursor,
        objectId: row.object_id, object: JSON.parse(row.object_json), updatedAtIso: row.updated_at,
      });
      if (cursor === state.revision) break;
    }
    const requiresSnapshot = changes.length === 0 || changes[0].baseRevision !== since;
    return jsonResponse(request, env, 200, {
      changes: requiresSnapshot ? [] : changes,
      nextRevision: requiresSnapshot ? since : cursor,
      complete: !requiresSnapshot && cursor === state.revision,
      requiresSnapshot,
      manifest: mapManifest(state, queued),
    });
  }

  if (request.method === 'GET' && url.pathname === '/v1/status') {
    const state = await readState(env);
    const primary = await callPrimary(env, { timeoutMs: 5000 });
    const queued = await pendingCount(env);
    return jsonResponse(request, env, 200, { status: statusFrom(state, primary.ok, state !== null, queued), revision: state?.revision ?? null, checksum: state?.checksum ?? '' });
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth') {
    const rate = await checkAuthRateLimit(request, env);
    const payload = await readJson(request);
    if (!env.ADMIN_PASSWORD || !await timingSafeTextEqual(payload.adminPassword, env.ADMIN_PASSWORD)) {
      await recordFailedAuth(env, rate);
      throw new HttpError(403, 'Неверный пароль администратора.');
    }
    await clearAuthFailures(request, env);
    const state = await readState(env);
    const queued = await pendingCount(env);
    const primaryKnownAvailable = state?.mode === 'primary' && queued === 0;
    return jsonResponse(request, env, 200, {
      sessionToken: await issueSession(env),
      expiresInSeconds: SESSION_LIFETIME_SECONDS,
      status: statusFrom(state, primaryKnownAvailable, state !== null, queued),
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/bootstrap') {
    await requireSession(request, env);
    if (await readState(env) !== null) throw new HttpError(409, 'Резервная база уже инициализирована.');
    const payload = await readJson(request);
    if (!validProject(payload.project)) throw new HttpError(400, 'Некорректная структура карты.');
    const primary = await callPrimary(env);
    const suppliedChecksum = text(payload.checksum);
    const actualChecksum = await sha256(JSON.stringify(payload.project));
    if (suppliedChecksum === '' || suppliedChecksum !== actualChecksum) throw new HttpError(409, 'Контрольная сумма файла не совпадает.');
    if (primary.ok) {
      if (primary.revision !== payload.project.revision) throw new HttpError(409, 'Версия файла не совпадает с версией основной базы.');
      const primaryChecksum = await sha256(JSON.stringify(primary.project));
      if (primaryChecksum !== actualChecksum) throw new HttpError(409, 'Содержимое файла отличается от актуальной карты в основной базе.');
      await writeState(env, payload.project, 'yandex', primary.revision, 'primary');
      await event(env, 'info', 'bootstrap', `revision=${primary.revision}`);
    } else {
      const baseRevision = integer(payload.baseRevision);
      const operationId = text(payload.operationId).slice(0, 160);
      if (!validAuthoritativeRecovery(payload)) {
        throw new HttpError(503, 'Основная база недоступна. Для аварийной инициализации требуется подтверждённая резервная копия.');
      }
      const now = new Date().toISOString();
      await writeState(env, payload.project, 'cloudflare', baseRevision, 'backup', 'Ожидается безопасная передача подтверждённой карты в Яндекс.');
      await env.DB.prepare("INSERT INTO map_operations (operation_id, base_revision, target_revision, project_json, checksum, status, created_at, applied_at, error) VALUES (?, ?, ?, ?, ?, 'queued', ?, '', '')")
        .bind(operationId, baseRevision, payload.project.revision, JSON.stringify(payload.project), actualChecksum, now).run();
      await event(env, 'warning', 'authoritative-recovery-bootstrap', `revision=${payload.project.revision}, base=${baseRevision}`);
    }
    const state = await readState(env);
    const queued = await pendingCount(env);
    return jsonResponse(request, env, 201, {
      project: state.project,
      checksum: state.checksum,
      status: statusFrom(state, primary.ok, true, queued, primary.ok
        ? 'Первичная резервная копия проверена и создана.'
        : 'Подтверждённая карта сохранена в резервной базе и ожидает безопасной передачи в Яндекс.'),
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/reconcile') {
    await requireSession(request, env);
    const state = await readState(env);
    const queued = await pendingCount(env);
    ctx.waitUntil(reconcile(env));
    return jsonResponse(request, env, 202, {
      status: statusFrom(
        state,
        state?.mode === 'primary' && queued === 0,
        state !== null,
        queued,
        queued > 0
          ? 'Проверка и перенос отложенных изменений запущены в фоне.'
          : 'Проверка основной базы запущена в фоне.',
      ),
    });
  }

  if (request.method === 'GET' && url.pathname === '/v1/history') {
    await requireSession(request, env);
    const requestedRevisionText = url.searchParams.get('revision');
    const requestedRevision = requestedRevisionText === null ? null : Number(requestedRevisionText);
    if (requestedRevision !== null && Number.isSafeInteger(requestedRevision) && requestedRevision >= 0) {
      const row = await env.DB.prepare('SELECT revision, project_json, checksum, provider, created_at FROM map_history WHERE revision = ?')
        .bind(requestedRevision).first();
      if (!row) throw new HttpError(404, 'Запрошенная версия карты не найдена в истории.');
      return jsonResponse(request, env, 200, {
        revision: Number(row.revision),
        project: JSON.parse(row.project_json),
        checksum: row.checksum,
        provider: row.provider,
        createdAtIso: row.created_at,
      });
    }
    const rows = await env.DB.prepare('SELECT revision, project_json, provider, created_at FROM map_history ORDER BY revision DESC LIMIT ?')
      .bind(HISTORY_LIMIT).all();
    return jsonResponse(request, env, 200, {
      history: rows.results.map((row) => {
        const project = JSON.parse(row.project_json);
        const objects = Array.isArray(project.published) ? project.published : [];
        return {
          revision: Number(row.revision),
          publishedAtIso: text(project.publishedAtIso),
          createdAtIso: row.created_at,
          provider: row.provider,
          objects: objects.length,
          buildings: objects.filter((object) => object?.kind === 'building').length,
          hydrants: objects.filter((object) => object?.kind === 'hydrant').length,
          reservoirs: objects.filter((object) => object?.kind === 'reservoir').length,
        };
      }),
    });
  }

  if (request.method === 'GET' && url.pathname.startsWith('/v1/operations/')) {
    await requireSession(request, env);
    const operationId = decodeURIComponent(url.pathname.slice('/v1/operations/'.length)).slice(0, 160);
    if (operationId === '') throw new HttpError(400, 'Не указан идентификатор операции.');
    const operation = await env.DB.prepare('SELECT project_json, status, error FROM map_operations WHERE operation_id = ?').bind(operationId).first();
    if (!operation) throw new HttpError(404, 'Операция ещё не найдена в общей базе.');
    if (operation.status === 'conflict') throw new HttpError(409, 'Операция остановлена из-за конфликта версий.', text(operation.error));
    const state = await readState(env);
    const queued = await pendingCount(env);
    return jsonResponse(request, env, 200, {
      operationId,
      operationStatus: operation.status,
      project: JSON.parse(operation.project_json),
      status: statusFrom(state, operation.status === 'applied', state !== null, queued, 'Операция уже сохранена в общей базе.'),
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/object') {
    await requireSession(request, env);
    const payload = await readJson(request);
    const operationId = text(payload.operationId).slice(0, 160);
    const requestedBaseRevision = integer(payload.baseRevision);
    const objectId = text(payload.change?.objectId).slice(0, 180);
    if (operationId === '' || requestedBaseRevision === null || objectId === '') throw new HttpError(400, 'Не указан идентификатор операции, объект или базовая версия.');
    const existing = await env.DB.prepare('SELECT project_json, status FROM map_operations WHERE operation_id = ?').bind(operationId).first();
    if (existing) {
      const existingProject = JSON.parse(existing.project_json);
      const existingState = { ...(await readState(env)), project: existingProject, revision: existingProject.revision };
      return jsonResponse(request, env, 200, compactObjectResponse(existingState, await pendingCount(env), operationId, existing.status, objectId, null, 'Повторная операция распознана и не применена второй раз.'));
    }
    let state = await readState(env);
    if (state === null) throw new HttpError(503, 'Резервная база не инициализирована.');
    if (state.mode === 'conflict') {
      await recoverSharedMapFromMirrorConflict(env, state);
      state = await readState(env);
    }
    const now = new Date().toISOString();
    const applied = applyObjectChange(state.project, payload.change, now);
    const operation = { operationId, baseRevision: state.revision, project: applied.project, createdAt: now };
    const objectChange = {
      objectId, object: applied.activeObject,
      updatedAtIso: text(applied.activeObject?.updatedAtIso) || text(payload.change.updatedAtIso) || now,
    };
    const queued = await pendingCount(env);
    if (shouldUseBackupImmediately(state, queued)) {
      await conditionalBackupCommit(env, operation, 'queued', state.primaryRevision, 'backup', [{ ...objectChange, baseRevision: operation.baseRevision, targetRevision: operation.project.revision }]);
      const updated = await readState(env);
      await event(env, 'warning', 'backup-object-write', `operation=${operationId}, object=${objectId}, revision=${updated.revision}`);
      return jsonResponse(request, env, 202, compactObjectResponse(updated, await pendingCount(env), operationId, 'queued', objectId, applied.conflict, 'Изменение объекта сохранено в общей базе и уже доступно другим устройствам.'));
    }
    const primary = await callPrimary(env, {
      method: 'POST', timeoutMs: 8000,
      body: { coordinatorToken: env.PRIMARY_SYNC_TOKEN, operationId, baseRevision: state.revision, project: applied.project, updatedBy: text(payload.updatedBy) || 'Администратор ХИМКОНТУР' },
    });
    if (primary.ok && primary.protocolVersion >= 2) {
      operation.project = primary.project;
      await conditionalBackupCommit(env, operation, 'applied', primary.revision, 'primary', [{ ...objectChange, baseRevision: operation.baseRevision, targetRevision: operation.project.revision }]);
      const updated = await readState(env);
      return jsonResponse(request, env, 200, compactObjectResponse(updated, await pendingCount(env), operationId, 'applied', objectId, applied.conflict));
    }
    if (primary.ok && primary.protocolVersion < 2) throw new HttpError(503, 'Основная база ещё не обновлена до защищённого протокола.');
    if (primary.status > 0 && primary.status < 500) throw new HttpError(503, 'Основная база отклонила защищённую запись.');
    await conditionalBackupCommit(env, operation, 'queued', state.primaryRevision, 'backup', [{ ...objectChange, baseRevision: operation.baseRevision, targetRevision: operation.project.revision }]);
    const updated = await readState(env);
    await event(env, 'warning', 'backup-object-write', `operation=${operationId}, object=${objectId}, revision=${updated.revision}`);
    return jsonResponse(request, env, 202, compactObjectResponse(updated, await pendingCount(env), operationId, 'queued', objectId, applied.conflict, 'Изменение объекта сохранено в общей базе и уже доступно другим устройствам.'));
  }

  if (request.method === 'POST' && url.pathname === '/v1/objects') {
    await requireSession(request, env);
    const payload = await readJson(request);
    const operationId = text(payload.operationId).slice(0, 160);
    const requestedBaseRevision = integer(payload.baseRevision);
    if (operationId === '' || requestedBaseRevision === null || !Array.isArray(payload.changes) || payload.changes.length === 0 || payload.changes.length > 500) {
      throw new HttpError(400, 'Не указан пакет изменений или базовая версия карты.');
    }
    const existing = await env.DB.prepare('SELECT status FROM map_operations WHERE operation_id = ?').bind(operationId).first();
    if (existing) {
      const state = await readState(env);
      return jsonResponse(request, env, 200, compactBatchResponse(state, await pendingCount(env), operationId, existing.status, [], 'Повторный пакет распознан и не применён второй раз.'));
    }
    let state = await readState(env);
    if (state === null) throw new HttpError(503, 'Резервная база не инициализирована.');
    if (state.mode === 'conflict') {
      await recoverSharedMapFromMirrorConflict(env, state);
      state = await readState(env);
    }
    const now = new Date().toISOString();
    let workingProject = state.project;
    const records = [];
    const conflicts = [];
    for (const change of payload.changes) {
      const baseRevision = workingProject.revision;
      const applied = applyObjectChange(workingProject, change, now);
      workingProject = applied.project;
      records.push({
        baseRevision,
        targetRevision: workingProject.revision,
        objectId: text(change.objectId),
        object: applied.activeObject,
        updatedAtIso: text(applied.activeObject?.updatedAtIso) || text(change.updatedAtIso) || now,
      });
      if (applied.conflict !== null) conflicts.push(applied.conflict);
    }
    const operation = { operationId, baseRevision: state.revision, project: workingProject, createdAt: now };
    const queued = await pendingCount(env);
    if (shouldUseBackupImmediately(state, queued)) {
      await conditionalBackupCommit(env, operation, 'queued', state.primaryRevision, 'backup', records);
      const updated = await readState(env);
      await event(env, 'warning', 'backup-object-batch', `operation=${operationId}, changes=${records.length}, revision=${updated.revision}`);
      return jsonResponse(request, env, 202, compactBatchResponse(updated, await pendingCount(env), operationId, 'queued', conflicts, 'Пакет изменений сохранён в общей базе и уже доступен другим устройствам.'));
    }
    const primary = await callPrimary(env, {
      method: 'POST', timeoutMs: 8000,
      body: { coordinatorToken: env.PRIMARY_SYNC_TOKEN, operationId, baseRevision: state.revision, project: workingProject, updatedBy: text(payload.updatedBy) || 'Администратор ХИМКОНТУР' },
    });
    if (primary.ok && primary.protocolVersion >= 2) {
      operation.project = primary.project;
      await conditionalBackupCommit(env, operation, 'applied', primary.revision, 'primary', records);
      const updated = await readState(env);
      return jsonResponse(request, env, 200, compactBatchResponse(updated, await pendingCount(env), operationId, 'applied', conflicts));
    }
    if (primary.ok && primary.protocolVersion < 2) throw new HttpError(503, 'Основная база ещё не обновлена до защищённого протокола.');
    if (primary.status > 0 && primary.status < 500) throw new HttpError(503, 'Основная база отклонила защищённую запись.');
    await conditionalBackupCommit(env, operation, 'queued', state.primaryRevision, 'backup', records);
    const updated = await readState(env);
    await event(env, 'warning', 'backup-object-batch', `operation=${operationId}, changes=${records.length}, revision=${updated.revision}`);
    return jsonResponse(request, env, 202, compactBatchResponse(updated, await pendingCount(env), operationId, 'queued', conflicts, 'Пакет изменений сохранён в общей базе и уже доступен другим устройствам.'));
  }

  if (request.method === 'POST' && url.pathname === '/v1/map') {
    await requireSession(request, env);
    const payload = await readJson(request);
    if (!validProject(payload.project)) throw new HttpError(400, 'Некорректная структура карты.');
    const operationId = text(payload.operationId).slice(0, 160);
    let baseRevision = integer(payload.baseRevision);
    if (operationId === '' || baseRevision === null) throw new HttpError(400, 'Не указан идентификатор операции или базовая версия.');
    const existing = await env.DB.prepare('SELECT target_revision, project_json, status FROM map_operations WHERE operation_id = ?').bind(operationId).first();
    if (existing) return jsonResponse(request, env, 200, { project: JSON.parse(existing.project_json), status: statusFrom(await readState(env), existing.status === 'applied', true, await pendingCount(env), 'Повторная операция распознана и не была применена второй раз.') });
    let state = await readState(env);
    if (state === null) throw new HttpError(503, 'Резервная база не инициализирована.');
    if (state.mode === 'conflict') {
      await recoverSharedMapFromMirrorConflict(env, state);
      state = await readState(env);
    }
    let project = payload.project;
    if (state.revision !== baseRevision && operationId.startsWith('legacy-')) {
      const queued = await pendingCount(env);
      if (canRebaseLegacyOperation(operationId, project, state.project, queued)) {
        baseRevision = state.revision;
        project = { ...project, revision: Math.max(project.revision, state.revision + 1, Date.now()) };
        await event(env, 'info', 'legacy-local-rebase', `operation=${operationId}, revision=${project.revision}`);
      }
    }
    if (state.revision !== baseRevision) throw new HttpError(409, 'Карта уже изменена в другом браузере. Обновите данные перед записью.');
    if (project.revision <= baseRevision) throw new HttpError(400, 'Новая версия карты должна быть больше базовой.');
    const operation = { operationId, baseRevision, project, createdAt: new Date().toISOString() };
    const queued = await pendingCount(env);
    if (shouldUseBackupImmediately(state, queued)) {
      await conditionalBackupCommit(env, operation, 'queued', state.primaryRevision, 'backup');
      await event(env, 'warning', 'backup-write', `operation=${operationId}, revision=${project.revision}`);
      const updated = await readState(env);
      return jsonResponse(request, env, 202, { project: updated.project, status: statusFrom(updated, false, true, await pendingCount(env), 'Изменения сохранены в общей резервной базе и уже доступны другим устройствам. В Яндекс они будут переданы автоматически.') });
    }
    const primary = await callPrimary(env, {
      method: 'POST',
      timeoutMs: 8000,
      body: { coordinatorToken: env.PRIMARY_SYNC_TOKEN, operationId, baseRevision, project, updatedBy: text(payload.updatedBy) || 'Администратор ХИМКОНТУР' },
    });
    if (primary.ok && primary.protocolVersion >= 2) {
      operation.project = primary.project;
      await conditionalBackupCommit(env, operation, 'applied', primary.revision, 'primary');
      await event(env, 'info', 'primary-write', `operation=${operationId}, revision=${primary.revision}`);
      const updated = await readState(env);
      return jsonResponse(request, env, 200, { project: updated.project, status: statusFrom(updated, true, true, await pendingCount(env)) });
    }
    if (primary.ok && primary.protocolVersion < 2) throw new HttpError(503, 'Основная база ещё не обновлена до защищённого протокола. Запись остановлена.');
    if (primary.status > 0 && primary.status < 500) {
      throw new HttpError(503, 'Основная база отклонила защищённую запись. Резервная запись остановлена, чтобы не допустить расхождения баз.');
    }
    await conditionalBackupCommit(env, operation, 'queued', state.primaryRevision, 'backup');
    await event(env, 'warning', 'backup-write', `operation=${operationId}, revision=${payload.project.revision}`);
    const updated = await readState(env);
    return jsonResponse(request, env, 202, { project: updated.project, status: statusFrom(updated, false, true, await pendingCount(env), 'Изменения сохранены в резервной базе и будут переданы в Яндекс автоматически.') });
  }

  throw new HttpError(404, 'Маршрут не найден.');
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      if (error instanceof HttpError) return jsonResponse(request, env, error.status, { error: error.message, detail: error.detail });
      console.error('Unhandled district sync error', error);
      return jsonResponse(request, env, 500, { error: 'Резервный сервис временно недоступен.' });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(reconcile(env));
  },
};
