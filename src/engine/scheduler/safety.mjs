// What protects the project folder around a task: the checkpoint before it, the safety checks after it and undo.
// Part of the Scheduler (index.mjs adds these methods to it).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { eventKey } from '../../domain/tasks/board.mjs';
import { git, REF_PREFIX } from '../../platform/git.mjs';
import { takeCheckpoint, changedBetween, undoCheckpoint, snapshotCommit } from '../../domain/tasks/checkpoints.mjs';
import { oneLine } from '../../shared/text.mjs';
import { remotesOf } from './common.mjs';

export class SafetyPart {
  // ---- "carpeta" mode: checkpoint before, so the user can undo exactly what the task changed.
  folderWorkspace(task, project) {
    // 3.2.1: a read-only task must not touch BITACORA.md, but Orb keeps that file out of its git snapshot (it is private),
    // so a change to it would go unseen. Its bytes are kept now, to compare and restore when the task ends (finding 25).
    if (task.readonly) {
      const file = path.join(project.path, 'BITACORA.md');
      let before = null; try { before = fs.readFileSync(file, 'utf8'); } catch { before = null; }
      this.board.settingJson(`readonly_bitacora:${task.id}`, { existed: before != null, content: before != null ? before.slice(0, 500_000) : null });
    }
    const prev = this.board.settingJson(`checkpoint:${task.id}`);
    // Follow-ups, retries and resumes reuse the first checkpoint: a new one would never be used (a whole copy of a folder
    // without git each time).
    if (prev?.before && (prev.before.kind !== 'copia' || fs.existsSync(prev.before.copy))) {
      const isGit = prev.before.kind === 'git';
      this.board.settingJson(`checkpoint:${task.id}`, { before: prev.before, after: null, head: isGit ? git(prev.before.repo, 'rev-parse', 'HEAD').stdout.trim() : null, remotes: isGit ? remotesOf(prev.before.repo) : null });
      return { workdir: project.path, cwd: project.path, branch: null, isGit, folder: true, notes: [] };
    }
    const cp = takeCheckpoint(project.path, `t${task.id}-${Date.now()}`, ctx.paths.checkpoints);
    const isGit = cp.kind === 'git';
    // The first checkpoint is kept: undo goes back to before the task, including later follow-up rounds.
    this.board.settingJson(`checkpoint:${task.id}`, { before: prev?.before ?? cp, after: null, head: isGit ? git(cp.repo, 'rev-parse', 'HEAD').stdout.trim() : null, remotes: isGit ? remotesOf(cp.repo) : null });
    this.board.event(task.id, 'orb', 'checkpoint', isGit ? eventKey('sys.events.checkpointGit', { ref: cp.ref }) : eventKey('sys.events.checkpointCopy', { copy: cp.copy }));
    return { workdir: project.path, cwd: project.path, branch: null, isGit, folder: true, notes: [] };
  }

