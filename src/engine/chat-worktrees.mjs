// «Local / Worktree» for a direct chat: the chat works in its own git worktree, in a folder Orb manages
// (core\copias\chats, outside the user's repository), on its own branch orb/chat-<id>. What it holds is the
// chat's work, so Orb never deletes it unasked: a folder with changes that are not committed, or a branch with commits
// that live nowhere else, are kept unless the user confirmed (force), and every removal goes through `git worktree
// remove` (which itself refuses a folder with changes) before anything else. One record per chat in the board's
// settings (`chatwt:<session id>`); it outlives the chat when its folder had to be kept, so it can be discarded later.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../platform/context.mjs';
import { ATTACH_DIR } from './sessions.mjs';
import { git, gitAsync, isGitRepo, repoRoot, slug, BRANCH_PREFIX } from '../platform/git.mjs';

const KEY = (id) => `chatwt:${id}`;
const lower = (p) => path.resolve(p).toLowerCase();
const REF_OK = /^[\w][\w./@-]{0,199}$/;
// Ignored folders that a tool rebuilds on its own (dependencies, build output, caches). Exact folder names of well-known
// tools only: any other ignored path (.env, *.db, a folder of local data) may be the user's only copy, so it stays work.
const REGENERABLE_DIRS = new Set(['node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.turbo', '.gradle', '.cache', 'coverage']);
export const regenerable = (p) => { const last = p.replace(/\/+$/, '').split('/').pop(); return REGENERABLE_DIRS.has(last) || /\.py[co]$/.test(last); };
const isRepo = async (dir) => Boolean(dir) && fs.existsSync(dir) && (await gitAsync(dir, {}, 'rev-parse', '--git-dir')).status === 0;

export class ChatWorktrees {
  constructor({ board, sessions, log = () => {} }) { this.board = board; this.sessions = sessions; this.log = log; this.busy = new Set(); }

  // the record of a chat (or of one that is gone and whose folder was kept)
  info(id) { return this.board.settingJson(KEY(id)) ?? null; }
  all() {
    return this.board.all("SELECT key, value FROM settings WHERE key LIKE 'chatwt:%'").flatMap((row) => {
      let v = null; try { v = JSON.parse(row.value); } catch { /* broken */ }
      return v?.path ? [{ id: row.key.slice('chatwt:'.length), ...v }] : [];
    });
  }
  // Only a folder inside Orb's own chats folder is ever touched. The old place (copias\aisladas\chats, used by development
  // builds) is still accepted so a record that points there can be discarded.
  managed(dir) { const d = lower(dir); return [ctx.paths.chatTrees, path.join(ctx.paths.worktrees, 'chats')].some((r) => d.startsWith(lower(r) + path.sep)); }

  // The folder git works in for a chat of `projectName`: its own worktree when it has one (so a commit or a push is the chat's,
  // not the project folder's), null for a chat that works in the project itself. The caller names only the chat: the folder
  // always comes from Orb's own record. Throws for a chat that does not exist or belongs to another project, and for one whose
  // copy is gone (archived), because the project's folder holds none of its work.
  folderFor(sessionId, projectName) {
    const s = this.sessions.get(String(sessionId));
    if (!s || s.kind !== 'chat') throw new Error(tr('msg.chatWt.none'));
    if (!s.project || String(s.project).toLowerCase() !== String(projectName).toLowerCase()) throw new Error(tr('msg.chatWt.notOfProject'));
    // A fork, «continue with another agent» or an edit copy works in the original chat's folder without a record of its own:
    // it uses the record whose folder holds its cwd (same project, inside Orb's chats folder).
    let info = this.info(s.id);
    if (!info && s.cwd) {
      const cwd = lower(s.cwd);
      info = this.all().find((r) => !r.removed && String(r.project).toLowerCase() === String(s.project).toLowerCase() && this.managed(r.path) && (cwd === lower(r.path) || cwd.startsWith(lower(r.path) + path.sep))) ?? null;
    }
    // detached: the chat went back to the project's folder and its copy stayed (it held files that were not joined)
    if (!info || info.detached) return null;
    if (info.removed || !this.managed(info.path) || !fs.existsSync(info.path)) throw new Error(tr('msg.chatWt.noCopy'));
    return info.path;
  }

