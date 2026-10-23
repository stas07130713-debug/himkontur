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

function text(value) {
  return typeof value === 'string' ? value : '';
}

function integer(value) {
  return Number.isSafeInteger(value) ? value : null;
}

async function readJson(request) {
  const raw = await request.text();
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

async function conditionalBackupCommit(env, operation, status, primaryRevision, mode) {
  const state = await readState(env);
  if (state === null) throw new HttpError(503, 'Резервная база не инициализирована.');
  if (state.revision !== operation.baseRevision) throw new HttpError(409, 'Карта уже изменена в другом браузере. Сначала обновите данные.', `expected ${operation.baseRevision}, current ${state.revision}`);
  const projectJson = JSON.stringify(operation.project);
  const checksum = await sha256(projectJson);
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO map_operations (operation_id, base_revision, target_revision, project_json, checksum, status, created_at, applied_at, error) SELECT ?, ?, ?, ?, ?, ?, ?, ?, \'\' WHERE EXISTS (SELECT 1 FROM map_state WHERE id = 1 AND revision = ?)')
      .bind(operation.operationId, operation.baseRevision, operation.project.revision, projectJson, checksum, status, operation.createdAt, status === 'applied' ? now : '', operation.baseRevision),
    env.DB.prepare('INSERT OR REPLACE INTO map_history (revision, project_json, checksum, provider, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM map_state WHERE id = 1 AND revision = ?)')
      .bind(operation.project.revision, projectJson, checksum, mode === 'primary' ? 'yandex' : 'cloudflare', now, operation.baseRevision),
    env.DB.prepare('UPDATE map_state SET revision = ?, project_json = ?, checksum = ?, primary_revision = ?, mode = ?, updated_at = ?, last_primary_success_at = CASE WHEN ? = \'primary\' THEN ? ELSE last_primary_success_at END, last_error = \'\' WHERE id = 1 AND revision = ?')
      .bind(operation.project.revision, projectJson, checksum, primaryRevision, mode, now, mode, now, operation.baseRevision),
    env.DB.prepare('DELETE FROM map_history WHERE revision NOT IN (SELECT revision FROM map_history ORDER BY revision DESC LIMIT ?)').bind(HISTORY_LIMIT),
  ]);
  if (Number(results[2]?.meta?.changes ?? 0) !== 1) throw new HttpError(409, 'Карта уже изменена в другом браузере. Сначала обновите данные.');
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
    lastSuccessAtIso: state?.lastPrimarySuccessAt || state?.updatedAt || '',
    message: message || state?.lastError || (mode === 'primary' ? 'Основная и резервная базы работают.' : mode === 'backup' ? 'Яндекс недоступен: используется резервная база.' : ''),
  };
}

