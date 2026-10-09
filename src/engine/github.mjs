// GitHub and git actions of the user, through the official CLIs (gh and git with the user's own login and credential helper).
// The app never asks for or stores a token. Every action that publishes (push, pull request, new repository) runs only
// from a button the user clicks and confirms; agents have no access to these functions.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ctx, tr } from '../core/context.mjs';
import { firstFile, inPath, cleanEnv, IS_WIN } from '../agents/common.mjs';
import { openConsole } from '../agents/index.mjs';
import { git, isGitRepo, ORB_GIT } from '../core/workspace.mjs';
import { secretFiles, isSecretPath, oneLine } from '../core/safety.mjs';
import { folderName } from '../core/home.mjs';
import { checkCategory } from '../core/projects.mjs';
import { ATTACH_DIR } from './sessions.mjs';

export function ghExe() {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  return firstFile([...inPath('gh'), ...(IS_WIN ? [path.join(pf, 'GitHub CLI', 'gh.exe'), path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'GitHub CLI', 'gh.exe')] : [])]);
}

export function run(cmd, args, { cwd, timeoutMs = 120_000, input } = {}) {
  return new Promise((resolve) => {
    let out = ''; let err = '';
    let child;
    try { child = spawn(cmd, args, { cwd, windowsHide: true, env: cleanEnv({ GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }), stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); }
    catch (error) { return resolve({ ok: false, out: '', err: error.message }); }
    child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, out, err: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out: out.trim(), err: err.trim() }); });
  });
}

