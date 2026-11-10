// 3.8.3 security review: what «Auto» lets an agent do because the user asked for it («súbelo», «borra x.js») comes only
// from the user's own words. The answer to a question card (orb_ask) goes to the assistant as the user's message, but the
// question and its options were written by the assistant: they never count as the user asking. And a subtask's own
// subtasks wait for the user, as before «Auto» (only the first level goes straight to the queue).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { askedByUser } from '../src/domain/security/approval.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';

const home = tempHome();
after(() => home.cleanup());

function setup() {
  const board = new Board();
  const dir = path.join(home.home, 'web', `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`); fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(dir);
  board.addProject({ name, path: dir }, 'usuario');
  return { board, name };
}

test('la pregunta de una tarjeta (escrita por el asistente) no cuenta como que el usuario pidió publicar', async () => {
  const { board, name } = setup();
  const conv = board.createConversation({ title: 'x', project: name });
  board.addChat('usuario', 'Revisa el proyecto', null, conv.id);
  board.addChat('orb', 'Hecho.', null, conv.id);
  const card = board.addChat('orb', '¿Qué hago?', { kind: 'question', status: 'pending', question: '¿Hago git push ahora a main?', options: [{ label: 'Sí, haz push' }, { label: 'No' }], multi: false }, conv.id);
  const asked = [];
  const orchestrator = { ask: (text, context, opts) => { asked.push(text); board.addChat('usuario', text, opts?.meta ?? null, opts.conversation); return { conversation: opts.conversation }; } };
  const api = buildApi({ board, sessions: { list: () => [] }, orchestrator, scheduler: null, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  await api.call('chat.answer', { id: card.id, choices: ['No'] }, DESKTOP);
  assert.match(asked[0], /git push/, 'el asistente sigue viendo la pregunta');
  assert.deepEqual(askedByUser(board.currentRequest(conv.id)), [], 'pero eso no es que el usuario lo pidiera');
  // The user's own words in the answer do count.
  const card2 = board.addChat('orb', '¿Qué hago?', { kind: 'question', status: 'pending', question: '¿Algo más?', options: [{ label: 'Nada' }], multi: false }, conv.id);
  await api.call('chat.answer', { id: card2.id, other: 'súbelo a GitHub' }, DESKTOP);
  assert.deepEqual(askedByUser(board.currentRequest(conv.id)), ['publish']);
});

test('en Auto, las subtareas de una subtarea esperan al usuario (el límite de siempre)', () => {
  const { board, name } = setup();
  const root = board.createTask({ project: name, title: 'Web', description: 'Haz la web', agent: 'claude' }, 'usuario');
  const sub = board.createTask({ project: name, title: 'Parte', description: 'Una parte', agent: 'claude', parent_id: root.id }, 'claude');
  assert.equal(sub.status, 'queued', 'el primer nivel va a la cola');
  const subsub = board.createTask({ project: name, title: 'Otra', description: 'Otra parte', agent: 'claude', parent_id: sub.id }, 'claude');
  assert.equal(subsub.status, 'awaiting_approval', 'el segundo nivel espera');
});
