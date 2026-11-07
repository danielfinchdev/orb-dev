// 3.5.1: security hardening of linking. What a linked device may do is decided by whoever made its QR (never by what it
// says it is); the short code is tied to the Orb's key; browsers do not link over plain Wi-Fi unless allowed;
// notifications can hide what they say. 3.8: another Orb (or an Orb Terminal) is never linked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';
import { createPhone } from './fixtures/phone-client.mjs';
import * as C from '../src/core/mobile-crypto.mjs';
import { kindForPairing, plainHttpBrowser, pushContent, pushPreview, phoneConfig } from '../src/engine/remote.mjs';
import { openDb } from '../src/core/db.mjs';

const env = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1' };
let srv; let tSrv; let port; let base; let dir;
const links = [];
const client = (name, kind) => { const l = createPhone({ name, kind }); links.push(l); return l; };

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  tSrv = tempHome({ mobile: { enabled: true, port, name: 'Servidor' } });
  srv = await startEngine(tSrv.home, { env });
  await until(async () => (await srv.call('remote.status')).running, 'acceso del servidor');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-351-'));
});
after(async () => {
  for (const l of links) l.stop();
  await srv?.stop();
  tSrv?.cleanup();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
});

test('el tipo lo decide quien hace el QR; otro Orb o una terminal nunca se enlazan', async () => {
  assert.equal(kindForPairing(null, 'orb'), null, 'otro Orb no');
  assert.equal(kindForPairing('phone', 'orb'), null, 'ni con un QR de móvil');
  assert.equal(kindForPairing(null, 'terminal'), null, 'ni la terminal de Orb');
  assert.equal(kindForPairing('phone', 'browser'), 'phone', 'lo que se eligió al hacer el QR');
  assert.equal(kindForPairing(null, 'browser'), 'browser');

  const q = await srv.call('link.qr');
  await assert.rejects(client('Falso Orb', 'orb').connect({ qr: q.url }), (e) => e.status === 403, 'se rechaza');
  await assert.rejects(srv.call('link.qr', { device: 'orb' }), /dispositivo/, 'ni se hace un QR para un Orb');
  const phone = client('Móvil', 'phone');
  const me = await phone.connect({ qr: q.url });
  const dev = (await srv.call('link.devices')).find((d) => d.id === me.id);
  assert.equal(dev.kind, 'phone', 'el QR seguía valiendo para lo que era');
  await assert.rejects(phone.call(null, 'bots.create', { name: 'Intruso' }), (e) => e.status === 403);
  // The old routes between Orbs are gone.
  for (const r of ['/api/link', '/api/server-pair']) assert.equal((await fetch(`${base}${r}`, { method: 'POST', headers: { 'X-Orb-Device': me.id, 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(`${base}/api/server-hello`)).status, 401, 'nada que ver sin un dispositivo enlazado');
});

test('los Orbs enlazados antes de la 3.5.1 se vuelven a confirmar y pierden «Puede administrar» en la base de datos', () => {
  const file = path.join(dir, 'vieja.db');
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen TEXT, public_key TEXT, route TEXT, push TEXT, kind TEXT, role TEXT, ip TEXT, meta TEXT, admin INTEGER NOT NULL DEFAULT 0);
    INSERT INTO devices (id, name, token_hash, created_at, public_key, kind, role, admin) VALUES ('a', 'Orb dudoso', 'x1', '2026-11-01', 'k', 'orb', 'taller', 1);
    INSERT INTO devices (id, name, token_hash, created_at, public_key, kind, admin) VALUES ('b', 'Móvil', 'x2', '2026-11-01', 'k', 'phone', 1);`);
  old.close();
  const db = openDb(file);
  const rows = Object.fromEntries(db.prepare('SELECT id, kind_ok, admin, approve, dev_ok FROM devices').all().map((r) => [r.id, { ...r }]));
  db.close();
  assert.deepEqual(rows.a, { id: 'a', kind_ok: 0, admin: 0, approve: 1, dev_ok: 0 }, 'el Orb, a confirmar y sin administrar');
  assert.deepEqual(rows.b, { id: 'b', kind_ok: 1, admin: 1, approve: 1, dev_ok: 0 }, 'el móvil sigue igual');
});

test('código corto: atado a la clave del Orb; un intermediario que cambia la clave no engaña', async () => {
  const pub = C.b64.enc(C.newKeyPair().pub);
  assert.equal(C.shortSecret('ABCD2345', pub), await C.shortSecretAsync('ABCD2345', pub), 'lo mismo en el servidor y en el móvil');
  assert.notEqual(C.shortSecret('ABCD2345', pub), C.shortSecret('ABCD2345', C.b64.enc(C.newKeyPair().pub)), 'otra clave, otro secreto');

  // The real Orb: hello says the code is tied to its key; a wrong fingerprint is refused; the right code links.
  const q = await srv.call('link.qr', { device: 'phone' });
  const h = await (await fetch(`${base}/api/hello`)).json();
  assert.equal(h.short, 3);
  assert.equal(h.fp, q.pc, 'la huella que muestra la pantalla');
  await assert.rejects(client('Móvil', 'phone').connect({ code: q.code, address: `127.0.0.1:${port}`, fp: '0000-0000-0000' }), /huella/);
  const ok = await client('Móvil', 'phone').connect({ code: q.code, address: `127.0.0.1:${port}`, fp: q.pc });
  assert.equal(ok.fp, q.pc);

  // Someone in the middle answers with its own key: it can seal the session but not prove it had the code.
  const evil = C.newKeyPair();
  let older = false;
  const mitm = http.createServer(async (req, res) => {
    if (req.url === '/api/hello') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ v: 2, ...(older ? {} : { short: 3 }), pc: C.b64.enc(evil.pub), fp: C.fingerprint(evil.pub), name: 'Servidor', urls: [] })); }
    let body = ''; for await (const c of req) body += c;
    const b = JSON.parse(body); const id = crypto.randomUUID();
    const key = C.sessionKey(evil.priv, C.b64.dec(b.pub));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id, box: C.seal(key, { id, orb: 'Servidor', role: 'centro' }, C.AAD.paired(id)), confirm: C.seal(C.pairingKey(evil.priv, C.b64.dec(b.pub), 'corto3:adivinado'), { id }, C.AAD.confirm(id)) }));
  });
  await new Promise((r) => mitm.listen(0, '127.0.0.1', r));
  const mport = mitm.address().port;
  try {
    await assert.rejects(client('Víctima', 'phone').connect({ code: 'ABCD-EFGH', address: `127.0.0.1:${mport}` }), /no es el del código/);
    older = true;
    await assert.rejects(client('Víctima', 'phone').connect({ code: 'ABCD-EFGH', address: `127.0.0.1:${mport}` }), /versión anterior/, 'un Orb que no ata el código a su clave: solo con el QR');
  } finally { mitm.close(); }
});

test('por la wifi sin cifrar un navegador no se enlaza, salvo que el usuario lo permita', () => {
  const routes = [{ kind: 'wifi', address: '192.168.1.5' }, { kind: 'tailscale', address: '100.64.0.9' }];
  const page = { origin: 'http://192.168.1.5:3131', localAddress: '192.168.1.5', routes };
  assert.equal(plainHttpBrowser(page), true, 'un navegador por la wifi');
  assert.equal(plainHttpBrowser({ ...page, lanHttp: true }), false, 'permitido en Ajustes');
  assert.equal(plainHttpBrowser({ ...page, origin: undefined }), false, 'la terminal u otro Orb');
  assert.equal(plainHttpBrowser({ ...page, app: true }), false, 'la app de Android');
  assert.equal(plainHttpBrowser({ ...page, localAddress: '127.0.0.1' }), false, 'https de Tailscale (llega por este PC)');
  assert.equal(plainHttpBrowser({ ...page, localAddress: '::ffff:100.64.0.9' }), false, 'la dirección de Tailscale');
});

test('avisos: el texto se ve salvo que la persona elija «nada»', () => {
  const cfg = (preview) => ({ assistantName: 'Orbe', mobile: preview ? { preview } : {} });
  assert.equal(pushPreview(cfg()), 'chat');
  assert.deepEqual(pushContent({ title: 'Orbe', body: 'La tarea ha terminado' }, cfg()), { title: 'Orbe', body: 'La tarea ha terminado' });
  assert.equal(pushContent({ title: 'Orbe', body: 'Hola' }, cfg('none')).body, 'Tienes un mensaje nuevo');
  assert.equal(pushContent({ title: 'Orbe', body: 'Hola' }, cfg('all')).body, 'Hola');
  assert.equal(phoneConfig(cfg('none')).mobile.preview, 'none', 'la app lo sabe');
});
