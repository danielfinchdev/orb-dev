// 3.6 (messaging, step M2): the pure pieces of the Bots zone's chat list and conversation (no React, no store): the list
// split into the pinned row, the user's sections and «Sin asignar»; the short time of a row; the day separators; the
// preview of the last message; a bot's name colour in a group; the «@» of the composer. The data comes from inbox.list
// (src/engine/api-inbox.mjs); an Orb that cannot answer it (an older server) gets the same shape from bots.list
// (fallbackInbox). Tested in test/mensajeria-ui.test.mjs.
import { COLORS, avatarOf } from '../../core/avatar.mjs';

// The list as the screen draws it: pinned only in the top row (in their order), never repeated below; the rest in their
// section (in the sections' order) or in «Sin asignar». A section with no chats still shows (it can be filled).
export function splitInbox(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const known = new Set(sections.map((s) => s.id));
  const pinned = items.filter((x) => x.pinned).sort((a, b) => (a.pinOrder ?? 1e9) - (b.pinOrder ?? 1e9));
  const rest = items.filter((x) => !x.pinned).sort(byRecent);
  return {
    pinned,
    sections: sections.map((s) => { const list = rest.filter((x) => x.section === s.id); return { ...s, items: list, unread: list.reduce((n, x) => n + (x.muted ? 0 : x.unread || 0), 0) }; }),
    loose: rest.filter((x) => x.section == null || !known.has(x.section))
  };
}
const byRecent = (a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')) || (b.id ?? 0) - (a.id ?? 0);

// What is unread in the zone (muted chats do not count), for the badges of the tab and of the zone switch.
export const unreadOf = (data) => (Array.isArray(data?.items) ? data.items.reduce((n, x) => n + (x.muted ? 0 : Number(x.unread) || 0), 0) : 0);

// The chat list from bots.list, when inbox.list is not there: no pins, sections or unread counts.
export function fallbackInbox(bots = [], groups = [], states = {}) {
  const items = [
    ...bots.map((b) => ({ key: `bot:${b.id}`, kind: 'bot', id: b.id, title: b.name, chief: Boolean(b.is_chief), state: b.paused ? 'paused' : states[b.id]?.busy ? 'working' : 'idle', pinned: false, section: null, muted: false, unread: 0, lastMessage: null, at: b.updated_at ?? null })),
    ...groups.map((g) => ({ key: `group:${g.id}`, kind: 'group', id: g.id, title: g.name, members: (g.members ?? []).map((m) => Number(m?.id ?? m)), state: 'idle', pinned: false, section: null, muted: false, unread: 0, lastMessage: null, at: g.updated_at ?? null }))
  ];
  return { zone: 'bots', items, sections: [], unread: 0, fallback: true };
}

// The time of a row: the hour today, «Ayer», the weekday within a week, else the day and month.
export function shortTime(at, { now = new Date(), locale = 'es', yesterday = 'Ayer' } = {}) {
  const d = new Date(at ?? ''); if (Number.isNaN(d.getTime())) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return yesterday;
  if (diff < 7) { const w = d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', ''); return w.charAt(0).toUpperCase() + w.slice(1); }
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace('.', '');
}

// The day of a line (local), and its separator: «Hoy», «Ayer» or the date.
export function dayKey(at) { const d = new Date(at ?? ''); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
export function dayLabel(at, { now = new Date(), locale = 'es', today = 'Hoy', yesterday = 'Ayer' } = {}) {
  const d = new Date(at ?? ''); if (Number.isNaN(d.getTime())) return '';
  if (dayKey(d) === dayKey(now)) return today;
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return yesterday;
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
// The lines with a separator before the first of each day: [{ day, label } | { line }].
export function withDays(lines, opts) {
  const out = []; let last = null;
  for (const line of Array.isArray(lines) ? lines : []) {
    const k = dayKey(line.at);
    if (k && k !== last) { out.push({ day: k, label: dayLabel(line.at, opts) }); last = k; }
    out.push({ line });
  }
  return out;
}

// The preview of a row: who wrote (you, a bot of a group, a bot to another bot) and the text, one line.
// t: the translator (keys inbox.you, inbox.relayTo, inbox.card, inbox.question, inbox.reminder, inbox.noMessages,
// inbox.paused, inbox.working).
export function previewOf(item, t, { me = null } = {}) {
  const m = item?.lastMessage;
  if (item?.state === 'working') return { text: t('chats.working'), tone: 'live' };
  if (!m) return { text: item?.state === 'paused' ? t('chats.paused') : t('chats.noMessages'), tone: 'muted' };
  const text = String(m.text ?? '').replace(/\s+/g, ' ').trim();
  const kind = m.kind === 'card' ? t('chats.card') : m.kind === 'question' ? t('chats.question') : m.kind === 'reminder' ? t('chats.reminder') : null;
  const body = kind ? `${kind} · ${text}` : text;
  const from = m.from ?? {};
  if (from.type === 'bot-to-bot') return { relay: true, prefix: t('chats.relayTo', { to: from.toName ?? t('bots.aBot') }), text: body };
  if (from.type === 'user') return { prefix: me != null && from.person != null && from.person !== me ? `${from.name}: ` : t('chats.you'), text: body };
  if (from.type === 'bot' && item.kind === 'group' && from.name) return { prefix: `${from.name}: `, text: body };
  return { text: body };
}

// A bot's name colour in a group chat: its avatar's hue, readable on the bubble (lighter in dark mode).
export function nameColor(bot, dark = false) {
  const hue = COLORS[avatarOf(bot).color] ?? 238;
  return dark ? `oklch(0.78 0.12 ${hue})` : `oklch(0.5 0.14 ${hue})`;
}

// «@» in the composer of a group: the word being typed right before the caret (null when none), the members that fit it
// (without accents or case) and the text with the chosen one put in its place.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function mentionQuery(value, caret = String(value ?? '').length) {
  const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(String(value ?? '').slice(0, caret));
  return m ? m[2] : null;
}
export function mentionMatches(members, query, max = 8) {
  if (query == null) return [];
  const q = fold(query);
  return (members ?? []).filter((b) => fold(b.name).includes(q)).sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q))).slice(0, max);
}
// A name with spaces is written as the engine reads it (the whole name after @, see src/core/bots.mjs); the caret goes
// after it and a space.
export function insertMention(value, caret, name) {
  const s = String(value ?? '');
  const before = s.slice(0, caret).replace(/@[\p{L}\p{N}_-]*$/u, `@${name} `);
  return { text: before + s.slice(caret), caret: before.length };
}
