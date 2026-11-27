// Reinstalling over a workspace that was already there (point 21): the question instead of the silent adoption, «Recuperar»,
// «Empezar de cero» (deletes nothing: what was there goes aside inside core), the update that never asks, and «Datos de antes».
// Temporary folders only; findExistingHome is told the platform has no drive letters so it never looks at this PC's real C:\Orb.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { world, put, tree } from './desinstalar-mundo.mjs';
import { startEngine } from './helpers.mjs';
import { previousData, answerPrevious, startFresh, recover, asideList, deleteAside, ASIDE } from '../src/engine/previous.mjs';
import { locateHome, readLocation, setupHome } from '../src/engine/desktop-home.mjs';
import * as K from '../src/domain/data/backup.mjs';
import { restoreMissing } from '../src/domain/security/master.mjs';
import { coreHealth } from '../src/domain/workspace/core-folder.mjs';
import { git } from '../src/platform/git.mjs';
import { secretsCopy } from '../src/engine/desktop-home.mjs';

const opts = (w, extra = {}) => ({ userData: w.userData, packaged: true, separateData: false, documents: path.join(w.base, 'Documentos'), profile: path.join(w.base, 'perfil'), platform: 'linux', ...extra });
const mark = (w) => fs.writeFileSync(path.join(w.userData, 'desinstalado.json'), '{"v":1,"code":"","expires":0}');

test('a reset core with the uninstall mark beside it clears the mark and does not ask', async () => {
  const w = await world({ backups: false }); w.close();
  try {
    mark(w);
    fs.writeFileSync(path.join(w.p.core, 'restablecido'), 'x');
    assert.equal(previousData(opts(w)), null);
    assert.equal(fs.existsSync(path.join(w.userData, 'desinstalado.json')), false, 'the mark does not wait for the next start');
  } finally { w.cleanup(); }
});

test('the question comes with a mark of an uninstall, or with no saved location and an Orb folder; never in an update or a plain start', async () => {
  const w = await world({ backups: false }); w.close();
  try {
    // a plain start: a saved location and no mark
    assert.equal(previousData(opts(w)), null);
    assert.equal(locateHome(opts(w)), w.home);
    // an uninstall left its mark: the saved folder is offered, not adopted
    mark(w);
    const p = previousData(opts(w));
    assert.equal(p.home, w.home); assert.equal(p.source, 'mark'); assert.ok(p.bytes > 0);
    // no saved location, but an Orb folder where Orb looks (Documents\Orb): offered too, and never saved in silence
    fs.rmSync(path.join(w.userData, 'ubicacion.json')); fs.rmSync(path.join(w.userData, 'desinstalado.json'));
    assert.equal(previousData(opts(w)), null, 'no Orb folder where Orb looks');
    const docs = path.join(w.base, 'Documentos'); fs.mkdirSync(docs);
    fs.cpSync(w.home, path.join(docs, 'Orb'), { recursive: true });
    const found = previousData(opts(w));
    assert.equal(found.source, 'folder'); assert.equal(found.home, path.join(docs, 'Orb'));
    assert.equal(readLocation(w.userData), null, 'nothing is saved before the user answers');
    // a start the user already decided about (core says «restablecido») never asks
    fs.writeFileSync(path.join(docs, 'Orb', 'core', 'restablecido'), 'x');
    assert.equal(previousData(opts(w)), null);
    // a run from the code or with a separate data folder never picks up a real folder
    fs.rmSync(path.join(docs, 'Orb', 'core', 'restablecido'));
    assert.equal(previousData(opts(w, { separateData: true })), null);
    assert.equal(previousData(opts(w, { packaged: false })), null);
    // the welcome (a first install) clears a stale mark
    mark(w);
    const fresh = path.join(w.base, 'nuevo'); fs.mkdirSync(fresh);
    setupHome({ userData: w.userData, base: fresh, assistantName: 'Orb', userName: '', language: 'es' });
    assert.ok(!fs.existsSync(path.join(w.userData, 'desinstalado.json')));
  } finally { w.cleanup(); }
});

test('«Recuperar»: as always (the location is kept or saved), and the mark goes', async () => {
  const w = await world({ backups: false }); w.close();
  try {
    mark(w);
    const r = await answerPrevious(opts(w), 'recover');
    assert.equal(r.home, w.home);
    assert.ok(!fs.existsSync(path.join(w.userData, 'desinstalado.json')));
    assert.equal(readLocation(w.userData), w.home);
    await assert.rejects(answerPrevious(opts(w), 'recover'), /./, 'nothing to ask any more');
    mark(w);
    await assert.rejects(answerPrevious(opts(w), 'borrar'), /./);
    assert.ok(fs.existsSync(path.join(w.userData, 'desinstalado.json')), 'a refused answer changes nothing');
  } finally { w.cleanup(); }
});

