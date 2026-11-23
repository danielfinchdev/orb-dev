// 3.8.10, step 7 A2: a linked phone approves sensitive actions with its fingerprint, end to end through the encrypted link.
// The phone here is the tests' phone client (fixtures/phone-client.mjs) with a P-256 key that signs where the app's Keystore key would,
// the vault is the real orb-vault (fake Hello only for the rebuild test) and every check is the vault's own.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempHome, startEngine, until } from './helpers.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';
import { parsePayload, summaryHash, approveSummary, buildPayload } from '../src/domain/security/approve.mjs';
import { SECRET_METHODS, mobileMayApprove } from '../src/domain/security/permissions.mjs';

const PASS = TEST_MASTER;
const GITHUB = { name: 'github', command: 'npx', args: [], env: { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' } };
const OTHER = { name: 'otro', command: 'npx', args: [], env: { OTRO_TOKEN: 'otra_clave_de_prueba' } };
const said = async (p) => { try { await p; return ''; } catch (error) { return String(error.message); } };
const GUARD = /necesita tu contraseña maestra|needs your master password|Windows Hello no basta|Windows Hello is not enough/;

// What the app does with an `approve` event: read the payload, check the summary hashes to it, sign it. `key` is the phone's P-256 key.
const publicOf = (key) => { const jwk = key.export({ format: 'jwk' }); return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]); };
function answer(event, key, { deviceId } = {}) {
  const bytes = Buffer.from(event.payload, 'base64');
  const p = parsePayload(bytes);
  assert.ok(p, 'a payload the phone can read');
  assert.equal(p.hash, summaryHash(event.summary), 'the summary the phone shows is the one that was hashed');
  assert.ok(p.expires > Date.now());
  if (deviceId) assert.equal(p.deviceId, deviceId);
  return { p, sig: crypto.sign('sha256', bytes, key).toString('base64') };
}
const nextEvent = (phone) => new Promise((resolve) => { const off = phone.on('approve', (e) => { off(); resolve(e); }); });

async function withPhone(fn, { env = {}, config = { mcpServers: [GITHUB, OTHER] } } = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { enabled: true, port, name: 'Casa' }, ...config });
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex'), env: { ORB_REMOTE_BIND: '127.0.0.1', ...env } });
  const phones = [];
  const link = async (opts = {}) => { const ph = createPhone({ name: 'Pixel de Dani', ...opts }); phones.push(ph); const id = (await ph.connect({ qr: (await e.call('link.qr', { device: opts.kind ?? 'phone' })).url })).id; return { ph, id }; };
  try {
    await until(async () => (await e.call('remote.status')).running, 'acceso');
    await e.call('master.create', { password: PASS });
    await fn({ e, t, link, phones });
  } finally { for (const p of phones) p.stop(); await e.stop(); t.cleanup(); }
}
// Registers `id`'s phone with a key of its own; → the key.
async function register(e, ph, id) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ev = nextEvent(ph);
  const req = await e.call('approve.register', { id, password: PASS });
  const event = await ev;
  assert.equal(event.kind, 'enroll');
  const { p, sig } = answer(event, privateKey, { deviceId: id });
  assert.equal(p.action, 'approve.enroll');
  assert.deepEqual(await ph.call(id, 'approve.enroll', { nonce: event.nonce, pub: publicOf(publicKey).toString('base64'), sig }), { ok: true, orbId: p.orbId });
  assert.equal((await e.call('approve.poll', { id: req.id })).state, 'done');
  return privateKey;
}
// Asks the phone to approve `method` with `params`; → { event, token request id }.
async function ask(e, ph, method, params) {
  const ev = nextEvent(ph);
  const req = await e.call('approve.request', { method, params });
  return { req, event: await ev };
}

