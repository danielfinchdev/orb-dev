// «Local / Worktree» for a direct chat: the chat works in its own git worktree, in a folder Orb manages
// (core\copias\aisladas\chats, outside the user's repository), on its own branch orb/chat-<id>. What it holds is the
// chat's work, so Orb never deletes it unasked: a folder with changes that are not committed, or a branch with commits
// that live nowhere else, are kept unless the user confirmed (force), and every removal goes through `git worktree
// remove` (which itself refuses a folder with changes) before anything else. One record per chat in the board's
// settings (`chatwt:<session id>`); it outlives the chat when its folder had to be kept, so it can be discarded later.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../platform/context.mjs';
import { git, gitAsync, isGitRepo, repoRoot, slug, BRANCH_PREFIX } from '../platform/git.mjs';

const KEY = (id) => `chatwt:${id}`;
const lower = (p) => path.resolve(p).toLowerCase();
const REF_OK = /^[\w][\w./@-]{0,199}$/;

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
  // only a folder inside Orb's own chats folder is ever touched
  managed(dir) { const root = lower(ctx.paths.chatTrees); const d = lower(dir); return d.startsWith(root + path.sep); }

  // Branches the user can start from: the repository's local branches, the current one first.
  branches(projectPath) {
    if (!isGitRepo(projectPath)) return { git: false, current: null, branches: [] };
    const cur = git(projectPath, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    const list = git(projectPath, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').stdout.split(/\r?\n/).map((x) => x.trim()).filter((b) => b && !b.startsWith(`${BRANCH_PREFIX}/`));
    return { git: true, current: cur && cur !== 'HEAD' ? cur : null, branches: [...new Set([...(cur && cur !== 'HEAD' ? [cur] : []), ...list])] };
  }

  // Makes the worktree of chat `id` for `project`, from `base` (a local branch or commit; the current HEAD by default).
  // → { cwd, info }. Throws, leaving nothing behind, when it cannot.
  create({ id, project, base }) {
    const root = isGitRepo(project.path) ? repoRoot(project.path) : null;
    if (!root) throw new Error(tr('msg.chatWt.notGit'));
    const from = base == null || base === '' ? 'HEAD' : String(base);
    if (from !== 'HEAD' && (!REF_OK.test(from) || from.includes('..'))) throw new Error(tr('msg.chatWt.badBase', { base: from }));
    const sha = git(project.path, 'rev-parse', '--verify', '--quiet', `${from}^{commit}`).stdout.trim();
    if (!sha) throw new Error(from === 'HEAD' ? tr('msg.chatWt.noCommits') : tr('msg.chatWt.badBase', { base: from }));
    const short = String(id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
    const branch = `${BRANCH_PREFIX}/chat-${short}`;
    const dir = path.join(ctx.paths.chatTrees, `${slug(project.name)}-${short}`);
    if (!this.managed(dir)) throw new Error(tr('msg.chatWt.badBase', { base: dir }));
    if (fs.existsSync(dir)) throw new Error(tr('msg.chatWt.exists', { dir }));
    fs.mkdirSync(ctx.paths.chatTrees, { recursive: true });
    git(project.path, 'worktree', 'prune'); // a folder deleted by hand is still registered in git
    if (git(project.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0) throw new Error(tr('msg.chatWt.exists', { dir: branch }));
    const res = git(project.path, 'worktree', 'add', '-b', branch, dir, sha);
    if (res.status !== 0) throw new Error(tr('msg.workspace.worktreeFailed', { error: res.stderr.trim() }));
    // A project that lives in a subfolder of a repo works in the same subfolder of its worktree.
    const prefix = git(project.path, 'rev-parse', '--show-prefix').stdout.trim().replace(/[\\/]$/, '');
    const info = { project: project.name, repo: project.path, path: dir, branch, base: from === 'HEAD' ? (git(project.path, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() || 'HEAD') : from, baseSha: sha, prefix, at: new Date().toISOString() };
    this.board.settingJson(KEY(id), info);
    return { cwd: prefix ? path.join(dir, prefix) : dir, info };
  }

  // What the chat's folder holds that would be lost: files not committed, and commits only its branch has.
  async status(id) {
    const info = this.info(id);
    if (!info) return { has: false };
    const out = { has: true, project: info.project, path: info.path, branch: info.branch, base: info.base, gone: !fs.existsSync(info.path), dirty: [], ahead: 0, merged: true };
    if (!out.gone) {
      const st = await gitAsync(info.path, {}, 'status', '--porcelain=v1', '-uall');
      if (st.status !== 0) { out.unknown = true; out.dirty = ['?']; } else out.dirty = st.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3));
    }
    const has = await gitAsync(info.repo, {}, 'rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`);
    out.branchGone = has.status !== 0;
    if (!out.branchGone) {
      const n = await gitAsync(info.repo, {}, 'rev-list', '--count', `${info.baseSha}..refs/heads/${info.branch}`);
      out.ahead = n.status === 0 ? Number(n.stdout.trim()) || 0 : 1;
      // commits that are in another branch (merged back into the one it started from, or any local one) are not lost
      if (out.ahead > 0) {
        const other = await gitAsync(info.repo, {}, 'for-each-ref', '--contains', `refs/heads/${info.branch}`, '--format=%(refname)', 'refs/heads');
        out.merged = other.status === 0 && other.stdout.split(/\r?\n/).some((r) => r.trim() && r.trim() !== `refs/heads/${info.branch}`);
      }
    }
    out.dirty = out.dirty.slice(0, 50);
    out.safe = !out.dirty.length && (out.ahead === 0 || out.merged);
    return out;
  }

  // Removes the folder of chat `id` and, when nothing would be lost, its branch.
  // force: the user confirmed losing the changes not committed (and, with branch: 'delete', the commits only the branch has).
  // branch: 'auto' (delete it only when it holds nothing that is not elsewhere), 'keep', 'delete' (needs force when it has commits of its own).
  // → { removed, kept?: 'dirty'|'busy'|'locked'|'shared', branchKept?, dirty?, error? }; never throws.
  async release(id, { force = false, branch = 'auto', closeLive = true } = {}) {
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
      if (st.dirty.length && !force) return { removed: false, kept: 'dirty', dirty: st.dirty };
      let removedFolder = st.gone;
      if (!st.gone) {
        // git itself refuses a folder with changes; `--force` only after the user said so.
        const r = await gitAsync(info.repo, {}, 'worktree', 'remove', ...(force ? ['--force'] : []), '--', info.path);
        if (r.status !== 0) {
          this.log(`quitar worktree del chat ${id}: ${r.stderr.trim()}`);
          if (!force) return { removed: false, kept: /modified|untracked|changes/i.test(r.stderr) ? 'dirty' : 'locked', error: r.stderr.trim() };
          // a program of the agent still holds the folder open: delete it by hand (only inside Orb's folder, links never followed into)
          try { fs.rmSync(info.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (error) { return { removed: false, kept: 'locked', error: error.message }; }
        }
        removedFolder = !fs.existsSync(info.path);
        if (!removedFolder) return { removed: false, kept: 'locked' };
      }
      await gitAsync(info.repo, {}, 'worktree', 'prune');
      const out = { removed: true };
      if (!st.branchGone && branch !== 'keep') {
        const lost = st.ahead > 0 && !st.merged;
        if (!lost) { const r = await gitAsync(info.repo, {}, 'branch', '-D', info.branch); if (r.status !== 0) out.branchKept = true; }
        else if (branch === 'delete' && force) { const r = await gitAsync(info.repo, {}, 'branch', '-D', info.branch); if (r.status !== 0) out.branchKept = true; }
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
    await gitAsync(info.repo, {}, 'worktree', 'prune');
    const has = (await gitAsync(info.repo, {}, 'rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`)).status === 0;
    const r = has ? await gitAsync(info.repo, {}, 'worktree', 'add', '--', info.path, info.branch) : await gitAsync(info.repo, {}, 'worktree', 'add', '-b', info.branch, '--', info.path, info.baseSha);
    if (r.status !== 0) throw new Error(tr('msg.workspace.worktreeFailed', { error: r.stderr.trim() }));
    const { removed, ...rest } = info; this.board.settingJson(KEY(id), rest);
    return { restored: true };
  }
}