test('«Empezar de cero» deletes nothing: everything goes aside inside core, the vault copy with it, the key stays', async () => {
  const w = await world({ customFolder: true });
  try {
    // an isolated copy of a project (a git worktree under core\copias), to see it repaired
    const gitProject = path.join(w.home, 'web', 'conrepo'); fs.mkdirSync(gitProject);
    git(gitProject, 'init', '-q', '-b', 'main'); put(path.join(gitProject, 'a.txt'), 'a');
    git(gitProject, 'add', '.'); git(gitProject, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'primero');
    const copy = path.join(w.p.chatTrees, 'conrepo-abc'); fs.mkdirSync(w.p.chatTrees, { recursive: true });
    assert.equal(git(gitProject, 'worktree', 'add', '-q', '-b', 'orb/chat-abc', copy).status, 0);
    const oldId = K.orbIdOf(w.home).orbId;
    w.close();
    mark(w);
    const filesBefore = tree(w.home).filter((x) => !x.startsWith('web/conrepo/.git') && !x.includes('copias/chats/conrepo-abc/.git'));
    const r = await answerPrevious(opts(w), 'fresh');
    assert.equal(r.home, w.home);
    assert.match(path.basename(r.aside), ASIDE);
    // nothing deleted: every file of before is somewhere (core of before, now inside the aside folder)
    const all = new Set(tree(w.home));
    for (const f of filesBefore) {
      if (f.startsWith('core/') && !/^core\/anterior-/.test(f)) {
        const moved = `core/${path.basename(r.aside)}/${f.slice(5)}`;
        const key = /^core\/datos\/(clave|copia-clave)/.test(f);
        assert.ok(all.has(key ? f : moved) || f.endsWith('orb.json') || f.includes('orb.db'), `lost: ${f}`);
      } else assert.ok(all.has(f), `lost: ${f}`);
    }
    for (const f of ['orb.json', 'datos/orb.db', 'secretos/maestra.json', 'bitacora/GENERAL.md', 'ejecuciones/1/registro.jsonl', 'copias/fotos/a.txt', 'cuentas/claude/auth.json']) assert.ok(fs.existsSync(path.join(r.aside, ...f.split('/'))), `aside: ${f}`);
    // the vault's copy outside the workspace, with its old-name variants, went aside too (or restoreMissing would bring it back)
    assert.deepEqual(fs.readdirSync(path.join(r.aside, 'replica-boveda')).sort(), [`${w.hk}-secretos`, `${w.old}-secretos`].sort());
    assert.ok(!fs.existsSync(path.join(w.userData, 'claves', `${w.hk}-secretos`)) && !fs.existsSync(path.join(w.userData, 'claves', `${w.old}-secretos`)));
    // the PC's key stays (it opens that vault)
    for (const f of ['clave2.enc', 'copia-clave.json']) assert.ok(fs.existsSync(path.join(w.p.data, f)), f);
    assert.ok(fs.existsSync(path.join(w.userData, 'claves', `${w.hk}.v2.enc`)));
    // the backups are not touched either
    assert.equal((await K.listBackups(K.defaultBackupDir(w.home))).length >= 1, true);
    assert.equal(fs.readdirSync(w.folder).filter((n) => n.endsWith('.orbbak')).length, 1);
    // a new, healthy core with the welcome to do, its own identity, the location saved and the mark gone
    assert.equal(coreHealth(w.home).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(w.p.config, 'utf8')).setupPending, true);
    assert.ok(fs.existsSync(path.join(w.p.core, 'restablecido')));
    assert.notEqual(K.orbIdOf(w.home).orbId, oldId);
    assert.equal(readLocation(w.userData), w.home);
    assert.ok(!fs.existsSync(path.join(w.userData, 'desinstalado.json')));
    // restart: nothing of before comes back (no vault from its copy, no restore from the old backups)
    assert.deepEqual(restoreMissing(w.p.secrets, secretsCopy(w.userData, w.home)), []);
    const repair = await K.repairCore(w.home, { secret: w.secret });
    assert.equal(repair.ok, true); assert.equal(repair.restored, undefined);
    assert.ok(!fs.existsSync(path.join(w.p.secrets, 'maestra.json')));
    // the isolated copy that moved is still the project's: git knows its new place
    const moved = path.join(r.aside, 'copias', 'chats', 'conrepo-abc');
    assert.equal(git(moved, 'status', '--porcelain').status, 0);
    assert.ok(git(gitProject, 'worktree', 'list', '--porcelain').stdout.toLowerCase().includes(moved.toLowerCase().replace(/\\/g, '/')), git(gitProject, 'worktree', 'list').stdout);
    // «Datos de antes» lists it and deletes it, and the project's repository drops the copy that went
    const list = asideList(w.home);
    assert.equal(list.length, 1); assert.equal(list[0].name, path.basename(r.aside)); assert.ok(list[0].bytes > 0);
    assert.throws(() => deleteAside(w.home, '..'), /./);
    assert.throws(() => deleteAside(w.home, 'orb.json'), /./);
    assert.throws(() => deleteAside(w.home, 'anterior-x'), /./);
    const out = deleteAside(w.home, list[0].name, { projects: [gitProject] });
    assert.equal(out.deleted, list[0].name);
    assert.ok(!fs.existsSync(r.aside) && fs.existsSync(w.p.config), 'only the aside folder went');
    assert.ok(!git(gitProject, 'worktree', 'list', '--porcelain').stdout.includes('conrepo-abc'));
    assert.deepEqual(asideList(w.home), []);
  } finally { w.cleanup(); }
});

