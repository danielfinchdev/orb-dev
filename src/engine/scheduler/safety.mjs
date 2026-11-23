// What protects the project folder around a task: the checkpoint before it, the safety checks after it and undo.
// Part of the Scheduler (index.mjs adds these methods to it).
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { eventKey, userName } from '../../domain/tasks/board.mjs';
import { git, gitAsync, REF_PREFIX } from '../../platform/git.mjs';
import { treeState, saveTreeState, stateFileOf, dropTreeState, takeCheckpoint, changedBetweenAsync, undoCheckpoint, undoPreviewFiles, snapshotCommitAsync, fullSnapshot, missedBy } from '../../domain/tasks/checkpoints.mjs';
import { oneLine } from '../../shared/text.mjs';
import { isRailOn } from '../../domain/rules/rails.mjs';
import { lastLaunchId } from './run-id.mjs';
import { remotesOf, remotesOfAsync } from './common.mjs';
import { phoneNoticeAllowed } from '../../domain/notes/announce.mjs';
import { autonomyOf } from '../../domain/security/guard.mjs';
import { logUndone } from '../../domain/journal/journal.mjs';

// folders a build or a package manager makes again by itself: deleting them is never what holds a task back.
export const GENERATED = /(^|\/)(node_modules|dist|build|out|target|\.gradle|\.dart_tool|\.next|\.nuxt|\.svelte-kit|\.turbo|\.cache|\.vite|\.parcel-cache|\.expo|coverage|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|Pods|DerivedData|(bin|obj)\/(Debug|Release))(\/|$)/i;
// when a task's deletions hold it for the user's review. paths: what it deleted; total: the project's files before
// it (both without generated folders). «Auto» (owner's decision): more than 50 files or more than a quarter of the
// project (the quarter only from 10 files on); «Preguntar»: 10 or more. → { held, deleted, total, share } (share: true when the quarter decided).
export function deletionHold(paths, total, autonomy) {
  const deleted = paths.filter((p) => !GENERATED.test(p)).length;
  if (!isRailOn('borrado-masivo')) return { held: false, deleted, total, share: false };
  if (autonomy !== 'auto') return { held: deleted >= 10, deleted, total, share: false };
  // the quarter counts from 10 files on, so deleting 1 of 3 files in a tiny project holds nothing.
  const byShare = deleted >= 10 && total > 0 && deleted / total > 0.25;
  return { held: deleted > 50 || byShare, deleted, total, share: byShare && deleted <= 50 };
}

export class SafetyPart {
  // ---- "carpeta" mode: checkpoint before, so the user can undo exactly what the task changed.
  folderWorkspace(task, project) {
    // a read-only task must not touch BITACORA.md, but Orb keeps that file out of its git snapshot (it is private),
    // so a change to it would go unseen. Its bytes are kept, to compare and restore when the task ends.
    if (task.readonly) {
      const file = path.join(project.path, 'BITACORA.md');
      let before = null; try { before = fs.readFileSync(file, 'utf8'); } catch { before = null; }
      this.board.settingJson(`readonly_bitacora:${task.id}`, { existed: before != null, content: before != null ? before.slice(0, 500_000) : null });
    }
    const prev = this.board.settingJson(`checkpoint:${task.id}`);
    // Follow-ups, retries and resumes reuse the first checkpoint: a new one would never be used (a whole copy of a folder
    // without git each time).
    // A point written by a join (joined: true) is of the folder before that join, not before this launch: the new launch
    // takes its own, or undoing it would go back to before the earlier joined work.
    const reusable = prev?.before && !prev.joined && (prev.before.kind !== 'copia' || fs.existsSync(prev.before.copy));
    if (reusable) {
      const isGit = prev.before.kind === 'git';
      this.board.settingJson(`checkpoint:${task.id}`, { before: prev.before, after: null, head: isGit ? git(prev.before.repo, 'rev-parse', 'HEAD').stdout.trim() : null, remotes: isGit ? remotesOf(prev.before.repo) : null });
      return { workdir: project.path, cwd: project.path, branch: null, isGit, folder: true, notes: [] };
    }
    const cp = takeCheckpoint(project.path, `t${task.id}-${Date.now()}`, ctx.paths.checkpoints);
    const isGit = cp.kind === 'git';
    // The first checkpoint is kept: undo goes back to before the task, including later follow-up rounds.
    this.board.settingJson(`checkpoint:${task.id}`, { before: cp, after: null, head: isGit ? git(cp.repo, 'rev-parse', 'HEAD').stdout.trim() : null, remotes: isGit ? remotesOf(cp.repo) : null });
    this.board.event(task.id, 'orb', 'checkpoint', isGit ? eventKey('sys.events.checkpointGit', { ref: cp.ref }) : eventKey('sys.events.checkpointCopy', { copy: cp.copy }));
    return { workdir: project.path, cwd: project.path, branch: null, isGit, folder: true, notes: [] };
  }

