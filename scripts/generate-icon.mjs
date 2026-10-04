import { app, BrowserWindow, nativeImage } from 'electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import pngjs from 'pngjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CURRENT_DIRECTORY = resolve(fileURLToPath(new URL('.', import.meta.url)));
const targetDirectory = resolve(CURRENT_DIRECTORY, '..', 'build');
const buildData = mkdtempSync(join(tmpdir(), 'himkontur-icon-'));
app.setPath('userData', buildData);
app.setPath('sessionData', buildData);
const { PNG } = pngjs;

function paddedPng(image, targetSize, occupiedRatio) {
  const innerSize = Math.max(1, Math.round(targetSize * occupiedRatio));
  const inner = PNG.sync.read(image.resize({ width: innerSize, height: innerSize, quality: 'best' }).toPNG());
  const canvas = new PNG({ width: targetSize, height: targetSize, colorType: 6 });
  const offset = Math.floor((targetSize - innerSize) / 2);
  PNG.bitblt(inner, canvas, 0, 0, inner.width, inner.height, offset, offset);
  return PNG.sync.write(canvas);
}

async function generateIcon() {
  await app.whenReady();
  const source = resolve(CURRENT_DIRECTORY, '..', 'public', 'icon.svg');
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  let image;
  try {
    await window.loadURL(pathToFileURL(source).toString());
    image = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  } catch {
    // capturePage is unavailable in some headless/remote Windows sessions.
    // The checked-in master PNG keeps icon generation deterministic there.
    image = nativeImage.createFromPath(join(targetDirectory, 'icon.png'));
  }
  if (image.isEmpty()) throw new Error('Не удалось отрисовать исходный SVG значка.');
  writeFileSync(join(targetDirectory, 'icon.png'), image.toPNG());
  const iconPng = image.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
  const iconHeader = Buffer.alloc(22);
  iconHeader.writeUInt16LE(0, 0);
  iconHeader.writeUInt16LE(1, 2);
  iconHeader.writeUInt16LE(1, 4);
  iconHeader.writeUInt8(0, 6);
  iconHeader.writeUInt8(0, 7);
  iconHeader.writeUInt8(0, 8);
  iconHeader.writeUInt8(0, 9);
  iconHeader.writeUInt16LE(1, 10);
  iconHeader.writeUInt16LE(32, 12);
  iconHeader.writeUInt32LE(iconPng.length, 14);
  iconHeader.writeUInt32LE(iconHeader.length, 18);
  writeFileSync(join(targetDirectory, 'icon.ico'), Buffer.concat([iconHeader, iconPng]));
  const androidResources = resolve(CURRENT_DIRECTORY, '..', 'android', 'app', 'src', 'main', 'res');
  // Android launchers apply their own circle/squircle masks. Keep the whole
  // mark inside the adaptive-icon safe zone instead of letting the mask cut
  // off its edges. Legacy icons receive a little more room as well.
  const densities = [
    ['mipmap-mdpi', 48],
    ['mipmap-hdpi', 72],
    ['mipmap-xhdpi', 96],
    ['mipmap-xxhdpi', 144],
    ['mipmap-xxxhdpi', 192]
  ];
  for (const [directory, rawSize] of densities) {
    const size = Number(rawSize);
    const output = join(androidResources, String(directory));
    if (!Number.isFinite(size)) throw new Error('Некорректный размер Android-значка.');
    mkdirSync(output, { recursive: true });
    const legacy = paddedPng(image, size, .76);
    const foreground = paddedPng(image, Math.round(size * 2.25), .58);
    writeFileSync(join(output, 'ic_launcher.png'), legacy);
    writeFileSync(join(output, 'ic_launcher_round.png'), legacy);
    writeFileSync(join(output, 'ic_launcher_foreground.png'), foreground);
  }
  window.destroy();
  app.quit();
}

void generateIcon().catch((error) => {
  console.error(error);
  app.exit(1);
});
