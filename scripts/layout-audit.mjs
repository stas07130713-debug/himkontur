import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageUrl = process.argv[2] ?? 'http://127.0.0.1:5178/';
const adr = JSON.parse(readFileSync(resolve('public/data/adr-2025-hazard-labels.json'), 'utf8'));
const index = JSON.parse(readFileSync(resolve('public/data/emergency-cards/dangerous-goods-index-2026.json'), 'utf8'));
const profiles = JSON.parse(readFileSync(resolve('public/data/emergency-cards/dangerous-goods-profiles-2026.json'), 'utf8'));
const cardUns = new Set(index.map((item) => item.un));
const adrUns = new Set(adr.rows.map((item) => item.un));
const samples = new Map();
for (const row of adr.rows) {
  if (!cardUns.has(row.un)) continue;
  for (const label of row.hazardLabels) if (!samples.has(label.code)) samples.set(label.code, row.un);
}
samples.set('2.1', '1972');
const representativeByCard = new Map();
for (const item of index) if (adrUns.has(item.un) && !representativeByCard.has(item.emergencyCardNumber)) representativeByCard.set(item.emergencyCardNumber, item.un);
const targets = [...new Set([...representativeByCard.values(), ...profiles.map((profile) => profile.un), ...samples.values()])];
const port = 9800 + Math.floor(Math.random() * 100);
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
mkdirSync(resolve('artifacts'), { recursive: true });

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  '--window-size=1600,900', '--hide-scrollbars', pageUrl,
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 40 && target === undefined; attempt += 1) {
    await delay(250);
    try {
      const entries = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = entries.find((entry) => entry.type === 'page' && entry.url.startsWith(pageUrl));
    } catch { /* Edge is starting. */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Не удалось открыть страницу для визуального аудита.');
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
    if (handler) { pending.delete(message.id); handler(message); }
  });
  const command = (method, params = {}) => new Promise((resolveCommand, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolveCommand(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Runtime.enable');
  await delay(1800);
  await command('Runtime.evaluate', { expression: `(() => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Опасный груз'))?.click())()` });
  // The offline databases are large and slower devices need time to parse them
  // before the first search. Later records reuse the loaded repository.
  await delay(3500);

  const problems = [];
  for (const theme of ['light', 'dark']) {
    await command('Runtime.evaluate', { expression: `document.documentElement.dataset.theme = '${theme}'` });
    for (const un of targets) {
      const result = await command('Runtime.evaluate', { expression: `(async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const input = document.querySelector('.goods-search-box input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '${un}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(45);
        document.querySelector('.goods-search-results button')?.click();
        await wait(45);
        const root = document.querySelector('.emergency-sheet-scroll');
        if (!root) return { overflow: [], columnOverflow: false, missing: true };
        const nodes = [...root.querySelectorAll('h1,h2,h3,p,li,strong,small,em')];
        const overflow = nodes.filter((node) => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1)
          .map((node) => ({ tag: node.tagName, cls: node.className, text: node.textContent.trim().slice(0, 100), client: node.clientWidth, scroll: node.scrollWidth }));
        const columns = [...root.querySelectorAll('.human-hazard-columns > div')];
        const columnOverflow = columns.some((column) => column.scrollWidth > column.clientWidth + 1);
        return { overflow, columnOverflow, title: root.querySelector('.goods-hero h1')?.textContent };
      })()`, awaitPromise: true, returnByValue: true });
      const value = result.result.value;
      if (value.missing || value.overflow.length || value.columnOverflow) problems.push({ theme, un, ...value });
      if (un === '1972') {
        const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        writeFileSync(resolve('artifacts', `ui-methane-${theme}.png`), Buffer.from(shot.data, 'base64'));
      }
      if (un === '1824' && theme === 'dark') {
        const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        writeFileSync(resolve('artifacts', 'ui-class-8-dark.png'), Buffer.from(shot.data, 'base64'));
      }
    }
  }
  writeFileSync(resolve('artifacts', 'layout-audit.json'), JSON.stringify({ checked: targets.length * 2, targets, problems }, null, 2));
  if (problems.length) throw new Error(`Обнаружены переполнения: ${problems.length}. См. artifacts/layout-audit.json`);
  console.log(`Проверено состояний карточек: ${targets.length * 2}; переполнений: 0.`);
  socket.close();
} finally {
  edge.kill();
}
