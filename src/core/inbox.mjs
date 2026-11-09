// 3.6 (messaging lists): the marks on the chats of the list (the conversations with Orbe and the direct ones with an
// agent) and what the list shows of each chat: its last message, how many are unread (tables inbox_items and
// inbox_sections). No engine imports: plain data.
import { oneLine } from './safety.mjs';

// 3.6: session = a direct conversation with an agent: it can be pinned and muted like the others. 3.8: the list of the
// bots is gone; the rows of a 3.7 database with kind «bot» or «group» (zone «bots») are left out until the 3.8
// migration removes them.
export const KINDS = ['conversation', 'session'];
export const ZONES = ['orb'];
export const zoneOf = (kind) => (KINDS.includes(kind) ? 'orb' : null);
export const keyOf = (kind, id) => `${kind}:${id}`;
const has = (board, table) => { try { return Boolean(board.one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table)); } catch { return false; } };
// 3.8: one owner. The tables' person_id (part of their key since 3.6) holds this fixed key; a 3.7 database's rows (a
// person's id) are rewritten to it by the 3.8 migration.
export const ME = 'owner';

// ---- which chat a conversation is, and the conversation of a chat (never made here: a chat nobody opened has none yet)
export function itemOfConversation(board, conversation) {
  // A bot's or a group's conversation of a 3.7 database is in no list.
  const r = conversation == null ? null : board.one('SELECT id FROM conversations WHERE id = ? AND bot_id IS NULL AND group_id IS NULL', Number(conversation));
  return r ? { kind: 'conversation', id: String(r.id) } : null;
}
export const conversationOf = (board, kind, id) => (kind === 'conversation' ? board.one('SELECT id FROM conversations WHERE id = ? AND bot_id IS NULL AND group_id IS NULL', Number(id))?.id ?? null : null);

// ---- the marks (a chat without a row: not pinned, no section, not muted, nothing read but the starting point)
const DEFAULT = { pinned: false, pinOrder: null, section: null, muted: false, lastRead: 0, snoozedUntil: null };
const view = (r) => (r ? { pinned: Boolean(r.pinned), pinOrder: r.pin_order ?? null, section: r.section_id ?? null, muted: Boolean(r.muted), lastRead: Number(r.last_read) || 0, snoozedUntil: r.snoozed_until ?? null } : { ...DEFAULT });
export function marks(board) {
  const out = new Map();
  if (!has(board, 'inbox_items')) return out;
  for (const r of board.all('SELECT * FROM inbox_items WHERE person_id = ?', ME)) out.set(keyOf(r.kind, r.item_id), view(r));
  return out;
}
// No row: the marks of a chat nobody marked.
export const noMark = () => ({ ...DEFAULT });
export const mark = (board, kind, id) => view(board.one('SELECT * FROM inbox_items WHERE person_id = ? AND kind = ? AND item_id = ?', ME, kind, String(id)));
const COLS = { pinned: 'pinned', pinOrder: 'pin_order', section: 'section_id', muted: 'muted', lastRead: 'last_read', snoozedUntil: 'snoozed_until' };
export function setMark(board, kind, id, fields) {
  const keys = Object.keys(fields).filter((k) => COLS[k]);
  const val = (k) => (typeof fields[k] === 'boolean' ? Number(fields[k]) : fields[k] ?? null);
  board.run('INSERT OR IGNORE INTO inbox_items (person_id, kind, item_id) VALUES (?, ?, ?)', ME, kind, String(id));
  if (keys.length) board.run(`UPDATE inbox_items SET ${keys.map((k) => `${COLS[k]} = ?`).join(', ')} WHERE person_id = ? AND kind = ? AND item_id = ?`, ...keys.map(val), ME, kind, String(id));
  return mark(board, kind, id);
}

