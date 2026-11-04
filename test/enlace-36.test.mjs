// 3.6 «Personas», the gateway between Orbs and devices (acceptance tests 8, 9, 11, 17 and 21 of the plan):
//  8  a QR made for Leo gives a device of Leo whatever it says; a person other than the owner cannot make QRs for others
//     nor give «Puede administrar»;
//  9  forwarding: Leo's phone reaches only Leo's workshop (as Leo there), never Ana's; a workshop of 3.5 (protocol 2)
//     gets only the owner's calls and says «Actualiza»; a request sent again runs once; no answer in time is «desconocido»;
// 11  this PC's window: switching to someone with a PIN asks it; a locked window refuses everything but unlocking;
// 17  version messages (an app too old, a terminal too old, an Orb too old);
// 21  a lost administrator phone: orb-nucleo quitar, pin-reset and enlazar --persona <owner> --admin (local socket);
// plus a linked Orb's backups kept here (link op backup.put) and a copy of an Orb detected on hello.
// Ana is the owner of every Orb here; Leo, a person of the centre.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';
import { createLink, versionGap, PROTOCOL } from '../src/core/link.mjs';
import { versionNotice } from '../src/terminal/client.mjs';
import { createHost, prepareHome } from '../src/server/host.mjs';
import { paths } from '../src/core/home.mjs';
import { createT } from '../src/core/i18n.mjs';
import * as C from '../src/core/mobile-crypto.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const env = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1' };
let centro; let tCentro; let port; let leo; let ana; let dir;
const tmp = []; const engines = []; const links = [];
const rows = (home, sql, ...args) => { const db = new DatabaseSync(paths(home).db, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const device = (name, kind = 'phone', extra = {}) => { const l = createLink({ file: path.join(dir, `${crypto.randomUUID()}.json`), secret: crypto.randomBytes(32), identity: () => ({ name, kind, ...extra }), ...extra.opts }); links.push(l); return l; };
async function workshop(name, extraEnv = {}) {
  const t = tempHome({ role: 'taller', userName: name, mobile: { name } }); tmp.push(t);
  const e = await startEngine(t.home, { env: { ...env, ...extraEnv } }); engines.push(e);
  return { t, e };
}
async function linkWorkshop(w, person = null) {
  const q = await centro.call('link.qr', { device: 'orb', dev: true, ...(person ? { person } : {}) });
  const peer = await w.e.call('link.connect', { code: q.code, address: `127.0.0.1:${port}` });
  await until(async () => (await centro.call('link.devices')).some((d) => d.id === peer.id && d.online), 'el centro ve el taller');
  return peer;
}

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  port = 20000 + Math.floor(Math.random() * 20000);
  tCentro = tempHome({ role: 'centro', mobile: { enabled: true, port, name: 'Servidor' } });
  centro = await startEngine(tCentro.home, { env: { ...env, ORB_FORWARD_MS: '1500', ORB_BACKUP_PUT_MAX: String(5 * 1024 * 1024) } });
  await until(async () => (await centro.call('remote.status')).running, 'acceso del centro');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-enlace36-'));
  leo = await centro.call('persons.create', { name: 'Leo' });
  ana = (await centro.call('persons.list')).find((p) => p.role === 'owner');
});
after(async () => {
  for (const l of links) l.stop();
  for (const e of engines) await e.stop();
  await centro?.stop();
  for (const t of tmp) t.cleanup();
  tCentro?.cleanup();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
});

