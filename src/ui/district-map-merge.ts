import { districtObjectTitle, type DistrictMapObject, type DistrictMapProject } from './district-map-model';

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

const FIELD_LABELS: Readonly<Record<string, string>> = {
  kind: 'Тип объекта',
  objectType: 'Вид объекта',
  mapRole: 'Назначение на карте',
  point: 'Положение подписи/значка',
  contour: 'Контур',
  number: 'Номер',
  territoryNames: 'Названия территории',
  installationName: 'Название наружной установки',
  inventoryNumber: 'Инвентарный номер',
  planningDocuments: 'Документы предварительного планирования',
  workshopFull: 'Полное название цеха',
  workshopShort: 'Краткое название цеха',
  departments: 'Отделения',
  sites: 'Участки',
  owner: 'Принадлежность',
  status: 'Состояние',
  faultDescription: 'Неисправность',
  network: 'Тип сети',
  hydrantType: 'Вид гидранта',
  diameterMm: 'Диаметр',
  pressureAtm: 'Давление',
  volumeM3: 'Объём',
  note: 'Примечание',
};

function displayDate(value: string | undefined): string {
  if (value === undefined || value === '') return 'нет данных';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('ru-RU') : value;
}

function fieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((item) => typeof item === 'object' && item !== null && 'latitude' in item && 'longitude' in item)) return `${value.length} точек`;
    return value.map((item) => {
      if (typeof item !== 'object' || item === null) return String(item);
      const record = item as Record<string, unknown>;
      const label = record.fullName ?? record.number ?? record.shortName;
      return typeof label === 'string' || typeof label === 'number' ? String(label) : JSON.stringify(item);
    }).join('; ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.latitude === 'number' && typeof record.longitude === 'number') return `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}`;
  }
  return JSON.stringify(value);
}

function changedFields(local: DistrictMapObject | null, remote: DistrictMapObject | null): string[] {
  if (local === null) return ['Объект отсутствовал на этом устройстве, но был в облаке.'];
  if (remote === null) return ['Объект был на этом устройстве, но отсутствовал в облаке.'];
  const left = local as unknown as Record<string, unknown>;
  const right = remote as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => key !== 'id' && key !== 'updatedAtIso' && JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null))
    .map((key) => `${FIELD_LABELS[key] ?? key}: на устройстве — «${fieldValue(left[key])}»; в облаке — «${fieldValue(right[key])}».`);
}

export function serializeDistrictMapConflictReport(): string {
  const archives = loadArchives();
  const lines = [
    'ХИМКОНТУР — журнал сохранённых конфликтов карты',
    `Сформирован: ${new Date().toLocaleString('ru-RU')}`,
    '',
    'Конфликт появляется, когда один объект был изменён на двух устройствах до завершения синхронизации. Программа сохраняет обе версии и включает в общую карту более новую по времени изменения.',
    '',
  ];
  if (archives.length === 0) lines.push('Сохранённых конфликтов нет.');
  let conflictNumber = 0;
  for (const archive of archives) {
    lines.push(`Синхронизация: ${displayDate(archive.createdAtIso)} · локальная версия ${archive.localRevision} · облачная версия ${archive.remoteRevision}`);
    for (const conflict of archive.conflicts) {
      conflictNumber += 1;
      const object = conflict.local ?? conflict.remote;
      lines.push('', `${conflictNumber}. ${object === null ? `Объект ${conflict.objectId}` : districtObjectTitle(object)} (ID: ${conflict.objectId})`);
      lines.push(`   Изменено на устройстве: ${displayDate(conflict.local?.updatedAtIso)}`);
      lines.push(`   Изменено в облаке: ${displayDate(conflict.remote?.updatedAtIso)}`);
      lines.push(`   В общую карту выбрана версия: ${conflict.activeSource === 'local' ? 'с этого устройства' : 'из облака'}`);
      const changes = changedFields(conflict.local, conflict.remote);
      if (changes.length === 0) lines.push('   Отличающиеся поля не найдены.');
      else changes.forEach((change) => lines.push(`   • ${change}`));
    }
    lines.push('', '—'.repeat(72), '');
  }
  return lines.join('\r\n');
}

export function clearDistrictMapConflictArchives(): void {
  window.localStorage.removeItem(CONFLICT_ARCHIVE_KEY);
}
