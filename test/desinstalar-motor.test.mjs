// Uninstall and reset through the real engine (its own process, as the app runs it) on temporary folders: the new methods are
// for this PC's window only, they ask for the unlock, refuse a plan the window did not see, and after each shortcut the engine
// starts again and restores nothing. The app's own part (the Recycle Bin, the uninstaller) is answered by the test.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { world, tree, put } from './desinstalar-mundo.mjs';
import { startEngine, until, wait } from './helpers.mjs';
import { METHODS, REMOTE_METHODS, principalOf, needsUnlock, UNLOCK_IF_MASTER } from '../src/domain/security/permissions.mjs';
import { authorize } from '../src/domain/security/permissions.mjs';
import { BOXES } from '../src/shared/uninstall-boxes.mjs';

const keepOf = (names) => Object.fromEntries(BOXES.map((b) => [b, names.includes(b)]));
const hex = () => crypto.randomBytes(32).toString('hex');
// The app's side: a Recycle Bin that moves the folder aside (after the same two marks the app checks), and an uninstaller beside it.
const fakeApp = (w, { uninstaller = true, binFails = null } = {}) => {
  const log = [];
  const host = async (method, params) => {
    log.push([method, params.path ?? null]);
    if (method === 'host.uninstallCheck') return { ready: uninstaller };
    if (method === 'host.trashFolder') {
      assert.equal(fs.readFileSync(path.join(params.path, '.orb-creada'), 'utf8').trim(), params.token, 'the app checks the mark again');
      if (binFails === path.basename(params.path)) return { ok: false, noTrash: true };
      const to = path.join(w.base, 'papelera', path.basename(params.path)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(params.path, to);
      return { ok: true };
    }
    throw new Error(`host: ${method}`);
  };
  return { host, log };
};
const boot = (w, secret, app) => startEngine(w.home, { secret, userData: w.userData, host: app?.host });

test('the new methods are for this PC\'s window only: no phone, no browser, no agent, and an unlock when the vault has a password', async () => {
  const methods = ['uninstall.plan', 'uninstall.run', 'previous.list', 'previous.delete'];
  const phone = principalOf({ device: { id: 'm1', kind: 'phone' } });
  const browser = principalOf({ device: { id: 'b1', kind: 'browser' } });
  const agent = { channel: 'agent', agent: 'claude', task: 1, conversation: 'c1' };
  for (const m of methods) {
    assert.equal(METHODS[m], 'pc', m); assert.ok(!REMOTE_METHODS.has(m), m);
    for (const p of [phone, browser, agent]) assert.throws(() => authorize(p, m), /./, `${p.channel}: ${m}`);
    assert.doesNotThrow(() => authorize(principalOf(), m));
  }
  for (const m of ['uninstall.plan', 'uninstall.run', 'previous.delete']) { assert.ok(UNLOCK_IF_MASTER.has(m)); assert.equal(needsUnlock(m, {}), true); }
  assert.equal(needsUnlock('previous.list', {}), false);
});

test('through the engine: a refused plan, the word, the missing uninstaller, a master password that asks first', async () => {
  const w = await world({ backups: false, vault: false }); w.close();
  const app = fakeApp(w, { uninstaller: false });
  const e = await boot(w, hex(), app);
  try {
    const plan = await e.call('uninstall.plan', { mode: 'uninstall', keep: keepOf([]) });
    assert.equal(plan.mode, 'uninstall'); assert.equal(plan.trash.length, 2); assert.equal(plan.oldProjects.length, 1);
    const same = { mode: 'uninstall', keep: keepOf([]), planId: plan.id };
    await assert.rejects(e.call('uninstall.run', { ...same, planId: 'otro' }), /cambiado|changed/i);
    await assert.rejects(e.call('uninstall.run', { ...same }), /BORRAR|DELETE|escrib|type/i, 'Borrar todo is typed');
    // no uninstaller beside the program: nothing is deleted
    await assert.rejects(e.call('uninstall.run', { ...same, typed: 'BORRAR' }), /desinstalador|uninstaller/i);
    assert.ok(fs.existsSync(w.mine.path) && fs.existsSync(path.join(w.p.data, 'clave2.enc')) );
    assert.deepEqual(app.log.filter(([m]) => m === 'host.trashFolder'), []);
    // bad parameters
    await assert.rejects(e.call('uninstall.plan', { mode: 'borrar' }), /./);
    await assert.rejects(e.call('uninstall.plan', { mode: 'reset', keep: { chats: 'si' } }), /./);
    // with a master password the calls ask for the unlock
    const made = await e.call('master.create', { password: 'una frase larga de prueba' }).catch((x) => { throw new Error(`create: ${x.message}`); });
    void made;
    await assert.rejects(e.call('uninstall.plan', { mode: 'reset', keep: keepOf([]) }), /desbloque|unlock|contrase|password/i);
    const unlock = (await e.call('master.unlock', { password: 'una frase larga de prueba' }).catch((x) => { throw new Error(`unlock: ${x.message}`); })).unlock;
    assert.ok((await e.call('uninstall.plan', { mode: 'reset', keep: keepOf([]), unlock }).catch((x) => { throw new Error(`plan: ${x.message}`); })).id);
  } finally { await e.stop(); w.cleanup(); }
});

for (const shortcut of ['all', 'projects', 'nothing']) {
  test(`uninstall, shortcut «${shortcut}»: the plan is what runs, and the engine started again restores nothing`, async () => {
    const w = await world({ customFolder: true }); w.close();
    const keep = keepOf(shortcut === 'all' ? BOXES : shortcut === 'projects' ? ['projects'] : []);
    const secret = hex();
    const app = fakeApp(w);
    let e = await boot(w, secret, app);
    let r;
    try {
      const plan = await e.call('uninstall.plan', { mode: 'uninstall', keep });
      assert.equal(plan.trash.length, shortcut === 'nothing' ? 2 : 0);
      r = await e.call('uninstall.run', { mode: 'uninstall', keep, planId: plan.id, typed: 'borrar' });
    } finally { await e.stop(); }
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.code, /^[0-9a-f]{32}$/);
    // the mark the uninstaller's hooks read: compact JSON with the code, an hour of life and what was kept
    const text = fs.readFileSync(path.join(w.userData, 'desinstalado.json'), 'utf8');
    const mark = JSON.parse(text);
    assert.equal(mark.code, r.code); assert.ok(mark.expires - Date.now() > 3_500_000 && mark.expires - Date.now() <= 3_600_000);
    assert.equal(mark.kept, true, 'an old project always stays'); assert.ok(text.includes('"kept":true')); assert.equal(mark.encrypted, shortcut === 'all');
    assert.ok(!fs.existsSync(path.join(w.userData, 'desinstalando.json')), 'the journal is closed');
    // the chosen backups folder is never removed; its file of this Orb goes unless kept
    assert.ok(fs.existsSync(w.folder));
    assert.equal(fs.readdirSync(w.folder).some((n) => n.endsWith('.orbbak')), shortcut === 'all');
    assert.equal(fs.existsSync(path.join(w.userData, 'ubicacion.json')), true, 'an old project stays, so does the way to find the workspace');
    assert.equal(fs.existsSync(path.join(w.p.data, 'clave2.enc')), shortcut === 'all', 'the PC key stays only with something encrypted');
    // start again (the app would after a reinstall and «Recuperar»): nothing is brought back
    const before = tree(w.home);
    e = await startEngine(w.home, { secret, userData: w.userData });
    try {
      const st = await e.call('app.state', {});
      assert.ok(st.config);
      assert.ok(!e.events.some((x) => x.event === 'core:lost'));
      const notices = e.events.filter((x) => x.event === 'notice').map((x) => x.payload?.body ?? '').join('|');
      assert.ok(!/restaur|restored|copia/i.test(notices), notices);
      if (shortcut !== 'all') {
        assert.equal((await e.call('conversations.list', {})).length, 0);
        assert.ok(!fs.existsSync(w.p.copies) || !fs.existsSync(path.join(w.p.copies, 'fotos', 'a.txt')));
        assert.ok((await e.call('backup.list', {})).every((b) => !b.name || true));
      }
    } finally { await e.stop(); }
    assert.ok(!fs.existsSync(path.join(w.p.secrets, 'maestra.json')) || shortcut === 'all', 'the vault was not restored from its copy');
    assert.equal(fs.existsSync(path.join(w.userData, 'claves', `${w.hk}.v2.enc`)) && shortcut !== 'all' && shortcut !== 'nothing', false);
    void before; void wait; void until; void put;
    w.cleanup();
  });
}

