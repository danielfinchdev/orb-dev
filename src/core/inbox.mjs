// 3.6 (messaging lists): each person's own marks on the chats of the two lists — Bots (bots and groups) and Orb (the
// conversations with Orbe) — and what the lists show of each chat: its last message, how many are unread. Everything here
// is one person's (tables inbox_items and inbox_sections, both with person_id); who may see each chat is authz's
// (src/engine/api-inbox.mjs asks it). No engine imports: plain data.
import { ownerOfBoard } from './authz.mjs';
import { oneLine } from './safety.mjs';

// 3.6: session = a direct conversation with an agent (Orb list): it can be pinned and muted like the others.
export const KINDS = ['bot', 'group', 'conversation', 'session'];
export const ZONES = ['bots', 'orb'];
export const zoneOf = (kind) => (kind === 'conversation' || kind === 'session' ? 'orb' : 'bots');
export const keyOf = (kind, id) => `${kind}:${id}`;
const has = (board, table) => { try { return Boolean(board.one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table)); } catch { return false; } };
const owner = (board) => ownerOfBoard(board);
const isOwner = (board, person) => !person || person === owner(board);
const mine = (board, person, a = '') => (isOwner(board, person)
  ? { where: `(${a}person_id = ? OR ${a}person_id IS NULL)`, args: [person ?? owner(board) ?? ''] }
  : { where: `${a}person_id = ?`, args: [person] });

// ---- which chat a conversation is, and the conversation of a chat (never made here: a chat nobody opened has none yet)
export function itemOfConversation(board, conversation) {
  const r = conversation == null ? null : board.one('SELECT id, bot_id, group_id FROM conversations WHERE id = ?', Number(conversation));
  if (!r) return null;
  if (r.group_id != null) return { kind: 'group', id: String(r.group_id) };
  if (r.bot_id != null) return { kind: 'bot', id: String(r.bot_id) };
  return { kind: 'conversation', id: String(r.id) };
}
export function conversationOf(board, person, kind, id) {
  if (kind === 'conversation') return board.one('SELECT id FROM conversations WHERE id = ? AND bot_id IS NULL AND group_id IS NULL', Number(id))?.id ?? null;
  if (kind === 'group') return board.one('SELECT id FROM conversations WHERE group_id = ? ORDER BY id LIMIT 1', Number(id))?.id ?? null;
  if (kind === 'bot') { const s = mine(board, person); return board.one(`SELECT id FROM conversations WHERE bot_id = ? AND group_id IS NULL AND ${s.where} ORDER BY id LIMIT 1`, Number(id), ...s.args)?.id ?? null; }
  return null;
}

// ---- the marks (a chat without a row: not pinned, no section, not muted, nothing read but the starting point)
const DEFAULT = { pinned: false, pinOrder: null, section: null, muted: false, lastRead: 0 };
const view = (r) => (r ? { pinned: Boolean(r.pinned), pinOrder: r.pin_order ?? null, section: r.section_id ?? null, muted: Boolean(r.muted), lastRead: Number(r.last_read) || 0 } : { ...DEFAULT });
export function marks(board, person) {
  const out = new Map();
  if (!has(board, 'inbox_items')) return out;
  for (const r of board.all('SELECT * FROM inbox_items WHERE person_id = ?', String(person))) out.set(keyOf(r.kind, r.item_id), view(r));
  return out;
}
export const mark = (board, person, kind, id) => view(board.one('SELECT * FROM inbox_items WHERE person_id = ? AND kind = ? AND item_id = ?', String(person), kind, String(id)));
const COLS = { pinned: 'pinned', pinOrder: 'pin_order', section: 'section_id', muted: 'muted', lastRead: 'last_read' };
export function setMark(board, person, kind, id, fields) {
  const keys = Object.keys(fields).filter((k) => COLS[k]);
  const val = (k) => (typeof fields[k] === 'boolean' ? Number(fields[k]) : fields[k] ?? null);
  board.run('INSERT OR IGNORE INTO inbox_items (person_id, kind, item_id) VALUES (?, ?, ?)', String(person), kind, String(id));
  if (keys.length) board.run(`UPDATE inbox_items SET ${keys.map((k) => `${COLS[k]} = ?`).join(', ')} WHERE person_id = ? AND kind = ? AND item_id = ?`, ...keys.map(val), String(person), kind, String(id));
  return mark(board, person, kind, id);
}

// ---- read state. Where a person starts counting: the last line when they first used the lists (old chats are not all
// «unread» on the first day), or just before the first line that reached them.
const SINCE = (person) => `inbox_since:${person}`;
export function since(board, person, { before = null } = {}) {
  const v = board.setting(SINCE(person));
  if (v != null) return Number(v) || 0;
  const start = before != null ? Math.max(0, Number(before) - 1) : board.one('SELECT MAX(id) AS id FROM chat')?.id ?? 0;
  board.setting(SINCE(person), String(start));
  return start;
}
// Lines that count as unread: anyone's but the person's own messages, never the passing notices.
export function unread(board, person, conversation, lastRead) {
  if (conversation == null) return 0;
  const from = Math.max(Number(lastRead) || 0, since(board, person));
  return board.one("SELECT COUNT(*) AS n FROM chat WHERE conversation_id = ? AND id > ? AND role != 'notice' AND NOT (role = 'usuario' AND COALESCE(person_id, ?) = ?)", Number(conversation), from, owner(board) ?? '', String(person))?.n ?? 0;
}
export function markRead(board, person, kind, id, conversation, upTo = null) {
  const last = conversation == null ? 0 : board.one("SELECT MAX(id) AS id FROM chat WHERE conversation_id = ? AND role != 'notice'", Number(conversation))?.id ?? 0;
  const to = upTo == null ? last : Math.min(Number(upTo), last);
  const was = mark(board, person, kind, id).lastRead;
  return to > was ? setMark(board, person, kind, id, { lastRead: to }) : mark(board, person, kind, id);
}
export function isMuted(board, person, conversation) {
  if (!has(board, 'inbox_items')) return false;
  const it = itemOfConversation(board, conversation);
  return Boolean(it && board.one('SELECT muted FROM inbox_items WHERE person_id = ? AND kind = ? AND item_id = ?', String(person), it.kind, it.id)?.muted);
}

