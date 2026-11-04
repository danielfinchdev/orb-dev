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

// ---- 3.6 (messaging, step M3): the Orb zone ------------------------------------------------------------------------
// The rows of the Orb zone: each conversation with Orbe (conversations.list, with its marks, last line and unread count
// from inbox.list when there) and each direct conversation with an agent (sessions of kind «chat»: no marks, they are
// not in inbox.list). Each row carries its own tasks (newest first) for its progress line.
const OPEN_TASK = ['queued', 'running', 'awaiting_approval', 'limited'];
export function orbItems({ inbox = null, conversations = [], sessions = [], tasks = [], chats = [], approvals = [], completed = [], skip = null } = {}) {
  const marks = new Map((Array.isArray(inbox?.items) ? inbox.items : []).map((x) => [x.key, x]));
  const byConv = new Map();
  for (const tk of Array.isArray(tasks) ? tasks : []) {
    if (tk?.conversation_id == null) continue;
    if (!byConv.has(tk.conversation_id)) byConv.set(tk.conversation_id, []);
    byConv.get(tk.conversation_id).push(tk);
  }
  for (const list of byConv.values()) list.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')) || b.id - a.id);
  const live = new Set((chats ?? []).filter((c) => c.busy || c.waiting).map((c) => c.conversation));
  const done = new Set(completed ?? []);
  const out = [];
  for (const c of Array.isArray(conversations) ? conversations : []) {
    const m = marks.get(`conversation:${c.id}`) ?? {};
    const own = byConv.get(c.id) ?? [];
    out.push({
      key: `conversation:${c.id}`, kind: 'conversation', id: c.id, title: c.title, project: c.project ?? null, agent: c.agent ?? null, model: c.model ?? null,
      pinned: Boolean(m.pinned), pinOrder: m.pinOrder ?? null, muted: Boolean(m.muted), unread: Number(m.unread) || 0, lastMessage: m.lastMessage ?? null,
      at: [m.lastMessage?.at, c.updated_at, own[0]?.updated_at].filter(Boolean).sort().pop() ?? null,
      done: c.status === 'done', busy: Boolean(c.busy || c.waiting || live.has(c.id) || m.state === 'working'), asking: Boolean(c.asking),
      tasks: own, open: own.filter((x) => OPEN_TASK.includes(x.status)).length
    });
  }
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (s?.kind !== 'chat' || (skip != null && s.id === skip)) continue;
    const asks = (approvals ?? []).some((a) => a.session_id === s.id);
    const stalled = ['interrupted', 'limited', 'error'].includes(s.status);
    out.push({ key: `session:${s.id}`, kind: 'session', id: s.id, title: s.title, project: s.project ?? null, agent: s.agent ?? null, model: s.model ?? null,
      pinned: false, pinOrder: null, muted: false, unread: 0, lastMessage: null, at: s.updated_at ?? null,
      done: Boolean(s.settled) || done.has(`s${s.id}`), busy: s.status === 'running', asks, stalled: stalled && !asks, tasks: [], open: 0 });
  }
  return out;
}

// What a row of the Orb zone says under its title: what waits for the user first, then what is running, then how its
// last task ended (when that is newer than its last line), else its last line. tone: warn | live | done | error | muted.
const FINISHED = { done: ['orbchats.done', 'done'], failed: ['orbchats.failed', 'error'], blocked: ['orbchats.failed', 'error'], cancelled: ['orbchats.cancelled', 'muted'], limited: ['orbchats.limited', 'warn'] };
export function orbProgress(item, t, { assistant = 'Orbe' } = {}) {
  const tasks = item?.tasks ?? [];
  if (tasks.some((x) => x.status === 'awaiting_approval')) return { text: t('orbchats.awaiting'), tone: 'warn', badge: true };
  if (item?.asks) return { text: t('orbchats.permission'), tone: 'warn', badge: true };
  if (item?.asking) return { text: t('orbchats.asking'), tone: 'warn', badge: true };
  const run = tasks.find((x) => x.status === 'running');
  if (run) return { text: t('orbchats.running', { id: run.id, title: run.title }), tone: 'live' };
  if (item?.busy) return { text: t('chats.working'), tone: 'live' };
  const queued = tasks.filter((x) => x.status === 'queued').length;
  if (queued) return { text: queued === 1 ? t('orbchats.queuedOne') : t('orbchats.queued', { n: queued }), tone: 'muted' };
  if (item?.stalled) return { text: t('orbchats.stalled'), tone: 'warn' };
  const m = item?.lastMessage;
  const last = tasks[0];
  if (last && FINISHED[last.status] && (!m?.at || String(last.updated_at ?? '') >= String(m.at))) { const [key, tone] = FINISHED[last.status]; return { text: t(key, { title: last.title }), tone }; }
  if (m) {
    const text = String(m.text ?? '').replace(/\s+/g, ' ').trim();
    if (m.from?.type === 'user') return { prefix: t('chats.you'), text, tone: 'muted' };
    if (m.from?.type === 'orbe') return { prefix: `${assistant}: `, text, tone: 'muted' };
    return { text, tone: 'muted' };
  }
  if (item?.kind === 'session') return { text: t('orbchats.direct', { agent: item.agentName ?? item.agent ?? '' }), tone: 'muted' };
  return { text: t('chats.noMessages'), tone: 'muted' };
}

// What a row waits for from the user (a task to approve, a permission, a question).
export const orbNeedsYou = (item) => Boolean(item?.asks || item?.asking || (item?.tasks ?? []).some((x) => x.status === 'awaiting_approval'));

// The list as the screen draws it: the pinned chats on top (in their order, never repeated below), then one group per
// project (the most recent first; «Sin proyecto» last). Completed chats are left out unless showDone; each group says
// how many it left out. filter: { state: all | active | attention | done, agent: all | <id> }.
export function groupOrb(items, { showDone = false, filter = { state: 'all', agent: 'all' } } = {}) {
  const st = filter?.state ?? 'all'; const ag = filter?.agent ?? 'all';
  const fits = (x) => (ag === 'all' || x.agent === ag)
    && (st === 'all' ? (showDone || !x.done) : st === 'active' ? x.busy && !x.done : st === 'attention' ? orbNeedsYou(x) && !x.done : x.done);
  const recent = (a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')) || (b.id ?? 0) - (a.id ?? 0);
  const list = Array.isArray(items) ? items : [];
  const pinned = list.filter((x) => x.pinned && fits(x)).sort((a, b) => (a.pinOrder ?? 1e9) - (b.pinOrder ?? 1e9));
  const by = new Map();
  for (const x of list.filter((y) => !y.pinned).sort(recent)) {
    const k = x.project ?? '';
    if (!by.has(k)) by.set(k, { project: x.project ?? null, at: x.at, items: [], hidden: 0, unread: 0, working: 0, waiting: 0 });
    const g = by.get(k);
    if (!fits(x)) { if (x.done && st === 'all' && !showDone && (ag === 'all' || x.agent === ag)) g.hidden++; continue; }
    g.items.push(x);
    if (!x.muted) g.unread += x.unread || 0;
    if (x.busy) g.working++;
    if (orbNeedsYou(x)) g.waiting++;
  }
  const groups = [...by.values()].filter((g) => g.items.length || g.hidden)
    .sort((a, b) => Number(a.project == null) - Number(b.project == null) || String(b.items[0]?.at ?? b.at ?? '').localeCompare(String(a.items[0]?.at ?? a.at ?? '')));
  return { pinned, groups, hidden: groups.reduce((n, g) => n + g.hidden, 0) };
}
