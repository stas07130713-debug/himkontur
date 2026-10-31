import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNewerRelease, parseLatestYml } from './update-metadata.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.HIMKONTUR_LOCAL_PORT ?? '32174');
const PROJECT_EOL_ENDPOINT = 'https://weatherapi.projecteol.ru/mcp/';
const CURRENT_DIRECTORY = resolve(fileURLToPath(new URL('.', import.meta.url)));
const { autoUpdater } = electronUpdater;
const WEB_ROOT = resolve(CURRENT_DIRECTORY, '..', 'dist');
const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.pmtiles': 'application/vnd.pmtiles',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
});

let mainWindow = null;
let localServer = null;
let pendingScenario = null;
let tileCacheRoot = null;
let updateTimer = null;
let lastUpdateStatus = { state: 'idle', version: app.getVersion() };
let updateCheckInFlight = null;
let lastUpdateCheckAt = 0;
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_CHECK_COOLDOWN_MS = 2 * 60 * 1000;
const UPDATE_MANIFEST_URL = 'https://github.com/stas07130713-debug/himkontur/releases/latest/download/latest.yml';
const UPDATE_RELEASE_API_URL = 'https://api.github.com/repos/stas07130713-debug/himkontur/releases/latest';
const UPDATE_DOWNLOAD_BASE_URL = 'https://github.com/stas07130713-debug/himkontur/releases/latest/download';
let latestReleaseMetadata = null;
let downloadedInstallerPath = '';
let autoUpdaterReady = false;

function sendUpdateStatus(status) {
  lastUpdateStatus = status;
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('himkontur:update-status', status);
  }
}

function friendlyUpdateError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/net::|network|ENOTFOUND|ETIMEDOUT|ERR_/iu.test(raw)) {
    return 'Нет связи с сервером обновлений. Программа продолжает работать автономно.';
  }
  return 'Не удалось проверить или загрузить обновление. Повторите позднее.';
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLatestReleaseMetadata() {
  try {
    const response = await fetchWithTimeout(`${UPDATE_MANIFEST_URL}?ts=${Date.now()}`, 20_000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parseLatestYml(await response.text());
    if (parsed === null) throw new Error('Некорректный latest.yml');
    return {
      version: parsed.version,
      installerUrl: `${UPDATE_DOWNLOAD_BASE_URL}/${encodeURIComponent(parsed.path)}`,
      sha512: parsed.sha512,
    };
  } catch {
    const response = await fetchWithTimeout(`${UPDATE_RELEASE_API_URL}?ts=${Date.now()}`, 20_000);
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const release = await response.json();
    const version = String(release?.tag_name ?? '').replace(/^v/iu, '');
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const installer = assets.find((asset) => /HIMKONTUR-.*-Setup\.exe$/iu.test(String(asset?.name ?? '')))
      ?? assets.find((asset) => /HIMKONTUR-Windows-Setup\.exe$/iu.test(String(asset?.name ?? '')));
    const installerUrl = String(installer?.browser_download_url ?? '');
    if (version === '' || installerUrl === '') throw new Error('В выпуске не найден установщик Windows.');
    return { version, installerUrl, sha512: '' };
  }
}

async function downloadInstallerDirect(metadata) {
  const safeVersion = metadata.version.replace(/[^0-9A-Za-z.-]/gu, '');
  const destination = join(app.getPath('temp'), `HIMKONTUR-${safeVersion}-Setup.exe`);
  const partial = `${destination}.part`;
  if (existsSync(partial)) unlinkSync(partial);
  const response = await fetch(metadata.installerUrl, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok || response.body === null) throw new Error(`Сервер обновлений вернул HTTP ${response.status}.`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const output = createWriteStream(partial);
  const hash = createHash('sha512');
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      hash.update(chunk);
      if (!output.write(chunk)) await once(output, 'drain');
      sendUpdateStatus({
        state: 'downloading', version: metadata.version,
        ...(total > 0 ? { percent: Math.max(0, Math.min(100, Math.round(received / total * 100))) } : {}),
      });
    }
    output.end();
    await once(output, 'finish');
    const actualSha512 = hash.digest('base64');
    if (metadata.sha512 !== '' && actualSha512 !== metadata.sha512) throw new Error('Контрольная сумма установщика не совпала.');
    if (existsSync(destination)) unlinkSync(destination);
    renameSync(partial, destination);
    return destination;
  } catch (error) {
    output.destroy();
    if (existsSync(partial)) unlinkSync(partial);
    throw error;
  }
}

