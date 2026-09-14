import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptRoot, '..');
const viteEntry = resolve(appRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const appUrl = 'http://127.0.0.1:5178/';
const noOpen = process.argv.includes('--no-open');
const delay = (milliseconds) => new Promise((complete) => setTimeout(complete, milliseconds));

async function isAhovServer() {
  try {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.text()).includes('<title>');
  } catch {
    return false;
  }
}

if (!existsSync(viteEntry)) throw new Error('Run npm install in the app folder first.');

if (!(await isAhovServer())) {
  const server = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', '5178', '--strictPort'], {
    cwd: appRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  server.unref();
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(500);
    if (await isAhovServer()) {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error('The local web app did not start at 127.0.0.1:5178.');
}

if (!noOpen) {
  const edgeCandidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));
  if (edgePath === undefined) {
    spawn('cmd.exe', ['/c', 'start', '', appUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    spawn(edgePath, [`--app=${appUrl}`, '--start-maximized'], { detached: true, stdio: 'ignore' }).unref();
  }
}
