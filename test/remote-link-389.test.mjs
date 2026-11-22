// The PC's side of the phone link: numbered live events that a phone can resume (or reload from, after a `resync`), the
// 15 s heartbeat (shortened here), a resent call that never runs twice, and a call that cannot hang. Real engine on
// loopback, as test/remote.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { tempHome, ROOT, until, wait } from './helpers.mjs';
import * as C from '../src/shared/mobile-crypto.mjs';
import { createJournal } from '../src/engine/transport/remote-events.mjs';
import { withDeadline } from '../src/engine/transport/remote-calls.mjs';
import { TEST_MASTER } from './fixtures/phone-client.mjs';

let t; let engine; let n = 0; const pending = new Map(); let base; let port;
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });

before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port } });
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ORB_REMOTE_PING_MS: '300', ORB_FAKE_LOG: path.join(t.base, 'fake.jsonl') } });
  engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
  base = `http://127.0.0.1:${port}`;
  await until(async () => (await call('remote.status')).running, 'servidor del móvil');
  await call('master.create', { password: TEST_MASTER });
});
after(() => { engine?.send({ type: 'shutdown' }); t?.cleanup(); });

function phone() {
  const me = { kp: C.newKeyPair(), id: null, key: null };
  me.box = (kind, body, { at = Date.now() } = {}) => C.seal(me.key, { t: at, m: kind, b: body }, C.AAD.request(me.id));
  me.post = (pathname, box, { id = me.id } = {}) => fetch(base + pathname, { method: 'POST', headers: { 'X-Orb-Device': id, 'Content-Type': 'application/json' }, body: JSON.stringify(box) });
  me.open = async (res) => C.open(me.key, await res.json(), C.AAD.response(me.id));
  // a live stream: everything it receives, as { id, e } for events and { ping } for heartbeats
  me.stream = async (headers = {}, query = '') => {
    const ctrl = new AbortController();
    const auth = C.sealText(me.key, { t: Date.now(), m: 'events' }, C.AAD.request(me.id));
    const res = await fetch(`${base}/api/events${query}`, { headers: { 'X-Orb-Device': me.id, 'X-Orb-Auth': auth, ...headers }, signal: ctrl.signal });
    assert.equal(res.status, 200);
    const got = { items: [], close: () => ctrl.abort() };
    (async () => {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) return;
          buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            if (block.startsWith(': ping')) { got.items.push({ ping: true }); continue; }
            const data = block.split('\n').find((l) => l.startsWith('data: '));
            if (!data) continue;
            const idLine = block.split('\n').find((l) => l.startsWith('id: '));
            got.items.push({ id: idLine?.slice(4) ?? null, e: C.openText(me.key, data.slice(6), C.AAD.event(me.id)).e });
          }
        }
      } catch { /* aborted */ }
    })();
    return got;
  };
  return me;
}
const qr = async () => { const { url, pc } = await call('remote.pair', {}); const h = new URLSearchParams(new URL(url).hash.slice(1)); return { code: h.get('vincular'), pc: C.b64.dec(h.get('pc')), fp: pc }; };
const postPair = (body) => fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function link(p) {
  const q = await qr(); const pub = C.b64.enc(p.kp.pub);
  const res = await postPair({ step: 'start', pub, proof: C.seal(C.pairingKey(p.kp.priv, q.pc, q.code), { pub, name: 'Android', t: Date.now(), v: 4 }, C.AAD.pair) });
  assert.equal(res.status, 200);
  const c = C.open(C.pairingKey(p.kp.priv, q.pc, q.code), (await res.json()).box, C.AAD.pairChallenge);
  const ver = await C.verifierOf(TEST_MASTER, c.kdf);
  const transcript = C.pakeTranscript({ via: 'qr', devPub: p.kp.pub, pcPub: q.pc, sid: c.sid, kdf: c.kdf });
  const K = C.pakeKey({ secret: q.code, dhDevice: C.sharedSecret(p.kp.priv, q.pc), dhPassword: C.sharedSecret(ver.priv, q.pc), transcript });
  const fin = await postPair({ step: 'finish', sid: c.sid, pub, mac: C.b64.enc(C.pakeMac(K, C.MAC_PHONE)) });
  assert.equal(fin.status, 200);
  const data = await fin.json();
  p.key = C.sessionKey(p.kp.priv, q.pc); p.id = data.id;
}
const projects = async () => (await call('projects.list')).length;

