// 3.6 (mensajería, paso M4), de punta a punta con el motor: los avisos llegan a los móviles enlazados, con el dibujo de
// Orbe; los silenciados no avisan; «Responder» se escribe en el propio aviso (3.8.0: la app no tiene bloqueo propio);
// «Aprobar» / «Rechazar» desde el aviso del navegador (POST /api/note-action, una sola vez, como ese móvil); la app
// abierta recibe el aviso como evento «note».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine, until } from './helpers.mjs';
import { createPhone } from './fixtures/phone-client.mjs';
import * as C from '../src/core/mobile-crypto.mjs';

let A; let t; let port; let dir; let pushLog; let conv;
const links = [];
const device = (name, kind = 'phone') => { const l = createPhone({ name, kind }); links.push(l); return l; };
// A phone with notifications on and its app closed: its pushes go to the mock log.
async function pushDevice(tag) {
  const l = device(`Avisos ${tag}`);
  const peer = await l.connect({ qr: (await A.call('link.qr', {})).url });
  const raw = l.raw(peer.id);
  const sub = { endpoint: `https://fcm.googleapis.com/fcm/send/${tag}-${crypto.randomUUID()}`, keys: { p256dh: Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  const r = await raw.post('/api/push', raw.box('push', { subscription: sub }));
  assert.equal(C.open(raw.key, await r.json(), C.AAD.response(raw.id)).ok, true);
  l.stop();
  return { id: peer.id, endpoint: sub.endpoint };
}
const pushes = (endpoint) => { try { return fs.readFileSync(pushLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => !endpoint || x.endpoint === endpoint); } catch { return []; } };
const base = () => `http://127.0.0.1:${port}`;
const noteAction = (token) => fetch(`${base()}/api/note-action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base() }, body: JSON.stringify({ token }) });
let ana; let tablet;

before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-avisos-'));
  pushLog = path.join(dir, 'avisos.jsonl');
  t = tempHome({ mobile: { enabled: true, port, name: 'Casa', preview: 'all' } });
  A = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1', ORB_PUSH_LOG: pushLog } });
  await until(async () => (await A.call('remote.status')).running, 'acceso');
  ana = await pushDevice('ana');
  tablet = await pushDevice('tablet');
  await A.call('projects.create', { name: 'web' });
});
after(async () => { for (const l of links) { try { l.stop(); } catch { /* stopped */ } } await A?.stop?.(); t?.cleanup(); });

test('la respuesta de Orbe avisa con su dibujo y abre esa conversación, en cada móvil enlazado', async () => {
  const n = pushes(ana.endpoint).length;
  const r = await A.call('chat.send', { text: 'hola Orbe' });
  conv = r.conversation;
  const p = await until(() => pushes(ana.endpoint).slice(n).find((x) => x.data.tag === `orb-conversation:${r.conversation}`), 'el aviso de Orbe', 30_000);
  assert.equal(p.data.icon, '/icon.png');
  assert.deepEqual(p.data.route, { view: 'chat', id: r.conversation });
  await until(() => pushes(tablet.endpoint).find((x) => x.data.tag === `orb-conversation:${r.conversation}`), 'también a la tablet', 30_000);
});

test('silenciado: sin aviso', async () => {
  await A.call('inbox.mute', { kind: 'conversation', id: conv });
  const n = pushes(ana.endpoint).length;
  await A.call('chat.send', { text: 'otra vez', conversation: conv });
  await until(async () => (await A.call('chat.list', { conversation: conv })).filter((l) => l.role === 'orb').length >= 2, 'la respuesta', 30_000);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(pushes(ana.endpoint).slice(n).filter((x) => x.data.tag === `orb-conversation:${conv}`).length, 0);
  await A.call('inbox.mute', { kind: 'conversation', id: conv, muted: false });
});

test('Responder se escribe en el propio aviso', async () => {
  const n = pushes(ana.endpoint).length;
  await A.call('chat.send', { text: 'hola de nuevo', conversation: conv });
  const m = await until(() => pushes(ana.endpoint).slice(n).find((x) => x.data.tag === `orb-conversation:${conv}` && x.data.kind === 'message'), 'el mensaje', 30_000);
  assert.deepEqual(m.data.actions.map((a) => [a.id, Boolean(a.open)]), [['reply', false]]);
});

test('la app abierta recibe el aviso como evento «note» (lo muestra Android en segundo plano)', async () => {
  const l = device('Móvil de Ana');
  const peer = await l.connect({ qr: (await A.call('link.qr', {})).url });
  await until(() => l.peers().find((x) => x.id === peer.id)?.online, 'en directo');
  const notes = []; l.on('note', (p) => notes.push(p));
  const before = pushes(ana.endpoint).length;
  await A.call('chat.send', { text: 'y ahora', conversation: conv });
  const n = await until(() => notes.find((x) => x.key === `conversation:${conv}`), 'la nota', 30_000);
  assert.equal(n.largeIcon, 'av_orb');
  assert.ok(pushes(ana.endpoint).length >= before, 'el otro móvil (cerrado) sigue con su push');
  l.stop();
});

test('el permiso de una tarea llega con Aprobar y Rechazar; el token vale una vez', async () => {
  const n = pushes(ana.endpoint).length;
  await A.call('tasks.create', { project: 'web', title: 'Subir', description: 'PIDE_PERMISO', agent: 'codex' });
  const p = await until(() => pushes(ana.endpoint).slice(n).find((x) => x.data.kind === 'approval'), 'el permiso', 30_000);
  assert.ok(p.data.acts.allow && p.data.acts.deny);
  const r = await noteAction(p.data.acts.deny);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal((await noteAction(p.data.acts.allow)).status, 401, 'el primer intento gasta los dos tokens del aviso');
});
