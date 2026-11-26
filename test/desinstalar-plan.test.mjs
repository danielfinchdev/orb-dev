// Uninstall and reset: the plan (what goes, what stays, what is never touched) and the run, on temporary folders only.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { world, put, tree } from './desinstalar-mundo.mjs';
import { normalizeKeep, keepsKey, SHORTCUTS, BOXES } from '../src/shared/uninstall-boxes.mjs';
import * as U from '../src/domain/data/uninstall.mjs';
import * as K from '../src/domain/data/backup.mjs';
import { restoreMissing } from '../src/domain/security/master.mjs';
import { coreHealth } from '../src/domain/workspace/core-folder.mjs';
import { marked, readMark, MARK_FILE } from '../src/domain/projects/created-marks.mjs';
import { secretsCopy } from '../src/engine/desktop-home.mjs';

const keepOf = (names) => Object.fromEntries(BOXES.map((b) => [b, names.includes(b)]));
const plan = (w, o = {}) => U.planUninstall({ env: w.env(), projects: w.rows(), devices: 1, ...o });
const names = (pl) => pl.items.map((i) => i.path ?? i.name);
// A fake Recycle Bin: the folder is moved aside (what the Recycle Bin does), never deleted for good.
const bin = (w) => { const moved = []; return { moved, trash: async (p, token, name) => { const to = path.join(w.base, 'papelera', name); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(p, to); moved.push(name); return { ok: true }; } }; };
const runIt = async (w, pl, extra = {}) => {
  const b = bin(w); const order = [];
  const r = await U.runPlan({ env: w.env(), plan: pl, hooks: { trash: b.trash, project: (n) => w.board.project(n), dropProject: (n) => w.board.removeProject(n, 'orb'), closeDb: () => { order.push('closeDb'); w.close(); }, ...extra.hooks } });
  return { r, b, order };
};

test('the boxes: the link and the connectors\' keys force the vault, the backup copy forces the backups, reset keeps the projects', () => {
  assert.deepEqual(normalizeKeep({ link: true }).forced, { vault: 'link' });
  assert.equal(normalizeKeep({ settings: true }, { mcpKeys: true }).keep.vault, true);
  assert.equal(normalizeKeep({ settings: true }, { mcpKeys: false }).keep.vault, false);
  assert.equal(normalizeKeep({}, { copyFirst: true }).keep.backups, true);
  assert.equal(normalizeKeep({}, { mode: 'reset' }).keep.projects, true);
  assert.equal(keepsKey(normalizeKeep({ link: true }).keep), true);
  assert.equal(keepsKey(normalizeKeep({ chats: true, settings: true }).keep), false, 'chats and settings are not encrypted: the key goes');
  assert.equal(keepsKey(normalizeKeep({ backups: true }).keep), true);
  assert.deepEqual(SHORTCUTS.projects, ['projects']);
});

test('the marks: created folders carry both marks, a folder with one mark only is not Orb\'s', async () => {
  const w = await world();
  try {
    const row = w.board.project('tienda');
    assert.match(row.created_by_orb, /^[0-9a-f]{32}$/);
    assert.equal(readMark(row.path), row.created_by_orb);
    assert.equal(marked(row.path, row.created_by_orb), true);
    assert.equal(marked(row.path, 'f'.repeat(32)), false);
    assert.equal(w.board.project('scripts-viejos').created_by_orb, null, 'an imported folder is never marked');
    // the folder is renamed with the project: the mark travels with it
    const { renameProject } = await import('../src/domain/projects/projects.mjs');
    const r = renameProject(w.board, { name: 'tienda', to: 'tienda2' }, 'usuario');
    assert.equal(r.created_by_orb, row.created_by_orb);
    assert.equal(marked(r.path, r.created_by_orb), true);
    // pointing the project at another folder drops the mark
    const other = path.join(w.home, 'web', 'otra'); fs.mkdirSync(other);
    w.board.addProject({ name: 'tienda2', path: other }, 'usuario', { fromUser: true });
    assert.equal(w.board.project('tienda2').created_by_orb, null);
    // the mark file is kept out of git status
    const g = path.join(w.home, 'linux', 'conmarca'); fs.mkdirSync(g);
    const { createProject } = await import('../src/domain/projects/projects.mjs');
    const c = createProject(w.board, { name: 'conmarca', category: 'linux' }, 'usuario');
    assert.equal(readMark(c.path) !== null, true);
    const { git } = await import('../src/platform/git.mjs');
    assert.equal(git(c.path, 'status', '--porcelain').stdout.trim(), '', MARK_FILE);
  } finally { w.close(); w.cleanup(); }
});

