// 3.8.8 paso 11b (tanda 8), motor: los totales por fuente y nivel de Actividad, la tarea de una fila de los subagentes
// y la ruta del archivo de una norma (solo para la ventana de este PC). Todo es aditivo: sin lo nuevo, las respuestas
// de siempre no cambian.
import './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { principalOf } from '../src/domain/security/permissions.mjs';
import { logUserAction } from '../src/domain/activity/user-log.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { ensureDefaultRules } from '../src/domain/rules/rules.mjs';

const desktop = principalOf();
const phone = principalOf({ device: { id: 'm1', kind: 'phone' } });
let t; let board; let api; let task;
const call = (m, p = {}, who = desktop) => api.call(m, p, who);

before(() => {
  t = tempHome(); board = new Board(); ensureDefaultRules();
  const sessions = new Sessions(board, { emit: () => {} });
  const orchestrator = new Orchestrator(board, { emit: () => {} });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit: () => {}, log: () => {}, version: '9.9.9-test', remoteRef: { current: null } });
  createProject(board, { name: 'tanda8' }, 'usuario');
  task = board.createTask({ project: 'tanda8', title: 'Arreglar el buscador', description: 'x', agent: 'claude' }, 'usuario');
  board.event(task.id, 'claude', 'task.updated', 'failed');
  board.event(task.id, 'claude', 'task.launched', 'ok');
  fs.mkdirSync(ctx.paths.runs, { recursive: true });
  fs.writeFileSync(path.join(ctx.paths.runs, 'motor.log'), '2026-11-01T10:00:00.000Z arranque del motor\n2026-11-01T10:01:00.000Z error: no se pudo leer algo\n2026-11-01T10:02:00.000Z aviso: algo raro\n');
  logUserAction({ kind: 'rule.save', text: 'Cambiaste una norma', project: 'tanda8' });
  logUserAction({ kind: 'rail.set', text: 'Cambiaste un raíl' });
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const all = { sources: ['orb', 'subagentes', 'usuario', 'app'], limit: 100 };

test('sin pedirlos, los totales no viajan: la respuesta de siempre no cambia', async () => {
  const page = await call('activity.list', all);
  assert.ok(Array.isArray(page.items));
  assert.equal(page.counts, undefined);
});

test('counts: true da el total por fuente y por nivel, y cuadra con las líneas', async () => {
  const page = await call('activity.list', { ...all, counts: true });
  const { sources, levels } = page.counts;
  assert.deepEqual(Object.keys(sources), ['orb', 'subagentes', 'usuario', 'app']);
  assert.deepEqual(Object.keys(levels), ['info', 'warn', 'error']);
  assert.equal(sources.orb, 3);
  assert.equal(sources.usuario, 2);
  assert.equal(sources.subagentes, 4); // project.saved, task.created, task.updated (failed), task.launched
  assert.equal(sources.app, 0);
  const total = Object.values(sources).reduce((a, b) => a + b, 0);
  assert.equal(Object.values(levels).reduce((a, b) => a + b, 0), total);
  assert.equal(levels.error, 2); // the engine line with «error» and the failed task update
  assert.equal(levels.warn, 1);
  assert.equal(page.counts.partial, undefined);
});

test('los totales siguen los demás filtros: la fuente cuenta con el nivel, el nivel con las fuentes elegidas', async () => {
  const onlyErrors = (await call('activity.list', { ...all, level: 'error', counts: true })).counts;
  assert.equal(onlyErrors.sources.orb, 1);
  assert.equal(onlyErrors.sources.subagentes, 1);
  assert.equal(onlyErrors.sources.usuario, 0);
  // the level totals ignore the level itself, so the other levels stay visible
  assert.equal(onlyErrors.levels.info > 0, true);
  const onlyOrb = (await call('activity.list', { ...all, sources: ['orb'], counts: true })).counts;
  assert.equal(onlyOrb.levels.info + onlyOrb.levels.warn + onlyOrb.levels.error, 3);
  assert.equal(onlyOrb.sources.usuario, 2); // a source's total ignores the source filter
  const byProject = (await call('activity.list', { ...all, project: 'tanda8', counts: true })).counts;
  assert.equal(byProject.sources.orb, 0);
  assert.equal(byProject.sources.usuario, 1);
});