test('8: el QR para Leo da un dispositivo de Leo; Leo no hace QR para otros ni da administrar', async () => {
  // The device claims to be Ana's and an administrator: it does not matter.
  const phone = device('Móvil de Leo', 'phone', { person: ana.id, admin: true });
  const q = await centro.call('link.qr', { person: leo.id });
  assert.equal(q.person.id, leo.id);
  const peer = await phone.connect({ qr: q.url });
  assert.equal(peer.remotePerson?.id, leo.id, 'el enlace sabe para quién es');
  const d = (await centro.call('link.devices')).find((x) => x.id === peer.id);
  assert.equal(d.person, leo.id);
  assert.equal(d.admin, false);
  const me = await phone.me(peer.id);
  assert.equal(me.person.name, 'Leo');
  assert.equal(me.v, PROTOCOL);
  // «Puede administrar» only on a device of the owner.
  await assert.rejects(centro.call('link.setAdmin', { id: peer.id, admin: true }), /dueño/);
  await assert.rejects(centro.call('link.qr', { person: leo.id, admin: true }), /dueño/);
  // Leo at this PC's window: a QR for himself only.
  assert.equal((await centro.call('persons.switch', { id: leo.id })).ok, true);
  try {
    await assert.rejects(centro.call('link.qr', { person: ana.id }), /acceso|dueño/);
    await assert.rejects(centro.call('link.qr', { newPerson: 'Otra' }), /acceso|dueño/);
    await assert.rejects(centro.call('link.qr', { admin: true }), /acceso|dueño/);
    const mine = await centro.call('link.qr', {});
    assert.equal(mine.person.id, leo.id);
    // His devices only.
    const list = await centro.call('link.devices');
    assert.ok(list.length >= 1 && list.every((x) => x.person === leo.id));
  } finally { assert.equal((await centro.call('persons.switch', { id: ana.id })).ok, true); }
  // The owner may make one for someone new.
  const nq = await centro.call('link.qr', { newPerson: 'Eva' });
  assert.equal(nq.person.name, 'Eva');
  // A phone sees only its person's devices (B2).
  const st = await phone.call(peer.id, 'link.status');
  assert.ok(st.devices.every((x) => x.person === leo.id), 'Leo solo ve sus dispositivos');
});

test('17: mensajes de versión (app, terminal y Orb antiguos)', async () => {
  // A client of protocol 1 is told to update when linking (the QR is not used up).
  const q = await centro.call('link.qr', { person: leo.id, device: 'terminal' });
  const old = device('Terminal vieja', 'terminal', { opts: { protocol: 1, min: 1 } });
  await assert.rejects(old.connect({ qr: q.url }), (e) => e.status === 426 && /Actualiza/.test(e.message));
  // A terminal of protocol 2 (3.5) still works, as the person the QR was for.
  const t2 = device('Terminal 3.5', 'terminal', { opts: { protocol: 2, min: 2 } });
  const peer = await t2.connect({ qr: q.url });
  assert.equal((await t2.me(peer.id)).person.id, leo.id);
  // /api/me of a client that says protocol 1: «Actualiza».
  const raw = t2.raw(peer.id);
  const r = await raw.post('/api/me', raw.box('me', { v: 1 }));
  const msg = C.open(raw.key, await r.json(), C.AAD.response(raw.id));
  assert.equal(msg.ok, false); assert.equal(msg.status, 426); assert.match(msg.error, /Actualiza/);
  // The terminal's own messages.
  const t = createT('es');
  assert.match(versionNotice({ v: 4, min: 4 }, 'Servidor', t), /orb-terminal/);
  assert.match(versionNotice({ v: 1, min: 1, version: '3.4.0' }, 'Servidor', t), /Actualiza Servidor/);
  assert.equal(versionNotice({ v: 3, min: 2 }, 'Servidor', t), null);
  assert.equal(versionGap({ v: 3, min: 3 }, { v: 2 }), 'them');
  assert.equal(versionGap({ v: 2, min: 2 }, { v: 3, min: 3 }), 'me');
});