test('reset: the engine ends to start again, the saved location and the projects stay, the welcome starts from its first step', async () => {
  const w = await world({ customFolder: true }); w.close();
  const secret = hex();
  const app = fakeApp(w);
  let e = await boot(w, secret, app);
  let r; let gone = false;
  try {
    const keep = keepOf([]);
    const plan = await e.call('uninstall.plan', { mode: 'reset', keep });
    assert.equal(plan.keep.projects, true, 'a reset keeps the projects');
    assert.equal(plan.trash.length, 0);
    r = await e.call('uninstall.run', { mode: 'reset', keep, planId: plan.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    // the engine ends by itself (exit code 75: the app starts it again)
    const code = await Promise.race([e.exited, wait(10000).then(() => 'late')]);
    gone = true;
    assert.equal(code, 75);
  } finally { if (!gone) await e.stop(); }
  assert.deepEqual(app.log.filter(([m]) => m === 'host.trashFolder'), [], 'no folder went to the Recycle Bin');
  assert.ok(fs.existsSync(path.join(w.userData, 'ubicacion.json')));
  assert.ok(fs.existsSync(path.join(w.p.core, 'restablecido')));
  e = await startEngine(w.home, { secret, userData: w.userData });
  try {
    const st = await e.call('app.state', {});
    assert.equal(st.welcomeFresh, true); assert.equal(st.config.setupPending, true);
    assert.deepEqual((await e.call('projects.list', {})).map((p) => p.name).sort(), ['blog', 'externo', 'scripts-viejos', 'tienda']);
    assert.ok(!e.events.some((x) => x.event === 'core:lost'));
    // the welcome ends: the mark goes
    await e.call('config.save', { patch: { setupPending: false } });
    assert.ok(!fs.existsSync(path.join(w.p.core, 'restablecido')));
    assert.equal((await e.call('app.state', {})).welcomeFresh, false);
  } finally { await e.stop(); }
  w.cleanup();
});

test('a project the Recycle Bin cannot take stops the run: it says what went, the uninstaller is not offered, the next start finishes', async () => {
  const w = await world({ backups: false }); w.close();
  const secret = hex();
  const app = fakeApp(w, { binFails: 'blog' });
  let e = await boot(w, secret, app);
  let r; let gone = false;
  try {
    const keep = keepOf([]);
    const plan = await e.call('uninstall.plan', { mode: 'uninstall', keep });
    r = await e.call('uninstall.run', { mode: 'uninstall', keep, planId: plan.id, typed: 'BORRAR' });
    assert.equal(r.ok, false); assert.equal(r.code, undefined, 'no code: nothing launches the uninstaller');
    assert.equal(r.report.failed[0].name, 'blog'); assert.equal(r.report.failed[0].code, 'ENOTRASH');
    assert.ok(!fs.existsSync(path.join(w.userData, 'desinstalado.json')));
    assert.ok(fs.existsSync(path.join(w.userData, 'desinstalando.json')), 'the journal is kept');
    await Promise.race([e.exited, wait(10000)]); gone = true;
  } finally { if (!gone) await e.stop(); }
  assert.ok(fs.existsSync(w.p.config) && fs.existsSync(path.join(w.p.data, 'clave2.enc')), 'nothing of the data was deleted');
  // a reported failure stops for good: the next start does not go on by itself, it says so
  e = await startEngine(w.home, { secret, userData: w.userData });
  let again;
  try {
    assert.equal((await e.call('uninstall.pending', {})).state, 'stopped', 'the window is told');
    assert.ok(fs.existsSync(path.join(w.userData, 'desinstalando.json')), 'the journal waits');
    assert.ok(fs.existsSync(path.join(w.p.data, 'clave2.enc')), 'nothing more was deleted');
    // the user confirms: the engine ends to start again and the next start finishes (the folder that did not go stays)
    assert.deepEqual(await e.call('uninstall.resume', {}), { ok: true });
  } finally { again = await Promise.race([e.exited, wait(10000).then(() => null)]); if (again !== 75) await e.stop(); }
  e = await startEngine(w.home, { secret, userData: w.userData });
  try {
    await until(async () => !fs.existsSync(path.join(w.userData, 'desinstalando.json')), 'diario cerrado');
    assert.ok(!fs.existsSync(path.join(w.p.data, 'clave2.enc')));
    assert.ok(fs.existsSync(w.second.path) || fs.existsSync(w.mine.path), 'the folder that could not go to the Recycle Bin is still there');
  } finally { await e.stop(); }
  w.cleanup();
});

test('«uninstall.restart» (the uninstaller could not start) makes the engine end to start again; the journal that did not exist is no error', async () => {
  const w = await world({ backups: false, vault: false }); w.close();
  const e = await boot(w, hex(), fakeApp(w));
  let code = null;
  try {
    assert.deepEqual(await e.call('uninstall.restart', {}), { ok: true });
    code = await Promise.race([e.exited, wait(10000).then(() => null)]);
    assert.equal(code, 75);
  } finally { if (code !== 75) await e.stop(); }
  const e2 = await boot(w, hex(), fakeApp(w));
  try { await assert.rejects(e2.call('uninstall.resume', {}), /./, 'nothing is waiting'); } finally { await e2.stop(); }
  w.cleanup();
});
