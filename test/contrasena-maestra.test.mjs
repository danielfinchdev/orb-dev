// 3.8: the master password (src/core/master.mjs, src/engine/api-master.mjs) and Magic Link with it (src/engine/remote.mjs).
// The data key round trip, the waits after wrong passwords, the data key opened by this PC's sealed secret (a different
// secret plays another PC), the secrets of earlier versions moved out of the database and orb.json, the guarded methods,
// changing and forgetting it (phones unlinked), linking a phone with the right and the wrong password (the code not used
// up, five per code), an app of 3.7 told to update, and backups without any secret in clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine, until } from './helpers.mjs';
import { Master, FILES, FREE_TRIES, UNLOCK_MS, mirrorTo, restoreMissing } from '../src/core/master.mjs';
import { sealConnectors, resolveEnv, isRef } from '../src/core/connector-secrets.mjs';
import { needsUnlock } from '../src/core/permissions.mjs';
import { passwordStrength } from '../src/ui/lib/core-access.js';
import * as C from '../src/core/mobile-crypto.mjs';
import * as K from '../src/core/backup.mjs';
import { parseLinkPayload } from '../src/core/link-payload.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';
import { walkFiles } from '../src/core/backup.mjs';

const PASS = 'una frase larga de prueba';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orb-maestra-'));
const secretA = crypto.randomBytes(32); const secretB = crypto.randomBytes(32);
const filesText = (dir) => walkFiles(dir).map((f) => fs.readFileSync(f).toString('latin1')).join('\n');