test('9: reenvío al taller de cada persona (A13), 3.5 solo el dueño, una sola vez y «desconocido» (A12)', async () => {
  const anaPhone = device('Móvil de Ana');
  const anaPeer = await anaPhone.connect({ qr: (await centro.call('link.qr', {})).url });
  const leoPhone = device('Otro móvil de Leo');
  const leoPeer = await leoPhone.connect({ qr: (await centro.call('link.qr', { person: leo.id })).url });

  // Ana's workshop.
  const w1 = await workshop('Taller de Ana');
  await w1.e.call('projects.create', { name: 'proyecto-ana-w1' });
  await linkWorkshop(w1);
  await until(async () => (await centro.call('link.status')).taller?.online, 'taller de Ana en marcha');
  assert.ok((await anaPhone.call(anaPeer.id, 'taller.projects.list')).some((p) => p.name === 'proyecto-ana-w1'));
  // Leo has no workshop: Ana's is not for him (refused, audited, and nothing of it is told).
  const e1 = await leoPhone.call(leoPeer.id, 'taller.projects.list').then(() => null, (e) => e);
  assert.ok(e1 && e1.status === 404, 'Leo no llega al taller de Ana');
  assert.ok(!/Ana/.test(e1.message));
  assert.ok(rows(tCentro.home, "SELECT * FROM audit WHERE person_id = ? AND method = 'taller.projects.list' AND decision = 'deny'", leo.id).length, 'queda en la auditoría');
  assert.equal((await leoPhone.call(leoPeer.id, 'taller.status')).linked, false);

  // Leo's workshop of 3.5 (protocol 2): his calls are not forwarded («Actualiza»).
  const w2 = await workshop('Taller de Leo', { ORB_LINK_PROTOCOL: '2' });
  await w2.e.call('projects.create', { name: 'proyecto-leo-w2' });
  await linkWorkshop(w2, leo.id);
  await until(async () => (await centro.call('link.devices')).some((d) => d.person === leo.id && d.kind === 'orb' && d.online && d.v === 2), 'taller viejo de Leo');
  await assert.rejects(leoPhone.call(leoPeer.id, 'taller.projects.list'), (e) => e.status === 426 && /Actualiza Taller de Leo/.test(e.message));

  // Updated (protocol 3): Leo's calls reach his workshop, run there as its person, audited on both sides.
  await w2.e.stop(); engines.splice(engines.indexOf(w2.e), 1);
  const w2b = await startEngine(w2.t.home, { env }); engines.push(w2b);
  await until(async () => (await centro.call('link.devices')).some((d) => d.person === leo.id && d.kind === 'orb' && d.online && d.v === 3), 'taller de Leo actualizado');
  const leoList = await leoPhone.call(leoPeer.id, 'taller.projects.list');
  assert.ok(leoList.some((p) => p.name === 'proyecto-leo-w2'));
  assert.ok(!leoList.some((p) => p.name === 'proyecto-ana-w1'), 'nada del taller de Ana');
  const anaList = await anaPhone.call(anaPeer.id, 'taller.projects.list');
  assert.ok(!anaList.some((p) => p.name === 'proyecto-leo-w2'), 'Ana no llega al taller de Leo');
  const w2owner = rows(w2.t.home, "SELECT id FROM persons WHERE role = 'owner'")[0].id;
  assert.ok(rows(w2.t.home, "SELECT * FROM audit WHERE method = 'projects.list' AND decision = 'allow' AND channel = 'forward' AND person_id = ?", w2owner).length, 'el taller lo registra, como su persona');
  assert.ok(rows(tCentro.home, "SELECT * FROM audit WHERE person_id = ? AND method = 'taller.projects.list' AND decision = 'allow'", leo.id).length, 'el centro también');

  // No answer in time (the workshop takes 3 s, the centre waits 1.5 s): «desconocido», kept in Leo's queue.
  const slow = await leoPhone.call(leoPeer.id, 'taller.projects.create', { name: 'una-sola-vez', __testDelayMs: 3000 }).then(() => null, (e) => e);
  assert.ok(slow?.unknown && slow.status === 504 && slow.queueId, 'desconocido');
  const mine = await leoPhone.call(leoPeer.id, 'taller.queued');
  assert.equal(mine.find((x) => x.id === slow.queueId)?.status, 'desconocido');
  assert.ok(!(await anaPhone.call(anaPeer.id, 'taller.queued')).some((x) => x.id === slow.queueId), 'la cola de Leo no la ve Ana');
  await until(async () => (await w2b.call('projects.list')).some((p) => p.name === 'una-sola-vez'), 'el taller lo hizo');
  // «Comprobar»: the same request_id again: the workshop answers what it did (no second run, no «ya existe»).
  const again = await leoPhone.call(leoPeer.id, 'taller.retry', { id: slow.queueId });
  assert.equal(again.status, 'hecho');
  assert.equal((await w2b.call('projects.list')).filter((p) => p.name === 'una-sola-vez').length, 1, 'una sola vez');
  assert.equal(rows(w2.t.home, 'SELECT COUNT(*) AS n FROM link_seen')[0].n >= 1, true);
});