  // The absolute git common dir of a folder ('' when git cannot say), for telling whether two folders share a repository.
  async commonDir(dir) {
    const r = await gitAsync(dir, {}, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    return r.status === 0 && r.stdout.trim() ? path.resolve(r.stdout.trim()) : '';
  }
  // Whether `repo` is the repository this record's worktree belongs to (any folder inside some other repo does not count).
  async linked(repo, info) {
    if (!(await isRepo(repo))) return false;
    if (fs.existsSync(info.path)) { const mine = await this.commonDir(info.path); return Boolean(mine) && lower(mine) === lower(await this.commonDir(repo)); }
    const list = await gitAsync(repo, {}, 'worktree', 'list', '--porcelain');
    if (list.status === 0 && list.stdout.split(/\r?\n/).some((l) => l.startsWith('worktree ') && lower(l.slice(9)) === lower(info.path))) return true;
    return (await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`)).status === 0;
  }

  // Whether `repo` holds this worktree's branch, or administers a worktree that points at this very folder.
  async madeBy(repo, info) {
    if ((await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`)).status === 0) return true;
    const common = await this.commonDir(repo); if (!common) return false;
    try { return lower(fs.readFileSync(path.join(common, 'worktrees', path.basename(info.path), 'gitdir'), 'utf8').trim()) === lower(path.join(info.path, '.git')); } catch { return false; }
  }

  // The repository of a record, found when it is used: the project may have been moved or renamed since the record was made.
  // Order: the recorded one, the one the worktree itself points at, the project's current folder (repairing the worktree's
  // link to it when the folder was moved by hand). A changed answer is saved. '' when there is none.
  async repoOf(id, info) {
    if (await this.linked(info.repo, info)) return info.repo;
    const save = (repo) => { info.repo = repo; this.board.settingJson(KEY(id), info); return repo; };
    if (fs.existsSync(info.path)) {
      const common = await this.commonDir(info.path);
      if (common) {
        // a normal repository: the folder that holds .git; a bare one (or a separate git dir): the git dir itself is the repository
        const repo = path.basename(common).toLowerCase() === '.git' ? path.dirname(common) : common;
        if (await isRepo(repo)) return save(repo);
      }
    }
    const now = this.board.project(info.project)?.path;
    if (now && await isRepo(now)) {
      // repair re-links the folder to that repository, so only when it is the one that made it: another repository may
      // administer a worktree under the same folder name, and repairing would take that one over
      if (fs.existsSync(info.path) && !(await this.commonDir(info.path)) && await this.madeBy(now, info)) await gitAsync(now, {}, 'worktree', 'repair', '--', info.path);
      if (await this.linked(now, info)) return save(now);
    }
    return '';
  }

  // Follows a project that was renamed or moved: the records that pointed at the old name or folder point at the new one.
  followProject(oldName, oldPath, project) {
    for (const { id, ...info } of this.all()) {
      const sameRepo = Boolean(info.repo) && lower(info.repo) === lower(oldPath);
      if (info.project !== oldName && !sameRepo) continue;
      this.board.settingJson(KEY(id), { ...info, project: info.project === oldName ? project.name : info.project, repo: sameRepo ? project.path : info.repo });
    }
  }

  // Branches the user can start from: the repository's local branches, the current one first.
  branches(projectPath) {
    if (!isGitRepo(projectPath)) return { git: false, current: null, branches: [] };
    const cur = git(projectPath, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    const list = git(projectPath, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').stdout.split(/\r?\n/).map((x) => x.trim()).filter((b) => b && !b.startsWith(`${BRANCH_PREFIX}/`));
    return { git: true, current: cur && cur !== 'HEAD' ? cur : null, branches: [...new Set([...(cur && cur !== 'HEAD' ? [cur] : []), ...list])] };
  }

  // Makes the worktree of chat `id` for `project`, from `base` (a local branch or commit; the current HEAD by default).
  // → { cwd, info }. Throws, leaving nothing behind, when it cannot.
  // extra: fields saved with the record BEFORE git is asked to make the folder, so a switch cut short leaves a journal to finish or undo.
  create({ id, project, base, extra = null }) {
    const root = isGitRepo(project.path) ? repoRoot(project.path) : null;
    if (!root) throw new Error(tr('msg.chatWt.notGit'));
    const from = base == null || base === '' ? 'HEAD' : String(base);
    if (from !== 'HEAD' && (!REF_OK.test(from) || from.includes('..') || from.startsWith(`${BRANCH_PREFIX}/`))) throw new Error(tr('msg.chatWt.badBase', { base: from }));
    const sha = git(project.path, 'rev-parse', '--verify', '--quiet', `${from}^{commit}`).stdout.trim();
    if (!sha) throw new Error(from === 'HEAD' ? tr('msg.chatWt.noCommits') : tr('msg.chatWt.badBase', { base: from }));
    const short = String(id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
    // A chat that goes to a copy again (an earlier copy's branch may be kept for its undo point) gets a new name, never a reused one.
    let branch; let dir;
    for (let n = 1; ; n++) {
      const tail = n > 1 ? `-${n}` : '';
      branch = `${BRANCH_PREFIX}/chat-${short}${tail}`; dir = path.join(ctx.paths.chatTrees, `${slug(project.name)}-${short}${tail}`);
      if (!extra || n > 50 || (!fs.existsSync(dir) && git(project.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status !== 0)) break;
    }
    if (!this.managed(dir)) throw new Error(tr('msg.chatWt.badBase', { base: dir }));
    if (fs.existsSync(dir)) throw new Error(tr('msg.chatWt.exists', { dir }));
    fs.mkdirSync(ctx.paths.chatTrees, { recursive: true });
    git(project.path, 'worktree', 'prune'); // a folder deleted by hand is still registered in git
    if (git(project.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0) throw new Error(tr('msg.chatWt.exists', { dir: branch }));
    // A project that lives in a subfolder of a repo works in the same subfolder of its worktree.
    const prefix = git(project.path, 'rev-parse', '--show-prefix').stdout.trim().replace(/[\\/]$/, '');
    const info = { project: project.name, repo: project.path, path: dir, branch, base: from === 'HEAD' ? (git(project.path, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() || 'HEAD') : from, baseSha: sha, prefix, at: new Date().toISOString(), ...(extra ?? {}) };
    if (extra) this.board.settingJson(KEY(id), info);
    const res = git(project.path, 'worktree', 'add', '-b', branch, dir, sha);
    if (res.status !== 0) { if (extra) this.board.settingJson(KEY(id), null); throw new Error(tr('msg.workspace.worktreeFailed', { error: res.stderr.trim() })); }
    this.board.settingJson(KEY(id), info);
    return { cwd: prefix ? path.join(dir, prefix) : dir, info };
  }

  // What the chat's folder holds that would be lost: files not committed, and commits only its branch has.
  // The list shown stops at 50; dirtyTotal and fingerprint cover all of it.
  async status(id) {
    const info = this.info(id);
    if (!info) return { has: false };
    const out = { has: true, project: info.project, path: info.path, branch: info.branch, base: info.base, gone: !fs.existsSync(info.path), dirty: [], regenerable: 0, ahead: 0, merged: true };
    const repo = await this.repoOf(id, info);
    out.orphan = !repo;
    if (!out.gone && !repo) {
      // Git cannot tell what changed without its repository, so every file the folder holds counts as work (the user can
      // still remove it with force); only an empty folder, or one with just the .git pointer, is clean.
      let names = []; try { names = fs.readdirSync(info.path); } catch { out.unknown = true; names = ['?']; }
      out.dirty = names.filter((n) => n !== '.git' && n !== ATTACH_DIR).map((n) => `${n} (orphan)`);
    } else if (!out.gone) {
      // Ignored files too (.env, local databases): removing the folder would delete them. Only what a tool rebuilds
      // (REGENERABLE_DIRS) is told apart and does not count. Orb's own attachments folder is not work.
      const [st, ig] = await Promise.all([gitAsync(info.path, {}, 'status', '--porcelain=v1', '-uall'), gitAsync(info.path, {}, 'status', '--porcelain=v1', '--ignored=matching')]);
      if (st.status !== 0 || ig.status !== 0) { out.unknown = true; out.dirty = ['?']; } else {
        const lines = (r) => r.stdout.split(/\r?\n/).filter(Boolean);
        const ignored = lines(ig).filter((l) => l.startsWith('!!')).map((l) => l.slice(3));
        out.regenerable = ignored.filter(regenerable).length;
        out.dirty = [...ignored.filter((q) => !regenerable(q)).map((q) => `${q} (ignored)`), ...lines(st).map((l) => l.slice(3))].filter((q) => !q.startsWith(`${ATTACH_DIR}/`));
      }
      // commits made on a detached HEAD belong to no branch: they must be somewhere else before the folder goes
      const head = await gitAsync(info.path, {}, 'rev-parse', 'HEAD');
      const sym = await gitAsync(info.path, {}, 'symbolic-ref', '-q', 'HEAD');
      if (repo && head.status === 0 && sym.stdout.trim() !== `refs/heads/${info.branch}`) {
        const c = await gitAsync(repo, {}, 'for-each-ref', '--contains', head.stdout.trim(), '--format=%(refname)', 'refs/heads', 'refs/tags');
        if (!c.stdout.split(/\r?\n/).some((r) => r.trim() && !r.startsWith(`refs/heads/${BRANCH_PREFIX}/`))) { out.detached = true; out.dirty.push('HEAD (detached commits)'); }
      }
    }
    // without a repository the branch is unreachable: nothing to compare, nothing to delete
    const has = repo ? await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`) : { status: 1 };
    out.branchGone = has.status !== 0;
    if (!out.branchGone) {
      const n = await gitAsync(repo, {}, 'rev-list', '--count', `${info.baseSha}..refs/heads/${info.branch}`);
      out.ahead = n.status === 0 ? Number(n.stdout.trim()) || 0 : 1;
      // commits that are in another branch (merged back into the one it started from, or any local one) are not lost
      if (out.ahead > 0) {
        const other = await gitAsync(repo, {}, 'for-each-ref', '--contains', `refs/heads/${info.branch}`, '--format=%(refname)', 'refs/heads');
        // another orb/ branch does not count: it may be removed too
        out.merged = other.status === 0 && other.stdout.split(/\r?\n/).some((r) => r.trim() && !r.trim().startsWith(`refs/heads/${BRANCH_PREFIX}/`));
      }
    }
    out.dirtyTotal = out.dirty.length;
    // what a forced removal must have been shown: any change to the whole list, shown part or not, changes it
    out.fingerprint = crypto.createHash('sha1').update([...out.dirty].sort().join(String.fromCharCode(10))).digest('hex');
    out.dirty = out.dirty.slice(0, 50);
    out.safe = !out.dirty.length && (out.ahead === 0 || out.merged);
    return out;
  }

  // Removes the folder of chat `id` and, when nothing would be lost, its branch.
  // force: the user confirmed losing the changes not committed (and, with branch: 'delete', the commits only the branch has).
  // branch: 'auto' (delete it only when it holds nothing that is not elsewhere), 'keep', 'delete' (needs force when it has commits of its own).
  // → { removed, kept?: 'dirty'|'unverified'|'busy'|'locked'|'shared', branchKept?, dirty?, error? }; never throws.
  // fingerprint: the status's fingerprint when the user confirmed; force without the current one keeps the folder (the list changed).
  // unverified: remove even when Orb could not check the folder's content (no repository, or git failed); the app never sets it.
  async release(id, { force = false, branch = 'auto', closeLive = true, fingerprint = null, unverified = false } = {}) {
    const info = this.info(id);
    if (!info) return { removed: false, none: true };
    if (this.busy.has(id)) return { removed: false, kept: 'busy' };
    this.busy.add(id);
    try {
      if (!this.managed(info.path)) { this.board.settingJson(KEY(id), null); return { removed: false, error: tr('msg.chatWt.outside') }; }
      // the folder is also the cwd of a chat that is not this one (a fork made from it): it stays while that one needs it
      const users = this.board.all('SELECT id, title, cwd FROM sessions WHERE id <> ? AND cwd IS NOT NULL', id).filter((s) => lower(s.cwd) === lower(info.path) || lower(s.cwd).startsWith(lower(info.path) + path.sep));
      if (users.length) return { removed: false, kept: 'shared', sessions: users.map((s) => s.title) };
      const owner = this.sessions.get(id);
      if (owner && this.sessions.isRunning(id)) return { removed: false, kept: 'busy' };
      if (owner && closeLive) { try { this.sessions.closeLive(id); } catch (error) { this.log(`cerrar chat ${id}: ${error.message}`); } }
      const st = await this.status(id);
      // what Orb cannot check it does not delete, not even with force
      if (st.dirty.length && (st.unknown || st.orphan) && !unverified) return { removed: false, kept: 'unverified', dirty: st.dirty, dirtyTotal: st.dirtyTotal };
      if (st.dirty.length && !force) return { removed: false, kept: 'dirty', dirty: st.dirty, dirtyTotal: st.dirtyTotal };
      if (force && !unverified && fingerprint !== st.fingerprint) return { removed: false, kept: 'dirty', dirty: st.dirty, dirtyTotal: st.dirtyTotal, changed: true };
      if (this.sessions.isRunning(id)) return { removed: false, kept: 'busy' }; // a turn may have started while git was asked
      const repo = await this.repoOf(id, info);
      let removedFolder = st.gone;
      if (!st.gone) {
        // git itself refuses a folder with changes; `--force` only after the user said so. With no repository left (the
        // project is gone) the folder is an orphan: managed() above guarantees it is Orb's own, and st.dirty was checked.
        const r = repo ? await gitAsync(repo, {}, 'worktree', 'remove', ...(force ? ['--force'] : []), '--', info.path) : { status: 1, stderr: '' };
        if (r.status !== 0 && !repo) {
          try { fs.rmSync(info.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (error) { return { removed: false, kept: 'locked', error: error.message }; }
        } else if (r.status !== 0) {
          this.log(`quitar worktree del chat ${id}: ${r.stderr.trim()}`);
          if (!force) return { removed: false, kept: /modified|untracked|changes/i.test(r.stderr) ? 'dirty' : 'locked', error: r.stderr.trim() };
          // a program of the agent still holds the folder open: delete it by hand (only inside Orb's folder, links never followed into)
          try { fs.rmSync(info.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (error) { return { removed: false, kept: 'locked', error: error.message }; }
        }
        removedFolder = !fs.existsSync(info.path);
        if (!removedFolder) return { removed: false, kept: 'locked' };
      }
      if (repo) await gitAsync(repo, {}, 'worktree', 'prune');
      const out = { removed: true };
      if (!st.branchGone && branch !== 'keep') {
        const lost = st.ahead > 0 && !st.merged;
        if (!lost) { const r = await gitAsync(repo, {}, 'branch', '-D', info.branch); if (r.status !== 0) out.branchKept = true; }
        else if (branch === 'delete' && force) { const r = await gitAsync(repo, {}, 'branch', '-D', info.branch); if (r.status !== 0) out.branchKept = true; }
        else out.branchKept = true;
      } else if (!st.branchGone) out.branchKept = true;
      // the record goes with the chat; a chat that stays (archived) keeps it, marked, to bring the folder back on restore
      this.board.settingJson(KEY(id), this.sessions.get(id) ? { ...info, removed: true } : null);
      return out;
    } catch (error) { this.log(`chat worktree ${id}: ${error.message}`); return { removed: false, error: error.message }; } finally { this.busy.delete(id); }
  }

  // A chat taken out of the archive whose folder was removed gets it back: on its own branch when that was kept,
  // from the base it started from otherwise.
  async ensure(id) {
    const info = this.info(id);
    if (!info || !info.removed) return { restored: false };
    if (!this.managed(info.path)) throw new Error(tr('msg.chatWt.outside'));
    if (fs.existsSync(info.path)) throw new Error(tr('msg.chatWt.exists', { dir: info.path }));
    // the folder is gone, so only the recorded repository or the project's current folder can host it again
    if (!(await isRepo(info.repo))) {
      const now = this.board.project(info.project)?.path;
      if (!(await isRepo(now))) throw new Error(tr('msg.workspace.worktreeFailed', { error: info.repo }));
      info.repo = now; this.board.settingJson(KEY(id), info);
    }
    await gitAsync(info.repo, {}, 'worktree', 'prune');
    const has = (await gitAsync(info.repo, {}, 'rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`)).status === 0;
    const r = has ? await gitAsync(info.repo, {}, 'worktree', 'add', '--', info.path, info.branch) : await gitAsync(info.repo, {}, 'worktree', 'add', '-b', info.branch, '--', info.path, info.baseSha);
    if (r.status !== 0) throw new Error(tr('msg.workspace.worktreeFailed', { error: r.stderr.trim() }));
    const { removed, ...rest } = info; this.board.settingJson(KEY(id), rest);
    return { restored: true };
  }
}
