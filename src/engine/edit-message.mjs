// «Editar» a message of a direct chat: the conversation goes on from the edited message, optionally with the project's
// files put back as they were before it (domain/conversations/rewind.mjs). What came after stays in a copy of the chat
// called «(versión anterior)», so nothing the user saw is lost. Takes the Sessions instance like modes.mjs does.
import { tr } from '../platform/context.mjs';
import { AGENT_LABELS } from '../platform/config-file.mjs';
import { permissionOfAutonomy, globalAutonomy } from '../domain/security/guard.mjs';
import { photoBefore } from '../domain/conversations/turns.mjs';
import { rewindFiles, undoRewindFiles } from '../domain/conversations/rewind.mjs';
import { buildHandoff, HANDOFF_LOOKBACK } from './handoff.mjs';
import { isGitRepoAsync } from '../platform/git.mjs';

const parse = (row) => { let body = row.body; if (/^[[{]/.test(body)) { try { body = JSON.parse(body); } catch { /* plain text */ } } return { ...row, body }; };
const fail = (key, vars) => { throw new Error(tr(key, vars)); };

// another chat that is working in the same folder: a rewind would pull files from under it
const otherRunning = (sessions, s) => [...sessions.running.keys()].some((k) => k !== s.id && sessions.get(k)?.cwd === s.cwd);

function userItem(sessions, s, itemId) {
  const row = sessions.board.one('SELECT * FROM session_items WHERE id = ? AND session_id = ?', Number(itemId), s.id);
  const item = row && parse(row);
  return item && item.role === 'user' && item.kind === 'text' ? item : null;
}

// What the dialog may offer for this message. → { canEdit, editWhy, canRewind, rewindWhy } (a «why» is text for the user)
export async function rewindInfo(sessions, id, itemId) {
  const s = sessions.must(id);
  const info = { canEdit: false, editWhy: '', canRewind: false, rewindWhy: '' };
  if (s.kind !== 'chat') { info.editWhy = tr('msg.edit.notChat'); return info; }
  if (!userItem(sessions, s, itemId)) { info.editWhy = tr('msg.edit.noMessage'); return info; }
  if (sessions.running.has(id) || sessions.pendingApprovals(id).length) { info.editWhy = tr('msg.edit.busy'); return info; }
  info.canEdit = true;
  if (!s.project) { info.rewindWhy = tr('msg.edit.noProject'); return info; }
  if (otherRunning(sessions, s)) { info.rewindWhy = tr('msg.edit.otherRunning'); return info; }
  if (!(await isGitRepoAsync(s.cwd))) { info.rewindWhy = tr('msg.edit.noGit'); return info; }
  if (!(await photoBefore(s.cwd, s.id, itemId))) { info.rewindWhy = tr('msg.edit.noPhoto'); return info; }
  info.canRewind = true;
  return info;
}

export async function editMessage(sessions, id, itemId, text, { rewind = false } = {}) {
  const s = sessions.must(id);
  const info = await rewindInfo(sessions, id, itemId);
  if (!info.canEdit) throw new Error(info.editWhy);
  const clean = String(text ?? '').trim();
  if (!clean) fail('msg.sessions.writeMessage');
  if (rewind && !info.canRewind) throw new Error(info.rewindWhy);
  const mark = Number(itemId);

  // the files go first: if they cannot be put back, nothing else changes
  let rewound = null;
  if (rewind) {
    try { rewound = await rewindFiles(s.cwd, s.id, mark); }
    catch (error) { fail('msg.edit.rewindFailed', { message: error.message }); }
  }
  // a turn could have started while the rewind ran
  if (sessions.running.has(id)) fail('msg.edit.busy');

  const board = sessions.board;
  const label = AGENT_LABELS[s.agent] ?? s.agent;
  const rows = board.all("SELECT role, kind, body, at FROM session_items WHERE session_id = ? AND kind = 'text' AND role IN ('user', 'assistant') AND id < ? ORDER BY id DESC LIMIT ?", s.id, mark, HANDOFF_LOOKBACK).reverse().map(parse);
  const summary = buildHandoff(rows, { fromLabel: label, toLabel: label });

  // The copy holds the whole conversation as it was. It gets fresh ids in order, so its list reads top to bottom;
  // the originals from the edited message on leave this chat.
  const copy = sessions.create({ kind: 'chat', agent: s.agent, account: s.account, model: s.model, reasoning: s.reasoning,
    permission: s.permission !== 'total' ? s.permission : s.project ? permissionOfAutonomy(globalAutonomy()) : 'leer',
    project: s.project, cwd: s.cwd, title: tr('msg.edit.copyTitle', { title: s.title }), parentId: s.id });
  board.transaction(() => {
    board.run('UPDATE sessions SET titled = 1 WHERE id = ?', copy.id);
    const all = board.all('SELECT role, kind, body, at, id FROM session_items WHERE session_id = ? ORDER BY id', s.id);
    for (const it of all) {
      const waiting = it.kind === 'approval' && parse(it).body?.status === 'pending';
      if (!waiting) board.run('INSERT INTO session_items (session_id, role, kind, body, at) VALUES (?, ?, ?, ?, ?)', copy.id, it.role, it.kind, it.body, it.at);
    }
    board.run('DELETE FROM session_items WHERE session_id = ? AND id >= ?', s.id, mark);
    // the native conversation holds everything that was said, so the copy can be continued from there
    board.run('UPDATE sessions SET cli_session = ?, context = ? WHERE id = ?', s.cli_session ?? null, s.context ?? null, copy.id);
  });
  sessions.addItem(copy.id, 'system', 'status', tr('msg.edit.copyNote', { title: s.title }));

  sessions.asked.delete(id);
  sessions.closeLive(id);
  board.settingJson(`fork_summary:${id}`, null); board.settingJson(`fork_pending:${id}`, null);
  if (board.settingJson(`goal:${id}`)) { board.settingJson(`goal:${id}`, null); sessions.emit('session:goal', { id, goal: null }); }
  board.run('UPDATE sessions SET cli_session = NULL, context = NULL WHERE id = ?', id);
  board.settingJson(`handoff_summary:${id}`, summary.text);
  if (rewound) {
    sessions.addItem(id, 'system', 'rewind', { rescue: rewound.rescue, target: rewound.target, ref: rewound.ref, restored: rewound.restored, removed: rewound.removed,
      skipped: rewound.skipped, files: rewound.files, undone: false, at: new Date().toISOString() });
  }
  sessions.emit('session:update', sessions.get(copy.id)); sessions.emit('session:update', sessions.get(id));
  sessions.emit('session:reset', { id }); // the window reloads this chat's list: items left it

  sessions.send(id, clean);
  return { ok: true, copy: copy.id, rewound: Boolean(rewound) };
}

// «Deshacer el rebobinado»: what the rewind changed goes back, only in files still as it left them.
export async function undoRewind(sessions, id, itemId) {
  const s = sessions.must(id);
  if (s.kind !== 'chat') fail('msg.edit.notChat');
  const row = sessions.board.one('SELECT * FROM session_items WHERE id = ? AND session_id = ? AND kind = ?', Number(itemId), s.id, 'rewind');
  const item = row && parse(row);
  if (!item || typeof item.body !== 'object') fail('msg.edit.noRewind');
  if (item.body.undone) fail('msg.edit.alreadyUndone');
  if (sessions.running.has(id) || sessions.pendingApprovals(id).length) fail('msg.edit.busy');
  if (otherRunning(sessions, s)) fail('msg.edit.otherRunning');
  let out;
  try { out = await undoRewindFiles(s.cwd, item.body); }
  catch (error) { fail('msg.edit.undoFailed', { message: error.message }); }
  sessions.updateItem(item.id, { ...item.body, undone: true, undoneAt: new Date().toISOString(), result: { restored: out.restored, removed: out.removed, skipped: out.skipped, skippedFiles: out.files.skipped } });
  return { ok: true, ...out };
}
