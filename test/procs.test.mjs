// 3.2.1 (hallazgos 40, 42): the task's own processes found by the process tree, not only by their command line, so Orb
// stops the servers a task leaves running (a relative-path `node server.js`, the python3.13 the WindowsApps alias
// relaunches, an orphaned bash whose agent has gone) and never touches a process that was already there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskProcesses, startedBy, STOPPABLE } from '../src/core/procs.mjs';

const since = 1_000_000;
const AGENT = 100; const ENGINE = 1;
// A process list as processList() would return it (ms times; name/cmd only for the recent ones).
const list = [
  { id: ENGINE, ppid: 0, at: since - 50_000, name: null, cmd: null },
  { id: AGENT, ppid: ENGINE, at: since - 100, name: 'node.exe', cmd: 'node claude mcp' }, // the agent's own process
  { id: 200, ppid: AGENT, at: since + 500, name: 'node.exe', cmd: '"C:\\Program Files\\nodejs\\node.exe" server.js' }, // child of the agent, relative path
  { id: 201, ppid: 200, at: since + 600, name: 'python.exe', cmd: 'python -m http.server 8000' }, // grandchild
  { id: 202, ppid: 999, at: since + 700, name: 'python3.13.exe', cmd: 'C:\\…\\python3.13.exe -m http.server 8000' }, // the alias relaunch: parent is an AppX service
  { id: 203, ppid: 300, at: since + 800, name: 'bash.exe', cmd: 'bash -c "python -m http.server 8233"' }, // orphan: its shell (300, the agent) has gone
  { id: 50, ppid: 7, at: since - 5000, name: 'node.exe', cmd: 'node server.js' }, // created before the task: not ours
  { id: 60, ppid: 7, at: since + 900, name: 'node.exe', cmd: 'node D:\\proj\\prueba\\server.js' } // another process, but names the task folder
];

test('taskProcesses: por árbol (hijos, nietos y huérfanos del agente) y por carpeta; nunca los de antes', () => {
  const found = taskProcesses(list, { since, roots: [AGENT], dir: 'D:\\proj\\prueba', engine: ENGINE, known: new Map([[300, since - 100]]) });
  const ids = new Set(found.map((p) => p.id));
  assert.ok(ids.has(200), 'hijo del agente con ruta relativa');
  assert.ok(ids.has(201), 'nieto del agente');
  assert.ok(ids.has(203), 'bash huérfano cuyo shell era de la tarea y ya no existe');
  assert.ok(ids.has(60), 'otro proceso cuya línea de órdenes nombra la carpeta de la tarea');
  assert.ok(!ids.has(50), 'uno creado antes de la tarea: intacto');
  assert.ok(!ids.has(AGENT), 'el propio agente no es un «resto»');
  assert.ok(!ids.has(ENGINE), 'el motor no');
});

test('taskProcesses: sin raíces, solo la regla de la carpeta (como la verificación de 3.1)', () => {
  const found = taskProcesses(list, { since, roots: [], dir: 'D:\\proj\\prueba', engine: ENGINE });
  assert.deepEqual(found.map((p) => p.id).sort((a, b) => a - b), [60], 'solo el que nombra la carpeta');
});

test('startedBy: un proceso huérfano se reconoce por los argumentos del comando que lo lanzó', () => {
  assert.equal(startedBy('"C:\\…\\python3.13.exe" -m http.server 8000', ['python -m http.server 8000']), true);
  assert.equal(startedBy('node server.js', ['node server.js --port 3000']), true);
  assert.equal(startedBy('node otra.js', ['node server.js']), false);
});

test('STOPPABLE: solo runtimes y shells; nunca un navegador o un editor del usuario', () => {
  for (const n of ['node.exe', 'python3.13.exe', 'pythonw.exe', 'bash.exe', 'powershell.exe', 'npm.cmd'.replace('.cmd', ''), 'uvicorn']) assert.ok(STOPPABLE.test(n), n);
  for (const n of ['chrome.exe', 'Code.exe', 'explorer.exe', 'msedge.exe']) assert.ok(!STOPPABLE.test(n), n);
});
