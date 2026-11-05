// 3.7 (Orb Server, WS2): «Añadir Orb Server» and the link between the app and its server. Engines on loopback with the
// fake agents, no windows: «srv» plays the Orb Server (role centro, without a window), «pc» the owner's app; phones and a
// terminal are Node links (src/core/link.mjs) as the terminal client makes them.
// - the install command's code: one use, 10 minutes (shortened here), bound to the app's key fingerprint;
// - hello capabilities and who has to update (version skew);
// - the hub handoff: the app's phones go to the server by themselves, their Orb mode reaches the PC through the server;
//   unlinking the server brings them back;
// - persons: María's calls forwarded only after the owner confirmed who she is on both; unmapped: refused and audited;
// - the bots' events of the PC mirrored to the server (taller:bot.*, with uids);
// - the guide: the server's own Claude sign-in from the app, moving a bot;
// - nothing of the PC's agent tokens ever reaches the server (scan of everything the PC sealed for it);
// - the real Orb Server engine pairs through `orb-server emparejar`'s call (link.connect with the fingerprint).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine, until, wait, ROOT } from './helpers.mjs';
import { createLink } from '../src/core/link.mjs';
import { paths } from '../src/core/home.mjs';
import { orbIdOf } from '../src/core/backup.mjs';
import { serverSkew, missingCap, CAPS } from '../src/core/server-pair.mjs';
import { serverInstallCommand, parsePairTarget, pairTarget, PLACEHOLDER_SHA256 } from '../src/core/server-install.mjs';
import { SERVER_RELEASE } from '../src/core/server-release.mjs';
import { createHost, prepareHome } from '../src/server/host.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const CANARY = `CANARY-${crypto.randomBytes(8).toString('hex')}`;
const env = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1', ORB_REPLICA_MS: '400', ORB_FORWARD_MS: '8000', ORB_MOVE_TURN_MS: '1500' };
const tmp = []; const engines = []; const links = [];
let srv; let pc; let tSrv; let tPc; let pSrv; let pPc; let dir; let trace; let srvMaria; let pcMaria; let pcLeo;
const rows = (home, sql, ...args) => { const d = new DatabaseSync(paths(home).db, { readOnly: true }); try { return d.prepare(sql).all(...args); } finally { d.close(); } };
const device = (name, kind = 'phone') => { const l = createLink({ file: path.join(dir, `${crypto.randomUUID()}.json`), secret: crypto.randomBytes(32), identity: () => ({ name, kind }) }); links.push(l); l.start(); return l; };
async function phoneOfPc(name, person = null, kind = 'phone') {
  const l = device(name, kind);
  const q = await pc.call('link.qr', { device: kind, ...(person ? { person } : {}) });
  const peer = await l.connect({ code: q.code, address: `127.0.0.1:${pPc}` });
  await until(async () => (await pc.call('link.devices')).some((d) => d.id === peer.id && d.online), `${name} conectado al PC`);
  return l;
}
const serverPeer = async () => (await pc.call('link.peers')).find((p) => p.server);
const pairNow = async () => { const c = await pc.call('link.server.code', {}); return { c, r: await srv.call('link.pairApp', { pair: c.pair }) }; };

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  pSrv = 20000 + Math.floor(Math.random() * 20000); pPc = pSrv + 1;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-enlace-server-'));
  trace = path.join(dir, 'traza.jsonl');
  // The PC's own agent sign-ins and keys, with a canary that must never reach the server.
  const userHome = path.join(dir, 'usuario');
  fs.mkdirSync(path.join(userHome, '.claude'), { recursive: true }); fs.mkdirSync(path.join(userHome, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(userHome, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: CANARY, refreshToken: CANARY } }));
  fs.writeFileSync(path.join(userHome, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: CANARY, tokens: { access_token: CANARY } }));
  tSrv = tempHome({ role: 'centro', mobile: { enabled: true, port: pSrv, name: 'Servidor' } }); tmp.push(tSrv);
  tPc = tempHome({ mobile: { enabled: true, port: pPc, name: 'Portátil' } }); tmp.push(tPc);
  srv = await startEngine(tSrv.home, { env: { ...env, ORB_NUCLEO: '1', ORB_LINK_CAPS: 'persons,bots.home.v1,replica.v1,server,browser.live.v1' } }); engines.push(srv);
  pc = await startEngine(tPc.home, { env: { ...env, ORB_SERVER_CODE_MS: '4000', ORB_LINK_TRACE: trace, USERPROFILE: userHome, HOME: userHome, ANTHROPIC_API_KEY: CANARY, OPENAI_API_KEY: CANARY } }); engines.push(pc);
  await until(async () => (await srv.call('remote.status')).running, 'acceso del servidor');
  await until(async () => (await pc.call('remote.status')).running, 'acceso del PC');
  srvMaria = await srv.call('persons.create', { name: 'María' });
  pcMaria = await pc.call('persons.create', { name: 'María' });
  pcLeo = await pc.call('persons.create', { name: 'Leo' });
});
after(async () => {
  for (const l of links) l.stop();
  for (const e of engines) await e.stop();
  for (const t of tmp) t.cleanup();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
});

