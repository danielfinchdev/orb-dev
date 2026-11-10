// 3.8.3 (repaso): rules and helpers of the domain, platform and agents that could freeze the engine, run a program
// behind the guard's back, over-block an honest command or break on one bad row.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tempHome } from './helpers.mjs';
import { git, isGitRepo } from '../src/platform/git.mjs';
import { prepareWorkdir, takeCheckpoint } from '../src/domain/tasks/checkpoints.mjs';
import { decide } from '../src/domain/security/guard.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { JsonRpcPeer } from '../src/agents/live.mjs';
import { applyPendingRestore, pendingDir } from '../src/domain/data/backup.mjs';
import { paths, INTERNAL_DIR } from '../src/platform/paths.mjs';
import { createAndroid } from '../src/engine/host/android.mjs';
import { extractText } from '../src/engine/host/attachments.mjs';
import { agentInstallCommand } from '../src/engine/host/installer.mjs';
import { ctx } from '../src/platform/context.mjs';

let h; let board;
before(() => { h = tempHome(); board = new Board(); createProject(board, { name: 'web' }, 'usuario'); });
after(() => { try { board.db.close(); } catch { /* closed */ } h.cleanup(); });

const sh = (dir, name, body) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`); try { fs.chmodSync(f, 0o755); } catch { /* windows */ } return f; };

test("Orb's own git never runs the project's hooks or fsmonitor, and does not hand it the engine's environment", () => {
  const repo = board.project('web').path;
  const g = (...a) => { const r = git(repo, ...a); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
  const marker = path.join(h.base, 'hook-ran.txt').replace(/\\/g, '/');
  sh(path.join(repo, '.git', 'hooks'), 'post-checkout', `echo ran > "${marker}"`);
  assert.ok(isGitRepo(repo));
  // An agent could leave this in the project's own .git/config: Orb's snapshot and copy must not run it.
  const task = board.createTask({ project: 'web', title: 'Copia', description: 'x', agent: 'claude', mode: 'aislada' }, 'usuario');
  const wt = prepareWorkdir(board.task(task.id), board.project('web'), path.join(h.base, 'copias'));
  assert.ok(wt.isGit && fs.existsSync(wt.workdir));
  assert.ok(!fs.existsSync(marker), 'post-checkout did not run for Orb');
  takeCheckpoint(repo, 'foto', path.join(h.base, 'bk'));
  assert.ok(!fs.existsSync(marker));
  // The engine's environment stays with the engine: an alias that prints a variable of the app sees nothing.
  process.env.ORB_TEST_SECRET = 'nunca';
  try {
    const out = git(repo, '-c', 'alias.e=!echo x$ORB_TEST_SECRET', 'e');
    if (out.status === 0) assert.equal(out.stdout.trim(), 'x', 'the variable did not reach git');
  } finally { delete process.env.ORB_TEST_SECRET; }
});

test('the guard: git settings that run programs ask; reading the snapshots, a stale lock and a variable target inside the project do not over-block', () => {
  const proj = board.project('web').path; const internal = ctx.paths.internal;
  const auto = (command) => decide({ permission: 'auto', tool: 'Bash', command, internalDir: internal, cwd: proj, projectDir: proj });
  for (const c of ['git config filter.x.clean "powershell -File leak.ps1"', 'git config core.fsmonitor .git/fsm.sh', 'git config --local core.hooksPath hooks', 'git config credential.helper store']) {
    const v = auto(c); assert.equal(v.decision, 'ask', c); assert.match(v.reason, /ejecutan programas|run programs/);
  }
  assert.equal(auto('git config user.name Ana').decision, 'allow');
  // Looking at the snapshots is fine; dropping them still asks.
  assert.equal(auto('git for-each-ref refs/orb').decision, 'allow');
  assert.equal(auto('git log --oneline refs/orb/t12-x').decision, 'allow');
  assert.equal(auto('git update-ref -d refs/orb/t12-x').decision, 'ask');
  // The usual fix after a crash is not an attack on the checkpoints.
  assert.equal(auto('rm .git/index.lock').decision, 'allow');
  assert.equal(auto('Remove-Item .git\\index.lock').decision, 'allow');
  assert.equal(auto('rm -rf .git').decision, 'ask');
  // A writer whose target is a variable, inside the project: unknown is not outside. What deletes still asks.
  assert.equal(auto('Get-ChildItem *.log | ForEach-Object { Set-Content -Path $_.FullName -Value "" }').decision, 'allow');
  assert.equal(auto('Out-File -FilePath $out -InputObject $x').decision, 'allow');
  assert.equal(auto('rm -rf $dir').decision, 'ask');
  assert.equal(auto(`Set-Content -Path ${path.join(os.homedir(), 'x.txt')} -Value 1`).decision, 'ask', 'a literal path outside still asks');
});

test('one corrupt task row reads as empty lists instead of breaking every list', () => {
  const t = board.createTask({ project: 'web', title: 'Rota', description: 'x', agent: 'claude' }, 'usuario');
  board.run("UPDATE tasks SET depends_on = '{broken', sensitivity = 'null' WHERE id = ?", t.id);
  assert.deepEqual(board.task(t.id).depends_on, []); assert.deepEqual(board.task(t.id).sensitivity, []);
  assert.ok(board.tasks({ limit: 50 }).some((x) => x.id === t.id));
});

test('a notification handler that throws does not drop the lines after it', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stdin.write = () => true;
  let notes = 0;
  const peer = new JsonRpcPeer(child, { onNotification: (m, p) => { notes++; if (!p.item) throw new TypeError('item is undefined'); }, log: () => {} });
  const answer = peer.request('turn/start', {}, { timeoutMs: 2000 });
  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'item/started', params: {} })}\n${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { turn: { id: 't1' } } })}\n`);
  assert.deepEqual(await answer, { turn: { id: 't1' } });
  assert.equal(notes, 1);
});

