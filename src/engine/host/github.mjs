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
import { isRailOn } from '../../domain/rules/rails.mjs';
import { secretFiles, isSecretPath, looksSecretText, stagedSecretsAsync, secretsInDiff, redactSecrets } from '../../shared/secrets-scan.mjs';
import { oneLine } from '../../shared/text.mjs';
import { folderName } from '../../platform/paths.mjs';
import { checkCategory } from '../../domain/projects/projects.mjs';
import { ATTACH_DIR } from '../sessions.mjs';
import { cleanCommitMessage } from '../../shared/commit-message.mjs';
import { rememberRepo, cachedPr } from './pr-cache.mjs';

function ghExe() {
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

// Tests swap the finder and the runner for a fake gh; nothing else touches this.
const seam = { exe: ghExe, run };
export function setGhForTests(fake) { seam.exe = fake?.exe ?? ghExe; seam.run = fake?.run ?? run; }
const gh = (args, opts) => { const exe = seam.exe(); if (!exe) throw new Error(tr('msg.github.ghMissing')); return seam.run(exe, args, opts); };
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
// The list reads every visible project each time it opens, while an agent may be running git add/commit there. A plain
// `git status` refreshes .git/index and takes index.lock for it; --no-optional-locks keeps these reads from touching either.
const peek = (cwd, ...args) => query(cwd, '--no-optional-locks', ...args);
// The engine's asynchronous git, called as git(dir, ...args), for what has to look at the status code.
// Writing actions keep the two minutes they always had; only the card's reads are cut at 30 s (query).
const git = (dir, ...args) => gitAsyncWith(dir, { timeout: 120_000 }, ...args);
// opts.local: git only, never gh and never the network; the PR is the one already in memory (pr-cache) or left out, and
// nothing is remembered.
export async function projectInfo(project, { local = false } = {}) {
  if (!(await isGitRepoAsync(project.path))) return { git: false };
  const [b, r, refs, st] = await Promise.all([peek(project.path, 'rev-parse', '--abbrev-ref', 'HEAD'), peek(project.path, 'remote', 'get-url', 'origin'), peek(project.path, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'), peek(project.path, 'status', '--porcelain', '-uall')]);
  const branch = b.stdout.trim();
  const remote = r.stdout.trim() || null;
  const branches = refs.stdout.split(/\r?\n/).filter(Boolean).slice(0, 100);
  const changes = st.stdout.split(/\r?\n/).filter(Boolean).length;
  const ahead = remote ? (await peek(project.path, 'rev-list', '--count', '@{upstream}..HEAD')).stdout.trim() : '';
  if (local) {
    const known = cachedPr(project.path, branch);
    return { git: true, branch, remote, branches, changes, ahead: ahead === '' ? null : Number(ahead), ...(known ? { prs: [{ number: known, headRefName: branch }] } : {}) };
  }
  let prs = []; let prsRead = false;
  if (remote && /github\.com/i.test(remote) && seam.exe()) {
    const r = await gh(['pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,headRefName,url,isDraft,isCrossRepository,author,createdAt,mergeable'], { cwd: project.path, timeoutMs: 30_000 });
    // the author is flattened to its login, the way listPrs and viewPr give it
    if (r.ok) { try { prs = JSON.parse(r.out); prsRead = Array.isArray(prs); if (prsRead) prs = prs.map((x) => ({ ...x, author: authorOf(x?.author) })); } catch { /* ignore */ } }
  }
  rememberRepo(project.path, { branch, prs: prsRead ? prs : undefined });
  return { git: true, branch, remote, branches, changes, ahead: ahead === '' ? null : Number(ahead), prs };
}

// The files «Hacer commit…» offers: what git reports as changed, without Orb's own attachments folder. `risky` marks the
// ones named like a secret (the commit refuses them; the dialog shows them unticked and flagged).
export async function changedFiles(project) {
  if (!(await isGitRepoAsync(project.path))) throw new Error(tr('msg.github.noGit'));
  const r = await git(project.path, 'status', '--porcelain=v1', '-z', '-uall');
  const parts = r.stdout.split('\0'); const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const e = parts[i]; if (e.length < 4) continue;
    const xy = e.slice(0, 2); const file = e.slice(3).replace(/\\/g, '/');
    let from = null;
    if (/[RC]/.test(xy)) { i += 1; if (xy.includes('R')) from = (parts[i] ?? '').replace(/\\/g, '/') || null; } // the old name of a rename or copy follows
    if (file === ATTACH_DIR || file.startsWith(`${ATTACH_DIR}/`)) continue;
    out.push({ path: file, ...(from ? { from } : {}), status: xy === '??' ? '??' : (xy[0] !== ' ' ? xy[0] : xy[1]), risky: isSecretPath(file) });
  }
  // Added/removed lines of the tracked files, from one numstat of the whole change (no read per file). Untracked, binary and
  // renamed files stay without numbers.
  try {
    const stat = (await peek(project.path, 'diff', 'HEAD', '--numstat', '-z', '--no-color', '--no-ext-diff', '--no-textconv')).stdout.split('\0');
    const nums = new Map();
    for (let i = 0; i < stat.length; i += 1) {
      const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(stat[i]);
      if (!m) continue;
      if (!m[3]) { i += 2; continue; } // a rename: its old and new names follow as their own entries
      if (m[1] !== '-') nums.set(m[3].replace(/\\/g, '/'), { add: Number(m[1]), del: Number(m[2]) });
    }
    for (const f of out) { const n = nums.get(f.path); if (n) { f.add = n.add; f.del = n.del; } }
  } catch { /* the list works without the numbers */ }
  return out.slice(0, 500);
}

// What the model sees to write the message: the files, the stat and the start of the diff of what is going in (secrets
// masked), plus the repository's last subjects. Best effort: never throws.
export async function commitContext(project, files) {
  const paths = (files ?? []).filter((f) => !f.risky && f.status !== '??').map((f) => f.path);
  const names = (files ?? []).filter((f) => !f.risky).map((f) => f.path);
  const none = { names, stat: '', diff: '', recent: [] };
  try {
    const recent = (await query(project.path, 'log', '-n', '12', '--format=%s')).stdout.split(/\r?\n/).filter(Boolean);
    if (!paths.length) return { ...none, recent };
    const stat = (await query(project.path, 'diff', 'HEAD', '--stat', '--no-color', '--no-ext-diff', '--', ...paths)).stdout;
    const diff = (await query(project.path, 'diff', 'HEAD', '-U1', '--no-color', '--no-ext-diff', '--', ...paths)).stdout;
    return { names, stat, diff: redactSecrets(diff), recent };
  } catch { return none; }
}

// Commit of the project folder (the folder mode never commits on its own). Secret-looking files stop it.
// opts.files: only these paths (the dialog's ticked files; the message may then have a body). Without it, everything.
export async function commitAll(project, message, opts = {}) {
  if (!(await isGitRepoAsync(project.path))) throw new Error(tr('msg.github.noGit'));
  const picked = Array.isArray(opts.files) ? opts.files : null;
  const msg = picked ? cleanCommitMessage(message) : oneLine(message, 200); if (!msg) throw new Error(tr('msg.github.commitMsg'));
  // Checked before anything is staged or committed, line by line (the diff scanner only reads added lines under a file header).
  if (isRailOn('revisar-secretos') && msg.split(/\r?\n/).some(looksSecretText)) throw new Error(tr('msg.github.secretInText', { files: tr('msg.github.theMessage') }));
  const status = await git(project.path, 'status', '--porcelain=v1', '-z', '-uall');
  if (!status.stdout.trim()) throw new Error(tr('msg.github.noChanges'));
  let only = null;
  if (picked) {
    const known = new Map((await changedFiles(project)).map((f) => [f.path, f]));
    only = [...new Set(picked.map(String))].filter((f) => known.has(f));
    // a ticked rename takes its old name along, or the commit adds the new file and leaves the deletion behind
    only = [...new Set([...only, ...only.map((f) => known.get(f).from).filter(Boolean)])];
    if (!only.length) throw new Error(tr('msg.github.noFilesPicked'));
    const bad = only.filter(isSecretPath);
    if (bad.length) throw new Error(tr('msg.github.looksSecret', { files: bad.slice(0, 5).join(', ') }));
  } else {
    const risky = secretFiles(status.stdout);
    if (risky.length) throw new Error(tr('msg.github.looksSecret', { files: risky.slice(0, 5).join(', ') }));
  }
  const lit = '--literal-pathspecs'; // a file called [a].txt is that file, not a pattern
  const unstage = () => (only ? git(project.path, lit, 'reset', '-q', '--', ...only) : git(project.path, 'reset', '-q'));
  await (only ? git(project.path, lit, 'add', '-A', '--', ...only) : git(project.path, 'add', '-A', '--', '.', `:(exclude)${ATTACH_DIR}`));
  const staged = (await git(project.path, ...(only ? [lit] : []), 'diff', '--cached', '--name-only', '-z', ...(only ? ['--', ...only] : []))).stdout.split('\0').filter(Boolean);
  if (staged.some(isSecretPath)) { await unstage(); throw new Error(tr('msg.github.looksSecretNone')); }
  // also what the files say (a key pasted into any file), not only their names.
  let inText = [];
  try { if (isRailOn('revisar-secretos')) inText = await stagedSecretsAsync(project.path, git); } catch { await unstage(); throw new Error(tr('msg.github.gitIncomplete')); }
  if (inText.length) { await unstage(); throw new Error(tr('msg.github.secretInText', { files: inText.slice(0, 5).join(', ') })); }
  // The user's own identity when git has one; without it (no global user.name/email) git refuses to commit, so the
  // commit goes in as Orb's, like the first commit of a created project.
  const known = async (key) => (await git(project.path, 'config', '--get', key)).stdout.trim() !== '';
  const who = (await known('user.name')) && (await known('user.email')) ? [] : ORB_GIT;
  const r = await git(project.path, ...(only ? [lit] : []), ...who, 'commit', '-q', '-m', msg, ...(only ? ['--', ...only] : []));
  if (r.status !== 0) throw new Error(oneLine(r.stderr || r.stdout, 300));
  // `commit -- paths` reads the files again: if one changed after the check (an agent writing), look at what really went in.
  if (only) {
    const shown = (await git(project.path, '-c', 'core.quotePath=false', 'show', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=', 'HEAD')).stdout;
    // a first commit has no parent to soft-reset to: drop the ref instead
    if (secretsInDiff(shown).length) {
      // `rev-list --parents`: «<sha>» alone is a root commit; if git itself fails the ref is left untouched.
      const rl = await git(project.path, 'rev-list', '--parents', '-n1', 'HEAD');
      // The commit is already in HEAD: say so, and never let the caller go on to push it.
      if (rl.status !== 0) throw new Error(tr('msg.github.committedSecret'));
      await (rl.stdout.trim().split(/\s+/).length > 1 ? git(project.path, 'reset', '-q', '--soft', 'HEAD~1') : git(project.path, 'update-ref', '-d', 'HEAD'));
      await unstage(); throw new Error(tr('msg.github.secretInText', { files: only.slice(0, 5).join(', ') })); }
  }
  const branch = (await git(project.path, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim();
  return { files: staged.length, branch };
}

// Pull requests for the phone. Arguments are always an array (no shell), the number is validated by the caller and gh runs
// inside the project folder so it only ever talks to that project's own remote.
const AUTH_RE = /not logged in|gh auth login|authentication|authenticate|GH_TOKEN|HTTP 401|bad credentials/i;
const MERGE_BLOCK_RE = /not mergeable|conflict|required status|checks?\b.*(fail|pending|expected)|review|blocked|draft|policy|protected/i;
const ghFail = (r) => {
  const text = oneLine(r.err || r.out, 400);
  if (AUTH_RE.test(text)) return new Error(tr('msg.github.notLoggedIn'));
  if (/no github remotes|none of the git remotes|not a git repository|no git remote|could not resolve to a repository/i.test(text)) return new Error(tr('msg.github.noGithubRemote'));
  if (/could not resolve to a pull ?request|no pull requests? found|not found/i.test(text)) return new Error(tr('msg.github.prNotFound'));
  return new Error(text || tr('msg.github.prBadAnswer'));
};
const ghJson = async (project, args) => {
  const r = await gh(args, { cwd: project.path, timeoutMs: 40_000 });
  if (!r.ok) throw ghFail(r);
  try { return JSON.parse(r.out); } catch { throw new Error(tr('msg.github.prBadAnswer')); }
};
export const HEAD_OID_RE = /^[0-9a-f]{40}$/i;
const oidOf = (v) => (typeof v === 'string' && HEAD_OID_RE.test(v) ? v.toLowerCase() : null);
// Who was asked to review and who already did (logins, or a team's name), each once.
const reviewersOf = (x) => [...new Set([...(Array.isArray(x.latestReviews) ? x.latestReviews.map((r) => r?.author) : []), ...(Array.isArray(x.reviewRequests) ? x.reviewRequests : [])]
  .map((r) => oneLine(r?.login ?? r?.name ?? r?.slug ?? '', 80)).filter(Boolean))].slice(0, 10);
const authorOf = (a) => (a && typeof a === 'object' ? String(a.login ?? a.name ?? '') : String(a ?? ''));

export async function listPrs(project) {
  const list = await ghJson(project, ['pr', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,headRefName,headRefOid,baseRefName,url,isDraft,author,updatedAt,reviewDecision,mergeable,isCrossRepository']);
  const out = (Array.isArray(list) ? list : []).slice(0, 30).map((x) => ({ number: x.number, title: oneLine(x.title, 300), headRefName: x.headRefName, headRefOid: oidOf(x.headRefOid), baseRefName: x.baseRefName, url: x.url, isDraft: Boolean(x.isDraft), author: authorOf(x.author), updatedAt: x.updatedAt, reviewDecision: x.reviewDecision || null, mergeable: x.mergeable || null }));
  rememberRepo(project.path, { prs: Array.isArray(list) ? list.slice(0, 30) : undefined });
  return out;
}

// The newest pull request of a branch whatever its state (open, merged or closed): what the PR panel shows once the open one
// is gone. Read-only; a new call, so the field lists of the open-PR reads above stay as they are. null when the branch
// never had one (or only a fork's, which shares the branch name without being ours).
export async function branchPr(project, branch) {
  const name = branchName(branch);
  const list = await ghJson(project, ['pr', 'list', '--state', 'all', '--head', name, '--limit', '5', '--json', 'number,title,headRefName,headRefOid,baseRefName,url,isDraft,isCrossRepository,author,createdAt,updatedAt,mergeable,state']);
  const x = (Array.isArray(list) ? list : []).find((p) => p && Number.isInteger(p.number) && p.headRefName === name && p.isCrossRepository === false);
  if (!x) return null;
  return { number: x.number, title: oneLine(x.title, 300), headRefName: x.headRefName, headRefOid: oidOf(x.headRefOid), baseRefName: x.baseRefName, url: x.url, state: x.state, isDraft: Boolean(x.isDraft),
    author: authorOf(x.author), createdAt: x.createdAt, updatedAt: x.updatedAt, mergeable: x.mergeable || null };
}

export async function viewPr(project, number) {
  const x = await ghJson(project, ['pr', 'view', String(number), '--json', 'number,title,body,state,url,headRefName,headRefOid,baseRefName,isDraft,author,createdAt,updatedAt,mergeable,mergeStateStatus,reviewDecision,additions,deletions,changedFiles,statusCheckRollup,files,commits,reviewRequests,latestReviews,comments']);
  return {
    number: x.number, title: oneLine(x.title, 300), body: String(x.body ?? '').slice(0, 20_000), state: x.state, url: x.url, headRefName: x.headRefName, headRefOid: oidOf(x.headRefOid), baseRefName: x.baseRefName,
    isDraft: Boolean(x.isDraft), author: authorOf(x.author), createdAt: x.createdAt, updatedAt: x.updatedAt, mergeable: x.mergeable || null, mergeStateStatus: x.mergeStateStatus || null,
    reviewDecision: x.reviewDecision || null, reviewers: reviewersOf(x), comments: Array.isArray(x.comments) ? x.comments.length : 0,
    thread: (Array.isArray(x.comments) ? x.comments : []).slice(-20).map((c) => ({ author: authorOf(c?.author), at: c?.createdAt ?? null, body: String(c?.body ?? '').slice(0, 1000) })),
    additions: x.additions ?? 0, deletions: x.deletions ?? 0, changedFiles: x.changedFiles ?? 0,
    checks: (Array.isArray(x.statusCheckRollup) ? x.statusCheckRollup : []).slice(0, 100).map((c) => ({ name: oneLine(c.name ?? c.context ?? '', 120), status: c.status ?? c.state ?? null, conclusion: c.conclusion ?? null })),
    files: (Array.isArray(x.files) ? x.files : []).slice(0, 300).map((f) => ({ path: String(f.path ?? ''), additions: f.additions ?? 0, deletions: f.deletions ?? 0 })),
    commits: (Array.isArray(x.commits) ? x.commits : []).slice(0, 100).map((c) => ({ oid: String(c.oid ?? '').slice(0, 7), title: oneLine(c.messageHeadline ?? '', 200) }))
  };
}

// Merges as the user's own gh account. No --delete-branch, --admin or --auto: the phone cannot skip a rule of the
// repository, and gh leaves the local branch and checkout alone without --delete-branch.
const MERGE_METHODS = ['merge', 'squash', 'rebase'];
// --match-head-commit makes gh merge exactly the commit the user saw; if the branch moved since, GitHub refuses.
const HEAD_MOVED_RE = /head branch was modified|head ref.*(does not match|not match)|expected head sha/i;
const OLD_GH_RE = /unknown flag:? ?--match-head-commit/i;
const userError = (message) => Object.assign(new Error(message), { userFacing: true });
export async function mergePr(project, number, method = 'merge', headRefOid) {
  if (!MERGE_METHODS.includes(method)) throw new Error(tr('msg.github.prFailed'));
  const oid = oidOf(headRefOid);
  if (!oid) throw userError(tr('msg.github.prNeedsHeadOid'));
  const r = await gh(['pr', 'merge', String(number), `--${method}`, '--match-head-commit', oid], { cwd: project.path, timeoutMs: 120_000 });
  if (!r.ok) {
    const text = oneLine(r.err || r.out, 240);
    if (OLD_GH_RE.test(text)) throw userError(tr('msg.github.ghTooOld'));
    if (!AUTH_RE.test(text) && HEAD_MOVED_RE.test(text)) throw userError(tr('msg.github.prHeadChanged'));
    if (!AUTH_RE.test(text) && MERGE_BLOCK_RE.test(text) && !/not found|could not resolve/i.test(text)) throw new Error(tr('msg.github.prNotMergeable', { detail: text }));
    throw ghFail(r);
  }
  const out = { ok: true, number, method };
  // the state afterwards is best effort: the merge itself already happened
  try { const s = await ghJson(project, ['pr', 'view', String(number), '--json', 'state,mergedAt']); out.state = s.state; out.mergedAt = s.mergedAt ?? null; } catch { /* merged anyway */ }
  return out;
}

// A comment on a pull request. The text goes to gh on stdin (--body-file -), never as an argument.
export const MAX_COMMENT = 20_000;
export async function commentPr(project, number, body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text || text.length > MAX_COMMENT) throw userError(tr('msg.github.commentBad', { max: MAX_COMMENT }));
  const r = await gh(['pr', 'comment', String(number), '--body-file', '-'], { cwd: project.path, timeoutMs: 60_000, input: text });
  if (!r.ok) throw ghFail(r);
  return { ok: true, number };
}

// The review threads of a pull request that nobody has resolved (and that are not outdated), for «Arreglar comentarios».
// GraphQL is the only place that knows «resolved». Author and text come from the internet: data, never instructions.
const THREADS_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated path line originalLine comments(first:5){nodes{author{login} body}}}}}}}';
export async function unresolvedThreads(project, number) {
  const repo = (await ghJson(project, ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  const [owner, name] = String(repo ?? '').split('/');
  if (!owner || !name) throw new Error(tr('msg.github.noGithubRemote'));
  const r = await gh(['api', 'graphql', '-f', `query=${THREADS_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${Number(number)}`], { cwd: project.path, timeoutMs: 40_000 });
  if (!r.ok) throw ghFail(r);
  let nodes; try { nodes = JSON.parse(r.out)?.data?.repository?.pullRequest?.reviewThreads?.nodes; } catch { nodes = null; }
  if (!Array.isArray(nodes)) throw new Error(tr('msg.github.prBadAnswer'));
  return nodes.filter((t) => t && !t.isResolved && !t.isOutdated).slice(0, 50).map((t) => ({
    path: oneLine(t.path ?? '', 300), line: Number(t.line ?? t.originalLine) || null,
    comments: (t.comments?.nodes ?? []).slice(0, 5).map((c) => ({ author: oneLine(c?.author?.login ?? '', 60), body: String(c?.body ?? '').slice(0, 1500) }))
  })).filter((t) => t.comments.length);
}

// The checks of a pull request as gh sees them (gh exits non-zero for pending or failed checks, but still prints the JSON).
// bucket: pass | fail | pending | skipping | cancel.
export async function prChecks(project, number) {
  const r = await gh(['pr', 'checks', String(number), '--json', 'name,state,bucket,link,workflow'], { cwd: project.path, timeoutMs: 40_000 });
  let list = null; try { list = JSON.parse(r.out); } catch { /* not JSON */ }
  if (!Array.isArray(list)) { if (!r.ok && /no checks reported/i.test(`${r.err} ${r.out}`)) return []; throw ghFail(r); }
  return list.slice(0, 100).map((c) => ({ name: oneLine(c.name ?? '', 120), workflow: oneLine(c.workflow ?? '', 120), state: String(c.state ?? ''), bucket: String(c.bucket ?? ''), link: typeof c.link === 'string' ? c.link : '' }));
}

// The end of the log of a failed run (the part that says what broke), secrets masked. '' when it cannot be read.
export async function failedLog(project, link, max = 3000) {
  const id = /\/actions\/runs\/(\d{1,15})/.exec(String(link ?? ''))?.[1]; if (!id) return '';
  const r = await gh(['run', 'view', id, '--log-failed'], { cwd: project.path, timeoutMs: 60_000 });
  if (!r.ok) return '';
  return redactSecrets(r.out.replace(/\x1b\[[0-9;]*m/g, '')).slice(-max);
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