test('las páginas siguientes no repiten los totales', async () => {
  const first = await call('activity.list', { ...all, limit: 2, counts: true });
  assert.ok(first.next);
  const second = await call('activity.list', { ...all, limit: 2, counts: true, cursor: first.next });
  assert.equal(second.counts, undefined);
});

test('una fila de los subagentes lleva el id de su tarea, y solo mientras la tarea existe', async () => {
  const rows = (await call('activity.list', all)).items.filter((i) => i.source === 'subagentes');
  assert.ok(rows.length >= 3);
  assert.ok(rows.filter((r) => r.kind.startsWith('task.')).every((r) => r.task === task.id));
  assert.equal(rows.find((r) => r.kind === 'project.saved').task, undefined);
  for (const r of (await call('activity.list', all)).items.filter((i) => i.source !== 'subagentes')) assert.equal(r.task, undefined);
  const phoneRows = (await call('activity.list', all, phone)).items.filter((i) => i.kind.startsWith('task.'));
  assert.equal(phoneRows[0].task, task.id);
  board.run('DELETE FROM tasks WHERE id = ?', task.id);
  const after2 = (await call('activity.list', all)).items.filter((i) => i.source === 'subagentes');
  assert.ok(after2.every((r) => r.task === undefined));
});

test('rules.read: la ruta del archivo es solo para la ventana de este PC', async () => {
  const id = (await call('rules.list')).find((r) => r.de_serie).id;
  const mine = await call('rules.read', { id });
  assert.ok(mine.ruta.endsWith(`${id}.md`), mine.ruta);
  assert.ok(!path.isAbsolute(mine.ruta));
  const theirs = await call('rules.read', { id }, phone);
  assert.equal(theirs.ruta, undefined);
  assert.equal(theirs.id, id);
});

test('lo que rota de verdad: los registros de Orb, Usuario y App a los 10 MB, con una generación anterior', () => {
  const log = fs.readFileSync(new URL('../src/platform/log.mjs', import.meta.url), 'utf8');
  const user = fs.readFileSync(new URL('../src/domain/activity/user-log.mjs', import.meta.url), 'utf8');
  const rust = fs.readFileSync(new URL('../src-tauri/src/engine.rs', import.meta.url), 'utf8');
  assert.match(log, /max = 10 \* 1024 \* 1024/);
  assert.match(user, /USER_LOG_MAX = 10 \* 1024 \* 1024/);
  assert.match(rust, /LOG_MAX: u64 = 10 \* 1024 \* 1024/);
});

test('los totales se guardan: la misma llamada dos veces no relee, y una línea nueva en un registro los invalida', async () => {
  const { countActivity, COUNT_CAP, READ_CAP } = await import('../src/domain/activity/activity.mjs');
  assert.equal(COUNT_CAP, READ_CAP);
  const first = countActivity(board, { sources: ['orb'], q: 'Algo ' });
  const again = countActivity(board, { q: 'algo', sources: ['orb'] }); // same filters once normalized
  assert.equal(again, first, 'the second answer is the cached object');
  fs.appendFileSync(path.join(ctx.paths.runs, 'motor.log'), '2026-11-01T10:03:00.000Z algo nuevo\n');
  const later = countActivity(board, { sources: ['orb'], q: 'algo' });
  assert.notEqual(later, first);
  assert.equal(later.sources.orb, first.sources.orb + 1);
});

test('los totales: la memoria tiene un máximo de entradas y el tope corta con partial', async () => {
  const { countActivity } = await import('../src/domain/activity/activity.mjs');
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(countActivity(board, { q: `q${i}` }));
  assert.equal(seen.size, 40);
  const oldest = countActivity(board, { q: 'q0' });
  assert.ok(!seen.has(oldest), 'the oldest entry was dropped and counted again');
  const big = path.join(ctx.paths.runs, 'motor.log.1');
  fs.writeFileSync(big, `${'2026-10-01T10:00:00.000Z relleno de prueba para pasar el tope\n'.repeat(30000)}`);
  assert.equal(countActivity(board, { sources: ['orb'] }).partial, true);
  fs.rmSync(big, { force: true });
});
