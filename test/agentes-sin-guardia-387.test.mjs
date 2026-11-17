// Pi and Antigravity only run with «total» (src/agents/unguarded.mjs): Orb must never hand them work by itself
// (reviews, «any agent» tasks) nor switch a chat to them with «Pasar a otro agente» / «Bifurcar».
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { ReviewsPart } from '../src/engine/scheduler/reviews.mjs';
import { UNGUARDED_AGENTS } from '../src/agents/unguarded.mjs';

const on = { enabled: true, path: process.execPath };
let t; let board; let sessions; let project;
before(() => {
  t = tempHome({ agentOrder: ['pi', 'antigravity', 'codex'], agents: { pi: on, antigravity: on, codex: on } });
  board = new Board(); project = createProject(board, { name: 'web' }, 'usuario'); sessions = new Sessions(board, { emit: () => {} });
});
after(() => { sessions.stopAll(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('the unguarded list names exactly Pi and Antigravity', () => assert.deepEqual([...UNGUARDED_AGENTS], ['pi', 'antigravity']));

test('reviews never go to an agent that cannot ask Orb, even when it is first in the order', () => {
  const picked = ReviewsPart.prototype.reviewer.call({ board });
  assert.ok(!UNGUARDED_AGENTS.includes(picked), `reviewer picked ${picked}`);
});

test('«Pasar a otro agente» and «Bifurcar» refuse Pi and Antigravity, and the chat stays as it was', () => {
  const s = sessions.create({ agent: 'claude', cwd: project.path, project: 'web', title: 'c' });
  for (const agent of UNGUARDED_AGENTS) {
    assert.throws(() => sessions.handoff(s.id, { agent }), (e) => e.userFacing);
    assert.throws(() => sessions.fork(s.id, { agent }), (e) => e.userFacing);
  }
  assert.equal(sessions.get(s.id).agent, 'claude');
  assert.equal(sessions.handoff(s.id, { agent: 'codex' }).agent, 'codex', 'a guarded agent still works');
});