test('the plan of «Borrar todo»: every box, the PC key last, old projects kept and listed, nothing outside what Orb owns', async () => {
  const w = await world({ customFolder: true });
  try {
    const pl = await plan(w, { keep: keepOf([]) });
    const stages = pl.items.map((i) => i.stage);
    assert.deepEqual([...new Set(stages)], ['projects', 'data', 'vault', 'key', 'end'].filter((s) => stages.includes(s)));
    assert.deepEqual(pl.trash.map((t) => t.name).sort(), ['blog', 'tienda'], 'only the folders with both marks go to the Recycle Bin');
    assert.deepEqual(pl.oldProjects.map((x) => x.name), ['scripts-viejos'], 'a project from before the marks is kept and listed');
    assert.ok(pl.keptProjects.some((x) => x.name === 'externo' && x.why === 'outside'));
    assert.equal(pl.keyKept, false);
    const all = names(pl);
    // every key form, in core and outside
    for (const f of ['clave2.enc', 'clave.enc', 'clave.bin', 'clave.lock', 'clave-anterior.json', 'clave-volver.json', 'clave-nueva.json', 'copia-clave.json', 'clave2.20260101.ilegible.enc']) assert.ok(all.includes(path.join(w.p.data, f)), f);
    for (const f of [`${w.hk}.enc`, `${w.hk}.v2.enc`, `${w.hk}.20260101.enc`, `${w.old}.enc`, `${w.old}.v2.enc`]) assert.ok(all.includes(path.join(w.userData, 'claves', f)), f);
    for (const k of [w.hk, w.old]) assert.ok(all.includes(path.join(w.userData, 'claves', `${k}-secretos`)), `replica ${k}`);
    assert.ok(!all.some((x) => /otro-orb/.test(x)), 'another workspace\'s key is never planned');
    assert.ok(!all.some((x) => /interfaz\.json/.test(x)), 'the rest of the app data folder is the installer\'s business');
    // the vault goes before the key, the key last of the stages
    const last = (stage) => stages.lastIndexOf(stage);
    assert.ok(last('vault') < stages.indexOf('key') && last('data') < stages.indexOf('vault'));
    // the backup files of this Orb, in both folders, and nothing of the folder itself
    assert.equal(pl.items.filter((i) => i.kind === 'backup').length, 2);
    assert.ok(!all.includes(w.folder), 'the folder the user chose is never in the plan');
    // every path the plan holds is something Orb owns
    for (const i of pl.items.filter((x) => x.kind !== 'project' && x.kind !== 'db' && x.kind !== 'refs')) assert.ok(U.classify(w.env(), i.path), i.path);
  } finally { w.close(); w.cleanup(); }
});

test('the plan keeps what the boxes say, and the PC key stays while anything encrypted does', async () => {
  const w = await world();
  try {
    const onlyProjects = await plan(w, { keep: keepOf(SHORTCUTS.projects) });
    assert.equal(onlyProjects.trash.length, 0);
    assert.ok(names(onlyProjects).includes(w.p.secrets) && onlyProjects.keyKept === false);
    const keepAll = await plan(w, { keep: keepOf(SHORTCUTS.all) });
    assert.deepEqual(keepAll.items, [], 'keeping everything deletes nothing');
    assert.equal(keepAll.keyKept, true);
    const vaultOnly = await plan(w, { keep: keepOf(['vault']) });
    assert.ok(!names(vaultOnly).includes(w.p.secrets) && vaultOnly.keyKept === true);
    assert.ok(!vaultOnly.items.some((i) => i.stage === 'key'), 'no key file is planned while the vault stays');
    const link = await plan(w, { keep: keepOf(['link']) });
    assert.equal(link.keep.vault, true); assert.deepEqual(link.forced, { vault: 'link' });
    const withCopy = await plan(w, { keep: keepOf([]), copyFirst: true });
    assert.equal(withCopy.keep.backups, true);
    assert.equal(withCopy.items.filter((i) => i.kind === 'backup').length, 0);
    const reset = await plan(w, { mode: 'reset', keep: keepOf([]) });
    assert.equal(reset.keep.projects, true); assert.equal(reset.trash.length, 0);
    assert.ok(!reset.items.some((i) => i.path && /ubicacion\.json/.test(i.path)), 'reset keeps the saved location');
  } finally { w.close(); w.cleanup(); }
});

