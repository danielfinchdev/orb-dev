// A direct chat that moves to another account of its agent keeps what was said: the next turn starts from a summary,
// because the agent's own conversation stays in the old account's folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Sessions } from '../src/engine/sessions.mjs';

const t = tempHome();
let board; let sessions; let project;
before(() => {
  ctx.config.accounts = [
    { id: 'claude', agent: 'claude', label: 'PGC', home: '', enabled: true },
    { id: 'claude-2', agent: 'claude', label: 'STAMINA', home: '', enabled: true }
  ];
  board = new Board(); project = createProject(board, { name: 'web' }, 'usuario'); sessions = new Sessions(board, { emit: () => {} });
});
after(() => { sessions.stopAll(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('changing the account of a chat with history stores a summary for the next turn', () => {
  const s = sessions.create({ agent: 'claude', account: 'claude', accountFixed: true, cwd: project.path, project: 'web', title: 'x' });
  sessions.addItem(s.id, 'user', 'text', 'recuerda que la clave del plan es naranja');
  sessions.addItem(s.id, 'assistant', 'text', 'anotado, naranja');
  sessions.update(s.id, { cli_session: 'abc' });
  sessions.update(s.id, { account: 'claude-2' });
  const after = sessions.get(s.id);
  assert.equal(after.cli_session, null);
  const summary = board.settingJson(`handoff_summary:${s.id}`);
  assert.match(summary, /naranja/);
  assert.match(summary, /PGC/);
});

test('a chat that never talked stores no summary', () => {
  const s = sessions.create({ agent: 'claude', account: 'claude', accountFixed: true, cwd: project.path, project: 'web', title: 'y' });
  sessions.update(s.id, { account: 'claude-2' });
  assert.equal(board.settingJson(`handoff_summary:${s.id}`) ?? null, null);
});

test('a stored account problem comes back with the session and goes when the account changes', () => {
  const s = sessions.create({ agent: 'claude', account: 'claude', accountFixed: true, cwd: project.path, project: 'web', title: 'z' });
  board.settingJson(`account_problem:${s.id}`, { kind: 'limit', account: 'claude', until: 1 });
  assert.equal(sessions.get(s.id).accountProblem.kind, 'limit');
  assert.equal(sessions.list().find((x) => x.id === s.id).accountProblem.account, 'claude');
  sessions.update(s.id, { account: 'claude-2' });
  assert.equal(sessions.get(s.id).accountProblem, undefined);
  assert.equal(board.settingJson(`account_problem:${s.id}`), null);
});
