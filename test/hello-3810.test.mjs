// 3.8.10, step 7 H4: Windows Hello in the engine and the permissions. A Hello token (proof of presence) opens the usual guarded
// actions but never what shows, saves or gives a secret; turning it on takes the password; nothing of the proof is kept or
// answered. The vault is the real orb-vault with the tests' fake Hello (ORB_VAULT_FAKE_HELLO, only under node --test).
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine } from './helpers.mjs';
import { UNLOCK_METHODS, SECRET_METHODS, PASSWORD_ONLY_METHODS, FRESH_UNLOCK, HELLO_PURPOSES, SECRET_PURPOSES, needsPassword, needsUnlock } from '../src/domain/security/permissions.mjs';

const PASS = 'una contraseña larga de prueba';
const GITHUB = { name: 'github', command: 'npx', args: [], env: { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' } };
const NEEDS_PASSWORD = /Windows Hello no basta|Windows Hello is not enough/;
const GUARD = /necesita tu contraseña maestra|needs your master password/;
const GUARDS = new RegExp(`${NEEDS_PASSWORD.source}|${GUARD.source}`);
const scan = (dir) => {
  let out = '';
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { try { out += `${fs.readFileSync(f, 'latin1')}\n`; } catch { /* locked */ } } } };
  try { walk(dir); } catch { /* none */ }
  return out;
};
const fails = async (p) => { try { await p; } catch (error) { return error; } return assert.fail('it should have been refused'); };
// The error a call ends in, or '' when it went through.
const said = async (p) => { try { await p; return ''; } catch (error) { return String(error.message); } };

async function withEngine(mode, fn, config = { mcpServers: [GITHUB] }) {
  const t = tempHome(config);
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex'), env: { ORB_VAULT_FAKE_HELLO: mode } });
  try { await fn(e, t); } finally { await e.stop(); }
}

test('the secrets are a fixed list and every other unlocked action takes Hello', () => {
  assert.deepEqual([...SECRET_METHODS].sort(), ['agentKeys.save', 'backup.restore', 'mcpExt.createToken', 'secrets.connector', 'secrets.saveConnector', 'sessions.grantTotal']);
  for (const m of SECRET_METHODS) assert.ok(UNLOCK_METHODS.has(m) && needsPassword(m, {}, {}), m);
  assert.ok(needsPassword('backup.newKey', {}, {}), 'a new key is never Hello’s');
  for (const m of UNLOCK_METHODS) if (!PASSWORD_ONLY_METHODS.has(m)) assert.equal(needsPassword(m, {}, {}), false, m);
  assert.equal(needsPassword('secrets.answer', { save: true }, {}), true);
  assert.equal(needsPassword('secrets.answer', { saved: true }, {}), true);
  assert.equal(needsPassword('secrets.answer', {}, {}), false);
  assert.equal(needsPassword('config.save', { patch: { rails: { maxTurns: 3 } } }, {}), false, 'the limits take Hello');
  assert.equal(needsPassword('config.save', { patch: { backup: { folder: 'x' } } }, {}), false);
  // keys in clear, or a connector that has keys changed or losing one
  const has = { mcpServers: [{ name: 'github', command: 'npx', args: [], env: { GITHUB_TOKEN: 'orb-secret:mcp/github/GITHUB_TOKEN' } }] };
  assert.equal(needsPassword('config.save', { patch: { mcpServers: [{ name: 'x', command: 'y', env: { K: 'clear' } }] } }, {}), true);
  for (const patch of [{ mcpServers: [{ ...has.mcpServers[0], command: 'other' }] }, { mcpServers: [] }]) {
    assert.equal(needsUnlock('config.save', { patch }, has), true);
    assert.equal(needsPassword('config.save', { patch }, has), true, JSON.stringify(patch));
  }
  // Hello never makes the purposes of the secrets nor the new key's
  for (const p of [...Object.values(SECRET_PURPOSES), FRESH_UNLOCK['backup.newKey']]) assert.ok(!HELLO_PURPOSES.includes(p), p);
  for (const p of ['deleteProject', 'rails', 'ruleSeed']) assert.ok(HELLO_PURPOSES.includes(p), p);
});

