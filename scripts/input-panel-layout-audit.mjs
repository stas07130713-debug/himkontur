import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:5178/';
const port = 9900 + Math.floor(Math.random() * 80);
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=1920,1080', pageUrl,
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 40 && target === undefined; attempt += 1) {
    await delay(250);
    try {
      const entries = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = entries.find((entry) => entry.type === 'page' && entry.url.startsWith(pageUrl));
    } catch { /* Browser is starting. */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Не удалось открыть страницу.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data);
    const handler = pending.get(value.id);
    if (handler) { pending.delete(value.id); handler(value); }
  });
  const command = (method, params = {}) => new Promise((resolveCommand, reject) => {
    const id = ++nextId;
    pending.set(id, (value) => value.error ? reject(new Error(value.error.message)) : resolveCommand(value.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await delay(1000);
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  const labels = await evaluate(`(async () => {
    const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
    document.querySelector('.substance-picker-button')?.click();
    await wait(30);
    const values = [...document.querySelectorAll('.substance-options button')].map((button) => button.textContent?.trim() ?? '');
    document.querySelector('.substance-picker-button')?.click();
    return values;
  })()`);
  const cases = [];
  for (const height of [900, 1080]) {
    await command('Emulation.setDeviceMetricsOverride', { width: 1920, height, deviceScaleFactor: 1, mobile: false });
    for (let index = 0; index < labels.length; index += 1) {
      const value = await evaluate(`(async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const picker = document.querySelector('.substance-picker-button');
        picker?.click();
        await wait(10);
        [...document.querySelectorAll('.substance-options button')][${index}]?.click();
        await wait(10);
        const details = document.querySelector('.custom-source-card') || document.querySelector('.source-editor');
        if (details) details.open = false;
        const panel = document.querySelector('.input-panel');
        const scroll = document.querySelector('.input-panel-scroll');
        scroll.scrollTop = 0;
        const button = document.querySelector('.calculate-button');
        const collapsed = { panelOverflowY: getComputedStyle(panel).overflowY, scrollOverflowY: getComputedStyle(scroll).overflowY,
          noScrollNeeded: scroll.scrollHeight <= scroll.clientHeight + 1,
          clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight,
          buttonVisible: button.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1,
          detailsCollapsed: details === null || !details.open };
        if (details) details.open = true;
        await wait(5);
        scroll.scrollTop = scroll.scrollHeight;
        const expanded = { panelOverflowY: getComputedStyle(panel).overflowY, scrollOverflowY: getComputedStyle(scroll).overflowY,
          buttonReachable: button.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1 };
        if (details) details.open = false;
        return { collapsed, expanded };
      })()`);
      cases.push({ height, substance: labels[index], ...value });
    }
  }
  const failures = cases.filter((item) => item.collapsed.panelOverflowY !== 'hidden' || item.collapsed.scrollOverflowY !== 'auto' || !item.collapsed.noScrollNeeded || !item.collapsed.buttonVisible || !item.collapsed.detailsCollapsed || item.expanded.panelOverflowY !== 'hidden' || item.expanded.scrollOverflowY !== 'auto' || !item.expanded.buttonReachable);
  const result = { checked: cases.length, substances: labels.length, heights: [900, 1080], failures, passed: failures.length === 0 };
  mkdirSync(resolve('artifacts'), { recursive: true });
  writeFileSync(resolve('artifacts', 'input-panel-layout-audit.json'), JSON.stringify(result, null, 2));
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(async () => {
    const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
    document.querySelector('.substance-picker-button')?.click();
    await wait(10);
    [...document.querySelectorAll('.substance-options button')].find((button) => button.textContent?.includes('Аммиак — изотермическое хранение'))?.click();
    await wait(20);
    const details = document.querySelector('.custom-source-card');
    if (details) details.open = false;
  })()`);
  const collapsedShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve('artifacts', 'input-panel-ammonia-collapsed.png'), Buffer.from(collapsedShot.data, 'base64'));
  await evaluate(`(() => { const details = document.querySelector('.custom-source-card'); if (details) details.open = true; })()`);
  const expandedShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve('artifacts', 'input-panel-ammonia-expanded.png'), Buffer.from(expandedShot.data, 'base64'));
  if (!result.passed) throw new Error(`Проверка левой панели не пройдена: ${JSON.stringify(result)}`);
  console.log(`Левая панель: проверено ${result.checked} состояний (${result.substances} веществ × ${result.heights.length} высоты); свернутый режим помещается, раскрытый прокручивается, кнопка расчёта доступна.`);
  socket.close();
} finally {
  edge.kill();
}
