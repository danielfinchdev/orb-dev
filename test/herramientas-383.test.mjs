// 3.8.3: Flutter, the Android SDK and a JDK as they really are. Orb checks the files (never trusts an old note in the
// logs), says so plainly to the coordinator and the agents (and in Ajustes › Android), never names a folder that does not
// exist as the tool's, and a copy inside core counts as unusable (agents may not look there).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { checkDevTools, devToolsBrief, needsDevTools, INSTALL_URL } from '../src/engine/dev-tools.mjs';
import { ctx } from '../src/core/context.mjs';
import { Board } from '../src/core/board.mjs';
import { briefing } from '../src/engine/logs.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { METHODS } from '../src/core/permissions.mjs';

const h = tempHome();
after(() => h.cleanup());
const make = (...parts) => { const f = path.join(h.base, ...parts); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); return f; };
const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const core = () => ctx.paths.core;

test('nothing installed, a dead PATH entry and a copy inside core: said as they are', () => {
  const dead = path.join(core(), 'herramientas', 'flutter', 'bin'); // the PATH entry of the 8 Nov note; gone
  const env = { PATH: [dead, path.join(h.base, 'nada')].join(';'), USERPROFILE: path.join(h.base, 'perfil'), LOCALAPPDATA: path.join(h.base, 'local'), JAVA_HOME: path.join(h.base, 'jdk-borrado') };
  const t = byId(checkDevTools({ env, platform: 'win32', core: core() }));
  assert.equal(t.flutter.path, null); assert.deepEqual(t.flutter.missing, [dead]);
  assert.equal(t.androidSdk.path, null); assert.equal(t.java.path, null); assert.deepEqual(t.java.missing, [env.JAVA_HOME]);
  const text = devToolsBrief(Object.values(t), 'Dani');
  assert.match(text, /manda sobre lo que digan las bitácoras/);
  assert.match(text, /Flutter: no instalado \(el PATH o una variable apunta a .*flutter.bin, que no existe\)/);
  assert.match(text, new RegExp(INSTALL_URL.flutter.replace(/[./]/g, '\\$&')));
  assert.match(text, /No lo busques en core/);
  assert.doesNotMatch(text, /Flutter: instalado/);
  // A copy inside core (outside its open herramientas): the agents cannot use it.
  const inCore = path.dirname(make(path.relative(h.base, path.join(core(), 'datos', 'flutter', 'bin', 'flutter.bat'))));
  const again = byId(checkDevTools({ env: { ...env, PATH: inCore }, platform: 'win32', core: core() }));
  assert.equal(again.flutter.path, null); assert.equal(again.flutter.inCore, inCore);
  assert.match(devToolsBrief(Object.values(again)), /no disponible para los agentes \(está dentro de core/);
  // In core\herramientas (open to agents, guard.mjs): it counts.
  const open = path.dirname(make(path.relative(h.base, path.join(core(), 'herramientas', 'flutter', 'bin', 'flutter.bat'))));
  assert.equal(byId(checkDevTools({ env: { ...env, PATH: open }, platform: 'win32', core: core() })).flutter.path, open);
});

test('installed in their own places: found, with the folder that has them', () => {
  const flutter = path.dirname(make('src', 'flutter', 'bin', 'flutter.bat'));
  const local = path.join(h.base, 'local2'); fs.mkdirSync(path.join(local, 'Android', 'Sdk', 'platform-tools'), { recursive: true });
  const java = path.dirname(make('jdk', 'bin', 'java.exe'));
  const env = { PATH: [flutter, java].join(';'), USERPROFILE: path.join(h.base, 'perfil'), LOCALAPPDATA: local };
  const t = byId(checkDevTools({ env, platform: 'win32', core: core() }));
  assert.equal(t.flutter.path, flutter); assert.equal(t.androidSdk.path, path.join(local, 'Android', 'Sdk')); assert.equal(t.java.path, java);
  assert.match(devToolsBrief(Object.values(t)), /Flutter: instalado en .*flutter.bin\./);
  assert.equal(METHODS['devtools.check'], 'pc', 'Ajustes › Android, this PC only');
});

test('the coordinator always gets the check after the logs; a task brief only when the project needs it', () => {
  const board = new Board();
  fs.appendFileSync(ctx.paths.generalLog, '\n### 2026-11-08 03:20 — Orbe — Flutter\n- Hecho: Flutter instalado en C:\\Orb\\core\\herramientas\\flutter.\n');
  const text = briefing(board, { project: null });
  assert.ok(text.indexOf('## Herramientas de desarrollo') > text.indexOf('Flutter instalado en C:\\Orb\\core'), 'after the old note, and it says it rules');
  const android = path.join(ctx.paths.categories.android, 'app-movil'); fs.mkdirSync(android, { recursive: true });
  const web = path.join(ctx.paths.categories.web, 'pagina'); fs.mkdirSync(web, { recursive: true });
  board.addProject({ name: 'app-movil', path: android }, 'usuario'); board.addProject({ name: 'pagina', path: web }, 'usuario');
  assert.equal(needsDevTools(board.project('app-movil'), 'Pantalla de inicio'), true);
  assert.equal(needsDevTools(board.project('pagina'), 'Arregla el CSS del menú'), false);
  assert.equal(needsDevTools(board.project('pagina'), 'Compila la versión Flutter web'), true);
  const sched = new Scheduler(board, {}, { log: () => {} });
  const brief = (name, description) => { const task = board.createTask({ project: name, title: 'x', description, agent: 'claude' }, 'usuario'); return sched.promptFor(board.task(task.id), board.project(name), { cwd: board.project(name).path, folder: true }, 'claude'); };
  assert.match(brief('app-movil', 'Pantalla de inicio'), /## Herramientas de desarrollo de este PC/);
  assert.doesNotMatch(brief('pagina', 'Arregla el CSS del menú'), /Herramientas de desarrollo/);
  board.db.close();
});