async function checkForApplicationUpdate({ force = false } = {}) {
  if (!app.isPackaged) return { state: 'development', version: app.getVersion() };
  if (updateCheckInFlight !== null) return updateCheckInFlight;
  if (!force && Date.now() - lastUpdateCheckAt < UPDATE_CHECK_COOLDOWN_MS) return lastUpdateStatus;
  lastUpdateCheckAt = Date.now();
  updateCheckInFlight = (async () => {
    let metadataError = null;
    try {
      latestReleaseMetadata = await fetchLatestReleaseMetadata();
      if (isNewerRelease(latestReleaseMetadata.version, app.getVersion())) {
        sendUpdateStatus({ state: 'available', version: latestReleaseMetadata.version });
      }
    } catch (error) {
      metadataError = error;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (latestReleaseMetadata !== null && isNewerRelease(latestReleaseMetadata.version, app.getVersion())) {
        sendUpdateStatus({ state: 'available', version: latestReleaseMetadata.version });
      } else {
        const result = { state: 'error', message: friendlyUpdateError(metadataError ?? error) };
        sendUpdateStatus(result);
      }
    }
    return lastUpdateStatus;
  })()
    .finally(() => { updateCheckInFlight = null; });
  return updateCheckInFlight;
}

function configureUpdates() {
  // The GitHub provider first calls api.github.com. Some providers allow the
  // release download itself but block that API domain, so installed copies
  // never learn that an update exists. The generic feed follows GitHub's
  // stable /releases/latest/download redirect and reads the same signed
  // latest.yml without depending on api.github.com.
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://github.com/stas07130713-debug/himkontur/releases/latest/download',
    useMultipleRangeRequest: false
  });
  // First tell the user that a new version exists. A 400+ MB installer must
  // not be downloaded silently on a metered or slow connection.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => {
    if (lastUpdateStatus.state !== 'available') sendUpdateStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    autoUpdaterReady = true;
    sendUpdateStatus({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => {
    if (latestReleaseMetadata === null || !isNewerRelease(latestReleaseMetadata.version, app.getVersion())) {
      sendUpdateStatus({ state: 'current', version: info.version });
    }
  });
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus({
    state: 'downloading',
    percent: Math.max(0, Math.min(100, Math.round(progress.percent)))
  }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (error) => {
    if (latestReleaseMetadata !== null && isNewerRelease(latestReleaseMetadata.version, app.getVersion())) {
      sendUpdateStatus({ state: 'available', version: latestReleaseMetadata.version });
    } else {
      sendUpdateStatus({ state: 'error', message: friendlyUpdateError(error) });
    }
  });

  ipcMain.handle('himkontur:update-version', () => app.getVersion());
  ipcMain.handle('himkontur:update-status-current', () => lastUpdateStatus);
  ipcMain.handle('himkontur:update-check', async () => {
    sendUpdateStatus({ state: 'checking', version: app.getVersion() });
    return checkForApplicationUpdate({ force: true });
  });
  ipcMain.handle('himkontur:update-download', async () => {
    try {
      sendUpdateStatus({ state: 'downloading', version: lastUpdateStatus.version, percent: 0 });
      if (autoUpdaterReady) {
        try {
          await autoUpdater.downloadUpdate();
          return lastUpdateStatus;
        } catch {
          autoUpdaterReady = false;
        }
      }
      latestReleaseMetadata ??= await fetchLatestReleaseMetadata();
      if (!isNewerRelease(latestReleaseMetadata.version, app.getVersion())) {
        const current = { state: 'current', version: app.getVersion() };
        sendUpdateStatus(current);
        return current;
      }
      downloadedInstallerPath = await downloadInstallerDirect(latestReleaseMetadata);
      sendUpdateStatus({ state: 'downloaded', version: latestReleaseMetadata.version });
      return lastUpdateStatus;
    } catch (error) {
      const result = { state: 'error', message: friendlyUpdateError(error) };
      sendUpdateStatus(result);
      return result;
    }
  });
  ipcMain.handle('himkontur:update-install', () => {
    if (downloadedInstallerPath !== '' && existsSync(downloadedInstallerPath)) {
      sendUpdateStatus({ state: 'installing', version: lastUpdateStatus.version });
      void shell.openPath(downloadedInstallerPath).then((error) => {
        if (error === '') setTimeout(() => app.quit(), 1_000);
        else sendUpdateStatus({ state: 'error', message: 'Не удалось запустить установщик обновления.' });
      });
      return { state: 'installing' };
    }
    autoUpdater.quitAndInstall(false, true);
    return { state: 'installing' };
  });
}

