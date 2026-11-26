// A delete stopped halfway, through the real engine: the next start restores nothing (no replica, no backup), says the delete
// is stopped, and a resumed «Borrar todo» ends at the uninstaller instead of at the «core missing» screen.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { world } from './desinstalar-mundo.mjs';
import { startEngine, until, wait } from './helpers.mjs';
import { keysOf } from '../src/platform/keys.mjs';
import * as U from '../src/domain/data/uninstall.mjs';
import { BOXES } from '../src/shared/uninstall-boxes.mjs';

const keepNothing = Object.fromEntries(BOXES.map((b) => [b, false]));
const hex = () => crypto.randomBytes(32).toString('hex');
const host = async (method) => { if (method === 'host.uninstallCheck') return { ready: true }; throw new Error(`host: ${method}`); };

// What the engine's run does, with a break between the plan and the run (the plan id would change inside the engine): signed
// as the engine will sign it (the PC's approval key) and stopped the way api/uninstall.mjs does, with the minimal core written.
async function stopped(w, secret, sabotage, box) {
  const signKey = keysOf(Buffer.from(secret, 'hex')).approval;
  const env = U.uninstallEnv({ home: w.home, userData: w.userData, config: w.env().config, signKey });
  const plan = await U.planUninstall({ env, mode: 'uninstall', keep: keepNothing, projects: [], devices: 0 });
  sabotage();
  const r = await U.runPlan({ env, plan, hooks: { closeDb: () => w.close() } });
  assert.equal(r.ok, false); assert.equal(r.failed[0].box, box);
  assert.ok(!fs.existsSync(w.p.config), 'the settings of core were already deleted');
  await U.stubCoreAfterStop(env, plan);
  assert.ok(fs.existsSync(path.join(w.userData, 'desinstalando.json')), 'the journal waits');
}
const replicaOf = (w) => path.join(w.userData, 'claves', `${w.hk}-secretos`);
// The replica path becomes a junction: the delete refuses it (not a plain folder) and the replica's content is a bait for a restore.
const junctionReplica = (w) => {
  const bait = path.join(w.base, 'bait'); fs.mkdirSync(bait, { recursive: true }); fs.writeFileSync(path.join(bait, 'maestra.json'), '{"bait":1}');
  fs.rmSync(replicaOf(w), { recursive: true, force: true });
  fs.symlinkSync(bait, replicaOf(w), 'junction');
};
const unjunction = (w) => fs.rmdirSync(replicaOf(w));

for (const stage of ['data', 'vault']) {
  test(`a delete that failed in the ${stage} stage: the next start restores nothing and says it is stopped`, async () => {
    const w = await world(); w.close();
    const secret = hex();
    if (stage === 'data') await stopped(w, secret, () => fs.writeFileSync(w.made[0], 'not a backup'), 'backups'); else await stopped(w, secret, () => junctionReplica(w), 'vault');
    assert.equal(fs.existsSync(path.join(w.p.config)), true, 'a healthy core is there');
    const e = await startEngine(w.home, { secret, userData: w.userData });
    try {
      const pending = await e.call('uninstall.pending', {});
      assert.equal(pending.state, 'stopped');
      assert.deepEqual(await e.call('app.coreState', {}), null, 'no «core missing» screen');
      assert.ok(!e.events.some((x) => x.event === 'core:lost'));
      const notices = e.events.filter((x) => x.event === 'notice').map((x) => x.payload?.body ?? '').join('|');
      assert.ok(!/restaur|restored|copia/i.test(notices), notices);
      assert.equal((await e.call('conversations.list', {})).length, 0, 'no chat came back from a backup');
    } finally { await e.stop(); }
    if (stage === 'vault') assert.ok(!fs.existsSync(path.join(w.p.secrets, 'maestra.json')), 'the vault was not put back from its replica');
    assert.ok(fs.existsSync(path.join(w.userData, 'desinstalando.json')));
    w.cleanup();
  });
}

test('a «Borrar todo» that stopped and is resumed ends at the uninstaller with a new code', async () => {
  const w = await world({ backups: false }); w.close();
  const secret = hex();
  await stopped(w, secret, () => junctionReplica(w), 'vault');
  let e = await startEngine(w.home, { secret, userData: w.userData });
  let code = null;
  try {
    assert.equal((await e.call('uninstall.pending', {})).state, 'stopped');
    unjunction(w);
    assert.deepEqual(await e.call('uninstall.resume', {}), { ok: true });
    code = await Promise.race([e.exited, wait(10000).then(() => null)]);
  } finally { if (code !== 75) await e.stop(); }
  e = await startEngine(w.home, { secret, userData: w.userData });
  try {
    const st = await e.call('app.coreState', {});
    assert.equal(st.uninstalled, true); assert.match(st.code, /^[0-9a-f]{32}$/);
    await until(async () => !fs.existsSync(path.join(w.userData, 'desinstalando.json')), 'journal closed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(w.userData, 'desinstalado.json'), 'utf8')).code, st.code, 'the mark carries the code');
    assert.ok(!fs.existsSync(w.p.config) && !fs.existsSync(path.join(w.p.secrets, 'maestra.json')), 'nothing was brought back');
  } finally { await e.stop(); }
  w.cleanup();
});