test('la orden de instalar: descarga oficial, suma comprobada y el código de un solo uso con la huella de la app', async () => {
  const c = await pc.call('link.server.code', {});
  const st = await pc.call('remote.status');
  assert.match(c.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/);
  assert.equal(c.fp, st.pc);
  assert.ok(c.expiresAt - Date.now() <= 4000 + 500);
  assert.equal(c.pair, `${c.code}@http://127.0.0.1:${pPc}#${st.pc}`);
  assert.match(c.command, /^curl -fsSL https:\/\/github\.com\/.+\/install\.sh -o \/tmp\/orb-install\.sh && echo "[0-9a-f]{64}  \/tmp\/orb-install\.sh" \| sha256sum -c && bash \/tmp\/orb-install\.sh --pair '.+'$/);
  // A release build carries the real sum of install.sh (npm run dist:server writes it); a development build a
  // placeholder that sha256sum refuses.
  if (SERVER_RELEASE.sha256) { assert.equal(c.ready, true); assert.equal(c.sha256, SERVER_RELEASE.sha256); }
  else { assert.equal(c.ready, false, 'sin la suma de WS1 el hash es de relleno (sha256sum lo rechaza)'); assert.equal(c.sha256, PLACEHOLDER_SHA256); }
  assert.deepEqual(parsePairTarget(c.pair), { code: c.code, address: `http://127.0.0.1:${pPc}`, fp: st.pc });
  assert.equal(c.steps.length, 5);
  assert.equal(c.steps[3].cmd, `orb-server emparejar '${c.pair}'`);
  // With the release's sum (WS1 writes it; here by the environment).
  const real = serverInstallCommand({ code: 'ABCD-EFGH-JK', address: '100.64.1.2:3131', fp: 'ab12-cd34-ef56', env: { ORB_SERVER_INSTALL_SHA256: 'a'.repeat(64) } });
  assert.equal(real.ready, true); assert.match(real.command, /echo "a{64}  /);
  assert.throws(() => pairTarget({ code: 'ABCD', address: 'x; rm -rf /', fp: 'ab12-cd34' }));
  // The app's key, only while a code is on screen.
  const h = await (await fetch(`http://127.0.0.1:${pPc}/api/server-hello`)).json();
  assert.equal(h.fp, st.pc);
  await pc.call('link.server.cancelCode');
  assert.equal((await fetch(`http://127.0.0.1:${pPc}/api/server-hello`)).status, 404);
});

test('el código: otra huella no enlaza, un código malo tampoco, caduca y sirve una sola vez', async () => {
  let c = await pc.call('link.server.code', {});
  await assert.rejects(srv.call('link.pairApp', { code: c.code, address: `127.0.0.1:${pPc}`, fp: 'ffff-ffff-ffff' }), /huella/);
  await assert.rejects(srv.call('link.pairApp', { code: 'ZZZZ-ZZZZ-ZZ', address: `127.0.0.1:${pPc}`, fp: c.fp }), /código/);
  assert.equal((await pc.call('link.server.status')).code.active, true, 'los intentos fallidos no gastan el código (hasta 5)');
  await wait(4300);
  await assert.rejects(srv.call('link.pairApp', { pair: c.pair }), /código/, 'caducado');
  assert.equal((await pc.call('link.peers')).length, 0);
  // A phone of the owner and one of Leo, linked to the PC before there is a server.
  await phoneOfPc('Móvil de Ana');
  await phoneOfPc('Móvil de Leo', pcLeo.id);
  c = await pc.call('link.server.code', {});
  const r = await srv.call('link.pairApp', { pair: c.pair });
  assert.equal(r.ok, true); assert.equal(r.app.fp, c.fp);
  await assert.rejects(srv.call('link.pairApp', { pair: c.pair }), /código/, 'una sola vez');
  const peer = await until(serverPeer, 'el PC ve su Server');
  assert.equal(peer.name, 'Servidor');
  const d = await until(async () => (await srv.call('link.devices')).find((x) => x.kind === 'orb' && x.online), 'el Server ve el PC');
  assert.equal(d.confirmed, true); assert.equal(d.devOk, true, 'el PC programa para los móviles del Server');
  assert.equal(rows(tPc.home, "SELECT COUNT(*) AS n FROM chat WHERE role = 'notice' AND body LIKE '%ya está enlazado%'")[0].n, 1);
});

test('hola: capacidades del Server y quién tiene que actualizar', async () => {
  const st = await until(async () => { const s = await pc.call('link.server.status'); return s.peer?.features?.includes('browser.live.v1') && s; }, 'capacidades');
  assert.ok(st.peer.features.includes(CAPS.home) && st.peer.features.includes(CAPS.replica) && st.peer.features.includes('server'));
  assert.equal(st.skew, null, 'las dos de prueba se entienden');
  // The matrix: Server N serves app N and N-1.
  assert.equal(serverSkew({ app: '3.7.0', server: '3.7.2', features: [CAPS.home] }), null);
  assert.equal(serverSkew({ app: '3.6.4', server: '3.7.0', features: [CAPS.home] }), null);
  assert.equal(serverSkew({ app: '3.5.1', server: '3.7.0', features: [CAPS.home] }).who, 'app');
  assert.equal(serverSkew({ app: '3.8.0', server: '3.7.1', features: [CAPS.home] }).who, 'server');
  assert.equal(serverSkew({ app: '3.8.0', server: '3.7.1', features: [CAPS.home] }).upgrade, true);
  assert.equal(serverSkew({ app: '4.0.0', server: '3.9.0', features: [CAPS.home] }).who, 'server');
  assert.equal(serverSkew({ app: '3.7.0', server: '3.6.2', features: ['persons'] }).reason, 'nucleo', 'un Orb Núcleo de 3.6: actualizar en su sitio');
  assert.equal(serverSkew({ app: 'test', server: 'test', features: [CAPS.home] }), null);
  assert.equal(missingCap([CAPS.home], CAPS.vault), 'msg.server.capVault');
  assert.equal(missingCap([CAPS.browserLive], CAPS.browserLive), null);
  const g = await pc.call('link.server.guide');
  assert.equal(g.steps.find((s) => s.id === 'browser').available, true);
  const v = g.steps.find((s) => s.id === 'vault');
  assert.equal(v.available, false); assert.match(v.needs, /Actualízalo/);
});

test('los móviles del PC pasan solos al Server y su modo Orb llega al PC a través de él', async () => {
  const ana = links[0];
  const to = await until(() => ana.peers().find((p) => p.name === 'Servidor' && p.online), 'el móvil de Ana está en el Server', 20000);
  assert.equal(ana.peers().length, 1, 'el enlace con el PC se fue');
  assert.ok(to.handedFrom);
  await until(async () => !(await pc.call('link.devices')).some((d) => d.name === 'Móvil de Ana'), 'el PC olvida su enlace');
  const there = (await srv.call('link.devices')).find((d) => d.name === 'Móvil de Ana');
  assert.equal(there.kind, 'phone');
  const owner = (await srv.call('persons.list')).find((p) => p.role === 'owner');
  assert.equal(there.person, owner.id);
  // Its Orb mode: the server passes it on to the PC (taller.*).
  const list = await ana.call(to.id, 'conversations.list', {});
  assert.ok(Array.isArray(list));
  assert.ok(rows(tPc.home, "SELECT * FROM audit WHERE method = 'conversations.list' AND decision = 'allow' AND reason = 'forward'").length >= 1, 'llegó al PC');
  // Leo is nobody on the server yet: his phone stays with the PC.
  const st = await pc.call('link.server.status');
  assert.equal(st.handoffs.find((h) => h.name === 'Móvil de Leo').status, 'unmapped');
  assert.equal(links[1].peers()[0].name, 'Portátil');
});

test('personas: sin confirmar nadie pasa por otro; con «María aquí = María en el Server» sus llamadas llegan como María', async () => {
  // The workshop's side (forward.mjs › whoAsks) with a board of its own.
  const t = tempHome(); tmp.push(t);
  const { Board } = await import('../src/core/board.mjs');
  const { whoAsks } = await import('../src/engine/forward.mjs');
  const { createPerson } = await import('../src/core/persons.mjs');
  const board = new Board();
  const maria = createPerson(board, { name: 'María' });
  const peer = { id: 'enlace-1', orb: 'a'.repeat(32), person: null, remotePerson: { id: 'dueno-alla' } };
  assert.equal(whoAsks(board, peer, { person: 'dueno-alla' }).person, board.ownerId());
  assert.throws(() => whoAsks(board, peer, { person: 'maria-alla' }), (e) => e.reason === 'otherPerson');
  assert.equal(board.one("SELECT reason FROM audit WHERE decision = 'deny' ORDER BY id DESC LIMIT 1").reason, 'unmappedPerson', 'rechazado y anotado');
  board.run('INSERT INTO link_persons (peer, local_person, remote_person, confirmed_at) VALUES (?, ?, ?, NULL)', peer.orb, maria.id, 'maria-alla');
  assert.throws(() => whoAsks(board, peer, { person: 'maria-alla' }), (e) => e.reason === 'otherPerson', 'sin confirmar no vale');
  board.run('UPDATE link_persons SET confirmed_at = ? WHERE peer = ?', new Date().toISOString(), peer.orb);
  assert.equal(whoAsks(board, peer, { person: 'maria-alla' }).person, maria.id);
  board.db.close();

  // The whole flow: María's phone on the PC, the owner maps her, it goes to the server, her Orb mode reaches the PC as her.
  const mphone = await phoneOfPc('Móvil de María', pcMaria.id);
  const p = await pc.call('link.server.persons');
  assert.equal(p.there.find((x) => x.name === 'María').mappedTo, null, 'nunca por el nombre');
  assert.equal(p.here.find((x) => x.role === 'owner').fixed, true);
  await assert.rejects(pc.call('link.server.map', { remote: p.there.find((x) => x.role === 'owner').id, local: pcMaria.id }), /Tú ya eres tú/);
  await pc.call('link.server.map', { remote: srvMaria.id, local: pcMaria.id });
  assert.equal(rows(tSrv.home, 'SELECT * FROM link_persons WHERE local_person = ? AND remote_person = ? AND confirmed_at IS NOT NULL', srvMaria.id, pcMaria.id).length, 1, 'el Server lo sabe también');
  const to = await until(() => mphone.peers().find((x) => x.name === 'Servidor' && x.online), 'el móvil de María está en el Server', 20000);
  assert.equal((await srv.call('link.devices')).find((d) => d.name === 'Móvil de María').person, srvMaria.id);
  await mphone.call(to.id, 'conversations.list', {});
  assert.ok(rows(tPc.home, "SELECT * FROM audit WHERE method = 'conversations.list' AND decision = 'allow' AND person_id = ?", pcMaria.id).length >= 1, 'en el PC es María');
  // Someone of the server nobody mapped: the server has no workshop for them (nothing goes to the PC).
  const leoSrv = await srv.call('persons.create', { name: 'Leo' });
  const lphone = device('Otro de Leo');
  const q = await srv.call('link.qr', { device: 'phone', person: leoSrv.id });
  const lp = await lphone.connect({ code: q.code, address: `127.0.0.1:${pSrv}` });
  assert.equal((await lphone.call(lp.id, 'taller.status', {})).linked, false, 'sin taller para él: nada llega al PC');
  await assert.rejects(lphone.call(lp.id, 'taller.conversations.list', {}));
  // Someone new there, named as here (createThere): not over a name already in use there; then the existing one.
  await assert.rejects(pc.call('link.server.map', { local: pcLeo.id, createThere: true }), /nombre/);
  const r = await pc.call('link.server.map', { remote: leoSrv.id, local: pcLeo.id });
  assert.equal(r.remote, leoSrv.id);
  assert.equal((await lphone.call(lp.id, 'taller.status', {})).name, 'Portátil', 'ahora su modo Orb va a su PC');
  await until(() => links[1].peers().find((x) => x.name === 'Servidor'), 'el móvil de Leo ya puede pasar', 20000);
});

test('los eventos de los bots del PC llegan al Server como taller:bot.*, con sus uid', async () => {
  const b = await pc.call('bots.create', { name: 'Recados', role_text: 'Recados de casa' });
  await pc.call('bots.send', { id: b.id, text: 'hola recados' });
  const ev = await until(() => srv.events.find((m) => m.event === 'taller:bot.message' && m.payload?.botUid === b.uid && m.payload.role === 'bot'), 'el reflejo en el Server', 20000);
  assert.match(ev.payload.uid, /^[0-9a-f-]{36}$/, 'con el uid de la línea');
  assert.ok(!srv.events.some((m) => m.event === 'bot.message' && m.payload?.botUid), 'no se hace pasar por un bot del Server');
});

test('la guía: Claude del Server sin ventana desde la app, y pasar un bot al Server', async () => {
  const g = await pc.call('link.server.guide');
  assert.deepEqual(g.steps.map((s) => s.id), ['agents', 'bots', 'vault', 'browser']);
  assert.ok(g.steps[0].agents.some((a) => a.agent === 'claude'));
  const before = g.steps[1].botsHere;
  assert.ok(before >= 1);
  const l = await pc.call('link.server.login', { agent: 'claude' });
  assert.match(l.url, /^https:\/\//);
  await until(async () => (await pc.call('link.server.loginState', { id: l.id })).state === 'hecho', 'la sesión del Server', 20000);
  const b = (await pc.call('bots.list')).bots.find((x) => x.name === 'Recados');
  const r = await pc.call('bots.move', { id: b.id, to: g.steps[1].to });
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = (await pc.call('link.server.guide')).steps[1].botsHere;
  assert.equal(after, before - 1);
});

test('el Server nunca recibe los tokens de los agentes del PC', async () => {
  const text = fs.readFileSync(trace, 'utf8');
  assert.ok(text.split('\n').length > 20, 'se vio el tráfico');
  assert.match(text, /"op":"replica"/, 'incluida la copia y el paso del bot');
  assert.ok(!text.includes(CANARY), 'nada de los inicios de sesión del PC');
  assert.ok(!/accessToken|refresh_token|refreshToken|OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(text));
  // Nor in anything the server keeps.
  const walk = (d) => { let out = []; for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) out = out.concat(walk(p)); else out.push(p); } return out; };
  for (const f of walk(tSrv.base)) { let b; try { b = fs.readFileSync(f); } catch { continue; } assert.ok(!b.includes(CANARY), f); }
});