const gh = (args, opts) => { const exe = ghExe(); if (!exe) throw new Error(tr('msg.github.ghMissing')); return run(exe, args, opts); };
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${oneLine(r.err || r.out, 400)}`); return r; };
const branchName = (b) => { if (!/^[\w./-]{1,120}$/.test(String(b ?? '')) || String(b).startsWith('-') || String(b).includes('..')) throw new Error(tr('msg.github.badBranch', { b })); return b; };

export async function status() {
  const exe = ghExe();
  if (!exe) return { installed: false, loggedIn: false, user: null };
  const auth = await run(exe, ['auth', 'status'], { timeoutMs: 20_000 });
  const user = auth.ok ? await run(exe, ['api', 'user', '--jq', '.login'], { timeoutMs: 20_000 }) : null;
  return { installed: true, loggedIn: auth.ok, user: user?.ok ? user.out : null, where: exe };
}

export function login() { const exe = ghExe(); if (!exe) throw new Error(tr('msg.github.ghMissingShort')); openConsole(exe, ['auth', 'login', '--web', '--git-protocol', 'https'], 'GitHub: iniciar sesión'); }

export async function projectInfo(project) {
  if (!isGitRepo(project.path)) return { git: false };
  const branch = git(project.path, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  const remote = git(project.path, 'remote', 'get-url', 'origin').stdout.trim() || null;
  const branches = git(project.path, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').stdout.split(/\r?\n/).filter(Boolean).slice(0, 100);
  const changes = git(project.path, 'status', '--porcelain', '-uall').stdout.split(/\r?\n/).filter(Boolean).length;
  const ahead = remote ? git(project.path, 'rev-list', '--count', '@{upstream}..HEAD').stdout.trim() : '';
  let prs = [];
  if (remote && /github\.com/i.test(remote) && ghExe()) {
    const r = await gh(['pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,headRefName,url,isDraft'], { cwd: project.path, timeoutMs: 30_000 });
    if (r.ok) { try { prs = JSON.parse(r.out); } catch { /* ignore */ } }
  }
  return { git: true, branch, remote, branches, changes, ahead: ahead === '' ? null : Number(ahead), prs };
}

// Commit of everything in the project folder (the folder mode never commits on its own). Secret-looking files stop it.
export function commitAll(project, message) {
  if (!isGitRepo(project.path)) throw new Error(tr('msg.github.noGit'));
  const msg = oneLine(message, 200); if (!msg) throw new Error(tr('msg.github.commitMsg'));
  const status = git(project.path, 'status', '--porcelain=v1', '-z', '-uall');
  if (!status.stdout.trim()) throw new Error(tr('msg.github.noChanges'));
  const risky = secretFiles(status.stdout);
  if (risky.length) throw new Error(tr('msg.github.looksSecret', { files: risky.slice(0, 5).join(', ') }));
  git(project.path, 'add', '-A', '--', '.', `:(exclude)${ATTACH_DIR}`);
  const staged = git(project.path, 'diff', '--cached', '--name-only', '-z').stdout.split('\0').filter(Boolean);
  if (staged.some(isSecretPath)) { git(project.path, 'reset', '-q'); throw new Error(tr('msg.github.looksSecretNone')); }
  const r = git(project.path, 'commit', '-q', '-m', msg);
  if (r.status !== 0) throw new Error(oneLine(r.stderr || r.stdout, 300));
  return { files: staged.length };
}

// Brings a task branch into the current branch of the project (merge commit). A conflict is undone and reported.
export function mergeBranch(project, branch) {
  branchName(branch);
  if (git(project.path, 'status', '--porcelain').stdout.trim()) throw new Error(tr('msg.github.unsaved'));
  const r = git(project.path, ...ORB_GIT, 'merge', '--no-ff', '--no-edit', branch);
  if (r.status !== 0) { git(project.path, 'merge', '--abort'); throw new Error(tr('msg.github.mergeFail', { branch, detail: oneLine(r.stdout || r.stderr, 300) })); }
  return { ok: true };
}

export async function push(project, branch) {
  branchName(branch);
  must(await run('git', ['-C', project.path, 'push', '-u', 'origin', branch], { timeoutMs: 180_000 }), tr('msg.github.pushFailed'));
  return { ok: true };
}

export async function createPr(project, { branch, title, body = '', base }) {
  branchName(branch); if (base) branchName(base);
  if (!oneLine(title, 200)) throw new Error(tr('msg.github.prNeedsTitle'));
  await push(project, branch);
  const r = must(await gh(['pr', 'create', '--head', branch, '--title', oneLine(title, 200), '--body-file', '-', ...(base ? ['--base', base] : [])], { cwd: project.path, input: String(body).slice(0, 20000) }), tr('msg.github.prFailed'));
  return { url: r.out.split(/\s+/).find((s) => /^https:\/\//.test(s)) ?? r.out };
}

export async function createRepo(project, { name, isPrivate = true }) {
  if (!/^[\w.-]{1,100}$/.test(name ?? '')) throw new Error(tr('msg.github.badRepoName'));
  if (!isGitRepo(project.path)) throw new Error(tr('msg.github.noGit'));
  if (!git(project.path, 'rev-parse', '--verify', '--quiet', 'HEAD').stdout.trim()) throw new Error(tr('msg.github.needCommit'));
  if (git(project.path, 'remote', 'get-url', 'origin').status === 0) throw new Error(tr('msg.github.hasOrigin'));
  const r = must(await gh(['repo', 'create', name, isPrivate ? '--private' : '--public', '--source', project.path, '--remote', 'origin', '--push'], { cwd: project.path, timeoutMs: 180_000 }), tr('msg.github.repoFailed'));
  return { url: r.out.split(/\s+/).find((s) => /^https:\/\//.test(s)) ?? r.out };
}

// Clones a repository into a category of the assistant's folder (web by default). Returns the new folder.
export async function clone(repo, name, category) {
  if (!/^([\w.-]+\/[\w.-]+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?)$/.test(String(repo ?? '').trim())) throw new Error(tr('msg.github.badRepo'));
  const folder = path.join(ctx.paths.categories[checkCategory(category)], folderName(name || String(repo).split('/').pop().replace(/\.git$/, ''), 'proyecto'));
  if (fs.existsSync(folder)) throw new Error(tr('msg.github.folderExists', { folder }));
  const exe = ghExe();
  const r = exe ? await run(exe, ['repo', 'clone', String(repo).trim(), folder], { timeoutMs: 600_000 })
    : await run('git', ['clone', '--', /^https:/.test(repo) ? repo : `https://github.com/${repo}.git`, folder], { timeoutMs: 600_000 });
  must(r, tr('msg.github.cloneFailed'));
  return folder;
}
