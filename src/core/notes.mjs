// 3.6 (messaging, M4): a notification as in a messaging app. Orbe's picture, the chat's name as the title, the text as the
// person chose for the lock screen (Mi perfil › preview), one notification per chat (new lines join it) and its actions:
// «Responder», and «Aprobar» / «Rechazar» on an agent's permission request. Pure: the engine (src/engine/remote.mjs)
// gives it the chat and the line, per person; the phone's browser (service worker) and the Android app
// (src/ui/lib/app-bridge.js) show what comes out.
//
// note = { key, id, route, title, body, hidden, kind, icon, largeIcon, actions: [{ id, title, input?, open? }], card?,
//          silent }
// card: { method: 'sessions.approve', id, request } | { method: 'tasks.approve', task }
// actions: reply (input: the text goes to the chat), allow, deny, and open: true when the action must open the app (a
// task whose exact version is approved there, a hidden request, the app lock).

export const PREVIEWS = ['all', 'chat', 'none'];
// The Android app's ids for the chats' notifications (one per chat, so new lines replace it).
export const NOTE_IDS = { first: 20_000, size: 10_000 };
const fnv = (text) => { let h = 2166136261; for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const noteId = (key) => NOTE_IDS.first + (fnv(key) % NOTE_IDS.size);

// chat = { kind: 'conversation' | 'orb', id, name }
export const chatKey = (chat) => (chat.kind === 'orb' ? 'orb' : `${chat.kind}:${chat.id}`);
export const routeOf = (chat) => (chat.kind === 'conversation' ? { view: 'chat', id: Number(chat.id) } : { view: 'chat' });

// What a chat line is for a notification: message, approval (an agent's permission request) or task (a task that waits
// for approval).
export function lineKind(line) {
  const m = line?.meta ?? {};
  if ((m.kind === 'approval' || m.kind === 'task-approval') && m.session && m.request) return (m.status ?? 'pending') === 'pending' ? 'approval' : null;
  if (m.kind === 'attention' && m.task) return 'task';
  return 'message';
}

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// One person's notification of one line, or null (a muted chat; a line that needs none).
// input: { chat, line: { id, role, body, meta }, preview, muted, hasPin, assistantName, words }
// words: { hidden, reply, allow, deny, open } (the texts, in the Orb's language).
export function buildNote({ chat, line, preview = 'chat', muted = false, hasPin = false, assistantName = 'Orb', words = {} }) {
  if (!chat || !line) return null;
  const kind = lineKind(line);
  if (!kind) return null;
  if (muted) return null; // a muted chat says nothing
  const w = { hidden: 'Tienes un mensaje nuevo', reply: 'Responder', allow: 'Aprobar', deny: 'Rechazar', open: 'Abrir', ...words };
  const v = PREVIEWS.includes(preview) ? preview : 'chat';
  // 'all' and 'chat' (the default): the text; 'none': nothing, not even which chat.
  const shown = v !== 'none';
  const key = chatKey(chat);
  const note = {
    key, id: noteId(key), route: routeOf(chat), kind,
    title: cut(shown ? chat.name || assistantName : assistantName, 80),
    body: shown ? cut(line.body ?? '', 200) : w.hidden,
    hidden: !shown,
    icon: '/icon.png',
    actions: [],
    silent: false
  };
  if (line.id != null) note.line = Number(line.id);
  // The actions: a permission request is answered right there (unless its text is hidden: then «Aprobar» opens the app);
  // a message gets «Responder».
  // 3.6 (M4): the app lock (the person's PIN, and the fingerprint with it) is never skipped: with it, every action opens
  // the app (lock first, then the chat).
  const locked = Boolean(hasPin);
  if (locked) note.locked = true;
  if (kind === 'approval') {
    note.card = { method: 'sessions.approve', id: String(line.meta.session), request: String(line.meta.request) };
    const needsApp = locked || !shown;
    note.actions = [{ id: 'deny', title: w.deny }, { id: 'allow', title: w.allow }].map((a) => (needsApp ? { ...a, open: true } : a));
  } else if (kind === 'task') {
    // Approving a task signs its exact version (what, where, why): always in the app, with its confirmation.
    note.card = { method: 'tasks.approve', task: Number(line.meta.task) };
    note.actions = [{ id: 'allow', title: w.allow, open: true }];
  } else if (kind === 'message') {
    // Locked: «Responder» opens the app (no text typed on the notification).
    note.actions = [locked ? { id: 'reply', title: w.reply, open: true } : { id: 'reply', title: w.reply, input: true }];
  }
  return note;
}

// New lines of the same chat join one notification: the last few lines, newest last, and how many there are.
export function collapse(previous, note, { max = 5 } = {}) {
  const lines = [...(Array.isArray(previous?.lines) ? previous.lines : []), note.body].slice(-max);
  const count = Number(previous?.count ?? 0) + 1;
  return { ...note, lines, count, body: note.hidden ? note.body : lines.join('\n') };
}

// What to do when an action of a notification is chosen: { call: [method, params] } to run it right there, { open: route,
// approve? } to open the chat (and the PIN or the task's approval there), or { reply: … } to send the text typed.
export function actionRoute(note, actionId, { text = null } = {}) {
  const open = { open: note.route };
  if (actionId === 'reply') {
    if (note.locked || note.actions?.find((x) => x.id === 'reply')?.open) return open;
    const body = String(text ?? '').trim();
    if (!body) return open;
    const r = note.route;
    if (r.view === 'chat') return { call: ['chat.send', { text: body, ...(r.id != null ? { conversation: r.id } : {}) }] };
    return open;
  }
  if ((actionId === 'allow' || actionId === 'deny') && note.card) {
    const a = note.actions.find((x) => x.id === actionId);
    if (!a || a.open) return { ...open, approve: actionId === 'allow' ? note.card : null };
    const decision = actionId;
    if (note.card.method === 'sessions.approve') return { call: ['sessions.approve', { id: note.card.id, request: note.card.request, decision }] };
  }
  return open;
}
