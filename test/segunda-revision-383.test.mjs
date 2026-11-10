// 3.8.3 (second review of the «repaso» changes): what still let an agent past the guard or run its code as the engine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { git } from '../src/platform/git.mjs';
import { snapshotCommit, diffBetween } from '../src/domain/tasks/checkpoints.mjs';
import { decide } from '../src/domain/security/guard.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { ctx } from '../src/platform/context.mjs';

let h; let board; let proj;
before(() => { h = tempHome(); board = new Board(); createProject(board, { name: 'web' }, 'usuario'); proj = board.project('web').path; });
after(() => { try { board.db.close(); } catch { /* closed */ } h.cleanup(); });
const auto = (command, extra = {}) => decide({ permission: 'auto', tool: 'Bash', command, internalDir: ctx.paths.internal, cwd: proj, projectDir: proj, ...extra });
const posix = (p) => p.split(path.sep).join('/');

test('dropping the snapshots asks however the command is spelled; reading them alone does not', () => {
  for (const c of [
    'git update-ref -m "status quo" -d refs/orb/t1',
    'git for-each-ref --format="delete %(refname)" refs/orb | git update-ref --stdin',
    'git update-ref -d $(git for-each-ref --format=%(refname) refs/orb)',
    'git log x\ngit update-ref -d refs/orb/t1',
    'git log (git update-ref -d refs/orb/t1)',
    'powershell -Command "git log refs/orb; git update-ref -d refs/orb/t1"'
  ]) assert.equal(auto(c).decision, 'ask', c);
  for (const c of ['git for-each-ref refs/orb', 'git for-each-ref --format="%(refname) %(objectname)" refs/orb', 'git log --oneline refs/orb/t12-x',
    'git show refs/orb/t1:src/a.js', 'git -C sub diff refs/orb/t1 HEAD', 'powershell -Command "git log --oneline refs/orb/t1"']) assert.equal(auto(c).decision, 'allow', c);
});

test("a write to a variable outside the project asks; the shell's own folders and paths named in the command count", () => {
  for (const c of [
    'Add-Content $PROFILE "iex x"',
    `$f = "${path.join(os.homedir(), '.gitconfig')}"; Add-Content $f "x"`,
    '$f = [Environment]::GetFolderPath("UserProfile") + "/.bashrc"; Add-Content -Path $f -Value x',
    `Get-ChildItem ${os.homedir()} -Filter .bashrc -Force | ForEach-Object { Add-Content $_.FullName "x" }`,
    '$d = "C:/Windows/System32"; Copy-Item a.txt $d',
    '$f = Join-Path $env:LOCALAPPDATA "x.txt"; Set-Content $f 1'
  ]) assert.equal(auto(c).decision, 'ask', c);
  // What the repaso meant to let through still goes.
  assert.equal(auto('Get-ChildItem *.log | ForEach-Object { Set-Content -Path $_.FullName -Value "" }').decision, 'allow');
  assert.equal(auto('Out-File -FilePath $out -InputObject $x').decision, 'allow');
  assert.equal(auto('$f = "src/a.txt"; Set-Content $f 1').decision, 'allow');
});

test("git's own settings files and the settings that make git run a program ask, written by hand or by git config", () => {
  for (const c of ['Set-Content .git/config "[filter x]"', 'Add-Content -Path .git\\config -Value x', 'echo x >> .git/config', 'cp evil.cfg .git/config',
    'Set-Content .git/hooks/post-checkout "x"', 'git config include.path ../evil.cfg', 'git config diff.external ./x.sh', 'git config gpg.program ./x.sh',
    'git config --add includeIf.gitdir:C:/.path x.cfg', "sed -i 's/a/b/' .git/config", '[IO.File]::AppendAllText(".git/config", "x")',
    'New-Item .git/hooks/post-commit -Value x', 'Copy-Item evil -Destination .git\\info\\attributes']) {
    const v = auto(c); assert.equal(v.decision, 'ask', c); assert.match(v.reason, /ejecutan programas|run programs/, c);
  }
  for (const p of [path.join(proj, '.git', 'config'), path.join(proj, '.git', 'hooks', 'pre-commit'), path.join(proj, '.git', 'info', 'attributes')]) {
    const v = decide({ permission: 'auto', tool: 'Write', paths: [p], internalDir: ctx.paths.internal, cwd: proj, projectDir: proj });
    assert.equal(v.decision, 'ask', p);
  }
  for (const c of ['cat .git/config', 'Get-Content .git\\config', 'ls .git/hooks', 'git config --get remote.origin.url', 'node build.js --config .github/config.yml']) assert.equal(auto(c).decision, 'allow', c);
  assert.equal(auto('Set-Content .gitattributes "*.sh text eol=lf"').decision, 'allow');
  assert.equal(decide({ permission: 'auto', tool: 'Write', paths: [path.join(proj, 'src', 'config')], internalDir: ctx.paths.internal, cwd: proj, projectDir: proj }).decision, 'allow');
});

test("Orb's git never runs a hook from the temporary folder agents may write, nor a diff program of the project", () => {
  const repo = fs.mkdtempSync(path.join(h.base, 'repo-'));
  const g = (...a) => { const r = git(repo, ...a); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
  g('init', '-q'); fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'b');
  // The old empty hooks folder was a fixed name in %TEMP%, which agents may write in «Auto».
  const hooks = path.join(os.tmpdir(), 'orb-sin-hooks'); fs.mkdirSync(hooks, { recursive: true });
  const marker = path.join(h.base, 'hook.txt');
  const hook = path.join(hooks, 'post-checkout');
  fs.writeFileSync(hook, `#!/bin/sh\necho ran > "${posix(marker)}"\n`);
  try {
    g('worktree', 'add', '-q', path.join(h.base, 'wt'), '-b', 'x');
    assert.ok(!fs.existsSync(marker), 'a hook in the temporary folder ran as the engine');
  } finally { fs.rmSync(hook, { force: true }); }
  // A text converter of the project (.git/config + .gitattributes) does not run when the diff panel opens.
  const before = snapshotCommit(repo, { raw: true, always: true }).commit;
  const conv = path.join(h.base, 'textconv.txt');
  fs.appendFileSync(path.join(repo, '.git', 'config'), `[diff "x"]\n\ttextconv = sh -c 'echo ran > ${posix(conv)} && cat \\"$0\\"'\n`);
  fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt diff=x\n'); fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n');
  const after = snapshotCommit(repo, { raw: true, always: true }).commit;
  const d = diffBetween(repo, before, after);
  assert.ok(d.files.some((f) => f.path === 'a.txt'));
  assert.ok(!fs.existsSync(conv), 'the project\'s textconv ran as the engine');
});