  // After a folder task: record what changed and hold the task if it looks like a push or a mass deletion.
  // Git runs off the event loop; the caller keeps the project held (hold) so nothing else writes there meanwhile.
  async afterFolderTask(task) {
    const reasons = [];
    // a read-only task that wrote BITACORA.md (its global instructions may ask for a log) is put back as it was and
    // flagged. Checked apart from git because Orb keeps BITACORA.md out of its snapshot.
    if (task.readonly) {
      const saved = this.board.settingJson(`readonly_bitacora:${task.id}`);
      const project = this.board.project(task.project);
      if (saved && project) {
        const file = path.join(project.path, 'BITACORA.md');
        let now = null; try { now = fs.readFileSync(file, 'utf8'); } catch { now = null; }
        const changed = saved.existed ? now !== saved.content : now != null;
        if (changed) {
          try { if (saved.existed) fs.writeFileSync(file, saved.content ?? ''); else fs.rmSync(file, { force: true }); } catch (error) { this.log(`restaurar BITACORA #${task.id}: ${error.message}`); }
          this.board.event(task.id, 'orb', 'readonly.write', 'una tarea de solo lectura escribió BITACORA.md; Orb lo devolvió a como estaba');
          reasons.push(tr('msg.scheduler.safetyBitacora'));
        }
      }
      this.board.settingJson(`readonly_bitacora:${task.id}`, null);
    }
    const cp = this.board.settingJson(`checkpoint:${task.id}`);
    if (cp?.before?.kind === 'copia' && fs.existsSync(cp.before.dir)) {
      // No git: remember when the task ended and how every file stands, so undo leaves alone what the user changes afterwards.
      // The end time is saved right now (undo works with it alone, by mtime); the per-file map is a background walk that
      // can take long on a big folder, so it only adds precision and is written only if no later round replaced this mark.
      const at = Date.now(); const run = lastLaunchId(this.board, task.id); const key = `checkpoint:${task.id}`; const state = stateFileOf(cp.before.copy);
      this.board.settingJson(key, { ...cp, after: { kind: 'copia', at, state, run } });
      treeState(cp.before.dir).then(async (files) => {
        if (this.board.settingJson(key)?.after?.at !== at) return;
        await saveTreeState(state, at, files);
      }).catch((error) => this.log?.(`estado final #${task.id}: ${error.message}`));
    }
    if (!cp?.before || cp.before.kind !== 'git') {
      if (!reasons.length) return '';
      const why = reasons.join(tr('msg.scheduler.and'));
      this.board.addChat('system', tr('msg.scheduler.safetyStopped', { id: task.id, title: oneLine(task.title), reasons: why, folder: this.board.projectPathNow(task) ?? task.project }), { task: task.id, ...(phoneNoticeAllowed(this.board, task) ? { quiet: true } : {}) });
      return tr('msg.scheduler.needsReview', { reasons: why });
    }
    const run = lastLaunchId(this.board, task.id); // the run this photo is of, read before the awaits
    const at = Date.now(); // a file older than this that the snapshot missed was hidden from it (missedBy)
    const snap = await snapshotCommitAsync(cp.before.repo, { raw: Boolean(cp.before.raw), always: true, message: `orb: foto después de la tarea #${task.id}` });
    if (!snap) return '';
    await gitAsync(cp.before.repo, {}, 'update-ref', `${REF_PREFIX}/t${task.id}-despues`, snap.commit);
    // Read again after the awaits: only the photo this call started from is completed, never one a later round replaced.
    const key = `checkpoint:${task.id}`; const current = this.board.settingJson(key);
    if (current?.before?.commit === cp.before.commit) this.board.settingJson(key, { ...current, after: { kind: 'git', repo: cp.before.repo, commit: snap.commit, at, run } });
    const changed = await changedBetweenAsync(cp.before.repo, cp.before.commit, snap.commit);
    this.board.event(task.id, 'orb', 'files.changed', changed.length ? changed.slice(0, 60).map((c) => `${c.status} ${c.path}`).join(', ') + (changed.length > 60 ? ` … y ${changed.length - 60} más` : '') : 'ningún archivo');
    if (cp.remotes != null && (await remotesOfAsync(cp.before.repo)) !== cp.remotes) reasons.push(tr('msg.scheduler.safetyRemote'));
    const gone = changed.filter((c) => c.status === 'D').map((c) => c.path);
    const autonomy = task.readonly ? 'preguntar' : autonomyOf(task);
    const before = autonomy === 'auto' && gone.length ? (await gitAsync(cp.before.repo, {}, 'ls-tree', '-r', '--name-only', cp.before.commit)).stdout.split('\n').filter((p) => p && !GENERATED.test(p)).length : 0;
    const hold = deletionHold(gone, before, autonomy);
    if (hold.held) reasons.push(hold.share ? tr('msg.scheduler.safetyDeletedShare', { deleted: hold.deleted, total: hold.total, pct: Math.round((hold.deleted / hold.total) * 100) }) : tr('msg.scheduler.safetyDeleted', { deleted: hold.deleted }));
    // a read-only task that runs the tests or the build may leave new outputs (reports, builds) in a build
    // folder: those do not count, but creating or changing any other file does (it should not have written anything).
    const BUILD = /(^|\/)(dist|build|out|coverage|\.vite|\.next|\.turbo|\.cache|node_modules)(\/|$)/i;
    const offending = task.readonly ? changed.filter((c) => !BUILD.test(c.path)) : changed.filter((c) => c.status !== 'A');
    if (task.readonly && offending.length) reasons.push(tr('msg.scheduler.safetyReadonly', { n: offending.length }));
    if (!reasons.length) return '';
    const why = reasons.join(tr('msg.scheduler.and'));
    this.board.addChat('system', tr('msg.scheduler.safetyStopped', { id: task.id, title: oneLine(task.title), reasons: why, folder: this.board.projectPathNow(task) ?? task.project }), { task: task.id, ...(phoneNoticeAllowed(this.board, task) ? { quiet: true } : {}) });
    return tr('msg.scheduler.needsReview', { reasons: why });
  }

