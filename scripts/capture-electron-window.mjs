import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const endpoint = process.argv[2] ?? 'http://127.0.0.1:9333/json';
const output = resolve(process.argv[3] ?? 'artifacts/windows-native-window.png');
const action = process.argv[4] ?? '';
const targets = await fetch(endpoint).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:'));
if (target?.webSocketDebuggerUrl === undefined) throw new Error('Окно Electron не найдено.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', rejectOpen, { once: true });
});
let sequence = 0;
const pending = new Map();
const diagnostics = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (callback !== undefined) {
    pending.delete(message.id);
    callback(message);
  }
  if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' || message.method === 'Runtime.consoleAPICalled')
    diagnostics.push({ method: message.method, params: message.params });
});
const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
  sequence += 1;
  const id = sequence;
  pending.set(id, (message) => message.error === undefined ? resolveRequest(message.result) : rejectRequest(new Error(message.error.message)));
  socket.send(JSON.stringify({ id, method, params }));
});

await request('Runtime.enable');
await request('Log.enable');
if (action === 'offline-debug') {
  await request('Page.reload', { ignoreCache: true });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 4_000));
}

if (action === 'map' || action === 'map-zoom-out' || action === 'offline-vector' || action === 'offline-zoom-out' || action === 'offline-debug') {
  await request('Runtime.evaluate', {
    expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Карта'); button?.click(); })()`,
  });
  if (action === 'map-zoom-out' || action === 'offline-zoom-out') {
    await request('Runtime.evaluate', {
      expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Уменьшить карту'); for (let i = 0; i < 8; i += 1) button?.click(); })()`,
    });
  }
  if (action === 'offline-vector' || action === 'offline-zoom-out' || action === 'offline-debug') {
    await request('Runtime.evaluate', {
      expression: `document.querySelector('.basemap-tile-layer').style.display = 'none'`,
    });
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_500));
}
const metrics = await request('Page.getLayoutMetrics');
const tileState = await request('Runtime.evaluate', {
  expression: `JSON.stringify([...document.querySelectorAll('.basemap-tile-layer img')].map((image) => ({ src: image.src, loaded: image.complete && image.naturalWidth > 0, hidden: image.style.visibility === 'hidden' })))`,
  returnByValue: true,
});
const offlineState = await request('Runtime.evaluate', {
  expression: `JSON.stringify({ html: document.querySelector('.offline-vector-map')?.innerHTML, dataset: document.querySelector('.offline-vector-map')?.dataset, resources: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('monchegorsk-v4')).map((entry) => ({ name: entry.name, size: entry.transferSize, duration: entry.duration })), webgl: Boolean(document.querySelector('.offline-vector-map canvas')?.getContext('webgl2')) })`,
  returnByValue: true,
});
const layoutState = await request('Runtime.evaluate', {
  expression: `JSON.stringify((() => { const panel = document.querySelector('.input-panel'); const scroll = document.querySelector('.input-panel-scroll'); const button = document.querySelector('.calculate-button'); return { panelHeight: panel?.clientHeight, scrollClientHeight: scroll?.clientHeight, scrollHeight: scroll?.scrollHeight, scrollTop: scroll?.scrollTop, buttonBottom: button?.getBoundingClientRect().bottom, panelBottom: panel?.getBoundingClientRect().bottom }; })())`,
  returnByValue: true,
});
const screenshot = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
socket.close();
const tiles = JSON.parse(tileState.result.value);
console.log(JSON.stringify({ output, viewport: metrics.cssVisualViewport, tiles: { total: tiles.length, loaded: tiles.filter((tile) => tile.loaded).length, hidden: tiles.filter((tile) => tile.hidden).length, sample: tiles[0]?.src }, offline: JSON.parse(offlineState.result.value), layout: JSON.parse(layoutState.result.value), diagnostics }, null, 2));