test('la clave de datos: se crea con este PC, la contraseña la envuelve, los secretos van cifrados y nada en claro', async () => {
  const dir = tmp();
  const m = new Master(dir, { secret: secretA });
  assert.equal(m.openWithMachine(), true, 'un espacio nuevo: clave de datos nueva, ya abierta');
  assert.deepEqual(m.state(), { exists: false, locked: false, changedAt: null });
  m.set('remote_keys', { priv: 'CLAVE-PRIVADA-DEL-PC' });
  await assert.rejects(m.create('corta'), { code: 'short' });
  await m.create(PASS);
  assert.equal(m.hasPassword(), true);
  await assert.rejects(m.create(PASS), { code: 'exists' });
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!text.includes('CLAVE-PRIVADA-DEL-PC') && !text.includes(PASS), `${f} sin secretos ni contraseña en claro`);
  }
  // Another PC (another secret): it cannot open by itself; the password opens it and wraps it for that PC.
  const other = new Master(dir, { secret: secretB });
  assert.equal(other.openWithMachine(), false);
  assert.equal(other.state().locked, true);
  assert.throws(() => other.get('remote_keys'), { code: 'locked' });
  assert.equal((await other.verify('no es esta')).reason, 'wrong');
  assert.equal((await other.verify(PASS)).ok, true);
  assert.deepEqual(other.get('remote_keys'), { priv: 'CLAVE-PRIVADA-DEL-PC' });
  assert.equal(new Master(dir, { secret: secretB }).openWithMachine(), true, 'desde entonces, ese PC la abre solo');
  // Changing it wraps the same key again: the secrets stay, the old password no longer opens.
  const again = new Master(dir, { secret: secretA }); again.openWithMachine();
  assert.equal((await again.change('mal', 'otra frase larga')).ok, false);
  assert.equal((await again.change(PASS, 'otra frase larga')).ok, true);
  const fresh = new Master(dir, { secret: crypto.randomBytes(32) });
  assert.equal((await fresh.verify(PASS)).ok, false);
  assert.equal((await fresh.verify('otra frase larga')).ok, true);
  assert.deepEqual(fresh.get('remote_keys'), { priv: 'CLAVE-PRIVADA-DEL-PC' });
  // A changed file does not open (authenticated encryption).
  const v = JSON.parse(fs.readFileSync(path.join(dir, FILES.vault), 'utf8'));
  fs.writeFileSync(path.join(dir, FILES.vault), JSON.stringify({ ...v, box: Buffer.from(Buffer.from(v.box, 'base64').map((b, i) => (i === 40 ? b ^ 1 : b))).toString('base64') }));
  const broken = new Master(dir, { secret: secretA });
  assert.equal((await broken.verify('otra frase larga')).ok, true);
  assert.throws(() => broken.get('remote_keys'), { code: 'damaged' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contraseñas incorrectas: cinco seguidas y luego esperas que crecen (también tras reiniciar); el token dura 5 minutos', async () => {
  const dir = tmp();
  let now = Date.parse('2026-11-07T10:00:00Z');
  const m = new Master(dir, { secret: secretA, now: () => now }); m.openWithMachine();
  await m.create(PASS);
  for (let i = 1; i < FREE_TRIES; i++) assert.deepEqual(await m.verify('mal'), { ok: false, reason: 'wrong', left: FREE_TRIES - i });
  const fifth = await m.verify('mal');
  assert.equal(fifth.reason, 'wrong'); assert.equal(Date.parse(fifth.until) - now, 30_000, 'la quinta empieza 30 s de espera');
  assert.equal((await m.verify(PASS)).reason, 'wait', 'durante la espera ni la buena entra');
  const restarted = new Master(dir, { secret: secretA, now: () => now }); restarted.openWithMachine();
  assert.equal((await restarted.verify(PASS)).reason, 'wait', 'la espera sigue tras reiniciar');
  now += 31_000;
  assert.equal(Date.parse((await m.verify('mal')).until) - now, 60_000, 'la siguiente, el doble');
  assert.equal((await m.verify('pair-no-cuenta', 'pair')).reason, 'wrong', 'el canal del móvil cuenta aparte');
  now += 61_000;
  assert.equal((await m.verify(PASS)).ok, true);
  assert.equal((await m.verify('mal')).left, FREE_TRIES - 1, 'una buena pone la cuenta a cero');
  const { unlock, until } = m.issue();
  assert.equal(until - now, UNLOCK_MS);
  assert.equal(m.checkToken(unlock), true);
  now += UNLOCK_MS + 1;
  assert.equal(m.checkToken(unlock), false, 'a los 5 minutos ya no vale');
  const second = m.issue().unlock; m.lock();
  assert.equal(m.checkToken(second), false, 'bloquear la ventana lo quita');
  assert.equal(m.checkToken('inventado'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('la copia fuera de core repone lo que falta; los conectores guardan referencias; qué acciones lo piden', async () => {
  const dir = tmp(); const mirror = tmp();
  const m = new Master(dir, { secret: secretA }); m.openWithMachine(); m.onChange = () => mirrorTo(dir, mirror);
  await m.create(PASS);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(restoreMissing(dir, mirror).sort(), [FILES.master, FILES.machine, FILES.vault].sort());
  const back = new Master(dir, { secret: secretA });
  assert.equal(back.openWithMachine(), true);
  // Connectors: the values go into the vault, references stay; a reference copied into another connector gets nothing.
  const servers = [{ name: 'github', command: 'npx', env: { GITHUB_TOKEN: 'ghp_SECRETO' } }, { name: 'otro', command: 'x', env: { GITHUB_TOKEN: 'orb-secret:mcp/github/GITHUB_TOKEN' } }];
  const sealed = sealConnectors(back, servers);
  assert.ok(sealed.every((s) => Object.values(s.env).every(isRef)));
  assert.ok(!JSON.stringify(sealed).includes('ghp_SECRETO'));
  assert.deepEqual(resolveEnv(back, sealed[0]), { GITHUB_TOKEN: 'ghp_SECRETO' });
  assert.deepEqual(resolveEnv(back, sealed[1]), {}, 'la referencia de otro conector no le da su clave');
  assert.equal(sealConnectors(back, sealed.slice(0, 1)), null, 'nada nuevo que guardar');
  assert.deepEqual(back.ids('mcp/'), ['mcp/github/GITHUB_TOKEN'], 'las claves de un conector quitado se van');
  // What asks for it.
  for (const m2 of ['backup.restore', 'legacy.delete', 'link.revoke', 'remote.revoke', 'master.check', 'secrets.connector', 'secrets.saveConnector']) assert.equal(needsUnlock(m2, {}), true, m2);
  assert.equal(needsUnlock('config.save', { patch: { backup: { folder: '' } } }), true);
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: [{ name: 'a', env: { K: 'claro' } }] } }), true);
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: sealed } }), false, 'con referencias, no');
  assert.equal(needsUnlock('config.save', { patch: { ui: { theme: 'claro' } } }), false);
  assert.equal(needsUnlock('backup.now', {}), false);
  assert.deepEqual([passwordStrength('corta'), passwordStrength('12345678'), passwordStrength('una frase larga de verdad'), passwordStrength('Frase-Larga-2026!x')], [0, 1, 3, 4]);
  for (const d of [dir, mirror]) fs.rmSync(d, { recursive: true, force: true });
});