test('the table: what a phone may approve is the password-only calls, never a new key, with a purpose tied to the parameters', () => {
  for (const m of SECRET_METHODS) assert.ok(mobileMayApprove(m, {}, {}), m);
  assert.equal(mobileMayApprove('backup.newKey', {}, {}), false);
  assert.equal(mobileMayApprove('master.check', {}, {}), false, 'what Hello opens is not for the phone');
  assert.equal(mobileMayApprove('projects.deleteCheck', {}, {}), false);
  assert.equal(mobileMayApprove('secrets.answer', { saved: true }, {}), true);
  const key = Buffer.alloc(32, 1);
  const a = approveSummary({ name: 'github', unlock: 'tok' }, key);
  assert.equal(a, '{"name":"github"}', 'the unlock token is never part of it');
  assert.match(approveSummary({ name: 'x', nested: { unlock: 'visible' } }, key), /visible/, 'only the first level loses unlock');
  for (const field of ['env', 'passphrase', 'apiKey', 'Authorization', 'client_secret', 'accessToken', 'password']) assert.equal(approveSummary({ [field]: 'secreto' }, key).includes('secreto'), false, field);
  assert.notEqual(approveSummary({ env: { K: 'uno' } }, key), approveSummary({ env: { K: 'dos' } }, key), 'but another key is another summary');
  assert.notEqual(approveSummary({ env: 'uno' }, key), approveSummary({ env: 'uno' }, Buffer.alloc(32, 2)), 'and the hash depends on this PC\'s key: no guessing from what the phone gets');
  const payload = buildPayload({ action: 'secrets.connector', hash: summaryHash(a), nonce: Buffer.alloc(32, 1), orbId: 'orb-1', deviceId: 'dev-1', pcPub: Buffer.alloc(32, 2), expires: 1_800_000_000_000 });
  assert.deepEqual(parsePayload(payload).nonce, Buffer.alloc(32, 1));
  assert.equal(parsePayload(payload.subarray(0, payload.length - 1)), null);
});