test('backup.put: un Orb del dueño guarda aquí sus copias (cifradas), con límite; los demás no', async () => {
  const q = await centro.call('link.qr', { device: 'orb' });
  const orb = device('Portátil de Ana', 'orb');
  const peer = await orb.connect({ qr: q.url });
  const file = path.join(dir, 'orb-20261104-120000Z-manual.orbbak');
  const body = Buffer.concat([Buffer.from('ORBBAK1\n'), crypto.randomBytes(3_400_000)]);
  fs.writeFileSync(file, body);
  const r = await orb.putBackup(peer.id, file);
  assert.equal(r.stored, true);
  const kept = path.join(tCentro.home, '.orb', 'copias-seguridad', 'de-otros-orbs', peer.id, path.basename(file));
  assert.ok(fs.readFileSync(kept).equals(body), 'la copia llega entera');
  // Not a backup, too big, or an Orb of someone else: refused.
  const fake = path.join(dir, 'orb-falsa.orbbak'); fs.writeFileSync(fake, crypto.randomBytes(1000));
  await assert.rejects(orb.putBackup(peer.id, fake), (e) => e.status === 400);
  const big = path.join(dir, 'orb-grande.orbbak'); fs.writeFileSync(big, Buffer.concat([Buffer.from('ORBBAK1\n'), Buffer.alloc(6 * 1024 * 1024)]));
  await assert.rejects(orb.putBackup(peer.id, big), (e) => e.status === 413);
  const leoOrb = device('Portátil de Leo', 'orb');
  const lp = await leoOrb.connect({ qr: (await centro.call('link.qr', { device: 'orb', person: leo.id })).url });
  await assert.rejects(leoOrb.putBackup(lp.id, file), (e) => e.status === 403);
});

test('una copia de un Orb (otra máquina, misma identidad) no se atiende; una mudanza sí', async () => {
  const orbId = crypto.randomBytes(16).toString('hex');
  const id = { orbId, incarnation: 2, host: 'equipo-a' };
  const orb = device('Orb que se muda', 'orb', {});
  const l = createLink({ file: path.join(dir, 'muda.json'), secret: crypto.randomBytes(32), identity: () => ({ name: 'Orb que se muda', kind: 'orb', role: 'centro', orb: { ...id } }) });
  links.push(l); orb.stop();
  const peer = await l.connect({ qr: (await centro.call('link.qr', { device: 'orb' })).url });
  await until(async () => (await centro.call('link.devices')).find((d) => d.id === peer.id)?.online, 'enlazado');
  await until(() => rows(tCentro.home, 'SELECT meta FROM devices WHERE id = ?', peer.id)[0].meta.includes(orbId), 'identidad guardada');
  // Moved (a newer incarnation): followed.
  id.incarnation = 3; id.host = 'equipo-b'; l.refresh();
  await until(() => rows(tCentro.home, 'SELECT meta FROM devices WHERE id = ?', peer.id)[0].meta.includes('"incarnation":3'), 'mudanza');
  // The old one again (incarnation 2): a copy, refused and told.
  id.incarnation = 2; id.host = 'equipo-a'; l.refresh();
  await until(async () => (await centro.call('link.devices')).find((d) => d.id === peer.id)?.clone, 'copia detectada');
});

