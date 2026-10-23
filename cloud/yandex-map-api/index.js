import crypto from 'node:crypto';
import { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
import { MetadataCredentialsProvider } from '@ydbjs/auth/metadata';
import { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { Uint64, Utf8 } from '@ydbjs/value/primitive';

const CURRENT_ID = new Utf8('current');
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const PROTOCOL_VERSION = 2;

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function requestOrigin(event) {
  return String(event?.headers?.origin ?? event?.headers?.Origin ?? 'null');
}

function corsHeaders(event) {
  const origin = requestOrigin(event);
  const allowed = String(process.env.ALLOWED_ORIGINS ?? 'https://stas07130713-debug.github.io,https://localhost,http://localhost,capacitor://localhost,http://localhost:5173,http://127.0.0.1:4183,http://127.0.0.1:4194,http://127.0.0.1:4196,null')
    .split(',').map((value) => value.trim()).filter(Boolean);
  return {
    ...(allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
}

function response(event, statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(event),
    body: statusCode === 204 ? '' : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function requestMethod(event) {
  return String(event?.httpMethod ?? event?.requestContext?.http?.method ?? 'GET').toUpperCase();
}

function parseBody(event) {
  const raw = event?.body ?? '';
  const decoded = event?.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : String(raw);
  if (Buffer.byteLength(decoded, 'utf8') > MAX_BODY_BYTES) throw new RequestError(413, 'Объём данных превышает 5 МБ.');
  try {
    return decoded === '' ? {} : JSON.parse(decoded);
  } catch {
    throw new RequestError(400, 'Некорректный JSON.');
  }
}

function validProject(project) {
  return project
    && typeof project === 'object'
    && project.id === 'district-map-main'
    && typeof project.name === 'string'
    && Number.isSafeInteger(project.revision)
    && project.revision >= 0
    && Array.isArray(project.draft)
    && Array.isArray(project.published);
}

function secretMatches(actual, expectedValue) {
  const expected = String(expectedValue ?? '');
  const supplied = String(actual ?? '');
  if (expected === '' || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function authorized(payload) {
  if (secretMatches(payload.coordinatorToken, process.env.PRIMARY_SYNC_TOKEN)) return 'coordinator';
  if (process.env.REQUIRE_COORDINATOR_WRITES === 'true') return '';
  return secretMatches(payload.adminPassword, process.env.ADMIN_PASSWORD) ? 'administrator' : '';
}

async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS himkontur_map_state (
      id Utf8 NOT NULL,
      revision Uint64 NOT NULL,
      published_at Text NOT NULL,
      data Text NOT NULL,
      updated_by Text NOT NULL,
      PRIMARY KEY (id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS himkontur_map_history (
      revision Uint64 NOT NULL,
      published_at Text NOT NULL,
      data Text NOT NULL,
      updated_by Text NOT NULL,
      PRIMARY KEY (revision)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS himkontur_map_operations (
      operation_id Utf8 NOT NULL,
      base_revision Uint64 NOT NULL,
      target_revision Uint64 NOT NULL,
      applied_at Text NOT NULL,
      data Text NOT NULL,
      PRIMARY KEY (operation_id)
    )
  `;
}

async function readCurrent(sql) {
  const [rows] = await sql`
    SELECT revision, published_at, data
    FROM himkontur_map_state
    WHERE id = ${CURRENT_ID}
  `;
  if (!rows?.[0]) return null;
  return {
    revision: Number(rows[0].revision),
    publishedAtIso: String(rows[0].published_at),
    project: JSON.parse(rows[0].data),
  };
}

async function publish(sql, payload, updatedBy) {
  const operationIdText = typeof payload.operationId === 'string' ? payload.operationId.trim().slice(0, 160) : '';
  const operationId = new Utf8(operationIdText || `legacy-${crypto.randomUUID()}`);
  const requestedBaseRevision = Number.isSafeInteger(payload.baseRevision) ? payload.baseRevision : null;
  const requireBaseRevision = process.env.REQUIRE_BASE_REVISION === 'true' || operationIdText !== '';
  if (requireBaseRevision && requestedBaseRevision === null) throw new RequestError(400, 'Не указана базовая версия карты.');

  return sql.begin(async (tx) => {
    const [operationRows] = await tx`
      SELECT data
      FROM himkontur_map_operations
      WHERE operation_id = ${operationId}
    `;
    if (operationRows?.[0]) return { project: JSON.parse(operationRows[0].data), repeated: true };

    const [rows] = await tx`
      SELECT revision
      FROM himkontur_map_state
      WHERE id = ${CURRENT_ID}
    `;
    const currentRevision = rows?.[0] ? Number(rows[0].revision) : 0;
    const baseRevision = requestedBaseRevision ?? currentRevision;
    if (baseRevision !== currentRevision) throw new RequestError(409, `Конфликт версии: ожидается ${baseRevision}, в основной базе ${currentRevision}.`);
    if (payload.project.revision <= currentRevision) throw new RequestError(409, 'Новая версия карты должна быть больше текущей.');

    const revision = Number(payload.project.revision);
    const publishedAtIso = new Date().toISOString();
    const published = {
      ...payload.project,
      revision,
      draft: payload.project.published,
      draftSavedAtIso: publishedAtIso,
      publishedAtIso,
    };
    const data = JSON.stringify(published);
    const ydbRevision = new Uint64(BigInt(revision));
    const ydbBaseRevision = new Uint64(BigInt(baseRevision));

    await tx`
      UPSERT INTO himkontur_map_state (id, revision, published_at, data, updated_by)
      VALUES (${CURRENT_ID}, ${ydbRevision}, ${publishedAtIso}, ${data}, ${updatedBy})
    `;
    await tx`
      UPSERT INTO himkontur_map_history (revision, published_at, data, updated_by)
      VALUES (${ydbRevision}, ${publishedAtIso}, ${data}, ${updatedBy})
    `;
    await tx`
      UPSERT INTO himkontur_map_operations (operation_id, base_revision, target_revision, applied_at, data)
      VALUES (${operationId}, ${ydbBaseRevision}, ${ydbRevision}, ${publishedAtIso}, ${data})
    `;
    return { project: published, repeated: false };
  });
}

export async function handler(event, context) {
  const method = requestMethod(event);
  if (method === 'OPTIONS') return response(event, 204, {});
  if (!['GET', 'POST', 'PUT'].includes(method)) return response(event, 405, { error: 'Метод не поддерживается.' });
  if (!corsHeaders(event)['Access-Control-Allow-Origin']) return response(event, 403, { error: 'Источник запроса не разрешён.' });
  if (!process.env.YDB_CONNECTION_STRING) return response(event, 500, { error: 'Не задано подключение к базе.' });

  const contextAccessToken = String(context?.token?.access_token ?? '');
  const driver = new Driver(process.env.YDB_CONNECTION_STRING, {
    credentialsProvider: contextAccessToken === ''
      ? new MetadataCredentialsProvider()
      : new AccessTokenCredentialsProvider({ token: contextAccessToken }),
    'ydb.sdk.enable_discovery': false,
  });

  try {
    await driver.ready();
    const sql = query(driver);
    await ensureTables(sql);

    if (method === 'GET') {
      const current = await readCurrent(sql);
      return current === null
        ? response(event, 404, { protocolVersion: PROTOCOL_VERSION, error: 'Общая база пока пуста.' })
        : response(event, 200, {
          protocolVersion: PROTOCOL_VERSION,
          project: current.project,
          meta: { revision: current.revision, serverTimeIso: new Date().toISOString(), publishedAtIso: current.publishedAtIso },
        });
    }

    const payload = parseBody(event);
    const actor = authorized(payload);
    if (actor === '') return response(event, 403, { protocolVersion: PROTOCOL_VERSION, error: 'Неверные учётные данные.' });
    if (!validProject(payload.project)) return response(event, 400, { protocolVersion: PROTOCOL_VERSION, error: 'Некорректная структура базы карты.' });
    const updatedBy = typeof payload.updatedBy === 'string' && payload.updatedBy.trim() !== ''
      ? payload.updatedBy.trim().slice(0, 120)
      : actor === 'coordinator' ? 'Cloudflare coordinator' : 'Администратор ХИМКОНТУР';
    const result = await publish(sql, payload, updatedBy);
    return response(event, 200, {
      protocolVersion: PROTOCOL_VERSION,
      project: result.project,
      meta: { revision: result.project.revision, serverTimeIso: new Date().toISOString(), operationRepeated: result.repeated },
    });
  } catch (error) {
    if (error instanceof RequestError) return response(event, error.statusCode, { protocolVersion: PROTOCOL_VERSION, error: error.message });
    console.error('Yandex map API error', error);
    return response(event, 500, { protocolVersion: PROTOCOL_VERSION, error: 'Облачная база временно недоступна.' });
  } finally {
    driver.close();
  }
}