test('a phone is registered only with the password typed on the PC, and then approves one action with its fingerprint', async () => {
  await withPhone(async ({ e, link }) => {
    const { ph, id } = await link();
    assert.deepEqual((await e.call('approve.devices')).phones.map((p) => [p.id, p.registered]), [[id, false]]);
    // no proof, a wrong one, the phone itself, a browser: no challenge is sent
    let sent = 0; ph.on('approve', () => { sent += 1; });
    await assert.rejects(e.call('approve.register', { id }));
    await assert.rejects(e.call('approve.register', { id, password: 'otra contraseña larga' }));
    await assert.rejects(ph.call(id, 'approve.register', { id, password: PASS }), (x) => x.status === 403);
    const web = await link({ kind: 'browser' });
    assert.match(await said(e.call('approve.register', { id: web.id, password: PASS })), /móvil enlazado con la app|phone linked with the Orb app/);
    assert.equal(sent, 0);
    // nobody has registered: no approval can be asked for
    assert.match(await said(e.call('approve.request', { method: 'secrets.connector', params: { name: 'github' } })), /Ningún móvil|No linked phone/);

    const key = await register(e, ph, id);
    assert.deepEqual((await e.call('approve.devices')).phones.filter((p) => p.id === id).map((p) => p.registered), [true]);

    // asking for something a phone may not approve
    assert.match(await said(e.call('approve.request', { method: 'backup.newKey', params: {} })), /no se puede aprobar|cannot be approved/);
    assert.match(await said(e.call('approve.request', { method: 'master.check', params: {} })), /no se puede aprobar|cannot be approved/);

    // the approval: the phone shows the action and the parameters it was asked for, signs, and the PC gets a one-use token for exactly that
    const params = { name: 'github' };
    const { req, event } = await ask(e, ph, 'secrets.connector', params);
    assert.equal((await e.call('approve.poll', { id: req.id })).state, 'waiting');
    const { p, sig } = answer(event, key, { deviceId: id });
    assert.equal(p.action, 'secrets.connector');
    assert.equal(event.summary, '{"name":"github"}');
    const reply = await ph.call(id, 'approve.respond', { nonce: event.nonce, sig });
    assert.deepEqual(reply, { ok: true }, 'the phone is never handed the token');
    const got = await e.call('approve.poll', { id: req.id });
    assert.equal(got.state, 'done'); assert.equal(got.strength, 'mobile');
    assert.equal((await e.call('approve.poll', { id: req.id })).state, 'gone', 'the token is handed over once');
    // other parameters, or another action, find it useless (and it is spent by the wrong try? no: only a right use spends it)
    assert.match(await said(e.call('secrets.connector', { name: 'otro', unlock: got.unlock })), GUARD, 'other parameters');
    assert.match(await said(e.call('secrets.saveConnector', { name: 'github', env: {}, unlock: got.unlock })), GUARD, 'another action');
    assert.match(await said(e.call('master.check', { unlock: got.unlock })), GUARD, 'not an action the phone approves');
    const shown = await e.call('secrets.connector', { name: 'github', unlock: got.unlock });
    assert.deepEqual(shown.env, { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' });
    assert.match(await said(e.call('secrets.connector', { name: 'github', unlock: got.unlock })), GUARD, 'one use');
    // the window's token, for what it is not good for
    assert.match(await said(e.call('secrets.connector', { name: 'github', unlock: 'nope' })), GUARD);

    // a signature of the other key, or an answer after it was spent, approves nothing
    const stranger = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    const two = await ask(e, ph, 'secrets.connector', params);
    const bad = answer(two.event, stranger);
    assert.deepEqual(await ph.call(id, 'approve.respond', { nonce: two.event.nonce, sig: bad.sig }), { ok: false, reason: 'bad' });
    assert.equal((await e.call('approve.poll', { id: two.req.id })).state, 'refused');
    assert.deepEqual(await ph.call(id, 'approve.respond', { nonce: two.event.nonce, sig: answer(two.event, key).sig }), { ok: false, reason: 'nonce' }, 'spent by the wrong answer');
  });
});

test('unlinking a phone deletes its registration, and linking it again does not bring it back', async () => {
  await withPhone(async ({ e, link }) => {
    const { ph, id } = await link();
    const key = await register(e, ph, id);
    const win = await e.call('master.unlock', { password: PASS });
    assert.match(await said(e.call('approve.unregister', { id })), GUARD, 'removing it asks for the unlock too');
    // an approval it already gave, not yet picked up, dies with the unlinking
    const made = await ask(e, ph, 'secrets.connector', { name: 'github' });
    await ph.call(id, 'approve.respond', { nonce: made.event.nonce, sig: answer(made.event, key).sig });
    await e.call('link.revoke', { id, unlock: win.unlock });
    assert.equal((await e.call('approve.poll', { id: made.req.id })).state, 'gone');
    const again = await link();
    assert.notEqual(again.id, id);
    assert.deepEqual((await e.call('approve.devices')).phones.map((p) => p.registered), [false]);
    assert.match(await said(e.call('approve.request', { method: 'secrets.connector', params: { name: 'github' } })), /Ningún móvil|No linked phone/);
    // registered again and removed from the PC
    await register(e, again.ph, again.id);
    await e.call('approve.unregister', { id: again.id, unlock: win.unlock });
    assert.deepEqual((await e.call('approve.devices')).phones.map((p) => p.registered), [false]);
  });
});

test('«Lo he olvidado todo»: Hello, then the registered phone, then a new password and code; without that phone nothing is made', async () => {
  await withPhone(async ({ e, link }) => {
    const { ph, id } = await link();
    await e.call('master.helloEnable', { password: PASS });
    // Hello's rebuild token with no phone registered: nothing is made
    const h0 = await e.call('master.unlockHello', { purpose: 'rebuild-master' });
    assert.match(await said(e.call('master.rebuildStart', { unlock: h0.unlock })), /Ningún móvil|No linked phone/);
    assert.match(await said(e.call('master.rebuildFinish', { id: 'nada', password: 'una contraseña nueva' })), /Falta la aprobación|has not approved/);
    assert.ok((await e.call('master.unlock', { password: PASS })).unlock, 'the password is as it was');
    // the rebuild token opens nothing else
    assert.match(await said(e.call('master.check', { unlock: h0.unlock })), GUARD);
    assert.match(await said(e.call('approve.request', { method: 'secrets.connector', params: { name: 'github' } })), /Ningún móvil|No linked phone/);

    const key = await register(e, ph, id);
    const h = await e.call('master.unlockHello', { purpose: 'rebuild-master' });
    const ev = nextEvent(ph);
    const req = await e.call('master.rebuildStart', { unlock: h.unlock });
    const event = await ev;
    assert.equal(event.kind, 'rebuild');
    assert.equal(answer(event, key).p.action, 'master.rebuild');
    assert.equal((await e.call('master.rebuildPoll', { id: req.id })).state, 'waiting');
    assert.match(await said(e.call('master.rebuildFinish', { id: req.id, password: 'una contraseña nueva' })), /Falta la aprobación|has not approved/, 'not before the phone says yes');
    assert.deepEqual(await ph.call(id, 'approve.respond', { nonce: event.nonce, sig: answer(event, key).sig }), { ok: true });
    assert.equal((await e.call('master.rebuildPoll', { id: req.id })).state, 'done');
    const done = await e.call('master.rebuildFinish', { id: req.id, password: 'una contraseña nueva' });
    assert.match(done.code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
    assert.ok(done.unlock);
    assert.match(await said(e.call('master.rebuildFinish', { id: req.id, password: 'otra contraseña nueva' })), /Falta la aprobación|has not approved/, 'one use');
    assert.match(await said(e.call('master.unlock', { password: PASS })), /incorrecta|wrong|Te quedan|left/i, 'the old password is gone');
    assert.ok((await e.call('master.unlock', { password: 'una contraseña nueva' })).unlock);
    assert.equal((await e.call('link.devices')).length, 1, 'the phones stay linked');
    assert.equal((await e.call('master.state')).hasCode, true, 'a new generated code wraps the data key');
  }, { env: { ORB_VAULT_FAKE_HELLO: 'ok' } });
});
