import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:4176/';
const port = 9400 + Math.floor(Math.random() * 400);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const viewports = [
  { name: 'web-1920x1080', width: 1920, height: 1080, mobile: false },
  { name: 'windows-1366x768', width: 1366, height: 768, mobile: false },
  { name: 'windows-1024x768', width: 1024, height: 768, mobile: false },
  { name: 'android-430x932', width: 430, height: 932, mobile: true },
  { name: 'android-390x844', width: 390, height: 844, mobile: true },
];

mkdirSync(resolve('artifacts', 'ui-matrix'), { recursive: true });
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=1920,1080', pageUrl,
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 40 && target === undefined; attempt += 1) {
    await delay(250);
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page' && item.url.startsWith(pageUrl));
    } catch { /* browser starts */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Не удалось открыть приложение для проверки экранов.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (handler) { pending.delete(message.id); handler(message); }
  });
  const command = (method, params = {}) => new Promise((done, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : done(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await command('Runtime.enable');
  await command('Page.enable');
  await delay(1200);

  const results = [];
  for (const viewport of viewports) {
    await command('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    for (const theme of ['light', 'dark']) {
      for (const tab of ['calculation', 'goods']) {
        await evaluate(`(async () => {
          const wait = (ms) => new Promise((done) => setTimeout(done, ms));
          document.querySelector('button[title="${theme === 'light' ? 'Светлая тема' : 'Тёмная тема'}"]')?.click();
          [...document.querySelectorAll('.main-tabs button')].find((button) => button.textContent?.includes('${tab === 'calculation' ? 'Расчёт АХОВ' : 'Опасный груз'}'))?.click();
          await wait(180);
          if ('${tab}' === 'goods') {
            const input = document.querySelector('.goods-search-box input');
            if (input) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, '1824'); input.dispatchEvent(new Event('input', { bubbles: true })); await wait(80);
              document.querySelector('.goods-search-results button')?.click(); await wait(120);
            }
          }
          window.scrollTo(0, 0);
        })()`);
        const state = await evaluate(`(() => {
          const visible = (node) => node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
          const inside = (rect) => rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1;
          const tabs = [...document.querySelectorAll('.main-tabs button')];
          const themes = [...document.querySelectorAll('.theme-switch button')];
          const headerControls = [...document.querySelectorAll('.file-actions > button, .file-actions > .theme-switch')].filter(visible);
          const controlRects = headerControls.map((node) => node.getBoundingClientRect());
          const headerOverlap = controlRects.some((left, index) => controlRects.slice(index + 1).some((right) =>
            Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
            Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
          ));
          const directActionWidths = [...document.querySelectorAll('.file-actions > button')].filter(visible).map((node) => node.getBoundingClientRect().width);
          const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
          const scroll = document.querySelector('.input-panel-scroll');
          const map = document.querySelector('.map-column')?.getBoundingClientRect();
          const sheet = document.querySelector('.emergency-sheet')?.getBoundingClientRect();
          const overflowingText = [...document.querySelectorAll('h1,h2,h3,button,strong,span,label')]
            .filter((node) => visible(node) && node.scrollWidth > node.clientWidth + 3 && getComputedStyle(node).textOverflow !== 'ellipsis')
            .slice(0, 12).map((node) => ({ cls: String(node.className), text: node.textContent.trim().slice(0, 70), client: node.clientWidth, scroll: node.scrollWidth }));
          return {
            pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            tabsVisible: tabs.length === 2 && tabs.every((node) => visible(node) && inside(node.getBoundingClientRect()) && node.querySelector('.main-tab-icon')),
            themesVisible: themes.length === 2 && themes.every((node) => visible(node) && inside(node.getBoundingClientRect())),
            headerOverlap,
            actionButtonsUniform: innerWidth <= 720 || directActionWidths.length < 2 || Math.max(...directActionWidths) - Math.min(...directActionWidths) <= 1,
            topbarInside: topbar ? inside(topbar) : false,
            inputNeedsScroll: scroll ? scroll.scrollHeight > scroll.clientHeight + 1 : false,
            calculateVisible: (() => { const node = document.querySelector('.calculate-button'); return !node || node.getBoundingClientRect().bottom <= innerHeight + 1; })(),
            primaryAreaValid: '${tab}' === 'calculation' ? Boolean(map && map.width > 250 && map.height > 400) : Boolean(sheet && sheet.width > 300),
            overflowingText,
          };
        })()`);
        const record = { ...viewport, theme, tab, ...state };
        results.push(record);
        const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        writeFileSync(resolve('artifacts', 'ui-matrix', `${viewport.name}-${theme}-${tab}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
  }
  const failures = results.filter((item) => item.pageHorizontalOverflow || !item.tabsVisible || !item.themesVisible || item.headerOverlap || !item.actionButtonsUniform || !item.topbarInside || (!item.mobile && !item.calculateVisible) || !item.primaryAreaValid || (!item.mobile && item.tab === 'calculation' && item.inputNeedsScroll) || item.overflowingText.length > 0);
  const report = { generatedAt: new Date().toISOString(), checked: results.length, viewports, failures, results };
  writeFileSync(resolve('artifacts', 'full-ui-matrix.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Проверено экранов: ${results.length}; ошибок: ${failures.length}.`);
  if (failures.length) throw new Error('Матрица интерфейса обнаружила ошибки. См. artifacts/full-ui-matrix.json');
  socket.close();
} finally {
  edge.kill();
}
