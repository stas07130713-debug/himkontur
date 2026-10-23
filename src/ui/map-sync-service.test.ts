import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateMapAdmin,
  clearMapSyncConfigCache,
  MapSyncRequestError,
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
