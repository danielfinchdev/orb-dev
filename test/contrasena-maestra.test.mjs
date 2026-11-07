// 3.8: the master password (src/core/master.mjs, src/engine/api-master.mjs) and Magic Link with it (src/engine/remote.mjs,
// src/core/mobile-crypto.mjs › linkDevice). The data key round trip, the waits after wrong passwords (and failing closed
// when they cannot be counted), only THE data key opens (a planted or deleted maestra.json changes nothing), the
// secrets of earlier versions moved out of the database and orb.json, connectors' keys tied to their command, the guarded
// methods, linking a phone without the password ever leaving it (a passive observer learns nothing, a wrong password
// fails at the key confirmation, the code not used up, five per code), an app of 3.7 told to update, changing it,
// forgetting it with the backups' recovery code (a new data key) or starting from scratch, phones of before 3.8
// unlinked once, the guard over the copies outside core, and backups without any secret in clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { tempHome, startEngine, until } from './helpers.mjs';
import { Master, FILES, FREE_TRIES, UNLOCK_MS, mirrorTo, restoreMissing, keyIdOf, kdfOk, PAIR_ID } from '../src/core/master.mjs';
import { sealConnectors, resolveEnv, isRef, keysHeld, touchesKeys } from '../src/core/connector-secrets.mjs';
import { needsUnlock } from '../src/core/permissions.mjs';
import { passwordStrength, MASTER_MIN } from '../src/ui/lib/core-access.js';
import * as C from '../src/core/mobile-crypto.mjs';
import * as K from '../src/core/backup.mjs';
import { parseLinkPayload, passwordPageOk } from '../src/core/link-payload.mjs';
import { setGuardedRoots, decide } from '../src/core/guard.mjs';
import { paths } from '../src/core/home.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';
import { walkFiles } from '../src/core/backup.mjs';

const PASS = 'una frase larga de prueba';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orb-maestra-'));
const secretA = crypto.randomBytes(32); const secretB = crypto.randomBytes(32);
const filesText = (dir) => walkFiles(dir).map((f) => fs.readFileSync(f).toString('latin1')).join('\n');
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const notices = (home) => { const db = new DatabaseSync(paths(home).db, { readOnly: true }); try { return db.prepare("SELECT body FROM chat WHERE role = 'notice'").all().map((r) => r.body).join(' | '); } finally { db.close(); } };