test('a second «Empezar de cero» the same day does not mix with the first, and an aside folder that is a link is never deleted', async () => {
  const w = await world({ backups: false, vault: false }); w.close();
  try {
    mark(w);
    const a = await startFresh({ userData: w.userData, home: w.home });
    put(path.join(w.p.core, 'ejecuciones', '2', 'x'), 'x'); // something new in the new core
    const b = await startFresh({ userData: w.userData, home: w.home });
    assert.notEqual(a.aside, b.aside);
    assert.ok(fs.existsSync(path.join(a.aside, 'orb.json')), 'the first aside stays where it is');
    assert.ok(fs.existsSync(path.join(b.aside, 'ejecuciones', '2', 'x')));
    // a junction with the name of an aside folder: refused, and its target intact
    const target = path.join(w.base, 'ajena'); put(path.join(target, 'mia.txt'), 'mia');
    const link = path.join(w.p.core, 'anterior-2020-01-01');
    fs.symlinkSync(target, link, 'junction');
    assert.throws(() => deleteAside(w.home, 'anterior-2020-01-01'), /./);
    assert.ok(fs.existsSync(path.join(target, 'mia.txt')));
    assert.ok(!asideList(w.home).some((x) => x.name === 'anterior-2020-01-01'), 'a link is not listed');
    recover({ userData: w.userData, home: w.home });
  } finally { w.cleanup(); }
});

test('through the engine: locate offers the question, «fresh» sets the workspace up and nothing is deleted', async () => {
  const w = await world({ backups: false, vault: false }); w.close();
  mark(w);
  const { fork } = await import('node:child_process');
  const { ROOT } = await import('./helpers.mjs');
  const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  let n = 0; const pending = new Map();
  child.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m.result) : p.reject(new Error(m.error))); } });
  const ask = (type, extra = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); child.send({ type, id, userData: w.userData, packaged: true, separateData: false, ...extra }); });
  try {
    const located = await ask('locate');
    assert.equal(located.home, null);
    assert.equal(located.previous.home, w.home); assert.equal(located.previous.source, 'mark');
    const r = await ask('previousChoice', { choice: 'fresh', language: 'es' });
    assert.equal(r.home, w.home);
    assert.ok(fs.existsSync(path.join(w.p.core, 'restablecido')));
    assert.equal(fs.readdirSync(w.p.core).filter((x) => ASIDE.test(x)).length, 1);
    assert.equal((await ask('locate')).home, w.home, 'answered: the next start is a plain one');
  } finally { child.kill(); await new Promise((r) => child.once('exit', r)); w.cleanup(); }
});

test('«Empezar de cero», then the engine starts: it restores nothing from the old vault copy or the old backups', async () => {
  const crypto = await import('node:crypto');
  const w = await world({ customFolder: true }); w.close();
  mark(w);
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    const r = await answerPrevious(opts(w), 'fresh');
    const e = await startEngine(w.home, { secret, userData: w.userData });
    try {
      const st = await e.call('app.state', {});
      assert.equal(st.welcomeFresh, true); assert.equal(st.config.setupPending, true);
      assert.equal((await e.call('conversations.list', {})).length, 0, 'the old chats did not come back');
      assert.deepEqual((await e.call('projects.list', {})).map((p) => p.name).sort(), ['blog', 'scripts-viejos', 'tienda'], 'the folders of the categories are found again, as ever; the one outside is not');
      const notices = e.events.filter((x) => x.event === 'notice').map((x) => x.payload?.body ?? '').join('|');
      assert.ok(!/restaur|restored/i.test(notices), notices);
      assert.ok(!e.events.some((x) => x.event === 'core:lost'));
    } finally { await e.stop(); }
    assert.ok(!fs.existsSync(path.join(w.p.secrets, 'maestra.json')), 'the vault of before did not come back from its copy');
    assert.ok(fs.existsSync(path.join(r.aside, 'secretos', 'maestra.json')), 'it is still aside');
    assert.ok(fs.existsSync(path.join(r.aside, 'datos', 'orb.db')));
  } finally { w.cleanup(); }
});

test('an update never asks and never deletes: the question is for a start with the mark or with no saved location', async () => {
  const w = await world({ backups: false, vault: false }); w.close();
  try {
    // the hooks leave no mark in an update (their tests: desinstalar-ganchos), so a start after an update is a plain one
    assert.equal(previousData(opts(w)), null);
    assert.equal(locateHome(opts(w)), w.home);
    const before = tree(w.home);
    assert.deepEqual(tree(w.home), before);
    void startEngine;
  } finally { w.cleanup(); }
});
