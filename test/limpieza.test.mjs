// 3.2.1 (hallazgos 35 y 25): Orb limpia al arrancar las copias aisladas que quedaron bloqueadas, sin borrar las de una
// tarea viva; y una tarea de solo lectura que escribe BITACORA.md la deja como estaba y lo avisa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/core/context.mjs';

const gitInit = (dir) => { for (const a of [['init', '-q'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t'], ['config', 'core.autocrlf', 'false']]) spawnSync('git', ['-C', dir, ...a]); fs.writeFileSync(path.join(dir, 'x.txt'), 'uno\n'); spawnSync('git', ['-C', dir, 'add', '-A']); spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base']); };

test('al arrancar, pruneCopies borra las copias huérfanas y respeta las de una tarea viva', async () => {
  const h = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const { Scheduler } = await import('../src/engine/scheduler.mjs');
    const board = new Board();
    const dir = path.join(h.home, 'web', 'proy'); fs.mkdirSync(dir, { recursive: true }); gitInit(dir);
    board.addProject({ name: 'proy', path: dir }, 'usuario');
    fs.mkdirSync(ctx.paths.worktrees, { recursive: true });
    const orphan = path.join(ctx.paths.worktrees, 'proy-99'); fs.mkdirSync(orphan); fs.writeFileSync(path.join(orphan, 'a.txt'), 'resto\n');
    const alive = path.join(ctx.paths.worktrees, 'proy-100'); fs.mkdirSync(alive);
    // A running task still works in the "alive" copy: it must not be removed.
    const task = board.createTask({ project: 'proy', title: 'viva', description: 'x', agent: 'claude' }, 'orb');
    board.patch(task.id, { status: 'running', workdir: alive, branch: 'orb/100-x' }, 'orb', 'task.launched');
    // The constructor runs pruneCopies.
    new Scheduler(board, {}, { log: () => {} });
    assert.equal(fs.existsSync(orphan), false, 'la copia huérfana se borra');
    assert.equal(fs.existsSync(alive), true, 'la copia de una tarea viva se conserva');
    board.db.close();
  } finally { h.cleanup(); }
});

test('hallazgo 25: una tarea de solo lectura que escribe BITACORA.md la deja como estaba y queda para revisar', async () => {
  const h = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const { Scheduler } = await import('../src/engine/scheduler.mjs');
    const board = new Board();
    const dir = path.join(h.home, 'web', 'ro'); fs.mkdirSync(dir, { recursive: true }); gitInit(dir);
    board.addProject({ name: 'ro', path: dir }, 'usuario');
    const sched = new Scheduler(board, {}, { log: () => {} });
    const task = board.createTask({ project: 'ro', title: 'verificación', description: 'x', agent: 'claude', readonly: true }, 'orb');
    // As folderWorkspace would have captured: BITACORA.md did not exist before the task.
    board.settingJson(`readonly_bitacora:${task.id}`, { existed: false, content: null });
    const bit = path.join(dir, 'BITACORA.md');
    fs.writeFileSync(bit, '### 2026-10-14 11:35 — Claude\nhora inventada\n'); // what the read-only task wrote
    const held = sched.afterFolderTask(board.task(task.id));
    assert.match(held, /revisi/i, 'queda marcada para revisar');
    assert.equal(fs.existsSync(bit), false, 'BITACORA.md se devuelve a como estaba (no existía)');
    assert.ok(board.all("SELECT 1 AS x FROM events WHERE task_id = ? AND kind = 'readonly.write'", task.id).length, 'queda anotado');
    board.db.close();
  } finally { h.cleanup(); }
});
