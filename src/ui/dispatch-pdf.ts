import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeReportFiles = {
  saveReport(options: Readonly<{ filename: string; mimeType: string; data: string }>): Promise<Readonly<{ location: string }>>;
};

type FilePermissionMode = 'read' | 'readwrite';
type FilePermissionDescriptor = Readonly<{ mode?: FilePermissionMode }>;

type WritableFileHandle = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
};

type DispatchFileHandle = {
  createWritable(): Promise<WritableFileHandle>;
};

export type DispatchDirectoryHandle = {
  readonly kind: 'directory';
  readonly name: string;
  getFileHandle(name: string, options: Readonly<{ create: boolean }>): Promise<DispatchFileHandle>;
  queryPermission?(descriptor: FilePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor: FilePermissionDescriptor): Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & typeof globalThis & {
  showDirectoryPicker?: (options?: Readonly<{ id?: string; mode?: FilePermissionMode; startIn?: string }>) => Promise<DispatchDirectoryHandle>;
};

const nativeReportFiles = registerPlugin<NativeReportFiles>('HimkonturFiles');
const DIRECTORY_DATABASE = 'himkontur-dispatch-files';
const DIRECTORY_STORE = 'handles';
const DIRECTORY_KEY = 'last-dispatch-pdf-directory';
const DIRECTORY_SELECTED_FLAG = 'himkontur:dispatch-pdf-directory-selected';

function openDirectoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DIRECTORY_STORE)) request.result.createObjectStore(DIRECTORY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище выбранной папки.'));
  });
}

async function storedDirectory(): Promise<DispatchDirectoryHandle | null> {
  try {
    const database = await openDirectoryDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DIRECTORY_STORE, 'readonly');
      const request = transaction.objectStore(DIRECTORY_STORE).get(DIRECTORY_KEY);
      request.onsuccess = () => resolve((request.result as DispatchDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать выбранную папку.'));
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return null;
  }
}

async function rememberDirectory(handle: DispatchDirectoryHandle): Promise<void> {
  const database = await openDirectoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DIRECTORY_STORE, 'readwrite');
    transaction.objectStore(DIRECTORY_STORE).put(handle, DIRECTORY_KEY);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Не удалось запомнить выбранную папку.')); };
  });
}

async function writableDirectory(handle: DispatchDirectoryHandle): Promise<boolean> {
  const descriptor = { mode: 'readwrite' as const };
  if (handle.queryPermission === undefined) return true;
  if (await handle.queryPermission(descriptor) === 'granted') return true;
  return handle.requestPermission !== undefined && await handle.requestPermission(descriptor) === 'granted';
}

async function directoryAlreadyWritable(handle: DispatchDirectoryHandle): Promise<boolean> {
  return handle.queryPermission === undefined || await handle.queryPermission({ mode: 'readwrite' }) === 'granted';
}

export function canChooseDispatchPdfDirectory(): boolean {
  return !Capacitor.isNativePlatform() && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function chooseDispatchPdfDirectory(): Promise<string | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (picker === undefined) return null;
  try {
    const handle = await picker({ id: 'himkontur-dispatch-pdf', mode: 'readwrite', startIn: 'documents' });
    await rememberDirectory(handle);
    localStorage.setItem(DIRECTORY_SELECTED_FLAG, '1');
    return handle.name;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function prepareDispatchPdfDirectory(): Promise<string | null> {
  if (!canChooseDispatchPdfDirectory()) return null;
  if (localStorage.getItem(DIRECTORY_SELECTED_FLAG) !== '1') return chooseDispatchPdfDirectory();
  const directory = await storedDirectory();
  if (directory !== null && await writableDirectory(directory)) return directory.name;
  return chooseDispatchPdfDirectory();
}

function blobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось подготовить PDF.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result.split(',')[1] ?? '' : '');
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function saveDispatchPdf(blob: Blob, filename: string, promptForDirectory = true): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const result = await nativeReportFiles.saveReport({ filename, mimeType: 'application/pdf', data: await blobAsBase64(blob) });
    return result.location;
  }
  if (canChooseDispatchPdfDirectory()) {
    let directory = await storedDirectory();
    if (promptForDirectory && (directory === null || !await writableDirectory(directory))) {
      const selected = await chooseDispatchPdfDirectory();
      directory = selected === null ? null : await storedDirectory();
    }
    const canWrite = directory !== null && (promptForDirectory ? await writableDirectory(directory) : await directoryAlreadyWritable(directory));
    if (directory !== null && canWrite) {
      const file = await directory.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
      return `${directory.name}/${filename}`;
    }
  }
  downloadBlob(blob, filename);
  return `Загрузки/${filename}`;
}

function printableFieldValue(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  if (field.tagName === 'SELECT') return (field as HTMLSelectElement).selectedOptions.item(0)?.textContent.trim() ?? field.value;
  if (field.tagName === 'INPUT' && (field as HTMLInputElement).type === 'date' && /^\d{4}-\d{2}-\d{2}$/u.test(field.value)) {
    const [year, month, day] = field.value.split('-');
    return `${day}.${month}.${year}`;
  }
  return field.value;
}

export function warmDispatchExport(): void {
  void import('html2canvas');
  void Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
}

export async function captureDispatchSnapshot(sheet: HTMLElement, options: Readonly<{ scale?: number }> = {}): Promise<string> {
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(sheet, {
    backgroundColor: '#ffffff',
    scale: options.scale ?? Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)),
    useCORS: true,
    allowTaint: false,
    logging: false,
    removeContainer: true,
    onclone: (clonedDocument) => {
      const clonedSheet = clonedDocument.querySelector<HTMLElement>('.fire-dispatch-ticket-sheet');
      clonedSheet?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach((field) => {
        const value = printableFieldValue(field);
        const replacement = clonedDocument.createElement('div');
        replacement.className = 'fire-dispatch-capture-value';
        if (field.tagName === 'TEXTAREA') replacement.classList.add('multiline');
        replacement.textContent = value === '' ? '\u00a0' : value;
        field.replaceWith(replacement);
      });
    },
  });
  return canvas.toDataURL('image/png');
}

export async function createDispatchPdf(imageDataUrl: string): Promise<Blob> {
  const [{ default: pdfMake }, { vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.vfs = vfs;
  const pdf = pdfMake.createPdf({
    pageSize: 'A4',
    pageMargins: [28, 17, 28, 17],
    content: [{ image: imageDataUrl, fit: [539, 808], alignment: 'center' }],
  });
  return await new Promise<Blob>((resolve) => pdf.getBlob(resolve));
}

export function printDispatchSnapshot(imageDataUrl: string): void {
  const image = document.createElement('img');
  image.id = 'fire-dispatch-print-image';
  image.alt = 'Путёвка для печати';
  image.src = imageDataUrl;
  const cleanup = () => {
    document.body.classList.remove('fire-dispatch-printing');
    image.remove();
  };
  document.body.append(image);
  document.body.classList.add('fire-dispatch-printing');
  window.addEventListener('afterprint', cleanup, { once: true });
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  window.setTimeout(cleanup, 60_000);
}
