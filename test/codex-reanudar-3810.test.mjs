// A Codex thread that cannot be resumed must surface as a "could not resume" error even when whoami() ran first
// (the identity check starts the process before the first message), so the usual recovery can drop the old id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { fake } from './helpers.mjs';
import { createLive } from '../src/agents/codex.mjs';
import { staleConversation } from '../src/engine/orchestrator.mjs';

const make = () => createLive({ exe: { cmd: process.execPath, pre: [fake('fake-codex-app.mjs')] }, cwd: os.tmpdir(), resumeId: '0199-stale', mcpServers: {}, permission: 'leer',
  env: { FAKE_RESUME_ERROR: 'thread not found: 0199-stale' }, onEvent: () => {}, log: () => {} });

test('send alone reports the failed resume', async () => {
  const live = make();
  const r = await live.send({ text: 'hola' });
  live.close();
  assert.equal(r.isError, true);
  assert.equal(staleConversation(r), true);
});

test('whoami first, then send: the same error, not "session closed"', async () => {
  const live = make();
  assert.equal(await live.whoami(), null);
  assert.ok(live.startFailed());
  const r = await live.send({ text: 'hola' });
  live.close();
  assert.equal(r.isError, true);
  assert.equal(staleConversation(r), true);
});
