// 3.8.10, step 7 H6: a phone linked without the master password, with a one-use code that the PC shows after Windows Hello.
// Real engine, real orb-vault (with the tests' fake Hello), the tests' phone client. The code lives in the vault only; the
// phone links only after its owner says yes to the phone's name at the PC, and what it gets is no right to approve.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine, until, wait } from './helpers.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';
import { parseLinkPayload } from '../src/shared/link-payload.mjs';

const PASS = TEST_MASTER;
const said = async (p) => { try { await p; return ''; } catch (error) { return String(error.message); } };

async function withPc(fn, { env = {} } = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { enabled: true, port, name: 'Casa' } });
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex'), env: { ORB_REMOTE_BIND: '127.0.0.1', ORB_VAULT_FAKE_HELLO: 'ok', ...env } });
  const phones = [];
  try {
    await until(async () => (await e.call('remote.status')).running, 'acceso');
    await e.call('master.create', { password: PASS });
    assert.equal((await e.call('master.helloEnable', { password: PASS })).ok, true);
    // A code, made with Windows Hello (the default way) or with the password.
    const code = async ({ how = 'hello', kind = 'wifi' } = {}) => {
      const unlock = how === 'hello' ? (await e.call('master.unlockHello', { purpose: 'linkCode' })).unlock : (await e.call('master.unlock', { password: PASS, purpose: 'linkCode' })).unlock;
      const made = await e.call('link.codeNew', { unlock, kind });
      const h = new URLSearchParams(new URL(made.url).hash.slice(1));
      return { ...made, secret: h.get('enlace'), typed: made.code.replace(/-/g, '') };
    };
    const newPhone = (opts) => { const ph = createPhone({ name: 'Pixel de Dani', ...opts }); phones.push(ph); return ph; };
    // The question the PC asks its owner: the first `link:confirm` event that names a phone.
    const asked = async (from = 0) => { await until(() => e.events.slice(from).some((x) => x.event === 'link:confirm' && x.payload?.id), 'la pregunta del PC'); return e.events.slice(from).find((x) => x.event === 'link:confirm' && x.payload?.id).payload; };
    await fn({ e, t, code, newPhone, asked });
  } finally { for (const p of phones) p.stop(); await e.stop(); t.cleanup(); }
}