test('turning Hello on takes the password; a token from Hello opens the usual actions and no secret', async () => {
  await withEngine('ok', async (e) => {
    assert.deepEqual(await e.call('master.helloState'), { available: true, enabled: false });
    await e.call('master.create', { password: PASS });
    // no proof, or a wrong one: nothing is made
    await fails(e.call('master.helloEnable', {}));
    await fails(e.call('master.helloEnable', { password: 'otra contraseña larga' }));
    assert.equal((await e.call('master.helloState')).enabled, false);
    assert.match((await fails(e.call('master.unlockHello', {}))).message, /Windows Hello no está activado|Windows Hello is not turned on/);
    const win = await e.call('master.unlock', { password: PASS });
    assert.equal((await e.call('master.helloEnable', { password: PASS })).ok, true);
    const st = await e.call('master.helloState');
    assert.equal(st.enabled, true); assert.equal(st.valid, true); assert.equal(st.pub, undefined);

    const h = await e.call('master.unlockHello', {});
    assert.equal(h.strength, 'hello');
    assert.deepEqual(Object.keys(h).sort(), ['ok', 'strength', 'unlock', 'until']);
    // every secret method refuses it, with the words that ask for the password
    for (const m of SECRET_METHODS) assert.match(await said(e.call(m, { unlock: h.unlock })), NEEDS_PASSWORD, m);
    assert.match(await said(e.call('secrets.answer', { id: 1, save: true, unlock: h.unlock })), NEEDS_PASSWORD);
    assert.match(await said(e.call('secrets.answer', { id: 1, saved: true, unlock: h.unlock })), NEEDS_PASSWORD);
    assert.match(await said(e.call('backup.newKey', { unlock: h.unlock })), NEEDS_PASSWORD);
    assert.match(await said(e.call('config.save', { patch: { mcpServers: [{ name: 'otro', command: 'x', args: [], env: { K: 'en claro' } }] }, unlock: h.unlock })), NEEDS_PASSWORD, 'keys in clear');
    assert.match(await said(e.call('config.save', { patch: { mcpServers: [{ ...GITHUB, command: 'cambiado' }] }, unlock: h.unlock })), NEEDS_PASSWORD, 'a connector that has keys');
    // the password's token passes the guard on the same calls (they fail later, for their parameters)
    for (const m of SECRET_METHODS) assert.doesNotMatch(await said(e.call(m, { unlock: win.unlock })), GUARDS, m);
    // and the rest takes Hello
    assert.equal(await e.call('master.check', { unlock: h.unlock }), true);
    const del = await e.call('master.unlockHello', { purpose: 'deleteProject' });
    assert.doesNotMatch(await said(e.call('projects.deleteCheck', { name: 'nada', unlock: del.unlock })), GUARDS);
    assert.match(await said(e.call('projects.deleteCheck', { name: 'nada', unlock: del.unlock })), GUARD, 'a one-use token is spent');
    assert.doesNotMatch(await said(e.call('rails.set', { rails: {}, unlock: (await e.call('master.unlockHello', { purpose: 'rails' })).unlock })), GUARDS);
    // the purposes of the secrets and of a new key are the password's
    for (const p of ['secretSave', 'secretSaved', 'newKey', 'rebuild-master', 'hello.enable', 'nonsense']) assert.match((await fails(e.call('master.unlockHello', { purpose: p }))).message, NEEDS_PASSWORD, p);
    // switching it off: any token of the window is the proof
    assert.equal((await e.call('master.helloDisable', { unlock: h.unlock })).ok, true);
    assert.equal((await e.call('master.helloState')).enabled, false);
    await fails(e.call('master.helloDisable', { unlock: 'nope' }));
  });
});

test('a Hello that cannot sign or was cancelled gives no token; three failures make it wait; nothing of the proof is kept', async () => {
  await withEngine('wrong-message', async (e, t) => {
    await e.call('master.create', { password: PASS });
    await e.call('master.helloEnable', { password: PASS });
    for (let i = 0; i < 3; i += 1) assert.match((await fails(e.call('master.unlockHello', {}))).message, /Windows Hello ha cambiado|Windows Hello has changed/);
    assert.match((await fails(e.call('master.unlockHello', {}))).message, /Espera \d+ s|Wait \d+ s/);
    assert.ok((await e.call('master.helloState')).waitUntil, 'the wait is in the state');
    assert.ok(!/orb-hello-v1/.test(scan(t.home)), 'the signed text is nowhere');
    const tries = fs.readFileSync(path.join(t.home, 'core', 'secretos', 'intentos.json'), 'utf8');
    assert.ok(!/hello|nonce|token|unlock|sig/i.test(tries), tries);
  });
  await withEngine('cancel', async (e) => {
    await e.call('master.create', { password: PASS });
    assert.match((await fails(e.call('master.helloEnable', { password: PASS }))).message, /cancelado|cancelled/);
    assert.equal((await e.call('master.helloState')).enabled, false);
    await fails(e.call('master.unlockHello', {}));
  });
  await withEngine('no-hello', async (e) => {
    await e.call('master.create', { password: PASS });
    assert.equal((await e.call('master.helloState')).available, false);
    assert.match((await fails(e.call('master.helloEnable', { password: PASS }))).message, /no está disponible|not available/);
  });
});

test('no token, nonce or signature in the answers or the files after a Hello unlock', async () => {
  await withEngine('ok', async (e, t) => {
    await e.call('master.create', { password: PASS });
    const on = await e.call('master.helloEnable', { password: PASS });
    const h = await e.call('master.unlockHello', {});
    const answers = JSON.stringify([on, await e.call('master.helloState'), await e.call('master.state'), { ...h, unlock: '' }]);
    assert.ok(!/nonce|signature|firma|kek|"pub"|orb-hello/i.test(answers), answers);
    const text = scan(t.home);
    assert.ok(!text.includes(h.unlock), 'a token is only in memory');
    assert.ok(!/orb-hello-v1/.test(text));
    assert.ok(!text.includes(PASS));
  });
});
