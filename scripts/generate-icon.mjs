import { app, BrowserWindow } from 'electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CURRENT_DIRECTORY = resolve(fileURLToPath(new URL('.', import.meta.url)));
const targetDirectory = resolve(CURRENT_DIRECTORY, '..', 'build');
const buildData = mkdtempSync(join(tmpdir(), 'himkontur-icon-'));
app.setPath('userData', buildData);
app.setPath('sessionData', buildData);

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
  await window.loadURL(pathToFileURL(source).toString());
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
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
    const legacy = image.resize({ width: size, height: size, quality: 'best' }).toPNG();
    const foreground = image.resize({ width: Math.round(size * 2.25), height: Math.round(size * 2.25), quality: 'best' }).toPNG();
    writeFileSync(join(output, 'ic_launcher.png'), legacy);
    writeFileSync(join(output, 'ic_launcher_round.png'), legacy);
    writeFileSync(join(output, 'ic_launcher_foreground.png'), foreground);
  }
  window.destroy();
  app.quit();
}

void generateIcon();