test('a project too big for the Recycle Bin stays unless the user agrees to delete it for good', async () => {
  const w = await world();
  try {
    const kept = await plan(w, { keep: keepOf([]), trashLimit: 5 });
    assert.deepEqual(kept.trash, [], 'both are over the limit: listed apart and kept');
    assert.ok(kept.keptProjects.filter((x) => x.why === 'big').length === 2);
    const agreed = await plan(w, { keep: keepOf([]), trashLimit: 5, forever: ['tienda'] });
    assert.deepEqual(agreed.trash.map((t) => [t.name, t.forever]), [['tienda', true]]);
    assert.ok(agreed.keptProjects.some((x) => x.name === 'blog' && x.why === 'big'));
  } finally { w.close(); w.cleanup(); }
});

test('«Borrar todo» run: order, nothing comes back on restart, old projects and the chosen backups folder stay', async () => {
  const w = await world({ customFolder: true });
  try {
    const pl = await plan(w, { keep: keepOf([]) });
    const steps = [];
    const hooks = { onStep: (j) => { for (const i of j.items) if (i.state === 'done' && !steps.includes(i.id)) steps.push(i.id); } };
    const { r, b } = await runIt(w, pl, { hooks });
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    // the projects went to the Recycle Bin (moved aside), the old ones and the outside one are untouched
    assert.deepEqual(b.moved.sort(), ['blog', 'tienda']);
    assert.ok(fs.existsSync(w.oldFolder) && fs.existsSync(path.join(w.outside, 'k.txt')));
    // the order the items were done in is the plan's stage order
    const stageOf = (id) => pl.items.find((i) => i.id === id).stage;
    const seq = steps.map(stageOf);
    assert.deepEqual(seq, [...seq].sort((x, y) => ['projects', 'data', 'vault', 'key', 'end'].indexOf(x) - ['projects', 'data', 'vault', 'key', 'end'].indexOf(y)));
    // the folder the user chose stays; the copy of this Orb in it is gone; another Orb's file would stay
    assert.ok(fs.existsSync(w.folder) && !fs.readdirSync(w.folder).some((n) => n.endsWith('.orbbak')));
    // nothing of the keys is left outside, but another workspace's key is
    assert.deepEqual(fs.readdirSync(path.join(w.userData, 'claves')), ['otro-orb-1234abcd.v2.enc']);
    assert.ok(!fs.existsSync(path.join(w.userData, 'ubicacion.json')) && fs.existsSync(path.join(w.userData, 'interfaz.json')));
    // a healthy core remains (old projects stay), with no chats, devices or settings of before
    assert.equal(coreHealth(w.home).ok, true);
    assert.ok(!fs.existsSync(w.p.secrets) && !fs.existsSync(path.join(w.p.data, 'clave2.enc')) && !fs.existsSync(w.p.copies));
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(w.p.db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM devices').get().n, 0);
    assert.deepEqual(db.prepare('SELECT name FROM projects ORDER BY name').all().map((x) => x.name), ['externo', 'scripts-viejos']);
    db.close();
    // restart: neither the vault's replica nor a backup can bring anything back
    assert.deepEqual(restoreMissing(w.p.secrets, secretsCopy(w.userData, w.home)), []);
    assert.deepEqual(await K.listBackups(K.defaultBackupDir(w.home)), []);
    const repair = await K.repairCore(w.home, { secret: w.secret });
    assert.deepEqual(repair, { ok: true, missing: [] });
    assert.ok(!fs.existsSync(w.p.secrets) && !fs.existsSync(path.join(w.p.data, 'clave2.enc')), 'restart restored nothing');
    assert.equal(fs.existsSync(path.join(w.userData, 'desinstalando.json')), true, 'the journal is closed by the caller');
  } finally { w.close(); w.cleanup(); }
});

test('with no old project and everything deleted, nothing of the workspace is left but what holds content', async () => {
  const w = await world({ backups: false });
  try {
    for (const n of ['scripts-viejos', 'externo']) w.board.removeProject(n, 'usuario');
    const pl = await plan(w, { keep: keepOf([]) });
    assert.equal(pl.wipeDb, true);
    const { r } = await runIt(w, pl);
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    assert.ok(fs.existsSync(w.oldFolder), 'a folder with files in a category keeps its category and the workspace');
    assert.ok(!fs.existsSync(w.p.core), 'core is gone');
    assert.deepEqual(fs.readdirSync(w.home).sort(), ['linux'], 'only the category holding the old folder is left');
  } finally { w.close(); w.cleanup(); }
});

test('«Conservar solo los proyectos» and «Conservar todo»: after a restart nothing is restored and nothing more is deleted', async () => {
  for (const shortcut of ['projects', 'all']) {
    const w = await world();
    try {
      const pl = await plan(w, { keep: keepOf(SHORTCUTS[shortcut]) });
      w.close();
      const before = tree(w.p.core);
      const { r } = await runIt(w, pl);
      assert.equal(r.ok, true, JSON.stringify(r.failed));
      if (shortcut === 'all') { assert.deepEqual(tree(w.p.core), before); assert.ok(fs.existsSync(path.join(w.userData, 'ubicacion.json'))); }
      else {
        assert.ok(fs.existsSync(w.mine.path) && fs.existsSync(w.second.path), 'the projects stay');
        assert.ok(!fs.existsSync(path.join(w.userData, 'ubicacion.json')));
      }
      assert.equal(coreHealth(w.home).ok, true);
      const after = tree(w.p.core);
      assert.deepEqual(restoreMissing(w.p.secrets, secretsCopy(w.userData, w.home)), []);
      const repair = await K.repairCore(w.home, { secret: w.secret });
      assert.equal(repair.ok, true); assert.equal(repair.restored, undefined);
      assert.deepEqual(tree(w.p.core), after, `${shortcut}: restart changed core`);
    } finally { w.close(); w.cleanup(); }
  }
});

test('reset: keeps the saved location and the projects, writes the mark and a healthy core, restores nothing', async () => {
  const w = await world();
  try {
    const pl = await plan(w, { mode: 'reset', keep: keepOf([]) });
    const { r } = await runIt(w, pl);
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    assert.ok(fs.existsSync(path.join(w.userData, 'ubicacion.json')), 'ubicacion.json stays');
    assert.ok(fs.existsSync(path.join(w.p.core, U.RESET_MARK)), 'the «restablecido» mark');
    const cfg = JSON.parse(fs.readFileSync(w.p.config, 'utf8'));
    assert.equal(cfg.setupPending, true);
    assert.ok(fs.existsSync(w.mine.path) && fs.existsSync(w.oldFolder));
    assert.equal(coreHealth(w.home).ok, true);
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(w.p.db);
    assert.deepEqual(db.prepare('SELECT name FROM projects ORDER BY name').all().map((x) => x.name), ['blog', 'externo', 'scripts-viejos', 'tienda']);
    db.close();
    const after = tree(w.p.core);
    assert.deepEqual(restoreMissing(w.p.secrets, secretsCopy(w.userData, w.home)), []);
    const repair = await K.repairCore(w.home, { secret: w.secret });
    assert.equal(repair.ok, true); assert.equal(repair.restored, undefined);
    assert.deepEqual(tree(w.p.core), after);
  } finally { w.close(); w.cleanup(); }
});

test('links and junctions are never followed: the folder they point to keeps everything', async () => {
  const w = await world();
  try {
    const target = path.join(w.base, 'ajena'); put(path.join(target, 'importante.txt'), 'mio');
    // a junction as an item (core\skills itself) and one inside a tree being deleted (core\mcp\srv\enlace)
    fs.rmSync(w.p.skills, { recursive: true, force: true });
    fs.symlinkSync(target, w.p.skills, 'junction');
    fs.symlinkSync(target, path.join(w.p.mcp, 'srv', 'enlace'), 'junction');
    const pl = await plan(w, { keep: keepOf([]) });
    assert.ok(pl.skipped.some((s) => s.path === w.p.skills && s.why === 'link'), 'the linked skills folder is skipped and said');
    assert.ok(!names(pl).includes(w.p.skills));
    const { r } = await runIt(w, pl);
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    assert.equal(fs.readFileSync(path.join(target, 'importante.txt'), 'utf8'), 'mio', 'the target of the links is intact');
    assert.ok(fs.lstatSync(w.p.skills).isSymbolicLink(), 'the link itself stays (it was not Orb\'s to remove)');
    // a project whose category folder is a junction is not Orb's to delete
    const w2 = await world();
    try {
      const real = path.join(w2.base, 'otra-web'); fs.mkdirSync(path.join(real, 'x'), { recursive: true });
      fs.rmSync(path.join(w2.home, 'multi'), { recursive: true, force: true });
      fs.symlinkSync(real, path.join(w2.home, 'multi'), 'junction');
      const row = { name: 'x', path: path.join(w2.home, 'multi', 'x'), created_by_orb: 'a'.repeat(32) };
      fs.writeFileSync(path.join(row.path, MARK_FILE), `${row.created_by_orb}\n`);
      assert.equal(U.ownedProject(w2.env(), row).ok, false);
    } finally { w2.close(); w2.cleanup(); }
  } finally { w.close(); w.cleanup(); }
});

test('only folders with BOTH marks, two levels deep, are Orb\'s to trash', async () => {
  const w = await world();
  try {
    const env = w.env();
    const row = w.board.project('tienda');
    assert.equal(U.ownedProject(env, row).ok, true);
    assert.equal(U.ownedProject(env, { ...row, created_by_orb: null }).why, 'unmarked', 'no token in the database');
    fs.rmSync(path.join(row.path, MARK_FILE));
    assert.equal(U.ownedProject(env, row).why, 'unmarked', 'no mark file');
    fs.writeFileSync(path.join(row.path, MARK_FILE), `${'b'.repeat(32)}\n`);
    assert.equal(U.ownedProject(env, row).why, 'unmarked', 'another token');
    // deeper, or the category itself, or the workspace: never
    const deep = path.join(row.path, 'sub'); fs.mkdirSync(deep); fs.writeFileSync(path.join(deep, MARK_FILE), `${row.created_by_orb}\n`);
    assert.equal(U.ownedProject(env, { ...row, path: deep }).ok, false);
    assert.equal(U.ownedProject(env, { ...row, path: path.join(w.home, 'web') }).ok, false);
    assert.equal(U.ownedProject(env, { ...row, path: w.home }).ok, false);
    assert.equal(U.ownedProject(env, { ...row, path: w.p.core }).ok, false);
    // the plan keeps the one with a wrong mark
    const pl = await plan(w, { keep: keepOf([]) });
    assert.ok(!pl.trash.some((t) => t.name === 'tienda') && pl.keptProjects.some((x) => x.name === 'tienda' && x.why === 'old'));
    // a link as the project's mark file does not count either
    const other = w.board.project('blog');
    fs.rmSync(path.join(other.path, MARK_FILE));
    const real = path.join(w.base, 'real-mark'); fs.writeFileSync(real, `${other.created_by_orb}\n`);
    try { fs.symlinkSync(real, path.join(other.path, MARK_FILE), 'file'); assert.equal(U.ownedProject(env, other).why, 'unmarked'); } catch { /* no symlink right on this PC */ }
  } finally { w.close(); w.cleanup(); }
});

test('a path outside what Orb owns is refused when it is run, whatever the journal says', async () => {
  const w = await world();
  try {
    const victim = path.join(w.base, 'datos-de-otro'); put(path.join(victim, 'a.txt'));
    const pl = await plan(w, { keep: keepOf(SHORTCUTS.all) });
    pl.items.push({ id: 'x1', stage: 'data', kind: 'path', box: 'chats', path: victim, bytes: 1, files: 1 });
    pl.items.push({ id: 'x2', stage: 'data', kind: 'path', box: 'chats', path: path.join(w.userData, 'interfaz.json'), bytes: 1, files: 1 });
    pl.items.push({ id: 'x3', stage: 'data', kind: 'path', box: 'chats', path: w.home, bytes: 1, files: 1 });
    pl.items.push({ id: 'x4', stage: 'data', kind: 'path', box: 'chats', path: path.join(w.userData, 'claves', 'otro-orb-1234abcd.v2.enc'), bytes: 1, files: 1 });
    const { r } = await runIt(w, pl);
    assert.equal(r.ok, false); assert.equal(r.failed[0].code, 'EALLOW');
    assert.ok(fs.existsSync(path.join(victim, 'a.txt')) && fs.existsSync(path.join(w.userData, 'interfaz.json')));
    // the others after it were not run
    assert.ok(fs.existsSync(path.join(w.userData, 'claves', 'otro-orb-1234abcd.v2.enc')) && fs.existsSync(w.p.core));
  } finally { w.close(); w.cleanup(); }
});

test('a backup file of another Orb in the same folder is never deleted, and a damaged one neither', async () => {
  const w = await world({ customFolder: true });
  try {
    const alien = path.join(w.folder, 'orb-ajena-manual.orbbak');
    // another workspace's copy: made from another home, same folder
    const t2 = (await import('./helpers.mjs')).tempHome();
    const { useHome } = await import('../src/platform/context.mjs');
    const { file } = await K.createBackup({ home: t2.home, secret: w.secret, kind: 'manual', version: 'test', folder: w.folder });
    fs.renameSync(file, alien);
    useHome(w.home);
    fs.writeFileSync(path.join(w.folder, 'rota.orbbak'), 'no es una copia');
    const pl = await plan(w, { keep: keepOf([]) });
    const { r } = await runIt(w, pl);
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    assert.deepEqual(fs.readdirSync(w.folder).sort(), ['orb-ajena-manual.orbbak', 'rota.orbbak']);
    t2.cleanup();
  } finally { w.close(); w.cleanup(); }
});

test('a failure half-way stops, says what went and what did not, and the journal lets the next start finish', async () => {
  const w = await world();
  try {
    const pl = await plan(w, { keep: keepOf([]) });
    let calls = 0;
    const b = bin(w);
    const trash = async (p, token, name) => { calls++; if (calls === 2) return { ok: false, locked: true }; return b.trash(p, token, name); };
    const { r } = await runIt(w, pl, { hooks: { trash } });
    assert.equal(r.ok, false);
    assert.equal(r.failed.length, 1); assert.equal(r.failed[0].code, 'EBUSY');
    assert.equal(r.done.length, 1, 'one project went before the stop');
    assert.ok(r.pending.length > 3, 'the rest is pending and untouched');
    assert.ok(fs.existsSync(w.p.secrets) && fs.existsSync(path.join(w.p.data, 'clave2.enc')) && fs.existsSync(w.p.config), 'nothing of the data was deleted');
    const j = U.readJournal(w.userData);
    assert.ok(j && j.items.some((i) => i.state === 'failed'));
    // the next start: the engine is not running, so the Recycle Bin is not there; the rest is finished and the project is reported
    w.close();
    // a failure that was reported stops for good: the next start does not run it again by itself
    const held = await U.resumeJournal({ userData: w.userData, signKey: w.signKey });
    assert.equal(held.stopped, true); assert.equal(held.ok, false);
    assert.ok(fs.existsSync(w.p.secrets) && fs.existsSync(path.join(w.p.data, 'clave2.enc')), 'nothing was deleted by the start');
    assert.equal(U.confirmResume(w.userData, crypto.randomBytes(32)), false, 'only with the PC key');
    assert.equal(U.confirmResume(w.userData, w.signKey), true, 'the user said to go on');
    const resumed = await U.resumeJournal({ userData: w.userData, signKey: w.signKey });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.skipped.length, 1, 'the folder that could not go to the Recycle Bin is reported, not deleted');
    const left = [w.mine.path, w.second.path].filter((x) => fs.existsSync(x));
    assert.equal(left.length, 1);
    assert.ok(!fs.existsSync(w.p.secrets) && !fs.existsSync(path.join(w.p.data, 'clave2.enc')));
    assert.equal(U.readJournal(w.userData), null, 'the journal closes when the run is over');
  } finally { w.close(); w.cleanup(); }
});

