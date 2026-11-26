// Moves a chat between the project's folder and its own copy (git worktree) in the middle of the conversation, and back.
//
// To the copy: what the chat changed in the folder (the union, turn by turn, of «photo before the turn → photo after the
// turn») goes to the copy and is taken out of the folder; what the user or another chat or task changed stays and is never
// touched. The steps are written in the chat's `chatwt:` record before they happen, so a switch cut short is finished or
// undone at the next start, and any failure puts the folder, the copy, the branch, the chat's folder and its agent
// conversation back as they were.
// Back: «Unir» brings the copy's work into the folder with an undo point that belongs to the chat (`chatcp:`); a conflict
// is resolved by the chat's agent INSIDE the copy; «Descartar» removes the copy and its branch after the user confirmed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../platform/context.mjs';
import { gitAsync, gitBufferAsync, repoRootAsync, isGitRepoAsync, ORB_GIT, REF_PREFIX } from '../platform/git.mjs';
import { fullSnapshot, undoCheckpointAsync, changedBetweenAsync, integrateIntoAsync, RAW_GIT } from '../domain/tasks/checkpoints.mjs';
import { turnPairs, forgetPhotos, retirePhotos, restorePhotos, photoMarks, dirtyFiles, startDirtyOf } from '../domain/conversations/turns.mjs';
import { isSecretPath } from '../shared/secrets-scan.mjs';
import { regenerable } from './chat-worktrees.mjs';
import { account, accountDir } from '../domain/usage/accounts.mjs';
import { oneLine } from '../shared/text.mjs';

const KEY = (id) => `chatwt:${id}`;
const MOVES = (id) => `chatmoves:${id}`;
const POINT = (id) => `chatcp:${id}`;
const RESOLVE = (id) => `chatres:${id}`;
const PENDING = (id) => `chatcopy_next:${id}`;
const SHOWN = 30; // files named in a list; the counts are whole
const HASH = /^[0-9a-f]{40,64}$/;
const lower = (p) => path.resolve(p).toLowerCase();
const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });
const sha1 = (parts) => crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
const sorted = (set) => [...set].sort();
const take = (list) => list.slice(0, SHOWN);

// No component of `target` (from root down) may be a link or junction: a link in the middle could point outside the folder.
function linkFree(root, target) {
  let cur = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cur = path.join(cur, part);
    try { if (fs.lstatSync(cur).isSymbolicLink()) return false; } catch { return true; }
  }
  return true;
}
// The id Claude Code gives a folder in its sessions directory: every character that is not a letter or digit becomes «-».
export const claudeProjectName = (cwd) => path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-');

// The conversation of Claude Code lives in <config folder>/projects/<folder name>/<id>.jsonl. It is found by its id (the
// folder it was made in may be another one by now) and put in the folder name of the new place, so `resume` finds it there.
// The newest copy is the source: it is the one the chat last wrote to. → true when the file is in place.
export function followClaudeSession({ configDir, sessionId, toCwd }) {
  if (!sessionId || !/^[\w-]{8,80}$/.test(sessionId)) return false;
  const root = path.join(configDir, 'projects');
  let best = null;
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const file = path.join(root, d.name, `${sessionId}.jsonl`);
      try { const st = fs.statSync(file); if (!best || st.mtimeMs > best.at) best = { file, dir: path.join(root, d.name), at: st.mtimeMs }; } catch { /* not in this one */ }
    }
  } catch { return false; }
  if (!best) return false;
  const destDir = path.join(root, claudeProjectName(toCwd));
  if (path.resolve(destDir).toLowerCase() === path.resolve(best.dir).toLowerCase()) return true;
  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(best.file, path.join(destDir, `${sessionId}.jsonl`));
    // what the conversation keeps beside it (its helpers' own lines, long tool results)
    const side = path.join(best.dir, sessionId);
    if (fs.existsSync(side)) fs.cpSync(side, path.join(destDir, sessionId), { recursive: true, force: true });
    return true;
  } catch { return false; }
}

export class ChatCopy {
  // hold(project) → release; held(project): the scheduler's lock on a folder. claudeDir(session) overrides where Claude's
  // conversations are looked for (tests).
  constructor({ board, sessions, chatTrees, hold, held, log = () => {}, claudeDir = null }) {
    this.board = board; this.sessions = sessions; this.chatTrees = chatTrees; this.hold = hold; this.held = held; this.log = log;
    this.claudeDir = claudeDir ?? ((s) => { const acc = account(s.account); return acc ? accountDir(acc) : accountDir({ agent: 'claude' }); });
    this.working = new Set();
  }

  record(id) { return this.chatTrees.info(id); }
  lastItem(id) { return Number(this.board.one('SELECT MAX(id) AS id FROM session_items WHERE session_id = ?', id)?.id ?? 0); }
  moves(id) { return this.board.settingJson(MOVES(id)) ?? []; }
  // The list is capped, keeping the first move and the last ones: what blocks a rewind is the last item, so nothing old unlocks.
  addMove(id, to, item = this.lastItem(id)) {
    const all = [...this.moves(id), { item, to, at: new Date().toISOString() }];
    this.board.settingJson(MOVES(id), all.length > 20 ? [all[0], ...all.slice(-19)] : all);
  }
  point(id) { return this.board.settingJson(POINT(id)) ?? null; }

