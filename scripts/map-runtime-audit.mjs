import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const port = 10010 + Math.floor(Math.random() * 40);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  '--window-size=430,932', pageUrl,
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
    await delay(200);
    try {
      const entries = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = entries.find((entry) => entry.type === 'page');
    } catch { /* browser is starting */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Не удалось запустить проверку карты.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', fail, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data);
    if (value.method === 'Runtime.consoleAPICalled' && value.params.type === 'error') {
      consoleErrors.push(value.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
    if (value.method === 'Runtime.exceptionThrown') consoleErrors.push(value.params.exceptionDetails.text);
    const done = pending.get(value.id);
    if (done) { pending.delete(value.id); done(value); }
  });
  const command = (method, params = {}) => new Promise((done, fail) => {
    const requestId = ++id;
    pending.set(requestId, (value) => value.error ? fail(new Error(value.error.message)) : done(value.result));
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => (await command('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })).result.value;
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Network.enable');
  await delay(4000);
  mkdirSync(resolve('artifacts'), { recursive: true });
  const serviceWorkerReady = await evaluate(`(async () => {
    if (!('serviceWorker' in navigator)) return false;
    try { const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 8000))]); return Boolean(registration?.active); }
    catch { return false; }
  })()`);

  const inspect = () => evaluate(`(() => {
    const host = document.querySelector('.offline-vector-map');
    const canvas = host?.querySelector('canvas');
    let canvasSignature = '';
    if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
      const sample = document.createElement('canvas');
      sample.width = 32; sample.height = 32;
      const context = sample.getContext('2d', { willReadFrequently: true });
      context?.drawImage(canvas, 0, 0, 32, 32);
      const pixels = context?.getImageData(0, 0, 32, 32).data ?? [];
      let hash = 2166136261;
      for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
      canvasSignature = (hash >>> 0).toString(16);
    }
    return {
      status: host?.dataset.mapStatus ?? 'missing',
      error: host?.dataset.mapError ?? '',
      basemap: host?.dataset.basemap ?? '',
      satelliteLoaded: host?.dataset.satelliteLoaded ?? '',
      canvasSignature,
      sourceReady: host?.dataset.sourceReady ?? '',
      styleLoaded: host?.dataset.styleLoaded ?? '',
      zoom: host?.dataset.mapZoom ?? '',
      center: host?.dataset.mapCenter ?? '',
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      hostWidth: Math.round(host?.getBoundingClientRect().width ?? 0),
      hostHeight: Math.round(host?.getBoundingClientRect().height ?? 0),
    };
  })()`);

  const cases = [];
  for (const size of [{ width: 430, height: 932 }, { width: 844, height: 390 }, { width: 1440, height: 940 }]) {
    await command('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: size.width < 900 });
    await delay(1500);
    cases.push({ name: `online-standard-${size.width}x${size.height}`, ...(await inspect()) });
  }
  const beforeZoom = await inspect();
  await evaluate(`document.querySelector('button[aria-label="Увеличить карту"]')?.click()`);
  await delay(1000);
  const afterZoom = await inspect();
  cases.push({ name: 'zoom-control', ...afterZoom, changed: Number(afterZoom.zoom) > Number(beforeZoom.zoom) });
  const stage = await evaluate(`(() => { const r = document.querySelector('.map-stage')?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null; })()`);
  if (stage !== null) {
    const x = stage.x + stage.width * 0.28;
    const y = stage.y + stage.height * 0.72;
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 90, y: y - 45, button: 'left', buttons: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 90, y: y - 45, button: 'left', clickCount: 1 });
    await delay(1000);
    const afterPan = await inspect();
    cases.push({ name: 'pan-control', ...afterPan, changed: afterPan.center !== afterZoom.center });
  }
  const standardBeforeSatellite = await inspect();
  await evaluate(`document.querySelector('.map-toolbar .segmented button:nth-child(2)')?.click()`);
  await delay(3500);
  const onlineSatellite = await inspect();
  cases.push({
    name: 'online-satellite-switch',
    ...onlineSatellite,
    changed: onlineSatellite.canvasSignature !== standardBeforeSatellite.canvasSignature,
  });
  await evaluate(`document.querySelector('.map-toolbar .segmented button:nth-child(1)')?.click()`);
  await delay(1200);
  const standardAgain = await inspect();
  cases.push({ name: 'online-standard-switch-back', ...standardAgain, changed: standardAgain.basemap === 'standard' });
  await command('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await evaluate(`window.dispatchEvent(new Event('offline'))`);
  await delay(1200);
  cases.push({ name: 'offline-standard', ...(await inspect()) });
  await evaluate(`document.querySelector('.map-toolbar .segmented button:nth-child(2)')?.click()`);
  await delay(2200);
  cases.push({ name: 'offline-satellite', ...(await inspect()) });
  const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve('artifacts', 'map-offline-audit.png'), Buffer.from(shot.data, 'base64'));
  if (serviceWorkerReady) {
    await command('Page.reload', { ignoreCache: true });
    await delay(6500);
    cases.push({ name: 'cold-start-offline', ...(await inspect()) });
  }
  await command('Network.emulateNetworkConditions', {
    offline: false, latency: 20, downloadThroughput: 5_000_000, uploadThroughput: 1_000_000,
  });
  await evaluate(`window.dispatchEvent(new Event('online'))`);
  await delay(800);
  const beforeRecoverySwitch = await inspect();
  await evaluate(`document.querySelector('.map-toolbar .segmented button:nth-child(2)')?.click()`);
  await delay(3500);
  const recoveredSatellite = await inspect();
  cases.push({
    name: 'online-satellite-recovery-switch',
    ...recoveredSatellite,
    changed: recoveredSatellite.canvasSignature !== beforeRecoverySwitch.canvasSignature,
  });

  const failures = cases.filter((item) => item.status === 'missing' || item.status === 'error' || item.canvasWidth < 100 || item.canvasHeight < 100 || ((item.name.endsWith('-control') || item.name.includes('-switch')) && item.changed !== true) || (item.name.includes('online-satellite') && item.satelliteLoaded !== 'true'));
  const report = { passed: failures.length === 0 && consoleErrors.length === 0, serviceWorkerReady, cases, consoleErrors, failures };
  writeFileSync(resolve('artifacts', 'map-runtime-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
  socket.close();
} finally {
  edge.kill();
}