test('la clave de datos: se crea con este PC, la contraseña la envuelve, los secretos van cifrados y nada en claro', async () => {
  const dir = tmp();
  const m = new Master(dir, { secret: secretA });
  assert.equal(m.openWithMachine(), true, 'un espacio nuevo: clave de datos nueva, ya abierta');
  assert.deepEqual(m.state(), { exists: false, lost: false, locked: false, changedAt: null });
  m.set('remote_keys', { priv: 'CLAVE-PRIVADA-DEL-PC' });
  await assert.rejects(m.create('corta'), { code: 'short' });
  await assert.rejects(m.create('nueve car'), { code: 'short' }, `al menos ${MASTER_MIN}`);
  await m.create(PASS);
  assert.equal(m.hasPassword(), true);
  await assert.rejects(m.create(PASS), { code: 'exists' });
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!text.includes('CLAVE-PRIVADA-DEL-PC') && !text.includes(PASS), `${f} sin secretos ni contraseña en claro`);
  }
  // Every wrap names the data key it holds.
  for (const f of [FILES.master, FILES.machine, FILES.vault]) assert.equal(read(dir, f).keyId, keyIdOf(m.dek), f);
  // Another PC (another secret): it cannot open by itself; the password opens it and wraps it for that PC.
  const other = new Master(dir, { secret: secretB });
  assert.equal(other.openWithMachine(), false);
  assert.equal(other.state().locked, true);
  assert.throws(() => other.get('remote_keys'), { code: 'locked' });
  assert.equal((await other.verify('no es esta contraseña')).reason, 'wrong');
  assert.equal((await other.verify(PASS)).ok, true);
  assert.deepEqual(other.get('remote_keys'), { priv: 'CLAVE-PRIVADA-DEL-PC' });
  assert.equal(new Master(dir, { secret: secretB }).openWithMachine(), true, 'desde entonces, ese PC la abre solo');
  // Changing it wraps the same key again: the secrets stay, the old password no longer opens.
  const again = new Master(dir, { secret: secretA }); again.openWithMachine();
  const before = read(dir, FILES.master).keyId;
  assert.equal((await again.change('mala contraseña', 'otra frase larga')).ok, false);
  assert.equal((await again.change(PASS, 'otra frase larga')).ok, true);
  assert.equal(read(dir, FILES.master).keyId, before, 'cambiarla no cambia la clave de datos');
  const secretC = crypto.randomBytes(32);
  const fresh = new Master(dir, { secret: secretC });
  assert.equal((await fresh.verify(PASS)).ok, false);
  assert.equal((await fresh.verify('otra frase larga')).ok, true);
  assert.deepEqual(fresh.get('remote_keys'), { priv: 'CLAVE-PRIVADA-DEL-PC' });
  // A changed file does not open (authenticated encryption).
  const v = read(dir, FILES.vault);
  fs.writeFileSync(path.join(dir, FILES.vault), JSON.stringify({ ...v, box: Buffer.from(Buffer.from(v.box, 'base64').map((b, i) => (i === 40 ? b ^ 1 : b))).toString('base64') }));
  const broken = new Master(dir, { secret: secretC });
  assert.equal(broken.openWithMachine(), true);
  assert.throws(() => broken.get('remote_keys'), { code: 'damaged' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('solo cuenta LA clave de datos: un maestra.json plantado o borrado no cambia la contraseña; costes de scrypt acotados', async () => {
  const dir = tmp(); const evil = tmp();
  const m = new Master(dir, { secret: secretA }); m.openWithMachine();
  await m.create(PASS);
  m.set('mcp/github/TOKEN', 'ghp_SECRETO');
  // Someone makes a maestra.json elsewhere with their own password and plants it here.
  const theirs = new Master(evil, { secret: secretB }); theirs.openWithMachine(); await theirs.create('contraseña del atacante');
  const mine = fs.readFileSync(path.join(dir, FILES.master));
  fs.copyFileSync(path.join(evil, FILES.master), path.join(dir, FILES.master));
  const here = new Master(dir, { secret: secretA }); here.openWithMachine();
  assert.equal((await here.verify('contraseña del atacante')).ok, false, 'su contraseña no abre la clave de datos de aquí');
  assert.equal((await here.verify(PASS)).ok, false, 'ni la buena con su archivo');
  // On a PC that cannot open anything by itself either: their key does not open the secrets here, so it is refused (and
  // never wrapped for that PC).
  const away = new Master(dir, { secret: crypto.randomBytes(32) });
  const pcWrap = fs.readFileSync(path.join(dir, FILES.machine));
  assert.equal((await away.verify('contraseña del atacante')).ok, false);
  assert.equal(away.unlocked(), false);
  assert.deepEqual(fs.readFileSync(path.join(dir, FILES.machine)), pcWrap, 'la envoltura de este PC, intacta');
  fs.writeFileSync(path.join(dir, FILES.master), mine);
  // Its file deleted while Orb runs: no new password without the old one (the vault and this PC's wrap remember).
  fs.rmSync(path.join(dir, FILES.master));
  const lost = new Master(dir, { secret: secretA }); lost.openWithMachine();
  assert.deepEqual({ exists: lost.state().exists, lost: lost.state().lost }, { exists: true, lost: true });
  await assert.rejects(lost.create('otra contraseña nueva'), { code: 'lost' });
  assert.equal((await lost.verify(PASS)).reason, 'none');
  // Even with the vault deleted too, this PC's wrap says there was a password.
  fs.rmSync(path.join(dir, FILES.vault));
  const bare = new Master(dir, { secret: secretA });
  assert.equal(bare.openWithMachine(), true);
  await assert.rejects(bare.create('otra contraseña nueva'), { code: 'lost' });
  // A PC's wrap that does not open never becomes a new data key in silence.
  const noKey = new Master(dir, { secret: crypto.randomBytes(32) });
  assert.equal(noKey.openWithMachine(), false);
  // scrypt's cost from the file: never cheaper, never hanging.
  for (const kdf of [{ N: 2 ** 2, r: 8, p: 1 }, { N: 2 ** 22, r: 8, p: 1 }, { N: 3 * 2 ** 14, r: 8, p: 1 }, { N: 2 ** 15, r: 1, p: 1 }, { N: 2 ** 15, r: 8, p: 4 }]) assert.equal(kdfOk({ ...kdf, salt: crypto.randomBytes(16).toString('base64') }), false, JSON.stringify(kdf));
  assert.equal(kdfOk({ N: 2 ** 17, r: 8, p: 1, salt: crypto.randomBytes(8).toString('base64') }), false, 'sal corta');
  assert.equal(kdfOk({ N: 2 ** 17, r: 8, p: 1, salt: crypto.randomBytes(16).toString('base64') }), true);
  const cheap = read(evil, FILES.master); cheap.kdf.N = 4;
  fs.writeFileSync(path.join(dir, FILES.master), JSON.stringify(cheap));
  const planted = new Master(dir, { secret: secretA }); planted.openWithMachine();
  assert.equal((await planted.verify('contraseña del atacante')).ok, false);
  for (const d of [dir, evil]) fs.rmSync(d, { recursive: true, force: true });
});

test('contraseñas incorrectas: cinco seguidas y luego esperas que crecen; sin poder contarlas no se comprueba ninguna; el token dura 5 minutos', async () => {
  const dir = tmp();
  let now = Date.parse('2026-11-07T10:00:00Z');
  const m = new Master(dir, { secret: secretA, now: () => now }); m.openWithMachine();
  const told = []; m.onFails = (channel, n) => told.push([channel, n]);
  await m.create(PASS);
  for (let i = 1; i < FREE_TRIES; i++) assert.deepEqual(await m.verify('mala contraseña'), { ok: false, reason: 'wrong', left: FREE_TRIES - i });
  const fifth = await m.verify('mala contraseña');
  assert.equal(fifth.reason, 'wrong'); assert.equal(Date.parse(fifth.until) - now, 30_000, 'la quinta empieza 30 s de espera');
  assert.deepEqual(told, [['pc', 5]], 'tras cinco fallos se avisa al dueño');
  assert.equal((await m.verify(PASS)).reason, 'wait', 'durante la espera ni la buena entra');
  const restarted = new Master(dir, { secret: secretA, now: () => now }); restarted.openWithMachine();
  assert.equal((await restarted.verify(PASS)).reason, 'wait', 'la espera sigue tras reiniciar');
  // The tries file deleted does not give tries back to the same engine (memory counts too).
  fs.rmSync(path.join(dir, FILES.tries));
  assert.equal((await m.verify(PASS)).reason, 'wait', 'borrar intentos.json no quita la espera');
  now += 31_000;
  assert.equal(Date.parse((await m.verify('mala contraseña')).until) - now, 60_000, 'la siguiente, el doble');
  assert.equal((await m.verify('no cuenta aquí', 'pair')).reason, 'wrong', 'el canal del móvil cuenta aparte');
  now += 61_000;
  assert.equal((await m.verify(PASS)).ok, true);
  assert.equal((await m.verify('mala contraseña')).left, FREE_TRIES - 1, 'una buena pone la cuenta a cero');
  // Fail closed: a tries file that cannot be written (a folder in its place) stops every check, even the right one.
  fs.rmSync(path.join(dir, FILES.tries)); fs.mkdirSync(path.join(dir, FILES.tries));
  const stuck = new Master(dir, { secret: secretA, now: () => now }); stuck.openWithMachine();
  for (let i = 0; i < 8; i++) assert.equal((await stuck.verify('mala contraseña')).ok, false);
  assert.notEqual((await stuck.verify(PASS)).ok, true, 'sin poder contar, ni la buena');
  fs.rmSync(path.join(dir, FILES.tries), { recursive: true });
  // A damaged tries file counts as the most fails there can be: the longest wait first.
  fs.writeFileSync(path.join(dir, FILES.tries), '{ roto');
  const damaged = new Master(dir, { secret: secretA, now: () => now }); damaged.openWithMachine();
  assert.equal((await damaged.verify(PASS)).reason, 'wait');
  fs.rmSync(path.join(dir, FILES.tries));
  const ok = new Master(dir, { secret: secretA, now: () => now }); ok.openWithMachine();
  const { unlock, until } = ok.issue();
  assert.equal(until - now, UNLOCK_MS);
  assert.equal(ok.checkToken(unlock), true);
  now += UNLOCK_MS + 1;
  assert.equal(ok.checkToken(unlock), false, 'a los 5 minutos ya no vale');
  const second = ok.issue().unlock; ok.lock();
  assert.equal(ok.checkToken(second), false, 'bloquear la ventana lo quita');
  assert.equal(ok.checkToken('inventado'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('la copia fuera de core repone lo que falta; los conectores guardan referencias atadas a su comando; qué acciones lo piden', async () => {
  const dir = tmp(); const mirror = tmp();
  const m = new Master(dir, { secret: secretA }); m.openWithMachine(); m.onChange = () => mirrorTo(dir, mirror);
  await m.create(PASS);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(restoreMissing(dir, mirror).sort(), [FILES.master, FILES.machine, FILES.vault].sort());
  const back = new Master(dir, { secret: secretA });
  assert.equal(back.openWithMachine(), true);
  // Connectors: the values go into the vault, references stay; a reference copied into another connector gets nothing.
  const servers = [{ name: 'github', command: 'npx', args: ['@x/github'], env: { GITHUB_TOKEN: 'ghp_SECRETO' } }, { name: 'otro', command: 'x', env: { GITHUB_TOKEN: 'orb-secret:mcp/github/GITHUB_TOKEN' } }];
  const sealed = sealConnectors(back, servers);
  assert.ok(sealed.every((s) => Object.values(s.env).every(isRef)));
  assert.ok(!JSON.stringify(sealed).includes('ghp_SECRETO'));
  assert.deepEqual(resolveEnv(back, sealed[0]), { GITHUB_TOKEN: 'ghp_SECRETO' });
  assert.deepEqual(resolveEnv(back, sealed[1]), {}, 'la referencia de otro conector no le da su clave');
  // Its command changed without the master password (orb.json edited): no keys for the new program.
  const swapped = { ...sealed[0], command: 'powershell', args: ['-c', 'robar'] };
  assert.deepEqual(resolveEnv(back, swapped), {}, 'otro comando: sin claves');
  assert.equal(keysHeld(back, swapped), true);
  assert.equal(sealConnectors(back, [swapped]), null, 'guardar sin desbloquear no lo ata al comando nuevo');
  assert.deepEqual(resolveEnv(back, swapped), {});
  sealConnectors(back, [swapped], { trusted: true });
  assert.deepEqual(resolveEnv(back, swapped), { GITHUB_TOKEN: 'ghp_SECRETO' }, 'con la ventana desbloqueada, sí');
  sealConnectors(back, [sealed[0]], { trusted: true });
  assert.equal(sealConnectors(back, sealed.slice(0, 1)), null, 'nada nuevo que guardar');
  assert.deepEqual(back.ids('mcp/'), ['mcp/github/GITHUB_TOKEN'], 'las claves de un conector quitado se van');
  // What asks for it.
  for (const m2 of ['backup.restore', 'backup.recovery', 'backup.verify', 'legacy.delete', 'link.revoke', 'remote.revoke', 'master.check', 'secrets.connector', 'secrets.saveConnector']) assert.equal(needsUnlock(m2, {}), true, m2);
  const current = { mcpServers: sealed.slice(0, 1), protected: ['secreto.txt'] };
  assert.equal(needsUnlock('config.save', { patch: { backup: { folder: '' } } }, current), true);
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: [{ name: 'a', env: { K: 'claro' } }] } }, current), true);
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: sealed.slice(0, 1) } }, current), false, 'con referencias y el mismo comando, no');
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: [{ ...sealed[0], command: 'otro' }] } }, current), true, 'otro comando');
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: [{ ...sealed[0], args: ['otro'] }] } }, current), true, 'otros argumentos');
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: [] } }, current), true, 'quitar un conector con claves');
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: [{ ...sealed[0], env: {} }] } }, current), true, 'quitarle sus claves');
  assert.equal(needsUnlock('config.save', { patch: { mcpServers: [...sealed.slice(0, 1), { name: 'nuevo', command: 'npx' }] } }, current), false, 'añadir uno sin claves, no');
  assert.equal(needsUnlock('config.save', { patch: { protected: [] } }, current), true, 'quitar algo de «Cosas que nadie toca»');
  assert.equal(needsUnlock('config.save', { patch: { protected: ['secreto.txt', 'otro'] } }, current), false, 'añadir, no');
  assert.equal(needsUnlock('config.save', { patch: { ui: { theme: 'claro' } } }, current), false);
  assert.equal(needsUnlock('backup.now', {}), false);
  assert.equal(touchesKeys(current.mcpServers, [{ ...sealed[0], name: 'renombrado' }]), true, 'renombrarlo');
  assert.deepEqual([passwordStrength('corta'), passwordStrength('1234567890'), passwordStrength('una frase larga de verdad'), passwordStrength('Frase-Larga-2026!x')], [0, 1, 3, 4]);
  for (const d of [dir, mirror]) fs.rmSync(d, { recursive: true, force: true });
});

