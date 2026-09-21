import html2canvas from 'html2canvas';

const TILE_WAIT_MS = 10_000;

function waitForImage(image: HTMLImageElement): Promise<boolean> {
  if (image.complete) return Promise.resolve(image.naturalWidth > 0);
  return new Promise((resolve) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
    };
    const loaded = () => { cleanup(); resolve(true); };
    const failed = () => { cleanup(); resolve(false); };
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, TILE_WAIT_MS);
    image.addEventListener('load', loaded, { once: true });
    image.addEventListener('error', failed, { once: true });
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('значок объекта не загрузился'));
    image.src = source;
  });
}

async function restoreSvgImages(root: HTMLElement, canvas: HTMLCanvasElement): Promise<void> {
  const rootRect = root.getBoundingClientRect();
  const scale = canvas.width / Math.max(1, rootRect.width);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('графический контекст снимка недоступен');
  const images = [...root.querySelectorAll<SVGImageElement>('svg image')];
  for (const element of images) {
    const href = element.href.baseVal;
    const matrix = element.getScreenCTM();
    if (href === '' || matrix === null) continue;
    const image = await loadImage(href);
    context.save();
    context.setTransform(
      matrix.a * scale,
      matrix.b * scale,
      matrix.c * scale,
      matrix.d * scale,
      (matrix.e - rootRect.left) * scale,
      (matrix.f - rootRect.top) * scale
    );
    context.drawImage(image, element.x.baseVal.value, element.y.baseVal.value, element.width.baseVal.value, element.height.baseVal.value);
    context.restore();
  }
}

function cropCanvas(source: HTMLCanvasElement, x: number, y: number, width: number, height: number): HTMLCanvasElement {
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.round(width));
  target.height = Math.max(1, Math.round(height));
  const context = target.getContext('2d');
  if (context === null) throw new Error('графический контекст приложения к отчёту недоступен');
  context.drawImage(source, Math.round(x), Math.round(y), target.width, target.height, 0, 0, target.width, target.height);
  return target;
}

export async function captureMapForReport(map: HTMLElement, sidePanel?: HTMLElement): Promise<string> {
  const workspace = sidePanel?.closest<HTMLElement>('.workspace') ?? map;
  const normalizeResponsiveLayout = sidePanel !== undefined && workspace.classList.contains('workspace');
  if (normalizeResponsiveLayout) workspace.classList.add('report-capture-layout');
  try {
    // ResizeObserver and MapLibre both need a settled frame after the phone
    // layout is temporarily normalized to the report's landscape geometry.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    const tiles = [...map.querySelectorAll<HTMLImageElement>('.basemap-tile-layer img')];
    // A report remains valid with the bundled vector basemap when raster
    // imagery is unavailable. If a stable raster frame exists, wait for it.
    await Promise.all(tiles.map(waitForImage));
    await document.fonts.ready;
    const canvas = await html2canvas(workspace, {
      backgroundColor: '#edf3f2',
      scale: Math.min(2, Math.max(1.25, window.devicePixelRatio || 1)),
      useCORS: true,
      allowTaint: false,
      logging: false,
      removeContainer: true,
      onclone: (documentClone) => {
        documentClone.querySelectorAll('.map-context-menu, .basemap-tile-preload').forEach((node) => node.remove());
        documentClone.querySelectorAll<HTMLButtonElement>('.result-actions button').forEach((button) => {
          if (button.textContent?.includes('Формируется')) {
            button.textContent = 'Сформировать отчёт';
            button.disabled = false;
          }
        });
      }
    });
    await restoreSvgImages(workspace, canvas);
    if (sidePanel === undefined) return canvas.toDataURL('image/png');
    const workspaceRect = workspace.getBoundingClientRect();
    const mapRect = map.getBoundingClientRect();
    const sideRect = sidePanel.getBoundingClientRect();
    const scale = canvas.width / Math.max(1, workspaceRect.width);
    const left = Math.max(0, mapRect.left - workspaceRect.left);
    const top = Math.max(0, Math.min(mapRect.top, sideRect.top) - workspaceRect.top);
    const right = Math.min(workspaceRect.width, sideRect.right - workspaceRect.left);
    const bottom = Math.min(workspaceRect.height, Math.max(mapRect.bottom, sideRect.bottom) - workspaceRect.top);
    return cropCanvas(canvas, left * scale, top * scale, (right - left) * scale, (bottom - top) * scale).toDataURL('image/png');
  } finally {
    if (normalizeResponsiveLayout) workspace.classList.remove('report-capture-layout');
  }
}