test('the QR has a 128-bit secret and 8 typed characters, and links after Hello and the owner\'s yes', async () => {
  await withPc(async ({ e, code, newPhone, asked }) => {
    const c = await code();
    assert.match(c.url, /#enlace=/);
    assert.doesNotMatch(c.url, /vincular=/);
    assert.equal(Buffer.from(c.secret, 'base64url').length, 16);
    assert.match(c.typed, /^[A-Z2-9]{8}$/);
    assert.equal(c.link, true);
    const parsed = parseLinkPayload(c.url);
    assert.equal(parsed.via, 'link');
    // the phone gives no password (it has none to give: the one in its settings would be wrong)
    const ph = newPhone({ password: 'ninguna que valga' });
    const linking = ph.connect({ qr: c.url });
    const q = await asked();
    assert.equal(q.name, 'Pixel de Dani');
    assert.equal((await e.call('link.devices')).length, 0, 'not linked while the PC waits for its owner');
    assert.deepEqual(await e.call('link.codeAnswer', { id: q.id, accept: true }), { ok: true });
    const { id } = await linking;
    const list = await e.call('link.devices');
    assert.deepEqual(list.map((d) => d.id), [id]);
    assert.equal(list[0].name, 'Pixel de Dani');
    assert.ok(Array.isArray(await ph.call(id, 'projects.list')), 'the link works');
    // one use: the same QR is dead
    assert.ok(await said(newPhone().connect({ qr: c.url })));
    assert.equal((await e.call('link.devices')).length, 1);
  });
});

test('typed by hand: the 8 characters and the address, stretched with the code\'s own salt', async () => {
  await withPc(async ({ e, code, newPhone, asked }) => {
    const c = await code({ how: 'password' });
    const base = new URL(c.url).origin;
    const hello = await (await fetch(`${base}/api/hello`)).json();
    assert.equal(hello.short, 4);
    assert.equal(Buffer.from(hello.salt, 'base64url').length, 16);
    assert.equal(JSON.stringify(hello).includes(c.typed), false);
    assert.equal(JSON.stringify(hello).includes(c.secret), false);
    const ph = newPhone({ password: '' });
    const linking = ph.connect({ code: `${c.typed.slice(0, 4).toLowerCase()}-${c.typed.slice(4)}`, address: base, fp: c.pc });
    const q = await asked();
    await e.call('link.codeAnswer', { id: q.id, accept: true });
    assert.ok((await linking).id);
  });
});

test('without the owner\'s yes there is no link: a no, no answer, or another id', async () => {
  await withPc(async ({ e, code, newPhone, asked }) => {
    const c = await code();
    const ph = newPhone();
    const linking = said(ph.connect({ qr: c.url }));
    const q = await asked();
    assert.deepEqual(await e.call('link.codeAnswer', { id: 'otro-id', accept: true }), { ok: false }, 'an answer for another question does nothing');
    assert.deepEqual(await e.call('link.codeWaiting'), { id: q.id, name: 'Pixel de Dani', ip: q.ip, until: q.until });
    await e.call('link.codeAnswer', { id: q.id, accept: false });
    assert.match(await linking, /confirm/i, 'the phone is told');
    assert.equal((await e.call('link.devices')).length, 0);
    assert.equal(await e.call('link.codeWaiting'), null);
    // the code went with the no: a new one is needed
    assert.ok(await said(newPhone().connect({ qr: c.url })));
    assert.equal((await e.call('link.devices')).length, 0);
  });
  await withPc(async ({ e, code, newPhone }) => {
    const c = await code();
    assert.match(await said(newPhone().connect({ qr: c.url })), /confirm|confirmado/i);
    assert.equal((await e.call('link.devices')).length, 0, 'nobody answered');
  }, { env: { ORB_LINK_CONFIRM_MS: '600' } });
});

test('a phone linked with a code cannot approve anything: it is not registered and the register still needs the password', async () => {
  await withPc(async ({ e, code, newPhone, asked }) => {
    const c = await code();
    const ph = newPhone();
    const linking = ph.connect({ qr: c.url });
    await e.call('link.codeAnswer', { id: (await asked()).id, accept: true });
    const { id } = await linking;
    const list = await e.call('approve.devices');
    assert.deepEqual(list.phones.map((p) => [p.id, p.registered]), [[id, false]]);
    assert.match(await said(e.call('approve.request', { method: 'secrets.connector', params: { name: 'x' } })), /./, 'nothing to ask');
    assert.match(await said(e.call('approve.register', { id })), /./, 'registering asks for the password or the code');
    assert.match(await said(e.call('approve.register', { id, password: 'otra contraseña larga' })), /./);
    const enrol = await ph.call(id, 'approve.enroll', { nonce: 'x', pub: 'x', sig: 'x' }).catch(() => ({ ok: false }));
    assert.notEqual(enrol.ok, true, 'the phone cannot enrol by itself');
    assert.equal((await e.call('approve.devices')).phones[0].registered, false);
  });
});

test('three wrong tries kill the code, even for the right one after them', async () => {
  await withPc(async ({ e, t, code, newPhone }) => {
    const c = await code();
    const base = new URL(c.url).origin;
    const wrong = c.typed[0] === 'A' ? `B${c.typed.slice(1)}` : `A${c.typed.slice(1)}`;
    for (let i = 0; i < 2; i += 1) assert.ok(await said(newPhone().connect({ code: wrong, address: base })), `try ${i + 1}`);
    assert.ok(await said(newPhone().connect({ code: wrong, address: base })), 'the third');
    const after = await said(newPhone().connect({ code: c.typed, address: base }));
    assert.ok(after, 'the right code is no longer good');
    assert.ok(await said(newPhone().connect({ qr: c.url })), 'nor the QR');
    assert.equal((await e.call('link.devices')).length, 0);
    assert.equal((await fetch(`${base}/api/hello`)).status, 404, 'nothing to type any more');
  });
});

test('Bloquear cancels the code and the question waiting for its owner', async () => {
  await withPc(async ({ e, code, newPhone, asked }) => {
    const c = await code();
    const linking = said(newPhone().connect({ qr: c.url }));
    await asked();
    await e.call('master.lock', { reason: 'hand' });
    assert.ok(await linking, 'the phone is refused');
    assert.equal((await e.call('link.devices')).length, 0);
    assert.equal(await e.call('link.codeWaiting'), null);
    const again = await code().catch((error) => error);
    assert.ok(again instanceof Error || again.url, 'a locked PC needs its proof again');
  });
  await withPc(async ({ e, code, newPhone }) => {
    const c = await code();
    await e.call('master.lock', { reason: 'hand' });
    await e.call('master.unlock', { password: PASS });
    assert.ok(await said(newPhone().connect({ qr: c.url })), 'a code does not survive a lock');
  });
});

test('only a token made for it, of Hello or the password, makes a code', async () => {
  await withPc(async ({ e }) => {
    assert.ok(await said(e.call('link.codeNew', { kind: 'wifi' })), 'no token');
    assert.ok(await said(e.call('link.codeNew', { unlock: 'inventado', kind: 'wifi' })));
    const win = (await e.call('master.unlock', { password: PASS })).unlock;
    assert.ok(await said(e.call('link.codeNew', { unlock: win, kind: 'wifi' })), 'the window\'s own token');
    const other = (await e.call('master.unlock', { password: PASS, purpose: 'rails' })).unlock;
    assert.ok(await said(e.call('link.codeNew', { unlock: other, kind: 'wifi' })), 'a token for another action');
    const mine = (await e.call('master.unlockHello', { purpose: 'linkCode' })).unlock;
    assert.equal((await e.call('link.codeNew', { unlock: mine, kind: 'wifi' })).link, true);
    assert.ok(await said(e.call('link.codeNew', { unlock: mine, kind: 'wifi' })), 'one use');
    const pw = (await e.call('master.unlock', { password: PASS, purpose: 'linkCode' })).unlock;
    assert.equal((await e.call('link.codeNew', { unlock: pw, kind: 'wifi' })).link, true, 'the password\'s works too');
  });
});

test('the code is never in a file or a log of this PC', async () => {
  await withPc(async ({ e, t, code, newPhone, asked }) => {
    const c = await code();
    const ph = newPhone();
    const linking = ph.connect({ qr: c.url });
    await e.call('link.codeAnswer', { id: (await asked()).id, accept: true });
    await linking;
    await wait(300);
    const hits = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(file); continue; }
        let text = ''; try { text = fs.readFileSync(file, 'latin1'); } catch { continue; }
        if (text.includes(c.secret) || text.includes(c.typed)) hits.push(file);
      }
    };
    walk(t.base);
    assert.deepEqual(hits, []);
    assert.equal(JSON.stringify(e.events.filter((x) => x.event === 'notice' || x.event === 'link:devices')).includes(c.secret), false);
  });
});