// ---- sections
export function sections(board, person, zone) {
  if (!has(board, 'inbox_sections')) return [];
  return board.all('SELECT id, name, position FROM inbox_sections WHERE person_id = ? AND zone = ? ORDER BY position, id', String(person), zone);
}
export const section = (board, person, id) => board.one('SELECT id, zone, name, position FROM inbox_sections WHERE id = ? AND person_id = ?', Number(id), String(person)) ?? null;
export function createSection(board, person, zone, name) {
  const pos = (board.one('SELECT MAX(position) AS p FROM inbox_sections WHERE person_id = ? AND zone = ?', String(person), zone)?.p ?? -1) + 1;
  const { lastInsertRowid } = board.run('INSERT INTO inbox_sections (person_id, zone, name, position, created_at) VALUES (?, ?, ?, ?, ?)', String(person), zone, name, pos, new Date().toISOString());
  return section(board, person, Number(lastInsertRowid));
}
export function deleteSection(board, person, id) {
  board.transaction(() => {
    board.run('UPDATE inbox_items SET section_id = NULL WHERE person_id = ? AND section_id = ?', String(person), Number(id));
    board.run('DELETE FROM inbox_sections WHERE id = ? AND person_id = ?', Number(id), String(person));
  });
}
// The pins of one zone in their order (1, 2, 3…), the ones in `order` first.
export function reorderPins(board, person, zone, order = []) {
  const pinned = board.all('SELECT kind, item_id, pin_order FROM inbox_items WHERE person_id = ? AND pinned = 1 ORDER BY pin_order IS NULL, pin_order, rowid', String(person))
    .filter((r) => zoneOf(r.kind) === zone).map((r) => keyOf(r.kind, r.item_id));
  const wanted = order.filter((k) => pinned.includes(k));
  const next = [...new Set([...wanted, ...pinned])];
  board.transaction(() => next.forEach((k, i) => { const [kind, ...rest] = k.split(':'); board.run('UPDATE inbox_items SET pin_order = ? WHERE person_id = ? AND kind = ? AND item_id = ?', i + 1, String(person), kind, rest.join(':')); }));
  return next;
}
export const nextPinOrder = (board, person, zone) => board.all('SELECT kind, pin_order FROM inbox_items WHERE person_id = ? AND pinned = 1', String(person))
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
// kind of a line for the list: text, card (an approval), question, reminder, report, system
const lineKind = (r, meta) => (meta?.kind === 'bot_card' ? 'card' : meta?.kind === 'bot_question' || meta?.kind === 'question' ? 'question' : meta?.kind === 'reminder' ? 'reminder'
  : meta?.kind === 'report' ? 'report' : r.role === 'system' ? 'system' : 'text');
export function describeLine(board, r, { botName = (id) => board.one('SELECT name FROM bots WHERE id = ?', Number(id))?.name ?? null, personName = (id) => id } = {}) {
  if (!r) return null;
  const meta = parse(r.meta);
  let from;
  if (r.role === 'usuario') { const pid = r.person_id ?? owner(board); from = { type: 'user', person: pid, name: personName(pid) }; }
  else if (r.role === 'bot' && meta?.kind === 'relay') from = { type: 'bot-to-bot', bot: meta.bot ?? null, name: meta.name ?? botName(meta.bot), to: meta.to ?? null, toName: meta.to != null ? botName(meta.to) : null };
  else if (r.role === 'bot') from = { type: 'bot', bot: meta?.bot ?? null, name: meta?.name ?? botName(meta?.bot) };
  else if (r.role === 'orb') from = { type: 'orbe' };
  else from = { type: 'system' };
  return { id: r.id, text: plain(r.body), at: r.at, from, kind: lineKind(r, meta) };
}
export const lastLine = (board, conversation) => (conversation == null ? null : board.one("SELECT id, role, body, meta, at, person_id FROM chat WHERE conversation_id = ? AND role != 'notice' ORDER BY id DESC LIMIT 1", Number(conversation)) ?? null);

// ---- search: lower case and without accents («cafe» finds «Café»)
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function snippet(text, q, max = 120) {
  const s = plain(text, 4000); const i = fold(s).indexOf(fold(q));
  if (i < 0 || s.length <= max) return s.slice(0, max);
  const start = Math.max(0, i - Math.floor((max - q.length) / 2));
  return `${start > 0 ? '…' : ''}${s.slice(start, start + max).trim()}${start + max < s.length ? '…' : ''}`;
}