test('desenlazar el Server devuelve los móviles al PC', async () => {
  const peer = await serverPeer();
  await pc.call('link.disconnect', { id: peer.id });
  const ana = links[0];
  await until(() => ana.peers().length === 1 && ana.peers()[0].name === 'Portátil' && ana.peers()[0].online, 'el móvil de Ana vuelve al PC', 20000);
  assert.ok((await pc.call('link.devices')).some((d) => d.name === 'Móvil de Ana'));
  assert.equal((await pc.call('link.server.status')).linked, false);
});

test('el motor de Orb Server de verdad se enlaza con la llamada de «orb-server emparejar»', async () => {
  const port = pPc + 1;
  const t = tempHome({ mobile: { port, name: 'Server real' } }); tmp.push(t);
  const home = prepareHome(t.home, { profile: 'centro' });
  const host = createHost({ home, version: 'test', mode: 'fork', env: { ORB_REMOTE_BIND: '127.0.0.1' }, backoff: { base: 200, max: 1000, stableMs: 60_000 } });
  try {
    await host.start();
    await until(async () => (await host.call('remote.status')).running, 'acceso del Server');
    const c = await pc.call('link.server.code', {});
    const { code, address, fp } = parsePairTarget(c.pair);
    const r = await host.call('link.connect', { code, address, fp }, { as: 'control' });
    assert.equal(r.ok, true);
    const peer = await until(async () => (await pc.call('link.peers')).find((p) => p.name === 'Server real' && p.online && p.remote), 'el PC ve el Server real');
    assert.ok(peer.server);
    assert.ok(peer.remote.features.includes('server'), 'el Server dice que lo es');
    await pc.call('link.disconnect', { id: peer.id });
  } finally { await host.stop(); }
});