test('linking with the master password works as before', async () => {
  await withPc(async ({ e, newPhone }) => {
    const ph = newPhone();
    const { id } = await ph.connect({ qr: (await e.call('link.qr', { device: 'phone' })).url });
    assert.deepEqual((await e.call('link.devices')).map((d) => d.id), [id]);
    const bad = newPhone({ password: 'una contraseña equivocada' });
    assert.ok(await said(bad.connect({ qr: (await e.call('link.qr', { device: 'phone' })).url })));
  });
});

test('the phone access has to be on already: Hello never turns it on', async () => {
  await withPc(async ({ e, code }) => {
    await e.call('remote.enable', { enabled: false });
    const unlock = (await e.call('master.unlockHello', { purpose: 'linkCode' })).unlock;
    assert.match(await said(e.call('link.codeNew', { unlock, kind: 'wifi' })), /activa primero|enable/i);
    assert.equal((await e.call('remote.status')).running, false);
  });
});

test('the phone name loses control and invisible characters before it is asked and kept', async () => {
  await withPc(async ({ e, code, newPhone, asked }) => {
    const c = await code();
    const linking = newPhone({ name: 'Pixel‮de Dani​' }).connect({ qr: c.url });
    const q = await asked();
    assert.doesNotMatch(q.name, /[\p{Cc}\p{Cf}]/u);
    await e.call('link.codeAnswer', { id: q.id, accept: true });
    await linking;
    assert.doesNotMatch((await e.call('link.devices'))[0].name, /[\p{Cc}\p{Cf}]/u);
  });
});
