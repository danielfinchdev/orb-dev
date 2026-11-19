// Network git run by the engine never executes a transport command written in the repository's own config.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncPlan, syncRun, push, safeNetArgs } from '../src/engine/host/github.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-gitred-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const fwd = (p) => p.replaceAll(path.sep, '/');

function repos(tag) {
  const bare = path.join(root, `${tag}.git`); const work = path.join(root, tag); const other = path.join(root, `${tag}-other`);
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  for (const d of [work, other]) { fs.mkdirSync(d); git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't'); git(d, 'remote', 'add', 'origin', fwd(bare)); }
  fs.writeFileSync(path.join(work, 'a.txt'), '1'); git(work, 'add', '.'); git(work, 'commit', '-qm', 'one'); git(work, 'push', '-q', 'origin', 'main');
  return { bare, work, other };
}

test('safeNetArgs puts the pack option on the right subcommands', () => {
  assert.deepEqual(safeNetArgs('fetch', 'origin'), ['-c', 'protocol.ext.allow=never', 'fetch', '--upload-pack=git-upload-pack', 'origin']);
  assert.ok(safeNetArgs('push', '-u', 'origin', 'b').includes('--receive-pack=git-receive-pack'));
  assert.ok(safeNetArgs('clone', '--', 'u', 'f').indexOf('--upload-pack=git-upload-pack') < safeNetArgs('clone', '--', 'u', 'f').indexOf('--'));
});

test('sync and push still work against a local remote', async () => {
  const { bare, work, other } = repos('ok');
  git(other, 'fetch', '-q', 'origin'); git(other, 'checkout', '-q', '-b', 'main', 'origin/main');
  fs.writeFileSync(path.join(other, 'b.txt'), '2'); git(other, 'add', '.'); git(other, 'commit', '-qm', 'two'); git(other, 'push', '-q', 'origin', 'main');
  const plan = await syncPlan({ path: work });
  assert.equal(plan.state, 'ready'); assert.equal(plan.behind, 1);
  const out = await syncRun({ path: work }, { expect: { behind: 1, ahead: 0 } });
  assert.equal(out.pulled, 1);
  fs.writeFileSync(path.join(work, 'c.txt'), '3'); git(work, 'add', '.'); git(work, 'commit', '-qm', 'three');
  await push({ path: work }, 'main');
  assert.equal(git(bare, 'rev-list', '--count', 'main').stdout.trim(), '3');
});

test('a transport command in the repository config is not run', async () => {
  const { work, other } = repos('evil');
  const witness = path.join(root, 'witness.txt');
  const cmd = `echo x > "${fwd(witness)}"`;
  // control: plain git does run it, so the check below is not vacuous
  git(other, 'config', 'remote.origin.uploadpack', cmd); git(other, 'ls-remote', 'origin');
  assert.ok(fs.existsSync(witness), 'plain git must run the configured command');
  fs.rmSync(witness);
  git(work, 'config', 'remote.origin.uploadpack', cmd); git(work, 'config', 'remote.origin.receivepack', cmd);
  const plan = await syncPlan({ path: work });
  assert.equal(plan.state, 'upToDate');
  fs.writeFileSync(path.join(work, 'd.txt'), '4'); git(work, 'add', '.'); git(work, 'commit', '-qm', 'four');
  await push({ path: work }, 'main');
  assert.equal(fs.existsSync(witness), false);
});
