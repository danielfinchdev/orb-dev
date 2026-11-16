// Step 10: the person's notes on a chat and the messages they pinned.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';

const t = tempHome();
after(() => t.cleanup());

test('pinning: only a message of that chat from the person or the assistant; most recent pin first; unpin; survives', () => {
  const board = new Board();
  const a = board.createConversation({ title: 'A' }); const b = board.createConversation({ title: 'B' });
  const u = board.addChat('usuario', 'Quiero una web', null, a.id).id;
  const o = board.addChat('orb', 'Hecho el plan', null, a.id).id;
  const sys = board.addChat('system', 'ruido', null, a.id).id;
  const other = board.addChat('usuario', 'de otro chat', null, b.id).id;
  assert.equal(board.pinChat(a.id, sys, true), null, 'a system line is not pinned');
  assert.equal(board.pinChat(a.id, other, true), null, 'a line of another chat is not pinned');
  assert.equal(board.pinChat(a.id, 99999, true), null);
  assert.ok(board.pinChat(a.id, u, true).pinned_at);
  assert.ok(board.pinChat(a.id, o, true).pinned_at);
  assert.deepEqual(board.pinnedChat(a.id).map((x) => x.id).sort(), [u, o].sort());
  assert.deepEqual(board.pinnedChat(b.id), []);
  board.pinChat(a.id, u, true); // again: stays pinned, keeps its time
  assert.equal(board.pinChat(a.id, u, false).pinned_at, null);
  assert.deepEqual(board.pinnedChat(a.id).map((x) => x.id), [o]);
  assert.equal(board.chat(a.id).find((x) => x.id === o).pinned_at != null, true, 'the line list says which are pinned');
});

test('notes: kept per chat, out of the list (only has_notes), cleared with empty text', () => {
  const board = new Board();
  const c = board.createConversation({ title: 'Notas' });
  assert.equal(board.conversationNotes(c.id), '');
  board.updateConversation(c.id, { notes: 'Recordar: usar pnpm' });
  assert.equal(board.conversationNotes(c.id), 'Recordar: usar pnpm');
  const listed = board.conversations().find((x) => x.id === c.id);
  assert.equal(listed.has_notes, true);
  assert.equal('notes' in listed, false, 'the list does not carry the text of every chat');
  board.updateConversation(c.id, { notes: null });
  assert.equal(board.conversationNotes(c.id), '');
  assert.equal(board.conversations().find((x) => x.id === c.id).has_notes, false);
});
