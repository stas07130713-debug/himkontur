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
  mkdirSync(resolve('artifacts'), { recursive: true });
  const cases = [];
  for (const size of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await command('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: true });
    await delay(800);
    const layout = await evaluate(`(() => {
      const visible = (selector) => { const node = document.querySelector(selector); if (!node) return false; const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
      return {
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        tabs: visible('.main-tabs'),
        mobileButton: visible('.mobile-access-action'),
        themeSwitch: visible('.topbar > .theme-switch'),
        themeDoesNotOverlapTabs: (() => {
          const theme = document.querySelector('.topbar > .theme-switch')?.getBoundingClientRect();
          const tabs = document.querySelector('.main-tabs')?.getBoundingClientRect();
          return Boolean(theme && tabs && (theme.bottom <= tabs.top || theme.right <= tabs.left || theme.left >= tabs.right));
        })(),
        left: visible('.left-column'),
        map: visible('.map-column'),
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
      const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(resolve('artifacts', 'mobile-calculation-390.png'), Buffer.from(shot.data, 'base64'));
      await evaluate(`document.querySelector('.mobile-access-action')?.click()`);
      await delay(500);
      const qrShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(resolve('artifacts', 'mobile-qr-390.png'), Buffer.from(qrShot.data, 'base64'));
      await evaluate(`document.querySelector('.dialog-close')?.click()`);
      await evaluate(`document.querySelectorAll('.main-tabs button')[1]?.click()`);
      await delay(300);
      const goodsShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(resolve('artifacts', 'mobile-dangerous-goods-390.png'), Buffer.from(goodsShot.data, 'base64'));
      await evaluate(`document.querySelectorAll('.main-tabs button')[0]?.click()`);
    }
  }
  const failures = cases.filter((item) => item.scrollWidth > item.viewport + 1 || !item.tabs || !item.mobileButton || !item.themeSwitch || !item.themeDoesNotOverlapTabs || !item.left || !item.map || !item.right || !item.mobileOrder || !item.calculate);
  const report = { passed: failures.length === 0, cases, failures };
  writeFileSync(resolve('artifacts', 'mobile-layout-audit.json'), JSON.stringify(report, null, 2));
  if (failures.length) throw new Error(`Мобильная компоновка не прошла проверку: ${JSON.stringify(failures)}`);
  console.log(`Мобильная компоновка проверена на ${cases.map((item) => `${item.width}×${item.height}`).join(' и ')}: горизонтального сдвига нет; после ввода следуют результаты, карта и контрольные точки.`);
  socket.close();
} finally {
  edge.kill();
}
