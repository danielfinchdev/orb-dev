// Chat tabs and the split view, as plain data (no DOM): the window draws them (components/chat-tabs.jsx), the tests run
// this alone. A tab is a chat key: 'chat:12' (a conversation with Orbe), 'session:abc' (a direct chat with an agent) or
// 'chat:new' (a new chat that has no conversation yet).
// state = { tabs: [key], active: key|null, split: boolean, right: key|null, focus: 'left'|'right', ratio: 30..70 }
// The left pane shows `active`; with the split on, the right pane shows `right` (never the same chat as the left one).
export const MAX_TABS = 8;
export const MIN_RATIO = 30;
export const MAX_RATIO = 70;

export const emptyTabs = () => ({ tabs: [], active: null, split: false, right: null, focus: 'left', ratio: 50 });

const KEY = /^(chat:(\d{1,12}|new)|session:[\w-]{1,90})$/;
const isTabKey = (k) => typeof k === 'string' && KEY.test(k);

// The tab a route stands for, or null when the route is not a chat.
export function keyOfRoute(route) {
  if (route?.view === 'chat') return route.id == null || route.id === '' ? 'chat:new' : isTabKey(`chat:${route.id}`) ? `chat:${route.id}` : null;
  if (route?.view === 'session' && route.id != null) return isTabKey(`session:${route.id}`) ? `session:${route.id}` : null;
  return null;
}
export function routeOfKey(key) {
  if (!isTabKey(key)) return null;
  if (key === 'chat:new') return { view: 'chat' };
  const [view, id] = key.split(':');
  return { view, id: view === 'chat' ? Number(id) : id };
}

// A saved state made safe: unknown or repeated keys go, `exists(key)` drops chats that are gone ('chat:new' always stays out
// of a saved state: a new chat that was never written is not kept), and every link between the fields is put right.
export function sanitize(raw, { exists = () => true } = {}) {
  const base = emptyTabs();
  if (!raw || typeof raw !== 'object') return base;
  const tabs = [...new Set(Array.isArray(raw.tabs) ? raw.tabs : [])].filter((k) => isTabKey(k) && k !== 'chat:new' && exists(k)).slice(0, MAX_TABS);
  const active = tabs.includes(raw.active) ? raw.active : tabs[0] ?? null;
  const ratio = Number.isFinite(Number(raw.ratio)) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, Math.round(Number(raw.ratio)))) : 50;
  let right = tabs.includes(raw.right) && raw.right !== active ? raw.right : null;
  let split = Boolean(raw.split) && tabs.length >= 2;
  if (split && !right) right = tabs.find((k) => k !== active) ?? null;
  if (!right) split = false;
  return { tabs, active, split, right: split ? right : null, focus: split && raw.focus === 'right' ? 'right' : 'left', ratio };
}

// at the limit the oldest tab that nobody is looking at makes room
function room(s) {
  if (s.tabs.length < MAX_TABS) return s.tabs;
  const out = s.tabs.find((k) => k !== s.active && k !== s.right);
  return s.tabs.filter((k) => k !== out);
}

// The pane that has the focus shows `key`; the other pane never shows the same chat (the two swap instead).
export function activate(state, key) {
  if (!isTabKey(key) || !state.tabs.includes(key)) return state;
  if (!state.split) return { ...state, active: key, focus: 'left' };
  if (state.focus === 'right') {
    return key === state.active ? { ...state, active: state.right, right: key } : { ...state, right: key };
  }
  return key === state.right ? { ...state, active: key, right: state.active } : { ...state, active: key };
}

// Opens a chat. mode 'replace' (a chat picked in the list): an open chat is just shown; else it takes the place of the chat
// in the pane that has the focus (a new chat that was never written is dropped rather than left empty). mode 'new' (Ctrl+click,
// «Nueva pestaña»): it gets a tab of its own.
export function openTab(state, key, { mode = 'replace' } = {}) {
  if (!isTabKey(key)) return state;
  if (state.tabs.includes(key)) return activate(state, key);
  const shown = state.split && state.focus === 'right' ? state.right : state.active;
  if (mode === 'replace' && shown && state.tabs.length) {
    const tabs = state.tabs.map((k) => (k === shown ? key : k));
    return state.split && state.focus === 'right' ? { ...state, tabs, right: key } : { ...state, tabs, active: key };
  }
  const tabs = [...room(state), key];
  const s = { ...state, tabs };
  return activate({ ...s, focus: state.split ? state.focus : 'left' }, key);
}

export function closeTab(state, key) {
  const at = state.tabs.indexOf(key);
  if (at < 0) return state;
  const tabs = state.tabs.filter((k) => k !== key);
  const near = tabs[Math.min(at, tabs.length - 1)] ?? null;
  let { active, right } = state;
  if (key === active) { active = (state.split && right ? right : near); if (active === right) right = tabs.find((k) => k !== active) ?? null; }
  else if (key === right) right = tabs.find((k) => k !== active) ?? null;
  const split = state.split && tabs.length >= 2 && Boolean(right);
  return { ...state, tabs, active, split, right: split ? right : null, focus: split ? state.focus : 'left' };
}

export function toggleSplit(state) {
  if (state.split) return { ...state, split: false, right: null, focus: 'left' };
  if (state.tabs.length < 2) return state;
  const at = state.tabs.indexOf(state.active);
  const right = state.tabs[(at + 1) % state.tabs.length];
  return { ...state, split: true, right: right === state.active ? null : right, focus: 'right' };
}
export const focusOther = (state) => (state.split ? { ...state, focus: state.focus === 'right' ? 'left' : 'right' } : state);
export const setRatio = (state, ratio) => ({ ...state, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, Math.round(Number(ratio) || 50))) });

// The next or previous tab (dir 1 / -1), wrapping around, in the pane that has the focus.
export function cycle(state, dir = 1) {
  if (state.tabs.length < 2) return state;
  const shown = state.split && state.focus === 'right' ? state.right : state.active;
  const at = Math.max(0, state.tabs.indexOf(shown));
  let next = state.tabs[(at + (dir < 0 ? -1 : 1) + state.tabs.length) % state.tabs.length];
  return activate(state, next);
}
export function moveTab(state, key, to) {
  const from = state.tabs.indexOf(key);
  if (from < 0 || !Number.isInteger(to)) return state;
  const tabs = [...state.tabs]; tabs.splice(from, 1); tabs.splice(Math.min(Math.max(0, to), tabs.length), 0, key);
  return { ...state, tabs };
}

// The chats each pane shows.
export const panes = (state) => ({ left: state.active, right: state.split ? state.right : null });
// What goes to localStorage: a chat that was never written ('chat:new') stays out.
export const toSave = (state) => sanitize(state);
