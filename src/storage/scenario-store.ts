import type { CalculationInput } from '../core/types';
import type { ControlPoint } from '../ui/MapCanvas';
import type { SourceConfiguration } from '../ui/source-library';
import type { Basemap } from '../ui/MapCanvas';

export type StoredScenario = Readonly<{
  id: 'current';
  savedAtIso: string;
  input: CalculationInput;
  controls: readonly ControlPoint[];
  sourceLabel: string;
  sourceConfiguration?: SourceConfiguration;
  sourcePlaced?: boolean;
  basemap?: Basemap;
  applicationUrl?: string;
}>;

const DATABASE = 'ahov-local';
const STORE = 'scenarios';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть локальную базу.'));
  });
}

export async function saveScenario(value: Omit<StoredScenario, 'id' | 'savedAtIso'>): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put({ ...value, id: 'current', savedAtIso: new Date().toISOString() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось сохранить сценарий.'));
  });
  db.close();
}

export async function loadScenario(): Promise<StoredScenario | null> {
  const db = await database();
  const value = await new Promise<StoredScenario | undefined>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('current');
    request.onsuccess = () => resolve(request.result as StoredScenario | undefined);
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать сценарий.'));
  });
  db.close();
  return value ?? null;
}

type SavePicker = (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;

export async function saveScenarioFile(value: Omit<StoredScenario, 'id' | 'savedAtIso'>): Promise<void> {
  const payload: StoredScenario = { ...value, id: 'current', savedAtIso: new Date().toISOString(), applicationUrl: window.location.href };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const stamp = new Date().toLocaleDateString('ru-RU').replaceAll('.', '-');
  const picker = (window as typeof window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker !== undefined) {
    const handle = await picker({ suggestedName: `Химконтур_${stamp}.himkontur`, types: [{ description: 'Расчёт ХИМКОНТУР', accept: { 'application/json': ['.himkontur'] } }] });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `Химконтур_${stamp}.himkontur`; anchor.click();
  URL.revokeObjectURL(url);
}

export async function loadScenarioFile(file: File): Promise<StoredScenario> {
  const parsed = JSON.parse(await file.text()) as Partial<StoredScenario>;
  if (parsed.input === undefined || !Array.isArray(parsed.controls)) throw new Error('Выбранный файл не является расчётом ХИМКОНТУР.');
  return { ...parsed, id: 'current', savedAtIso: parsed.savedAtIso ?? new Date().toISOString(), controls: parsed.controls, input: parsed.input, sourceLabel: parsed.sourceLabel ?? 'Источник АХОВ' };
}
