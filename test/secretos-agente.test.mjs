// 3.8.2 (fase 10, T3 3.4): an agent asks for a secret on a private card. The value is typed only on this PC, goes to one
// command of that agent through a one-time handle on the agents' pipe (agent-auth.mjs, grant `once`) and Orb's helper
// (src/mcp/secret-run.mjs), and never reaches the chat, the log, a phone or a second use; Orb locking wipes it all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { Master, FREE_TRIES } from '../src/domain/security/master.mjs';
import { AgentAuth } from '../src/domain/security/agent-auth.mjs';
import { createSecretRequests, savedId, MASTER_CHECKS, MASTER_CHECKS_MS } from '../src/engine/agent-secrets.mjs';
import { parseArgs, trade, masker } from '../src/mcp/secret-run.mjs';
import { allowed, needsUnlock, freshPurpose, principalOf, METHODS } from '../src/domain/security/permissions.mjs';
import { tempHome, startEngine } from './helpers.mjs';
import { FRESH_ACTIONS } from '../src/ui/lib/core-access.js';

const HELPER = fileURLToPath(new URL('../src/mcp/secret-run.mjs', import.meta.url));
const VALUE = 'ghp_SecretoDePrueba123';
const MASTER = 'contraseña-maestra-de-prueba';
// The helper runs as its own process (async: the agents' pipe lives in this test's process).
const helper = (args) => new Promise((resolve) => { execFile(process.execPath, [HELPER, ...args], { encoding: 'utf8', timeout: 20_000 }, (error, stdout, stderr) => resolve({ status: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr })); });

function setup({ askMs, handleMs, now } = {}) {
  const auth = new AgentAuth();
  const items = []; const lines = []; const events = [];
  const vault = new Map(); let unlocked = true;
  const master = { unlocked: () => unlocked, get: (id) => { if (!unlocked) throw new Error('locked'); return vault.get(id) ?? null; }, set: (id, v) => { if (!unlocked) throw new Error('locked'); vault.set(id, v); }, isPassword: async (v) => v === MASTER };
  const sessions = { addItem: (...a) => items.push(a) };
  const secrets = createSecretRequests({ sessions, auth, master: () => master, emit: (e, p) => events.push([e, p]), log: (l) => lines.push(l), askMs, handleMs, now });
  return { auth, secrets, items, lines, events, vault, lock: () => { unlocked = false; } };
}
const chat = { id: 's1', kind: 'chat', agent: 'claude' };