  // «Deshacer» does not trust the fast snapshots (checkpoints.mjs › fullSnapshot): it reads every
  // file again first, off the event loop, and also gives back what the task changed while hiding it from the snapshot
  // after it. Meanwhile no task starts in that project (holding) and a second undo of the same task is refused.
  // The files of an undo, from a full snapshot. dry: nothing is written (the preview), and the result carries `plan` (the
  // same decisions the real undo takes, undoCheckpoint › dry). The caller holds the project.
  async undoOutcome(task, cp, dry, shared = null) {
    const full = shared ?? await fullSnapshot(cp.before.repo, { message: 'orb: foto para deshacer (todo releído)' });
    if (!full) throw new Error(tr('msg.scheduler.cannotReadFolder'));
    const after = cp.after?.commit ? cp.after : full;
    const out = undoCheckpoint(cp.before, after, { dry });
    const later = [];
    const missed = after === full ? [] : missedBy(cp.before.repo, after, full, later);
    out.skipped.push(...later.filter((x) => !out.skipped.includes(x)));
    if (dry) for (const p of later) if (!out.plan.some((x) => x.path === p)) out.plan.push({ path: p, action: 'conflict' });
    if (missed.length) {
      const more = undoCheckpoint(cp.before, full, { only: new Set(missed.map((c) => c.path)), dry });
      for (const k of ['restored', 'removed', 'skipped']) out[k].push(...more[k]);
      if (dry) out.plan.push(...more.plan);
      else this.board.event(task.id, 'orb', 'checkpoint.missed', oneLine(`cambiados sin dejar rastro en su fecha: ${missed.map((c) => c.path).join(', ')}`, 400));
    }
    return out;
  }