function configureWeatherBridge() {
  ipcMain.handle('himkontur:weather-forecast', async (_event, rawOptions) => {
    const latitude = Number(rawOptions?.latitude);
    const longitude = Number(rawOptions?.longitude);
    const hours = Math.max(1, Math.min(12, Math.round(Number(rawOptions?.hours))));
    const start = new Date(String(rawOptions?.start ?? ''));
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(hours) || Number.isNaN(start.getTime())) {
      throw new Error('Некорректные параметры запроса погоды.');
    }
    const response = await fetch(PROJECT_EOL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': `HIMKONTUR-Windows/${app.getVersion()}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `himkontur-${Date.now()}`,
        method: 'tools/call',
        params: {
          name: 'get_weather_forecast',
          arguments: {
            latitude,
            longitude,
            start: start.toISOString(),
            hours,
            parameters: [
              'air_temperature_2m',
              'wind_speed_10m',
              'wind_direction_10m',
              'cloud_area_fraction',
              'surface_snow_thickness'
            ],
            interpolation: 'linear'
          }
        }
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`Сервис погоды вернул HTTP ${response.status}.`);
    const payload = await response.text();
    if (payload.length === 0) throw new Error('Сервис погоды вернул пустой ответ.');
    return { payload };
  });
}

function queueScenario(argumentsList) {
  const path = argumentsList.find((value) => typeof value === 'string' && value.toLowerCase().endsWith('.himkontur') && existsSync(value));
  if (path === undefined) return false;
  try {
    pendingScenario = JSON.stringify(JSON.parse(readFileSync(path, 'utf8')));
    return true;
  } catch {
    return false;
  }
}

function safeFilePath(rawUrl) {
  const pathname = decodeURIComponent(new URL(rawUrl, `http://${HOST}:${PORT}`).pathname);
  const relative = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/u, '');
  const candidate = resolve(join(WEB_ROOT, relative));
  return candidate.startsWith(`${WEB_ROOT}\\`) || candidate === WEB_ROOT ? candidate : null;
}