  // After a folder task: record what changed and hold the task if it looks like a push or a mass deletion.
  afterFolderTask(task) {
    const reasons = [];
    // 3.2.1: a read-only task that wrote BITACORA.md (its global instructions may ask for a log) is put back as it was and
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
    if (!cp?.before || cp.before.kind !== 'git') {
      if (!reasons.length) return '';
      const why = reasons.join(tr('msg.scheduler.and'));
      this.board.addChat('system', tr('msg.scheduler.safetyStopped', { id: task.id, title: oneLine(task.title), reasons: why, folder: this.board.projectPathNow(task) ?? task.project }), { task: task.id });
      return tr('msg.scheduler.needsReview', { reasons: why });
    }
    const snap = snapshotCommit(cp.before.repo, { always: true, message: `orb: foto después de la tarea #${task.id}` });
    if (!snap) return '';
    git(cp.before.repo, 'update-ref', `${REF_PREFIX}/t${task.id}-despues`, snap.commit);
    cp.after = { kind: 'git', repo: cp.before.repo, commit: snap.commit };
    this.board.settingJson(`checkpoint:${task.id}`, cp);
    const changed = changedBetween(cp.before.repo, cp.before.commit, snap.commit);
    this.board.event(task.id, 'orb', 'files.changed', changed.length ? changed.slice(0, 60).map((c) => `${c.status} ${c.path}`).join(', ') + (changed.length > 60 ? ` … y ${changed.length - 60} más` : '') : 'ningún archivo');
    if (cp.remotes != null && remotesOf(cp.before.repo) !== cp.remotes) reasons.push(tr('msg.scheduler.safetyRemote'));
    const deleted = changed.filter((c) => c.status === 'D').length;
    if (deleted >= 10) reasons.push(tr('msg.scheduler.safetyDeleted', { deleted }));
    // 3.1/3.2.1: a read-only task that runs the tests or the build may leave new outputs (reports, builds) in a build
    // folder: those do not count, but creating or changing any other file does (it should not have written anything).
    const BUILD = /(^|\/)(dist|build|out|coverage|\.vite|\.next|\.turbo|\.cache|node_modules)(\/|$)/i;
    const offending = task.readonly ? changed.filter((c) => !BUILD.test(c.path)) : changed.filter((c) => c.status !== 'A');
    if (task.readonly && offending.length) reasons.push(tr('msg.scheduler.safetyReadonly', { n: offending.length }));
    if (!reasons.length) return '';
    const why = reasons.join(tr('msg.scheduler.and'));
    this.board.addChat('system', tr('msg.scheduler.safetyStopped', { id: task.id, title: oneLine(task.title), reasons: why, folder: this.board.projectPathNow(task) ?? task.project }), { task: task.id });
    return tr('msg.scheduler.needsReview', { reasons: why });
  }

  undo(taskId) {
    const task = this.board.task(taskId); if (!task) throw new Error(tr('msg.scheduler.noTask', { id: taskId }));
    if (this.running.has(task.id)) throw new Error(tr('msg.scheduler.undoRunning'));
    const cp = this.board.settingJson(`checkpoint:${task.id}`);
    if (!cp?.before && this.board.settingJson(`undone:${task.id}`)) throw new Error(tr('msg.scheduler.alreadyUndone', { id: task.id }));
    if (!cp?.before) throw new Error(tr('msg.scheduler.noPhoto'));
    let after = cp.after;
    if (cp.before.kind === 'git' && !after) { const snap = snapshotCommit(cp.before.repo, { always: true, message: 'orb: foto para deshacer' }); if (!snap) throw new Error(tr('msg.scheduler.cannotReadFolder')); after = { commit: snap.commit }; }
    const out = undoCheckpoint(cp.before, after ?? {});
    this.board.event(task.id, 'usuario', 'task.undone', `restaurados ${out.restored.length}, quitados ${out.removed.length}, sin tocar ${out.skipped.length}`);
    // 3.2.1: the task stays «Deshecha» (its result can no longer be accepted) and its photo goes: a second undo over a folder
    // that changed since would restore something else. Running it again (retry, a message to its agent) takes a new one.
    this.board.settingJson(`undone:${task.id}`, { at: new Date().toISOString(), restored: out.restored.length, removed: out.removed.length });
    this.board.settingJson(`checkpoint:${task.id}`, null);
    if (cp.before.kind === 'git' && cp.before.repo && fs.existsSync(cp.before.repo)) {
      for (const ref of git(cp.before.repo, 'for-each-ref', '--format=%(refname)', REF_PREFIX).stdout.split('\n').filter((r) => r.startsWith(`${REF_PREFIX}/t${task.id}-`))) git(cp.before.repo, 'update-ref', '-d', ref);
    }
    this.board.changed('tasks');
    const n = (key, count) => tr(`msg.scheduler.${key}.${count === 1 ? 'one' : 'other'}`, { n: count });
    this.board.notice(tr('msg.scheduler.undone', { id: task.id, restored: n('undoneRestored', out.restored.length), removed: n('undoneRemoved', out.removed.length), skipped: out.skipped.length ? tr('msg.scheduler.undoneSkipped', { n: out.skipped.length, list: oneLine(out.skipped.join(', '), 200) }) : '' }), 'success');
    return out;
  }
}
