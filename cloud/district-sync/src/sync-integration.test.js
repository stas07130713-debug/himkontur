import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from './worker.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_initial.sql', '0002_object_changes.sql', '0003_stable_sync.sql']) db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  const env = { SESSION_SECRET: 'test-only', ALLOWED_ORIGINS: 'https://test.invalid', YANDEX_API_URL: 'https://primary.invalid', DB: {
    prepare(sql) { const args = []; return {
      bind(...values) { args.push(...values); return this; },
      first() { return db.prepare(sql).get(...args) ?? null; },
      all() { return { results: db.prepare(sql).all(...args) }; },
      run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    }; },
    batch(statements) { db.exec('BEGIN'); try { const r = statements.map((s) => s.run()); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  } };
  const base = { id: 'district-map-main', name: 'test', revision: 1, published: [], draft: [], publishedAtIso: new Date().toISOString() };
  db.prepare('INSERT INTO map_state (id, revision, project_json, checksum, primary_revision, mode, updated_at) VALUES (1, 1, ?, ?, 0, ?, ?)').run(JSON.stringify(base), 'initial', 'backup', base.publishedAtIso);
  const session = Buffer.from(JSON.stringify({ scope: 'map:write', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const token = session + '.' + createHmac('sha256', env.SESSION_SECRET).update(session).digest('base64url');
  const request = (path, body) => worker.fetch(new Request('https://sync.invalid' + path, { method: body ? 'POST' : 'GET', headers: { Origin: 'https://test.invalid', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil(promise) { void promise.catch(() => { /* Background replication is intentionally offline in this fixture. */ }); } });
  return { db, request, base };
}

it('downloads the original snapshot after more than forty intervening edits', async () => {
  const { db, request, base } = fixture();
  const large = { ...base, name: 'original'.repeat(6000) };
  db.prepare('UPDATE map_state SET project_json = ?').run(JSON.stringify(large));
  const firstResponse = await request('/v1/map/chunk?offset=0');
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  db.prepare('UPDATE map_state SET project_json = ?, revision = 100').run(JSON.stringify({ ...base, name: 'new', revision: 100 }));
  db.exec('DELETE FROM map_history');
  const parts = [Buffer.from(first.data, 'base64')];
  let offset = first.nextOffset;
  while (offset < first.totalBytes) {
    const response = await request('/v1/map/chunk?offset=' + offset + '&checksum=' + first.checksum);
    assert.equal(response.status, 200);
    const part = await response.json(); parts.push(Buffer.from(part.data, 'base64')); offset = part.nextOffset;
  }
  assert.deepEqual(JSON.parse(Buffer.concat(parts).toString()), large);
  db.close();
});

it('rejects altered retry content and deduplicates after mirror queue compaction', async () => {
  const { db, request } = fixture();
  // Suppress background replication; this test only exercises the local coordinator transaction.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('offline primary'));
  try {
    const object = { id: 'b1', kind: 'building', point: { latitude: 67, longitude: 32 }, updatedAtIso: new Date().toISOString(), note: 'first' };
    const packet = { operationId: 'stable-packet', baseRevision: 1, changes: [{ objectId: 'b1', baseObject: null, object, updatedAtIso: object.updatedAtIso }] };
    assert.equal((await request('/v1/objects', packet)).status, 202);
    db.exec('DELETE FROM map_operations');
    const retry = await request('/v1/objects', packet);
    assert.equal(retry.status, 200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM map_object_changes').get().n, 1);
    const changed = { ...packet, changes: [{ ...packet.changes[0], object: { ...object, note: 'different' } }] };
    assert.equal((await request('/v1/objects', changed)).status, 422);
    assert.equal(JSON.parse(db.prepare('SELECT project_json FROM map_state').get().project_json).published[0].note, 'first');
  } finally { globalThis.fetch = originalFetch; }
});


it('does not expose rejected concurrent changes in the delta journal', async () => {
  const { db, request } = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('offline primary'));
  try {
    const packet = (id) => ({ operationId: id, baseRevision: 1, changes: [{ objectId: id, baseObject: null, object: { id, kind: 'building', point: { latitude: 67, longitude: 32 }, updatedAtIso: new Date().toISOString() } }] });
    const [a, b] = await Promise.all([request('/v1/objects', packet('a')), request('/v1/objects', packet('b'))]);
    assert.deepEqual([a.status, b.status].sort(), [202, 409]);
    const state = JSON.parse(db.prepare('SELECT project_json FROM map_state').get().project_json);
    const journal = db.prepare('SELECT object_id FROM map_object_changes').all();
    assert.equal(state.published.length, 1);
    assert.equal(journal.length, 1);
    assert.equal(journal[0].object_id, state.published[0].id);
    const missing = state.published[0].id === 'a' ? 'b' : 'a';
    assert.equal((await request('/v1/objects', packet(missing))).status, 202);
    assert.equal(JSON.parse(db.prepare('SELECT project_json FROM map_state').get().project_json).published.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});
