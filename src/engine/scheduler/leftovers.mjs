// Programs a task left running in its folder: stopped when the folder is free, looked at again while it is busy.
// Part of the Scheduler (index.mjs adds these methods to it).
import path from 'node:path';
import { processList, taskProcesses, stopProcesses } from '../../platform/proc-list.mjs';
import { LEFTOVERS_RETRY_MS } from './common.mjs';

export class LeftoversPart {
  // 3.1: a task that started a dev server (vite, node server.js…) and left it running: it is stopped when the task ends,
  // so the next task or the user does not find the port taken. Windows only. Only programs of the usual runtimes, started
  // from the task's own folder after the task began, and only if no other task is still working in that folder.
  // 3.8.3: asynchronous (the process list takes ~0.8 s): returns the promise of the stop, or null when there is nothing to
  // do now. While it runs, the task's copy folder stays (dropCopy removes it once the stop is over).
  stopLeftovers(task, { roots = [] } = {}) {
    if (process.platform !== 'win32' || !task.workdir || process.env.ORB_FAKE_AGENTS) return null; // the test agents never start programs
    // Another task still writing in the same folder: wait until it is over (its own leftovers might be among these), then
    // retry (retryLeftovers, from tick). This is how 3.1 behaved, but now it comes back instead of giving up.
    if (this.folderBusy(task)) { this.board.settingJson?.(`leftovers_pending:${task.id}`, { workdir: task.workdir }); return null; }
    this.board.settingJson?.(`leftovers_pending:${task.id}`, null);
    return this.stopTaskPrograms([{ task, roots }]);
  }
  // Whether another running task works in the same folder as this one.
  folderBusy(task) {
    return [...this.running.keys()].some((id) => { const t = this.board.task(id); return t && t.id !== task.id && t.workdir && path.resolve(t.workdir) === path.resolve(task.workdir); });
  }
  // Stops the programs these tasks left running, with one process list for all of them.
  stopTaskPrograms(items) {
    const jobs = items.map(({ task, roots = [] }) => ({ task, roots, since: Date.parse(this.board.one("SELECT at FROM events WHERE task_id = ? AND kind = 'task.launched' ORDER BY id DESC LIMIT 1", task.id)?.at ?? '') || 0 })).filter((j) => j.since);
    if (!jobs.length) return null;
    const work = (async () => {
      // The processes of this PC now; the task's own by their tree (descendants of the agent, or orphans whose parent was
      // the agent and has since gone — a Start-Process child, the python3.13 the WindowsApps alias relaunches), and those
      // whose command line names the task's folder (the 3.1 rule). Only the usual runtimes and the shells that start them.
      const list = await processList(Math.min(...jobs.map((j) => j.since))); if (!list) return;
      for (const { task, roots, since } of jobs) {
        try {
          const rootPids = [...new Set([...roots, Number(task.pid)].map(Number).filter((p) => p > 0))];
          const found = taskProcesses(list, { since, roots: rootPids, dir: task.workdir, engine: process.pid });
          const stopped = await stopProcesses(found);
          if (stopped.length) this.board.event(task.id, 'orb', 'task.cleanup', `paró ${stopped.length} programa(s) que la tarea dejó en marcha (${stopped.join(', ')})`);
        } catch (error) { this.log(`parar restos #${task.id}: ${error.message}`); }
      }
    })();
    const done = work.catch((error) => this.log(`parar restos: ${error.message}`)).finally(() => {
      for (const { task } of jobs) if (this.cleaning.get(task.id) === done) this.cleaning.delete(task.id);
    });
    for (const { task } of jobs) this.cleaning.set(task.id, done);
    return done;
  }

  // 3.2.1: leftovers that could not be stopped at the time because another task was writing in the same folder: once that
  // folder is free, they are stopped. Called from tick. 3.8.3: only the rows really pending (never the empty ones), with one
  // process list for all of them, never while a stop is under way and at most every LEFTOVERS_RETRY_MS.
  retryLeftovers() {
    if (process.platform !== 'win32' || process.env.ORB_FAKE_AGENTS) return;
    if (this.cleaning.size || Date.now() - (this.leftoversAt ?? 0) < LEFTOVERS_RETRY_MS) return;
    const ready = [];
    for (const row of this.board.all("SELECT key FROM settings WHERE key LIKE 'leftovers_pending:%' AND value <> ''")) {
      const id = Number(row.key.slice('leftovers_pending:'.length));
      const task = this.board.task(id);
      if (!task?.workdir) { this.board.settingJson(row.key, null); continue; }
      if (this.folderBusy(task)) continue;
      this.board.settingJson(row.key, null);
      ready.push({ task });
    }
    if (!ready.length) return;
    this.leftoversAt = Date.now();
    this.stopTaskPrograms(ready);
  }
}
