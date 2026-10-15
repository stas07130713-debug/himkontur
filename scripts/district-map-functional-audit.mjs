import { spawn } from 'node:child_process';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:4178/';
const port = 9760 + Math.floor(Math.random() * 100);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=1366,768', pageUrl,
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
    const input = document.querySelector('.district-object-search-row.hydrant input');
    setInput(input, 'ПГ-53');
    await wait(120);
    const firstResults = document.querySelectorAll('.district-object-search-row.hydrant .district-search-results button').length;
    const toolbarRectWithResults = document.querySelector('.map-tool-stack > .district-object-toolbar')?.getBoundingClientRect();
    const resultsRect = document.querySelector('.district-object-search-row.hydrant .district-search-results')?.getBoundingClientRect();
    const searchRect = document.querySelector('.district-object-search-row.hydrant .district-search')?.getBoundingClientRect();
    const searchInputRect = input?.getBoundingClientRect();
    const clearButtonRect = document.querySelector('.district-object-search-row.hydrant .district-search > button')?.getBoundingClientRect();
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
    document.querySelector('.district-object-search-row.hydrant .district-search-results button')?.click();
    await wait(80);
    document.querySelector('.district-object-search-row.hydrant .district-search > button')?.click();
    await wait(40);
    setInput(input, 'ПГ-14');
    await wait(120);
    const secondResults = document.querySelectorAll('.district-object-search-row.hydrant .district-search-results button').length;
    document.querySelector('.district-object-search-row.hydrant .district-search-results button')?.click();
    await wait(50);
    const map = document.querySelector('.map-stage svg');
    map.querySelector('.map-base')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await wait(80);
    const searchClearedAfterMapClick = input.value === '';
    setInput(input, 'ПГ-53');
    await wait(80);
    document.querySelector('.district-object-search-row.hydrant .district-search-results button')?.click();
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
    const unknownHydrantHalf = document.querySelector('.hydrant-marker.status-unknown .hydrant-symbol-half');
    const unknownHydrantColor = unknownHydrantHalf === null ? '' : getComputedStyle(unknownHydrantHalf).fill;
    document.querySelector('.map-settings-action')?.click();
    await wait(50);
    const password = document.querySelector('.admin-login-dialog input[type="password"]');
    setInput(password, '1234');
    document.querySelector('.admin-login-dialog')?.requestSubmit();
    await wait(100);
    document.querySelector('.district-management-dialog .dialog-close')?.click();
    await wait(80);
    const projectKey = 'himkontur-district-map-project-v1';
    const marker = document.querySelector('.district-map-marker.hydrant-marker');
    const markerRect = marker?.getBoundingClientRect();
    const beforeClickProject = JSON.parse(localStorage.getItem(projectKey));
    if (marker && markerRect) {
      const pointerId = 88;
      const options = { bubbles: true, button: 0, pointerId, clientX: markerRect.left + markerRect.width / 2, clientY: markerRect.top + markerRect.height / 2 };
      marker.dispatchEvent(new PointerEvent('pointerdown', options));
      document.querySelector('.district-map-surface > svg')?.dispatchEvent(new PointerEvent('pointerup', options));
      marker.dispatchEvent(new MouseEvent('click', options));
    }
    await wait(60);
    const afterClickProject = JSON.parse(localStorage.getItem(projectKey));
    const simpleClickDidNotMove = beforeClickProject.revision === afterClickProject.revision;
    const selectedHydrantId = marker?.dataset.objectId ?? '';
    if (marker && markerRect) {
      const pointerId = 89;
      const down = { bubbles: true, button: 0, pointerId, clientX: markerRect.left + markerRect.width / 2, clientY: markerRect.top + markerRect.height / 2 };
      marker.dispatchEvent(new PointerEvent('pointerdown', down));
      document.querySelector('.district-map-surface > svg')?.dispatchEvent(new PointerEvent('pointermove', { ...down, clientX: down.clientX + 22, clientY: down.clientY + 16 }));
      document.querySelector('.district-map-surface > svg')?.dispatchEvent(new PointerEvent('pointerup', { ...down, clientX: down.clientX + 22, clientY: down.clientY + 16 }));
    }
    await wait(120);
    const afterDragProject = JSON.parse(localStorage.getItem(projectKey));
    const draggedHydrant = afterDragProject.draft.find((object) => object.id === selectedHydrantId);
    const dragWritesCoordinateJournal = draggedHydrant?.note?.includes('«Координаты объекта»') === true && afterDragProject.revision > afterClickProject.revision;
    const building = document.querySelector('.district-map-marker.building-number-marker');
    building?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await wait(50);
    [...document.querySelectorAll('.district-details-actions button')].find((button) => button.textContent.includes('Редактировать'))?.click();
    await wait(80);
    const emptyPlanningDocuments = document.querySelectorAll('.planning-document-fields .repeatable-row').length === 0;
    document.querySelector('.planning-document-fields legend button')?.click();
    await wait(30);
    const planningDocumentAddedByPlus = document.querySelectorAll('.planning-document-fields .repeatable-row').length === 1;
    const planningFieldsetRect = document.querySelector('.planning-document-fields')?.getBoundingClientRect();
    const planningRowRect = document.querySelector('.planning-document-fields .repeatable-row')?.getBoundingClientRect();
    const planningControlsFit = Boolean(planningFieldsetRect && planningRowRect
      && planningRowRect.left >= planningFieldsetRect.left
      && planningRowRect.right <= planningFieldsetRect.right);
    document.querySelector('.district-object-editor .dialog-close')?.click();
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
      oldHintRemoved: document.querySelector('.district-map-hint') === null,
      switchedToSatellite,
      undoRestoredMap,
      redoRestoredSatellite,
      simpleClickDidNotMove,
      dragWritesCoordinateJournal,
      selectedHydrantId,
      draggedHydrantNote: draggedHydrant?.note ?? '',
      revisionAfterClick: afterClickProject.revision,
      revisionAfterDrag: afterDragProject.revision,
      emptyPlanningDocuments,
      planningDocumentAddedByPlus,
      planningControlsFit,
    };
  })()`);
  const failures = [];
  if (result.firstResults < 1 || result.secondResults < 1) failures.push('повторный поиск ПГ');
  if (!result.resultsContained || !result.compactSearchWidth) failures.push('компактный поиск внутри общей рамки');
  if (!result.clearButtonCentered) failures.push('крестик очистки не центрирован в строке');
  if (!result.windLockedToToolbarTop) failures.push('панель ветра смещается при раскрытии поиска');
  if (!result.searchClearedAfterMapClick) failures.push('сброс поиска щелчком по карте');
  if (result.rulerSegments !== 2) failures.push('линейка с несколькими точками');
  if (result.rulerTotalText.includes('Σ')) failures.push('лишний знак суммы в итоговом расстоянии');
  if (result.unknownHydrantColor !== 'rgb(213, 45, 54)') failures.push('неизвестное состояние ПГ не выделено красным');
  if (result.rulerCursor !== 'crosshair' || !result.mapObjectsDisabledDuringRuler) failures.push('режим линейки поверх объектов');
  if (result.rulerSegmentsAfterShortRight !== 0) failures.push('короткая правая кнопка не сбрасывает линейку');
  if (result.rulerSegmentsAfterRightPan !== 1 || result.rulerCursorDuringRightPan !== 'grabbing' || result.rulerCursorAfterRightPan !== 'crosshair') failures.push('удержание правой кнопки не перемещает карту с сохранением линейки');
  if (!result.panelClosedAfterCalculation) failures.push('автоматическое закрытие панели после расчёта');
  if (!result.districtScale || !result.districtLegend || !result.oldHintRemoved) failures.push('оформление карты района выезда');
  if (!result.switchedToSatellite || !result.undoRestoredMap || !result.redoRestoredSatellite) failures.push('кнопки назад и вперёд');
  if (!result.simpleClickDidNotMove || !result.dragWritesCoordinateJournal) failures.push('безопасное перемещение и журнал координат');
  if (!result.emptyPlanningDocuments || !result.planningDocumentAddedByPlus || !result.planningControlsFit) failures.push('добавление документов только через плюс без выхода за карточку');
  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) throw new Error(`Не пройдены проверки: ${failures.join(', ')}.`);
  socket.close();
} finally {
  edge.kill();
}