test('11: cambiar de persona en la ventana pide el PIN; bloqueada solo deja desbloquear', async () => {
  assert.equal((await centro.call('persons.switch', { id: leo.id })).ok, true, 'sin PIN no se pide');
  await centro.call('persons.setPin', { pin: '4321' });
  assert.equal((await centro.call('persons.switch', { id: ana.id })).ok, true);
  const no = await centro.call('persons.switch', { id: leo.id });
  assert.equal(no.ok, false); assert.equal(no.reason, 'wrong');
  assert.equal((await centro.call('persons.me')).person.id, ana.id, 'sigue Ana');
  assert.equal((await centro.call('persons.switch', { id: leo.id, pin: '4321' })).ok, true);
  assert.equal((await centro.call('persons.me')).person.id, leo.id);
  // Locked: everything refused by the engine but unlocking; app.state only says who may unlock.
  await centro.call('persons.lock');
  await assert.rejects(centro.call('tasks.list'), /bloqueada/);
  await assert.rejects(centro.call('persons.switch', { id: ana.id }), /bloqueada/);
  const st = await centro.call('app.state');
  assert.equal(st.locked, true); assert.equal(st.config, undefined, 'nada más');
  assert.deepEqual(st.persons.map((p) => p.name).sort(), ['Ana', 'Eva', 'Leo']);
  assert.equal((await centro.call('persons.unlock', { pin: '0000' })).ok, false);
  await assert.rejects(centro.call('tasks.list'), /bloqueada/);
  assert.equal((await centro.call('persons.unlock', { pin: '4321' })).ok, true);
  assert.ok(Array.isArray(await centro.call('tasks.list')));
  // Ana (no PIN) sits down again.
  await centro.call('persons.lock');
  assert.equal((await centro.call('persons.unlock', { id: ana.id })).ok, true);
  assert.equal((await centro.call('persons.me')).person.id, ana.id);
  assert.ok(centro.events.some((m) => m.event === 'persons:locked'));
});

test('21: móvil de administrar perdido: quitar, pin-reset y enlazar --persona <dueño> --admin (Orb Núcleo)', async () => {
  const p2 = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { port: p2 } }); tmp.push(t);
  const home = prepareHome(t.home, { profile: 'centro' });
  const host = createHost({ home, version: 'test', env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  const ctl = (m, p = {}) => host.call(m, p, { as: 'control' });
  try {
    await host.start();
    await until(async () => (await host.call('remote.status')).running, 'acceso del núcleo');
    const leoN = await ctl('persons.create', { name: 'Leo' });
    const owner = (await ctl('persons.list')).find((p) => p.role === 'owner');
    // The first device administers (orb-nucleo enlazar), then it is lost.
    const lost = device('Móvil perdido');
    const lp = await lost.connect({ qr: (await ctl('link.qr', { admin: 'first' })).url });
    assert.equal((await ctl('link.devices')).find((d) => d.id === lp.id).admin, true);
    await host.call('persons.setPin', { pin: '2468' });
    // orb-nucleo quitar <id>
    await ctl('link.revoke', { id: lp.id });
    assert.ok(!(await ctl('link.devices')).some((d) => d.id === lp.id));
    await assert.rejects(lost.call(lp.id, 'link.status'), (e) => e.revoked);
    // orb-nucleo pin-reset <dueño>: the owner on the server itself, no PIN asked.
    await ctl('persons.setPin', { id: owner.id, pin: null });
    assert.equal((await ctl('persons.list')).find((p) => p.id === owner.id).hasPin, false);
    // orb-nucleo enlazar --persona <dueño> --admin: a new administrator phone, even with another one there.
    const fresh = device('Móvil nuevo');
    const fp = await fresh.connect({ qr: (await ctl('link.qr', { person: owner.name, admin: true })).url });
    const d = (await ctl('link.devices')).find((x) => x.id === fp.id);
    assert.equal(d.admin, true); assert.equal(d.person, owner.id);
    // For someone else, never «Puede administrar».
    await assert.rejects(ctl('link.qr', { person: 'Leo', admin: true }), /dueño/);
    const lq = await ctl('link.qr', { person: 'leo' });
    assert.equal(lq.person.id, leoN.id);
    // What the control socket may call stays short.
    await assert.rejects(ctl('config.save', { patch: {} }), /ordenador|PC|acceso/);
    const overview = await ctl('persons.overview');
    assert.ok(overview.every((x) => typeof x.counts.bots === 'number' && !('title' in x)));
  } finally { await host.stop(); }
  // The commands exist.
  const { spawnSync } = await import('node:child_process');
  const help = spawnSync(process.execPath, [path.join(ROOT, 'src', 'server', 'orb-nucleo.mjs'), '--help'], { encoding: 'utf8', windowsHide: true });
  for (const c of ['usuarios', 'usuario nuevo', 'pin-reset', '--usuario']) assert.ok(help.stdout.includes(c), c);
});