function remoteTileUrl(rawUrl) {
  const pathname = decodeURIComponent(new URL(rawUrl, `http://${HOST}:${PORT}`).pathname);
  const osm = pathname.match(/^\/map-tiles\/osm\/(\d+)\/(\d+)\/(\d+)\.png$/u);
  if (osm !== null) return `https://tile.openstreetmap.org/${osm[1]}/${osm[2]}/${osm[3]}.png`;
  const esri = pathname.match(/^\/map-tiles\/esri\/(\d+)\/(\d+)\/(\d+)$/u);
  if (esri !== null) return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${esri[1]}/${esri[2]}/${esri[3]}`;
  return null;
}

async function serveRemoteTile(request, response, url) {
  const parsed = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  const cacheKey = parsed.pathname.replace(/^\/+|\/+$/gu, '').replaceAll('/', '\\');
  const cachePath = tileCacheRoot === null ? null : resolve(tileCacheRoot, cacheKey);
  if (cachePath !== null && cachePath.startsWith(`${tileCacheRoot}\\`) && existsSync(cachePath)) {
    response.writeHead(200, {
      'Content-Type': cachePath.includes('\\osm\\') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*'
    });
    createReadStream(cachePath).pipe(response);
    return;
  }
  try {
    const upstream = await fetch(url, {
      headers: {
        'Accept': 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
        'User-Agent': `HIMKONTUR/${app.getVersion()} (local emergency-planning application)`
      },
      signal: AbortSignal.timeout(12_000)
    });
    if (!upstream.ok || upstream.body === null) {
      response.writeHead(upstream.status || 502, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Картографическая подложка недоступна.');
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (cachePath !== null && cachePath.startsWith(`${tileCacheRoot}\\`)) {
      mkdirSync(resolve(cachePath, '..'), { recursive: true });
      writeFileSync(cachePath, buffer);
    }
    response.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else response.end(buffer);
  } catch {
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Картографическая подложка недоступна.');
  }
}

function startServer() {
  return new Promise((resolvePromise, reject) => {
    localServer = createServer((request, response) => {
      const tileUrl = remoteTileUrl(request.url ?? '/');
      if (tileUrl !== null) {
        void serveRemoteTile(request, response, tileUrl);
        return;
      }
      if (request.url === '/startup-scenario') {
        if (pendingScenario === null) {
          response.writeHead(204);
          response.end();
          return;
        }
        const payload = pendingScenario;
        pendingScenario = null;
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(payload);
        return;
      }
      const filePath = safeFilePath(request.url ?? '/');
      if (filePath === null || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Файл не найден.');
        return;
      }
      const fileSize = statSync(filePath).size;
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/u);
      if (range !== undefined && range !== null) {
        const start = Number(range[1]);
        const requestedEnd = range[2] === '' ? fileSize - 1 : Number(range[2]);
        const end = Math.min(requestedEnd, fileSize - 1);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= fileSize) {
          response.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
          response.end();
          return;
        }
        response.writeHead(206, {
          'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY'
        });
        if (request.method === 'HEAD') response.end();
        else createReadStream(filePath, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filePath).pipe(response);
    });
    localServer.once('error', reject);
    localServer.listen(PORT, HOST, resolvePromise);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#edf1ef',
    icon: join(CURRENT_DIRECTORY, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    // Use the native Windows title bar. Overlay controls were drawn inside the
    // application toolbar and could cover the theme/history buttons at some
    // display scales. The native frame keeps the system controls in their own
    // non-client area at every DPI and window width.
    titleBarStyle: 'default',
    show: false,
    webPreferences: {
      preload: join(CURRENT_DIRECTORY, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//iu.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Older desktop builds registered the PWA service worker on the same local
  // origin. It can survive an application update and keep serving the old UI
  // from Cache Storage even though the executable and dist files are newer.
  // The desktop build is already fully local, so it must never use the PWA
  // cache. Clear the legacy worker/cache before the first navigation.
  await mainWindow.webContents.session.clearStorageData({
    origin: `http://${HOST}:${PORT}`,
    storages: ['serviceworkers', 'cachestorage']
  });
  await mainWindow.webContents.session.clearCache();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  await mainWindow.loadURL(`http://${HOST}:${PORT}/${pendingScenario === null ? '' : '?scenario=1'}`);
  mainWindow.on('focus', () => void checkForApplicationUpdate());
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function bootstrap() {
  await app.whenReady();
  configureUpdates();
  configureWeatherBridge();
  tileCacheRoot = resolve(app.getPath('userData'), 'map-tile-cache');
  mkdirSync(tileCacheRoot, { recursive: true });
  queueScenario(process.argv);
  await startServer();
  await createWindow();
  if (app.isPackaged) {
    setTimeout(() => void checkForApplicationUpdate({ force: true }), 3_000);
    updateTimer = setInterval(() => void checkForApplicationUpdate(), UPDATE_CHECK_INTERVAL_MS);
    powerMonitor.on('resume', () => void checkForApplicationUpdate());
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const hasScenario = queueScenario(commandLine);
    if (mainWindow?.isMinimized()) mainWindow.restore();
    if (hasScenario) void mainWindow?.loadURL(`http://${HOST}:${PORT}/?scenario=1`);
    mainWindow?.focus();
  });
  void bootstrap();
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (updateTimer !== null) clearInterval(updateTimer);
    localServer?.close();
  });
}
