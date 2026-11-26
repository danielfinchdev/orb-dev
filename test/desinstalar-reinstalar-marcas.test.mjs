// «Empezar de cero»: the projects Orb made keep their mark through it (their rows go to the new core), and it works when the
// workspace folder itself is a junction. Temporary folders only.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { world } from './desinstalar-mundo.mjs';
import { startEngine } from './helpers.mjs';
import { startFresh } from '../src/engine/previous.mjs';
import { ownedProject, uninstallEnv, KEPT_PROJECTS } from '../src/domain/data/uninstall.mjs';

test('the projects Orb made are still Orb\'s after «Empezar de cero»; the others are found again unmarked', async () => {
  const w = await world({ backups: false }); w.close();
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    await startFresh({ userData: w.userData, home: w.home });
    const note = JSON.parse(fs.readFileSync(path.join(w.p.core, KEPT_PROJECTS), 'utf8'));
    assert.deepEqual(note.projects.map((p) => p.name).sort(), ['blog', 'tienda']);
    const e = await startEngine(w.home, { secret, userData: w.userData });
    try { await e.call('projects.list', {}); } finally { await e.stop(); }
    assert.ok(!fs.existsSync(path.join(w.p.core, KEPT_PROJECTS)), 'the note is used once');
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(w.p.db, { readOnly: true });
    const rows = db.prepare('SELECT name, path, created_by_orb FROM projects').all(); db.close();
    const env = uninstallEnv({ home: w.home, userData: w.userData, config: {} });
    for (const name of ['tienda', 'blog']) assert.equal(ownedProject(env, rows.find((r) => r.name === name)).ok, true, `${name} still counts as made by Orb`);
    assert.equal(rows.find((r) => r.name === 'scripts-viejos').created_by_orb, null);
    assert.ok(!rows.some((r) => r.name === 'externo'), 'a folder outside the workspace is not brought back');
  } finally { w.cleanup(); }
});

test('«Empezar de cero» works when the workspace folder is a junction', async () => {
  const w = await world({ backups: false, vault: false }); w.close();
  try {
    const link = path.join(w.base, 'enlace-a-orb');
    fs.symlinkSync(w.home, link, 'junction');
    fs.writeFileSync(path.join(w.userData, 'desinstalado.json'), '{}');
    const r = await startFresh({ userData: w.userData, home: link });
    assert.ok(fs.existsSync(path.join(r.aside, 'orb.json')), 'what was there went aside');
    assert.ok(fs.existsSync(path.join(w.home, 'core', 'orb.json')), 'a new core where the link points');
  } finally { w.cleanup(); }
});
