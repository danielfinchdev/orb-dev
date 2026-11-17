// The files that decide where git looks (commondir, gitdir, a worktree's loose .git) ask like .git/config does, written by
// hand or by any program; reading them, plain git and a name that merely starts with .git do not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { decide, isGitRunsFile } from '../src/domain/security/guard.mjs';
import { writesGitRunsFile } from '../src/domain/security/guard/project-writes.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { ctx } from '../src/platform/context.mjs';

let h; let board; let proj;
before(() => { h = tempHome(); board = new Board(); createProject(board, { name: 'web' }, 'usuario'); proj = board.project('web').path; });
after(() => { try { board.db.close(); } catch { /* closed */ } h.cleanup(); });
const auto = (command) => decide({ permission: 'auto', tool: 'Bash', command, internalDir: ctx.paths.internal, cwd: proj, projectDir: proj });

test('commondir, gitdir and the loose .git ask, in .git and in a worktree\'s own folder', () => {
  for (const f of ['.git/commondir', '.git/gitdir', '.git/worktrees/wt/commondir', '.git/worktrees/wt/gitdir', '.git']) assert.equal(isGitRunsFile(f, proj), true, f);
  for (const c of ['Set-Content .git/commondir "../evil"', 'echo ../x > .git/worktrees/wt/gitdir', 'cp evil .git/worktrees/wt/commondir',
    'Set-Content .git "gitdir: C:/evil"', "sed -i 's/a/b/' .git/gitdir", 'node -e "require(\'fs\').writeFileSync(\'.git\', \'gitdir: x\')"',
    "sed -i 's/a/b/' .git/worktrees/wt/gitdir"]) assert.equal(auto(c).decision, 'ask', c);
});

test('reading them, plain git and look-alike names do not ask', () => {
  for (const c of ['cat .git/commondir', 'Get-Content .git/worktrees/wt/gitdir', 'git status', 'git worktree list', 'cat .gitignore', 'Set-Content .gitignore "dist/"',
    'Set-Content .gitattributes "*.sh text eol=lf"', 'git clone https://example.com/a/b.git']) assert.equal(auto(c).decision, 'allow', c);
  assert.equal(isGitRunsFile('.gitignore', proj), false);
});

test('nested module folders ask, and .git named only to leave it out does not', () => {
  for (const c of ["sed -i 's/a/b/' .git/modules/libs/foo/config", "sed -i 's/a/b/' .git/modules/a/modules/b/config", "sed -i 's/a/b/' .git/modules/a/modules/b/hooks",
    "node -e \"fs.writeFileSync('.git','x')\""]) assert.equal(auto(c).decision, 'ask', c);
  for (const c of ['tar --exclude=.git -czf out.tgz .', 'eslint . --ignore-pattern .git', 'robocopy a b /XD .git']) assert.equal(auto(c).decision, 'allow', c);
});

test('rsync --exclude .git is not a write of .git (rsync asks for its own reason)', () => {
  assert.equal(writesGitRunsFile('rsync -a --exclude .git src/ dst/', proj), false);
});

test('an option that merely looks like an exclude cannot hide a write to .git', () => {
  const bad = ['cp -x cfg .git/config', 'cp -x evil.sh .git/hooks/pre-commit', 'echo p | tee --ignore-interrupts .git/hooks/pre-commit'];
  for (const permission of ['auto', 'editar', 'probar']) {
    for (const c of bad) assert.equal(decide({ permission, tool: 'Bash', command: c, internalDir: ctx.paths.internal, cwd: proj, projectDir: proj }).decision, 'ask', `${permission}: ${c}`);
  }
  for (const c of ['rg --exclude .git foo', 'grep -r --exclude-dir=.git x .', 'robocopy a b /XD .git', "rg --exclude '.git/' foo"]) assert.equal(auto(c).decision, 'allow', c);
});