// ---- snooze (3.8.2): a chat hidden from the list until a time. The scheduler's tick wakes the ones that are due:
// their mark is cleared and they come back where their last activity puts them. Returns the woken items.
export const SNOOZE_MAX_MS = 366 * 24 * 3600 * 1000;
export function snoozeUntil(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const at = Date.parse(String(value));
  if (!Number.isFinite(at) || at <= now || at - now > SNOOZE_MAX_MS) return undefined;
  return new Date(at).toISOString();
}
export function wakeSnoozed(board, now = new Date()) {
  if (!has(board, 'inbox_items')) return [];
  const due = board.all('SELECT kind, item_id FROM inbox_items WHERE person_id = ? AND snoozed_until IS NOT NULL AND snoozed_until <= ?', ME, now.toISOString());
  if (due.length) board.run('UPDATE inbox_items SET snoozed_until = NULL WHERE person_id = ? AND snoozed_until IS NOT NULL AND snoozed_until <= ?', ME, now.toISOString());
  return due.map((r) => ({ kind: r.kind, id: r.item_id }));
}

// ---- read state. Where the counting starts: the last line when the lists were first used (old chats are not all
// «unread» on the first day), or just before the first line that came.
const SINCE = `inbox_since:${ME}`;
export function since(board, { before = null } = {}) {
  const v = board.setting(SINCE);
  if (v != null) return Number(v) || 0;
  const start = before != null ? Math.max(0, Number(before) - 1) : board.one('SELECT MAX(id) AS id FROM chat')?.id ?? 0;
  board.setting(SINCE, String(start));
  return start;
}
// Lines that count as unread: anything but the user's own messages, never the passing notices.
export function unread(board, conversation, lastRead) {
  if (conversation == null) return 0;
  const from = Math.max(Number(lastRead) || 0, since(board));
  return board.one("SELECT COUNT(*) AS n FROM chat WHERE conversation_id = ? AND id > ? AND role NOT IN ('notice', 'usuario')", Number(conversation), from)?.n ?? 0;
}
// 3.8.1: the same for many conversations in one query: [[conversation, lastRead]] → Map conversation → unread.
export function unreadMany(board, list) {
  const start = since(board);
  const pairs = JSON.stringify(list.filter(([c]) => c != null).map(([c, lastRead]) => [Number(c), Math.max(Number(lastRead) || 0, start)]));
  return new Map(board.all("SELECT j.value ->> 0 AS c, (SELECT COUNT(*) FROM chat WHERE conversation_id = j.value ->> 0 AND id > j.value ->> 1 AND role NOT IN ('notice', 'usuario')) AS n FROM json_each(?) j", pairs).map((r) => [Number(r.c), r.n]));
}
export function markRead(board, kind, id, conversation, upTo = null) {
  const last = conversation == null ? 0 : board.one("SELECT MAX(id) AS id FROM chat WHERE conversation_id = ? AND role != 'notice'", Number(conversation))?.id ?? 0;
  const to = upTo == null ? last : Math.min(Number(upTo), last);
  const was = mark(board, kind, id).lastRead;
  return to > was ? setMark(board, kind, id, { lastRead: to }) : mark(board, kind, id);
}
export function isMuted(board, conversation) {
  if (!has(board, 'inbox_items')) return false;
  const it = itemOfConversation(board, conversation);
  return Boolean(it && board.one('SELECT muted FROM inbox_items WHERE person_id = ? AND kind = ? AND item_id = ?', ME, it.kind, it.id)?.muted);
}

