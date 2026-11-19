// The short list of notices the PC sent to the linked phones, so a phone can fetch the ones it missed while it was away.
// It keeps what was delivered, as it was delivered (preview setting applied): never an action token, a card or a path.
// Cleaned when a notice is written (no timers): at most RECENT_MAX rows and RECENT_DAYS days.

import { ctx } from '../../platform/context.mjs';

export const RECENT_MAX = 100;
export const RECENT_DAYS = 7;
const DAY_MS = 86_400_000;

// A hidden notice that is not a chat line must not claim a message (a chat's own hidden text is the preview setting's).
const HIDDEN_NOTICE = { es: 'Tienes un aviso nuevo', en: 'You have a new notice' };
export const NOTICE_TYPES = ['done', 'held', 'update', 'limit'];
export const hiddenNoticeText = (language) => HIDDEN_NOTICE[language] ?? HIDDEN_NOTICE.es;

const json = (v) => (v == null ? null : JSON.stringify(v));
const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };

// note: what deliverNote handed out (key, kind, title, body, hidden, route, line?) plus `target`.
export function recordNote(board, note, { conversation = null, now = Date.now() } = {}) {
  const r = board.run(
    'INSERT INTO mobile_notes (at, key, kind, title, body, hidden, route, target, line, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    now, String(note.key), String(note.kind ?? 'message'), String(note.title ?? ''), String(note.body ?? ''), note.hidden ? 1 : 0,
    json(note.route ?? null), json(note.target ?? null), note.line != null ? Number(note.line) : null, conversation != null ? Number(conversation) : null);
  pruneRecent(board);
  return Number(r.lastInsertRowid);
}

export function pruneRecent(board, now = Date.now()) {
  board.run('DELETE FROM mobile_notes WHERE at < ?', now - RECENT_DAYS * DAY_MS);
  board.run('DELETE FROM mobile_notes WHERE id NOT IN (SELECT id FROM mobile_notes ORDER BY id DESC LIMIT ?)', RECENT_MAX);
  // a chat deleted for good (the trash purge) takes its notices with it
  board.run('DELETE FROM mobile_notes WHERE conversation_id IS NOT NULL AND conversation_id NOT IN (SELECT id FROM conversations)');
}

// Newest first. A chat in the trash is skipped (it shows again if the chat is restored).
// With the preview off (preview 'none'), what was kept with detail is shown hidden, as it would be delivered today.
export function listRecent(board, { since = 0, limit = 50, now = Date.now(), preview = 'chat', hiddenText = 'Tienes un mensaje nuevo', assistantName = 'Orb' } = {}) {
  const hide = preview === 'none';
  const s = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
  const n = Math.min(RECENT_MAX, Math.max(1, Math.floor(Number(limit)) || 50));
  const rows = board.all(
    `SELECT m.* FROM mobile_notes m LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.at > ? AND m.at >= ? AND (m.conversation_id IS NULL OR (c.id IS NOT NULL AND c.trashed_at IS NULL))
     ORDER BY m.at DESC, m.id DESC LIMIT ?`, s, now - RECENT_DAYS * DAY_MS, n);
  const noticeHidden = hiddenNoticeText(ctx.config?.language);
  return rows.map((r) => ({
    id: r.id, at: r.at, key: r.key, kind: r.kind, title: hide ? assistantName : r.title,
    body: hide ? (NOTICE_TYPES.includes(r.kind) ? noticeHidden : hiddenText) : r.body, hidden: hide || Boolean(r.hidden),
    route: parse(r.route), target: parse(r.target), ...(r.line != null ? { line: r.line } : {})
  }));
}
