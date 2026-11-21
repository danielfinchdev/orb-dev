// app.updateFound: the updater (Rust) tells the engine a new Orb was found and the linked phones get one notice.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { createRemote } from '../src/engine/transport/remote.mjs';
import { DESKTOP, REMOTE_METHODS } from '../src/domain/security/permissions.mjs';

let t; let board; let api; let apiNoRemote; let remote;
const notes = () => board.all("SELECT * FROM mobile_notes WHERE kind = 'update'");
const build = (remoteRef) => {
  const emit = () => {};
  const sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  return buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: '3.8.8', remoteRef });
};

before(() => {
  t = tempHome();
  process.env.ORB_PUSH_LOG = path.join(t.home, 'push.log');
  board = new Board();
  const remoteRef = { current: null, link: null };
  api = build(remoteRef);
  apiNoRemote = build({ current: null, link: null });
  remote = remoteRef.current = createRemote({ board, api, log: () => {}, emit: () => {}, version: '3.8.8' });
  const at = new Date().toISOString();
  board.run('INSERT OR REPLACE INTO devices (id, name, token_hash, created_at, last_seen, public_key, route, kind, ip, meta, push) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'd1', 'Móvil', 'clave:d1', at, at, 'AAAA', 'lan', 'phone', '127.0.0.1', '{}', JSON.stringify({ endpoint: 'https://push.test/d1' }));
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const found = (version) => api.call('app.updateFound', { version }, DESKTOP);

test('a malformed or not newer version announces nothing', async () => {
  for (const v of ['3.8', '3.8.9-beta', 'v3.8.9', '3.8.9 ', '1.2.3.4', '', null, undefined, 389, '3.8.8', '3.8.7', '2.99.99', `3.8.${'9'.repeat(40)}`]) {
    assert.deepEqual(await found(v), { announced: false }, String(v));
  }
  assert.equal(notes().length, 0);
});

test('without a phone link nothing is announced and nothing throws', async () => {
  assert.deepEqual(await apiNoRemote.call('app.updateFound', { version: '3.8.9' }, DESKTOP), { announced: false });
});

test('a newer version with a linked phone: one update notice aimed at the version', async () => {
  assert.deepEqual(await found('3.9.0'), { announced: true });
  const rows = notes();
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].target), { type: 'version', id: '3.9.0' });
});

test('the same version twice: a single notice', async () => {
  assert.deepEqual(await found('3.9.0'), { announced: false });
  assert.equal(notes().length, 1);
});

test('only this PC may call it: a phone is refused', async () => {
  assert.equal(REMOTE_METHODS.has('app.updateFound'), false);
  await assert.rejects(() => api.call('app.updateFound', { version: '3.9.1' }, { channel: 'remote', device: 'd1' }));
  assert.equal(notes().length, 1);
});
