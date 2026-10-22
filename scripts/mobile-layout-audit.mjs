import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const port = 9980 + Math.floor(Math.random() * 15);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=430,932', pageUrl,
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    await delay(200);
    try {
      const entries = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = entries.find((entry) => entry.type === 'page');
    } catch { /* Edge is starting. */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Не удалось открыть мобильную проверку.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => { const value = JSON.parse(event.data); const done = pending.get(value.id); if (done) { pending.delete(value.id); done(value); } });
  const command = (method, params = {}) => new Promise((done, fail) => { const requestId = ++id; pending.set(requestId, (value) => value.error ? fail(new Error(value.error.message)) : done(value.result)); socket.send(JSON.stringify({ id: requestId, method, params })); });
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await command('Runtime.enable');
  await command('Page.enable');
  await delay(3000);
  mkdirSync(resolve('artifacts'), { recursive: true });
  const cases = [];
  let dangerousGoodsAutoReveal = false;
  let dangerousGoodsResetWorks = false;
  let expandedSourceCanScroll = false;
  let updateModalProminent = false;
  let districtLegendStartsCollapsed = false;
  let districtNppvStartsHidden = false;
  let districtLegendAutoCollapses = false;
  let districtBuildingAutoReveal = false;
  let mobileDispatchMapOnly = false;
  for (const size of [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
    await command('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: true });
    await delay(800);
    const layout = await evaluate(`(() => {
      const visible = (selector) => { const node = document.querySelector(selector); if (!node) return false; const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
      return {
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        tabs: visible('.main-tabs'),
        mobileButton: visible('.mobile-access-action'),
        mobileSubtitle: (() => {
          const subtitle = document.querySelector('.chemcontour-logo small');
          return Boolean(subtitle && getComputedStyle(subtitle).display !== 'none' && subtitle.textContent?.includes('Система поддержки принятия решений при ЧС'));
        })(),
        actionsBalanced: (() => {
          const actions = [...document.querySelectorAll('.file-actions > button:not(.history-action)')]
            .map((node) => node.getBoundingClientRect());
          const bar = document.querySelector('.file-actions')?.getBoundingClientRect();
          return Boolean(bar && actions.length === 2 && actions.every((rect) => Math.abs(actions[0].width - rect.width) <= 2 && rect.left >= bar.left && rect.right <= bar.right));
        })(),
        actionsCompact: (() => {
          const actions = [...document.querySelectorAll('.file-actions > button:not(.history-action)')]
            .map((node) => node.getBoundingClientRect());
          const bar = document.querySelector('.file-actions')?.getBoundingClientRect();
          return Boolean(bar && actions.length === 2 && bar.height <= 42 && actions.every((rect) => rect.height <= 38));
        })(),
        actionRects: {
          bar: document.querySelector('.file-actions')?.getBoundingClientRect().toJSON(),
          buttons: [...document.querySelectorAll('.file-actions > button:not(.history-action)')].map((node) => node.getBoundingClientRect().toJSON()),
        },
        themeSwitch: visible('.topbar > .theme-switch'),
        themeDoesNotOverlapTabs: (() => {
          const theme = document.querySelector('.topbar > .theme-switch')?.getBoundingClientRect();
          const tabs = document.querySelector('.main-tabs')?.getBoundingClientRect();
          return Boolean(theme && tabs && (theme.bottom <= tabs.top || theme.right <= tabs.left || theme.left >= tabs.right));
        })(),
        left: visible('.left-column'),
        map: visible('.map-column'),
        fullCloudLabels: [...document.querySelectorAll('.layer-toggles label')].every((node) => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1),
        compassAvoidsToolbarContent: (() => {
          const compass = document.querySelector('.compass-rose')?.getBoundingClientRect();
          const toolbarItems = [...document.querySelectorAll('.map-tool-group, .toolbar-wind-summary')]
            .map((node) => node.getBoundingClientRect());
          const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          return Boolean(compass && toolbarItems.length && toolbarItems.every((rect) => !overlaps(compass, rect)));
        })(),
        mapControlsRightAligned: (() => {
          const map = document.querySelector('.map-column')?.getBoundingClientRect();
          const controls = [...document.querySelectorAll('.zoom, .source-focus, .source-lock, .calculation-ruler-control')]
            .map((node) => node.getBoundingClientRect());
          return Boolean(map && controls.length === 4 && controls.every((rect) => rect.left >= map.left && rect.top >= map.top && rect.bottom <= map.bottom && Math.abs(map.right - rect.right) <= 12));
        })(),
        mapOverlayControlsDoNotOverlap: (() => {
          const map = document.querySelector('.map-column')?.getBoundingClientRect();
          const controls = [...document.querySelectorAll('.compass-rose, .zoom, .source-focus, .source-lock, .calculation-ruler-control')]
            .map((node) => node.getBoundingClientRect());
          const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          const insideMap = Boolean(map && controls.length === 5 && controls.every((rect) => rect.left >= map.left && rect.right <= map.right && rect.top >= map.top && rect.bottom <= map.bottom));
          return insideMap && controls.every((rect, index) => controls.slice(index + 1).every((other) => !overlaps(rect, other)));
        })(),
        mapOverlayRects: [...document.querySelectorAll('.compass-rose, .zoom, .source-focus, .source-lock, .calculation-ruler-control')]
          .map((node) => ({ className: node.className, ...node.getBoundingClientRect().toJSON() })),
        mapRect: document.querySelector('.map-column')?.getBoundingClientRect().toJSON(),
        right: visible('.right-column .results') && visible('.right-column .control-palette'),
        mobileOrder: (() => {
          const result = document.querySelector('.right-column .results');
          const map = document.querySelector('.map-column');
          const controls = document.querySelector('.right-column .control-palette');
          if (!result || !map || !controls) return false;
          const pageTop = (node) => node.getBoundingClientRect().top + scrollY;
          return pageTop(result) < pageTop(map) && pageTop(map) < pageTop(controls);
        })(),
        calculate: visible('.calculate-button'),
        mapTiles: [...document.querySelectorAll('.basemap-tile-layer img')].length,
        loadedMapTiles: [...document.querySelectorAll('.basemap-tile-layer img')].filter((image) => image.complete && image.naturalWidth > 0).length,
        firstMapTile: document.querySelector('.basemap-tile-layer img')?.src ?? ''
      };
    })()`);
    cases.push({ ...size, ...layout });
    if (size.width === 390) {
      updateModalProminent = await evaluate(`(() => {
        const backdrop = document.createElement('div');
        backdrop.className = 'update-center-backdrop';
        backdrop.innerHTML = '<aside class="update-center update-center-important"><button class="update-center-close">×</button><div class="update-center-emblem">↓</div><strong>Доступно новое обновление</strong><span class="update-center-version">ХИМКОНТУР · версия 0.3.13</span><span>Установите новую версию, чтобы получить последние исправления и улучшения.</span><span class="update-center-note">Будет установлена сразу последняя версия.</span><div class="update-center-actions"><button class="update-center-install">Обновить сейчас</button><button class="update-center-cancel">Отмена</button></div></aside>';
        document.body.append(backdrop);
        const dialog = backdrop.querySelector('.update-center-important');
        const install = backdrop.querySelector('.update-center-install');
        const cancel = backdrop.querySelector('.update-center-cancel');
        const rect = dialog?.getBoundingClientRect();
        const result = Boolean(rect && install && cancel && rect.width >= innerWidth * 0.94 && rect.height >= innerHeight * 0.62 && install.getBoundingClientRect().height >= 58 && cancel.getBoundingClientRect().height >= 58);
        backdrop.dataset.layoutPassed = String(result);
        return result;
      })()`);
      const updateShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(resolve('artifacts', 'mobile-update-modal-390.png'), Buffer.from(updateShot.data, 'base64'));
      await evaluate(`document.querySelector('.update-center-backdrop')?.remove()`);
      expandedSourceCanScroll = await evaluate(`(async () => {
        document.querySelector('.source-editor:not([open]) > summary')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const scroller = document.querySelector('.input-panel-scroll');
        if (!(scroller instanceof HTMLElement)) return false;
        scroller.scrollTop = scroller.scrollHeight;
        const result = getComputedStyle(scroller).overflowY === 'auto' && scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop > 0;
        document.querySelector('.source-editor[open] > summary')?.click();
        return result;
      })()`);
      const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(resolve('artifacts', 'mobile-calculation-390.png'), Buffer.from(shot.data, 'base64'));
      await evaluate(`document.querySelector('.mobile-access-action')?.click()`);
      await delay(500);
      const qrShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(resolve('artifacts', 'mobile-qr-390.png'), Buffer.from(qrShot.data, 'base64'));
      await evaluate(`document.querySelector('.dialog-close')?.click()`);
      await evaluate(`document.querySelectorAll('.main-tabs button')[1]?.click()`);
      await delay(300);
      await evaluate(`(() => {
        scrollTo(0, 0);
        const input = document.querySelector('.goods-search-box input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (input && setter) { setter.call(input, 'хлор'); input.dispatchEvent(new Event('input', { bubbles: true })); }
      })()`);
      await delay(100);
      await evaluate(`document.querySelector('.goods-search-box button')?.click()`);
      await delay(850);
      dangerousGoodsAutoReveal = await evaluate(`(() => {
        const sheet = document.querySelector('.emergency-sheet');
        return Boolean(sheet && scrollY > 0 && sheet.getBoundingClientRect().top < 160);
      })()`);
      const goodsShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(resolve('artifacts', 'mobile-dangerous-goods-390.png'), Buffer.from(goodsShot.data, 'base64'));
      await evaluate(`document.querySelector('.dangerous-goods-reset')?.click()`);
      await delay(120);
      dangerousGoodsResetWorks = await evaluate(`(() => {
        const input = document.querySelector('.goods-search-box input');
        return Boolean(input && input.value === '' && document.querySelector('.emergency-empty') !== null);
      })()`);
      await evaluate(`document.querySelectorAll('.main-tabs button')[2]?.click()`);
      await delay(700);
      const districtChecks = await evaluate(`(async () => {
        scrollTo(0, 0);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const legend = document.querySelector('.district-map-legend');
        const startsCollapsed = Boolean(legend?.classList.contains('collapsed'));
        legend?.querySelector('.district-legend-collapse')?.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const nppvInputs = [...(legend?.querySelectorAll('.district-legend-row') ?? [])]
          .filter((row) => row.textContent?.includes('Пожарные гидранты') || row.textContent?.includes('Пожарные водоёмы'))
          .map((row) => row.querySelector('input'))
          .filter(Boolean);
        const nppvHidden = nppvInputs.length >= 2 && nppvInputs.every((input) => !input.checked);
        document.querySelector('.district-map-surface svg')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 180, clientY: 420, button: 0 }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const autoCollapsed = Boolean(legend?.classList.contains('collapsed'));
        document.querySelector('.district-map-marker.building-number-marker')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 650));
        const details = document.querySelector('.district-details-panel');
        const buildingRevealed = Boolean(details && scrollY > 0 && details.getBoundingClientRect().top < innerHeight - 100);
        return { startsCollapsed, nppvHidden, autoCollapsed, buildingRevealed };
      })()`);
      districtLegendStartsCollapsed = districtChecks.startsCollapsed;
      districtNppvStartsHidden = districtChecks.nppvHidden;
      districtLegendAutoCollapses = districtChecks.autoCollapsed;
      districtBuildingAutoReveal = districtChecks.buildingRevealed;
      const districtShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(resolve('artifacts', 'mobile-district-map-390.png'), Buffer.from(districtShot.data, 'base64'));
      await evaluate(`document.querySelector('.district-emergency-button')?.click()`);
      await delay(1500);
      mobileDispatchMapOnly = await evaluate(`(() => {
        const dialog = document.querySelector('.fire-dispatch-ticket-dialog');
        const sheet = document.querySelector('.fire-dispatch-ticket-sheet.mobile-map-only');
        const actions = dialog?.querySelector('.fire-dispatch-screen-actions')?.textContent ?? '';
        return Boolean(dialog && sheet
          && sheet.querySelector('.fire-dispatch-map')
          && sheet.querySelector('.fire-dispatch-planning-documents')
          && !sheet.textContent?.includes('ПУТЁВКА')
          && !actions.includes('Распечатать')
          && actions.includes('Сохранить схему PDF')
          && actions.includes('Закрыть'));
      })()`);
      const dispatchShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(resolve('artifacts', 'mobile-dispatch-map-390.png'), Buffer.from(dispatchShot.data, 'base64'));
      await evaluate(`document.querySelector('.fire-dispatch-screen-actions button:last-child')?.click()`);
      await evaluate(`document.querySelectorAll('.main-tabs button')[0]?.click(); scrollTo(0, 0);`);
    }
    if (size.width === 844) {
      const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(resolve('artifacts', 'mobile-calculation-landscape-844.png'), Buffer.from(shot.data, 'base64'));
    }
  }
  const failures = cases.filter((item) => item.scrollWidth > item.viewport + 1 || !item.tabs || !item.mobileButton || !item.mobileSubtitle || !item.actionsBalanced || !item.actionsCompact || !item.themeSwitch || !item.themeDoesNotOverlapTabs || !item.left || !item.map || !item.fullCloudLabels || !item.compassAvoidsToolbarContent || !item.mapControlsRightAligned || !item.mapOverlayControlsDoNotOverlap || !item.right || !item.mobileOrder || !item.calculate);
  if (!dangerousGoodsAutoReveal) failures.push({ check: 'dangerous-goods-auto-reveal' });
  if (!dangerousGoodsResetWorks) failures.push({ check: 'dangerous-goods-reset' });
  if (!expandedSourceCanScroll) failures.push({ check: 'expanded-source-mobile-scroll' });
  if (!updateModalProminent) failures.push({ check: 'android-update-modal-prominence' });
  if (!districtLegendStartsCollapsed) failures.push({ check: 'district-legend-starts-collapsed' });
  if (!districtNppvStartsHidden) failures.push({ check: 'district-nppv-starts-hidden' });
  if (!districtLegendAutoCollapses) failures.push({ check: 'district-legend-auto-collapses' });
  if (!districtBuildingAutoReveal) failures.push({ check: 'district-building-auto-reveal' });
  if (!mobileDispatchMapOnly) failures.push({ check: 'mobile-dispatch-map-only' });
  const report = { passed: failures.length === 0, dangerousGoodsAutoReveal, dangerousGoodsResetWorks, expandedSourceCanScroll, updateModalProminent, districtLegendStartsCollapsed, districtNppvStartsHidden, districtLegendAutoCollapses, districtBuildingAutoReveal, mobileDispatchMapOnly, cases, failures };
  writeFileSync(resolve('artifacts', 'mobile-layout-audit.json'), JSON.stringify(report, null, 2));
  if (failures.length) throw new Error(`Мобильная компоновка не прошла проверку: ${JSON.stringify(failures)}`);
  console.log(`Мобильная компоновка проверена на ${cases.map((item) => `${item.width}×${item.height}`).join(', ')}: горизонтального сдвига нет; найденный опасный груз открывается автоматически; после ввода следуют результаты, карта и контрольные точки.`);
  socket.close();
} finally {
  edge.kill();
}
