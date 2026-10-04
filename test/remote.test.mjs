// Phone access: only paired devices, one-time QR codes, host/origin/CSRF checks, the phone's limited actions, uploads,
// live events and revocation. The server binds to loopback here (ORB_REMOTE_BIND) instead of the Tailscale address.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import http from 'node:http';
import { tempHome, ROOT, until } from './helpers.mjs';

let t; let engine; let n = 0; const pending = new Map(); let base; let port;
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });

before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port } });
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1' } });
  engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
  base = `http://127.0.0.1:${port}`;
  await until(async () => (await call('remote.status')).running, 'servidor del móvil');
});
after(() => { engine?.send({ type: 'shutdown' }); t?.cleanup(); });

const api = (pathname, { method = 'POST', body, key, headers = {} } = {}) => fetch(base + pathname, { method, headers: { 'X-Orb': '1', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body && typeof body !== 'object' ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : typeof body === 'object' && !(body instanceof Buffer) ? JSON.stringify(body) : body });

test('sirve la web app instalable y solo responde a su propio nombre', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /manifest\.webmanifest/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 200);
  // fetch() cannot change Host: a raw request plays the DNS-rebinding page.
  const status = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/api/me', headers: { Host: 'atacante.example' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.equal(status, 421, 'DNS rebinding: otro nombre de host se rechaza');
  assert.equal((await fetch(`${base}/../../orb.json`)).status, 404);
  assert.equal((await fetch(`${base}/pip.html`)).status, 404, 'las páginas solo de escritorio no se sirven');
  assert.equal((await fetch(`${base}/icon.png`)).status, 200);
});

test('sin vincular no hay acceso; el QR sirve una vez y caduca', async () => {
  assert.equal((await api('/api/call', { body: { method: 'app.state' } })).status, 401);
  assert.equal((await api('/api/pair', { body: { token: 'x'.repeat(32) } })).status, 401, 'código inventado');
  const { url } = await call('remote.pair');
  const token = new URL(url).hash.replace('#vincular=', '');
  const ok = await api('/api/pair', { body: { token, name: 'Android' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('set-cookie'), null, 'sin cookies: otros puertos de este PC no la recibirían');
  globalThis.key = (await ok.json()).token;
  assert.equal((await api('/api/pair', { body: { token, name: 'otro' } })).status, 401, 'el mismo QR no sirve dos veces');
  assert.equal((await api('/api/pair', { body: 'null', headers: { 'Content-Type': 'application/json' } })).status, 401, 'cuerpo raro: cuenta como intento');
});

test('el móvil hace lo suyo y nada más (CSRF, origen, acciones del PC, archivos del PC, secretos)', async () => {
  const key = globalThis.key;
  const state = await (await api('/api/call', { key, body: { method: 'app.state' } })).json();
  assert.equal(state.ok, true);
  assert.equal(JSON.stringify(state.result.config).includes('fake-claude'), false, 'ni rutas de los programas ni secretos de conectores');
  assert.ok(state.result.config.accounts.every((a) => !('home' in a)));
  assert.equal((await fetch(`${base}/api/call`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'app.state' }) })).status, 403, 'sin la cabecera propia (CSRF)');
  assert.equal((await api('/api/call', { key, headers: { Origin: 'https://atacante.example' }, body: { method: 'app.state' } })).status, 403, 'otro origen');
  await call('projects.create', { name: 'desde-el-pc' });
  const total = await call('sessions.create', { agent: 'claude', project: 'desde-el-pc', permission: 'total' });
  assert.equal((await api('/api/call', { key, body: { method: 'sessions.send', params: { id: total.id, text: 'hola' } } })).status, 403, 'una conversación con acceso total solo desde el PC');
  for (const method of ['config.save', 'accounts.add', 'installer.start', 'remote.pair', 'projects.import', 'projects.createPr', 'agents.login']) {
    assert.equal((await api('/api/call', { key, body: { method, params: {} } })).status, 403, `${method} solo desde el PC`);
  }
  assert.equal((await api('/api/call', { key, body: { method: 'sessions.create', params: { agent: 'codex', permission: 'total' } } })).status, 403);
  assert.equal((await api('/api/call', { key, body: { method: 'sessions.send', params: { id: 'x', text: 'hola', images: [path.join(t.home, 'orb.json')] } } })).status, 403, 'no puede adjuntar archivos del PC');
  // A picture uploaded from the phone: checked by its bytes.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0f10000000049454e44ae426082', 'hex');
  const up = await (await fetch(`${base}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Orb': '1' }, body: png })).json();
  assert.ok(up.path.includes(path.join('.orb', 'adjuntos-movil')));
  assert.equal((await fetch(`${base}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Orb': '1' }, body: Buffer.from('MZ ejecutable') })).status, 415);
});

test('eventos en directo y revocar el acceso', async () => {
  const key = globalThis.key;
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader(); let text = '';
  await call('projects.create', { name: 'desde-el-movil' });
  await until(async () => { const { value } = await reader.read(); text += Buffer.from(value ?? []).toString(); return /board:changed/.test(text); }, 'evento en directo');
  ctrl.abort();
  const [device] = (await call('remote.status')).devices;
  await call('remote.revoke', { id: device.id });
  assert.equal((await api('/api/call', { key, body: { method: 'app.state' } })).status, 401, 'tras revocarlo ya no entra');
});
