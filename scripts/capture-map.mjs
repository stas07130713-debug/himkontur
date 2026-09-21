import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pageUrl = process.argv[2] ?? 'http://127.0.0.1:4174/';
const outputPath = process.argv[3] ?? 'ui-map-delayed.png';
const evaluation = process.argv[4];
const port = 9224;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const edge = spawn(edgePath, [
  '--headless=new', `--remote-debugging-port=${port}`,
  '--window-size=1920,1080', '--hide-scrollbars', pageUrl
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 20 && target === undefined; attempt += 1) {
    await delay(500);
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page' && item.url.startsWith(pageUrl));
    } catch {
      // Edge may still be starting.
    }
  }
  if (target?.webSocketDebuggerUrl === undefined) throw new Error('Не удалось подключиться к странице проверки.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const diagnostics = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' || message.method === 'Runtime.consoleAPICalled')
      diagnostics.push({ method: message.method, params: message.params });
  });
  let commandId = 0;
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    commandId += 1;
    const expectedId = commandId;
    const timeout = setTimeout(() => reject(new Error('Истекло время ожидания снимка.')), 10_000);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== expectedId) return;
      clearTimeout(timeout);
      resolve(message);
    }, { once: false });
    socket.send(JSON.stringify({ id: expectedId, method, params }));
  });
  await command('Runtime.enable');
  await command('Log.enable');
  await delay(7000);
  if (evaluation !== undefined) {
    const evaluated = await command('Runtime.evaluate', { expression: evaluation, returnByValue: true, awaitPromise: true });
    if (evaluated.result?.exceptionDetails !== undefined) throw new Error(evaluated.result.exceptionDetails.text);
    if (evaluated.result?.result?.value !== undefined) console.log(JSON.stringify(evaluated.result.result.value));
    await delay(1000);
  }
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  socket.close();
  if (result.result?.data === undefined) throw new Error(result.error?.message ?? 'Снимок не получен.');
  await writeFile(outputPath, Buffer.from(result.result.data, 'base64'));
  if (diagnostics.length > 0) console.log(JSON.stringify(diagnostics, null, 2));
} finally {
  edge.kill();
}
