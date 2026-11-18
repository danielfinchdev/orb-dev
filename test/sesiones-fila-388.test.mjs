// The short line of what a working chat does now, carried by the rows of sessions.list and inbox.list.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { activityLine, liveStep } from '../src/domain/conversations/live-line.mjs';
import { ctx } from '../src/platform/context.mjs';

let t; let board; let api; let sessions; let orchestrator;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const item = (list, id) => list.items.find((x) => x.kind === 'conversation' && x.id === Number(id));

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  ctx.config = { ...ctx.config, userName: 'Ana' };
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('activity line: the phrase of the live view, never a folder', () => {
  const step = liveStep('Edit', String.raw`C:\Users\dani\app\styles.css`);
  assert.deepEqual(step, { name: 'Edit', target: 'styles.css' });
  assert.equal(activityLine(step.name, step.target), 'Editando styles.css');
  assert.equal(activityLine('Read', ''), 'Leyendo archivos');
  assert.equal(activityLine('mcp__zzz__weird_tool_1', ''), 'Usando una herramienta');
});

test('sessions.list: a running chat carries its activity, an idle one does not', async () => {
  const s = await call('sessions.create', { agent: 'claude', permission: 'leer', title: 'Directo' });
  sessions.running.set(s.id, { step: liveStep('Edit', '/home/x/src/login.css') });
  let row = (await call('sessions.list', {})).find((x) => x.id === s.id);
  assert.equal(row.activity, 'Editando login.css');
  sessions.running.delete(s.id);
  row = (await call('sessions.list', {})).find((x) => x.id === s.id);
  assert.equal('activity' in row, false);
});

test('inbox.list: a working conversation with Orbe carries its activity', async () => {
  const c = board.createConversation({ title: 'Trabajando' }).id;
  const real = orchestrator.state.bind(orchestrator);
  orchestrator.state = (id) => (Number(id) === c ? { busy: true, tools: [{ name: 'Read', target: 'a.js', at: 1 }, { name: 'Edit', target: 'b.js', at: 2 }] } : real(id));
  try {
    const row = item(await call('inbox.list', { zone: 'orb' }), c);
    assert.equal(row.state, 'working'); assert.equal(row.activity, 'Editando b.js');
  } finally { orchestrator.state = real; }
  assert.equal('activity' in item(await call('inbox.list', { zone: 'orb' }), c), false);
});
