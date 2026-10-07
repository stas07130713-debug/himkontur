import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pageUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const port = 9231;
const windowSize = process.env.ACCEPTANCE_WINDOW ?? '1920,1080';
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const downloadDirectory = resolve('artifacts', 'acceptance-downloads');
const edgeProfileDirectory = resolve('..', '.test-runtime', `acceptance-edge-profile-${windowSize.replace(',', 'x')}-${process.pid}`);
const ocrFixtureDataUrl = process.env.OCR_FIXTURE_PATH === undefined ? '' : `data:image/png;base64,${readFileSync(process.env.OCR_FIXTURE_PATH).toString('base64')}`;
const ocrExpectedPairs = (process.env.OCR_EXPECTED ?? '30/1202').split(',');
mkdirSync(downloadDirectory, { recursive: true });
const edge = spawn(edgePath, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--window-size=${windowSize}`, `--user-data-dir=${edgeProfileDirectory}`, '--hide-scrollbars',
  ...(process.env.SIMULATE_ELECTRON === '1' ? ['--user-agent=Mozilla/5.0 Windows Electron/44.3.0'] : []), pageUrl
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 30 && target === undefined; attempt += 1) {
    await delay(300);
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page' && item.url.startsWith(pageUrl));
    } catch {
      // Edge may still be starting.
    }
  }
  if (target?.webSocketDebuggerUrl === undefined) throw new Error('Browser target was not created.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (handler === undefined) return;
    pending.delete(message.id);
    handler(message);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 180_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error !== undefined) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  await command('Runtime.enable');
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory });
  await delay(3500);
  const results = await evaluate(`(async () => {
    const checks = [];
    const check = (name, condition, detail = '') => checks.push({ name, passed: Boolean(condition), detail });
    const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickByText = (selector, text) => {
      const item = [...document.querySelectorAll(selector)].find((element) => element.textContent?.includes(text));
      if (!(item instanceof HTMLElement)) throw new Error('Not found: ' + text);
      item.click();
      return item;
    };
    const setInput = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    check('three-column layout', document.querySelector('.left-column') && document.querySelector('.map-column') && document.querySelector('.right-column'));
    check('six standard source templates', document.querySelectorAll('.source-card').length === 6, String(document.querySelectorAll('.source-card').length));
    check('pipeline replaces the process installation', document.querySelector('.source-palette')?.textContent?.includes('Хлорный трубопровод') && !document.querySelector('.source-palette')?.textContent?.includes('Технологическая установка'));
    check('standard source cards show operational defaults', document.querySelector('.source-palette')?.textContent?.includes('54 т · 43,46 м³') && document.querySelector('.source-palette')?.textContent?.includes('2 × 26 т · 2 × 20,93 м³') && document.querySelector('.source-palette')?.textContent?.includes('60 л'));
    check('source cards moved into the left input sequence', document.querySelector('.left-column .source-palette') !== null && document.querySelector('.right-column .source-palette') === null);
    check('results moved into the right panel', document.querySelector('.right-column .results') !== null && document.querySelector('.left-column .results') === null);
    document.querySelector('.source-editor summary')?.click(); await wait();
    const sourceVolume = [...document.querySelectorAll('.source-editor label')].find((label) => label.textContent?.startsWith('Объём'))?.querySelector('input');
    if (sourceVolume instanceof HTMLInputElement) { setInput(sourceVolume, ''); await wait(); }
    check('source numeric fields can be fully cleared before entering a replacement', sourceVolume instanceof HTMLInputElement && sourceVolume.value === '', sourceVolume instanceof HTMLInputElement ? sourceVolume.value : 'missing');
    if (sourceVolume instanceof HTMLInputElement) setInput(sourceVolume, '10');
    const restoreSourceButton = [...document.querySelectorAll('.source-default-row button')].find((button) => button.textContent?.trim() === 'Вернуть стандартные значения');
    check('source editor stays open while a numeric field is replaced', restoreSourceButton instanceof HTMLButtonElement, document.querySelector('.source-section')?.textContent ?? 'missing source section');
    restoreSourceButton?.click(); await wait();
    const restoredVolume = [...document.querySelectorAll('.source-editor label')].find((label) => label.textContent?.startsWith('Объём'))?.querySelector('input');
    check('source card can restore its standard values', restoredVolume instanceof HTMLInputElement && Number(restoredVolume.value) === 43.46, restoredVolume instanceof HTMLInputElement ? restoredVolume.value : '');
    document.querySelector('.source-editor summary')?.click(); await wait();
    document.querySelector('.source-selector summary')?.click(); await wait();
    clickByText('.source-dropdown-options button', 'ЖД контейнеры'); await wait();
    const containerChecks = [...document.querySelectorAll('.container-unit-selector input')];
    check('rail containers have two independent selectors', containerChecks.length === 2 && containerChecks.every((item) => item.checked));
    containerChecks[1]?.click(); await wait();
    const scenarioMass = [...document.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Масса вещества, т'))?.querySelector('input');
    check('one selected rail container gives 26 tonnes', scenarioMass instanceof HTMLInputElement && Number(scenarioMass.value) === 26, scenarioMass instanceof HTMLInputElement ? scenarioMass.value : '');
    containerChecks[1]?.click(); await wait();
    document.querySelector('.source-selector summary')?.click(); await wait();
    clickByText('.source-dropdown-options button', 'ЖД цистерна'); await wait();
    document.querySelector('.source-selector summary')?.click(); await wait();
    clickByText('.source-dropdown-options button', 'Хлорный трубопровод'); await wait();
    document.querySelector('.source-editor summary')?.click(); await wait();
    check('chlorine pipeline card calculates volume from isolated length and diameter', document.querySelector('.source-editor')?.textContent?.includes('Длина трубопровода между задвижками') && document.querySelector('.source-editor')?.textContent?.includes('Внутренний диаметр трубопровода') && document.querySelector('.source-editor')?.textContent?.includes('Расчётный объём трубопровода'));
    document.querySelector('.source-editor summary')?.click();
    document.querySelector('.source-selector summary')?.click(); await wait();
    clickByText('.source-dropdown-options button', 'ЖД цистерна'); await wait();
    check('substance is selected once before the source parameters', document.querySelectorAll('.substance-picker-button').length === 1, String(document.querySelectorAll('.substance-picker-button').length));
    check('source dropdown uses image previews', document.querySelectorAll('.source-dropdown-options .source-photo').length === 6);
    document.querySelector('.substance-picker-button')?.click(); await wait();
    check('every substance in the picker has a formula icon', document.querySelectorAll('.substance-options button').length === 35 && [...document.querySelectorAll('.substance-options button > span')].every((item) => item.textContent !== 'АХ'));
    document.querySelector('.substance-picker-button')?.click(); await wait();
    check('control templates use colored building SVG icons', document.querySelectorAll('.control-template-grid .building-icon').length === 3);
    check('people count input is removed', !document.querySelector('.control-palette')?.textContent?.includes('Количество людей'));
    check('top file actions use design icons', [...document.querySelectorAll('.file-actions button:not(.history-action):not(.theme-switch button)')].every((button) => button.querySelector('.ui-mini-icon') !== null));
    check('large browser-style work tabs are present', document.querySelector('.main-tabs')?.textContent?.includes('Расчёт АХОВ') && document.querySelector('.main-tabs')?.textContent?.includes('Опасный груз'));
    check('top bar contains only the requested calculation actions', (() => { const text = document.querySelector('.topbar')?.textContent ?? ''; return text.includes('Новый расчёт') && !text.includes('Сообщить об ошибке') && !text.includes('Открыть расчёт') && !text.includes('Сохранить расчёт') && document.querySelector('.mobile-access-action') !== null && document.querySelector('.feedback-action') === null; })());
    check('Windows title buttons do not overlap the application toolbar', !navigator.userAgent.includes('Electron') || (() => { const actions = document.querySelector('.file-actions'); const visibleButtons = [...document.querySelectorAll('.file-actions > button')].filter((button) => button.getBoundingClientRect().width > 0); const box = actions?.getBoundingClientRect(); return visibleButtons.length === 4 && Boolean(box) && box.left >= 0 && box.right <= innerWidth + 1; })());
    check('input section numbering is removed', document.querySelector('.numbered-section-title') === null && document.querySelector('.numbered-input-title') === null);
    document.querySelector('button[title="Тёмная тема"]')?.click(); await wait();
    check('dark theme can be enabled', document.querySelector('.app-shell')?.getAttribute('data-theme') === 'dark');
    document.querySelector('button[title="Светлая тема"]')?.click(); await wait();
    check('single-source mode has no source count selector', document.querySelector('.source-count') === null);
    check('legend hides unused objects', !document.querySelector('.map-legend')?.textContent?.includes('КПП'));
    check('starts with clean result and a movable accident point', document.querySelector('.main-result') === null && document.querySelector('.result-placeholder') !== null && document.querySelector('.source-marker') !== null);
    const stage = document.querySelector('.map-stage');
    const dropTemplate = async (button, xRatio, yRatio) => {
      const currentStage = document.querySelector('.map-stage');
      if (!(button instanceof HTMLElement) || !(currentStage instanceof HTMLElement)) return false;
      const dataTransfer = new DataTransfer();
      button.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      const rect = currentStage.getBoundingClientRect();
      const clientX = rect.left + rect.width * xRatio;
      const clientY = rect.top + rect.height * yRatio;
      const map = document.querySelector('.map-stage svg');
      map?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX, clientY, dataTransfer }));
      map?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX, clientY, dataTransfer }));
      await wait(180);
      return true;
    };
    window.confirm = () => true;
    await dropTemplate(document.querySelector('.source-card'), 0.5, 0.5);
    check('source remains singular after drag-and-drop', document.querySelectorAll('.source-marker').length === 1);
    check('objects are movable before the first calculation', !document.querySelector('.source-lock')?.classList.contains('locked'));
    check('selected source is not duplicated below its selector', document.querySelector('.selected-source-mini') === null);
    check('the 1.25 vessel coefficient is hidden from the main fields', !document.querySelector('.source-core-parameters')?.textContent?.includes('1,25'));
    check('the 1.25 vessel coefficient remains in additional source parameters', document.querySelector('.source-editor')?.textContent?.includes('1,25'));
    const massBeforePlus = Number(scenarioMass?.value);
    document.querySelector('button[aria-label="Увеличить массу на 0,01 т"]')?.click(); await wait();
    check('custom mass increment button works', Number(scenarioMass?.value) === Number((massBeforePlus + .01).toFixed(2)), String(scenarioMass?.value));
    clickByText('button', 'Рассчитать'); await wait(250);
    check('first calculation by command', Number.isFinite(Number.parseFloat((document.querySelector('.main-result strong')?.textContent ?? '').replace(',', '.'))), document.querySelector('.main-result')?.textContent ?? '');
    check('the first calculation locks map objects', document.querySelector('.source-lock')?.classList.contains('locked'));
    { const panel = document.querySelector('.left-column'); const button = document.querySelector('.calculate-button'); const panelBox = panel?.getBoundingClientRect(); const buttonBox = button?.getBoundingClientRect(); check('left input reaches the calculate action without scrolling at the desktop viewport', Boolean(panelBox && buttonBox && buttonBox.bottom <= panelBox.bottom + 1 && panel.scrollHeight <= panel.clientHeight + 1), panelBox && buttonBox ? Math.round(buttonBox.bottom) + ' <= ' + Math.round(panelBox.bottom) + '; ' + panel.scrollHeight + '/' + panel.clientHeight : 'missing'); }
    check('automatic verification', document.querySelector('.verify-badge')?.textContent?.includes('Проверено автоматически'));
    check('wind uses meteorological name', document.querySelector('.toolbar-wind-summary')?.textContent?.includes('Западный ветер') && !document.querySelector('.toolbar-wind-summary')?.textContent?.includes('→'), document.querySelector('.toolbar-wind-summary')?.textContent ?? '');
    check('wind is not hidden behind plume layer controls', (() => { const a = document.querySelector('.toolbar-wind-summary')?.getBoundingClientRect(); const b = document.querySelector('.layer-toggles')?.getBoundingClientRect(); return a && b && (a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top); })());
    check('compass matches the circular needle design', document.querySelector('.compass-disc') !== null && document.querySelector('.compass-north') !== null && document.querySelector('.compass-south') !== null && document.querySelector('.compass-star') === null);
    check('lock control is a compact colored icon', (() => { const lock = document.querySelector('.source-lock'); return lock && lock.clientWidth <= 50 && getComputedStyle(lock).boxShadow !== 'none'; })());
    check('return control is a centered accident-marker button', (() => { const button = document.querySelector('.source-focus'); return button && getComputedStyle(button).borderRadius === '50%' && button.clientWidth === button.clientHeight; })());
    check('right map controls are ordered compass, rotation, zoom, return, lock', (() => { const compass = document.querySelector('.compass-rose')?.getBoundingClientRect(); const rotation = document.querySelector('.rotation-controls')?.getBoundingClientRect(); const zoom = document.querySelector('.zoom')?.getBoundingClientRect(); const focus = document.querySelector('.source-focus')?.getBoundingClientRect(); const lock = document.querySelector('.source-lock')?.getBoundingClientRect(); return compass && rotation && zoom && focus && lock && compass.top < rotation.top && rotation.top < zoom.top && zoom.top < focus.top && focus.top < lock.top; })());
    check('map fills central pane', (() => { const a = document.querySelector('.map-stage'); const b = document.querySelector('.map-surface'); return a && b && Math.abs(a.clientWidth-b.clientWidth)<2 && Math.abs(a.clientHeight-b.clientHeight)<2; })());
    check('page not zoomed', visualViewport?.scale === 1, String(visualViewport?.scale));
    check('no horizontal overflow', document.documentElement.scrollWidth <= innerWidth + 1, document.documentElement.scrollWidth + '/' + innerWidth);

    const zoomBefore = document.querySelector('.zoom span')?.textContent;
    const markerBeforeCursorZoom = document.querySelector('.source-marker')?.getAttribute('transform');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    stage?.dispatchEvent(wheel);
    await wait();
    check('wheel belongs to map', wheel.defaultPrevented && document.querySelector('.zoom span')?.textContent !== zoomBefore, zoomBefore + ' -> ' + document.querySelector('.zoom span')?.textContent);
    check('wheel zoom is anchored at cursor instead of source', document.querySelector('.source-marker')?.getAttribute('transform') !== markerBeforeCursorZoom);
    check('page scale unchanged after wheel', visualViewport?.scale === 1, String(visualViewport?.scale));
    document.querySelector('.source-focus')?.click(); await wait();
    check('return button centers and zooms to the accident point', (() => { const source = document.querySelector('.source-marker > circle.source-hit-area')?.getBoundingClientRect(); const map = document.querySelector('.map-stage')?.getBoundingClientRect(); return source && map && Math.abs((source.left + source.right) / 2 - (map.left + map.right) / 2) < 5 && Math.abs((source.top + source.bottom) / 2 - (map.top + map.bottom) / 2) < 5 && document.querySelector('.zoom span')?.textContent === '300%'; })());
    const markerBeforeZoomCycle = document.querySelector('.source-marker')?.getAttribute('transform');
    document.querySelector('.zoom button[aria-label="Увеличить карту"]')?.click(); await wait(80);
    document.querySelector('.zoom button[aria-label="Уменьшить карту"]')?.click(); await wait(80);
    check('source marker returns to the exact pixel after a zoom cycle', document.querySelector('.source-marker')?.getAttribute('transform') === markerBeforeZoomCycle, markerBeforeZoomCycle + ' -> ' + document.querySelector('.source-marker')?.getAttribute('transform'));

    const sourceBefore = document.querySelector('.source-marker')?.getAttribute('transform');
    stage?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 800, clientY: 500 }));
    await wait();
    check('plain map click does not move source', document.querySelector('.source-marker')?.getAttribute('transform') === sourceBefore);

    const primaryToggle = [...document.querySelectorAll('.layer-toggles label')].find((element) => element.textContent?.includes('Первичное'))?.querySelector('input');
    primaryToggle?.click(); await wait();
    check('primary layer can be hidden', document.querySelector('.primary-plume') === null && document.querySelector('.plume-band-primary') === null);
    primaryToggle?.click(); await wait();
    check('primary layer can be restored', document.querySelector('.primary-plume') !== null && document.querySelector('.plume-band-primary') !== null);

    const markerBeforeBasemapSwitch = document.querySelector('.source-marker')?.getAttribute('transform');
    clickByText('.segmented button', 'Карта'); await wait(500);
    check('basemap switches', document.querySelector('.segmented button.active')?.textContent?.includes('Карта'));
    clickByText('.segmented button', 'Спутник'); await wait(300);
    check('one rendering canvas owns both basemaps', document.querySelectorAll('.offline-vector-map canvas').length === 1 && document.querySelector('.basemap-tile-layer') === null);
    check('source marker stays registered while switching basemaps', document.querySelector('.source-marker')?.getAttribute('transform') === markerBeforeBasemapSwitch);
    clickByText('.segmented button', 'Карта'); await wait(300);
    check('source marker stays registered after returning to the offline map', document.querySelector('.source-marker')?.getAttribute('transform') === markerBeforeBasemapSwitch);
    clickByText('.segmented button', 'Спутник'); await wait(300);

    const rotatable = document.querySelector('.map-rotatable');
    const rotationBefore = rotatable?.style.transform;
    document.querySelector('button[title="Повернуть карту на 15° по часовой стрелке"]')?.click(); await wait();
    check('map rotation works', rotatable?.style.transform !== rotationBefore && rotatable?.style.transform.includes('15deg'), rotatable?.style.transform ?? '');
    check('rotation scales the canvas to cover corners', (() => { const transform = rotatable?.style.transform ?? ''; const scale = Number(transform.split('scale(')[1]?.split(')')[0]); return scale > 1; })(), rotatable?.style.transform ?? '');
    document.querySelector('button[title="Сбросить поворот: север вверх"]')?.click(); await wait();
    check('north-up reset works', rotatable?.style.transform.includes('0deg'), rotatable?.style.transform ?? '');

    const windInput = [...document.querySelectorAll('label')].find((element) => element.textContent?.startsWith('Ветер, м/с'))?.querySelector('input');
    const depthBefore = document.querySelector('.main-result strong')?.textContent;
    if (windInput instanceof HTMLInputElement) setInput(windInput, '10');
    await wait(250);
    check('wind recalculates immediately', document.querySelector('.main-result strong')?.textContent !== depthBefore, depthBefore + ' -> ' + document.querySelector('.main-result strong')?.textContent);
    check('high wind selects isothermy automatically', document.querySelector('.stability-auto')?.textContent?.includes('изотермия'));
    check('stability has no manual selector', ![...document.querySelectorAll('label')].some((element) => element.textContent?.startsWith('Устойчивость')));
    check('cloud cover uses two categories without a table reference in the compact label', (() => { const label = [...document.querySelectorAll('label')].find((element) => element.textContent?.startsWith('Облачность')); return label?.querySelectorAll('option').length === 2 && !label.textContent?.includes('таблица'); })());

    await dropTemplate([...document.querySelectorAll('.source-card')].find((button) => button.textContent?.includes('Стационарный танк')), 0.48, 0.48);
    check('source drag-and-drop', document.querySelector('.source-marker')?.textContent?.includes('Стационарный танк'));
    check('source template updates mass', Number(scenarioMass?.value) > 49 && Number(scenarioMass?.value) < 50);
    await dropTemplate(document.querySelector('.control-template-grid button'), 0.56, 0.5);
    check('control point drag-and-drop', document.querySelectorAll('.control-marker').length === 1, String(document.querySelectorAll('.control-marker').length));
    check('control palette uses a vertical icon list', (() => { const items = [...document.querySelectorAll('.control-template-grid button')]; return items.length === 3 && items.every((item, index) => index === 0 || item.getBoundingClientRect().top > items[index - 1].getBoundingClientRect().top); })());
    check('control point uses the rendered building with a blue movable point and no building-name caption', document.querySelector('.control-marker .map-building-image')?.getAttribute('href')?.includes('administrative-v4.png') && document.querySelector('.control-marker .control-point-dot') !== null && document.querySelector('.control-marker .control-name-label') === null);
    check('checkpoint and evacuation tools are removed', document.querySelector('.exit-template') === null && document.querySelector('.evacuation-route') === null && document.querySelector('.evacuation-advice') === null);
    check('placed control row shows its name and status inside the same control-point panel', document.querySelector('.control-palette .placed-control-row strong')?.textContent?.includes('Административное здание') && (document.querySelector('.control-palette .placed-control-row small')?.textContent?.includes('зоне') || document.querySelector('.control-palette .placed-control-row small')?.textContent?.includes('расчёта')) && document.querySelector('.right-column > .controls-list') === null);
    document.querySelector('.control-marker')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await wait();
    check('right click opens object menu', document.querySelector('.map-context-menu')?.textContent?.includes('Удалить'));
    clickByText('.map-context-menu button', 'Удалить'); await wait();
    check('context menu deletes selected object', document.querySelectorAll('.control-marker').length === 0, String(document.querySelectorAll('.control-marker').length));
    for (let index = 0; index < 3; index += 1) await dropTemplate(document.querySelector('.control-template-grid button'), .46 + index * .025, .48 + index * .025);
    check('three placed points remain accessible without scrolling the whole right panel', (() => { const column = document.querySelector('.right-column'); const list = document.querySelector('.inline-controls-list'); const rows = [...document.querySelectorAll('.placed-control-row')]; const last = rows.at(-1)?.getBoundingClientRect(); const bounds = list?.getBoundingClientRect(); const fits = Boolean(last && bounds && last.bottom <= bounds.bottom + 1); const independentlyScrollable = Boolean(list && getComputedStyle(list).overflowY === 'auto' && list.scrollHeight > list.clientHeight); return rows.length === 3 && column && list && column.scrollHeight <= column.clientHeight + 1 && (fits || independentlyScrollable); })(), (() => { const column = document.querySelector('.right-column'); const list = document.querySelector('.inline-controls-list'); return (column ? column.scrollHeight + '/' + column.clientHeight : 'missing') + '; ' + (list ? list.scrollHeight + '/' + list.clientHeight : 'missing'); })());
    await dropTemplate(document.querySelector('.control-template-grid button'), .54, .56);
    check('four placed points stay visible or scroll inside their own list', (() => { const column = document.querySelector('.right-column'); const list = document.querySelector('.inline-controls-list'); const rows = [...document.querySelectorAll('.placed-control-row')]; const last = rows.at(-1)?.getBoundingClientRect(); const bounds = list?.getBoundingClientRect(); const fits = Boolean(last && bounds && last.bottom <= bounds.bottom + 1); const independentlyScrollable = Boolean(list && getComputedStyle(list).overflowY === 'auto' && list.scrollHeight > list.clientHeight); return rows.length === 4 && column && list && column.scrollHeight <= column.clientHeight + 1 && (fits || independentlyScrollable); })());
    clickByText('.inline-controls-list button', 'Очистить'); await wait();
    const contextRect = document.querySelector('.map-stage')?.getBoundingClientRect();
    document.querySelector('.map-stage svg')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: contextRect ? contextRect.left + contextRect.width * .72 : 900, clientY: contextRect ? contextRect.top + contextRect.height * .72 : 650 })); await wait();
    const quickControlSelect = document.querySelector('.add-control-menu select');
    if (quickControlSelect instanceof HTMLSelectElement) { quickControlSelect.value = 'industrial'; quickControlSelect.dispatchEvent(new Event('change', { bubbles: true })); }
    clickByText('.add-control-menu button', 'Добавить'); await wait();
    check('right click on map adds a selected control type', document.querySelector('.control-marker.control-industrial') !== null);
    document.querySelector('.control-marker')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await wait();
    clickByText('.map-context-menu button', 'Удалить'); await wait();

    const forecastHours = document.querySelector('input[aria-label="Часы прогноза"]');
    const forecastMinutes = document.querySelector('input[aria-label="Минуты прогноза"]');
    if (forecastHours instanceof HTMLInputElement) setInput(forecastHours, '');
    if (forecastMinutes instanceof HTMLInputElement) setInput(forecastMinutes, '');
    await wait();
    check('forecast hour and minute fields can be cleared before entering a new value', forecastHours?.value === '' && forecastMinutes?.value === '', forecastHours?.value + ':' + forecastMinutes?.value);
    if (forecastHours instanceof HTMLInputElement) setInput(forecastHours, '0');
    if (forecastMinutes instanceof HTMLInputElement) setInput(forecastMinutes, '60');
    await wait();
    check('forecast minutes roll over to the next hour', forecastHours?.value === '1' && forecastMinutes?.value === '0', forecastHours?.value + ':' + forecastMinutes?.value);
    if (forecastHours instanceof HTMLInputElement) setInput(forecastHours, '0');
    await wait();
    check('forecast hour decrement borrows 59 minutes', forecastHours?.value === '0' && forecastMinutes?.value === '59', forecastHours?.value + ':' + forecastMinutes?.value);
    if (forecastHours instanceof HTMLInputElement) setInput(forecastHours, '0');
    if (forecastMinutes instanceof HTMLInputElement) setInput(forecastMinutes, '2');
    await wait(250);
    const numericKm = (element) => Number.parseFloat((element?.textContent ?? '').replace(',', '.'));
    const finalKm = numericKm(document.querySelector('.main-result strong'));
    const componentKm = [...document.querySelectorAll('.cloud-result.primary strong, .cloud-result.secondary strong')].map(numericKm);
    check('short-horizon clouds respect transfer limit', componentKm.length === 2 && componentKm.every((value) => value <= finalKm + 0.011), componentKm.join('/') + ' <= ' + finalKm);
    check('B.11 detail is kept out of the operational result panel', document.querySelector('.right-column .depth-decision') === null && !document.querySelector('.right-column')?.textContent?.includes('max(Г1'));
    check('possible area and evaporation share one compact row', (() => { const items = [...document.querySelectorAll('.metric-result-row article')]; return items.length === 2 && Math.abs(items[0].getBoundingClientRect().top - items[1].getBoundingClientRect().top) < 2; })());
    const bands = [...document.querySelectorAll('.plume-band')].map((band) => ({ from: Number(band.dataset.fromKm), to: Number(band.dataset.toKm), fill: getComputedStyle(band).fill }));
    check('shape bands do not overlap', bands.length > 0 && bands.every((band, index) => index === 0 ? band.from === 0 : Math.abs(band.from - bands[index - 1].to) < 1e-8), JSON.stringify(bands));
    check('shape bands have deterministic fills', new Set(bands.map((band) => band.fill)).size === bands.length, bands.map((band) => band.fill).join('/'));
    check('final calculated boundary is shown separately', document.querySelector('.final-plume-outline') !== null && bands.every((band) => band.to <= finalKm + 0.011));
    check('full calculated zone has its own blue fill', document.querySelector('.plume-band-combined') !== null && getComputedStyle(document.querySelector('.plume-band-combined')).fill !== 'none');
    check('map cloud colors are red, yellow and blue', (() => { const sample = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sample.style.position = 'fixed'; sample.style.visibility = 'hidden'; sample.innerHTML = '<path class="plume-band-primary"/><path class="plume-band-secondary"/><path class="plume-band-combined"/>'; document.body.append(sample); const [primaryElement, secondaryElement, fullElement] = sample.querySelectorAll('path'); const primary = getComputedStyle(primaryElement).fill; const secondary = getComputedStyle(secondaryElement).fill; const full = getComputedStyle(fullElement).fill; sample.remove(); return primary.includes('223, 79, 77') && secondary.includes('242, 210, 59') && full.includes('60, 173, 209'); })());
    check('plume zones use disjoint fills without an overlap colour', document.querySelector('.plume-band-overlap') === null && [...document.querySelectorAll('.plume-band')].every((band, index, bands) => index === 0 || Number(band.dataset.fromKm) >= Number(bands[index - 1].dataset.toKm) - 1e-9));
    check('cloud band fills do not draw duplicate internal red contours', [...document.querySelectorAll('.plume-band')].every((band) => getComputedStyle(band).stroke === 'none'));
    check('legend uses sector symbols matching the map', document.querySelectorAll('.map-legend .legend-sector').length >= 3);
    check('legend uses the exact red accident marker and stays bottom-right without a frame', (() => { const legend = document.querySelector('.map-legend'); const stage = document.querySelector('.map-stage'); const marker = document.querySelector('.legend-source-marker'); if (!legend || !stage || !marker) return false; const a = legend.getBoundingClientRect(); const b = stage.getBoundingClientRect(); return marker.querySelectorAll('circle').length === 2 && a.left > (b.left + b.right) / 2 && getComputedStyle(legend).borderTopWidth === '0px' && getComputedStyle(legend).backgroundColor === 'rgba(0, 0, 0, 0)'; })());
    check('map area caption is either compact S or adaptively hidden when space is limited', (() => { const label = document.querySelector('.plume-area-labels'); return label === null || (label.textContent?.includes('S =') && !label.textContent?.includes('Sф')); })());
    check('dimension captions are parallel to their lines', document.querySelector('.dimension-depth-label')?.getAttribute('transform')?.includes('rotate(') && document.querySelector('.dimension-width-label')?.getAttribute('transform')?.includes('rotate('));
    check('width caption is centered exactly on its dimension line', (() => { const line = document.querySelector('.dimension-width-line'); const label = document.querySelector('.dimension-width-label'); if (!line || !label) return false; const centerX = (Number(line.getAttribute('x1')) + Number(line.getAttribute('x2'))) / 2; const centerY = (Number(line.getAttribute('y1')) + Number(line.getAttribute('y2'))) / 2; return Math.abs(Number(label.getAttribute('x')) - centerX) < .01 && Math.abs(Number(label.getAttribute('y')) - centerY) < .01; })());

    clickByText('button', 'Проверить расчёт'); await wait();
    check('trace dialog opens', document.querySelector('.trace-dialog') !== null);
    check('trace contains formula and origins', document.querySelector('.trace-dialog table') !== null && document.querySelector('.trace-dialog')?.textContent?.includes('Подстановка'));
    check('trace contains primary and secondary cloud depths', document.querySelector('.trace-dialog')?.textContent?.includes('Глубина зоны заражения первичным облаком Г1') && document.querySelector('.trace-dialog')?.textContent?.includes('Глубина зоны заражения вторичным облаком Г2'));
    check('trace has a dedicated explanation column for calculated coefficients', document.querySelector('.trace-dialog')?.textContent?.includes('Расчёт / пояснение') && document.querySelector('.trace-dialog')?.textContent?.includes('K7'));
    document.querySelector('.trace-dialog .icon-button')?.click(); await wait();
    check('trace dialog closes', document.querySelector('.trace-dialog') === null);
    check('chemical reference badge is removed from the map', document.querySelector('.map-result-summary') === null && document.querySelector('.map-chemical-link') === null);
    check('left panel has the substance information action instead of the normative source line', document.querySelector('.substance-info-button') !== null && document.querySelector('.normative-source') === null);
    document.querySelector('.substance-info-button')?.click(); await wait(350);
    check('substance information action opens the dangerous goods reference', document.querySelector('.goods-page') !== null && document.querySelector('.goods-search-box input')?.value === '1017');
    clickByText('.topbar nav button', 'Расчёт АХОВ'); await wait();

    check('operations do not show popup notices', document.querySelector('.notice') === null);
    check('undo is available after edits', !document.querySelector('.file-actions .history-action')?.disabled);
    const historyButtons = [...document.querySelectorAll('.file-actions .history-action')];
    check('undo and redo keep the original arrow design', historyButtons.length === 2 && historyButtons[0]?.textContent?.trim() === '↶' && historyButtons[1]?.textContent?.trim() === '↷');
    check('disabled history buttons never show the loading cursor', historyButtons.every((button) => !['wait', 'progress'].includes(getComputedStyle(button).cursor)));
    historyButtons[0]?.click(); await wait();
    check('undo completes immediately and enables redo', !historyButtons[1]?.disabled);
    historyButtons[1]?.click(); await wait();
    check('redo completes immediately and restores undo availability', !historyButtons[0]?.disabled);
    const accidentDate = [...document.querySelectorAll('.date-time-grid label')].find((label) => label.textContent?.startsWith('Дата'))?.querySelector('input');
    const accidentTime = [...document.querySelectorAll('.date-time-grid label')].find((label) => label.textContent?.startsWith('Время'))?.querySelector('input');
    if (accidentDate instanceof HTMLInputElement) setInput(accidentDate, '2026-01-12');
    if (accidentTime instanceof HTMLInputElement) setInput(accidentTime, '15:26');
    clickByText('.weather-actions button', 'Получить автоматически');
    for (let attempt = 0; attempt < 60 && document.querySelector('.weather-error') === null; attempt += 1) {
      const currentTemperature = [...document.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Температура'))?.querySelector('input');
      if (document.querySelector('.origin')?.textContent?.includes('архив') && currentTemperature instanceof HTMLInputElement && Number(currentTemperature.value) < 0) break;
      await wait(150);
    }
    const historicalTemperature = [...document.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Температура'))?.querySelector('input');
    check('historical weather uses the entered accident date and archive endpoint', document.querySelector('.origin')?.textContent?.includes('архив') && historicalTemperature instanceof HTMLInputElement && Number(historicalTemperature.value) < 0, (document.querySelector('.origin')?.textContent ?? '') + '; ' + (historicalTemperature instanceof HTMLInputElement ? historicalTemperature.value : '') + '; ' + (document.querySelector('.weather-error')?.textContent ?? ''));
    if (historicalTemperature instanceof HTMLInputElement) setInput(historicalTemperature, '-12'); await wait();
    check('editing an automatically loaded weather field changes provenance to manual', [...document.querySelectorAll('.input-block-title')].find((item) => item.textContent?.includes('Метеоусловия'))?.textContent?.toLocaleLowerCase('ru-RU').includes('вручную'));
    await dropTemplate(document.querySelector('.control-template-grid button'), 0.58, 0.52);
    const reportViewState = {
      rotatable: document.querySelector('.map-rotatable')?.style.transform,
      source: document.querySelector('.source-marker')?.getAttribute('transform'),
      zoom: document.querySelector('.zoom span')?.textContent
    };
    check('report map uses one MapLibre canvas and an approved basemap with an offline fallback', (() => { const source = document.querySelector('.offline-vector-map')?.dataset.tileSource ?? ''; return document.querySelectorAll('.offline-vector-map canvas').length === 1 && document.querySelector('.basemap-tile-layer') === null && ['local-vector-pmtiles', 'online-detail-with-local-satellite-fallback'].includes(source); })(), document.querySelector('.offline-vector-map')?.dataset.tileSource ?? 'missing');
    clickByText('.result-actions button', 'Сформировать отчёт'); await wait();
    check('report offers PDF and Word instead of printing', document.querySelector('.report-choice')?.textContent?.includes('PDF') && document.querySelector('.report-choice')?.textContent?.includes('Word'));
    clickByText('.report-choice button', 'PDF'); await wait(8000);
    check('PDF report generation starts and closes the chooser', document.querySelector('.report-choice') === null);
    check('report export preserves the exact current map view', document.querySelector('.map-rotatable')?.style.transform === reportViewState.rotatable && document.querySelector('.source-marker')?.getAttribute('transform') === reportViewState.source && document.querySelector('.zoom span')?.textContent === reportViewState.zoom, JSON.stringify({ before: reportViewState, after: { rotatable: document.querySelector('.map-rotatable')?.style.transform, source: document.querySelector('.source-marker')?.getAttribute('transform'), zoom: document.querySelector('.zoom span')?.textContent } }));
    for (let attempt = 0; attempt < 60 && document.querySelector('.result-actions button:last-child')?.disabled; attempt += 1) await wait(250);
    clickByText('.result-actions button', 'Сформировать отчёт'); await wait();
    clickByText('.report-choice button', 'Word'); await wait(3500);
    check('Word report generation starts and closes the chooser', document.querySelector('.report-choice') === null);

    const zoomInButton = document.querySelector('.zoom button[aria-label="Увеличить карту"]');
    for (let index = 0; index < 45; index += 1) zoomInButton?.click();
    await wait(250);
    check('rapid repeated zoom clicks reach the expanded mobile zoom limit without appearing to hang', document.querySelector('.zoom span')?.textContent === '2400%', document.querySelector('.zoom span')?.textContent ?? '—');
    const sourceInnerTransform = document.querySelector('.source-marker > g')?.getAttribute('transform') ?? '';
    check('source marker remains visible at maximum map zoom', Number.parseFloat(sourceInnerTransform.replace('scale(', '')) >= 0.56, sourceInnerTransform);
    const zoomOutButton = document.querySelector('.zoom button[aria-label="Уменьшить карту"]');
    for (let index = 0; index < 18; index += 1) { zoomOutButton?.click(); await wait(20); }
    check('dimension and area captions hide at minimum map zoom', document.querySelector('.dimension-depth-label') === null && document.querySelector('.dimension-width-label') === null && document.querySelector('.plume-area-labels') === null);

    document.querySelector('.source-marker')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await wait();
    check('right click opens source menu', document.querySelector('.map-context-menu')?.textContent?.includes('Удалить'));
    clickByText('.map-context-menu button', 'Удалить'); await wait();
    check('source can be deleted from its context menu', document.querySelector('.source-marker') === null);

    clickByText('.file-actions button', 'Новый'); await wait();
    check('new calculation clears results and controls but restores the movable source point', document.querySelector('.main-result') === null && document.querySelectorAll('.control-marker').length === 0 && document.querySelector('.source-marker') !== null && document.querySelector('.result-placeholder') !== null);
    document.querySelector('.substance-picker-button')?.click();
    await wait();
    check('substance list contains exactly the 35 table V.3 variants', document.querySelectorAll('.substance-options button').length === 35, String(document.querySelectorAll('.substance-options button').length));
    check('substances absent from table V.3 are hidden', !document.querySelector('.substance-options')?.textContent?.includes('Серная кислота'));
    clickByText('.substance-options button', 'Акролеин');
    await wait();
    check('non-template table V.3 substance creates an editable source card', document.querySelectorAll('.source-card').length === 0 && document.querySelector('.generic-source-card') === null && document.querySelector('.custom-source-card') !== null, (document.querySelector('.substance-picker-button')?.textContent ?? '') + ' / ' + (document.querySelector('.source-palette')?.textContent ?? ''));
    const sourceMode = [...document.querySelectorAll('.custom-source-card label')].find((label) => label.textContent?.startsWith('Вид источника'))?.querySelector('select');
    check('custom source offers vessel and pipeline modes', sourceMode instanceof HTMLSelectElement && sourceMode.options.length === 2);
    if (sourceMode instanceof HTMLSelectElement) { sourceMode.value = 'pipeline'; sourceMode.dispatchEvent(new Event('change', { bubbles: true })); }
    await wait();
    const customInput = (prefix) => [...document.querySelectorAll('.custom-source-card label')].find((label) => label.textContent?.startsWith(prefix))?.querySelector('input');
    const pipeLength = customInput('Длина трубопровода между задвижками');
    if (pipeLength instanceof HTMLInputElement) setInput(pipeLength, '3'); await wait();
    const pipeDiameter = customInput('Внутренний диаметр трубопровода');
    if (pipeDiameter instanceof HTMLInputElement) setInput(pipeDiameter, '50'); await wait();
    const massCoefficient = customInput('Коэффициент перевода');
    if (massCoefficient instanceof HTMLInputElement) setInput(massCoefficient, '0.84'); await wait();
    const customMass = [...document.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Масса вещества, т'))?.querySelector('input');
    check('pipeline volume remains visible for the 3 m × 50 mm scenario', document.querySelector('.custom-source-volume')?.textContent?.includes('0,00589'), document.querySelector('.custom-source-volume')?.textContent ?? '');
    check('pipeline mass uses length, inner diameter and substance coefficient without rounding to zero', customMass instanceof HTMLInputElement && Math.abs(Number(customMass.value) - 0.004948) < .000001, customMass instanceof HTMLInputElement ? customMass.value : '');
    check('small pipeline mass is also shown in kilograms', document.querySelector('.computed-mass')?.textContent?.includes('4,95 кг'), document.querySelector('.computed-mass')?.textContent ?? '');
    clickByText('.custom-source-card button', 'Вернуть стандартный коэффициент'); await wait();
    const restoredCoefficient = customInput('Коэффициент перевода');
    check('custom source restores the exact table V.3 liquid-density coefficient', restoredCoefficient instanceof HTMLInputElement && Number(restoredCoefficient.value) === 0.839, restoredCoefficient instanceof HTMLInputElement ? restoredCoefficient.value : '');
    const customDetails = document.querySelector('.custom-source-card');
    if (customDetails instanceof HTMLDetailsElement) customDetails.open = true;
    customDetails?.querySelector('summary')?.click(); await wait();
    check('custom source card can be collapsed after input', customDetails instanceof HTMLDetailsElement && !customDetails.open);
    check('generic vessel and pipeline use neutral rendered images', document.querySelector('.source-marker image')?.getAttribute('href')?.includes('generic-pipeline.png'));
    check('internal verification language and normative source line are hidden', document.querySelector('.normative-source') === null && !document.body.textContent?.toLocaleLowerCase('ru-RU').includes('двойн'));

    clickByText('.topbar nav button', 'Опасный груз');
    for (let attempt = 0; attempt < 30 && document.querySelector('.goods-search-box input') === null; attempt += 1) await wait(150);
    check('dangerous-goods screen follows the search-left and emergency-sheet-right design', document.querySelector('.goods-sidebar') !== null && document.querySelector('.emergency-sheet') !== null);
    check('dangerous-goods screen opens without a preselected substance', document.querySelector('.goods-hero') === null && document.querySelector('.emergency-empty') !== null);
    check('dangerous-goods card has no redundant plume-calculation action', document.querySelector('.calculate-from-goods') === null);
    for (let attempt = 0; attempt < 100 && !document.querySelector('.goods-search-results')?.textContent?.includes('1017'); attempt += 1) {
      const currentInput = document.querySelector('.goods-search-box input');
      if (currentInput instanceof HTMLInputElement && currentInput.value !== '1017') setInput(currentInput, '1017');
      await wait(150);
    }
    const unInput = document.querySelector('.goods-search-box input');
    check('dangerous goods database loaded', document.querySelectorAll('.goods-search-results button').length > 0);
    // Let the initial-query effect finish after the large offline database is
    // attached, then perform the same result click as a user.
    await wait(600);
    document.querySelector('.goods-search-results button')?.click();
    for (let attempt = 0; attempt < 180 && (!document.querySelector('.goods-hero')?.textContent?.includes('ХЛОР') || !document.querySelector('.goods-hero')?.textContent?.includes('№ 203')); attempt += 1) await wait(100);
    check('UN 1017 lookup', document.querySelector('.goods-hero')?.textContent?.includes('ХЛОР'));
    check('UN 1017 has official emergency card 203', document.querySelector('.goods-hero')?.textContent?.includes('№ 203'));
    check('chlorine transport fields include ADR code and Kemler number', document.querySelector('.goods-hero')?.textContent?.includes('2TOC') && document.querySelector('.goods-hero')?.textContent?.includes('265'));
    check('UN 1017 uses the exact ADR 2025 label sequence', [...document.querySelectorAll('.hazard-label-frame')].map((item) => item.getAttribute('title')?.split(' ')[0]).join('+') === '2.3+5.1+8');
    check('hazard labels use scalable normative SVG artwork', document.querySelectorAll('.hazard-label-frame .hazard-label').length === 3);
    check('chlorine card contains the complete official emergency text', ['Возможен смертельный исход', 'Охлаждать емкости водой', 'ПДУ-3', 'не менее 15 минут'].every((fragment) => document.querySelector('.official-card-document')?.textContent?.includes(fragment)));
    check('chlorine uses its individual profile without a missing-data notice', !document.querySelector('.emergency-sheet')?.textContent?.includes('ещё не прошли предметную проверку'));
    check('official emergency card is shown as one continuous normative document', document.querySelector('.official-card-document') !== null && document.querySelector('.emergency-card-grid') === null);
    check('substance summary contains all six required characteristics', document.querySelectorAll('.substance-facts dl > div').length === 6);
    check('unused emergency-sheet subsection tabs are removed', document.querySelector('.emergency-sheet-tabs') === null);
    check('official emergency sheet includes the normative source banner', document.querySelector('.emergency-additional .source-links') !== null);
    if (unInput instanceof HTMLInputElement) setInput(unInput, '1972'); await wait(200);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    const methaneSheet = document.querySelector('.emergency-sheet')?.textContent ?? '';
    check('UN 1972 has an individual cryogenic profile without internal group-card notices', methaneSheet.includes('холодовое поражение') && methaneSheet.includes('Химическая нейтрализация не применяется') && !methaneSheet.includes('Групповая аварийная карточка'));
    check('UN 1972 displays the official card as one continuous document', document.querySelector('.official-card-document') !== null && document.querySelector('.emergency-card-grid') === null);
    check('UN 1972 displays operational requirements without internal data-model explanations', (document.querySelector('.official-card-document')?.textContent?.length ?? 0) > 200 && document.querySelector('.official-card-scope') === null && document.querySelector('.official-group-card') === null);
    check('UN 1972 has only the verified ADR 2.1 label', [...document.querySelectorAll('.hazard-label-frame')].map((item) => item.getAttribute('title')?.split(' ')[0]).join('+') === '2.1');
    if (unInput instanceof HTMLInputElement) setInput(unInput, 'Cl2'); await wait(200);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    check('chemical formula lookup works offline', document.querySelector('.goods-hero')?.textContent?.includes('1017') && document.querySelector('.goods-search-results')?.textContent?.includes('Cl₂'));
    if (unInput instanceof HTMLInputElement) setInput(unInput, 'соляная кислота'); await wait(200);
    check('dangerous-good name lookup works offline', document.querySelector('.goods-search-results')?.textContent?.includes('1789'));
    document.querySelector('.goods-search-results button')?.click(); await wait();
    const hydrochloricWaterFact = document.querySelector('.fact-water')?.textContent ?? '';
    check('UN 1789 is correctly described as water-compatible', /совместима с водой/iu.test(hydrochloricWaterFact) && /смешивается с водой/iu.test(hydrochloricWaterFact) && !/ограниченно совместимо/iu.test(hydrochloricWaterFact), hydrochloricWaterFact);
    check('UN 1789 workplace PDK comes from the Russian product standard', document.querySelector('.fact-pdk')?.textContent?.includes('5 мг/м³') && document.querySelector('.fact-pdk')?.textContent?.includes('ГОСТ 857-95'));
    if (unInput instanceof HTMLInputElement) setInput(unInput, '2908');
    for (let attempt = 0; attempt < 30 && !document.querySelector('.goods-search-results')?.textContent?.includes('2908'); attempt += 1) await wait(100);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    check('UN 2908 lookup', document.querySelector('.goods-hero')?.textContent?.includes('2908'));
    check('UN 2908 shows a complete fact passport without inventing an absent emergency card', document.querySelectorAll('.substance-facts dl > div').length === 6 && document.querySelector('.unverified-emergency-card') === null && document.querySelector('.official-card-document') === null);
    if (unInput instanceof HTMLInputElement) setInput(unInput, '0029');
    for (let attempt = 0; attempt < 30 && !document.querySelector('.goods-search-results')?.textContent?.includes('0029'); attempt += 1) await wait(100);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    check('non-pilot UN uses its assigned official emergency card', document.querySelector('.goods-hero')?.textContent?.includes('№ 191'));
    check('non-pilot official card is rendered as a continuous normative document', document.querySelector('.official-card-document') !== null);
    check('internal group-card scope is not shown to the user', document.querySelector('.official-card-scope') === null && !(document.querySelector('.emergency-sheet')?.textContent ?? '').includes('проверенные сведения конкретного вещества имеют приоритет'));
    check('substance card has six structured facts followed by the official text', document.querySelectorAll('.substance-facts dl > div').length === 6 && document.querySelector('.official-card-document') !== null);
    check('non-pilot official card no longer shows the five-pilot missing-data notice', !document.querySelector('.emergency-sheet')?.textContent?.includes('ещё не прошли предметную проверку'));
    check('dangerous-goods footer stays at the bottom of the application', (() => { const footer = document.querySelector('.statusbar'); return footer !== null && Math.abs(footer.getBoundingClientRect().bottom - innerHeight) < 1; })());
    check('photo recognition requires human verification', document.querySelector('.recognition-warning')?.textContent?.includes('Проверьте табличку') && document.querySelector('.confirm-recognition') !== null);
    document.querySelector('.photo-click-target')?.click(); await wait(50);
    check('Android photo workflow opens one camera-or-gallery chooser', document.querySelector('.photo-source-menu')?.textContent?.includes('Включить камеру') && document.querySelector('.photo-source-menu')?.textContent?.includes('Выбрать из галереи') && document.querySelector('.photo-source-input[capture="environment"]') !== null);
    document.querySelector('.photo-source-cancel')?.click(); await wait(20);
    const photoInput = document.querySelector('.photo-identification input[type="file"]');
    let ocrElapsedMs = 0;
    if (photoInput instanceof HTMLInputElement) {
      // A modern phone camera commonly supplies a 12 MP image. This exact
      // size guards against the former regression where preprocessing enlarged
      // it again and exhausted Android memory before OCR could start.
      const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 3000;
      const context = canvas.getContext('2d');
      if (context !== null) {
        // A close-up in which the placard fills the photograph used to be
        // rejected by the orange-area detector. Keep it as a regression case.
        context.fillStyle = '#f28c28'; context.fillRect(230, 170, 3540, 2660);
        context.strokeStyle = '#111'; context.lineWidth = 72; context.strokeRect(230, 170, 3540, 2660);
        context.fillStyle = '#111'; context.font = 'bold 700px Arial'; context.textAlign = 'center';
        context.fillText('30', 2000, 1220); context.fillRect(307, 1432, 3386, 82); context.fillText('1202', 2000, 2495);
        const externalFixture = ${JSON.stringify(ocrFixtureDataUrl)};
        const blob = externalFixture.length > 0 ? new Blob([Uint8Array.from(atob(externalFixture.split(',')[1] ?? ''), (character) => character.charCodeAt(0))], { type: 'image/png' }) : await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, 'image/png'));
        if (blob !== null) {
          const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'placard-1017.png', { type: 'image/png' }));
          Object.defineProperty(photoInput, 'files', { configurable: true, value: transfer.files });
          const ocrStartedAt = performance.now();
          photoInput.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(40);
          check('manual placard fields remain available while offline OCR is running', document.querySelector('.recognition-progress') !== null && document.querySelectorAll('.recognized-placard input:not([type="file"])').length === 2 && [...document.querySelectorAll('.recognized-placard input:not([type="file"])')].every((input) => !input.disabled));
          for (let attempt = 0; attempt < 300 && (document.querySelector('.recognition-progress') !== null || !(document.querySelectorAll('.photo-identification input:not([type="file"])')[1]?.value)); attempt += 1) await wait(250);
          ocrElapsedMs = performance.now() - ocrStartedAt;
        }
      }
    }
    const recognizedPairs = [...document.querySelectorAll('.recognized-placard')].map((card) => [...card.querySelectorAll('input')].map((input) => input.value).join('/'));
    const expectedPairs = ${JSON.stringify(ocrExpectedPairs)};
    check('offline photo OCR selects one verified placard candidate', recognizedPairs.length === 1 && expectedPairs.includes(recognizedPairs[0]), recognizedPairs.join(', ') + ' ' + (document.querySelector('.recognition-error')?.textContent ?? '') + ' OCR=' + (document.documentElement.dataset.ocrDebug ?? ''));
    check('close-up placard recognition finishes within the mobile response budget', ocrElapsedMs > 0 && ocrElapsedMs <= 15000, Math.round(ocrElapsedMs) + ' ms');
    if (photoInput instanceof HTMLInputElement) {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
      const context = canvas.getContext('2d');
      if (context !== null) {
        context.translate(600, 400); context.rotate(.035);
        context.fillStyle = '#ffd07a'; context.fillRect(-530, -355, 1060, 710);
        context.strokeStyle = '#111'; context.lineWidth = 22; context.strokeRect(-530, -355, 1060, 710);
        context.fillStyle = '#111'; context.font = 'bold 210px Arial'; context.textAlign = 'center';
        context.fillText('33', 0, -75); context.fillRect(-508, -18, 1016, 22); context.fillText('1203', 0, 265);
        const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, 'image/png'));
        if (blob !== null) {
          const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'placard-pale-rotated.png', { type: 'image/png' }));
          Object.defineProperty(photoInput, 'files', { configurable: true, value: transfer.files });
          const startedAt = performance.now(); photoInput.dispatchEvent(new Event('change', { bubbles: true }));
          for (let attempt = 0; attempt < 100 && (document.querySelector('.recognition-progress') !== null || document.querySelectorAll('.recognized-placard input')[1]?.value !== '1203'); attempt += 1) await wait(150);
          const pair = [...document.querySelectorAll('.recognized-placard input')].map((input) => input.value).join('/');
          check('offline OCR recognizes a pale rotated close-up placard', pair === '33/1203', pair + ' OCR=' + (document.documentElement.dataset.ocrDebug ?? ''));
          check('pale rotated placard stays within the mobile response budget', performance.now() - startedAt <= 15000, Math.round(performance.now() - startedAt) + ' ms');
        }
      }
    }
    if (photoInput instanceof HTMLInputElement) {
      const source = document.createElement('canvas'); source.width = 1000; source.height = 650;
      const sourceContext = source.getContext('2d');
      const rephotographed = document.createElement('canvas'); rephotographed.width = 1200; rephotographed.height = 800;
      const context = rephotographed.getContext('2d');
      if (sourceContext !== null && context !== null) {
        sourceContext.fillStyle = '#e7832d'; sourceContext.fillRect(20, 20, 960, 610);
        sourceContext.strokeStyle = '#151515'; sourceContext.lineWidth = 20; sourceContext.strokeRect(20, 20, 960, 610);
        sourceContext.fillStyle = '#111'; sourceContext.font = 'bold 185px Arial'; sourceContext.textAlign = 'center';
        sourceContext.fillText('80', 500, 270); sourceContext.fillRect(40, 315, 920, 20); sourceContext.fillText('1789', 500, 555);
        const reduced = document.createElement('canvas'); reduced.width = 560; reduced.height = 365;
        const reducedContext = reduced.getContext('2d');
        if (reducedContext !== null) {
          reducedContext.filter = 'blur(.55px) contrast(.92)'; reducedContext.drawImage(source, 0, 0, reduced.width, reduced.height);
          context.fillStyle = '#d6d9d7'; context.fillRect(0, 0, 1200, 800);
          context.save(); context.translate(600, 400); context.rotate(-.028); context.drawImage(reduced, -510, -333, 1020, 666); context.restore();
          for (let x = 0; x < 1200; x += 4) { context.fillStyle = x % 8 === 0 ? '#ffffff12' : '#0017280d'; context.fillRect(x, 0, 2, 800); }
          const glare = context.createLinearGradient(250, 100, 850, 700); glare.addColorStop(0, '#ffffff00'); glare.addColorStop(.48, '#ffffff30'); glare.addColorStop(.62, '#ffffff08'); glare.addColorStop(1, '#ffffff00'); context.fillStyle = glare; context.fillRect(0, 0, 1200, 800);
          const blob = await new Promise((resolveBlob) => rephotographed.toBlob(resolveBlob, 'image/jpeg', .72));
          if (blob !== null) {
            const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'placard-rephotographed.jpg', { type: 'image/jpeg' }));
            Object.defineProperty(photoInput, 'files', { configurable: true, value: transfer.files });
            const startedAt = performance.now(); photoInput.dispatchEvent(new Event('change', { bubbles: true }));
            for (let attempt = 0; attempt < 120 && (document.querySelector('.recognition-progress') !== null || document.querySelectorAll('.recognized-placard input')[1]?.value !== '1789'); attempt += 1) await wait(150);
            const pair = [...document.querySelectorAll('.recognized-placard input')].map((input) => input.value).join('/');
            check('offline OCR recognizes a rephotographed placard with moire, glare and JPEG compression', pair === '80/1789', pair + ' ' + (document.querySelector('.recognition-error')?.textContent ?? '') + ' OCR=' + (document.documentElement.dataset.ocrDebug ?? ''));
            check('rephotographed placard stays within the mobile response budget', performance.now() - startedAt <= 18000, Math.round(performance.now() - startedAt) + ' ms');
          }
        }
      }
    }
    check('photo OCR uses only bundled local worker, model and language data', performance.getEntriesByType('resource').filter((entry) => (/tesseract|traineddata/u.test(entry.name) || entry.name.includes('/ocr/')) && new URL(entry.name).origin !== location.origin).length === 0);
    check('photo workflow keeps exactly one confirmed cargo and cannot show competing substances', document.querySelectorAll('.recognized-placard').length === 1);
    check('starting photo recognition clears the search candidate and old substance card', unInput instanceof HTMLInputElement && unInput.value === '' && document.querySelector('.goods-hero') === null);
    if (unInput instanceof HTMLInputElement) setInput(unInput, '1017'); await wait(100);
    check('starting a new manual search clears the photo candidate', document.querySelector('.photo-preview') === null && [...document.querySelectorAll('.recognized-placard input')].every((input) => input.value === '') && document.querySelector('.goods-hero') === null);
    return checks;
  })()`);
  socket.close();
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
  const failures = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failures.length}/${results.length} acceptance checks passed.`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  edge.kill();
}
