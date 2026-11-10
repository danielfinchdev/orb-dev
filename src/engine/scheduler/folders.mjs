// Work done in an isolated copy, joined back into the project folder (and the copy dropped).
// Part of the Scheduler (index.mjs adds these methods to it).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { git, repoRoot, REF_PREFIX } from '../../platform/git.mjs';
import { integrateInto } from '../../domain/tasks/checkpoints.mjs';
import { oneLine } from '../../shared/text.mjs';

export class FoldersPart {
  // ---- 3.1: work done alongside others, joined into the project folder
  // Whether a task's work is waiting to be joined into this project's folder (it then holds the folder like a writer).
  integrating(project) {
    // Not one a task is joining by hand (info.by): that task is the writer.
    // Only a finished one: a task sent back to work (a follow-up) is joined again when it is done.
    return this.pendingJoins().some(({ task, info }) => task?.project === project.name && task.status === 'done' && !task.pid && !info?.by);
  }
  pendingJoins() {
    return this.board.all("SELECT key, value FROM settings WHERE key LIKE 'integrate:%' AND value <> ''").map((row) => {
      let info = null; try { info = JSON.parse(row.value); } catch { /* broken: dropped below */ }
      const id = Number(row.key.slice('integrate:'.length));
      return { id, info, task: this.board.task(id) };
    });
  }
  // Joins every finished copy whose folder has no task writing in it now. Clean: the files land in the folder, with the
  // same undo as a "carpeta" task, and the copy and its branch go. Conflict: nothing is touched; a task joins it by hand.
  integratePending() {
    const { board } = this;
    for (const { id, info, task } of this.pendingJoins()) {
      if (!task || !info || task.status === 'cancelled') { board.settingJson(`integrate:${id}`, null); continue; }
      if (info.by) { this.joinedBy(task, info); continue; }
      if (task.status !== 'done' || task.pid || this.running.has(id)) continue;
      const project = board.project(task.project); if (!project) continue;
      // Nobody working in the folder: neither a writer nor one that is reading or testing it (files must not change under it).
      const busy = [...this.running.keys()].map((rid) => board.task(rid)).some((t) => t && !t.branch && t.workdir && path.resolve(t.workdir) === path.resolve(project.path));
      if (busy) continue;
      this.integrate(task, project, info);
    }
  }
  integrate(task, project, info) {
    const { board } = this;
    const repo = repoRoot(project.path);
    const tip = task.branch ? git(repo, 'rev-parse', '--verify', '--quiet', task.branch).stdout.trim() : '';
    if (!tip) { board.settingJson(`integrate:${task.id}`, null); board.event(task.id, 'orb', 'integrate.skipped', 'no hay rama que unir'); return; }
    if (tip === info.base) { this.dropCopy(task, project); board.settingJson(`integrate:${task.id}`, null); board.event(task.id, 'orb', 'files.changed', 'ningún archivo'); return; }
    const out = integrateInto(repo, { base: info.base, tip });
    if (out.ok) {
      // Undo works as for a task that wrote in the folder: back to the folder as it was right before joining.
      git(repo, 'update-ref', `${REF_PREFIX}/t${task.id}-antes-de-unir`, out.before);
      git(repo, 'update-ref', `${REF_PREFIX}/t${task.id}-despues`, out.after);
      board.settingJson(`checkpoint:${task.id}`, { before: { kind: 'git', repo, ref: `${REF_PREFIX}/t${task.id}-antes-de-unir`, commit: out.before }, after: { kind: 'git', repo, commit: out.after }, head: git(repo, 'rev-parse', 'HEAD').stdout.trim(), remotes: null });
      board.event(task.id, 'orb', 'files.changed', out.changed.length ? out.changed.slice(0, 60).map((c) => `${c.status} ${c.path}`).join(', ') + (out.changed.length > 60 ? ` … y ${out.changed.length - 60} más` : '') : 'ningún archivo');
      this.dropCopy(task, project);
      board.settingJson(`integrate:${task.id}`, null); board.setting(`integrate_error_at:${task.id}`, '');
      board.event(task.id, 'orb', 'task.integrated', `unida a la carpeta (${out.changed.length} archivo(s))`);
      board.notice(tr('msg.scheduler.joined', { id: task.id, title: oneLine(task.title), n: out.changed.length, name: project.name }), 'success');
      return;
    }
    if (!out.conflicts?.length) {
      // git could not do it (not a conflict): tried again on the next ticks; after a couple of minutes a task joins it by
      // hand, so the project is never held for ever (its dependents wait for the join).
      const first = Number(board.setting(`integrate_error_at:${task.id}`) || 0) || Date.now();
      if (!board.setting(`integrate_error_at:${task.id}`)) board.setting(`integrate_error_at:${task.id}`, String(first));
      if (board.setting(`integrate_error:${task.id}`) !== out.error) { board.setting(`integrate_error:${task.id}`, out.error); board.event(task.id, 'orb', 'integrate.error', out.error); this.log(`unir #${task.id}: ${out.error}`); }
      if (Date.now() - first < (Number(process.env.ORB_JOIN_RETRY_MS) || 120_000)) return;
      out.conflicts = [tr('msg.scheduler.joinFailedFiles', { error: oneLine(out.error, 200) })];
    }
    // Both changed the same lines: a task (the same agent when it can) joins it by hand, in the folder, in its turn.
    const agent = task.assigned_to && board.availableAgents()?.includes(task.assigned_to) ? task.assigned_to : 'any';
    const join = board.createTask({ project: project.name, agent, mode: 'carpeta', level: 'normal', internal: true, conversation_id: board.conversationOfTask(task.id),
      title: tr('msg.scheduler.joinTitle', { id: task.id, title: oneLine(task.title, 60) }),
      description: `La tarea #${task.id} «${oneLine(task.title)}» trabajó a la vez que otras, en una copia aislada (rama ${task.branch}, carpeta ${task.workdir}). Al unir su trabajo a la carpeta del proyecto hay conflicto en: ${out.conflicts.slice(0, 30).join(', ')}.
Lo que hizo esa tarea: ${oneLine(task.result ?? 'sin resumen', 1500)}
Une su trabajo a mano en la carpeta del proyecto (${project.path}): mira qué cambió con \`git diff ${info.base} ${task.branch}\` (o lee los archivos en ${task.workdir}) y aplica esos cambios encima de lo que ya hay en la carpeta, conservando también lo que hicieron las otras tareas. Comprueba que el proyecto sigue funcionando (compila o arranca).
No hagas commit, merge, rebase ni cambies de rama: deja los cambios en los archivos.` }, 'orb');
    board.settingJson(`integrate:${task.id}`, { ...info, by: join.id }); board.setting(`integrate_error_at:${task.id}`, '');
    board.setting(`join_task:${join.id}`, '1');
    board.event(task.id, 'orb', 'integrate.conflict', `conflicto en ${out.conflicts.slice(0, 20).join(', ')}: lo une la tarea #${join.id}`);
    board.notice(tr('msg.scheduler.joinConflict', { id: task.id, join: join.id, list: oneLine(out.conflicts.slice(0, 5).join(', '), 200) }), 'warning');
  }
  // The task that joins a conflicting copy by hand: once it is done, the copy goes and the dependents may start.
  joinedBy(task, info) {
    const by = this.board.task(info.by);
    if (!by || by.status !== 'done' || by.pid) return;
    const project = this.board.project(task.project);
    if (project) this.dropCopy(task, project);
    this.board.settingJson(`integrate:${task.id}`, null);
    this.board.event(task.id, 'orb', 'task.integrated', `unida a la carpeta por la tarea #${by.id}`);
  }
  // The copy (worktree) and its branch, once their work is in the folder. Only Orb's own copies under core\copias\aisladas.
  dropCopy(task, project) {
    const { branch, workdir } = task;
    const inside = workdir && path.resolve(workdir).toLowerCase().startsWith(path.resolve(ctx.paths.worktrees).toLowerCase() + path.sep);
    const removeBranch = () => { if (branch) git(project.path, 'branch', '-D', branch); };
    if (inside && fs.existsSync(workdir)) {
      // 3.2.1: the agent's own process and the programs it left can still hold the copy's folder open, so git cannot
      // remove it. Close them first; then let git try; if the folder is still locked, delete it with retries, and if even
      // that fails note it as an orphan so the next startup (pruneCopies) clears it.
      try { this.sessions.closeLive(task.session_id); } catch (error) { this.log(`cerrar proceso #${task.id}: ${error.message}`); }
      const removeCopy = () => {
        const r = git(project.path, 'worktree', 'remove', '--force', workdir);
        if (r.status !== 0) {
          this.log(`quitar copia #${task.id}: ${r.stderr.trim()}`);
          try { fs.rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); git(project.path, 'worktree', 'prune'); } catch (error) {
            this.log(`borrar copia #${task.id}: ${error.message}`);
            this.board.settingJson(`orphan_copy:${task.id}`, { path: workdir, at: new Date().toISOString() });
          }
        }
        removeBranch(); // after the copy: git does not delete a branch a worktree still has checked out
      };
      // 3.8.3: the programs are stopped asynchronously; the folder and its branch go once that is over.
      let stopping = this.cleaning.get(task.id) ?? null;
      if (!stopping) { try { stopping = this.stopLeftovers(task); } catch (error) { this.log(`parar restos #${task.id}: ${error.message}`); } }
      if (stopping) stopping.then(removeCopy).catch((error) => this.log(`quitar copia #${task.id}: ${error.message}`));
      else removeCopy();
    } else removeBranch();
    // Its copy is gone: a later run starts from the folder as it is then (a fresh base if it works in a copy again).
    this.board.settingJson(`isolated:${task.id}`, null);
    this.board.patch(task.id, { branch: null, workdir: project.path }, 'orb', 'task.copy_removed');
  }
}
