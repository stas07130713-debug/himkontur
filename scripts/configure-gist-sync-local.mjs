import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const port = 8798;
const root = resolve(import.meta.dirname, '..');
const dataPath = resolve(root, 'public/data/district-map.json');
const configPath = resolve(root, 'public/data/gist-sync.json');
const page = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Настройка синхронизации ХИМКОНТУР</title><style>body{margin:0;background:#062b3c;color:#eefeff;font:16px Segoe UI,Arial;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,calc(100% - 32px));box-sizing:border-box;padding:28px;border:1px solid #2fcacb;border-radius:18px;background:#0a4658;box-shadow:0 18px 55px #001722}h1{font-size:24px}p{color:#c5e5e8;line-height:1.5}label{display:grid;gap:8px;font-weight:700}input{box-sizing:border-box;width:100%;height:48px;padding:0 14px;border:2px solid #61d6d3;border-radius:10px;font:16px monospace}button{width:100%;height:48px;margin-top:18px;border:0;border-radius:10px;background:#16bdbb;color:#032d3a;font-weight:800;font-size:16px;cursor:pointer}button:disabled{opacity:.55}.status{min-height:24px;margin-top:14px;color:#ffdc7b}</style><main class="card"><h1>Подключение общей базы ХИМКОНТУР</h1><p>Вставьте ключ GitHub с единственным разрешением <b>gist</b>. Он не сохраняется открытым и не передаётся в чат.</p><form><label>GitHub token<input name="token" type="password" autocomplete="off" required autofocus></label><button>Создать общую базу</button><div class="status" role="status"></div></form></main><script>const f=document.querySelector('form'),b=document.querySelector('button'),s=document.querySelector('.status');f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;s.textContent='Создаю и шифрую базу…';try{const r=await fetch('/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:new FormData(f).get('token')})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Ошибка');f.reset();s.textContent='Готово. Общая база создана, эту вкладку можно закрыть.'}catch(x){s.textContent=x.message;b.disabled=false}});</script></html>`;

let configured = false;
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  if (request.method !== 'POST' || request.url !== '/configure') {
    response.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const { token } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof token !== 'string' || token.trim().length < 20) throw new Error('Ключ GitHub имеет неверный формат.');
    const project = readFileSync(dataPath, 'utf8');
    const gistResponse = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.trim()}`,
        'Content-Type': 'application/json; charset=utf-8',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'HIMKONTUR-Gist-Setup',
      },
      body: JSON.stringify({
        description: 'ХИМКОНТУР — актуальная база карты района выезда',
        public: true,
        files: { 'district-map.json': { content: project } },
      }),
    });
    if (!gistResponse.ok) throw new Error(`GitHub отклонил ключ (HTTP ${gistResponse.status}). Проверьте разрешение gist.`);
    const gist = await gistResponse.json();
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = pbkdf2Sync('1234', salt, 210000, 32, 'sha256');
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(token.trim(), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const config = {
      gistId: gist.id,
      owner: gist.owner.login,
      fileName: 'district-map.json',
      encryptedToken: {
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        ciphertext: encrypted.toString('base64'),
        iterations: 210000,
      },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    configured = true;
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true }));
    setTimeout(() => server.close(), 1500);
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Ошибка настройки.' }));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Откройте http://127.0.0.1:${port}/`));
setTimeout(() => { if (!configured) server.close(); }, 10 * 60_000);