  // What «Deshacer» would do now, read only: every file with its final state and, for the ones it changes, the diff from
  // how it is to how it will be. `hash` is the fingerprint of that plan; undo(id, { hash }) refuses when the plan it would
  // carry out differs, so what the window showed is what happens.
  async undoPreview(taskId) {
    const task = this.board.task(taskId); if (!task) throw new Error(tr('msg.scheduler.noTask', { id: taskId }));
    if (this.running.has(task.id) || this.finishing.has(task.id)) throw new Error(tr('msg.scheduler.undoRunning'));
    const cp = this.board.settingJson(`checkpoint:${task.id}`);
    if (!cp?.before) throw new Error(tr('msg.scheduler.noPhoto'));
    if (this.held(task.project)) throw new Error(tr('msg.scheduler.undoBusy'));
    const release = this.hold(task.project);
    try {
      const full = cp.before.kind === 'git' ? await fullSnapshot(cp.before.repo, { message: 'orb: foto para deshacer (todo releído)' }) : null;
      if (cp.before.kind === 'git' && !full) throw new Error(tr('msg.scheduler.cannotReadFolder'));
      const out = full ? await this.undoOutcome(task, cp, true, full) : undoCheckpoint(cp.before, cp.after ?? {}, { dry: true });
      const files = undoPreviewFiles(cp.before, out.plan);
      return { hash: undoPlanHash(cp, out.plan, full?.commit), files, counts: countPlan(out.plan), noDiff: files.filter((x) => x.noDiff).length };
    } finally { release(); }
  }

  async undo(taskId, { hash } = {}) {
    const task = this.board.task(taskId); if (!task) throw new Error(tr('msg.scheduler.noTask', { id: taskId }));
    if (this.running.has(task.id) || this.finishing.has(task.id)) throw new Error(tr('msg.scheduler.undoRunning'));
    const cp = this.board.settingJson(`checkpoint:${task.id}`);
    if (!cp?.before && this.board.settingJson(`undone:${task.id}`)) throw new Error(tr('msg.scheduler.alreadyUndone', { id: task.id }));
    if (!cp?.before) throw new Error(tr('msg.scheduler.noPhoto'));
    if (this.held(task.project)) throw new Error(tr('msg.scheduler.undoBusy'));
    let out;
    if (cp.before.kind === 'git') {
      const release = this.hold(task.project);
      try {
        // With the fingerprint of a preview, the plan is worked out again first and nothing is written if it changed.
        // one full snapshot serves the check and the real run
        let full = null;
        if (hash !== undefined) {
          full = await fullSnapshot(cp.before.repo, { message: 'orb: foto para deshacer (todo releído)' });
          if (!full) throw new Error(tr('msg.scheduler.cannotReadFolder'));
          if (undoPlanHash(cp, (await this.undoOutcome(task, cp, true, full)).plan, full.commit) !== hash) throw new Error(tr('msg.undo.previewStale'));
        }
        out = await this.undoOutcome(task, cp, false, full);
      } finally { release(); }
    } else {
      if (hash !== undefined && undoPlanHash(cp, undoCheckpoint(cp.before, cp.after ?? {}, { dry: true }).plan) !== hash) throw new Error(tr('msg.undo.previewStale'));
      out = undoCheckpoint(cp.before, cp.after ?? {});
    }
    try { logUndone(this.board, task, out); } catch (error) { this.log?.(`bitácora deshacer #${task.id}: ${error.message}`); }
    this.board.event(task.id, 'usuario', 'task.undone', `restaurados ${out.restored.length}, quitados ${out.removed.length}, sin tocar ${out.skipped.length}`);
    // the task stays «Deshecha» (its result can no longer be accepted) and its photo goes: a second undo over a folder
    // that changed since would restore something else. Running it again (retry, a message to its agent) takes a new one.
    this.board.settingJson(`undone:${task.id}`, { at: new Date().toISOString(), restored: out.restored.length, removed: out.removed.length });
    this.board.settingJson(`checkpoint:${task.id}`, null);
    if (cp.before.kind === 'copia' && cp.before.copy) dropTreeState(cp.before.copy);
    if (cp.before.kind === 'git' && cp.before.repo && fs.existsSync(cp.before.repo)) {
      for (const ref of git(cp.before.repo, 'for-each-ref', '--format=%(refname)', REF_PREFIX).stdout.split('\n').filter((r) => r.startsWith(`${REF_PREFIX}/t${task.id}-`))) git(cp.before.repo, 'update-ref', '-d', ref);
    }
    this.board.changed('tasks');
    const n = (key, count) => tr(`msg.scheduler.${key}.${count === 1 ? 'one' : 'other'}`, { n: count });
    const said = tr('msg.scheduler.undone', { id: task.id, restored: n('undoneRestored', out.restored.length), removed: n('undoneRemoved', out.removed.length), skipped: out.skipped.length ? tr('msg.scheduler.undoneSkipped', { n: out.skipped.length, list: oneLine(out.skipped.join(', '), 200) }) : '' });
    // in the task's conversation (a line, and a note for the assistant's next turn there), so
    // neither the user nor Orbe wonders later where its files went; a task of no conversation, a passing notice.
    const conv = this.board.conversationOfTask(task.id);
    if (conv) {
      this.board.addChat('system', said, { task: task.id, kind: 'undone' }, conv);
      const key = `orch_note:${conv}`; const notes = this.board.settingJson(key) ?? [];
      this.board.settingJson(key, [...notes, `${userName()} pulsó «Deshacer» en la tarea #${task.id} «${oneLine(task.title)}»: la carpeta volvió a como estaba antes de ella (restaurados ${out.restored.length}, quitados ${out.removed.length}: ${oneLine([...out.restored, ...out.removed].join(', '), 300) || 'ninguno'}). Por eso sus archivos ya no están; no es un fallo. Lo que dice la bitácora de esa tarea ya no vale.`].slice(-5));
    } else this.board.notice(said, 'success');
    return out;
  }