  // What the chat is now: 'local' (the project's folder), 'copy' (its own copy, usable) or null (not a chat of a git project).
  where(id) {
    const s = this.sessions.get(id);
    if (!s || s.kind !== 'chat' || !s.project) return null;
    const info = this.record(id);
    return info && !info.removed && !info.detached && !info.switching ? 'copy' : 'local';
  }

  // The checks every move shares. → { s, project }
  check(id) {
    const s = this.sessions.get(String(id));
    if (!s || s.kind !== 'chat') throw userError('msg.chatWt.none');
    if (!s.project) throw userError('msg.chatWt.needsProject');
    const project = this.board.project(s.project);
    if (!project) throw userError('msg.copy.noProject');
    if (s.archived || s.trashed_at) throw userError('msg.copy.archived');
    if (this.working.has(s.id) || this.chatTrees.busy.has(s.id)) throw userError('msg.copy.working');
    if (this.sessions.isRunning(s.id) || this.sessions.pendingApprovals(s.id).length) throw userError('msg.copy.busy');
    return { s, project };
  }
  // Someone is writing in the folder right now: a task in it, or another chat of the project.
  folderBusy(project, except) {
    if (this.held(project.name)) return true;
    const here = lower(project.path);
    return [...this.sessions.running.keys()].some((rid) => {
      if (rid === except) return false;
      const o = this.sessions.get(rid);
      return o && o.cwd && (lower(o.cwd) === here || lower(o.cwd).startsWith(here + path.sep));
    });
  }

  // ----- to the copy -----

