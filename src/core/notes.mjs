// 3.6 (messaging, M4): a notification as in a messaging app. Who writes (the bot's avatar, Orbe's picture for the Orb
// zone, the members together for a group), the chat's name as the title, the text as the person chose for the lock screen
// (Mi perfil › preview), one notification per chat (new lines join it) and its actions: «Responder», and «Aprobar» /
// «Rechazar» on a card. Pure: the engine (src/engine/remote.mjs) gives it the chat and the line, per person; the phone's
// browser (service worker) and the Android app (src/ui/lib/app-bridge.js) show what comes out.
//
// note = { key, id, route, title, body, hidden, kind, icon, largeIcon, actions: [{ id, title, input?, open? }], card?,
//          silent }
// card: { method: 'bots.decide', item } | { method: 'sessions.approve', id, request } | { method: 'tasks.approve', task }
// actions: reply (input: the text goes to the chat), allow, deny, and open: true when the action must open the app (a
// card that needs the PIN, a task whose exact version is approved there, a hidden card).

export const PREVIEWS = ['all', 'chat', 'none'];
// The Android app's ids for the chats' notifications (one per chat, so new lines replace it), apart from the reminders'.
export const NOTE_IDS = { first: 20_000, size: 10_000 };
const fnv = (text) => { let h = 2166136261; for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const noteId = (key) => NOTE_IDS.first + (fnv(key) % NOTE_IDS.size);

// chat = { kind: 'bot' | 'group' | 'conversation' | 'orb', id, name, avatar?, members?: [avatar] }
export const chatKey = (chat) => (chat.kind === 'orb' ? 'orb' : `${chat.kind}:${chat.id}`);
export function routeOf(chat) {
  if (chat.kind === 'bot') return { view: 'bot-chat', id: String(chat.id) };
  if (chat.kind === 'group') return { view: 'bot-group', id: String(chat.id) };
  if (chat.kind === 'conversation') return { view: 'chat', id: Number(chat.id) };
  return { view: 'chat' };
}
const zoneOf = (chat) => (chat.kind === 'bot' || chat.kind === 'group' ? 'bots' : 'orb');

// What a chat line is for a notification: message, card (a bot's, waiting), question, reminder, approval (an agent's
// permission request) or task (a task that waits for approval).
export function lineKind(line) {
  const m = line?.meta ?? {};
  if (m.kind === 'bot_card') return (m.status ?? 'pending') === 'pending' ? 'card' : null;
  if (m.kind === 'bot_question') return 'question';
  if (m.kind === 'reminder') return 'reminder';
  if ((m.kind === 'approval' || m.kind === 'task-approval') && m.session && m.request) return (m.status ?? 'pending') === 'pending' ? 'approval' : null;
  if (m.kind === 'attention' && m.task) return 'task';
  return 'message';
}

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// One person's notification of one line, or null (a muted chat; a line that needs none).
// input: { chat, line: { id, role, body, meta }, preview, muted, hasPin, sensitive, assistantName, words }
// words: { hidden, reply, allow, deny, open } (the texts, in the Orb's language).
export function buildNote({ chat, line, preview = 'chat', muted = false, hasPin = false, sensitive = false, assistantName = 'Orb', words = {} }) {
  if (!chat || !line) return null;
  const kind = lineKind(line);
  if (!kind) return null;
  // A muted chat says nothing (only the reminders the person set themselves still ring).
  if (muted && kind !== 'reminder') return null;
  const w = { hidden: 'Tienes un mensaje nuevo', reply: 'Responder', allow: 'Aprobar', deny: 'Rechazar', open: 'Abrir', ...words };
  const zone = zoneOf(chat);
  const v = PREVIEWS.includes(preview) ? preview : 'chat';
  // 'all': everything; 'chat' (the default): the Orb zone's text, the bots' hidden; 'none': nothing, not even who.
  const shown = v === 'all' || (v === 'chat' && zone === 'orb');
  const anonymous = v === 'none';
  const key = chatKey(chat);
  const name = cut(chat.name || assistantName, 80);
  // In a group, each line says which bot speaks.
  const speaker = chat.kind === 'group' && line.meta?.name && line.role === 'bot' ? `${line.meta.name}: ` : '';
  const text = cut(`${speaker}${line.body ?? ''}`, 200);
  const icon = anonymous ? '/icon.png' : chat.kind === 'bot' ? { avatar: chat.avatar } : chat.kind === 'group' ? { members: chat.members ?? [] } : '/icon.png';
  const note = {
    key, id: noteId(key), route: routeOf(chat), kind, zone,
    title: anonymous ? cut(assistantName, 80) : name,
    body: shown ? text : w.hidden,
    hidden: !shown,
    icon,
    actions: [],
    silent: false
  };
  if (line.id != null) note.line = Number(line.id);
  // The actions: a card is answered right there (unless it needs the PIN or its text is hidden: then «Aprobar» opens the
  // app); a message or a question gets «Responder»; a reminder, none.
  // 3.6 (M4): the app lock (the person's PIN, and the fingerprint with it) is never skipped: with it, every action opens
  // the app (lock first, then the chat); without it, a card is answered there only when it is not sensitive and its text
  // shows.
  const locked = Boolean(hasPin);
  if (locked) note.locked = true;
  if (kind === 'card') {
    note.card = { method: 'bots.decide', item: Number(line.id) };
    note.sensitive = Boolean(sensitive);
    const needsApp = locked || !shown || sensitive;
    note.actions = [{ id: 'deny', title: w.deny }, { id: 'allow', title: w.allow }].map((a) => (needsApp ? { ...a, open: true } : a));
    if (sensitive && hasPin) note.pin = true;
  } else if (kind === 'approval') {
    note.card = { method: 'sessions.approve', id: String(line.meta.session), request: String(line.meta.request) };
    const needsApp = locked || !shown;
    note.actions = [{ id: 'deny', title: w.deny }, { id: 'allow', title: w.allow }].map((a) => (needsApp ? { ...a, open: true } : a));
  } else if (kind === 'task') {
    // Approving a task signs its exact version (what, where, why): always in the app, with its confirmation.
    note.card = { method: 'tasks.approve', task: Number(line.meta.task) };
    note.actions = [{ id: 'allow', title: w.allow, open: true }];
  } else if (kind === 'message' || kind === 'question') {
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
    if (!body || note.kind === 'reminder') return open;
    const r = note.route;
    if (r.view === 'bot-chat') return { call: ['bots.send', { id: r.id, text: body }] };
    if (r.view === 'bot-group') return { call: ['bots.groups.send', { id: r.id, text: body }] };
    if (r.view === 'chat') return { call: ['chat.send', { text: body, ...(r.id != null ? { conversation: r.id } : {}) }] };
    return open;
  }
  if ((actionId === 'allow' || actionId === 'deny') && note.card) {
    const a = note.actions.find((x) => x.id === actionId);
    if (!a || a.open) return { ...open, approve: actionId === 'allow' ? note.card : null };
    const decision = actionId;
    if (note.card.method === 'bots.decide') return { call: ['bots.decide', { item: note.card.item, decision }] };
    if (note.card.method === 'sessions.approve') return { call: ['sessions.approve', { id: note.card.id, request: note.card.request, decision }] };
  }
  return open;
}
