import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:5178/';
const output = resolve('artifacts', 'ui-current-zone.png');
const traceOutput = resolve('artifacts', 'ui-current-trace.png');
const rotationOutput = resolve('artifacts', 'ui-current-rotation.png');
const darkOutput = resolve('artifacts', 'ui-current-dark.png');
const customSourceOutput = resolve('artifacts', 'ui-current-custom-source.png');
const dangerousGoodsOutput = resolve('artifacts', 'ui-current-dangerous-goods.png');
const darkSubstanceOutput = resolve('artifacts', 'ui-current-substance-dark.png');
const compactOutput = resolve('artifacts', 'ui-current-compact.png');
const port = 9300 + Math.floor(Math.random() * 500);
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
mkdirSync(resolve('artifacts'), { recursive: true });

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  '--window-size=1920,1080', '--hide-scrollbars', pageUrl
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 30 && target === undefined; attempt += 1) {
    await delay(300);
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page' && item.url.startsWith(pageUrl));
    } catch { /* browser is starting */ }
  }
  if (target?.webSocketDebuggerUrl === undefined) throw new Error('Browser target was not created.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
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
  const command = (method, params = {}) => new Promise((resolveCommand, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => message.error === undefined ? resolveCommand(message.result) : reject(new Error(message.error.message)));
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Runtime.enable');
  await delay(2500);
  await command('Runtime.evaluate', { expression: `(async () => {
    const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
    window.confirm = () => true;
    const source = document.querySelector('.source-card');
    const stage = document.querySelector('.map-stage');
    const map = document.querySelector('.map-stage svg');
    if (!(source instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(map instanceof SVGElement)) throw new Error('QA controls missing');
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = stage.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, clientX: rect.left + rect.width * .5, clientY: rect.top + rect.height * .57, dataTransfer: transfer };
    map.dispatchEvent(new DragEvent('dragover', options));
    map.dispatchEvent(new DragEvent('drop', options));
    await wait(200);
    [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Рассчитать'))?.click();
    await wait(900);
    const control = document.querySelector('.control-template-grid button');
    if (control instanceof HTMLElement) {
      const controlTransfer = new DataTransfer();
      control.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: controlTransfer }));
      const controlOptions = { bubbles: true, cancelable: true, clientX: rect.left + rect.width * .68, clientY: rect.top + rect.height * .58, dataTransfer: controlTransfer };
      map.dispatchEvent(new DragEvent('dragover', controlOptions));
      map.dispatchEvent(new DragEvent('drop', controlOptions));
    }
    await wait(900);
  })()`, awaitPromise: true });
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
  await command('Runtime.evaluate', { expression: `(() => { const button = document.querySelector('button[title="Повернуть карту на 15° по часовой стрелке"]'); button?.click(); button?.click(); button?.click(); })()` });
  await delay(350);
  const rotationScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(rotationOutput, Buffer.from(rotationScreenshot.data, 'base64'));
  await command('Runtime.evaluate', { expression: `document.querySelector('button[title="Сбросить поворот: север вверх"]')?.click()` });
  await delay(250);
  await command('Runtime.evaluate', { expression: `document.querySelector('button[title="Тёмная тема"]')?.click()` });
  await delay(250);
  const darkScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(darkOutput, Buffer.from(darkScreenshot.data, 'base64'));
  await command('Runtime.evaluate', { expression: `document.querySelector('button[title="Светлая тема"]')?.click()` });
  await delay(250);
  await command('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Проверить расчёт'))?.click()` });
  await delay(300);
  const traceScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(traceOutput, Buffer.from(traceScreenshot.data, 'base64'));
  await command('Runtime.evaluate', { expression: `(() => { document.querySelector('.trace-dialog .icon-button')?.click(); document.querySelector('.substance-picker-button')?.click(); })()` });
  await delay(150);
  await command('Runtime.evaluate', { expression: `(() => { const option = [...document.querySelectorAll('.substance-options button')].find((item) => item.textContent?.includes('Акролеин')); option?.click(); })()` });
  await delay(350);
  await command('Runtime.evaluate', { expression: `(() => { const mode = document.querySelector('.custom-source-card select'); if (mode instanceof HTMLSelectElement) { mode.value = 'pipeline'; mode.dispatchEvent(new Event('change', { bubbles: true })); } })()` });
  await delay(350);
  const customSourceScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(customSourceOutput, Buffer.from(customSourceScreenshot.data, 'base64'));
  await command('Runtime.evaluate', { expression: `(() => { [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Опасный груз'))?.click(); })()` });
  await delay(800);
  const dangerousGoodsScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(dangerousGoodsOutput, Buffer.from(dangerousGoodsScreenshot.data, 'base64'));
  await command('Runtime.evaluate', { expression: `(() => { [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Расчёт АХОВ'))?.click(); document.documentElement.dataset.theme = 'dark'; })()` });
  await delay(350);
  await command('Runtime.evaluate', { expression: `document.querySelector('.substance-picker-button')?.click()` });
  await delay(150);
  const darkSubstanceScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(darkSubstanceOutput, Buffer.from(darkSubstanceScreenshot.data, 'base64'));
  await command('Runtime.evaluate', { expression: `document.querySelector('.substance-picker-button')?.click()` });
  await command('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(250);
  const compactState = await command('Runtime.evaluate', { expression: `(() => { const tabs = [...document.querySelectorAll('.main-tabs button')].map((node) => ({ text: node.textContent.trim(), display: getComputedStyle(node).display, width: node.getBoundingClientRect().width })); const map = document.querySelector('.map-column')?.getBoundingClientRect(); const right = document.querySelector('.right-column')?.getBoundingClientRect(); return { tabs, sameRow: Boolean(map && right && Math.abs(map.top - right.top) < 2) }; })()`, returnByValue: true });
  if (compactState.result.value.tabs.some((tab) => tab.display === 'none' || tab.width < 80) || !compactState.result.value.sameRow) throw new Error(`Compact layout failed: ${JSON.stringify(compactState.result.value)}`);
  const compactScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(compactOutput, Buffer.from(compactScreenshot.data, 'base64'));
  socket.close();
  console.log(`${output}\n${rotationOutput}\n${darkOutput}\n${traceOutput}\n${customSourceOutput}\n${dangerousGoodsOutput}\n${darkSubstanceOutput}\n${compactOutput}`);
} finally {
  edge.kill();
}