  // What moving the chat would do, read only (it takes a fresh photo of the folder, which touches nothing of the user's).
  // → { ok: true, fingerprint, files, mixed, others, stay, staged, ... } | { ok: false, why, message }
  async plan(id) { const { s, project } = this.check(id); return this.planFor(s, project); }
  async planFor(s, project) {
    const id = s.id;
    const info = this.record(id);
    if (info && !info.removed && !info.detached) throw userError('msg.copy.already');
    const refuse = (why, key, vars) => ({ ok: false, why, message: tr(key, vars) });
    if (!(await isGitRepoAsync(project.path))) return refuse('git', 'msg.chatWt.notGit');
    const repo = await repoRootAsync(project.path);
    const head = (await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', 'HEAD')).stdout.trim();
    if (!head) return refuse('commits', 'msg.chatWt.noCommits');
    const pairs = await turnPairs(s.cwd, s.id);
    if (!pairs.ok && pairs.why === 'old') return refuse('old', 'msg.copy.old');
    const snap = await fullSnapshot(repo, { message: `orb: foto de la carpeta al pasar el chat ${s.id} a una copia aparte` });
    if (!snap?.commit) return refuse('read', 'msg.copy.cannotRead');
    // the branch of the folder is the one the chat started on: a moved HEAD means the chat's files cannot be told apart from commits
    if (pairs.ok) {
      const start = (await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `${pairs.zero}^`)).stdout.trim();
      if (start !== head) return refuse('head', 'msg.copy.headMoved');
    }
    const files = (list) => list.map((c) => c.path);
    const chat = new Set(); const between = new Set(); const startDirty = new Set(); const tail = new Set();
    if (pairs.ok) {
      const jobs = [];
      const add = (a, b, into) => jobs.push(() => changedBetweenAsync(repo, a, b).then((l) => files(l).forEach((p) => into.add(p))));
      pairs.turns.forEach((t, i) => {
        add(t.pre, t.post, chat);
        // another chat or a task wrote in the folder during this turn: its files are not only the chat's
        if (t.overlap) add(t.pre, t.post, between);
        if (i > 0) add(pairs.turns[i - 1].post, t.pre, between);
      });
      add(pairs.turns.at(-1).post, snap.commit, tail);
      // in batches: a chat of hundreds of turns must not start hundreds of git processes at once
      for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((run) => run()));
    }
    // what differs from HEAD is what git says (a photo is raw and HEAD is not: with CRLF on disk every file would differ)
    const dirty = await dirtyFiles(repo);
    const started = pairs.ok ? await startDirtyOf(repo, pairs.zero) : null;
    if (started) started.forEach((p) => startDirty.add(p));
    const moves = sorted([...chat].filter((p) => dirty.has(p) && !isSecretPath(p)));
    const mixed = moves.filter((p) => between.has(p) || tail.has(p) || startDirty.has(p));
    const others = sorted([...dirty.keys()].filter((p) => !chat.has(p)));
    const state = await gitAsync(repo, {}, 'status', '--porcelain=v1', '-z', '-uall', '--ignored=matching');
    const entries = state.status === 0 ? state.stdout.split('\0').filter((e) => e.length > 3) : [];
    const ignored = entries.filter((e) => e.startsWith('!!')).map((e) => e.slice(3)).filter((p) => !regenerable(p));
    const secret = entries.filter((e) => !e.startsWith('!!')).map((e) => e.slice(3)).filter(isSecretPath);
    const staged = (await gitAsync(repo, {}, 'diff', '--cached', '--name-only', '-z', 'HEAD')).stdout.split('\0').filter(Boolean);
    const tree = (await gitAsync(repo, {}, 'rev-parse', `${snap.commit}^{tree}`)).stdout.trim();
    return {
      ok: true, snap: snap.commit, head, repo, zero: pairs.ok ? pairs.zero : null,
      files: moves.map((p) => ({ path: p, status: dirty.get(p) })), mixed, others,
      stay: { ignored: take(ignored), ignoredTotal: ignored.length, secret: take(secret), secretTotal: secret.length },
      staged: take(staged), stagedTotal: staged.length,
      // the list the user saw: any change to the folder, or to who owns a file, makes the decision a new one
      fingerprint: sha1([tree, 'm', ...moves, 'x', ...mixed, 'o', ...others]),
    };
  }
  // The plan as the window shows it (without the internals).
  async preview(id) {
    const p = await this.plan(id);
    if (!p.ok) return p;
    const { snap, head, repo, zero, ...shown } = p;
    return { ...shown, files: take(p.files.map((f) => f)), filesTotal: p.files.length, others: take(p.others), othersTotal: p.others.length, mixed: take(p.mixed), mixedTotal: p.mixed.length };
  }

  // The chat's files from the photo S into the copy, one by one, never through a link.
  async writeCopy(repo, snap, copyRoot, plan, carried) {
    const status = new Map(plan.files.map((f) => [f.path, f.status]));
    for (const rel of carried) {
      const dest = path.join(copyRoot, rel);
      if (!linkFree(copyRoot, dest) || path.relative(copyRoot, dest).startsWith('..')) throw new Error(`${rel}: ${tr('msg.copy.link')}`);
      if (status.get(rel) === 'D') { fs.rmSync(dest, { force: true }); continue; }
      const blob = await gitBufferAsync(repo, ...RAW_GIT, 'cat-file', '--filters', `${snap}:${rel}`);
      if (blob.status !== 0) throw new Error(`${rel}: ${String(blob.stderr ?? '').trim()}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, blob.stdout);
    }
  }

  setJournal(id, extra) {
    const info = this.record(id); if (!info?.switching) return;
    this.board.settingJson(KEY(id), { ...info, switching: { ...info.switching, ...extra } });
  }
  setPhase(id, phase) {
    const info = this.record(id); if (!info?.switching) return;
    this.board.settingJson(KEY(id), { ...info, switching: { ...info.switching, phase } });
  }

  // The chat goes to its own copy. `fingerprint` is the one of the plan the user saw; `mixed`: 'take' | 'leave' for the files
  // someone else also changed; `ack`: the user agreed to leave their own changes where they are.
  async toCopy(id, { fingerprint, mixed = null, ack = false } = {}) {
    const { s, project } = this.check(id);
    if (this.folderBusy(project, s.id)) throw userError('msg.copy.folderBusy');
    this.working.add(s.id); this.sessions.moving.add(s.id);
    const release = this.hold(project.name);
    let journal = false;
    try {
      const plan = await this.planFor(s, project);
      if (!plan.ok) throw userError('msg.copy.refused', { why: plan.message });
      if (plan.fingerprint !== fingerprint) throw userError('msg.copy.changed');
      if (plan.others.length && ack !== true) throw userError('msg.copy.needAck');
      if (plan.mixed.length && mixed !== 'take' && mixed !== 'leave') throw userError('msg.copy.needMixed');
      const left = new Set(mixed === 'leave' ? plan.mixed : []);
      const carried = plan.files.map((f) => f.path).filter((p) => !left.has(p));
      const { repo, head } = plan;
      // the rescue point of the folder: the photo that was just taken, kept under a ref of the chat
      if ((await gitAsync(repo, {}, 'update-ref', this.rescueRef(s.id), plan.snap)).status !== 0) throw new Error(tr('msg.copy.cannotRead'));
      // An earlier copy of this chat that stayed (detached, or archived) keeps its own record: it is moved aside, never overwritten.
      const old = this.record(s.id);
      if (old?.switching) throw userError('msg.copy.pendingUndo');
      if (old) { this.board.settingJson(`chatwt:${s.id}-old${Date.now()}`, old); this.board.settingJson(KEY(s.id), null); this.board.notice?.(tr('msg.copy.oldKept', { dir: old.path }), 'warning'); }
      const switching = { phase: 'copy', snap: plan.snap, zero: plan.zero, carried, cwd0: s.cwd, cli0: s.cli_session ?? null, ctx0: s.context ?? null, at: new Date().toISOString() };
      journal = true;
      const made = this.chatTrees.create({ id: s.id, project, base: 'HEAD', extra: { switching } });
      const copy = this.record(s.id);
      if (copy.baseSha !== head) throw new Error(tr('msg.copy.changed'));
      await this.writeCopy(repo, plan.snap, copy.path, plan, carried);
      this.setPhase(s.id, 'applied');
      // the copy must hold exactly what was carried: a photo of it against the commit it started from
      const seen = await fullSnapshot(copy.path, { message: `orb: foto de la copia aparte del chat ${s.id}` });
      if (!seen?.commit) throw new Error(tr('msg.copy.cannotRead'));
      const got = await dirtyFiles(copy.path);
      if (got.size !== carried.length || carried.some((p) => !got.has(p))) throw new Error(tr('msg.copy.notSame'));
      // the folder gets those files back as they were before the chat (by path, the index is never touched)
      this.setPhase(s.id, 'restoring');
      if (carried.length) {
        const out = await undoCheckpointAsync({ kind: 'git', repo, commit: plan.zero, raw: true }, { commit: plan.snap }, { only: new Set(carried), safe: true });
        if (out.skipped.length) throw new Error(tr('msg.copy.notReturned', { list: oneLine(out.skipped.slice(0, 5).join(', '), 200) }));
      }
      this.setPhase(s.id, 'session');
      // the exact photos retired are written down first: only those come back if this is undone
      const marks = await photoMarks(repo, s.id);
      this.setJournal(s.id, { retired: marks });
      await retirePhotos(repo, s.id, marks);
      const mark = this.lastItem(s.id);
      this.moveSession(s.id, made.cwd, 'copy');
      this.addMove(s.id, 'copy', mark);
      const done = this.record(s.id); delete done.switching;
      this.board.settingJson(KEY(s.id), done);
      forgetPhotos(s.id);
      await this.dropRefs(repo, s.id);
      this.sessions.addItem(s.id, 'system', 'status', tr('msg.copy.moved', { branch: copy.branch, n: carried.length }));
      this.board.changed?.('sessions');
      return { ok: true, branch: copy.branch, path: copy.path, cwd: made.cwd, moved: carried.length, left: [...left].length, stay: plan.stay, staged: plan.staged };
    } catch (error) {
      if (journal) await this.rollback(s.id, error.message).catch((e) => this.log(`copia aparte ${s.id}: no se pudo deshacer: ${e.message}`));
      throw error;
    } finally { release(); this.working.delete(s.id); this.sessions.moving.delete(s.id); }
  }

  rescueRef(id) { return `${REF_PREFIX}/copia/${id}/antes`; }
  // The rescue photo and the folder photo of a chat are only needed while a move or a resolution is on.
  async dropRefs(repo, id) {
    for (const ref of [this.rescueRef(id), `${REF_PREFIX}/copia/${id}/carpeta`, `${REF_PREFIX}/copia/${id}/ahora`]) await gitAsync(repo, {}, 'update-ref', '-d', ref).catch(() => {});
  }

  // Everything back as it was before the switch started (or after the point it was cut at).
  async rollback(id, why = '') {
    const info = this.record(id); const j = info?.switching;
    if (!j) return false;
    const project = this.board.project(info.project);
    const repo = info.repo && fs.existsSync(info.repo) ? info.repo : project?.path;
    this.log(`copia aparte ${id}: se deshace (${j.phase})${why ? `: ${why}` : ''}`);
    // 1. the folder. What Orb left written is the photo before the chat (j.zero) for the carried files, so only a file still
    // like that goes back to the start photo: one the user edited meanwhile no longer matches and is left alone.
    let unsafe = [];
    const needsFolder = repo && (j.phase === 'restoring' || j.phase === 'session') && j.carried?.length && HASH.test(j.snap ?? '') && HASH.test(j.zero ?? '');
    if (needsFolder) {
      const now = await fullSnapshot(repo, { message: `orb: foto antes de deshacer el paso a una copia aparte ${id}` });
      if (!now?.commit) unsafe = ['?'];
      else {
        await gitAsync(repo, {}, 'update-ref', `${REF_PREFIX}/copia/${id}/ahora`, now.commit);
        const out = await undoCheckpointAsync({ kind: 'git', repo, commit: j.snap, raw: true }, { commit: j.zero }, { only: new Set(j.carried), safe: true });
        // a file that is already the start photo's (the step had not reached it) is not a problem
        for (const rel of out.skipped) if (!(await this.sameAs(repo, j.snap, rel))) unsafe.push(rel);
      }
    }
    // 2. the photos before each message: exactly the ones this switch retired
    if (j.phase === 'session' && repo && j.retired?.length) await restorePhotos(repo, id, j.retired).catch(() => {});
    // 3. the chat: its folder and its conversation with the agent
    const s = this.sessions.get(id);
    if (s && j.cwd0 && (s.cwd !== j.cwd0 || s.cli_session !== j.cli0)) this.sessions.update(id, { cwd: j.cwd0, cli_session: j.cli0, context: j.ctx0 });
    for (const k of [`folder_note:${id}`, `chatresume:${id}`, `handoff_summary:${id}`]) this.board.settingJson(k, null);
    // 4. the copy holds the carried work: it is deleted only when the folder got everything back
    if (unsafe.length) {
      this.board.settingJson(KEY(id), { ...info, detached: true, switching: { ...j, failed: true } });
      const text = tr('msg.copy.rollbackKept', { dir: info.path, list: oneLine(unsafe.slice(0, 5).join(', '), 200) });
      this.log(`copia aparte ${id}: ${text}`);
      try { this.sessions.addItem(id, 'system', 'status', text); this.board.notice?.(text, 'warning'); } catch { /* the chat went */ }
      return false;
    }
    if (fs.existsSync(info.path) || info.branch) {
      const st = await this.chatTrees.status(id);
      const r = await this.chatTrees.release(id, { force: true, branch: 'delete', fingerprint: st.fingerprint, closeLive: false, unverified: true });
      if (!r.removed && !r.none) { this.board.settingJson(KEY(id), { ...this.record(id), switching: undefined, detached: true }); this.log(`copia aparte ${id}: la carpeta de la copia se queda (${r.kept ?? r.error})`); }
      else this.board.settingJson(KEY(id), null);
    } else this.board.settingJson(KEY(id), null);
    if (repo) await this.dropRefs(repo, id);
    return true;
  }

  // Whether the file on disk is byte for byte the one of photo `commit`.
  async sameAs(repo, commit, rel) {
    const want = (await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `${commit}:${rel}`)).stdout.trim();
    const file = path.join(repo, rel);
    if (!want) return !fs.existsSync(file);
    if (!fs.existsSync(file)) return false;
    return (await gitAsync(repo, {}, ...RAW_GIT, 'hash-object', '--', file)).stdout.trim() === want;
  }

  // At start: a switch that was cut short is finished when its last step was done, and undone otherwise.
  async recover() {
    for (const rec of this.chatTrees.all()) {
      if (!rec.switching || rec.switching.failed) continue; // a failed undo waits for the user: it is never tried again alone
      this.sessions.moving.add(rec.id);
      try { await this.rollback(rec.id, 'interrupted'); } catch (error) { this.log(`copia aparte ${rec.id}: ${error.message}`); } finally { this.sessions.moving.delete(rec.id); }
    }
  }

  // Where the agent goes on after the chat changed folder. `to`: 'copy' | 'local'.
  // - Claude: its conversation file is found by id in the account's folder and put in the new folder's place.
  // - Codex and the ACP agents resume by id with the new folder (the live process is rebuilt with it); if that fails at the
  //   next turn, the conversation goes on from a summary and the chat says so (Sessions.keepMoveSummary).
  // - Cursor and the rest: a summary.
  // The agent is told where it works now with the next message (`folder_note`).
  moveSession(id, toCwd, to) {
    const s = this.sessions.must(id);
    const fields = { cwd: toCwd };
    let summary = false;
    if (s.cli_session) {
      if (s.agent === 'claude') {
        let ok = false;
        try { ok = followClaudeSession({ configDir: this.claudeDir(s), sessionId: s.cli_session, toCwd }); } catch { ok = false; }
        if (!ok) summary = true;
      } else if (s.agent === 'cursor' || s.agent === 'pi' || s.agent === 'antigravity') summary = true;
      else this.board.settingJson(`chatresume:${id}`, { cli: s.cli_session, to });
    }
    if (summary) {
      this.sessions.keepMoveSummary(id, to);
      fields.cli_session = null; fields.context = null;
    }
    this.sessions.update(id, fields);
    this.board.settingJson(`folder_note:${id}`, { path: toCwd, to });
  }

  // ----- the other way: join, undo the join, discard -----

  // The copy of a chat that has one to work with.
  copyOf(id) {
    const { s, project } = this.check(id);
    const info = this.record(id);
    if (!info || info.removed || info.detached || info.switching) throw userError('msg.chatWt.none');
    if (!this.chatTrees.managed(info.path) || !fs.existsSync(info.path)) throw userError('msg.chatWt.noCopy');
    return { s, project, info };
  }

  // What is in the copy and not yet in its branch goes into the branch (a commit by Orb, secrets and ignored files left out).
  async mergeInProgress(info) { return (await gitAsync(info.path, {}, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).status === 0; }
  // Conflict markers left in the files a resolution was about.
  async markersIn(info, files) {
    if (!files?.length) return [];
    return (await gitAsync(info.path, {}, '--literal-pathspecs', 'grep', '-l', '-E', '^(<<<<<<<|>>>>>>>) ', '--', ...files)).stdout.split(/\r?\n/).filter(Boolean);
  }
  // Never commits a merge that is half done or files that still hold markers: those would go to the user's folder.
  async commitPending(info, { id = null, allowMerge = false } = {}) {
    if (!allowMerge) {
      const files = id ? this.board.settingJson(RESOLVE(id))?.files : null;
      const left = await this.markersIn(info, files);
      if ((await this.mergeInProgress(info)) || left.length) throw userError('msg.copy.markersLeft', { list: left.slice(0, 10).join(', ') || '…' });
    }
    await gitAsync(info.path, {}, 'add', '-A');
    const staged = (await gitAsync(info.path, {}, 'diff', '--cached', '--name-only', '-z')).stdout.split('\0').filter(Boolean);
    for (const p of staged.filter(isSecretPath)) await gitAsync(info.path, {}, '--literal-pathspecs', 'rm', '-q', '--cached', '--ignore-unmatch', '--', p);
    const left = (await gitAsync(info.path, {}, 'diff', '--cached', '--quiet')).status !== 0;
    if (left) {
      const r = await gitAsync(info.path, {}, ...ORB_GIT, 'commit', '-q', '-m', 'orb: trabajo del chat en la copia aparte');
      if (r.status !== 0) throw new Error(oneLine(r.stderr, 300));
    }
    return { committed: left };
  }

  // «Unir a mi carpeta». → { ok: true, joined, files } | { ok: false, conflicts: [paths] }
  async merge(id) {
    const { s, project, info } = this.copyOf(id);
    if (this.folderBusy(project, s.id)) throw userError('msg.copy.folderBusy');
    this.working.add(s.id); this.sessions.moving.add(s.id);
    const release = this.hold(project.name);
    try {
      const repo = await this.chatTrees.repoOf(id, info);
      if (!repo) throw userError('msg.chatWt.noCopy');
      await this.commitPending(info, { id });
      const tip = (await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`)).stdout.trim();
      if (!tip) throw userError('msg.copy.noBranch');
      const res = this.board.settingJson(RESOLVE(id));
      const base = res?.folder && HASH.test(res.folder) ? res.folder : info.baseSha;
      let joined = [];
      let point = null;
      if (tip !== base && tip !== info.baseSha) {
        const out = await integrateIntoAsync(repo, { base, tip });
        if (!out.ok && out.conflicts?.length) return { ok: false, conflicts: out.conflicts.slice(0, 100) };
        if (!out.ok) throw new Error(out.error);
        joined = out.changed;
        const before = `${REF_PREFIX}/c-${id}-antes-de-unir`; const after = `${REF_PREFIX}/c-${id}-despues`;
        await gitAsync(repo, {}, 'update-ref', before, out.before); await gitAsync(repo, {}, 'update-ref', after, out.after);
        const headNow = (await gitAsync(repo, {}, 'rev-parse', 'HEAD')).stdout.trim();
        point = { before: { kind: 'git', repo, ref: before, commit: out.before }, after: { kind: 'git', repo, commit: out.after }, refs: [before, after], head: headNow, branch: info.branch, at: new Date().toISOString(), changed: out.changed.length };
        // an earlier join of this chat keeps its refs and branch under its own key until it expires
        const prev = this.point(id);
        if (prev?.before) this.board.settingJson(`${POINT(id)}~${Date.now()}`, prev);
        this.board.settingJson(POINT(id), point);
      }
      this.board.settingJson(RESOLVE(id), null);
      // back to the folder: the conversation goes with the chat
      this.moveSession(id, project.path, 'local');
      this.addMove(id, 'local');
      await retirePhotos(repo, id).catch(() => {});
      forgetPhotos(id);
      await this.dropRefs(repo, id);
      const kept = await this.dropCopy(id, { keepBranch: Boolean(point) });
      this.sessions.addItem(id, 'system', 'status', tr('msg.copy.joined', { n: joined.length }));
      this.board.changed?.('sessions');
      return { ok: true, joined: joined.length, files: take(joined.map((c) => c.path)), undo: Boolean(point), copyKept: kept.length ? take(kept) : [] };
    } finally { release(); this.working.delete(s.id); this.sessions.moving.delete(s.id); }
  }

  // Removes the copy's folder. A folder that still holds files that were not joined (ignored or secret-looking ones: they never
  // travel) stays, apart from the chat, and the list is returned. The branch is kept while the undo point exists.
  async dropCopy(id, { keepBranch }) {
    const st = await this.chatTrees.status(id);
    const info = this.record(id);
    if (st.dirty.length) {
      this.board.settingJson(KEY(id), { ...info, detached: true });
      return st.dirty;
    }
    const r = await this.chatTrees.release(id, { branch: keepBranch ? 'keep' : 'auto', closeLive: false });
    if (r.removed) { this.board.settingJson(KEY(id), null); return []; }
    this.board.settingJson(KEY(id), { ...this.record(id), detached: true });
    return [r.kept ?? 'locked'];
  }

  // «Deshacer la unión»: the files go back as they were right before the join; those changed since stay as they are.
  async undoMerge(id) {
    const s = this.sessions.get(String(id));
    if (!s || s.kind !== 'chat') throw userError('msg.chatWt.none');
    const cp = this.point(id);
    if (!cp?.before || cp.undone) throw userError('msg.copy.noPoint');
    const project = this.board.project(s.project);
    if (!project) throw userError('msg.copy.noProject');
    if (this.working.has(s.id) || this.sessions.isRunning(s.id)) throw userError('msg.copy.busy');
    if (this.folderBusy(project, s.id)) throw userError('msg.copy.folderBusy');
    this.working.add(s.id); this.sessions.moving.add(s.id);
    const release = this.hold(project.name);
    try {
      const out = await undoCheckpointAsync(cp.before, cp.after, { safe: true });
      // the undo point is spent, but the branch and its refs stay until the point would have expired: the chat's work is on them
      this.board.settingJson(POINT(id), { ...cp, undone: true });
      this.sessions.addItem(id, 'system', 'status', tr('msg.copy.joinUndone', { restored: out.restored.length, removed: out.removed.length, skipped: out.skipped.length }));
      return { ok: true, restored: out.restored.length, removed: out.removed.length, skipped: take(out.skipped) };
    } finally { release(); this.working.delete(s.id); this.sessions.moving.delete(s.id); }
  }
  // The undo point's refs, and the chat's branch (only when no copy of the chat uses it).
  async dropPoint(cp) {
    const repo = cp.before?.repo;
    if (!repo || !fs.existsSync(repo)) return;
    for (const ref of cp.refs ?? []) if (String(ref).startsWith(`${REF_PREFIX}/`)) await gitAsync(repo, {}, 'update-ref', '-d', ref);
    const inUse = this.chatTrees.all().some((r) => r.branch === cp.branch && !r.removed);
    if (cp.branch && cp.branch.startsWith('orb/chat-') && !inUse) await gitAsync(repo, {}, 'branch', '-D', cp.branch);
  }
  // Undo points that are over (default 30 days, like a task's) go, and with them the branch of the chat.
  async prune(days = 30) {
    const old = Date.now() - days * 86_400_000;
    for (const row of this.board.all("SELECT key, value FROM settings WHERE key LIKE 'chatcp:%' AND value <> ''")) {
      let cp; try { cp = JSON.parse(row.value); } catch { continue; }
      const id = row.key.slice('chatcp:'.length);
      if ((this.sessions.get(id) || id.includes('~')) && Date.parse(cp.at) >= old) continue;
      this.board.settingJson(row.key, null);
      await this.dropPoint(cp).catch(() => {});
    }
  }

  // «Descartar la copia»: the user confirmed that the copy and what was not joined are deleted, branch included.
  async discard(id, { confirm = false } = {}) {
    if (confirm !== true) throw userError('msg.copy.needConfirm');
    const { s, project, info } = this.copyOf(id);
    this.working.add(s.id); this.sessions.moving.add(s.id);
    try {
      const st = await this.chatTrees.status(id);
      const r = await this.chatTrees.release(id, { force: true, branch: 'delete', fingerprint: st.fingerprint, closeLive: true });
      if (!r.removed) return { ok: false, kept: r.kept ?? 'locked', error: r.error ?? null };
      this.board.settingJson(KEY(id), null);
      this.moveSession(id, project.path, 'local');
      this.addMove(id, 'local');
      const repo = info.repo && fs.existsSync(info.repo) ? info.repo : project.path;
      await retirePhotos(repo, id).catch(() => {});
      forgetPhotos(id);
      await this.dropRefs(repo, id);
      this.sessions.addItem(id, 'system', 'status', tr('msg.copy.discarded'));
      this.board.changed?.('sessions');
      return { ok: true };
    } finally { this.working.delete(s.id); this.sessions.moving.delete(s.id); }
  }

  // ----- a conflict, resolved inside the copy -----

  // «Pedir al agente que lo resuelva»: the folder as it is now (a photo) is merged INTO THE COPY with git, which leaves the
  // conflicts as markers in the copy's files; the chat's agent resolves them there and never writes in the user's folder.
  // When its turn ends, `finishResolve` checks the files, saves the result and joins again taking the photo as base.
  async resolve(id) {
    const { s, project, info } = this.copyOf(id);
    if (this.folderBusy(project, s.id)) throw userError('msg.copy.folderBusy');
    this.working.add(s.id);
    const release = this.hold(project.name);
    try {
      const repo = await this.chatTrees.repoOf(id, info);
      const again = await this.mergeInProgress(info) && this.board.settingJson(RESOLVE(id));
      if (again) return this.askAgain(id, info, project, again);
      await this.commitPending(info, { id });
      const folder = await fullSnapshot(repo, { message: `orb: foto de la carpeta para resolver el chat ${id}` });
      if (!folder?.commit) throw userError('msg.copy.cannotRead');
      await gitAsync(repo, {}, 'update-ref', `${REF_PREFIX}/copia/${id}/carpeta`, folder.commit);
      const m = await gitAsync(info.path, {}, ...ORB_GIT, 'merge', '--no-commit', '--no-ff', '-m', 'orb: trae la carpeta a la copia aparte', folder.commit);
      const unmerged = (await gitAsync(info.path, {}, 'diff', '--name-only', '--diff-filter=U', '-z')).stdout.split('\0').filter(Boolean);
      this.board.settingJson(RESOLVE(id), { folder: folder.commit, tree: (await gitAsync(repo, {}, 'rev-parse', `${folder.commit}^{tree}`)).stdout.trim(), files: unmerged, at: new Date().toISOString() });
      if (m.status === 0 && !unmerged.length) { await this.finishMerge(info); return { ok: true, clean: true, files: [] }; }
      return this.askAgain(id, info, project, { files: unmerged });
    } finally { release(); this.working.delete(s.id); }
  }
  // The agent is asked to resolve the markers the merge left in the copy (again, when a try ended with some left).
  askAgain(id, info, project, res) {
    const unmerged = res.files ?? [];
    const text = tr('msg.copy.resolveAsk', { list: unmerged.slice(0, 30).join(', '), copy: info.path, folder: project.path });
    this.board.settingJson(PENDING(id), { resolve: true });
    try { this.sessions.send(id, text, { asked: [] }); } catch (error) { this.board.settingJson(PENDING(id), null); throw error; }
    return { ok: true, clean: false, files: take(unmerged) };
  }
  async finishMerge(info) {
    await gitAsync(info.path, {}, 'add', '-A');
    const r = await gitAsync(info.path, {}, ...ORB_GIT, 'commit', '-q', '--no-edit', '-m', 'orb: trae la carpeta a la copia aparte');
    return r.status === 0 || /nothing to commit/i.test(`${r.stdout}${r.stderr}`);
  }

  // The turn of the agent that was resolving ended: markers left → the agent is asked again; clean → join again from the
  // folder photo (a folder that changed since the photo repeats the process instead of joining).
  async finishResolve(id) {
    const pend = this.board.settingJson(PENDING(id));
    if (!pend?.resolve) return null;
    this.board.settingJson(PENDING(id), null);
    const info = this.record(id); const res = this.board.settingJson(RESOLVE(id));
    if (!info || !res) return null;
    // only the files that were in conflict: another file may hold such a line on purpose
    const left = await this.markersIn(info, res.files);
    if (left.length) { this.sessions.addItem(id, 'system', 'status', tr('msg.copy.markersLeft', { list: left.slice(0, 10).join(', ') })); return { ok: false, left }; }
    await this.finishMerge(info);
    const project = this.board.project(info.project);
    const repo = await this.chatTrees.repoOf(id, info);
    const now = project && repo ? await fullSnapshot(repo, { message: `orb: foto de la carpeta tras resolver el chat ${id}` }) : null;
    const nowTree = now ? (await gitAsync(repo, {}, 'rev-parse', `${now.commit}^{tree}`)).stdout.trim() : '';
    this.log(`copia aparte ${id}: resuelto; carpeta ${nowTree === res.tree ? 'igual' : 'cambiada'}`);
    if (nowTree !== res.tree) { this.board.settingJson(RESOLVE(id), null); this.sessions.addItem(id, 'system', 'status', tr('msg.copy.folderChanged')); return this.resolve(id).catch((error) => ({ ok: false, error: error.message })); }
    try { return await this.merge(id); } catch (error) { this.sessions.addItem(id, 'system', 'status', error.message); return { ok: false, error: error.message }; }
  }

  // ----- a switch asked for during a turn: it happens when the turn ends -----

  // proceed: the agent proposed it, so once moved it is told to go on (the window sends that with the confirmation)
  wait(id, proceed = false) { this.check0(id); if (this.board.settingJson(PENDING(id))?.resolve) throw userError('msg.copy.busy'); this.board.settingJson(PENDING(id), { toCopy: true, proceed: proceed === true }); return { waiting: true }; }
  check0(id) { const s = this.sessions.get(String(id)); if (!s || s.kind !== 'chat') throw userError('msg.chatWt.none'); if (!s.project) throw userError('msg.chatWt.needsProject'); }
  waitingFor(id) { return Boolean(this.board.settingJson(PENDING(id))?.toCopy); }
  cancelWait(id) { this.board.settingJson(PENDING(id), null); }
  // Called by the engine when a chat's turn ended. → what to do: the window opens the list for a waiting switch.
  async afterTurn(id, emit = () => {}) {
    const pend = this.board.settingJson(PENDING(id));
    if (!pend) return null;
    if (pend.resolve) return this.finishResolve(id);
    if (pend.toCopy) { this.board.settingJson(PENDING(id), null); emit('copy:ready', { id, proceed: pend.proceed === true }); return { ready: true }; }
    return null;
  }

  // ----- helpers for the window -----

  // What the chat's header shows.
  state(id) {
    const s = this.sessions.get(String(id));
    if (!s || s.kind !== 'chat' || !s.project) return { where: null };
    const info = this.record(id);
    const point = this.point(id);
    return {
      where: this.where(id), branch: info && !info.removed && !info.detached ? info.branch : null, path: info && !info.removed && !info.detached ? info.path : null,
      undo: Boolean(point?.before) && !point.undone, waiting: this.waitingFor(id), resolving: Boolean(this.board.settingJson(PENDING(id))?.resolve), conflict: this.board.settingJson(RESOLVE(id))?.files ?? [],
    };
  }
}