test('el motor: secretos de 3.7 fuera de la base y de orb.json, acciones protegidas, otro PC bloqueado y la copia sin nada en claro', async () => {
  const t = tempHome({ mcpServers: [{ name: 'github', command: 'npx', args: [], env: { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' } }] });
  // A database of 3.7 kept the PC's key for the phones in clear.
  const priv = C.newKeyPair().priv;
  { const { Board } = await import('../src/core/board.mjs'); const b = new Board(); b.settingJson('remote_keys', { priv: C.b64.enc(priv), vapid: { publicKey: 'pub', privateKey: 'VAPID_PRIVADA_X' } }); b.db.close(); }
  const hex = secretA.toString('hex');
  let e = await startEngine(t.home, { secret: hex });
  try {
    const db = fs.readFileSync(path.join(t.home, 'core', 'datos', 'orb.db')).toString('latin1');
    assert.ok(!db.includes(C.b64.enc(priv)), 'la clave del PC ya no está en la base');
    const config = fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8');
    assert.ok(!config.includes('ghp_DE_PRUEBA_123') && config.includes('orb-secret:mcp/github/GITHUB_TOKEN'), 'orb.json guarda la referencia');
    assert.deepEqual(await e.call('master.state'), { exists: false, locked: false, changedAt: null, minLength: 8, unlockMinutes: 5 });
    // Guarded: nothing without the password (there is none yet), then nothing without a fresh unlock.
    await assert.rejects(e.call('secrets.connector', { name: 'github' }), /Crea primero la contraseña maestra/);
    await assert.rejects(e.call('master.create', { password: 'corta' }), /al menos 8/);
    const made = await e.call('master.create', { password: PASS });
    assert.match(made.unlock, /^[0-9a-f]{48}$/);
    for (const [method, params] of [['secrets.connector', { name: 'github' }], ['legacy.delete', {}], ['link.revoke', { id: 'x' }], ['master.check', {}], ['backup.restore', { file: 'x.orbbak' }], ['config.save', { patch: { backup: { folder: '' } } }]]) {
      await assert.rejects(e.call(method, params), /necesita tu contraseña maestra/, method);
      await assert.rejects(e.call(method, { ...params, unlock: 'f'.repeat(48) }), /necesita tu contraseña maestra/, `${method} con un token inventado`);
    }
    assert.equal(await e.call('master.check', { unlock: made.unlock }), true);
    assert.deepEqual(await e.call('secrets.connector', { name: 'github', unlock: made.unlock }), { name: 'github', env: { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' } });
    await e.call('secrets.saveConnector', { name: 'github', env: { GITHUB_TOKEN: 'ghp_NUEVO_456', OTRA: 'valor-otra' }, unlock: made.unlock });
    assert.ok(!fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8').includes('ghp_NUEVO_456'));
    await e.call('master.lock');
    await assert.rejects(e.call('master.check', { unlock: made.unlock }), /necesita/, 'bloquear la ventana quita el desbloqueo');
    await assert.rejects(e.call('master.unlock', { password: 'mala' }), /Contraseña incorrecta. Te quedan 4 intentos/);
    const { unlock } = await e.call('master.unlock', { password: PASS });
    assert.equal(await e.call('master.check', { unlock }), true);
    // The backup: no secret in clear in any file of it; the vault inside opens with the password.
    const { code } = await e.call('backup.recovery', {});
    const made2 = await e.call('backup.now', {});
    const into = path.join(t.base, 'restaurada');
    await K.restoreInto(into, made2.path, { passphrase: code });
    const all = filesText(into);
    for (const s of ['ghp_NUEVO_456', 'valor-otra', 'ghp_DE_PRUEBA_123', C.b64.enc(priv), 'VAPID_PRIVADA_X', PASS]) assert.ok(!all.includes(s), `la copia no lleva «${s}» en claro`);
    const inside = new Master(path.join(into, 'core', 'secretos'), { secret: crypto.randomBytes(32) });
    assert.equal(inside.openWithMachine(), false, 'en otro PC no se abre sola…');
    assert.equal((await inside.verify(PASS)).ok, true, '…pero sí con la contraseña');
    assert.deepEqual(inside.get('mcp/github/OTRA'), 'valor-otra');
    assert.equal(inside.get('remote_keys').priv, C.b64.enc(priv));
  } finally { await e.stop(); }
  // The same workspace with another PC's secret: locked until the password; then this PC's own wrap.
  e = await startEngine(t.home, { secret: secretB.toString('hex') });
  try {
    assert.equal((await e.call('master.state')).locked, true);
    await assert.rejects(e.call('secrets.connector', { name: 'github' }), /necesita/);
    await e.call('master.unlock', { password: PASS });
    assert.equal((await e.call('master.state')).locked, false);
  } finally { await e.stop(); }
  e = await startEngine(t.home, { secret: secretB.toString('hex') });
  try { assert.equal((await e.call('master.state')).locked, false, 'ese PC ya la abre solo'); } finally { await e.stop(); }
  t.cleanup();
});

test('Magic Link: la contraseña maestra va dentro de la prueba sellada; la mala no gasta el código; cinco por código; una app de 3.7 debe actualizarse', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { enabled: true, port } });
  const e = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  const links = [];
  const phone = (opts) => { const p = createPhone(opts); links.push(p); return p; };
  const base = `http://127.0.0.1:${port}`;
  try {
    await until(async () => (await e.call('remote.status')).running, 'acceso');
    const qr = async () => (await e.call('link.qr', { device: 'phone' })).url;
    // Without a master password nobody links.
    await assert.rejects(phone().connect({ qr: await qr() }), (x) => x.status === 403 && x.reason === 'noMaster');
    await e.call('master.create', { password: TEST_MASTER });
    // An app of 3.7: no protocol and no password in its proof → «Actualiza la app», and the code stays.
    const url = await qr();
    const q = parseLinkPayload(url); const pcPub = C.b64.dec(q.pc); const kp = C.newKeyPair(); const pub = C.b64.enc(kp.pub);
    const old = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ via: 'qr', pub, proof: C.seal(C.pairingKey(kp.priv, pcPub, q.code), { pub, name: 'Android', kind: 'phone', t: Date.now() }, C.AAD.pair) }) });
    assert.equal(old.status, 426);
    assert.match((await old.json()).error, /Actualiza la app.*3\.8/);
    // The password never travels in clear: only the sealed proof.
    const raw = { via: 'qr', pub, proof: C.seal(C.pairingKey(kp.priv, pcPub, q.code), { pub, name: 'Android', kind: 'phone', t: Date.now(), v: 4, master: TEST_MASTER }, C.AAD.pair) };
    assert.ok(!JSON.stringify(raw).includes(TEST_MASTER));
    // Wrong: 403 and the same code still links with the right one.
    await assert.rejects(phone({ password: 'no es la buena' }).connect({ qr: url }), (x) => x.status === 403 && x.reason === 'password' && /Te quedan 4 intentos/.test(x.message));
    const good = phone();
    await good.connect({ qr: url });
    assert.equal((await good.call(null, 'projects.list')).length >= 0, true, 'enlazado: ya llama');
    // Five wrong ones on one code: the code is gone (a new one is needed).
    const url2 = await qr();
    for (let i = 1; i < 5; i++) await assert.rejects(phone({ password: `mala ${i}` }).connect({ qr: url2 }), (x) => x.reason === 'password');
    await assert.rejects(phone({ password: 'mala 5' }).connect({ qr: url2 }), (x) => x.reason === 'newCode' && /código nuevo/.test(x.message));
    await assert.rejects(phone().connect({ qr: url2 }), (x) => x.status === 401, 'ese código ya no vale, ni con la buena');
    // And everyone waits a while (all linking attempts together).
    await assert.rejects(phone().connect({ qr: await qr() }), (x) => x.status === 429 && x.reason === 'wait');
    assert.equal((await e.call('link.devices')).length, 1, 'solo el bueno quedó enlazado');
  } finally { for (const l of links) l.stop(); await e.stop(); t.cleanup(); }
});

test('cambiar la contraseña mantiene los móviles; olvidarla en este PC los desenlaza y deja enlazar con la nueva', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { enabled: true, port } });
  const e = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  const links = [];
  const phone = (opts) => { const p = createPhone(opts); links.push(p); return p; };
  try {
    await until(async () => (await e.call('remote.status')).running, 'acceso');
    await e.call('master.create', { password: TEST_MASTER });
    const a = phone(); await a.connect({ qr: (await e.call('link.qr', {})).url });
    await assert.rejects(e.call('master.change', { current: 'mala', next: 'otra contraseña larga' }), /incorrecta/);
    await assert.rejects(e.call('master.change', { current: TEST_MASTER, next: 'corta' }), /al menos 8/);
    const changed = await e.call('master.change', { current: TEST_MASTER, next: 'otra contraseña larga' });
    assert.ok(changed.unlock);
    assert.ok(await a.call(null, 'projects.list'), 'cambiarla no desenlaza');
    await assert.rejects(phone().connect({ qr: (await e.call('link.qr', {})).url }), (x) => x.reason === 'password', 'la vieja ya no enlaza');
    // Forgotten: needs a clear yes; every phone goes; the new one links.
    await assert.rejects(e.call('master.forgot', { password: 'contraseña nueva de verdad' }), /Confirma/);
    const r = await e.call('master.forgot', { password: 'contraseña nueva de verdad', confirm: true });
    assert.equal(r.unlinked, 1); assert.equal(r.wiped, false);
    await assert.rejects(a.call(null, 'projects.list'), (x) => x.status === 401, 'el móvil quedó desenlazado');
    assert.equal((await e.call('link.devices')).length, 0);
    const b = phone({ password: 'contraseña nueva de verdad' });
    await b.connect({ qr: (await e.call('link.qr', {})).url });
    assert.equal((await e.call('link.devices')).length, 1);
  } finally { for (const l of links) l.stop(); await e.stop(); t.cleanup(); }
});
