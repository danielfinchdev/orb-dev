// 3.8.2 (item 16): one log system, Orb's. No «name (2).md» copies beside a project's log, a BITACORA.md a project brings
// merged once into core\bitacora\proyectos and removed only after a verified merge, and «Memorias» on the newest entries.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempHome } from './helpers.mjs';
import { ensureLayout } from '../src/domain/workspace/home.mjs';
import { projectLogHeader, tidyProjectLogs } from '../src/platform/journal-files.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/core/board.mjs';
import { createProject, renameProject, syncProjects } from '../src/core/projects.mjs';
import { finishProject, reopenProject, finishedProjects } from '../src/core/project-close.mjs';
import { readLog, lastEntries } from '../src/engine/logs.mjs';

let t; let board;
before(() => { t = tempHome(); board = new Board(); });
after(() => t.cleanup());

const logs = () => fs.readdirSync(ctx.paths.projectLogs).sort();
const read = (f) => fs.readFileSync(path.join(ctx.paths.projectLogs, f), 'utf8');
const entry = (s) => `\n### 2026-11-01 10:00 — Codex — ${s}\n- Hecho: ${s}\n`;

test('un proyecto de 3.7 registrado como «nombre (2)» recupera su nombre sin dejar «nombre (2).md»', () => {
  const folder = path.join(ctx.paths.categories.windows, 'gemelo'); fs.mkdirSync(folder, { recursive: true });
  // The owner's unified log was already there under the folder's name.
  fs.writeFileSync(path.join(ctx.paths.projectLogs, 'gemelo.md'), projectLogHeader('gemelo') + entry('lo de antes'));
  board.addProject({ name: 'gemelo (2)', path: folder }, 'orb', { fromUser: true });
  assert.ok(logs().includes('gemelo (2).md'), 'the copy the bug left (header only)');
  syncProjects(board); syncProjects(board);
  assert.ok(board.project('gemelo') && !board.project('gemelo (2)'));
  assert.ok(!logs().some((f) => /\(\d+\)\.md$/.test(f)), `no «(2)»: ${logs()}`);
  assert.match(read('gemelo.md'), /lo de antes/);
});

test('renombrar a un nombre que ya tiene bitácora la une al final, sin perder líneas, y quita la vieja', () => {
  createProject(board, { name: 'viejo' }, 'usuario');
  fs.appendFileSync(board.projectLogFile('viejo'), entry('entrada vieja'));
  fs.writeFileSync(path.join(ctx.paths.projectLogs, 'nuevo.md'), projectLogHeader('nuevo') + entry('entrada nueva'));
  renameProject(board, { name: 'viejo', to: 'nuevo' }, 'usuario');
  const text = read('nuevo.md');
  assert.ok(text.indexOf('entrada nueva') < text.indexOf('entrada vieja'), 'appended at the end');
  assert.ok(!logs().includes('viejo.md'));
  // Twice the same move adds nothing twice.
  fs.writeFileSync(board.projectLogFile('viejo'), projectLogHeader('viejo') + entry('entrada vieja'));
  board.moveProjectLog('viejo', 'nuevo');
  assert.equal(read('nuevo.md').split('entrada vieja').length, 3, 'once per line already there: «### …» and «Hecho»');
  assert.ok(!logs().includes('viejo.md'));
});

test('finalizar y reabrir un proyecto deja una sola bitácora con todo', () => {
  const p = createProject(board, { name: 'ciclo' }, 'usuario');
  fs.appendFileSync(board.projectLogFile('ciclo'), entry('antes de finalizar'));
  finishProject(board, 'ciclo', 'usuario');
  const key = finishedProjects(board).find((x) => x.name === 'ciclo').key;
  reopenProject(board, key, 'usuario');
  assert.ok(board.project('ciclo') && p);
  assert.match(read('ciclo.md'), /antes de finalizar/);
  assert.ok(!logs().some((f) => /^ciclo .*\.md$/.test(f)), `${logs()}`);
});

test('al arrancar se quitan las copias «(2)» vacías; una con entradas se queda', () => {
  fs.writeFileSync(path.join(ctx.paths.projectLogs, 'vacia (2).md'), projectLogHeader('vacia (2)'));
  fs.writeFileSync(path.join(ctx.paths.projectLogs, 'vacia en (3).md'), projectLogHeader('vacia en (3)', 'en'));
  fs.writeFileSync(path.join(ctx.paths.projectLogs, 'llena (2).md'), projectLogHeader('llena (2)') + entry('no se toca'));
  ensureLayout(t.home);
  assert.ok(!logs().includes('vacia (2).md') && !logs().includes('vacia en (3).md'));
  assert.ok(logs().includes('llena (2).md'));
  assert.equal(tidyProjectLogs(ctx.paths.projectLogs), 0, 'a second pass does nothing');
});