export function hasUnresolvedConflict(state, conflictCount) {
  return state?.mode === 'conflict' || conflictCount > 0;
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
  const primary = await callPrimary(env);
  const conflictRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM map_operations WHERE status = 'conflict'").first();
  if (hasUnresolvedConflict(state, Number(conflictRow?.count ?? 0))) {
    return {
      state: { ...state, mode: 'conflict' },
      primaryAvailable: primary.ok,
      queued: await pendingCount(env),
      message: 'Обнаружен нерешённый конфликт версий. Автоматическая запись остановлена.',
    };
  }
  if (!primary.ok) {
    await env.DB.prepare("UPDATE map_state SET mode = 'backup', last_error = ? WHERE id = 1").bind('Основная база Яндекс временно недоступна.').run();
    return { state: { ...state, mode: 'backup' }, primaryAvailable: false, queued: await pendingCount(env), message: 'Основная база Яндекс временно недоступна.' };
  }
  const queued = await env.DB.prepare("SELECT operation_id, base_revision, target_revision, project_json, created_at FROM map_operations WHERE status = 'queued' ORDER BY created_at ASC").all();
  if (queued.results.length === 0) {
    if (primary.revision !== state.revision) {
      if (primary.revision < state.revision) {
        await env.DB.prepare("UPDATE map_state SET mode = 'conflict', last_error = ? WHERE id = 1").bind('Версия основной базы отстаёт без зарегистрированных операций.').run();
        await event(env, 'error', 'revision-conflict', `primary=${primary.revision}, backup=${state.revision}`);
        state = await readState(env);
        return { state, primaryAvailable: true, queued: 0, message: 'Обнаружено расхождение версий. Автоматическая запись остановлена.' };
      }
      await writeState(env, primary.project, 'yandex', primary.revision, 'primary');
      state = await readState(env);
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
      await env.DB.batch([
        env.DB.prepare("UPDATE map_operations SET status = 'conflict', error = ? WHERE operation_id = ?").bind(`primary=${primary.revision}`, row.operation_id),
        env.DB.prepare("UPDATE map_state SET mode = 'conflict', last_error = ? WHERE id = 1").bind('Основная база изменилась во время резервного режима.'),
      ]);
      await event(env, 'error', 'failback-conflict', `operation=${row.operation_id}`);
      state = await readState(env);
      return { state, primaryAvailable: true, queued: await pendingCount(env), message: 'Основная база содержит другие изменения. Автоматическое слияние остановлено.' };
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
    const primary = await callPrimary(env);
    if (primary.ok) {
      const queued = await pendingCount(env);
      if (state !== null && queued > 0) {
        ctx.waitUntil(reconcile(env));
        return jsonResponse(request, env, 200, { project: state.project, status: statusFrom(state, true, true, queued, 'Яндекс снова доступен; актуальные резервные изменения ожидают безопасного переноса.') });
      }
      if (state !== null && queued === 0 && primary.revision !== state.revision) ctx.waitUntil(writeState(env, primary.project, 'yandex', primary.revision, 'primary'));
      return jsonResponse(request, env, 200, { project: primary.project, status: statusFrom(state ?? { revision: primary.revision, primaryRevision: primary.revision }, true, state !== null, queued) });
    }
    if (state === null) throw new HttpError(503, 'Основная и резервная базы недоступны. Используйте локальную копию.');
    const queued = await pendingCount(env);
    return jsonResponse(request, env, 200, { project: state.project, status: statusFrom(state, false, true, queued) });
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
    const primary = await callPrimary(env, { timeoutMs: 5000 });
    return jsonResponse(request, env, 200, {
      sessionToken: await issueSession(env),
      expiresInSeconds: SESSION_LIFETIME_SECONDS,
      status: statusFrom(state, primary.ok, state !== null, await pendingCount(env)),
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
    const result = await reconcile(env);
    return jsonResponse(request, env, 200, { status: statusFrom(result.state, result.primaryAvailable, result.state !== null, result.queued, result.message) });
  }

  if (request.method === 'POST' && url.pathname === '/v1/map') {
    await requireSession(request, env);
    await reconcile(env);
    const payload = await readJson(request);
    if (!validProject(payload.project)) throw new HttpError(400, 'Некорректная структура карты.');
    const operationId = text(payload.operationId).slice(0, 160);
    let baseRevision = integer(payload.baseRevision);
    if (operationId === '' || baseRevision === null) throw new HttpError(400, 'Не указан идентификатор операции или базовая версия.');
    const existing = await env.DB.prepare('SELECT target_revision, project_json, status FROM map_operations WHERE operation_id = ?').bind(operationId).first();
    if (existing) return jsonResponse(request, env, 200, { project: JSON.parse(existing.project_json), status: statusFrom(await readState(env), existing.status === 'applied', true, await pendingCount(env), 'Повторная операция распознана и не была применена второй раз.') });
    const state = await readState(env);
    if (state === null) throw new HttpError(503, 'Резервная база не инициализирована.');
    if (state.mode === 'conflict') throw new HttpError(409, 'Синхронизация остановлена из-за конфликта версий.');
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
    const primary = await callPrimary(env, {
      method: 'POST',
      timeoutMs: 15000,
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
