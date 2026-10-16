import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pageUrl = process.argv[2] ?? 'http://127.0.0.1:4178/';
const actPath = process.argv[3] === undefined ? '' : resolve(process.argv[3]);
if (actPath === '' || !existsSync(actPath)) throw new Error('Передайте существующий путь к акту .docx вторым аргументом.');

const port = 9300 + process.pid % 500;
const profile = resolve('..', '.test-runtime', `hydrant-act-edge-${process.pid}`);
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const edge = spawn(edgePath, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, '--window-size=1440,1000', pageUrl,
], { stdio: 'ignore' });

try {
  let target;
  for (let attempt = 0; attempt < 40 && target === undefined; attempt += 1) {
    await delay(250);
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page' && item.url.startsWith(pageUrl));
    } catch {
      // Edge may still be starting.
    }
  }
  if (target?.webSocketDebuggerUrl === undefined) throw new Error('Не удалось открыть тестовую страницу.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (handler === undefined) return;
    pending.delete(message.id);
    handler(message);
  });
  const command = (method, params = {}) => new Promise((done, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error !== undefined) reject(new Error(message.error.message));
      else done(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  await command('Runtime.enable');
  await command('DOM.enable');
  await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['https://api.github.com/gists/*'] });
  await delay(2500);
  await evaluate(`(async () => {
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Карта района выезда'))?.click();
    await wait(100);
    document.querySelector('button[aria-label="Настройка карты"]')?.click();
    await wait(100);
    const password = document.querySelector('.admin-login-dialog input[type="password"]');
    if (!(password instanceof HTMLInputElement)) throw new Error('Не открылось окно входа в настройку карты.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(password, '1234');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(50);
    password.closest('form')?.requestSubmit();
    await wait(200);
  })()`);
  const documentNode = await command('DOM.getDocument', { depth: 2, pierce: true });
  const inputNode = await command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '.district-act-file-input' });
  if (inputNode.nodeId === 0) throw new Error('Поле загрузки акта не найдено.');
  await command('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [actPath] });

  let status = '';
  for (let attempt = 0; attempt < 100 && !status.startsWith('Акт прочитан:'); attempt += 1) {
    await delay(100);
    status = await evaluate(`document.querySelector('.district-act-status')?.textContent?.trim() ?? ''`);
  }
  if (!status.includes('строк — 158') || !status.includes('совпадений с картой — 157')) {
    throw new Error(`Некорректный итог загрузки: ${status || 'сообщение отсутствует'}`);
  }
  const beforeApply = await evaluate(`(() => {
    const project = JSON.parse(localStorage.getItem('himkontur-district-map-project-v1') ?? '{}');
    const hydrants = (project.draft ?? []).filter((item) => item.kind === 'hydrant');
    const hydrant = hydrants.find((item) => item.number === 'ПГ-43');
    return { status: hydrant?.status ?? '', fault: hydrant?.faultDescription ?? '' };
  })()`);
  if (beforeApply.status === 'faulty' || beforeApply.fault !== '') {
    throw new Error(`Акт изменил карточки до подтверждения: ${JSON.stringify(beforeApply)}`);
  }
  await evaluate(`document.querySelector('.district-act-apply')?.click()`);
  for (let attempt = 0; attempt < 50 && !status.startsWith('Данные акта применены'); attempt += 1) {
    await delay(100);
    status = await evaluate(`document.querySelector('.district-act-status')?.textContent?.trim() ?? ''`);
  }
  const stored = await evaluate(`(() => {
    const project = JSON.parse(localStorage.getItem('himkontur-district-map-project-v1') ?? '{}');
    const hydrants = (project.draft ?? []).filter((item) => item.kind === 'hydrant');
    return {
      faulty: hydrants.filter((item) => item.status === 'faulty').length,
      unknown: hydrants.filter((item) => item.status === 'unknown').length,
      pg43: hydrants.find((item) => item.number === 'ПГ-43')?.faultDescription ?? '',
      pg43Note: hydrants.find((item) => item.number === 'ПГ-43')?.note ?? '',
      pg53: hydrants.find((item) => item.number === 'ПГ-53') ?? null,
    };
  })()`);
  // Eight faulty hydrants are present in the act; ПГ-7 is not present in the
  // current map data, therefore seven mapped cards become faulty.
  if (stored.faulty !== 7 || stored.pg43 === '') throw new Error(`Карточки не обновились после подтверждения: ${JSON.stringify(stored)}`);
  if (stored.pg53?.network !== 'ring' || stored.pg53?.diameterMm !== 200 || stored.pg53?.pressureAtm !== 7.5) {
    throw new Error(`Сеть, диаметр или давление ПГ-53 перенесены неверно: ${JSON.stringify(stored.pg53)}`);
  }
  if (!stored.pg43Note.includes('Источник сведений о состоянии ПГ:') || !stored.pg43Note.includes(basename(actPath))) {
    throw new Error(`В примечании нет источника и имени акта: ${JSON.stringify(stored)}`);
  }
  if (stored.pg43Note.includes('Источник координат и характеристик:')) {
    throw new Error(`В примечании осталась устаревшая строка об источнике координат: ${JSON.stringify(stored)}`);
  }
  console.log(JSON.stringify({ passed: true, beforeApply, status, stored }, null, 2));
  socket.close();
} finally {
  edge.kill();
}
