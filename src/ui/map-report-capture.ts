import html2canvas from 'html2canvas';

async function waitForMapFrame(map: HTMLElement): Promise<void> {
  const offlineMap = map.querySelector<HTMLElement>('.offline-vector-map');
  if (offlineMap === null) return;
  const deadline = performance.now() + 5_000;
  while (!['idle', 'loaded'].includes(offlineMap.dataset.mapStatus ?? '') && performance.now() < deadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
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
  const liveMapSize = { width: map.getBoundingClientRect().width, height: map.getBoundingClientRect().height };
  if (normalizeResponsiveLayout) workspace.classList.add('report-capture-layout');
  try {
    // ResizeObserver and MapLibre both need a settled frame after the phone
    // layout is temporarily normalized to the report's landscape geometry.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    await waitForMapFrame(map);
    // MapLibre owns both the autonomous vector map and satellite imagery.
    // Waiting for its idle frame keeps PDF and Word captures identical to the
    // live view without maintaining a second, competing HTML tile layer.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await document.fonts.ready;
    const canvas = await html2canvas(workspace, {
      backgroundColor: '#edf3f2',
      scale: Math.min(2, Math.max(1.25, window.devicePixelRatio || 1)),
      useCORS: true,
      allowTaint: false,
      logging: false,
      removeContainer: true,
      onclone: (documentClone) => {
        documentClone.querySelectorAll('.map-context-menu').forEach((node) => node.remove());
        // html2canvas renders SVG <image> inconsistently: in Chromium it can
        // draw it once itself and then the compatibility pass below adds it a
        // second time. Exclude these nodes from the cloned pass and restore
        // each live SVG image exactly once onto the resulting bitmap.
        documentClone.querySelectorAll<SVGImageElement>('svg image').forEach((image) => {
          image.style.visibility = 'hidden';
        });
        documentClone.querySelectorAll<HTMLButtonElement>('.result-actions button').forEach((button) => {
          if (button.textContent.includes('Формируется')) {
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
    if (normalizeResponsiveLayout) {
      workspace.classList.remove('report-capture-layout');
      // Let ResizeObserver restore the exact live phone/desktop projection
      // before report generation reports completion to the caller.
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const rect = map.getBoundingClientRect();
        if (Math.abs(rect.width - liveMapSize.width) < 1 && Math.abs(rect.height - liveMapSize.height) < 1) break;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
  }
}
