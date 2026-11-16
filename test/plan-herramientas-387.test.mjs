// «/plan» is one turn in «Solo lectura»: that holds for Orb's own tools too (the phone, the pull requests, the secrets),
// not only for the adapter. During the plan turn of a chat with full access the tools see «leer»; afterwards, the chat's own.
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { agentAuth } from '../src/domain/security/agent-auth.mjs';
import { tr } from '../src/platform/context.mjs';

let t; let board; let api; let sessions; let release;
const call = (method, params = {}) => api.call(method, params, DESKTOP);

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  sessions.getLive = () => ({ lastUsed: Date.now(), logFile: null, live: { caps: {}, close() {}, isClosed: () => false, async send() {
    await new Promise((r) => { release = r; });
    return { final: 'ok', text: 'ok', isError: false, usage: {} };
  } } });
});
after(() => { try { release?.(); sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const phone = (id) => agentAuth.onCall({ session: id }, 'android', { tool: 'shell', args: { command: 'ls' } }).then(() => null, (e) => e.message);

test('a /plan turn runs Orb\'s own tools read-only, and the chat gets its permission back after it', async () => {
  await call('projects.create', { name: 'web' });
  const s = await call('sessions.create', { agent: 'claude', project: 'web', permission: 'editar', title: 'plan' });
  sessions.update(s.id, { permission: 'total', android: 1 }); // full access is granted on the PC's card; here, straight in the store
  assert.notEqual(await phone(s.id), tr('msg.android.shellNeedsTotal'), 'with full access and the phone given, the chat may use the shell');
  await call('sessions.send', { id: s.id, text: '/plan algo' });
  await until(() => sessions.running.has(s.id) && release, 'turno de plan en marcha');
  assert.equal(await phone(s.id), tr('msg.android.shellNeedsTotal'), 'during the plan turn the tool sees «leer»');
  release(); release = null;
  await until(() => !sessions.running.has(s.id), 'fin del turno');
  assert.notEqual(await phone(s.id), tr('msg.android.shellNeedsTotal'), 'after it, the chat\'s own permission');
});