test('eventos numerados: reanuda sin hueco, avisa con resync si no puede y manda latidos sin id', async () => {
  const p = phone(); await link(p);
  const live = await p.stream(); // stays open the whole time: what the PC really sent
  await wait(800);
  assert.ok(live.items.some((x) => x.ping), 'latido');
  assert.ok(live.items.filter((x) => x.ping).every((x) => x.id === undefined), 'los latidos no llevan id');
  await call('projects.create', { name: 'evento-1' });
  await until(() => live.items.some((x) => x.id), 'un evento con id');
  const first = live.items.filter((x) => x.id).at(-1).id;
  assert.match(first, /^[0-9a-f]{12}\.\d+$/);
  // the phone loses its stream; two more things happen on the PC
  await call('projects.create', { name: 'evento-2' });
  await call('projects.create', { name: 'evento-3' });
  await wait(300);
  const sent = live.items.filter((x) => x.id).map((x) => x.id);
  const missed = sent.slice(sent.indexOf(first) + 1);
  assert.ok(missed.length >= 2, 'hubo eventos después');
  const back = await p.stream({ 'Last-Event-ID': first });
  await until(() => back.items.filter((x) => x.id).length >= missed.length, 'los eventos perdidos');
  assert.deepEqual(back.items.filter((x) => x.id).slice(0, missed.length).map((x) => x.id), missed, 'los mismos, en orden y sin hueco');
  assert.ok(!back.items.some((x) => x.e === 'resync'), 'sin resync');
  // the same through ?since= (a client that cannot set the header)
  const viaQuery = await p.stream({}, `?since=${first}`);
  await until(() => viaQuery.items.filter((x) => x.id).length >= missed.length, 'los eventos perdidos por ?since=');
  assert.equal(viaQuery.items.find((x) => x.id).id, missed[0]);
  // another run of the engine, an id from the future or a broken one: reload everything
  const other = await p.stream({ 'Last-Event-ID': 'deadbeefdead.3' });
  await until(() => other.items.some((x) => x.e === 'resync'), 'resync por otro arranque');
  assert.equal(other.items.find((x) => x.e === 'resync').id, null, 'resync sin id');
  const future = await p.stream({ 'Last-Event-ID': `${first.split('.')[0]}.99999999` });
  await until(() => future.items.some((x) => x.e === 'resync'), 'resync por un id del futuro');
  const garbage = await p.stream({ 'Last-Event-ID': 'esto no es un id' });
  await until(() => garbage.items.some((x) => x.e === 'resync'), 'resync por un id roto');
  // a fresh connection (no id) gets neither replay nor resync
  const fresh = await p.stream(); await wait(200);
  assert.ok(!fresh.items.some((x) => x.id || x.e === 'resync'));
  for (const s of [live, back, viaQuery, other, future, garbage, fresh]) s.close();
});

test('un nonce repetido del mismo móvil devuelve la respuesta guardada y no ejecuta dos veces', async () => {
  const p = phone(); await link(p);
  const before = await projects();
  const box = p.box('call', { method: 'projects.create', params: { name: 'una-sola-vez' } });
  // both at once: the second arrives while the first is still running
  const [a, b] = await Promise.all([p.post('/api/call', box), p.post('/api/call', box)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const [ma, mb] = [await p.open(a), await p.open(b)];
  assert.equal(ma.r, box.n); assert.equal(mb.r, box.n);
  assert.equal(ma.ok, true); assert.deepEqual(mb, ma, 'la misma respuesta');
  // and later, once it is done
  const c = await p.post('/api/call', box);
  assert.equal(c.status, 200);
  assert.deepEqual(await p.open(c), ma);
  assert.equal(await projects(), before + 1, 'creado una vez');
  // only calls are answered again: anything else with a used nonce is still a replay
  const me = p.box('me', { v: 4 });
  assert.equal((await p.post('/api/me', me)).status, 200);
  assert.equal((await p.post('/api/me', me)).status, 401);
});

test('un nonce repetido por otro dispositivo, caducado o con la firma rota se rechaza', async () => {
  const p = phone(); await link(p); const q = phone(); await link(q);
  const box = p.box('call', { method: 'app.state' });
  assert.equal((await p.post('/api/call', box)).status, 200);
  assert.equal((await q.post('/api/call', box, { id: q.id })).status, 401, 'la caja de un móvil no abre en otro');
  assert.equal((await q.post('/api/call', box, { id: p.id })).status, 200, 'solo el dueño la repite');
  const forged = { ...box, c: box.c.slice(0, -2) + (box.c.endsWith('A') ? 'BA' : 'AA') };
  assert.equal((await p.post('/api/call', forged)).status, 401, 'firma rota');
  const old = p.box('call', { method: 'app.state' }, { at: Date.now() - 20 * 60_000 });
  assert.equal((await p.post('/api/call', old)).status, 409, 'caducada: se rechaza como antes');
  assert.equal((await p.post('/api/call', old)).status, 409, 'y repetirla no la hace valer');
});

test('withDeadline: lo que no acaba da el error a tiempo y lo que acaba pasa', async () => {
  await assert.rejects(withDeadline(() => new Promise(() => {}), 30, () => Object.assign(new Error('x'), { reason: 'timeout' })), { reason: 'timeout' });
  assert.equal(await withDeadline(async () => 7, 1000, () => new Error('no')), 7);
  await assert.rejects(withDeadline(async () => { throw new Error('falla'); }, 1000, () => new Error('no')), /falla/);
});

test('el búfer de eventos: 500 como mucho, 10 minutos como mucho, y resync si ya no está', () => {
  let clock = 1_000_000;
  const j = createJournal({ max: 5, ttlMs: 600_000, now: () => clock, boot: 'aaaaaaaaaaaa' });
  const ids = Array.from({ length: 4 }, (_, i) => j.add({ e: 'x', p: i }));
  assert.deepEqual(j.since(ids[1]).items.map((x) => x.value.p), [2, 3]);
  assert.deepEqual(j.since(ids[3]).items, [], 'al día: nada que reenviar y sin resync');
  for (let i = 4; i < 9; i++) j.add({ e: 'x', p: i }); // 9 in all: only the last 5 are kept (n 5 to 9)
  assert.equal(j.since(ids[0]).resync, true, 'ya se borró');
  assert.equal(j.since(j.idOf(3)).resync, true, 'falta el 4');
  assert.deepEqual(j.since(j.idOf(6)).items.map((x) => x.value.p), [6, 7, 8], 'lo que queda');
  clock += 11 * 60_000;
  assert.deepEqual(j.since(j.idOf(9)).items, [], 'sin novedades: el último id sigue valiendo');
  assert.equal(j.since(j.idOf(7)).resync, true, 'pasaron 10 minutos');
  assert.equal(j.since('bbbbbbbbbbbb.2').resync, true, 'otro arranque');
  assert.equal(j.since(undefined).resync, true);
});
