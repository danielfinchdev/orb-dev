// 3.8.3 (uso real final): the raw snapshots' index (`.git/orb/index-raw`) trusts a file's date and size, as git does. A
// task that changes a file and gives it back its date (or writes that index by hand) slips past the fast snapshot after
// it. «Deshacer» and the diff of a task held for review read every file again (off the event loop), so neither is fooled.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { git } from '../src/platform/git.mjs';
import { takeCheckpoint, snapshotCommit, changedBetween, fullSnapshot } from '../src/domain/tasks/checkpoints.mjs';

let t; let board; let api; let sessions; let orchestrator; let n = 0;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const OLD = new Date(Math.floor(Date.now() / 1000) * 1000 - 3_600_000); // a whole second, an hour ago

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

// A project whose b.txt an agent changes without leaving a trace in its date or size; a.txt it changes openly.
function hiddenTask() {
  const name = `raw${++n}`;
  const repo = path.join(t.home, 'web', name); fs.mkdirSync(repo, { recursive: true });
  const g = (...a) => { const r = git(repo, ...a); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
  g('init', '-q');
  for (const [f, c] of Object.entries({ 'a.txt': 'uno\n', 'b.txt': 'dos\n', 'c.txt': 'tres\n' })) { fs.writeFileSync(path.join(repo, f), c); fs.utimesSync(path.join(repo, f), OLD, OLD); }
  g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  board.addProject({ name, path: repo }, 'usuario', { fromUser: true });
  snapshotCommit(repo, { raw: true, always: true }); // an earlier task: the raw index is warm
  const cp = takeCheckpoint(repo, `t-${name}`, path.join(t.home, 'fotos'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'UNO\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'DOS\n'); fs.utimesSync(path.join(repo, 'b.txt'), OLD, OLD);
  const at = Date.now();
  const snap = snapshotCommit(repo, { raw: true, always: true, message: 'after' });
  // The hole itself: the fast snapshot did not see b.txt.
  assert.deepEqual(changedBetween(repo, cp.commit, snap.commit).map((c) => c.path), ['a.txt']);
  const task = board.createTask({ project: name, title: 'Edit', description: 'x' }, 'usuario');
  board.settingJson(`checkpoint:${task.id}`, { before: cp, after: { kind: 'git', repo, commit: snap.commit, at }, head: null, remotes: null });
  return { repo, task };
}

test('Deshacer también devuelve un archivo cambiado con su fecha restaurada, y deja el cambio posterior del usuario', async () => {
  const { repo, task } = hiddenTask();
  fs.writeFileSync(path.join(repo, 'c.txt'), 'TRES (Dani, después)\n'); // a later edit of the user, with today's date
  await call('tasks.undo', { id: task.id });
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'uno\n');
  assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'dos\n');
  assert.equal(fs.readFileSync(path.join(repo, 'c.txt'), 'utf8'), 'TRES (Dani, después)\n');
});

test('el diff de una tarea retenida lo enseña todo, y el índice en bruto se rehace con lo releído', async () => {
  const { repo, task } = hiddenTask();
  board.patch(task.id, { status: 'blocked' }, 'orb', 'task.blocked');
  board.event(task.id, 'orb', 'task.held', 'Orb la ha parado para que la revises: borró 60 archivos');
  assert.ok(board.heldInfo(board.task(task.id)));
  const out = await call('tasks.diff', { id: task.id });
  assert.deepEqual(out.files.map((f) => f.path).sort(), ['a.txt', 'b.txt']);
  // The next fast snapshot starts from the index read again: it no longer believes the old date.
  const next = snapshotCommit(repo, { raw: true, always: true });
  assert.equal(git(repo, 'show', `${next.commit}:b.txt`).stdout, 'DOS\n');
  // And «Deshacer» of that held task gives both back.
  await call('tasks.undo', { id: task.id });
  assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'dos\n');
});

test('la pasada completa no para el bucle de eventos del motor', async () => {
  const { repo } = hiddenTask();
  let ticks = 0; const timer = setInterval(() => { ticks++; }, 1);
  const pending = fullSnapshot(repo, { message: 'x' });
  assert.ok(pending instanceof Promise);
  const snap = await pending; clearInterval(timer);
  assert.match(snap.commit, /^[0-9a-f]{40,64}$/);
  assert.equal(git(repo, 'show', `${snap.commit}:b.txt`).stdout, 'DOS\n');
  assert.ok(ticks > 0, 'the loop ran while git read the files');
});

// Real use (3.8.3 final): after «Deshacer» the next agent read in the project's log that the task had made index.html
// and found no such file («index.html no existía, a pesar de la bitácora de la tarea #11»). The undo is logged too.
test('Deshacer lo apunta en la bitácora del proyecto, para que el siguiente agente no se líe', async () => {
  const { repo, task } = hiddenTask();
  await call('tasks.undo', { id: task.id });
  const log = fs.readFileSync(board.ensureProjectLog(board.task(task.id).project), 'utf8');
  assert.match(log, new RegExp(`Tarea #${task.id} deshecha`));
  assert.match(log, /a\.txt/); assert.match(log, /ya no está en la carpeta/);
  assert.ok(fs.existsSync(repo));
});

// Real use (3.8.3 final): after «Deshacer», Orbe told Dani «no sé por qué desaparecieron los archivos de la primera
// tarea»: nobody had told it. The undo shows in that conversation and travels with the user's next message to Orbe.
test('Deshacer se ve en la conversación de la tarea y Orbe lo sabe en su siguiente turno', async () => {
  const { task } = hiddenTask();
  const conv = board.createConversation({ title: 'Web', project: task.project });
  board.run('UPDATE tasks SET conversation_id = ? WHERE id = ?', conv.id, task.id);
  await call('tasks.undo', { id: task.id });
  assert.ok(board.chat(conv.id).some((l) => l.role === 'system' && l.body.includes(`#${task.id}`)), 'una línea en su conversación');
  const note = orchestrator.takeNotes(conv.id);
  assert.match(note, new RegExp(`«Deshacer» en la tarea #${task.id} `));
  assert.equal(orchestrator.takeNotes(conv.id), '', 'una sola vez');
});
