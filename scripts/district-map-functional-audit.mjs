import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:4178/';
const port = 9760 + Math.floor(Math.random() * 100);
const edgeProfileDirectory = resolve('..', '.test-runtime', `district-map-edge-profile-${process.pid}`);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
mkdirSync(edgeProfileDirectory, { recursive: true });
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=1366,768',
  `--user-data-dir=${edgeProfileDirectory}`, pageUrl,
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 50 && target === undefined; attempt += 1) {
    await delay(200);
    try {
      const entries = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = entries.find((entry) => entry.type === 'page');
    } catch { /* Edge запускается. */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Не удалось открыть приложение.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => { const response = JSON.parse(event.data); const done = pending.get(response.id); if (done) { pending.delete(response.id); done(response); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, (response) => response.error ? reject(new Error(response.error.message)) : resolve(response.result));
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await command('Runtime.enable');
  await delay(1800);

  const result = await evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setInput = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const basemapButtons = [...document.querySelectorAll('.map-tool-group .segmented button')];
    basemapButtons.find((button) => button.textContent.includes('Спутник'))?.click();
    await wait(80);
    const switchedToSatellite = basemapButtons.some((button) => button.classList.contains('active') && button.textContent.includes('Спутник'));
    const historyButtons = [...document.querySelectorAll('.history-action')];
    historyButtons[0]?.click();
    await wait(80);
    const undoRestoredMap = basemapButtons.some((button) => button.classList.contains('active') && button.textContent.includes('Карта'));
    historyButtons[1]?.click();
    await wait(80);
    const redoRestoredSatellite = basemapButtons.some((button) => button.classList.contains('active') && button.textContent.includes('Спутник'));
    document.querySelector('.district-tools-toggle')?.click();
    await wait(100);
    const input = document.querySelector('.district-object-search-row.nppv input');
    setInput(input, 'ПГ-17');
    await wait(120);
    const firstResults = document.querySelectorAll('.district-object-search-row.nppv .district-search-results button').length;
    const toolbarRectWithResults = document.querySelector('.map-tool-stack > .district-object-toolbar')?.getBoundingClientRect();
    const resultsRect = document.querySelector('.district-object-search-row.nppv .district-search-results')?.getBoundingClientRect();
    const searchRect = document.querySelector('.district-object-search-row.nppv .district-search')?.getBoundingClientRect();
    const searchInputRect = input?.getBoundingClientRect();
    const clearButtonRect = document.querySelector('.district-object-search-row.nppv .district-search > button')?.getBoundingClientRect();
    const mapToolbarRect = document.querySelector('.map-toolbar')?.getBoundingClientRect();
    const windRect = document.querySelector('.toolbar-wind-summary')?.getBoundingClientRect();
    const resultsContained = Boolean(toolbarRectWithResults && resultsRect
      && resultsRect.left >= toolbarRectWithResults.left - 1
      && resultsRect.right <= toolbarRectWithResults.right + 1
      && resultsRect.bottom <= toolbarRectWithResults.bottom + 1);
    const compactSearchWidth = Boolean(toolbarRectWithResults && searchRect && searchRect.width <= toolbarRectWithResults.width * .7);
    const clearButtonCentered = Boolean(searchInputRect && clearButtonRect
      && Math.abs((clearButtonRect.top + clearButtonRect.height / 2) - (searchInputRect.top + searchInputRect.height / 2)) <= 1);
    const clearButtonOffset = searchInputRect && clearButtonRect
      ? (clearButtonRect.top + clearButtonRect.height / 2) - (searchInputRect.top + searchInputRect.height / 2)
      : null;
    const windLockedToToolbarTop = Boolean(mapToolbarRect && windRect
      && Math.abs(windRect.top - mapToolbarRect.top) <= 1
      && windRect.height <= 40);
    document.querySelector('.district-object-search-row.nppv .district-search-results button')?.click();
    await wait(80);
    document.querySelector('.district-object-search-row.nppv .district-search > button')?.click();
    await wait(40);
    setInput(input, 'ПГ-17');
    await wait(120);
    const secondResults = document.querySelectorAll('.district-object-search-row.nppv .district-search-results button').length;
    document.querySelector('.district-object-search-row.nppv .district-search-results button')?.click();
    await wait(50);
    const map = document.querySelector('.map-stage svg');
    map.querySelector('.map-base')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await wait(80);
    const searchClearedAfterMapClick = input.value === '';
    setInput(input, 'ПГ-17');
    await wait(80);
    document.querySelector('.district-object-search-row.nppv .district-search-results button')?.click();
    await wait(50);
    const ruler = document.querySelector('.calculation-ruler-control');
    ruler?.click();
    await wait(80);
    const rulerCursor = getComputedStyle(map).cursor;
    const mapObjectsDisabledDuringRuler = [...document.querySelectorAll('.district-map-marker')].every((marker) => getComputedStyle(marker).pointerEvents === 'none');
    const rect = map.getBoundingClientRect();
    let pointerId = 10;
    for (const [x, y] of [[.4, .45], [.55, .55], [.65, .42]]) {
      pointerId += 1;
      const options = { bubbles: true, button: 0, pointerId, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y };
      map.dispatchEvent(new PointerEvent('pointerdown', options));
      map.dispatchEvent(new PointerEvent('pointerup', options));
      await wait(30);
    }
    await wait(80);
    const rulerSegments = document.querySelectorAll('.map-ruler-overlay line').length;
    const rulerTotalText = document.querySelector('.map-ruler-total')?.textContent?.trim() ?? '';
    const shortRight = { bubbles: true, button: 2, buttons: 2, pointerId: 70, clientX: rect.left + rect.width * .72, clientY: rect.top + rect.height * .62 };
    map.dispatchEvent(new PointerEvent('pointerdown', shortRight));
    await wait(80);
    map.dispatchEvent(new PointerEvent('pointerup', { ...shortRight, buttons: 0 }));
    await wait(60);
    const rulerSegmentsAfterShortRight = document.querySelectorAll('.map-ruler-overlay line').length;
    for (const [x, y] of [[.42, .48], [.57, .58]]) {
      pointerId += 1;
      const options = { bubbles: true, button: 0, pointerId, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y };
      map.dispatchEvent(new PointerEvent('pointerdown', options));
      map.dispatchEvent(new PointerEvent('pointerup', options));
      await wait(30);
    }
    const longRight = { bubbles: true, button: 2, buttons: 2, pointerId: 71, clientX: rect.left + rect.width * .68, clientY: rect.top + rect.height * .62 };
    map.dispatchEvent(new PointerEvent('pointerdown', longRight));
    await wait(380);
    const rulerCursorDuringRightPan = getComputedStyle(map).cursor;
    map.dispatchEvent(new PointerEvent('pointermove', { ...longRight, clientX: longRight.clientX + 55, clientY: longRight.clientY + 30 }));
    await wait(50);
    map.dispatchEvent(new PointerEvent('pointerup', { ...longRight, buttons: 0, clientX: longRight.clientX + 55, clientY: longRight.clientY + 30 }));
    await wait(80);
    const rulerSegmentsAfterRightPan = document.querySelectorAll('.map-ruler-overlay line').length;
    const rulerCursorAfterRightPan = getComputedStyle(map).cursor;
    document.querySelector('.calculate-button')?.click();
    await wait(80);
    const panelClosedAfterCalculation = document.querySelector('.map-tool-stack > .district-object-toolbar') === null;
    [...document.querySelectorAll('.main-tabs button')].find((button) => button.textContent.includes('Карта района выезда'))?.click();
    await wait(120);
    const districtMap = document.querySelector('.district-map-surface > svg');
    const districtRuler = document.querySelector('.district-ruler-control');
    const rulerButtonRect = districtRuler?.getBoundingClientRect();
    const rulerImageRect = districtRuler?.querySelector('img')?.getBoundingClientRect();
    const rulerIconCentered = Boolean(rulerButtonRect && rulerImageRect
      && Math.abs((rulerButtonRect.left + rulerButtonRect.width / 2) - (rulerImageRect.left + rulerImageRect.width / 2)) <= 1
      && Math.abs((rulerButtonRect.top + rulerButtonRect.height / 2) - (rulerImageRect.top + rulerImageRect.height / 2)) <= 1);
    districtRuler?.click();
    await wait(60);
    const districtRect = districtMap.getBoundingClientRect();
    const touch = (type, pointerId, x, y) => districtMap.dispatchEvent(new PointerEvent(type, {
      bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId, pointerType: 'touch',
      clientX: districtRect.left + districtRect.width * x, clientY: districtRect.top + districtRect.height * y,
    }));
    touch('pointerdown', 201, .42, .48);
    touch('pointerup', 201, .42, .48);
    await wait(80);
    const districtRulerPointsAfterTap = districtMap.querySelectorAll('.map-ruler-overlay circle').length;
    const districtZoomBeforePinch = document.querySelector('.district-zoom span')?.textContent ?? '';
    touch('pointerdown', 202, .42, .52);
    touch('pointerdown', 203, .58, .52);
    touch('pointermove', 202, .34, .52);
    touch('pointermove', 203, .66, .52);
    await wait(80);
    touch('pointerup', 202, .34, .52);
    touch('pointerup', 203, .66, .52);
    await wait(100);
    const districtZoomAfterPinch = document.querySelector('.district-zoom span')?.textContent ?? '';
    const districtRulerPointsAfterPinch = districtMap.querySelectorAll('.map-ruler-overlay circle').length;
    touch('pointerdown', 204, .48, .54);
    touch('pointermove', 204, .56, .60);
    touch('pointerup', 204, .56, .60);
    await wait(80);
    const districtRulerPointsAfterDrag = districtMap.querySelectorAll('.map-ruler-overlay circle').length;
    districtRuler?.click();
    await wait(40);
    const boundaryLegend = document.querySelector('.district-legend-boundary') !== null;
    const assLegend = document.querySelector('.district-legend-ass')?.textContent?.trim() === 'АСС';
    const specialCreationRemoved = [...document.querySelectorAll('.district-add-menu button')]
      .every((button) => !button.textContent.includes('граница района выезда') && !button.textContent.includes('объект АСС'));
    const hideAllButton = [...document.querySelectorAll('.district-legend-heading button')]
      .find((button) => button.textContent.includes('всё'));
    const hideAllSingleLine = hideAllButton === undefined || getComputedStyle(hideAllButton).whiteSpace === 'nowrap';
    const unknownHydrantHalf = document.querySelector('.hydrant-marker.status-unknown .hydrant-symbol-half');
    const unknownHydrantColor = unknownHydrantHalf === null ? '' : getComputedStyle(unknownHydrantHalf).fill;
    return {
      firstResults,
      secondResults,
      resultsContained,
      compactSearchWidth,
      clearButtonCentered,
      clearButtonOffset,
      clearButtonGeometry: searchRect && searchInputRect && clearButtonRect ? {
        searchTop: searchRect.top, searchHeight: searchRect.height,
        inputTop: searchInputRect.top, inputHeight: searchInputRect.height,
        buttonTop: clearButtonRect.top, buttonHeight: clearButtonRect.height,
      } : null,
      windLockedToToolbarTop,
      searchClearedAfterMapClick,
      rulerCursor,
      mapObjectsDisabledDuringRuler,
      rulerSegments,
      rulerTotalText,
      unknownHydrantColor,
      rulerSegmentsAfterShortRight,
      rulerSegmentsAfterRightPan,
      rulerCursorDuringRightPan,
      rulerCursorAfterRightPan,
      panelClosedAfterCalculation,
      districtScale: Boolean(document.querySelector('.district-map-scale')),
      districtLegend: Boolean(document.querySelector('.district-map-legend')),
      rulerIconCentered,
      districtRulerPointsAfterTap,
      districtRulerPointsAfterPinch,
      districtRulerPointsAfterDrag,
      boundaryLegend,
      assLegend,
      specialCreationRemoved,
      hideAllSingleLine,
      districtZoomBeforePinch,
      districtZoomAfterPinch,
      oldHintRemoved: document.querySelector('.district-map-hint') === null,
      switchedToSatellite,
      undoRestoredMap,
      redoRestoredSatellite,
    };
  })()`);
  const failures = [];
  if (result.firstResults < 1 || result.secondResults < 1) failures.push('повторный поиск элемента НППВ');
  if (!result.resultsContained || !result.compactSearchWidth) failures.push('компактный поиск внутри общей рамки');
  if (!result.clearButtonCentered) failures.push('крестик очистки не центрирован в строке');
  if (!result.windLockedToToolbarTop) failures.push('панель ветра смещается при раскрытии поиска');
  if (!result.searchClearedAfterMapClick) failures.push('сброс поиска щелчком по карте');
  if (result.rulerSegments !== 2) failures.push('линейка с несколькими точками');
  if ((result.rulerTotalText ?? '').includes('Σ')) failures.push('лишний знак суммы в итоговом расстоянии');
  if (result.unknownHydrantColor !== 'rgb(213, 45, 54)') failures.push('неизвестное состояние ПГ не выделено красным');
  if (result.rulerCursor !== 'crosshair' || !result.mapObjectsDisabledDuringRuler) failures.push('режим линейки поверх объектов');
  if (result.rulerSegmentsAfterShortRight !== 0) failures.push('короткая правая кнопка не сбрасывает линейку');
  if (result.rulerSegmentsAfterRightPan !== 1 || result.rulerCursorDuringRightPan !== 'grabbing' || result.rulerCursorAfterRightPan !== 'crosshair') failures.push('удержание правой кнопки не перемещает карту с сохранением линейки');
  if (!result.panelClosedAfterCalculation) failures.push('автоматическое закрытие панели после расчёта');
  if (!result.districtScale || !result.districtLegend || !result.oldHintRemoved) failures.push('оформление карты района выезда');
  if (!result.rulerIconCentered) failures.push('центрирование значка линейки');
  if (result.districtRulerPointsAfterTap !== 1 || result.districtRulerPointsAfterPinch !== 1 || result.districtRulerPointsAfterDrag !== 1) failures.push('разделение касания, перемещения и жеста линейки');
  if (result.districtZoomBeforePinch === result.districtZoomAfterPinch) failures.push('масштабирование карты района выезда двумя пальцами');
  if (!result.boundaryLegend || !result.assLegend || !result.hideAllSingleLine) failures.push('переключатели границы района и АСС в условных обозначениях');
  if (!result.specialCreationRemoved) failures.push('разовые команды создания границы района и АСС не удалены');
  if (!result.switchedToSatellite || !result.undoRestoredMap || !result.redoRestoredSatellite) failures.push('кнопки назад и вперёд');
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('artifacts/district-map-functional-audit.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) throw new Error(`Не пройдены проверки: ${failures.join(', ')}.`);
  socket.close();
} finally {
  edge.kill();
}
