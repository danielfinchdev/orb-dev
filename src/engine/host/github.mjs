// GitHub and git actions of the user, through the official CLIs (gh and git with the user's own login and credential helper).
// The app never asks for or stores a token. Every action that publishes (push, pull request, new repository) runs only
// from a button the user clicks and confirms; agents have no access to these functions.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ctx, tr } from '../../platform/context.mjs';
import { firstFile, inPath, cleanEnv, IS_WIN } from '../../platform/proc.mjs';
import { openConsole } from '../../agents/index.mjs';
import { gitAsyncWith, isGitRepoAsync, ORB_GIT } from '../../platform/git.mjs';
import { secretFiles, isSecretPath, stagedSecretsAsync, secretsInDiff } from '../../shared/secrets-scan.mjs';
import { oneLine } from '../../shared/text.mjs';
import { folderName } from '../../platform/paths.mjs';
import { checkCategory } from '../../domain/projects/projects.mjs';
import { ATTACH_DIR } from '../sessions.mjs';

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

// the user's contribution calendar of the last year (the green squares of their GitHub profile), from GitHub itself
// through gh (GraphQL contributionsCollection). Real numbers only: nothing is filled in when gh cannot answer.
export async function contributions() {
  const exe = ghExe(); if (!exe) return null;
  const query = 'query { viewer { login contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } } } }';
  const r = await run(exe, ['api', 'graphql', '-f', `query=${query}`], { timeoutMs: 30_000 });
  if (!r.ok) return null;
  let data; try { data = JSON.parse(r.out)?.data?.viewer; } catch { return null; }
  const cal = data?.contributionsCollection?.contributionCalendar; if (!cal) return null;
  const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  return { user: data.login, total: cal.totalContributions, weeks: cal.weeks.map((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, level: LEVEL[d.contributionLevel] ?? 0 }))) };
}

export function login() { const exe = ghExe(); if (!exe) throw new Error(tr('msg.github.ghMissingShort')); openConsole(exe, ['auth', 'login', '--web', '--git-protocol', 'https']); }

