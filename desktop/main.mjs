import { app, BrowserWindow, shell } from 'electron';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.HIMKONTUR_LOCAL_PORT ?? '32174');
const CURRENT_DIRECTORY = resolve(fileURLToPath(new URL('.', import.meta.url)));
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
        'User-Agent': 'HIMKONTUR/0.2.1 (local emergency-planning application)'
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#edf1ef',
    icon: join(CURRENT_DIRECTORY, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#062a3b', symbolColor: '#e8f5f6', height: 32 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//iu.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  void mainWindow.loadURL(`http://${HOST}:${PORT}/${pendingScenario === null ? '' : '?scenario=1'}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function bootstrap() {
  await app.whenReady();
  tileCacheRoot = resolve(app.getPath('userData'), 'map-tile-cache');
  mkdirSync(tileCacheRoot, { recursive: true });
  queueScenario(process.argv);
  await startServer();
  createWindow();
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
  app.on('before-quit', () => localServer?.close());
}
