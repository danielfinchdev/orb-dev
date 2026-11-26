// Second round on the uninstall journal: the saved location stays while anything stays, a run that died after the PC key went is
// closed, the journal keeps the folders of copies it was signed with, and a stopped run has its way out in the window's calls.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { world } from './desinstalar-mundo.mjs';
import { startEngine, until, wait } from './helpers.mjs';
import { BOXES } from '../src/shared/uninstall-boxes.mjs';
import * as U from '../src/domain/data/uninstall.mjs';

const keepOf = (names) => Object.fromEntries(BOXES.map((b) => [b, names.includes(b)]));
const plan = (w, o = {}) => U.planUninstall({ env: w.env(), projects: w.rows(), devices: 0, ...o });
const hasLocation = (pl) => pl.items.some((i) => i.path && path.basename(i.path) === 'ubicacion.json');
const bin = { trash: async () => ({ ok: true }) };

test('the saved location goes only when nothing stays: no box, no project (old ones included); a reset keeps it', async () => {
  const w = await world({ backups: false });
  try {
    assert.equal(hasLocation(await plan(w, { keep: keepOf([]) })), false, 'an old project stays');
    assert.equal(hasLocation(await plan(w, { keep: keepOf(['projects']) })), false);
    assert.equal(hasLocation(await plan(w, { keep: keepOf(['chats', 'vault']) })), false);
    assert.equal(hasLocation(await plan(w, { mode: 'reset', keep: keepOf([]) })), false);
    for (const n of ['scripts-viejos', 'externo']) w.board.removeProject(n, 'usuario');
    assert.equal(hasLocation(await plan(w, { keep: keepOf([]) })), true, 'nothing at all stays');
    assert.equal(hasLocation(await plan(w, { keep: keepOf(['journals']) })), false);
    assert.equal(hasLocation(await plan(w, { mode: 'reset', keep: keepOf([]) })), false);
  } finally { w.close(); w.cleanup(); }
});

const crashAfter = (when) => { let n = 0; return (j) => { if (when(j, ++n)) throw new Error('el proceso murió'); }; };

test('a run that died after the PC key went, with only its last step left, is closed; with anything else left it is not', async () => {
  const w = await world({ backups: false });
  try {
    for (const n of ['scripts-viejos', 'externo']) w.board.removeProject(n, 'usuario');
    const pl = await plan(w, { keep: keepOf([]) });
    assert.ok(pl.items.some((i) => i.stage === 'end'));
    await assert.rejects(U.runPlan({ env: w.env(), plan: pl, hooks: { ...bin, project: (n) => w.board.project(n), closeDb: () => w.close(), onStep: crashAfter((j) => j.items.filter((i) => i.stage === 'key').every((i) => i.state === 'done') && j.items.some((i) => i.stage === 'end' && i.state === 'pending')) } }), /murió/);
    assert.ok(!fs.existsSync(path.join(w.p.data, 'clave2.enc')), 'the key went');
    const newKey = crypto.randomBytes(32); // the next start has another key: the signature cannot open
    const r = await U.resumeJournal({ userData: w.userData, signKey: newKey });
    assert.equal(r.ok, true); assert.equal(r.closed, true);
    assert.equal(U.readJournal(w.userData), null, 'the journal is closed');
  } finally { w.close(); w.cleanup(); }
  const v = await world({ backups: false });
  try {
    const pl = await plan(v, { keep: keepOf([]) });
    await assert.rejects(U.runPlan({ env: v.env(), plan: pl, hooks: { ...bin, project: (n) => v.board.project(n), closeDb: () => v.close(), onStep: crashAfter((j, n) => n === 1) } }), /murió/);
    const r = await U.resumeJournal({ userData: v.userData, signKey: crypto.randomBytes(32) });
    assert.equal(r.untrusted, 'signature'); assert.ok(U.readJournal(v.userData), 'something else is left: it stays for the window to ask');
    assert.equal(U.pendingJournal(v.userData, crypto.randomBytes(32)).state, 'untrusted');
    assert.equal(U.pendingJournal(v.userData, v.signKey).state, 'running');
  } finally { v.close(); v.cleanup(); }
});

test('the journal keeps the folders of copies and the orbId from the start: a resume works with ultima.json and orb.json gone', async () => {
  const w = await world({ customFolder: true });
  try {
    const pl = await plan(w, { keep: keepOf([]) });
    assert.match(pl.orbId, /^[0-9a-f]{32}$/);
    let seen = false;
    await assert.rejects(U.runPlan({ env: w.env(), plan: pl, hooks: { ...bin, project: (n) => w.board.project(n), closeDb: () => w.close(), onStep: crashAfter((j) => (seen = j.items.some((i) => i.stage === 'data' && i.state === 'done'))) } }), /murió/);
    assert.ok(seen);
    const j = U.readJournal(w.userData);
    assert.equal(j.orbId, pl.orbId); assert.ok(j.backupDirs.some((d) => d.toLowerCase() === w.folder.toLowerCase()));
    // what the next start can no longer read
    fs.rmSync(path.join(w.p.core, 'orb.json'), { force: true });
    for (const d of j.backupDirs) fs.rmSync(path.join(d, 'ultima.json'), { force: true });
    const r = await U.resumeJournal({ userData: w.userData, signKey: w.signKey });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!fs.readdirSync(w.folder).some((n) => n.endsWith('.orbbak')), 'its copy in the chosen folder went');
  } finally { w.close(); w.cleanup(); }
});

test('through the engine: a stopped run is offered, «Dejarlo así» closes it and nothing more is deleted', async () => {
  const w = await world({ backups: false, vault: false }); w.close();
  const secret = crypto.randomBytes(32).toString('hex');
  const host = async (method, params) => {
    if (method === 'host.uninstallCheck') return { ready: true };
    if (method === 'host.trashFolder') return path.basename(params.path) === 'blog' ? { ok: false, noTrash: true } : (fs.renameSync(params.path, path.join(w.base, `papelera-${path.basename(params.path)}`)), { ok: true });
    throw new Error(method);
  };
  let e = await startEngine(w.home, { secret, userData: w.userData, host });
  let gone = false;
  try {
    const keep = keepOf([]);
    const plan1 = await e.call('uninstall.plan', { mode: 'uninstall', keep });
    const r = await e.call('uninstall.run', { mode: 'uninstall', keep, planId: plan1.id, typed: 'BORRAR' });
    assert.equal(r.ok, false);
    await Promise.race([e.exited, wait(10000)]); gone = true;
  } finally { if (!gone) await e.stop(); }
  e = await startEngine(w.home, { secret, userData: w.userData });
  try {
    const p = await e.call('uninstall.pending', {});
    assert.equal(p.state, 'stopped'); assert.ok(p.left > 0);
    assert.deepEqual(await e.call('uninstall.discard', {}), { ok: true });
    assert.deepEqual(await e.call('uninstall.pending', {}), { state: null });
    await assert.rejects(e.call('uninstall.discard', {}), /./, 'nothing waits any more');
    assert.ok(fs.existsSync(path.join(w.p.data, 'clave2.enc')), 'nothing more was deleted');
    void until;
  } finally { await e.stop(); }
  w.cleanup();
});
