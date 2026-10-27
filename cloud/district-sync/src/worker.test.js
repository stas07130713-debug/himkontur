import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyObjectChange, canRebaseLegacyOperation, isAllowedOrigin, needsConflictRecovery, operationQueueBaseRevision, readJson, shouldUseBackupImmediately, validAuthoritativeRecovery } from './worker.js';

async function gzipJson(value) {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('compressed synchronization requests', () => {
  it('restores a gzip-compressed map request', async () => {
    const payload = { operationId: 'map-test', project: { id: 'district-map-main', published: [1, 2, 3] } };
    const request = new Request('https://sync.example.test/v1/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.himkontur+json+gzip' },
      body: await gzipJson(payload),
    });
    assert.deepEqual(await readJson(request), payload);
  });
});

describe('application origin access', () => {
  const configured = 'https://stas07130713-debug.github.io,null';

  it('allows the published browser and packaged application origins', () => {
    assert.equal(isAllowedOrigin('https://stas07130713-debug.github.io', configured), true);
    assert.equal(isAllowedOrigin('null', configured), true);
    assert.equal(isAllowedOrigin('http://localhost', configured), true);
    assert.equal(isAllowedOrigin('http://localhost:5173', configured), true);
    assert.equal(isAllowedOrigin('https://localhost', configured), true);
    assert.equal(isAllowedOrigin('capacitor://localhost', configured), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:4183', configured), true);
  });

  it('does not open the service to unrelated websites', () => {
    assert.equal(isAllowedOrigin('https://example.com', configured), false);
  });
});

describe('district sync conflict guard', () => {
  it('detects a stale conflict state so Cloudflare can recover automatically', () => {
    assert.equal(needsConflictRecovery({ mode: 'conflict' }, 0), true);
  });

  it('detects old conflicted operations so they no longer block new writes', () => {
    assert.equal(needsConflictRecovery({ mode: 'primary' }, 1), true);
  });

  it('does not run recovery when no mirror conflict is recorded', () => {
    assert.equal(needsConflictRecovery({ mode: 'backup' }, 0), false);
  });
});

describe('fast backup routing', () => {
  it('writes directly to D1 while the service is already in backup mode', () => {
    assert.equal(shouldUseBackupImmediately({ mode: 'backup' }, 0), true);
  });

  it('keeps the queued chain in D1 until reconciliation completes', () => {
    assert.equal(shouldUseBackupImmediately({ mode: 'primary' }, 2), true);
  });

  it('uses the primary write path only for a synchronized state', () => {
    assert.equal(shouldUseBackupImmediately({ mode: 'primary' }, 0), false);
  });

  it('stores one backup checkpoint against the last confirmed Yandex revision', () => {
    assert.equal(operationQueueBaseRevision('queued', 150, 100), 100);
    assert.equal(operationQueueBaseRevision('applied', 150, 100), 150);
  });
});

describe('authoritative recovery bootstrap guard', () => {
  const project = { revision: 200 };

  it('accepts an explicit recovery above the last verified primary revision', () => {
    assert.equal(validAuthoritativeRecovery({ authoritativeRecovery: true, operationId: 'recovery-200', baseRevision: 100, project }), true);
  });

  it('rejects an implicit, unidentified, or stale recovery', () => {
    assert.equal(validAuthoritativeRecovery({ operationId: 'recovery-200', baseRevision: 100, project }), false);
    assert.equal(validAuthoritativeRecovery({ authoritativeRecovery: true, operationId: '', baseRevision: 100, project }), false);
    assert.equal(validAuthoritativeRecovery({ authoritativeRecovery: true, operationId: 'recovery-200', baseRevision: 200, project }), false);
  });
});

describe('legacy local change migration guard', () => {
  const shared = { publishedAtIso: '2026-10-21T04:01:10.947Z' };

  it('rebases only a newer legacy edit when the shared queue is empty', () => {
    assert.equal(canRebaseLegacyOperation('legacy-123', { publishedAtIso: '2026-10-22T08:00:00.000Z' }, shared, 0), true);
  });

  it('does not rebase an older or equally old legacy edit', () => {
    assert.equal(canRebaseLegacyOperation('legacy-123', { publishedAtIso: '2026-10-21T04:01:10.947Z' }, shared, 0), false);
    assert.equal(canRebaseLegacyOperation('legacy-123', { publishedAtIso: '2026-10-20T08:00:00.000Z' }, shared, 0), false);
  });

  it('does not rebase while another shared operation is pending', () => {
    assert.equal(canRebaseLegacyOperation('legacy-123', { publishedAtIso: '2026-10-22T08:00:00.000Z' }, shared, 1), false);
  });

  it('does not rebase a normal operation through the legacy migration path', () => {
    assert.equal(canRebaseLegacyOperation('map-123', { publishedAtIso: '2026-10-22T08:00:00.000Z' }, shared, 0), false);
  });
});

describe('object-level map synchronization', () => {
  const object = (id, latitude, updatedAtIso) => ({ id, kind: 'hydrant', point: { latitude, longitude: 32.8 }, updatedAtIso });
  const project = (published) => ({
    id: 'district-map-main', name: 'Карта', revision: 10, draft: published, published,
    draftSavedAtIso: '2026-10-27T09:00:00.000Z', publishedAtIso: '2026-10-27T09:00:00.000Z',
  });

  it('changes one object without replacing unrelated objects', () => {
    const base = object('pg-1', 67.1, '2026-10-27T09:00:00.000Z');
    const untouched = object('pg-2', 67.2, '2026-10-27T09:00:00.000Z');
    const edited = object('pg-1', 67.3, '2026-10-27T10:00:00.000Z');
    const result = applyObjectChange(project([base, untouched]), { objectId: 'pg-1', baseObject: base, object: edited, targetRevision: 11 }, '2026-10-27T10:01:00.000Z');
    assert.equal(result.project.published.find((item) => item.id === 'pg-1').point.latitude, 67.3);
    assert.deepEqual(result.project.published.find((item) => item.id === 'pg-2'), untouched);
  });

  it('keeps the newer edit when the same object changed on two devices', () => {
    const base = object('pg-1', 67.1, '2026-10-27T09:00:00.000Z');
    const remote = object('pg-1', 67.2, '2026-10-27T11:00:00.000Z');
    const local = object('pg-1', 67.3, '2026-10-27T10:00:00.000Z');
    const result = applyObjectChange(project([remote]), { objectId: 'pg-1', baseObject: base, object: local, targetRevision: 11 }, '2026-10-27T11:01:00.000Z');
    assert.deepEqual(result.activeObject, remote);
    assert.equal(result.conflict.activeSource, 'remote');
  });

  it('does not silently delete an object edited on another device', () => {
    const base = object('pg-1', 67.1, '2026-10-27T09:00:00.000Z');
    const remote = object('pg-1', 67.2, '2026-10-27T11:00:00.000Z');
    const result = applyObjectChange(project([remote]), { objectId: 'pg-1', baseObject: base, object: null, targetRevision: 11 }, '2026-10-27T11:01:00.000Z');
    assert.deepEqual(result.activeObject, remote);
    assert.equal(result.conflict.activeSource, 'remote');
  });
});
