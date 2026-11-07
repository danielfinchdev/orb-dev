// 3.6 (mensajería, paso M4), de punta a punta con el motor: los avisos llegan solo a los móviles de quien ve el chat
// (Ana sí, Leo no), con el nombre y el avatar del bot; los silenciados no avisan; «Aprobar» / «Rechazar» desde el aviso
// del navegador (POST /api/note-action, una sola vez, como ese móvil); con PIN, «Aprobar» abre la app (no hay token);
// la app abierta recibe el aviso como evento «note»; los avatares se sirven como PNG.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine, until } from './helpers.mjs';
import { createPhone } from './fixtures/phone-client.mjs';
import * as C from '../src/core/mobile-crypto.mjs';

let A; let t; let port; let dir; let pushLog; let leo; let botId; let conv;
const links = [];
const device = (name, kind = 'phone') => { const l = createPhone({ name, kind }); links.push(l); return l; };
// A phone with notifications on and its app closed: its pushes go to the mock log.
async function pushDevice(person, tag) {
  const l = device(`Avisos ${tag}`);
  const peer = await l.connect({ qr: (await A.call('link.qr', { person })).url });
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
let ana; let leoPhone;

before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-avisos-'));
  pushLog = path.join(dir, 'avisos.jsonl');
  t = tempHome({ mobile: { enabled: true, port, name: 'Casa', preview: 'all' } });
  A = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1', ORB_PUSH_LOG: pushLog } });
  await until(async () => (await A.call('remote.status')).running, 'acceso');
  leo = await A.call('persons.create', { name: 'Leo' });
  ana = await pushDevice(undefined, 'ana');
  leoPhone = await pushDevice(leo.id, 'leo');
  const bot = await A.call('bots.create', { name: 'Agenda', role_text: 'Citas', avatar: { shape: 'gota', color: 'coral' } });
  botId = bot.id;
});
after(async () => { for (const l of links) { try { l.stop(); } catch { /* stopped */ } } await A?.stop?.(); t?.cleanup(); });