test('a restore that cannot finish puts everything back and keeps the copy for later', () => {
  const home = path.join(h.base, 'casa'); const p = paths(home);
  fs.mkdirSync(p.data, { recursive: true });
  fs.writeFileSync(path.join(p.data, 'orb.json'), 'viejo');
  const ready = pendingDir(home);
  fs.mkdirSync(path.join(ready, INTERNAL_DIR, 'datos'), { recursive: true });
  fs.writeFileSync(path.join(ready, INTERNAL_DIR, 'datos', 'orb.json'), 'nuevo');
  // The second unit cannot land: where its project folder should be there is a file.
  fs.writeFileSync(path.join(home, 'web'), 'soy un archivo');
  fs.mkdirSync(path.join(ready, 'web', 'pizarra'), { recursive: true }); fs.writeFileSync(path.join(ready, 'web', 'pizarra', 'pizarra.excalidraw'), '{}');
  fs.writeFileSync(path.join(ready, 'listo.json'), JSON.stringify({ from: 'copia.orbbak', header: {} }));
  assert.throws(() => applyPendingRestore(home), /restaurar:/);
  assert.equal(fs.readFileSync(path.join(p.data, 'orb.json'), 'utf8'), 'viejo', 'core as it was');
  assert.equal(fs.readFileSync(path.join(ready, INTERNAL_DIR, 'datos', 'orb.json'), 'utf8'), 'nuevo', 'the copy is kept');
  assert.ok(!fs.readdirSync(p.internal).some((d) => d.startsWith('antes-de-restaurar') && fs.readdirSync(path.join(p.internal, d, INTERNAL_DIR, 'datos')).length), 'nothing left aside');
  assert.ok(fs.existsSync(path.join(ready, 'listo.fallido.json')) && !fs.existsSync(path.join(ready, 'listo.json')), 'not retried blindly at every start');
  assert.equal(applyPendingRestore(home), null);
});

test('adb: the folder is verified once a minute, not on every call', async () => {
  const dir = path.join(h.base, 'adb'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'adb.exe'), '');
  let verified = 0;
  const android = createAndroid({ board: null, exe: () => path.join(dir, 'adb.exe'), verify: () => { verified++; return false; }, ensure: async () => ({ error: 'no' }) });
  await android.devices(); await android.devices(); await android.devices();
  assert.equal(verified, 1, 'checked once (usable → verify), then remembered');
});

test('a huge document is handed over as a file only; the PowerShell fallback path is a real path', () => {
  const big = path.join(h.base, 'grande.pdf');
  const fd = fs.openSync(big, 'w'); fs.writeSync(fd, '%PDF-1.4\n'); fs.ftruncateSync(fd, 21 * 1024 * 1024); fs.closeSync(fd);
  assert.equal(extractText(big), '');
  const was = process.env.SystemRoot; delete process.env.SystemRoot;
  try { assert.match(agentInstallCommand('claude', { platform: 'win32' }).cmd, /^C:\\Windows\\System32\\/); } finally { if (was !== undefined) process.env.SystemRoot = was; }
});