test('el motor: secretos de 3.7 fuera de la base y de orb.json, acciones protegidas, aviso tras cinco fallos, otro PC bloqueado y la copia sin nada en claro', async () => {
  const t = tempHome({ mcpServers: [{ name: 'github', command: 'npx', args: [], env: { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' } }] });
  // A database of 3.7 kept the PC's key for the phones in clear.
  const priv = C.newKeyPair().priv;
  { const { Board } = await import('../src/core/board.mjs'); const b = new Board(); b.settingJson('remote_keys', { priv: C.b64.enc(priv), vapid: { publicKey: 'pub', privateKey: 'VAPID_PRIVADA_X' } }); b.db.close(); }
  const hex = secretA.toString('hex');
  let e = await startEngine(t.home, { secret: hex });
  try {
    const db = fs.readFileSync(path.join(t.home, 'core', 'datos', 'orb.db')).toString('latin1');
    assert.ok(!db.includes(C.b64.enc(priv)) && !db.includes('VAPID_PRIVADA_X'), 'la clave del PC ya no está en la base (ni en sus páginas libres)');
    const config = fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8');
    assert.ok(!config.includes('ghp_DE_PRUEBA_123') && config.includes('orb-secret:mcp/github/GITHUB_TOKEN'), 'orb.json guarda la referencia');
    assert.deepEqual(await e.call('master.state'), { exists: false, lost: false, locked: false, changedAt: null, canForget: false, minLength: 10, unlockMinutes: 5, upgraded: false });
    // Guarded: nothing without the password (there is none yet), then nothing without a fresh unlock.
    await assert.rejects(e.call('secrets.connector', { name: 'github' }), /Crea primero la contraseña maestra/);
    await assert.rejects(e.call('master.create', { password: 'corta' }), /al menos 10/);
    const made = await e.call('master.create', { password: PASS });
    assert.match(made.unlock, /^[0-9a-f]{48}$/);
    for (const [method, params] of [['secrets.connector', { name: 'github' }], ['legacy.delete', {}], ['link.revoke', { id: 'x' }], ['master.check', {}], ['backup.restore', { file: 'x.orbbak' }], ['backup.recovery', {}], ['backup.verify', { file: 'x.orbbak' }], ['config.save', { patch: { backup: { folder: '' } } }], ['config.save', { patch: { mcpServers: [] } }]]) {
      await assert.rejects(e.call(method, params), /necesita tu contraseña maestra/, method);
      await assert.rejects(e.call(method, { ...params, unlock: 'f'.repeat(48) }), /necesita tu contraseña maestra/, `${method} con un token inventado`);
    }
    assert.equal(await e.call('master.check', { unlock: made.unlock }), true);
    assert.deepEqual(await e.call('secrets.connector', { name: 'github', unlock: made.unlock }), { name: 'github', env: { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' } });
    await e.call('secrets.saveConnector', { name: 'github', env: { GITHUB_TOKEN: 'ghp_NUEVO_456', OTRA: 'valor-otra' }, unlock: made.unlock });
    assert.ok(!fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8').includes('ghp_NUEVO_456'));
    await e.call('master.lock');
    await assert.rejects(e.call('master.check', { unlock: made.unlock }), /necesita/, 'bloquear la ventana quita el desbloqueo');
    await assert.rejects(e.call('master.unlock', { password: 'mala contraseña' }), /Contraseña incorrecta. Te quedan 4 intentos/);
    for (let i = 0; i < 4; i++) await assert.rejects(e.call('master.unlock', { password: 'mala contraseña' }), /incorrecta/);
    assert.match(notices(t.home), /5 intentos fallidos seguidos de tu contraseña maestra en este PC/, 'el dueño se entera');
  } finally { await e.stop(); }
  fs.rmSync(path.join(t.home, 'core', 'secretos', FILES.tries));
  e = await startEngine(t.home, { secret: hex });
  try {
    const { unlock } = await e.call('master.unlock', { password: PASS });
    assert.equal(await e.call('master.check', { unlock }), true);
    // The backup: no secret in clear in any file of it; the vault inside opens with the password.
    const { code } = await e.call('backup.recovery', { unlock });
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

// The phone's side of linking, by hand (src/core/mobile-crypto.mjs › linkDevice), keeping what travels: what someone who
// watched the Wi-Fi (and photographed the QR) would have.
async function linkByHand(base, q, password) {
  const kp = C.newKeyPair(); const pcPub = C.b64.dec(q.pc); const pub = C.b64.enc(kp.pub);
  const seen = [];
  const post = async (body) => { const r = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const text = await r.text(); seen.push(JSON.stringify(body), text); return { status: r.status, data: JSON.parse(text) }; };
  const start = await post({ step: 'start', via: 'qr', pub, proof: C.seal(C.pairingKey(kp.priv, pcPub, q.code), { pub, name: 'Pixel', kind: 'phone', t: Date.now(), v: 4, min: 2 }, C.AAD.pair) });
  const ch = C.open(C.pairingKey(kp.priv, pcPub, q.code), start.data.box, C.AAD.pairChallenge);
  const ver = await C.verifierOf(password, ch.kdf);
  const transcript = C.pakeTranscript({ via: 'qr', devPub: kp.pub, pcPub, sid: ch.sid, kdf: ch.kdf });
  const K = C.pakeKey({ secret: q.code, dhDevice: C.sharedSecret(kp.priv, pcPub), dhPassword: C.sharedSecret(ver.priv, pcPub), transcript });
  const mac = C.pakeMac(K, C.MAC_PHONE);
  const fin = await post({ step: 'finish', sid: ch.sid, pub, mac: C.b64.enc(mac) });
  return { kp, pcPub, ch, transcript, mac, fin, seen };
}

test('Magic Link: la contraseña nunca sale del móvil; un espía no puede comprobar contraseñas; la mala falla en la confirmación; cinco por código; una app de 3.7 debe actualizarse', async () => {
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
    // An app of 3.7 (no protocol), or one that still sends the password inside its proof: «Actualiza la app», code kept.
    const url = await qr();
    const q = parseLinkPayload(url); const pcPub = C.b64.dec(q.pc);
    for (const extra of [{}, { v: 4, master: TEST_MASTER }]) {
      const kp = C.newKeyPair(); const pub = C.b64.enc(kp.pub);
      const old = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ via: 'qr', pub, proof: C.seal(C.pairingKey(kp.priv, pcPub, q.code), { pub, name: 'Android', kind: 'phone', t: Date.now(), ...extra }, C.AAD.pair) }) });
      assert.equal(old.status, 426);
      assert.match((await old.json()).error, /Actualiza la app.*3\.8/);
    }
    // A full exchange, as someone watching the Wi-Fi sees it (and they even photographed the QR: code and PC key).
    const watched = await linkByHand(base, q, TEST_MASTER);
    assert.equal(watched.fin.status, 200, 'la buena enlaza');
    const wire = watched.seen.join('\n');
    assert.ok(!wire.includes(TEST_MASTER) && !wire.includes(Buffer.from(TEST_MASTER).toString('base64')), 'la contraseña no viaja de ninguna forma');
    const verifier = await C.verifierOf(TEST_MASTER, watched.ch.kdf);
    assert.ok(!wire.includes(C.b64.enc(verifier.pub)) && !wire.includes(C.b64.enc(verifier.priv)), 'ni el verificador del PC');
    // The observer knows the right password (best case for them), the code, both public keys, the session id and the
    // salt: without the phone's or the PC's private key there is no ECDH(phone, PC), so the MAC cannot be checked.
    for (const guess of [watched.kp.pub, watched.pcPub, new Uint8Array(32)]) {
      const K = C.pakeKey({ secret: q.code, dhDevice: guess, dhPassword: C.sharedSecret(verifier.priv, watched.pcPub), transcript: watched.transcript });
      assert.equal(C.sameBytes(C.pakeMac(K, C.MAC_PHONE), watched.mac), false, 'con lo que viaja no se puede comprobar ninguna contraseña');
    }
    // (The test's own check: with the phone's private key it does match.)
    const real = C.pakeKey({ secret: q.code, dhDevice: C.sharedSecret(watched.kp.priv, watched.pcPub), dhPassword: C.sharedSecret(verifier.priv, watched.pcPub), transcript: watched.transcript });
    assert.equal(C.sameBytes(C.pakeMac(real, C.MAC_PHONE), watched.mac), true);
    // Wrong: refused at the key confirmation (403, no MAC of the PC), and the same code still links with the right one.
    const url1 = await qr();
    const wrong = await linkByHand(base, parseLinkPayload(url1), 'no es la contraseña buena');
    assert.equal(wrong.fin.status, 403); assert.equal(wrong.fin.data.reason, 'password'); assert.equal(wrong.fin.data.mac, undefined);
    assert.match(wrong.fin.data.error, /Te quedan 4 intentos/);
    const good = phone();
    await good.connect({ qr: url1 });
    assert.ok(Array.isArray(await good.call(null, 'projects.list')), 'enlazado: ya llama');
    // Five wrong ones on one code: the code is gone (a new one is needed).
    const url2 = await qr();
    for (let i = 1; i < 5; i++) await assert.rejects(phone({ password: `mala contraseña ${i}` }).connect({ qr: url2 }), (x) => x.reason === 'password');
    await assert.rejects(phone({ password: 'mala contraseña 5' }).connect({ qr: url2 }), (x) => x.reason === 'newCode' && /código nuevo/.test(x.message));
    await assert.rejects(phone().connect({ qr: url2 }), (x) => x.status === 401, 'ese código ya no vale, ni con la buena');
    // And everyone waits a while (all linking attempts together); the owner is told.
    await assert.rejects(phone().connect({ qr: await qr() }), (x) => x.status === 429 && x.reason === 'wait');
    assert.equal((await e.call('link.devices')).length, 2, 'solo los buenos quedaron enlazados');
    assert.match(notices(t.home), /intentos fallidos seguidos de tu contraseña maestra al enlazar un móvil/);
  } finally { for (const l of links) l.stop(); await e.stop(); t.cleanup(); }
});

test('Magic Link: un PC falso con el código (un QR de phishing) no consigue la contraseña ni engaña al móvil; la página sin cifrar no la pide', async () => {
  // The attacker made the QR: it knows the code and its own key, not the password nor the real PC's verifier.
  const evil = C.newKeyPair(); const code = 'codigo-del-atacante';
  let got = null;
  const fake = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const b = JSON.parse(body); const devPub = C.b64.dec(b.pub);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (b.step === 'start') { const sid = 's1'; return res.end(JSON.stringify({ sid, box: C.seal(C.pairingKey(evil.priv, devPub, code), { sid, kdf: { N: 2 ** 15, r: 8, p: 1, salt: C.b64.enc(crypto.randomBytes(16)) } }, C.AAD.pairChallenge) })); }
    got = b;
    // It cannot make the PC's MAC: it answers with something.
    return res.end(JSON.stringify({ id: 'x', mac: C.b64.enc(crypto.randomBytes(32)), box: { n: '', c: '' } }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${fake.address().port}`;
    await assert.rejects(C.linkDevice({ base, pcPub: evil.pub, secret: code, via: 'qr', name: 'Víctima', kind: 'phone', v: 4, min: 2, password: TEST_MASTER }), (x) => x.code === 'badAnswer', 'el móvil ve que no es su PC');
    assert.ok(got && !JSON.stringify(got).includes(TEST_MASTER), 'lo único que recibe es un MAC: la contraseña no');
    // A cost the phone refuses (a fake PC asking for a cheap one, to attack that MAC faster).
    assert.equal(C.pairKdfOk({ N: 2 ** 15, r: 8, p: 1, salt: C.b64.enc(crypto.randomBytes(16)) }), true);
    assert.equal(C.pairKdfOk({ N: 2 ** 4, r: 8, p: 1, salt: C.b64.enc(crypto.randomBytes(16)) }), false);
  } finally { fake.close(); }
  // Pages that may ask for the password: the app, https, this device, Tailscale; never plain http on the Wi-Fi.
  assert.equal(passwordPageOk({ protocol: 'http:', hostname: '192.168.1.5' }), false);
  assert.equal(passwordPageOk({ protocol: 'http:', hostname: '192.168.1.5' }, { app: true }), true);
  assert.equal(passwordPageOk({ protocol: 'https:', hostname: 'casa.tail1.ts.net' }), true);
  assert.equal(passwordPageOk({ protocol: 'http:', hostname: '100.101.2.3' }), true);
  assert.equal(passwordPageOk({ protocol: 'http:', hostname: '100.20.2.3' }), false, 'fuera del rango de Tailscale');
  assert.equal(passwordPageOk({ protocol: 'http:', hostname: '127.0.0.1' }), true);
});

test('cambiar la contraseña mantiene los móviles; olvidarla pide el código de recuperación (clave de datos nueva); sin él, empezar de cero', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { enabled: true, port }, mcpServers: [{ name: 'github', command: 'npx', args: [], env: { GITHUB_TOKEN: 'ghp_CONSERVADA' } }] });
  const e = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  const links = [];
  const phone = (opts) => { const p = createPhone(opts); links.push(p); return p; };
  const dir = path.join(t.home, 'core', 'secretos');
  try {
    await until(async () => (await e.call('remote.status')).running, 'acceso');
    await e.call('master.create', { password: TEST_MASTER });
    const a = phone(); await a.connect({ qr: (await e.call('link.qr', {})).url });
    await assert.rejects(e.call('master.change', { current: 'mala contraseña', next: 'otra contraseña larga' }), /incorrecta/);
    await assert.rejects(e.call('master.change', { current: TEST_MASTER, next: 'corta' }), /al menos 10/);
    const changed = await e.call('master.change', { current: TEST_MASTER, next: 'otra contraseña larga' });
    assert.ok(changed.unlock);
    assert.ok(await a.call(null, 'projects.list'), 'cambiarla no desenlaza');
    await assert.rejects(phone().connect({ qr: (await e.call('link.qr', {})).url }), (x) => x.reason === 'password', 'la vieja ya no enlaza');
    // Forgotten: without a recovery code made on this PC there is no keeping the secrets.
    assert.equal((await e.call('master.state')).canForget, false);
    await assert.rejects(e.call('master.forgot', { code: 'X', password: 'contraseña nueva de verdad', confirm: true }), /no tiene código de recuperación/);
    const { code } = await e.call('backup.recovery', { unlock: changed.unlock });
    assert.equal((await e.call('master.state')).canForget, true);
    await assert.rejects(e.call('master.forgot', { code, password: 'contraseña nueva de verdad' }), /Confirma/);
    await assert.rejects(e.call('master.forgot', { code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH', password: 'contraseña nueva de verdad', confirm: true }), /Código de recuperación incorrecto. Te quedan 4/);
    const oldMaster = fs.readFileSync(path.join(dir, FILES.master));
    const oldKey = JSON.parse(oldMaster).keyId;
    const fpBefore = (await e.call('remote.status')).pc;
    const r = await e.call('master.forgot', { code, password: 'contraseña nueva de verdad', confirm: true });
    assert.equal(r.unlinked, 1);
    assert.notEqual(read(dir, FILES.master).keyId, oldKey, 'clave de datos nueva');
    assert.notEqual((await e.call('remote.status')).pc, fpBefore, 'claves nuevas del PC para los móviles');
    await assert.rejects(a.call(null, 'projects.list'), (x) => x.status === 401, 'el móvil quedó desenlazado');
    assert.deepEqual((await e.call('secrets.connector', { name: 'github', unlock: r.unlock })).env, { GITHUB_TOKEN: 'ghp_CONSERVADA' }, 'las claves de los conectores se conservan');
    // A copy of the old maestra.json (a backup, an old folder) no longer opens anything current.
    const old = tmp(); fs.writeFileSync(path.join(old, FILES.master), oldMaster); fs.copyFileSync(path.join(dir, FILES.vault), path.join(old, FILES.vault));
    const stale = new Master(old, { secret: crypto.randomBytes(32) });
    assert.equal((await stale.verify('otra contraseña larga')).ok, false, 'la vieja ya no abre los secretos de ahora');
    fs.rmSync(old, { recursive: true, force: true });
    const b = phone({ password: 'contraseña nueva de verdad' });
    await b.connect({ qr: (await e.call('link.qr', {})).url });
    assert.equal((await e.call('link.devices')).length, 1);
    // Without the code: delete the secrets and start from scratch (backups untouched).
    const backups = (await e.call('backup.list')).length;
    await assert.rejects(e.call('master.reset', { password: 'empezar de cero ya' }), /Confirma/);
    const z = await e.call('master.reset', { password: 'empezar de cero ya', confirm: true });
    assert.equal(z.unlinked, 1);
    assert.deepEqual((await e.call('secrets.connector', { name: 'github', unlock: z.unlock })).env, { GITHUB_TOKEN: '' }, 'las claves de los conectores se borran');
    assert.equal((await e.call('backup.list')).length, backups, 'las copias no se tocan');
    assert.equal((await e.call('master.state')).exists, true);
    await e.call('master.unlock', { password: 'empezar de cero ya' });
    assert.match(notices(t.home), /Secretos borrados y contraseña maestra nueva/);
  } finally { for (const l of links) l.stop(); await e.stop(); t.cleanup(); }
});

test('los móviles enlazados antes de 3.8 se desenlazan una vez al arrancar, con aviso', async () => {
  const t = tempHome();
  { const { Board } = await import('../src/core/board.mjs'); const b = new Board();
    const add = (id, meta) => b.run('INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, route, kind, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, `Móvil ${id}`, `clave:${id}`, new Date().toISOString(), new Date().toISOString(), C.b64.enc(C.newKeyPair().pub), 'wifi', 'phone', meta);
    add('11111111-1111-1111-1111-111111111111', JSON.stringify({ v: 3 })); add('22222222-2222-2222-2222-222222222222', null);
    b.db.close(); }
  let e = await startEngine(t.home);
  try {
    assert.equal((await e.call('link.devices')).length, 0);
    assert.match(notices(t.home), /ha desenlazado 2 dispositivos.*Vuelve a enlazar tu móvil con Magic Link/);
  } finally { await e.stop(); }
  e = await startEngine(t.home);
  try { assert.equal((notices(t.home).match(/ha desenlazado/g) ?? []).length, 1, 'solo la primera vez'); } finally { await e.stop(); }
  t.cleanup();
});

test('la guardia de los agentes cubre la copia de los secretos fuera de core, también nombrada con variables de entorno', () => {
  const was = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA };
  const fakeRoaming = path.join(os.tmpdir(), 'orb-guardia', 'Roaming'); const fakeLocal = path.join(os.tmpdir(), 'orb-guardia', 'Local');
  process.env.APPDATA = fakeRoaming; process.env.LOCALAPPDATA = fakeLocal;
  const internal = path.join(os.tmpdir(), 'orb-guardia', 'Orb', 'core');
  const keys = path.join(fakeRoaming, 'Orb.dev', 'claves');
  const state = path.join(fakeRoaming, 'Orb.dev', 'Local State');
  setGuardedRoots([path.join(fakeLocal, 'Orb', 'copias'), keys, state]);
  const run = (command) => decide({ permission: 'editar', tool: 'Bash', command, paths: [], patterns: [], internalDir: internal, cwd: os.tmpdir() }).decision;
  try {
    for (const c of [
      `type "${path.join(keys, 'orb-1234abcd-secretos', 'maestra.json')}"`,
      'Get-Content $env:APPDATA\\Orb.dev\\claves\\orb-1234abcd-secretos\\maestra.json',
      'type %APPDATA%\\Orb.dev\\claves\\orb-1234abcd-secretos\\secretos.json',
      'cat ${env:APPDATA}/Orb.dev/claves/orb-1234abcd.enc',
      'copy "%APPDATA%\\Orb.dev\\Local State" x.json',
      'Remove-Item -Recurse $env:LOCALAPPDATA\\Orb\\copias'
    ]) assert.equal(run(c), 'deny', c);
    assert.equal(run('Get-Content $env:APPDATA\\Code\\settings.json'), 'allow', 'el resto de AppData sigue abierto');
  } finally {
    setGuardedRoots([]);
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('el verificador del móvil vive en el almacén, no en maestra.json', async () => {
  const dir = tmp();
  const m = new Master(dir, { secret: secretA }); m.openWithMachine();
  await m.create(PASS);
  const v = m.get(PAIR_ID);
  assert.ok(C.pairKdfOk(v.kdf) && typeof v.pub === 'string');
  assert.equal(C.b64.enc((await C.verifierOf(PASS, v.kdf)).pub), v.pub, 'el móvil deriva la misma clave que el PC espera');
  assert.ok(!fs.readFileSync(path.join(dir, FILES.master), 'utf8').includes(v.pub));
  fs.rmSync(dir, { recursive: true, force: true });
});