test('un mensaje de un bot: aviso con su nombre y avatar, solo al móvil de Ana; Leo nada', async () => {
  const r = await A.call('bots.send', { id: botId, text: 'hola Agenda' });
  conv = r.conversation;
  const p = await until(() => pushes(ana.endpoint).find((x) => x.data.tag === `orb-bot:${botId}` && x.data.kind === 'message'), 'el aviso de Ana', 30_000);
  assert.equal(p.data.title, 'Agenda');
  assert.equal(p.data.icon, '/avatars/gota-coral.png');
  assert.deepEqual(p.data.route, { view: 'bot-chat', id: String(botId) });
  assert.deepEqual(p.data.actions.map((a) => a.id), ['reply']);
  assert.ok(!pushes(leoPhone.endpoint).length, 'nada al móvil de Leo');
  // El dibujo se sirve (solo formas y colores).
  const img = await fetch(`${base()}${p.data.icon}`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base()}/avatars/nada-raro.png`)).status, 404);
});

test('silenciado: sin aviso', async () => {
  await A.call('inbox.mute', { kind: 'bot', id: botId });
  const n = pushes(ana.endpoint).length;
  await A.call('bots.send', { id: botId, text: 'otra vez' });
  await until(async () => (await A.call('bots.chat', { id: botId })).lines.filter((l) => l.role === 'bot').length >= 2, 'la respuesta', 30_000);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(pushes(ana.endpoint).length, n, 'silenciado: nada');
  await A.call('inbox.mute', { kind: 'bot', id: botId, muted: false });
});

test('una tarjeta no sensible y sin bloqueo: Aprobar desde el aviso (una vez, como ese móvil)', async () => {
  const jefe = await A.call('bots.create', { name: 'Jefe', role_text: 'Reparte', is_chief: true });
  await A.call('bots.create', { name: 'Otro', role_text: 'Nada' });
  const n = pushes(ana.endpoint).length;
  await A.call('bots.send', { id: jefe.id, text: 'BOT_CALL bot_pause {"name":"Otro","reason":"no se usa"}' });
  const p = await until(() => pushes(ana.endpoint).slice(n).find((x) => x.data.kind === 'card'), 'el aviso de la tarjeta', 30_000);
  assert.deepEqual(p.data.actions.map((a) => [a.id, Boolean(a.open)]), [['deny', false], ['allow', false]], 'se contesta ahí');
  assert.ok(p.data.acts.allow && p.data.acts.deny);
  const res = await noteAction(p.data.acts.allow);
  assert.equal(res.status, 200, await res.clone().text());
  const card = (await A.call('bots.chat', { id: jefe.id })).lines.find((l) => l.id === p.data.card.item);
  assert.notEqual(card.meta.status, 'pending', 'contestada');
  assert.equal(card.meta.by?.device, ana.id, 'como ese móvil');
  assert.equal((await noteAction(p.data.acts.allow)).status, 401, 'una sola vez');
  assert.equal((await noteAction(p.data.acts.deny)).status, 401, 'la otra respuesta también se gasta');
  assert.equal((await noteAction('inventado')).status, 401);
});

test('una tarjeta sensible: Aprobar y Rechazar abren la app (sin tokens)', async () => {
  const n = pushes(ana.endpoint).length;
  await A.call('bots.send', { id: botId, text: 'BOT_CALL bot_confirm {"action":"comprar","detail":"Leche","url":"https://tienda.example"}' });
  const p = await until(() => pushes(ana.endpoint).slice(n).find((x) => x.data.kind === 'card'), 'el aviso de la tarjeta', 30_000);
  assert.deepEqual(p.data.actions.map((a) => [a.id, Boolean(a.open)]), [['deny', true], ['allow', true]]);
  assert.deepEqual(p.data.acts, {});
});

test('con el bloqueo de la app (PIN): nada se hace desde el aviso; Responder abre la app', async () => {
  await A.call('persons.setPin', { pin: '2468' });
  try {
    const n = pushes(ana.endpoint).length;
    await A.call('bots.send', { id: botId, text: 'hola con candado' });
    const m = await until(() => pushes(ana.endpoint).slice(n).find((x) => x.data.kind === 'message'), 'el mensaje', 30_000);
    assert.deepEqual(m.data.actions.map((a) => [a.id, Boolean(a.open), Boolean(a.input)]), [['reply', true, false]], 'sin escribir en el aviso');
    const k = pushes(ana.endpoint).length;
    const jefe = (await A.call('bots.list')).bots.find((b) => b.name === 'Jefe');
    await A.call('bots.send', { id: jefe.id, text: 'BOT_CALL bot_pause {"name":"Agenda","reason":"vacaciones"}' });
    const c = await until(() => pushes(ana.endpoint).slice(k).find((x) => x.data.kind === 'card'), 'la tarjeta', 30_000);
    assert.ok(c.data.actions.every((a) => a.open), 'aprobar y rechazar, en la app');
    assert.deepEqual(c.data.acts, {}, 'sin tokens');
  } finally { await A.call('persons.setPin', { pin: null, current: '2468' }); }
});

test('la app abierta recibe el aviso como evento «note» (lo muestra Android en segundo plano)', async () => {
  const l = device('Móvil de Ana');
  const peer = await l.connect({ qr: (await A.call('link.qr', {})).url });
  await until(() => l.peers().find((x) => x.id === peer.id)?.online, 'en directo');
  const notes = []; l.on('note', (p) => notes.push(p));
  const before = pushes(ana.endpoint).length;
  await A.call('bots.send', { id: botId, text: 'y ahora' });
  const n = await until(() => notes.find((x) => x.key === `bot:${botId}`), 'la nota', 30_000);
  assert.equal(n.title, 'Agenda'); assert.equal(n.largeIcon, 'av_gota_coral');
  assert.ok(pushes(ana.endpoint).length >= before, 'el otro móvil (cerrado) sigue con su push');
  l.stop();
});

test('zona Orb: la respuesta de Orbe avisa con su dibujo y abre esa conversación', async () => {
  const n = pushes(ana.endpoint).length;
  const r = await A.call('chat.send', { text: 'hola Orbe' });
  const p = await until(() => pushes(ana.endpoint).slice(n).find((x) => x.data.tag === `orb-conversation:${r.conversation}`), 'el aviso de Orbe', 30_000);
  assert.equal(p.data.icon, '/icon.png');
  assert.deepEqual(p.data.route, { view: 'chat', id: r.conversation });
  assert.ok(!pushes(leoPhone.endpoint).length, 'nada al móvil de Leo');
});

test('un PIN puesto después del aviso: su token ya no aprueba (abre la app)', async () => {
  const jefe = (await A.call('bots.list')).bots.find((b) => b.name === 'Jefe');
  await A.call('bots.create', { name: 'Tercero', role_text: 'Nada' });
  const n = pushes(ana.endpoint).length;
  await A.call('bots.send', { id: jefe.id, text: 'BOT_CALL bot_pause {"name":"Tercero","reason":"no se usa"}' });
  const p = await until(() => pushes(ana.endpoint).slice(n).find((x) => x.data.kind === 'card'), 'la tarjeta', 30_000);
  assert.ok(p.data.acts.allow);
  await A.call('persons.setPin', { pin: '1357' });
  try {
    const r = await noteAction(p.data.acts.allow);
    assert.equal(r.status, 403); assert.equal((await r.json()).reason, 'locked');
    const card = (await A.call('bots.chat', { id: jefe.id })).lines.find((l) => l.id === p.data.card.item);
    assert.equal(card.meta.status, 'pending', 'sin contestar');
  } finally { await A.call('persons.setPin', { pin: null, current: '1357' }); }
});
