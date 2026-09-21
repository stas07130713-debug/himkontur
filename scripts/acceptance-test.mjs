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
    if (sourceVolume instanceof HTMLInputElement) setInput(sourceVolume, '10');
    clickByText('.source-default-row button', 'Вернуть стандартные значения'); await wait();
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
    check('top bar contains only requested actions in order', (() => { const text = document.querySelector('.topbar')?.textContent ?? ''; return !text.includes('Нормативная база') && !text.includes('Справочники') && text.indexOf('Новый расчёт') < text.indexOf('Открыть расчёт') && text.indexOf('Открыть расчёт') < text.indexOf('Сохранить расчёт'); })());
    check('Windows title buttons do not overlap the application toolbar', !navigator.userAgent.includes('Electron') || (() => { const actions = document.querySelector('.file-actions'); const visibleButtons = [...document.querySelectorAll('.file-actions > button')].filter((button) => button.getBoundingClientRect().width > 0); const right = actions?.getBoundingClientRect().right ?? innerWidth; return visibleButtons.length >= 6 && right <= innerWidth - 145; })());
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

    const sourceBefore = document.querySelector('.source-marker')?.getAttribute('transform');
    stage?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 800, clientY: 500 }));
    await wait();
    check('plain map click does not move source', document.querySelector('.source-marker')?.getAttribute('transform') === sourceBefore);

    const primaryToggle = [...document.querySelectorAll('.layer-toggles label')].find((element) => element.textContent?.includes('Первичное'))?.querySelector('input');
    primaryToggle?.click(); await wait();
    check('primary layer can be hidden', document.querySelector('.primary-plume') === null && document.querySelector('.plume-band-primary') === null);
    primaryToggle?.click(); await wait();
    check('primary layer can be restored', document.querySelector('.primary-plume') !== null && document.querySelector('.plume-band-primary') !== null);

    clickByText('.segmented button', 'Карта'); await wait(500);
    check('basemap switches', document.querySelector('.segmented button.active')?.textContent?.includes('Карта'));
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
    check('three placed points fit the right panel without scrolling', (() => { const column = document.querySelector('.right-column'); const list = document.querySelector('.inline-controls-list'); return document.querySelectorAll('.placed-control-row').length === 3 && column && list && column.scrollHeight <= column.clientHeight + 1 && list.scrollHeight <= list.clientHeight + 1; })(), (() => { const column = document.querySelector('.right-column'); const list = document.querySelector('.inline-controls-list'); return (column ? column.scrollHeight + '/' + column.clientHeight : 'missing') + '; ' + (list ? list.scrollHeight + '/' + list.clientHeight : 'missing'); })());
    await dropTemplate(document.querySelector('.control-template-grid button'), .54, .56);
    check('placed-points list scrolls independently after the third point', (() => { const column = document.querySelector('.right-column'); const list = document.querySelector('.inline-controls-list'); return document.querySelectorAll('.placed-control-row').length === 4 && column && list && column.scrollHeight <= column.clientHeight + 1 && list.scrollHeight > list.clientHeight; })());
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

    const massInput = [...document.querySelectorAll('label')].find((element) => element.textContent?.startsWith('Масса вещества, т'))?.querySelector('input');
    const savedMass = massInput instanceof HTMLInputElement ? massInput.value : '';
    let savedScenarioText = '';
    window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async (blob) => { savedScenarioText = await blob.text(); }, close: async () => {} }) });
    clickByText('.file-actions button', 'Сохранить расчёт'); await wait(250);
    if (massInput instanceof HTMLInputElement) setInput(massInput, '1.5');
    const scenarioInput = document.querySelector('.scenario-file-input');
    const transfer = new DataTransfer();
    transfer.items.add(new File([savedScenarioText], 'test.himkontur', { type: 'application/json' }));
    Object.defineProperty(scenarioInput, 'files', { configurable: true, value: transfer.files });
    scenarioInput.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(250);
    check('scenario saves and opens as a file', massInput instanceof HTMLInputElement && massInput.value === savedMass && savedScenarioText.includes('applicationUrl'), (massInput instanceof HTMLInputElement ? massInput.value : '') + '/' + savedMass);
    check('operations do not show popup notices', document.querySelector('.notice') === null);
    check('undo is available after edits', !document.querySelector('.file-actions button')?.disabled);
    const accidentDate = [...document.querySelectorAll('.date-time-grid label')].find((label) => label.textContent?.startsWith('Дата'))?.querySelector('input');
    const accidentTime = [...document.querySelectorAll('.date-time-grid label')].find((label) => label.textContent?.startsWith('Время'))?.querySelector('input');
    if (accidentDate instanceof HTMLInputElement) setInput(accidentDate, '2026-01-12');
    if (accidentTime instanceof HTMLInputElement) setInput(accidentTime, '15:26');
    clickByText('.weather-actions button', 'Получить автоматически');
    for (let attempt = 0; attempt < 40 && !document.querySelector('.origin')?.textContent?.includes('архив') && document.querySelector('.weather-error') === null; attempt += 1) await wait(150);
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
    check('report map uses same-origin tiles', [...document.querySelectorAll('.basemap-tile-layer img')].length > 0 && [...document.querySelectorAll('.basemap-tile-layer img')].every((tile) => new URL(tile.src).origin === location.origin));
    clickByText('.result-actions button', 'Сформировать отчёт'); await wait();
    check('report offers PDF and Word instead of printing', document.querySelector('.report-choice')?.textContent?.includes('PDF') && document.querySelector('.report-choice')?.textContent?.includes('Word'));
    clickByText('.report-choice button', 'PDF'); await wait(8000);
    check('PDF report generation starts and closes the chooser', document.querySelector('.report-choice') === null);
    check('report export preserves the exact current map view', document.querySelector('.map-rotatable')?.style.transform === reportViewState.rotatable && document.querySelector('.source-marker')?.getAttribute('transform') === reportViewState.source && document.querySelector('.zoom span')?.textContent === reportViewState.zoom);
    for (let attempt = 0; attempt < 60 && document.querySelector('.result-actions button:last-child')?.disabled; attempt += 1) await wait(250);
    clickByText('.result-actions button', 'Сформировать отчёт'); await wait();
    clickByText('.report-choice button', 'Word'); await wait(3500);
    check('Word report generation starts and closes the chooser', document.querySelector('.report-choice') === null);

    const zoomInButton = document.querySelector('.zoom button[aria-label="Увеличить карту"]');
    for (let index = 0; index < 45; index += 1) zoomInButton?.click();
    await wait(250);
    check('rapid repeated zoom clicks are all applied without appearing to hang', document.querySelector('.zoom span')?.textContent === '800%', document.querySelector('.zoom span')?.textContent ?? '—');
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
    const unInput = document.querySelector('.goods-search-box input');
    if (unInput instanceof HTMLInputElement) setInput(unInput, '1017'); await wait(200);
    for (let attempt = 0; attempt < 30 && document.querySelectorAll('.goods-search-results button').length === 0; attempt += 1) await wait(150);
    check('dangerous goods database loaded', document.querySelectorAll('.goods-search-results button').length > 0);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    check('UN 1017 lookup', document.querySelector('.goods-hero')?.textContent?.includes('ХЛОР'));
    check('UN 1017 has official emergency card 203', document.querySelector('.goods-hero')?.textContent?.includes('№ 203'));
    check('chlorine transport fields include ADR code and Kemler number', document.querySelector('.goods-hero')?.textContent?.includes('2TOC') && document.querySelector('.goods-hero')?.textContent?.includes('265'));
    check('UN 1017 uses the exact ADR 2025 label sequence', [...document.querySelectorAll('.hazard-label-frame')].map((item) => item.getAttribute('title')?.split(' ')[0]).join('+') === '2.3+5.1+8');
    check('hazard labels use scalable normative SVG artwork', document.querySelectorAll('.hazard-label-frame .hazard-label').length === 3);
    check('chlorine card contains concrete individually sourced requirements', ['Смертельно опасен при вдыхании', 'Не направлять струю воды на жидкий хлор', 'Газонепроницаемый костюм', 'не менее 15 минут'].every((fragment) => document.querySelector('.emergency-sheet')?.textContent?.includes(fragment)));
    check('chlorine uses its individual profile without a missing-data notice', !document.querySelector('.emergency-sheet')?.textContent?.includes('ещё не прошли предметную проверку'));
    check('official emergency sheet follows the seven-section operational card layout', document.querySelectorAll('.emergency-card-grid section').length === 7);
    for (let attempt = 0; attempt < 20 && ![...document.querySelectorAll('.emergency-card-grid .emergency-card-icon')].every((icon) => icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth > 0); attempt += 1) await wait(100);
    check('every operational card section uses its matching rendered pictogram', document.querySelectorAll('.emergency-card-grid .emergency-card-icon').length === 7 && [...document.querySelectorAll('.emergency-card-grid .emergency-card-icon')].every((icon) => icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth > 0));
    check('unused emergency-sheet subsection tabs are removed', document.querySelector('.emergency-sheet-tabs') === null);
    check('official emergency sheet includes the normative source banner', document.querySelector('.emergency-additional .source-links') !== null);
    if (unInput instanceof HTMLInputElement) setInput(unInput, '1972'); await wait(200);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    const methaneSheet = document.querySelector('.emergency-sheet')?.textContent ?? '';
    check('UN 1972 is marked as a group emergency card with an individual cryogenic profile', methaneSheet.includes('Групповая аварийная карточка') && methaneSheet.includes('холодовое поражение') && methaneSheet.includes('Химическая нейтрализация не применяется'));
    check('UN 1972 individual property blocks do not contain unrelated group substances', !document.querySelector('.card-properties')?.textContent?.includes('ацетилена') && !document.querySelector('.card-human')?.textContent?.includes('водород'));
    check('UN 1972 separates official group requirements from substance-specific actions', !document.querySelector('.card-actions')?.textContent?.includes('Требования аварийной карточки № 204') && document.querySelector('.official-group-card') !== null);
    check('UN 1972 has only the verified ADR 2.1 label', [...document.querySelectorAll('.hazard-label-frame')].map((item) => item.getAttribute('title')?.split(' ')[0]).join('+') === '2.1');
    if (unInput instanceof HTMLInputElement) setInput(unInput, 'Cl2'); await wait(200);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    check('chemical formula lookup works offline', document.querySelector('.goods-hero')?.textContent?.includes('1017') && document.querySelector('.goods-search-results')?.textContent?.includes('Cl₂'));
    if (unInput instanceof HTMLInputElement) setInput(unInput, 'соляная кислота'); await wait(200);
    check('dangerous-good name lookup works offline', document.querySelector('.goods-search-results')?.textContent?.includes('1789'));
    if (unInput instanceof HTMLInputElement) setInput(unInput, '2908');
    await wait(200);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    check('UN 2908 lookup', document.querySelector('.goods-hero')?.textContent?.includes('2908'));
    check('unverified UN is not substituted with an OCR-derived emergency card', document.querySelector('.unverified-emergency-card')?.textContent?.includes('не найдена в локальной нормативной базе редакции 01.01.2026'));
    if (unInput instanceof HTMLInputElement) setInput(unInput, '0029');
    await wait(200);
    document.querySelector('.goods-search-results button')?.click(); await wait();
    check('non-pilot UN uses its assigned official emergency card', document.querySelector('.goods-hero')?.textContent?.includes('№ 191'));
    check('non-pilot official card is rendered in all seven operational sections', document.querySelectorAll('.emergency-card-grid section').length === 7);
    check('group scope is explicit instead of pretending to be an individual profile', document.querySelector('.official-card-scope')?.textContent?.includes('Официальная групповая АК № 191'));
    check('non-pilot official card no longer shows the five-pilot missing-data notice', !document.querySelector('.emergency-sheet')?.textContent?.includes('ещё не прошли предметную проверку'));
    check('dangerous-goods footer stays at the bottom of the application', (() => { const footer = document.querySelector('.statusbar'); return footer !== null && Math.abs(footer.getBoundingClientRect().bottom - innerHeight) < 1; })());
    check('photo recognition requires human verification', document.querySelector('.recognition-warning')?.textContent?.includes('Проверьте табличку') && document.querySelector('.confirm-recognition') !== null);
    const photoInput = document.querySelector('.photo-identification input[type="file"]');
    if (photoInput instanceof HTMLInputElement) {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
      const context = canvas.getContext('2d');
      if (context !== null) {
        context.fillStyle = '#cbd1d1'; context.fillRect(0, 0, 1200, 800);
        context.fillStyle = '#dc6f23'; context.beginPath(); context.ellipse(600, 300, 440, 230, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#f28c28'; context.fillRect(500, 595, 200, 145);
        context.strokeStyle = '#111'; context.lineWidth = 8; context.strokeRect(500, 595, 200, 145);
        context.fillStyle = '#111'; context.font = 'bold 56px Arial'; context.textAlign = 'center';
        context.fillText('30', 600, 655); context.fillRect(508, 670, 184, 7); context.fillText('1202', 600, 728);
        const externalFixture = ${JSON.stringify(ocrFixtureDataUrl)};
        const blob = externalFixture.length > 0 ? new Blob([Uint8Array.from(atob(externalFixture.split(',')[1] ?? ''), (character) => character.charCodeAt(0))], { type: 'image/png' }) : await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, 'image/png'));
        if (blob !== null) {
          const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'placard-1017.png', { type: 'image/png' }));
          Object.defineProperty(photoInput, 'files', { configurable: true, value: transfer.files });
          photoInput.dispatchEvent(new Event('change', { bubbles: true }));
          for (let attempt = 0; attempt < 300 && (document.querySelector('.recognition-progress') !== null || !(document.querySelectorAll('.photo-identification input:not([type="file"])')[1]?.value)); attempt += 1) await wait(250);
        }
      }
    }
    const recognizedPairs = [...document.querySelectorAll('.recognized-placard')].map((card) => [...card.querySelectorAll('input')].map((input) => input.value).join('/'));
    const expectedPairs = ${JSON.stringify(ocrExpectedPairs)};
    check('offline photo OCR selects one verified placard candidate', recognizedPairs.length === 1 && expectedPairs.includes(recognizedPairs[0]), recognizedPairs.join(', ') + ' ' + (document.querySelector('.recognition-error')?.textContent ?? ''));
    if (expectedPairs.length > 1) check('multiple ADR placards are rendered as an editable list', document.querySelectorAll('.recognized-placard').length >= expectedPairs.length);
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
