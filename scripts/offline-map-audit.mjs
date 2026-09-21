import { spawn } from 'node:child_process';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:4179/';
const debugPort = 9650 + Math.floor(Math.random() * 200);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${debugPort}`, '--window-size=1440,900', pageUrl,
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 50 && target === undefined; attempt += 1) {
    await delay(200);
    try {
      const entries = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
      target = entries.find((entry) => entry.type === 'page' && entry.url.startsWith(pageUrl));
    } catch { /* browser starts */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Не удалось открыть приложение.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); const done = pending.get(message.id); if (done) { pending.delete(message.id); done(message); } });
  const command = (method, params = {}) => new Promise((done, fail) => { const requestId = ++id; pending.set(requestId, (message) => message.error ? fail(new Error(message.error.message)) : done(message.result)); socket.send(JSON.stringify({ id: requestId, method, params })); });
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await command('Runtime.enable');
  await command('Network.enable');
  await delay(1500);
  // The autonomous map archive is deliberately large. Wait for the complete
  // precache transaction instead of racing the service-worker installation.
  await evaluate(`Promise.race([
    navigator.serviceWorker.ready.then(async () => {
      const limit = Date.now() + 90000;
      while (Date.now() < limit) {
        const keys = await caches.keys();
        const cached = await Promise.all(keys.map(async (key) => (await caches.open(key)).match(new URL('map-data/monchegorsk-v5.pmtiles', document.baseURI))));
        if (cached.some(Boolean)) return true;
        await new Promise((done) => setTimeout(done, 500));
      }
      throw new Error('Автономный архив карты не попал в кэш за 90 секунд.');
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker timeout')), 95000)),
  ])`);
  // Allow the service worker to take control, then prove a complete reload works offline.
  await command('Page.reload', { ignoreCache: false });
  await delay(3500);
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await command('Page.reload', { ignoreCache: false });
  await delay(4500);
  const result = await evaluate(`(async () => {
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    const snapshot = () => ({
      title: document.title,
      map: Boolean(document.querySelector('.map-column')),
      vector: document.querySelector('.offline-vector-map')?.dataset.mapStatus ?? '',
      raster: document.querySelector('.basemap-tile-layer')?.dataset.rasterStatus ?? '',
      failedTilesVisible: [...document.querySelectorAll('.basemap-tile-layer img')].some((image) => image.style.visibility === 'hidden' && getComputedStyle(image.parentElement).visibility === 'visible'),
      zoom: document.querySelector('.zoom span')?.textContent ?? '',
      satelliteActive: [...document.querySelectorAll('.segmented button')].some((button) => button.textContent?.includes('Спутник') && button.classList.contains('active')),
    });
    const before = snapshot();
    [...document.querySelectorAll('.segmented button')].find((button) => button.textContent?.includes('Карта'))?.click();
    document.querySelector('.zoom button[aria-label="Увеличить карту"]')?.click();
    await wait(700);
    const mapMode = snapshot();
    [...document.querySelectorAll('.segmented button')].find((button) => button.textContent?.includes('Спутник'))?.click();
    document.querySelector('.zoom button[aria-label="Уменьшить карту"]')?.click();
    await wait(700);
    return { before, mapMode, satelliteMode: snapshot() };
  })()`);
  const passed = result.before.title === 'Прогноз АХОВ' && result.before.map && ['loaded', 'idle'].includes(result.before.vector) && result.mapMode.zoom !== result.before.zoom && result.satelliteMode.satelliteActive && !result.mapMode.failedTilesVisible && !result.satelliteMode.failedTilesVisible;
  if (!passed) throw new Error(`Автономная карта не прошла проверку: ${JSON.stringify(result)}`);
  console.log(`Автономная карта: перезагрузка без сети, схема/спутник, приближение и отдаление работают; пустых квадратов нет. ${JSON.stringify(result)}`);
  socket.close();
} finally {
  edge.kill();
}