test('the isolated copies and the branches Orb made in a project that stays go with the chats; the user own branches and worktrees stay', async () => {
  const w = await world({ backups: false });
  try {
    const { git } = await import('../src/platform/git.mjs');
    const repo = path.join(w.home, 'web', 'conrepo'); fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main'); put(path.join(repo, 'a.txt'), 'a');
    git(repo, 'add', '.'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one');
    w.board.addProject({ name: 'conrepo', path: repo }, 'usuario', { fromUser: true });
    const mine = path.join(w.p.chatTrees, 'conrepo-abc'); fs.mkdirSync(w.p.chatTrees, { recursive: true });
    assert.equal(git(repo, 'worktree', 'add', '-q', '-b', 'orb/chat-abc', mine).status, 0);
    put(path.join(mine, 'sin-unir.txt'), 'cambios sin unir'); // a copy with changes not joined
    git(repo, 'branch', 'mi-rama'); // the user's own
    const theirs = path.join(w.base, 'otro-arbol');
    assert.equal(git(repo, 'worktree', 'add', '-q', '-b', 'mi-otra', theirs).status, 0);
    git(repo, 'update-ref', 'refs/orb/turnos/s1/1', 'HEAD');
    const pl = await plan(w, { keep: keepOf(SHORTCUTS.projects) });
    assert.equal(pl.dirty.length, 1); assert.equal(pl.dirty[0].project, 'conrepo', 'the copy with changes is listed');
    assert.ok(pl.items.some((i) => i.kind === 'refs' && i.path === repo));
    const { r } = await runIt(w, pl);
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    const refs = git(repo, "for-each-ref", "--format=%(refname)").stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    assert.ok(!refs.some((x) => x.startsWith('refs/orb/') || x.startsWith('refs/heads/orb/chat-')), refs.join(','));
    assert.ok(refs.includes('refs/heads/mi-rama') && refs.includes('refs/heads/mi-otra') && refs.includes('refs/heads/main'));
    const wt = git(repo, 'worktree', 'list', '--porcelain').stdout;
    assert.ok(!wt.includes('conrepo-abc'), 'the worktree under core copias was pruned');
    assert.ok(wt.toLowerCase().includes('otro-arbol'), "the user's own worktree stays");
    assert.ok(fs.existsSync(path.join(theirs, 'a.txt')) && fs.existsSync(path.join(repo, 'a.txt')));
  } finally { w.close(); w.cleanup(); }
});

test('the database is cleared by box: chats, the link and the projects, and the settings rows that stay', async () => {
  const w = await world();
  try {
    w.close();
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const count = (t) => { const db = new DatabaseSync(w.p.db); try { return db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } finally { db.close(); } };
    const keys = () => { const db = new DatabaseSync(w.p.db); try { return db.prepare('SELECT key FROM settings ORDER BY key').all().map((r) => r.key); } finally { db.close(); } };
    assert.ok(count('conversations') > 0 && count('devices') === 1);
    // the link only: chats go, the phones stay
    U.clearDb(w.p.db, keepOf(['link', 'projects']));
    assert.equal(count('conversations'), 0); assert.equal(count('chat'), 0); assert.equal(count('devices'), 1); assert.equal(count('projects'), 4);
    assert.deepEqual(keys().filter((k) => k !== 'conversations_migrated' && k !== 'notices_migrated'), ['projects_finished'], 'the finished list stays with the projects; the rest of the settings goes with the chats');
    // nothing kept: the phones go too, the projects table is never emptied here (their rows go one by one with their folders)
    U.clearDb(w.p.db, keepOf([]));
    assert.equal(count('devices'), 0); assert.equal(count('projects'), 4);
    assert.equal(U.keepSetting('backup_last', keepOf(['chats'])), false);
    assert.equal(U.keepSetting('backup_last', keepOf(['chats', 'backups'])), true);
    assert.equal(U.keepSetting('remote_keys', keepOf(['chats'])), false);
    assert.equal(U.keepSetting('active_project', keepOf(['chats'])), true);
    assert.equal(U.keepSetting('active_project', keepOf(['projects'])), false);
    assert.equal(U.keepSetting('projects_deleting', keepOf(['chats', 'projects'])), false);
  } finally { w.cleanup(); }
});
