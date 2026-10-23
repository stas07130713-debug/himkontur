import type { DistrictMapObject, DistrictMapProject } from './district-map-model';

export type DistrictMapObjectConflict = Readonly<{
  objectId: string;
  local: DistrictMapObject | null;
  remote: DistrictMapObject | null;
  activeSource: 'local' | 'remote';
}>;

export type DistrictMapConflictArchive = Readonly<{
  createdAtIso: string;
  baseRevision: number | null;
  localRevision: number;
  remoteRevision: number;
  conflicts: readonly DistrictMapObjectConflict[];
}>;

const CONFLICT_ARCHIVE_KEY = 'himkontur-district-map-conflicts-v1';

function sameObject(left: DistrictMapObject | undefined, right: DistrictMapObject | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function modifiedAt(object: DistrictMapObject | undefined): number {
  if (object === undefined) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(object.updatedAtIso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeVersion(local: DistrictMapObject | undefined, remote: DistrictMapObject | undefined): Readonly<{
  object: DistrictMapObject | undefined;
  source: 'local' | 'remote';
}> {
  // A deletion never silently destroys an object edited on the other device.
  if (local === undefined) return { object: remote, source: 'remote' };
  if (remote === undefined) return { object: local, source: 'local' };
  return modifiedAt(local) >= modifiedAt(remote)
    ? { object: local, source: 'local' }
    : { object: remote, source: 'remote' };
}

export function mergeDistrictMapProjects(
  base: DistrictMapProject | null,
  local: DistrictMapProject,
  remote: DistrictMapProject,
): Readonly<{ project: DistrictMapProject; conflicts: readonly DistrictMapObjectConflict[] }> {
  const baseById = new Map((base?.published ?? []).map((object) => [object.id, object]));
  const localById = new Map(local.published.map((object) => [object.id, object]));
  const remoteById = new Map(remote.published.map((object) => [object.id, object]));
  const ids = [...new Set([
    ...remote.published.map((object) => object.id),
    ...local.published.map((object) => object.id),
    ...(base?.published ?? []).map((object) => object.id),
  ])];
  const objects: DistrictMapObject[] = [];
  const conflicts: DistrictMapObjectConflict[] = [];

  for (const id of ids) {
    const baseObject = baseById.get(id);
    const localObject = localById.get(id);
    const remoteObject = remoteById.get(id);
    if (base === null) {
      if (localObject === undefined) {
        if (remoteObject !== undefined) objects.push(remoteObject);
        continue;
      }
      if (remoteObject === undefined || sameObject(localObject, remoteObject)) {
        objects.push(localObject);
        continue;
      }
      const active = activeVersion(localObject, remoteObject);
      if (active.object !== undefined) objects.push(active.object);
      conflicts.push({ objectId: id, local: localObject, remote: remoteObject, activeSource: active.source });
      continue;
    }

    const localChanged = !sameObject(localObject, baseObject);
    const remoteChanged = !sameObject(remoteObject, baseObject);
    if (!localChanged && !remoteChanged) {
      if (baseObject !== undefined) objects.push(baseObject);
    } else if (localChanged && !remoteChanged) {
      if (localObject !== undefined) objects.push(localObject);
    } else if (!localChanged && remoteChanged) {
      if (remoteObject !== undefined) objects.push(remoteObject);
    } else if (sameObject(localObject, remoteObject)) {
      if (localObject !== undefined) objects.push(localObject);
    } else {
      const active = activeVersion(localObject, remoteObject);
      if (active.object !== undefined) objects.push(active.object);
      conflicts.push({ objectId: id, local: localObject ?? null, remote: remoteObject ?? null, activeSource: active.source });
    }
  }

  const now = new Date().toISOString();
  const revision = Math.max(remote.revision + 1, local.revision + 1, Date.now());
  return {
    project: {
      ...remote,
      revision,
      draft: objects,
      published: objects,
      draftSavedAtIso: now,
      publishedAtIso: now,
    },
    conflicts,
  };
}

function loadArchives(): DistrictMapConflictArchive[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CONFLICT_ARCHIVE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed as DistrictMapConflictArchive[] : [];
  } catch {
    return [];
  }
}

export function saveDistrictMapConflictArchive(archive: DistrictMapConflictArchive): number {
  const archives = [...loadArchives().slice(-19), archive];
  window.localStorage.setItem(CONFLICT_ARCHIVE_KEY, JSON.stringify(archives));
  return archives.reduce((count, item) => count + item.conflicts.length, 0);
}

export function districtMapConflictArchiveCount(): number {
  return loadArchives().reduce((count, item) => count + item.conflicts.length, 0);
}

export function serializeDistrictMapConflictArchives(): string {
  return JSON.stringify({
    format: 'himkontur-district-map-conflicts',
    version: 1,
    exportedAtIso: new Date().toISOString(),
    archives: loadArchives(),
  }, null, 2);
}
