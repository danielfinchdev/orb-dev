// A button of orb_html_show › choices carries only its index: the engine sends the text it registered, with nothing granted
// by its words. «deploy it» typed by the person still counts as asking for a publish; the same words on a button do not.
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS } from '../src/domain/security/permissions.mjs';
import { agentAuth } from '../src/domain/security/agent-auth.mjs';

let t; let board; let api; let sessions; let sent;
const call = (method, params = {}) => api.call(method, params, DESKTOP);

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  sent = [];
  sessions.getLive = () => ({ lastUsed: Date.now(), logFile: null, live: { caps: {}, close() {}, isClosed: () => false, async send({ text }) {
    sent.push(text); return { final: 'ok', text: 'ok', isError: false, usage: {} };
  } } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const idle = (id) => until(() => !sessions.running.has(id), 'turno');

test('a choice button sends the registered text with nothing asked; a typed «deploy it» still does', async () => {
  await call('projects.create', { name: 'web' });
  const s = await call('sessions.create', { agent: 'claude', project: 'web', permission: 'auto', title: 'c' });
  const page = await agentAuth.onCall({ session: s.id }, 'html', { title: 'p', html: '<!doctype html><title>x</title>', choices: ['deploy it', 'Option B'] });
  assert.equal(METHODS['htmlPages.choose'], METHODS['sessions.send']);
  await call('htmlPages.choose', { id: page.id, session: s.id, index: 0 });
  await until(() => sent.length === 1, 'envío'); await idle(s.id);
  assert.match(sent[0], /deploy it/);
  assert.deepEqual(sessions.asked.get(s.id), []);
  await call('sessions.send', { id: s.id, text: 'deploy it' });
  await until(() => sent.length === 2, 'envío'); await idle(s.id);
  assert.deepEqual(sessions.asked.get(s.id), ['publish']);
});

test('a forged index, page or chat is refused', async () => {
  const a = await call('sessions.create', { agent: 'claude', project: 'web', permission: 'auto', title: 'a' });
  const b = await call('sessions.create', { agent: 'claude', project: 'web', permission: 'auto', title: 'b' });
  const page = await agentAuth.onCall({ session: a.id }, 'html', { title: 'p', html: '<!doctype html><title>x</title>', choices: ['One'] });
  const n = sent.length;
  for (const index of [1, -1, 1.5, 'x', undefined]) await assert.rejects(call('htmlPages.choose', { id: page.id, session: a.id, index }));
  await assert.rejects(call('htmlPages.choose', { id: page.id, session: b.id, index: 0 })); // another chat's page
  await assert.rejects(call('htmlPages.choose', { id: 'f'.repeat(32), session: a.id, index: 0 }));
  assert.equal(sent.length, n);
});