// ---- sections
export function sections(board, zone) {
  if (!has(board, 'inbox_sections')) return [];
  return board.all('SELECT id, name, position FROM inbox_sections WHERE person_id = ? AND zone = ? ORDER BY position, id', ME, zone);
}
export const section = (board, id) => board.one('SELECT id, zone, name, position FROM inbox_sections WHERE id = ? AND person_id = ?', Number(id), ME) ?? null;
export function createSection(board, zone, name) {
  const pos = (board.one('SELECT MAX(position) AS p FROM inbox_sections WHERE person_id = ? AND zone = ?', ME, zone)?.p ?? -1) + 1;
  const { lastInsertRowid } = board.run('INSERT INTO inbox_sections (person_id, zone, name, position, created_at) VALUES (?, ?, ?, ?, ?)', ME, zone, name, pos, new Date().toISOString());
  return section(board, Number(lastInsertRowid));
}
export function deleteSection(board, id) {
  board.transaction(() => {
    board.run('UPDATE inbox_items SET section_id = NULL WHERE person_id = ? AND section_id = ?', ME, Number(id));
    board.run('DELETE FROM inbox_sections WHERE id = ? AND person_id = ?', Number(id), ME);
  });
}
// The pins of one zone in their order (1, 2, 3…), the ones in `order` first.
export function reorderPins(board, zone, order = []) {
  const pinned = board.all('SELECT kind, item_id, pin_order FROM inbox_items WHERE person_id = ? AND pinned = 1 ORDER BY pin_order IS NULL, pin_order, rowid', ME)
    .filter((r) => zoneOf(r.kind) === zone).map((r) => keyOf(r.kind, r.item_id));
  const wanted = order.filter((k) => pinned.includes(k));
  const next = [...new Set([...wanted, ...pinned])];
  board.transaction(() => next.forEach((k, i) => { const [kind, ...rest] = k.split(':'); board.run('UPDATE inbox_items SET pin_order = ? WHERE person_id = ? AND kind = ? AND item_id = ?', i + 1, ME, kind, rest.join(':')); }));
  return next;
}
export const nextPinOrder = (board, zone) => board.all('SELECT kind, pin_order FROM inbox_items WHERE person_id = ? AND pinned = 1', ME)
  .filter((r) => zoneOf(r.kind) === zone).reduce((m, r) => Math.max(m, Number(r.pin_order) || 0), 0) + 1;

// ---- what the list shows of a line: short plain text (no Markdown marks), when, and who it is from.
export function plain(text, max = 120) {
  const s = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, '$1$2');
  const one = oneLine(s, max + 1);
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}
const parse = (m) => { try { return m ? JSON.parse(m) : null; } catch { return null; } };
// kind of a line for the list: text, question, report, system
const lineKind = (r, meta) => (meta?.kind === 'question' ? 'question' : meta?.kind === 'report' ? 'report' : r.role === 'system' ? 'system' : 'text');
export function describeLine(r, { userName = '' } = {}) {
  if (!r) return null;
  const meta = parse(r.meta);
  let from;
  if (r.role === 'usuario') from = { type: 'user', name: userName };
  else if (r.role === 'orb') from = { type: 'orbe' };
  else from = { type: 'system' };
  return { id: r.id, text: plain(r.body), at: r.at, from, kind: lineKind(r, meta) };
}
// The last line of each of these conversations (3.8.1: in one query; it was one per conversation): Map id → row.
export function lastLines(board, conversations) {
  const out = new Map();
  const ids = JSON.stringify(conversations.map(Number).filter(Number.isFinite));
  for (const r of board.all("SELECT j.value AS c, ch.id, ch.role, ch.body, ch.meta, ch.at FROM json_each(?) j JOIN chat ch ON ch.id = (SELECT id FROM chat WHERE conversation_id = j.value AND role != 'notice' ORDER BY id DESC LIMIT 1)", ids)) {
    const { c, ...row } = r; out.set(Number(c), row);
  }
  return out;
}

// ---- search: lower case and without accents («cafe» finds «Café»)
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function snippet(text, q, max = 120) {
  const s = plain(text, 4000); const i = fold(s).indexOf(fold(q));
  if (i < 0 || s.length <= max) return s.slice(0, max);
  const start = Math.max(0, i - Math.floor((max - q.length) / 2));
  return `${start > 0 ? '…' : ''}${s.slice(start, start + max).trim()}${start + max < s.length ? '…' : ''}`;
}
