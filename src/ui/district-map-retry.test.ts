import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPendingDistrictMapOperation, publishDistrictMapOperation, saveDistrictMapState, loadDistrictMapProject, loadPendingDistrictMapOperations, type DistrictMapProject, type DistrictBuilding, type PendingDistrictMapOperation } from './district-map-model';
import type { CoordinatedObjectChange } from './map-sync-service';
import { mergeDistrictMapProjects } from './district-map-merge';
const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./map-sync-service', () => ({
  loadMapSyncConfig: () => Promise.resolve({ coordinatorEnabled: true }),
  publishCoordinatedObjectChanges: transport.send,
}));
const object: DistrictBuilding = { id: 'b1', kind: 'building', objectType: 'building', point: { latitude: 67, longitude: 32 }, contour: [], territoryNames: [], number: 'base', inventoryNumber: '', planningDocuments: [], workshopFull: '', workshopShort: '', departments: [], sites: [], note: '', updatedAtIso: '2026-11-07T10:00:00Z' };
const project = (objects: readonly DistrictBuilding[], revision = 1): DistrictMapProject => ({ id: 'district-map-main', name: 'test', revision, published: objects, draft: objects, draftSavedAtIso: '2026-11-07T10:00:00Z', publishedAtIso: '2026-11-07T10:00:00Z' });
const edit = (number: string, time: string): DistrictBuilding => ({ ...object, number, updatedAtIso: time });
function storage() {
  const values = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem, removeItem: (key: string) => values.delete(key) } });
  return { values, setItem };
}
afterEach(() => { vi.unstubAllGlobals(); transport.send.mockReset(); });
describe('durable object upload', () => {
  it('replays the exact lost-ACK packet after restart, then publishes the newer edit separately', async () => {
    storage();
    const base = project([object]);
    let pending = createPendingDistrictMapOperation(1, project([edit('first', '2026-11-07T10:01:00Z')], 2), base);
    let server = object;
    const accepted = new Map<string, string>();
    let lose = true;
    transport.send.mockImplementation(async (request: { operationId: string; baseRevision: number; changes: readonly CoordinatedObjectChange[] }) => {
      await Promise.resolve();
      const body = JSON.stringify({ baseRevision: request.baseRevision, changes: request.changes });
      const prior = accepted.get(request.operationId);
      if (prior !== undefined) expect(body).toBe(prior);
      else { accepted.set(request.operationId, body); server = request.changes[0]?.object as DistrictBuilding; }
      if (lose) { lose = false; throw new Error('Lost response and status unavailable'); }
      return { revision: 3, publishedAtIso: server.updatedAtIso, conflicts: [], activeObjects: [{ objectId: server.id, object: server }] };
    });
    const checkpoint = (next: PendingDistrictMapOperation) => { pending = next; saveDistrictMapState(next.project, [next]); return next; };
    await expect(publishDistrictMapOperation(pending, { password: '', sessionToken: '' }, undefined, undefined, checkpoint)).rejects.toThrow('Lost response');
    const restored = loadPendingDistrictMapOperations()[0];
    if (!restored) throw new Error('missing persisted operation');
    pending = restored;
    expect(pending.inFlight).toBeDefined();
    pending = createPendingDistrictMapOperation(pending.baseRevision, project([edit('latest', '2026-11-07T10:02:00Z')], 4), base, pending);
    const result = await publishDistrictMapOperation(pending, { password: '', sessionToken: '' }, undefined, undefined, checkpoint);
    expect(server.number).toBe('latest');
    expect((result.project.published[0] as DistrictBuilding).number).toBe('latest');
    expect(accepted.size).toBe(2);
    expect(transport.send).toHaveBeenCalledTimes(3);
  });
  it('does not transmit when persisting a prepared packet fails', async () => {
    const base = project([object]);
    const pending = createPendingDistrictMapOperation(1, project([edit('new', '2026-11-07T10:01:00Z')]), base);
    await expect(publishDistrictMapOperation(pending, { password: '', sessionToken: '' }, undefined, undefined, () => { throw new Error('disk full'); })).rejects.toThrow('disk full');
    expect(transport.send).not.toHaveBeenCalled();
  });
  it('keeps the old map and queue together on a storage failure', () => {
    const { setItem } = storage();
    const base = project([object]);
    saveDistrictMapState(base, []);
    setItem.mockImplementation(() => { throw new Error('quota'); });
    const next = project([edit('new', '2026-11-07T10:01:00Z')], 2);
    expect(() => saveDistrictMapState(next, [createPendingDistrictMapOperation(1, next, base)])).toThrow();
    expect(loadDistrictMapProject().published[0]).toMatchObject({ number: 'base' });
    expect(loadPendingDistrictMapOperations()).toEqual([]);
  });
});
describe('receiving while local changes exist', () => {
  it('combines independent edits and takes the newer remote version of the same object', () => {
    const other = { ...object, id: 'b2' };
    const base = project([object, other]);
    const local = project([edit('local older', '2026-11-07T10:01:00Z'), { ...other, note: 'local work' }]);
    const remote = project([edit('remote newer', '2026-11-07T10:02:00Z'), other]);
    const result = mergeDistrictMapProjects(base, local, remote, true);
    expect(result.project.published).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'b1', number: 'remote newer' }), expect.objectContaining({ id: 'b2', note: 'local work' })]));
    expect(result.conflicts).toHaveLength(1);
  });
  it('does not resurrect a remotely deleted object from an edited local copy', () => {
    const result = mergeDistrictMapProjects(project([object]), project([edit('local', '2026-11-07T10:01:00Z')]), project([]), true);
    expect(result.project.published).toEqual([]);
    expect(result.conflicts[0]?.activeSource).toBe('remote');
  });
});
