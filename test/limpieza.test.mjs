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

test('3.8.1: al arrancar se conserva la copia aislada de una tarea terminada sin unir, también si el proyecto es una unión a una subcarpeta del repositorio', async () => {
  const h = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const { Scheduler } = await import('../src/engine/scheduler.mjs');
    const { mayHaveWorktrees } = await import('../src/core/workspace.mjs');
    const board = new Board();
    // the repository lives outside; the project is a junction to one of its subfolders
    const mono = path.join(h.base, 'mono'); const sub = path.join(mono, 'apps', 'a'); fs.mkdirSync(sub, { recursive: true }); gitInit(mono);
    const link = path.join(h.home, 'web', 'a'); fs.symlinkSync(sub, link, 'junction');
    board.run('INSERT INTO projects (name, path, notes, created_at) VALUES (?, ?, ?, ?)', 'a', link, '', new Date().toISOString());
    fs.mkdirSync(ctx.paths.worktrees, { recursive: true });
    const copy = path.join(ctx.paths.worktrees, 'a-6');
    spawnSync('git', ['-C', mono, 'worktree', 'add', '-q', '-b', 'orb/6-x', copy]);
    assert.ok(fs.existsSync(path.join(copy, 'x.txt')), 'la copia existe');
    assert.equal(mayHaveWorktrees(link), true, 'por la ruta real: el repositorio tiene copias');
    const task = board.createTask({ project: 'a', title: 'terminada', description: 'x', agent: 'claude' }, 'usuario');
    board.patch(task.id, { status: 'done', workdir: copy, branch: 'orb/6-x' }, 'orb', 'task.done');
    // a copy of a task whose project is no longer listed (no git can be asked about it)
    const other = path.join(ctx.paths.worktrees, 'quitado-7'); fs.mkdirSync(other);
    const t2 = board.createTask({ project: 'a', title: 'de un proyecto quitado', description: 'x', agent: 'claude' }, 'usuario');
    board.patch(t2.id, { status: 'failed', workdir: other, branch: 'orb/7-y' }, 'orb', 'task.failed');
    new Scheduler(board, {}, { log: () => {} });
    assert.equal(fs.existsSync(copy), true, 'la copia de la tarea terminada sigue (para «Unir»)');
    assert.equal(fs.existsSync(other), true, 'una copia con su rama sigue aunque git no la liste');
    board.db.close();
  } finally { h.cleanup(); }
});

test('3.8.1: mayHaveWorktrees lo sabe por los archivos (sin git): sin repositorio, sin copias y con una copia', async () => {
  const h = tempHome();
  try {
    const { mayHaveWorktrees } = await import('../src/core/workspace.mjs');
    const plain = path.join(h.home, 'web', 'sin-git'); fs.mkdirSync(plain, { recursive: true });
    const repo = path.join(h.home, 'web', 'con-git'); fs.mkdirSync(repo, { recursive: true }); gitInit(repo);
    const inner = path.join(repo, 'sub'); fs.mkdirSync(inner);
    const seen = new Map();
    assert.equal(mayHaveWorktrees(plain, seen), false, 'sin repositorio');
    assert.equal(mayHaveWorktrees(repo, seen), false, 'repositorio sin copias');
    assert.equal(mayHaveWorktrees(inner, seen), false, 'una subcarpeta del repositorio');
    spawnSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'orb/1-x', path.join(h.base, 'copia-1')]);
    assert.equal(mayHaveWorktrees(repo), true, 'con una copia (git worktree)');
    assert.equal(mayHaveWorktrees(inner), true);
    assert.equal(mayHaveWorktrees(path.join(h.base, 'copia-1')), true, 'la copia misma (.git es un archivo): no se puede saber, se pregunta a git');
  } finally { h.cleanup(); }
});
