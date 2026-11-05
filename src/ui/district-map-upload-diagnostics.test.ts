import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadDistrictUploadDiagnostics,
  serializeDistrictUploadDiagnostics,
  updateDistrictUploadDiagnostics,
} from './district-map-upload-diagnostics';

describe('district map upload diagnostics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('updates one fragment in place and survives a browser restart', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } });
    const sending = updateDistrictUploadDiagnostics([], {
      chunkOperationId: 'map-1-chunk-1', rootOperationId: 'map-1', sequence: 1,
      stage: 'sending', objectCount: 2, objectIds: ['a', 'b'], objectLabels: ['A', 'B'],
      payloadBytes: 1200, confirmedObjects: 0, totalObjects: 2,
    });
    updateDistrictUploadDiagnostics(sending, {
      chunkOperationId: 'map-1-chunk-1', rootOperationId: 'map-1', sequence: 1,
      stage: 'confirmed', objectCount: 2, objectIds: ['a', 'b'], objectLabels: ['A', 'B'],
      confirmedObjects: 1, totalObjects: 1, serverRevision: 55, confirmation: 'status-check',
    });
    expect(loadDistrictUploadDiagnostics()).toEqual([expect.objectContaining({
      stage: 'confirmed', payloadBytes: 1200, serverRevision: 55, confirmation: 'status-check',
    })]);
  });

  it('exports only technical transfer data and never invents credentials', () => {
    const report = serializeDistrictUploadDiagnostics([], {
      appVersion: '0.3.59', pendingPackets: 1, userAgent: 'test-browser',
    });
    expect(report).toContain('himkontur-map-upload-diagnostics');
    expect(report.toLowerCase()).not.toContain('password');
    expect(report.toLowerCase()).not.toContain('sessiontoken');
  });
});