test('un proyecto que trae BITACORA.md: se une una vez a su bitácora en core y se quita de la carpeta', () => {
  const folder = path.join(ctx.paths.categories.web, 'traida'); fs.mkdirSync(folder, { recursive: true });
  const own = '# BITACORA\r\n\r\n### 2026-10-01 — Cursor — Inicio\r\n- línea uno\r\n- línea dos\r\n';
  fs.writeFileSync(path.join(folder, 'BITACORA.md'), own);
  syncProjects(board);
  assert.ok(board.project('traida'));
  assert.ok(!fs.existsSync(path.join(folder, 'BITACORA.md')), 'removed after the merge');
  const text = read('traida.md');
  for (const line of own.split(/\r\n/).filter(Boolean)) assert.ok(text.includes(line), `kept: ${line}`);
  assert.match(text, /BITACORA\.md/);
  assert.ok(!fs.readdirSync(folder).some((f) => /bitacora/i.test(f)), 'Orb writes no log in the folder');
});

test('una BITACORA.md que git sigue se une pero se queda, y no se añade dos veces', () => {
  const folder = path.join(ctx.paths.categories.linux, 'versionada'); fs.mkdirSync(folder, { recursive: true });
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: folder, windowsHide: true });
  g('init', '-q'); fs.writeFileSync(path.join(folder, 'BITACORA.md'), '# B\n\n- en git\n'); g('add', 'BITACORA.md'); g('commit', '-qm', 'x');
  board.addProject({ name: 'versionada', path: folder }, 'usuario', { fromUser: true });
  assert.ok(fs.existsSync(path.join(folder, 'BITACORA.md')), 'tracked by git: left');
  board.mergeRootLog('versionada', folder);
  assert.equal(read('versionada.md').split('- en git').length, 2, 'merged once');
});

// 3.8.2 (final review): a BITACORA.md that is a second name of another file (a hard link to Orb's data) or a huge one is
// never copied into the log agents read, and is left where it is.
test('una BITACORA.md enlazada a otro archivo o enorme no pasa a la bitácora', () => {
  const folder = path.join(ctx.paths.categories.web, 'enlazada'); fs.mkdirSync(folder, { recursive: true });
  const hidden = path.join(ctx.paths.data, 'prueba-secreta.txt'); fs.mkdirSync(ctx.paths.data, { recursive: true });
  fs.writeFileSync(hidden, 'DATO-INTERNO-DE-ORB\n');
  fs.linkSync(hidden, path.join(folder, 'BITACORA.md'));
  board.addProject({ name: 'enlazada', path: folder }, 'usuario', { fromUser: true });
  assert.equal(board.mergeRootLog('enlazada', folder), false);
  assert.ok(!read('enlazada.md').includes('DATO-INTERNO-DE-ORB'), 'not in the log');
  assert.ok(fs.existsSync(path.join(folder, 'BITACORA.md')) && fs.existsSync(hidden), 'nothing removed');
  const big = path.join(ctx.paths.categories.web, 'enorme'); fs.mkdirSync(big, { recursive: true });
  fs.writeFileSync(path.join(big, 'BITACORA.md'), `# B\n\n${'x'.repeat(4 * 1024 * 1024)}\n`);
  board.addProject({ name: 'enorme', path: big }, 'usuario', { fromUser: true });
  assert.ok(fs.existsSync(path.join(big, 'BITACORA.md')), 'too big: left');
  assert.ok(!read('enorme.md').includes('xxxx'));
  fs.rmSync(hidden, { force: true });
});

test('Memorias lee el final de GENERAL.md: las últimas «Entradas de Orb» aunque arriba estén el índice y las normas', () => {
  const top = `# Bitácora general\n\n## Índice\n${'- proyecto\n'.repeat(400)}\n## Normas\n${'### Norma\ntexto\n'.repeat(300)}\n## Entradas de Orb\n`;
  fs.writeFileSync(ctx.paths.generalLog, top + entry('primera de Orb') + entry('última de Orb'));
  const shown = readLog(board, 'general');
  assert.match(shown, /última de Orb$/m);
  assert.ok(shown.trim().endsWith('- Hecho: última de Orb'));
});

// 3.8.3: «the last entries» are whole entries, never the end of an older one; the newest comes even when it is long.
test('lastEntries: entradas enteras y en orden, las que se pidan y quepan; la más nueva siempre', () => {
  const e = (n, body = 'texto') => `### 2026-11-0${n} 10:00 — Orbe — Tema ${n}\n- Hecho: ${body}\n`;
  const text = `# Bitácora\n\n## Índice\nalgo\n\n${e(1)}\n${e(2, 'y'.repeat(500))}\n${e(3)}\n${e(4)}`;
  assert.deepEqual(lastEntries(text, { entries: 2 }), { text: `${e(3).trim()}\n\n${e(4).trim()}`, shown: 2, total: 4 });
  const fit = lastEntries(text, { entries: 8, max: 300 });
  assert.equal(fit.shown, 2, 'the long second one does not fit: it is left out whole');
  assert.ok(!fit.text.includes('yyy') && !fit.text.includes('Índice'));
  const long = lastEntries(`${e(1)}\n${e(2, 'x'.repeat(5000))}`, { entries: 3, max: 1000 });
  assert.equal(long.shown, 1);
  assert.match(long.text, /^### 2026-11-02[\s\S]*\n… \(entrada recortada/);
  assert.equal(lastEntries('sin entradas', { max: 100 }).shown, 0);
});
