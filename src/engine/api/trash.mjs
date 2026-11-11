// Soft delete of chats (conversations with the assistant and direct sessions) so a phone can offer «Undo».
// Trashing only stamps trashed_at and stops what the chat is doing; the visible lists skip it. Purging, a while later,
// runs the very same removal as conversations.remove / sessions.remove.
import { tr } from '../../platform/context.mjs';
import { fail, str } from './common.mjs';
import { TRASH_MS, undoUntil, expired } from '../../domain/conversations/trash.mjs';

const PURGE_EVERY_MS = 3_600_000;

export function trashTools({ board, sessions, orchestrator, scheduler, emit, log, conversationId }) {
  const told = (extra) => emit('inbox:changed', extra);

  // Deleted with its lines (its tasks stay, in Tareas).
  function removeConversation(c) {
    orchestrator.drop(c);
    // its tasks still to do (queued, waiting or working) stop with it: they would go on in the scope of the tasks
    // of no conversation, sharing messages with the manual and scheduled ones. The finished ones stay in Tareas.
    for (const t of board.all('SELECT id, status FROM tasks WHERE conversation_id = ?', c)) {
      if (!board.isFinished(t.status)) { try { scheduler.cancel(t.id, 'usuario'); } catch { /* finished meanwhile */ } }
    }
    board.run('DELETE FROM chat WHERE conversation_id = ?', c);
    board.run('UPDATE tasks SET conversation_id = NULL WHERE conversation_id = ?', c);
    board.run('DELETE FROM conversations WHERE id = ?', c);
    board.setting(`pending_questions:${c}`, '');
    board.changed('conversations');
    return { ok: true };
  }

  const assertNotTrashed = (id) => { if (board.conversation(id)?.trashed_at) fail(tr('msg.trash.inTrash')); };
  const assertSessionNotTrashed = (s) => { if (s?.trashed_at) fail(tr('msg.trash.inTrash')); };

  const chatSession = (id) => {
    const s = sessions.must(str(id, 'conversación', 64));
    if (s.kind === 'task') throw new Error(tr('msg.sessions.taskSession'));
    return s;
  };

  const methods = {
    'conversations.trash': ({ id }) => {
      const c = conversationId(id);
      let at = board.conversation(c).trashed_at;
      if (!at) {
        // the turn in progress stops; its tasks go on (only a final delete cancels them)
        orchestrator.stop(c);
        at = new Date().toISOString();
        board.run('UPDATE conversations SET trashed_at = ? WHERE id = ?', at, c);
        board.changed('conversations');
        told({ kind: 'conversation', id: c, conversation: c });
      }
      return { undo: undoUntil(at) };
    },
    'conversations.restore': ({ id }) => {
      const c = conversationId(id);
      const row = board.conversation(c);
      if (row.trashed_at) {
        if (expired(row.trashed_at)) fail(tr('msg.board.noConversation'));
        board.run('UPDATE conversations SET trashed_at = NULL WHERE id = ?', c);
        board.changed('conversations');
        told({ kind: 'conversation', id: c, conversation: c });
      }
      return board.conversation(c);
    },
    'sessions.trash': ({ id }) => {
      const s = chatSession(id);
      let at = s.trashed_at;
      if (!at) {
        if (sessions.isRunning(s.id)) sessions.stop(s.id);
        at = new Date().toISOString();
        board.run('UPDATE sessions SET trashed_at = ? WHERE id = ?', at, s.id);
        board.changed('sessions');
        emit('session:removed', { id: s.id });
        told({ kind: 'session', id: s.id });
      }
      return { undo: undoUntil(at) };
    },
    'sessions.restore': ({ id }) => {
      const s = chatSession(id);
      if (s.trashed_at) {
        if (expired(s.trashed_at)) throw new Error(tr('msg.sessions.noConversation'));
        board.run('UPDATE sessions SET trashed_at = NULL WHERE id = ?', s.id);
        board.changed('sessions');
        emit('session:update', sessions.get(s.id));
        told({ kind: 'session', id: s.id });
      }
      return sessions.get(s.id);
    },
  };

  // Deletes for good what has been in the trash longer than the term. One that cannot go now (a session still
  // running) waits for the next pass; the rest are not affected.
  function purge(nowMs = Date.now()) {
    const cutoff = new Date(nowMs - TRASH_MS).toISOString();
    let n = 0;
    for (const { id } of board.all('SELECT id FROM conversations WHERE trashed_at IS NOT NULL AND trashed_at <= ?', cutoff)) {
      try { removeConversation(id); n++; } catch (error) { log(`papelera: conversación ${id}: ${error.message}`); }
    }
    for (const { id } of board.all("SELECT id FROM sessions WHERE trashed_at IS NOT NULL AND trashed_at <= ? AND kind <> 'task'", cutoff)) {
      try { sessions.remove(id); n++; } catch (error) { log(`papelera: sesión ${id}: ${error.message}`); }
    }
    return n;
  }
  // Called from the engine's existing tick: at most once an hour (the first call, at start, runs it), no timer of its own.
  let lastPurge = 0;
  function purgeIfDue(nowMs = Date.now()) {
    if (nowMs - lastPurge < PURGE_EVERY_MS) return;
    lastPurge = nowMs;
    try { purge(nowMs); } catch (error) { log(`papelera: ${error.message}`); }
  }

  return { methods, removeConversation, assertNotTrashed, assertSessionNotTrashed, purge, purgeIfDue };
}
