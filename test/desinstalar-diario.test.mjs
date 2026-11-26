// The journal of an uninstall or reset is never trusted as it is on disk: signed with this PC's key, for a workspace the app
// knows, with its own backup folders, and each kind of item may only take the classes that belong to it. Temporary folders only.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { world, put } from './desinstalar-mundo.mjs';
import { BOXES, SHORTCUTS } from '../src/shared/uninstall-boxes.mjs';
import * as U from '../src/domain/data/uninstall.mjs';
import * as K from '../src/domain/data/backup.mjs';

const keepOf = (names) => Object.fromEntries(BOXES.map((b) => [b, names.includes(b)]));
const plan = (w, o = {}) => U.planUninstall({ env: w.env(), projects: w.rows(), devices: 1, ...o });
const run = (w, pl, trash = async () => ({ ok: true })) => U.runPlan({ env: w.env(), plan: pl, hooks: { trash, project: (n) => w.board.project(n), closeDb: () => w.close() } });
const forged = async (w, items, base) => {
  const pl = { ...base };
  pl.items = items.map((i, n) => ({ id: `f${n}`, stage: 'data', box: 'chats', bytes: 1, files: 1, ...i }));
  return run(w, pl);
};

test('each kind of item takes only the classes that belong to it: never the workspace, a category, the keys folder or another database', async () => {
  const w = await world();
  try {
    const base = await plan(w, { keep: keepOf(SHORTCUTS.all) });
    const other = path.join(w.base, 'otra.db'); put(other, 'x');
    const claves = path.join(w.userData, 'claves');
    for (const item of [
      { kind: 'path', path: w.home },
      { kind: 'path', path: path.join(w.home, 'web') },
      { kind: 'path', path: claves },
      { kind: 'path', path: path.join(K.backupRoot(), w.hk) },
      { kind: 'path', path: path.join(claves, 'otro-orb-1234abcd.v2.enc') },
      { kind: 'backup', path: w.p.config, orbId: 'a'.repeat(32) },
      { kind: 'db', path: other, keep: keepOf([]) },
      { kind: 'refs', path: w.base }
    ]) {
      const r = await forged(w, [item], base);
      assert.equal(r.ok, false, item.path);
      assert.equal(r.failed[0].code, 'EALLOW', item.path);
    }
    assert.ok(fs.existsSync(w.home) && fs.existsSync(claves) && fs.existsSync(other) && fs.existsSync(w.p.config));
    // a backup file as a plain path is not allowed either (it must be checked as a backup)
    const copy = await K.createBackup({ home: w.home, secret: w.secret, kind: 'manual', version: 'test' });
    const r = await forged(w, [{ kind: 'path', path: copy.file }], base);
    assert.equal(r.failed[0].code, 'EALLOW'); assert.ok(fs.existsSync(copy.file));
  } finally { w.close(); w.cleanup(); }
});

test('a journal is resumed only if it is signed with this PC key, for a known workspace and with its own backup folders', async () => {
  const w = await world({ backups: false });
  try {
    const pl = await plan(w, { keep: keepOf([]) });
    const r = await run(w, pl, async () => ({ ok: false, locked: true }));
    assert.equal(r.ok, false);
    w.close();
    const file = path.join(w.userData, 'desinstalando.json');
    const good = fs.readFileSync(file, 'utf8');
    const attempt = (key = w.signKey) => U.resumeJournal({ userData: w.userData, signKey: key, confirmed: true });
    const intact = () => fs.existsSync(w.p.secrets) && fs.existsSync(path.join(w.p.data, 'clave2.enc')) && fs.existsSync(w.p.config);
    assert.equal((await attempt(null)).untrusted, 'signature');
    assert.equal((await attempt(crypto.randomBytes(32))).untrusted, 'signature');
    const bare = JSON.parse(good); delete bare.sig;
    fs.writeFileSync(file, JSON.stringify(bare));
    assert.equal((await attempt()).untrusted, 'signature', 'unsigned');
    const edited = JSON.parse(good); edited.items[0].path = w.base;
    fs.writeFileSync(file, JSON.stringify(edited));
    assert.equal((await attempt()).untrusted, 'signature', 'changed after signing');
    assert.ok(intact() && fs.existsSync(w.base));
    const sign = (o) => { const rest = { ...o }; delete rest.sig; return { ...rest, sig: crypto.createHmac('sha256', w.signKey).update(JSON.stringify(rest)).digest('hex') }; };
    const stranger = path.join(w.base, 'ajena'); put(path.join(stranger, 'core', 'datos', 'x.txt'));
    fs.writeFileSync(file, JSON.stringify(sign({ ...bare, home: stranger })));
    assert.equal((await attempt()).untrusted, 'home');
    assert.ok(fs.existsSync(path.join(stranger, 'core', 'datos', 'x.txt')));
    // a backup file outside the folders the journal was signed with is refused
    const fake = path.join(w.base, 'inventada'); fs.mkdirSync(fake);
    const made = (await K.createBackup({ home: w.home, secret: w.secret, kind: 'manual', version: 'test' })).file;
    const copy = path.join(fake, path.basename(made)); fs.copyFileSync(made, copy); // a folder ultima.json never heard of
    const item = { id: 'z', stage: 'data', kind: 'backup', box: 'backups', path: copy, bytes: 1, files: 1, orbId: K.knownOrbId(w.home), state: 'pending' };
    fs.writeFileSync(file, JSON.stringify(sign({ ...bare, backupDirs: [], items: [item] })));
    const refused = await attempt();
    assert.equal(refused.ok, false); assert.equal(refused.failed[0].code, 'EALLOW'); assert.ok(fs.existsSync(copy));
    // the real one still goes
    fs.writeFileSync(file, good);
    const done = await attempt();
    assert.equal(done.ok, true, JSON.stringify(done));
  } finally { w.close(); w.cleanup(); }
});

test('a project too big for the Recycle Bin that the user agreed to delete for good is asked with «forever»; the others are not', async () => {
  const w = await world({ backups: false });
  try {
    const pl = await plan(w, { keep: keepOf([]), trashLimit: 5, forever: ['tienda'] });
    const seen = [];
    const r = await run(w, pl, async (p, token, name, forever) => { seen.push([name, forever]); return { ok: true }; });
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    assert.deepEqual(seen, [['tienda', true]]);
  } finally { w.close(); w.cleanup(); }
});

test('an old vault aside (anterior-*, antes-de-restaurar-*) that is kept keeps the PC key; deleted, it goes with it', async () => {
  const w = await world({ backups: false });
  try {
    put(path.join(w.p.core, 'anterior-2026-01-01', 'secretos', 'maestra.json'));
    const kept = await plan(w, { keep: keepOf(['chats']) });
    assert.equal(kept.keyKept, true); assert.ok(!kept.items.some((i) => i.stage === 'key'));
    const gone = await plan(w, { keep: keepOf([]) });
    assert.equal(gone.keyKept, false); assert.ok(gone.items.some((i) => i.stage === 'key'));
    assert.ok(gone.items.some((i) => i.path === path.join(w.p.core, 'anterior-2026-01-01')));
  } finally { w.close(); w.cleanup(); }
});
