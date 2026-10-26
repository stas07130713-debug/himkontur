import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateMapAdmin,
  clearMapSyncConfigCache,
  MapSyncRequestError,
  normalizeMapSyncStatus,
  publishCoordinatedMap,
  withRenewedMapAdminSession,
} from './map-sync-service';
import type { DistrictMapProject } from './district-map-model';

const configResponse = {
  primaryApiUrl: 'https://primary.example.test',
  coordinatorUrl: 'https://coordinator.example.test',
  coordinatorEnabled: true,
  pollIntervalMs: 60_000,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  clearMapSyncConfigCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('map synchronization sessions', () => {
  it('keeps the confirmed shared-server revision and save time in diagnostics', () => {
    expect(normalizeMapSyncStatus({
      mode: 'backup',
      activeProvider: 'cloudflare',
      backupAvailable: true,
      pendingOperations: 1,
      sharedRevision: 123,
      sharedUpdatedAtIso: '2026-10-26T10:20:30.000Z',
    })).toMatchObject({
      sharedRevision: 123,
      sharedUpdatedAtIso: '2026-10-26T10:20:30.000Z',
      pendingOperations: 1,
    });
  });

  it('retries loading synchronization settings after a temporary fetch failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(jsonResponse(configResponse))
      .mockResolvedValueOnce(jsonResponse({ sessionToken: 'recovered-session', status: { mode: 'backup', activeProvider: 'cloudflare' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setTimeout, clearTimeout });

    await expect(authenticateMapAdmin('administrator-password')).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(authenticateMapAdmin('administrator-password')).resolves.toMatchObject({
      credential: { sessionToken: 'recovered-session' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('repeats one unavailable coordinator request before keeping it in the local queue', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configResponse))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary outage' }, 503))
      .mockResolvedValueOnce(jsonResponse({ sessionToken: 'retry-session', status: { mode: 'backup', activeProvider: 'cloudflare' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setTimeout, clearTimeout });

    await expect(authenticateMapAdmin('administrator-password')).resolves.toMatchObject({
      credential: { sessionToken: 'retry-session' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retains the entered password in memory so an expired session can be renewed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configResponse))
      .mockResolvedValueOnce(jsonResponse({ sessionToken: 'renewable-session', status: { mode: 'backup', activeProvider: 'cloudflare' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setTimeout, clearTimeout });

    const authenticated = await authenticateMapAdmin('administrator-password');

    expect(authenticated.credential).toEqual({
      password: 'administrator-password',
      sessionToken: 'renewable-session',
    });
  });

  it('classifies an expired cloud session as renewable authorization failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configResponse))
      .mockResolvedValueOnce(jsonResponse({ error: 'Сеанс истёк.' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const project = {
      id: 'district-map',
      name: 'Карта района выезда',
      revision: 1,
      draft: [],
      published: [],
      draftSavedAtIso: '',
      publishedAtIso: '',
    } satisfies DistrictMapProject;

    const promise = publishCoordinatedMap({
      operationId: 'operation-1',
      baseRevision: 0,
      project,
      credential: { password: 'administrator-password', sessionToken: 'expired-session' },
    });

    await expect(promise).rejects.toMatchObject<Partial<MapSyncRequestError>>({
      kind: 'authorization',
      status: 401,
    });
  });

  it('recognizes a committed operation after its write response was lost', async () => {
    const project = {
      id: 'district-map-main',
      name: 'Карта района выезда',
      revision: 2,
      draft: [],
      published: [],
      draftSavedAtIso: '2026-10-24T10:00:00.000Z',
      publishedAtIso: '2026-10-24T10:00:00.000Z',
    } satisfies DistrictMapProject;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configResponse))
      .mockResolvedValueOnce(jsonResponse({ error: 'gateway timeout' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'gateway timeout' }, 503))
      .mockResolvedValueOnce(jsonResponse({ project, status: { mode: 'backup', activeProvider: 'cloudflare' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setTimeout, clearTimeout });

    await expect(publishCoordinatedMap({
      operationId: 'operation-committed',
      baseRevision: 1,
      project,
      credential: { password: 'administrator-password', sessionToken: 'active-session' },
    })).resolves.toMatchObject({ project, status: { mode: 'backup' } });
    expect(fetchMock.mock.calls[3]?.[0]).toBe('https://coordinator.example.test/v1/operations/operation-committed');
  });

  it('compresses a full map before sending it to the coordinator', async () => {
    const largeText = 'Карта'.repeat(20_000);
    const project = {
      id: 'district-map-main',
      name: 'Карта района выезда',
      revision: 2,
      draft: [{ id: 'large-object', kind: 'building', notes: largeText }],
      published: [{ id: 'large-object', kind: 'building', notes: largeText }],
      draftSavedAtIso: '2026-10-26T09:00:00.000Z',
      publishedAtIso: '2026-10-26T09:00:00.000Z',
    } as unknown as DistrictMapProject;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configResponse))
      .mockResolvedValueOnce(jsonResponse({ project, status: { mode: 'backup', activeProvider: 'cloudflare' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setTimeout, clearTimeout });

    await publishCoordinatedMap({
      operationId: 'large-operation',
      baseRevision: 1,
      project,
      credential: { password: 'administrator-password', sessionToken: 'active-session' },
    });

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((request.headers as Record<string, string>)['Content-Type']).toBe('application/vnd.himkontur+json+gzip');
    expect(request.body).toBeInstanceOf(ArrayBuffer);
    expect((request.body as ArrayBuffer).byteLength).toBeLessThan(32_000);
  });

  it('renews an expired session and repeats the interrupted operation once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configResponse))
      .mockResolvedValueOnce(jsonResponse({ sessionToken: 'fresh-session', status: { mode: 'backup', activeProvider: 'cloudflare' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const usedTokens: string[] = [];

    const result = await withRenewedMapAdminSession(
      { password: 'administrator-password', sessionToken: 'expired-session' },
      (credential) => {
        usedTokens.push(credential.sessionToken);
        if (credential.sessionToken === 'expired-session') {
          return Promise.reject(new MapSyncRequestError('Сеанс истёк.', 401, 'authorization'));
        }
        return Promise.resolve('published');
      },
    );

    expect(usedTokens).toEqual(['expired-session', 'fresh-session']);
    expect(result.value).toBe('published');
    expect(result.credential).toEqual({ password: 'administrator-password', sessionToken: 'fresh-session' });
    expect(result.status?.activeProvider).toBe('cloudflare');
  });
});
