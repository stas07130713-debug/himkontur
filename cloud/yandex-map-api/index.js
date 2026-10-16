import crypto from 'node:crypto';
import { MetadataCredentialsProvider } from '@ydbjs/auth/metadata';
import { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { Uint64, Utf8 } from '@ydbjs/value/primitive';

const CURRENT_ID = new Utf8('current');
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function requestMethod(event) {
  return String(event?.httpMethod ?? event?.requestContext?.http?.method ?? 'GET').toUpperCase();
}

function parseBody(event) {
  const raw = event?.body ?? '';
  const decoded = event?.isBase64Encoded
    ? Buffer.from(raw, 'base64').toString('utf8')
    : String(raw);
  if (Buffer.byteLength(decoded, 'utf8') > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  return decoded === '' ? {} : JSON.parse(decoded);
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

function passwordMatches(actual) {
  const expected = String(process.env.ADMIN_PASSWORD ?? '');
  const supplied = String(actual ?? '');
  if (expected === '' || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
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
}

async function readCurrent(sql) {
  const [rows] = await sql`
    SELECT revision, data
    FROM himkontur_map_state
    WHERE id = ${CURRENT_ID}
  `;
  if (!rows?.[0]) return null;
  return {
    revision: Number(rows[0].revision),
    project: JSON.parse(rows[0].data),
  };
}

async function publish(sql, project, updatedBy) {
  return sql.begin(async (tx) => {
    const [rows] = await tx`
      SELECT revision
      FROM himkontur_map_state
      WHERE id = ${CURRENT_ID}
    `;
    const currentRevision = rows?.[0] ? Number(rows[0].revision) : 0;
    const revision = Math.max(currentRevision + 1, Number(project.revision) || 1);
    const publishedAtIso = new Date().toISOString();
    const published = {
      ...project,
      revision,
      draft: project.published,
      draftSavedAtIso: publishedAtIso,
      publishedAtIso,
    };
    const data = JSON.stringify(published);
    const ydbRevision = new Uint64(BigInt(revision));

    await tx`
      UPSERT INTO himkontur_map_state (id, revision, published_at, data, updated_by)
      VALUES (${CURRENT_ID}, ${ydbRevision}, ${publishedAtIso}, ${data}, ${updatedBy})
    `;
    await tx`
      UPSERT INTO himkontur_map_history (revision, published_at, data, updated_by)
      VALUES (${ydbRevision}, ${publishedAtIso}, ${data}, ${updatedBy})
    `;
    return published;
  });
}

export async function handler(event) {
  const method = requestMethod(event);
  if (method === 'OPTIONS') return response(204, {});
  if (!['GET', 'POST', 'PUT'].includes(method)) return response(405, { error: 'Метод не поддерживается.' });
  if (!process.env.YDB_CONNECTION_STRING) return response(500, { error: 'Не задано подключение к базе.' });

  const driver = new Driver(process.env.YDB_CONNECTION_STRING, {
    credentialsProvider: new MetadataCredentialsProvider(),
    'ydb.sdk.enable_discovery': false,
  });

  try {
    await driver.ready();
    const sql = query(driver);
    await ensureTables(sql);

    if (method === 'GET') {
      const current = await readCurrent(sql);
      return current === null
        ? response(404, { error: 'Общая база пока пуста.' })
        : response(200, { project: current.project });
    }

    let payload;
    try {
      payload = parseBody(event);
    } catch (error) {
      if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') {
        return response(413, { error: 'Объём данных превышает 5 МБ.' });
      }
      return response(400, { error: 'Некорректный JSON.' });
    }
    if (!passwordMatches(payload.adminPassword)) return response(403, { error: 'Неверный пароль администратора.' });
    if (!validProject(payload.project)) return response(400, { error: 'Некорректная структура базы карты.' });

    const updatedBy = typeof payload.updatedBy === 'string' && payload.updatedBy.trim() !== ''
      ? payload.updatedBy.trim().slice(0, 120)
      : 'Администратор ХИМКОНТУР';
    const project = await publish(sql, payload.project, updatedBy);
    return response(200, { project });
  } catch (error) {
    console.error(error);
    return response(500, { error: 'Облачная база временно недоступна.' });
  } finally {
    driver.close();
  }
}
