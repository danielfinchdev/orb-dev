// 3.6 (messaging, step M3): the pure pieces of the chat list (no React, no store): the unread count, the short time of a
// row, the rows themselves (conversations with Orbe and direct ones with an agent), their progress line and their
// grouping. The data comes from inbox.list (src/engine/api-inbox.mjs). Tested in test/mensajeria-orb.test.mjs.

// What is unread (muted chats do not count), for the badges.
export const unreadOf = (data) => (Array.isArray(data?.items) ? data.items.reduce((n, x) => n + (x.muted ? 0 : Number(x.unread) || 0), 0) : 0);

// One formatter per language and shape: toLocale…String builds a new one on every call, and the list has hundreds of rows.
const FORMATS = { time: { hour: '2-digit', minute: '2-digit' }, weekday: { weekday: 'short' }, date: { day: 'numeric', month: 'short' } };
const formatters = new Map();
const format = (locale, shape, d) => {
  const k = `${locale}|${shape}`;
  if (!formatters.has(k)) formatters.set(k, new Intl.DateTimeFormat(locale, FORMATS[shape]));
  return formatters.get(k).format(d);
};

// The time of a row: the hour today, «Ayer», the weekday within a week, else the day and month.
export function shortTime(at, { now = new Date(), locale = 'es', yesterday = 'Ayer' } = {}) {
  const d = new Date(at ?? ''); if (Number.isNaN(d.getTime())) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return format(locale, 'time', d);
  if (diff === 1) return yesterday;
  if (diff < 7) { const w = format(locale, 'weekday', d).replace('.', ''); return w.charAt(0).toUpperCase() + w.slice(1); }
  return format(locale, 'date', d).replace('.', '');
}

// The rows: each conversation with Orbe (conversations.list, with its marks, last line and unread count
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
    const m = marks.get(`session:${s.id}`) ?? {};
    out.push({ key: `session:${s.id}`, kind: 'session', id: s.id, title: s.title, project: s.project ?? null, agent: s.agent ?? null, model: s.model ?? null,
      pinned: Boolean(m.pinned), pinOrder: m.pinOrder ?? null, muted: Boolean(m.muted), unread: 0, lastMessage: null, at: s.updated_at ?? null,
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
