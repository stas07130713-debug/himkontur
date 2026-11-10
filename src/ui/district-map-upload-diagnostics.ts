export type DistrictUploadStage = 'preparing' | 'sending' | 'verifying' | 'splitting' | 'confirmed' | 'failed';

export type DistrictUploadDiagnostic = Readonly<{
  chunkOperationId: string;
  rootOperationId: string;
  sequence: number;
  stage: DistrictUploadStage;
  objectCount: number;
  objectIds: readonly string[];
  objectLabels: readonly string[];
  payloadBytes: number;
  confirmedObjects: number;
  totalObjects: number;
  attempt: number;
  startedAtIso: string;
  updatedAtIso: string;
  serverRevision: number | null;
  confirmation: 'direct' | 'status-check' | '';
  message: string;
}>;

export type DistrictUploadDiagnosticUpdate = Readonly<{
  chunkOperationId: string;
  rootOperationId: string;
  sequence: number;
  stage: DistrictUploadStage;
  objectCount: number;
  objectIds: readonly string[];
  objectLabels: readonly string[];
  payloadBytes?: number;
  confirmedObjects: number;
  totalObjects: number;
  attempt?: number;
  serverRevision?: number | null;
  confirmation?: DistrictUploadDiagnostic['confirmation'];
  message?: string;
}>;

const STORAGE_KEY = 'himkontur-district-map-upload-diagnostics-v1';
const MAX_ENTRIES = 120;

export function loadDistrictUploadDiagnostics(): DistrictUploadDiagnostic[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is DistrictUploadDiagnostic => (
      typeof value === 'object' && value !== null
      && typeof (value as DistrictUploadDiagnostic).chunkOperationId === 'string'
      && typeof (value as DistrictUploadDiagnostic).stage === 'string'
    )).slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function updateDistrictUploadDiagnostics(
  current: readonly DistrictUploadDiagnostic[],
  update: DistrictUploadDiagnosticUpdate,
): DistrictUploadDiagnostic[] {
  const now = new Date().toISOString();
  const existing = current.find((entry) => entry.chunkOperationId === update.chunkOperationId);
  const next: DistrictUploadDiagnostic = {
    chunkOperationId: update.chunkOperationId,
    rootOperationId: update.rootOperationId,
    sequence: update.sequence,
    stage: update.stage,
    objectCount: update.objectCount,
    objectIds: update.objectIds,
    objectLabels: update.objectLabels,
    payloadBytes: update.payloadBytes ?? existing?.payloadBytes ?? 0,
    confirmedObjects: update.confirmedObjects,
    totalObjects: update.totalObjects,
    attempt: update.attempt ?? existing?.attempt ?? 1,
    startedAtIso: existing?.startedAtIso ?? now,
    updatedAtIso: now,
    serverRevision: update.serverRevision ?? existing?.serverRevision ?? null,
    confirmation: update.confirmation ?? existing?.confirmation ?? '',
    message: update.message ?? existing?.message ?? '',
  };
  const result = [...current.filter((entry) => entry.chunkOperationId !== update.chunkOperationId), next].slice(-MAX_ENTRIES);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  return result;
}

export function clearDistrictUploadDiagnostics(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function serializeDistrictUploadDiagnostics(
  entries: readonly DistrictUploadDiagnostic[],
  context: Readonly<{ appVersion: string; pendingPackets: number; userAgent: string }>,
): string {
  return JSON.stringify({
    format: 'himkontur-map-upload-diagnostics',
    version: 1,
    exportedAtIso: new Date().toISOString(),
    appVersion: context.appVersion,
    pendingPackets: context.pendingPackets,
    userAgent: context.userAgent,
    entries,
  }, null, 2);
}
