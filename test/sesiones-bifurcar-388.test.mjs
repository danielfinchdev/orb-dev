// «Bifurcar desde aquí»: sessions.fork with `from` copies the conversation up to one message, never the project's files.
import { tempHome, until, fakeLog } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { rewindInfo } from '../src/engine/edit-message.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';

let t; let board; let sessions; let project;
before(() => { t = tempHome(); board = new Board(); project = createProject(board, { name: 'web' }, 'usuario'); sessions = new Sessions(board, { emit: () => {} }); });
after(() => { sessions.stopAll(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const idle = (id) => until(() => !sessions.isRunning(id) && sessions.get(id), `turno de ${id}`);
const lines = (id) => sessions.items(id).filter((i) => i.kind === 'text').map((i) => `${i.role}:${typeof i.body === 'string' ? i.body : i.body.text}`);
// a chat with three turns: → { s, ids } (ids of its text lines in order)
async function talk(agent) {
  const s = sessions.create({ agent, cwd: project.path, project: 'web', title: `con ${agent}` });
  for (const m of ['uno', 'dos', 'tres']) { sessions.send(s.id, m); await idle(s.id); }
  return { s, ids: sessions.items(s.id).filter((i) => i.kind === 'text').map((i) => i.id) };
}

test('without from, fork is the same as before; with from the copy stops at that message', async () => {
  const { s, ids } = await talk('claude');
  assert.equal(lines(sessions.fork(s.id).id).length, 6);
  const copy = sessions.fork(s.id, { from: ids[2] }); // the user's «dos»
  assert.deepEqual(lines(copy.id), ['user:uno', 'assistant:Recibido: uno', 'user:dos']);
  assert.equal(copy.parent_id, s.id);
  assert.equal(lines(s.id).length, 6, 'the original is not changed');
  const answer = sessions.fork(s.id, { from: ids[1] });
  assert.deepEqual(lines(answer.id), ['user:uno', 'assistant:Recibido: uno'], 'a message of the assistant works too');
});

test('a cut copy goes on from a summary of what it holds, never from the native conversation (which has the rest)', async () => {
  for (const agent of ['claude', 'codex', 'cursor']) {
    const { s, ids } = await talk(agent);
    const copy = sessions.fork(s.id, { from: ids[1] });
    assert.equal(board.settingJson(`fork_pending:${copy.id}`), null, `${agent}: no native fork`);
    sessions.send(copy.id, 'sigo');
    await idle(copy.id);
    const text = fakeLog(t.home, `conversaciones/${copy.id}`).at(-1);
    assert.match(text.text, /^Contexto[^\n]*\nUsuario: uno\nAgente: [^\n]*uno\n\nsigo$/, agent);
    assert.ok(!text.forkSession && !text.resumeId, `${agent}: it does not resume the original`);
  }
});

test('a missing message, one of another chat, or one that is not text is refused and nothing is created', async () => {
  const { s, ids } = await talk('claude');
  const other = await talk('claude');
  const count = () => board.all("SELECT id FROM sessions WHERE kind = 'chat'").length;
  const before = count();
  for (const from of [999999, other.ids[0], 0]) assert.throws(() => sessions.fork(s.id, { from }), /no se puede/, String(from));
  const status = sessions.items(s.id).find((i) => i.kind !== 'text');
  if (status) assert.throws(() => sessions.fork(s.id, { from: status.id }));
  assert.equal(count(), before);
  assert.ok(sessions.fork(s.id, { from: ids[0] }));
});

test('forking never touches the project files', async () => {
  const { s, ids } = await talk('claude');
  const file = path.join(project.path, 'nota.txt'); fs.writeFileSync(file, 'tal cual');
  const before = fs.readdirSync(project.path).sort();
  sessions.fork(s.id, { from: ids[1] });
  assert.deepEqual(fs.readdirSync(project.path).sort(), before);
  assert.equal(fs.readFileSync(file, 'utf8'), 'tal cual');
});

test('rewindInfo says whether a message can be forked, for every agent, without needing git or a photo', async () => {
  for (const agent of ['claude', 'codex', 'cursor']) {
    const { s, ids } = await talk(agent);
    const ok = await rewindInfo(sessions, s.id, ids[1]);
    assert.equal(ok.canFork, true, agent); assert.equal(ok.forkWhy, '');
    assert.equal(typeof ok.canEdit, 'boolean'); assert.equal(typeof ok.canRewind, 'boolean', 'the existing fields stay');
    const bad = await rewindInfo(sessions, s.id, 999999);
    assert.equal(bad.canFork, false); assert.ok(bad.forkWhy);
  }
});

test('the API takes from, validates it and still forks without it', async () => {
  const { s, ids } = await talk('claude');
  const api = buildApi({ board, sessions, orchestrator: {}, scheduler: {}, emit: () => {}, log: () => {}, version: 'test' });
  const copy = await api.call('sessions.fork', { id: s.id, from: ids[0] }, DESKTOP);
  assert.deepEqual(lines(copy.id), ['user:uno']);
  assert.equal(lines((await api.call('sessions.fork', { id: s.id }, DESKTOP)).id).length, 6);
  await assert.rejects(() => api.call('sessions.fork', { id: s.id, from: 'x' }, DESKTOP));
  await assert.rejects(() => api.call('sessions.fork', { id: s.id, from: 999999 }, DESKTOP));
});