test('secretos: tarjeta privada, identificador de un solo uso y nada en el chat ni en el registro', async () => {
  const { secrets, items, lines, events, vault } = setup();
  await assert.rejects(async () => secrets.request(chat, { name: 'a b', reason: 'x' }), /Nombre no válido/);
  await assert.rejects(async () => secrets.request(chat, { name: 'TOKEN', reason: '' }), /para qué/);
  await assert.rejects(async () => secrets.request(null, { name: 'TOKEN', reason: 'x' }), /chat/);
  const asked = secrets.request(chat, { name: 'GITHUB_TOKEN', reason: 'Para publicar la release' });
  const [card] = secrets.pending();
  assert.deepEqual({ ...card, id: undefined }, { id: undefined, session: 's1', agent: 'claude', name: 'GITHUB_TOKEN', reason: 'Para publicar la release', saved: false });
  assert.equal(events[0][0], 'secret:request');
  // Typed on the card (and saved in the vault, which the window does only after the master password).
  await assert.rejects(secrets.answer({ id: card.id, value: '' }), /Escribe la clave/);
  // Orb never asks for its master password here: the card refuses it (checked in the vault, nothing kept).
  await assert.rejects(secrets.answer({ id: card.id, value: MASTER, save: true }), /contraseña maestra/);
  assert.equal(vault.get(savedId('GITHUB_TOKEN')), undefined);
  assert.equal(secrets.pending().length, 1, 'la petición sigue esperando');
  assert.equal(await secrets.answer({ id: card.id, value: VALUE, save: true }), true);
  assert.equal(vault.get(savedId('GITHUB_TOKEN')), VALUE);
  const r = await asked;
  assert.equal(r.name, 'GITHUB_TOKEN'); assert.match(r.handle, /^orbsec1\.[0-9a-f]{24}\.[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(r).includes(VALUE), 'el agente recibe un identificador, nunca el valor');
  assert.ok(!JSON.stringify([items, lines, events]).includes(VALUE), 'ni en el chat, ni en el registro, ni en los eventos');
  await assert.rejects(secrets.answer({ id: card.id, value: VALUE }), /ya no está activa/, 'una petición se responde una vez');
  // The helper: the value goes to the command's own variable and is hidden in its output; the handle works once.
  const run = await helper([r.handle, '--env', 'GITHUB_TOKEN', '--', process.execPath, '-e', 'console.log("v=" + process.env.GITHUB_TOKEN + " largo=" + process.env.GITHUB_TOKEN.length)']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /v=\[secreto\] largo=22/);
  assert.ok(!run.stdout.includes(VALUE));
  const again = await helper([r.handle, '--env', 'GITHUB_TOKEN', '--', process.execPath, '-e', '0']);
  assert.equal(again.status, 2); assert.match(again.stderr, /no vale/);
  // The saved one: offered on the next card, and only when it exists.
  const second = secrets.request(chat, { name: 'GITHUB_TOKEN', reason: 'otra vez' });
  const [card2] = secrets.pending();
  assert.equal(card2.saved, true);
  await secrets.answer({ id: card2.id, saved: true });
  const r2 = await second;
  const viaStdin = await helper([r2.handle, '--stdin', '--', process.execPath, '-e', 'process.stdin.on("data", (d) => process.stdout.write("leído " + d))']);
  assert.equal(viaStdin.status, 0, viaStdin.stderr);
  assert.match(viaStdin.stdout, /leído \[secreto\]/);
  const third = secrets.request(chat, { name: 'OTRA', reason: 'x' });
  await assert.rejects(secrets.answer({ id: secrets.pending()[0].id, saved: true }), /ninguna clave guardada/);
  secrets.decline({ id: secrets.pending()[0].id });
  assert.match(await third, /rechazado/);
});

test('secretos: sin respuesta, demasiadas y al bloquear Orb no queda nada que canjear', async (t) => {
  // The card's timers are unref'd (in Orb the engine's server keeps the process alive): here nothing else would, and
  // the test runner would end while the first request still waits for its timeout.
  const alive = setInterval(() => {}, 1_000); t.after(() => clearInterval(alive));
  const { secrets } = setup({ askMs: 50 });
  assert.match(await secrets.request(chat, { name: 'TOKEN', reason: 'x' }), /no ha respondido/);
  const s = setup();
  const waiting = [1, 2, 3].map(() => s.secrets.request(chat, { name: 'TOKEN', reason: 'x' }));
  await assert.rejects(async () => s.secrets.request(chat, { name: 'TOKEN', reason: 'x' }), /varias claves/);
  // One answered (its handle given, not used yet), the rest waiting: Orb locks.
  await s.secrets.answer({ id: s.secrets.pending()[0].id, value: VALUE });
  const given = await waiting[0];
  s.secrets.wipe();
  for (const w of waiting.slice(1)) assert.match(await w, /bloqueado/);
  assert.deepEqual(s.secrets.pending(), []);
  assert.equal(await trade(given.handle), null, 'el identificador ya no vale tras el bloqueo');
  // An expired handle neither.
  const e = setup({ handleMs: 30 });
  const late = e.secrets.request(chat, { name: 'TOKEN', reason: 'x' });
  await e.secrets.answer({ id: e.secrets.pending()[0].id, value: VALUE });
  const h = await late;
  await new Promise((ok) => setTimeout(ok, 120));
  assert.equal(await trade(h.handle), null, 'caducado');
  // A handle of another agent process goes when that process closes.
  const p = setup();
  const own = p.secrets.request(chat, { name: 'TOKEN', reason: 'x' });
  await p.secrets.answer({ id: p.secrets.pending()[0].id, value: VALUE });
  const ph = await own;
  p.auth.revokeSession('s1');
  assert.equal(await trade(ph.handle), null);
});

test('secretos: solo desde este PC, guardar o usar la guardada pide la contraseña, y el ayudante no acepta otra forma', () => {
  const phone = principalOf({ device: { id: 1, kind: 'phone' } });
  const browser = principalOf({ device: { id: 2, kind: 'browser' } });
  for (const m of ['secrets.pending', 'secrets.answer', 'secrets.decline']) {
    assert.equal(METHODS[m], 'pc');
    assert.ok(!allowed(phone, m) && !allowed(browser, m), `${m}: nunca desde un dispositivo enlazado`);
  }
  assert.ok(needsUnlock('secrets.answer', { save: true }));
  assert.ok(needsUnlock('secrets.answer', { saved: true }));
  assert.ok(!needsUnlock('secrets.answer', { value: 'x' }));
  const h = `orbsec1.${'a'.repeat(24)}.${'b'.repeat(64)}`;
  assert.deepEqual(parseArgs([h, '--env', 'TOKEN', '--', 'gh', 'auth']), { handle: h, env: 'TOKEN', stdin: false, command: 'gh', args: ['auth'] });
  assert.equal(parseArgs([h, '--stdin', '--', 'docker', 'login']).stdin, true);
  for (const bad of [[h, '--env', 'TOKEN'], [h, '--env', 'a b', '--', 'x'], ['otro', '--stdin', '--', 'x'], [h, '--print', '--', 'x'], [h, '--env', 'T', '--stdin', '--', 'x']]) assert.equal(parseArgs(bad), null, JSON.stringify(bad));
  // Hidden even when split between two chunks.
  let out = ''; const m = masker('abcdef', (s) => { out += s; });
  m.push('xxabc'); m.push('defyy abcdef'); m.end();
  assert.equal(out, 'xx[secreto]yy [secreto]');
  assert.ok(path.isAbsolute(HELPER));
});

// 3.8.2 (security review, decision a): saving the secret in the vault or using the saved one asks for the master
// password EVERY time: the window's 5-minute token does not open it, and the token for it opens it once.
test('secretos: guardar o usar la guardada pide la contraseña cada vez (token de un solo uso)', async () => {
  assert.equal(freshPurpose('secrets.answer', { save: true }), 'secretSave');
  assert.equal(freshPurpose('secrets.answer', { saved: true }), 'secretSaved');
  assert.equal(freshPurpose('secrets.answer', { value: 'x' }), null);
  assert.ok(FRESH_ACTIONS.includes('secretSave') && FRESH_ACTIONS.includes('secretSaved'), 'la ventana no reutiliza su desbloqueo');
  const t = tempHome();
  const e = await startEngine(t.home);
  const PASS = 'una frase larga de prueba';
  try {
    const { unlock } = await e.call('master.create', { password: PASS });
    await assert.rejects(e.call('secrets.answer', { id: 1, value: 'x', save: true, unlock }), /contraseña maestra/, 'el token de 5 min no vale');
    await assert.rejects(e.call('secrets.answer', { id: 1, saved: true, unlock }), /contraseña maestra/);
    const other = (await e.call('master.unlock', { password: PASS, purpose: 'secretSave' })).unlock;
    await assert.rejects(e.call('secrets.answer', { id: 1, saved: true, unlock: other }), /contraseña maestra/, 'el de guardar no sirve para usar');
    const fresh = (await e.call('master.unlock', { password: PASS, purpose: 'secretSaved' })).unlock;
    await assert.rejects(e.call('secrets.answer', { id: 1, saved: true, unlock: fresh }), /ya no está activa/, 'pasa la contraseña (no hay petición)');
    await assert.rejects(e.call('secrets.answer', { id: 1, saved: true, unlock: fresh }), /contraseña maestra/, 'un token, una vez');
  } finally { await e.stop(); t.cleanup(); }
});

// 3.8.2 (phase 10b): the card refuses the master password. The vault checks it without counting a wrong try (a secret
// that is not the password must not bring the unlock's waits) and only while its data key is open.
test('secretos: la bóveda dice si un valor es la contraseña maestra sin contar intentos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-secreto-'));
  try {
    const PASS = 'una frase larga de prueba';
    const m = new Master(dir, { secret: crypto.randomBytes(32) });
    m.openWithMachine();
    assert.equal(await m.isPassword(PASS), false, 'sin contraseña creada');
    await m.create(PASS);
    for (let i = 0; i < FREE_TRIES + 2; i++) assert.equal(await m.isPassword(`otro-valor-${i}`), false);
    assert.equal(await m.isPassword(PASS), true);
    assert.equal((await m.verify(PASS)).ok, true, 'ningún intento contado: la contraseña sigue entrando sin esperas');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 3.8.2 (final review): the master-password check counts no try, so typed values are checked a few at a time at most:
// a script answering cards in a loop cannot use the card to guess the master password.
test('secretos: la comprobación de la contraseña maestra en la tarjeta tiene un límite de ritmo', async () => {
  let t = 1_000_000;
  const { secrets } = setup({ now: () => t });
  for (let i = 0; i < MASTER_CHECKS; i++) {
    const asked = secrets.request(chat, { name: 'TOKEN', reason: 'prueba' });
    const [card] = secrets.pending();
    assert.equal(await secrets.answer({ id: card.id, value: `intento-${i}` }), true);
    await asked;
  }
  const asked = secrets.request(chat, { name: 'TOKEN', reason: 'prueba' });
  const [card] = secrets.pending();
  await assert.rejects(secrets.answer({ id: card.id, value: MASTER }), /Espera unos minutos/, 'sin decir si era la contraseña');
  await assert.rejects(secrets.answer({ id: card.id, value: 'otro' }), /Espera unos minutos/);
  assert.equal(secrets.pending().length, 1, 'la petición sigue esperando');
  t += MASTER_CHECKS_MS;
  await assert.rejects(secrets.answer({ id: card.id, value: MASTER }), /contraseña maestra/);
  assert.equal(await secrets.answer({ id: card.id, value: 'ya-vale' }), true);
  await asked;
});