// git for the card, without blocking the engine (five calls per open card, up to a second on a big repository). Never
// throws: a failure is an empty answer.
const query = async (cwd, ...args) => { const r = await gitAsyncWith(cwd, { timeout: 30_000, max: 32 * 1024 * 1024 }, ...args); return { stdout: r.status === 0 ? r.stdout : '' }; };
// The engine's asynchronous git, called as git(dir, ...args), for what has to look at the status code.
// Writing actions keep the two minutes they always had; only the card's reads are cut at 30 s (query).
const git = (dir, ...args) => gitAsyncWith(dir, { timeout: 120_000 }, ...args);
export async function projectInfo(project) {
  if (!(await isGitRepoAsync(project.path))) return { git: false };
  const [b, r, refs, st] = await Promise.all([query(project.path, 'rev-parse', '--abbrev-ref', 'HEAD'), query(project.path, 'remote', 'get-url', 'origin'), query(project.path, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'), query(project.path, 'status', '--porcelain', '-uall')]);
  const branch = b.stdout.trim();
  const remote = r.stdout.trim() || null;
  const branches = refs.stdout.split(/\r?\n/).filter(Boolean).slice(0, 100);
  const changes = st.stdout.split(/\r?\n/).filter(Boolean).length;
  const ahead = remote ? (await query(project.path, 'rev-list', '--count', '@{upstream}..HEAD')).stdout.trim() : '';
  let prs = [];
  if (remote && /github\.com/i.test(remote) && ghExe()) {
    const r = await gh(['pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,headRefName,url,isDraft'], { cwd: project.path, timeoutMs: 30_000 });
    if (r.ok) { try { prs = JSON.parse(r.out); } catch { /* ignore */ } }
  }
  return { git: true, branch, remote, branches, changes, ahead: ahead === '' ? null : Number(ahead), prs };
}

// Commit of everything in the project folder (the folder mode never commits on its own). Secret-looking files stop it.
export async function commitAll(project, message) {
  if (!(await isGitRepoAsync(project.path))) throw new Error(tr('msg.github.noGit'));
  const msg = oneLine(message, 200); if (!msg) throw new Error(tr('msg.github.commitMsg'));
  const status = await git(project.path, 'status', '--porcelain=v1', '-z', '-uall');
  if (!status.stdout.trim()) throw new Error(tr('msg.github.noChanges'));
  const risky = secretFiles(status.stdout);
  if (risky.length) throw new Error(tr('msg.github.looksSecret', { files: risky.slice(0, 5).join(', ') }));
  await git(project.path, 'add', '-A', '--', '.', `:(exclude)${ATTACH_DIR}`);
  const staged = (await git(project.path, 'diff', '--cached', '--name-only', '-z')).stdout.split('\0').filter(Boolean);
  if (staged.some(isSecretPath)) { await git(project.path, 'reset', '-q'); throw new Error(tr('msg.github.looksSecretNone')); }
  // also what the files say (a key pasted into any file), not only their names.
  let inText;
  try { inText = await stagedSecretsAsync(project.path, git); } catch { await git(project.path, 'reset', '-q'); throw new Error(tr('msg.github.gitIncomplete')); }
  if (inText.length) { await git(project.path, 'reset', '-q'); throw new Error(tr('msg.github.secretInText', { files: inText.slice(0, 5).join(', ') })); }
  // The user's own identity when git has one; without it (no global user.name/email) git refuses to commit, so the
  // commit goes in as Orb's, like the first commit of a created project.
  const known = async (key) => (await git(project.path, 'config', '--get', key)).stdout.trim() !== '';
  const who = (await known('user.name')) && (await known('user.email')) ? [] : ORB_GIT;
  const r = await git(project.path, ...who, 'commit', '-q', '-m', msg);
  if (r.status !== 0) throw new Error(oneLine(r.stderr || r.stdout, 300));
  return { files: staged.length };
}

// Brings a task branch into the current branch of the project (merge commit). A conflict is undone and reported.
export async function mergeBranch(project, branch) {
  branchName(branch);
  if ((await git(project.path, 'status', '--porcelain')).stdout.trim()) throw new Error(tr('msg.github.unsaved'));
  const r = await git(project.path, ...ORB_GIT, 'merge', '--no-ff', '--no-edit', branch);
  if (r.status !== 0) { await git(project.path, 'merge', '--abort'); throw new Error(tr('msg.github.mergeFail', { branch, detail: oneLine(r.stdout || r.stderr, 300) })); }
  return { ok: true };
}

// nothing that looks like a key leaves the PC. Checks the commits of the branch that no remote has yet (all of them
// for a repository without remotes): files named like secrets and added lines that look like keys.
export async function unpushedSecrets(dir, branch = 'HEAD', { max } = {}) {
  const g = async (...args) => { const r = await gitAsyncWith(dir, { timeout: 120_000, ...(max ? { max } : {}) }, ...args); if (r.cut || r.timedOut) throw new Error(tr('msg.github.gitIncomplete')); return r; };
  const range = [branch, '--not', '--remotes'];
  const names = (await g('-c', 'core.quotePath=false', 'log', '-n', '500', '--format=', '--name-only', '--diff-filter=AM', ...range)).stdout.split(/\r?\n/).filter(Boolean);
  const byName = [...new Set(names.filter(isSecretPath))];
  if (byName.length) return byName;
  return secretsInDiff((await g('-c', 'core.quotePath=false', 'log', '-n', '500', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=', ...range)).stdout);
}
const checkUnpushed = async (dir, branch) => {
  const found = await unpushedSecrets(dir, branch);
  if (found.length) throw new Error(tr('msg.github.secretBeforePush', { files: found.slice(0, 5).join(', ') }));
};

export async function push(project, branch) {
  branchName(branch);
  await checkUnpushed(project.path, branch);
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
  if (!/^[\w.][\w.-]{0,99}$/.test(name ?? '')) throw new Error(tr('msg.github.badRepoName')); // never starts with "-": gh would read it as a flag
  if (!(await isGitRepoAsync(project.path))) throw new Error(tr('msg.github.noGit'));
  if (!(await git(project.path, 'rev-parse', '--verify', '--quiet', 'HEAD')).stdout.trim()) throw new Error(tr('msg.github.needCommit'));
  if ((await git(project.path, 'remote', 'get-url', 'origin')).status === 0) throw new Error(tr('msg.github.hasOrigin'));
  await checkUnpushed(project.path, 'HEAD');
  const r = must(await gh(['repo', 'create', name, isPrivate ? '--private' : '--public', '--source', project.path, '--remote', 'origin', '--push'], { cwd: project.path, timeoutMs: 180_000 }), tr('msg.github.repoFailed'));
  return { url: r.out.split(/\s+/).find((s) => /^https:\/\//.test(s)) ?? r.out };
}

// Clones a repository into a category of the assistant's folder (web by default). Returns the new folder.
export async function clone(repo, name, category) {
  if (!/^([\w.][\w.-]*\/[\w.][\w.-]*|https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?)$/.test(String(repo ?? '').trim())) throw new Error(tr('msg.github.badRepo'));
  const folder = path.join(ctx.paths.categories[checkCategory(category)], folderName(name || String(repo).split('/').pop().replace(/\.git$/, ''), 'proyecto'));
  if (fs.existsSync(folder)) throw new Error(tr('msg.github.folderExists', { folder }));
  const exe = ghExe();
  const r = exe ? await run(exe, ['repo', 'clone', String(repo).trim(), folder], { timeoutMs: 600_000 })
    : await run('git', ['clone', '--', /^https:/.test(repo) ? repo : `https://github.com/${repo}.git`, folder], { timeoutMs: 600_000 });
  // the usual case (a wrong name or a private repository of someone else) in the user's words, not gh's.
  if (!r.ok && /could not resolve to a repository|repository not found|not found|HTTP 404|does not exist/i.test(`${r.err} ${r.out}`)) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw new Error(tr('msg.github.cloneNotFound', { repo: oneLine(repo, 200) }));
  }
  must(r, tr('msg.github.cloneFailed'));
  return folder;
}