  // before the user accepts a task Orb held for review, its diff comes from a full snapshot (every
  // file read again, off the event loop), not the fast one after it: a held task sits still, so the folder now is what
  // accepting keeps. Done once per held result (after.full); the next fast snapshot starts from that index too.
  async recheckHeld(task) {
    const key = `checkpoint:${task.id}`; const cp = this.board.settingJson(key);
    if (cp?.before?.kind !== 'git' || !cp.after?.commit || cp.after.full || !fs.existsSync(cp.before.repo)) return;
    if (this.held(task.project)) return;
    const release = this.hold(task.project);
    try {
      const at = Date.now();
      const full = await fullSnapshot(cp.before.repo, { message: `orb: foto después de la tarea #${task.id} (todo releído)` });
      const now = this.board.settingJson(key);
      if (!full || now?.after?.commit !== cp.after.commit) return; // undone or run again meanwhile
      const missed = missedBy(cp.before.repo, cp.after, full);
      if (missed.length) this.board.event(task.id, 'orb', 'checkpoint.missed', oneLine(`cambiados sin dejar rastro en su fecha: ${missed.map((c) => c.path).join(', ')}`, 400));
      git(cp.before.repo, 'update-ref', `${REF_PREFIX}/t${task.id}-despues`, full.commit);
      this.board.settingJson(key, { ...now, after: { ...now.after, commit: full.commit, at, full: true } });
    } finally { release(); }
  }
}

// The fingerprint of what an undo would do: the two photos it goes between and each file with its final state. The preview
// shows this plan and the undo that carries its hash recomputes it, so the two cannot disagree.
export function undoPlanHash(cp, plan, fullCommit = null) {
  // The state each changing file has right now is part of it: a file edited after the preview is a different plan. Nothing
  // is read: git hands the blob ids of the full snapshot in one call (a copy checkpoint, size and time of the file).
  const changing = plan.filter((p) => ['restore', 'remove', 'recreate'].includes(p.action));
  const now = new Map();
  if (changing.length && fullCommit && cp.before?.repo) {
    const want = new Set(changing.map((p) => p.path));
    const r = git(cp.before.repo, 'ls-tree', '-r', '-z', fullCommit);
    for (const row of r.stdout.split(' ')) {
      const tab = row.indexOf('	');
      if (tab > 0 && want.has(row.slice(tab + 1))) now.set(row.slice(tab + 1), row.slice(0, tab).split(' ')[2]);
    }
  } else if (changing.length && cp.before?.dir) {
    for (const p of changing) { try { const st = fs.lstatSync(path.join(cp.before.dir, p.path)); now.set(p.path, `${st.size}:${st.mtimeMs}`); } catch { /* absent */ } }
  }
  const rows = [...plan].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((p) => [p.action, p.path, changing.includes(p) ? (now.get(p.path) ?? 'absent') : ''].join('	'));
  return crypto.createHash('sha256').update(JSON.stringify([cp.before?.commit ?? cp.before?.copy ?? '', cp.after?.commit ?? '', rows])).digest('hex').slice(0, 32);
}
export function countPlan(plan) {
  const n = {};
  for (const p of plan) n[p.action] = (n[p.action] ?? 0) + 1;
  return n;
}
