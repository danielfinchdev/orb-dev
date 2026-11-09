// App state shared by every view: what the engine knows (assistant, projects, tasks, conversations) plus the current
// route. A tiny external store read with useSyncExternalStore; engine events trigger a debounced refresh.
import { useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { errorText } from './utils.js';
import { bumpNav, navTicket, stillHere } from './nav.js';
import { cleanRoute, backStep } from './phone-nav.js';
import { t } from './i18n.js';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES, baseSkin, plainSkin } from '../../core/appearance.mjs';
export { plainSkin }; // 3.8.2: Profesional and the themes built on it (Cristal): no robot, no backdrop, no motion
import { applyFeed, sinceOf } from '../../core/feed.mjs';

// The bridge to the PC: the desktop app's (src/ui/lib/tauri-bridge.js), or the phone's web bridge (src/ui/lib/web-bridge.js). Read when used, not when
// this module loads: the bundler may load this module before the phone's bridge has defined window.orb.
export const bridge = new Proxy({}, { get: (_, key) => window.orb?.[key], has: (_, key) => Boolean(window.orb) && key in window.orb });
export const call = (method, params) => bridge.call(method, params);
// 2.7.3: the whole PC app, not the phone: mini-games, God mode, PC Status and the themes live only here.
export const fullPc = () => !bridge.mobile;
// 3.5: a computer's browser linked with an Orb: the PC's layout, with what
// a linked device may do. Decided once, when the page opens (a phone, or the Android app, keeps the phone's layout).
let wide = null;
export const wideBrowser = () => (wide ??= Boolean(bridge.mobile) && !window.__orbHost && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && window.innerWidth >= 1024);
export const phoneLayout = () => Boolean(bridge.mobile) && !wideBrowser();

// 3.0: «Iniciar test» shows on the first opening of the day (on the PC), until the user writes to the assistant.
function firstOpenToday() {
  if (bridge.mobile) return false;
  const day = new Date().toLocaleDateString('sv');
  try { if (localStorage.getItem('orb.testDay') === day) return false; localStorage.setItem('orb.testDay', day); return true; } catch { return false; }
}
let state = { version: 0, ready: false, info: null, app: null, sessions: [], projects: [], tasks: [], conversations: [], route: { view: 'chat' }, settings: null, testToday: null };
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };
export const getState = () => state;
export function setState(patch) { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; emit(); }
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// 3.0: a component draws again only when what it selects changes (before, every change of the store redrew every
// component). A selector that builds a new object or array each time is compared one level deep, so it stays stable.
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a); if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
};
const whole = (s) => s;
export function useStore(select = whole) {
  const last = useRef(null);
  const snapshot = () => {
    const prev = last.current;
    if (prev && prev.state === state && prev.select === select) return prev.value;
    const value = select(state);
    last.current = { state, select, value: prev && same(prev.value, value) ? prev.value : value };
    return last.current.value;
  };
  return useSyncExternalStore(subscribe, snapshot);
}

// Ajustes is a window over the current view: open on a section (general, apariencia, contribuye…) or close it.
// settingsAt: each open (also of the same part again) scrolls that part into view (SettingsDialog).
export function openSettings(section = 'general') { setState({ settings: section, settingsAt: Date.now() }); }
// 2.6: the mini-games window (while the agents work).
export function openGames() { setState({ games: true }); }
// 2.6: the sidebar folded away (remembered on this PC). Its button is next to day / night; folded, the top bar shows one
// to bring it back.
export function setSidebarCollapsed(collapsed) {
  setState({ sidebarCollapsed: collapsed });
  try { localStorage.setItem('orb.sidebar', collapsed ? 'plegada' : 'abierta'); } catch { /* this session only */ }
}
try { if (localStorage.getItem('orb.sidebar') === 'plegada') state = { ...state, sidebarCollapsed: true }; } catch { /* storage unavailable */ }
export function closeSettings() { setState({ settings: null }); }
// 2.6: the guided tour (components/tour.jsx): the robot walks through the app, on the first launch after the setup and
// from Tutoriales. Ajustes closes so the tour can point at the screens; done or skipped, ui.tourDone is saved in the
// assistant folder's settings so it never comes back on its own.
export function startTour() { closeSettings(); setState({ tour: { key: Date.now() } }); }
export function endTour() {
  setState({ tour: null });
  if (getState().app?.config?.ui?.tourDone !== true) call('config.save', { patch: { ui: { tourDone: true } } }).catch(() => {});
}

// 3.8: the screens this build has (main.jsx says it once): a route of a screen that is gone (a bot's of 3.7, from an old
// notification or link) opens the chats instead of a blank screen (lib/phone-nav.js).
let views = null;
export const setViews = (names) => { views = names; };
export function go(route) {
  let next = cleanRoute(route, { views, phone: phoneLayout() }) ?? { view: phoneLayout() ? 'chats' : 'chat' };
  if (next.view === 'settings') { openSettings(next.section); return; }
  // 3.8 (F5b): a task opened from a chat remembers it, so that «back» on the phone returns there (phone-nav.js › backStep).
  const here = state.route;
  if (next.view === 'tasks' && next.id != null && !next.from && (here?.view === 'chat' || here?.view === 'session')) next = { ...next, from: { view: here.view, ...(here.id != null ? { id: here.id } : {}) } };
  bumpNav(); // even to the same screen («Nuevo chat» while on a new chat): the user chose where to be
  setState({ route: next });
  const keep = KEEPS_ID.has(next.view) ? next : { view: next.view };
  try { localStorage.setItem('orb.route', JSON.stringify(keep)); } catch { /* storage unavailable */ }
}

// The screens that keep their id in the saved route (the last conversation or session).
const KEEPS_ID = new Set(['session', 'chat']);
// 3.8: Android's back (or a phone browser's): one level up (lib/phone-nav.js › backStep). → the step taken, or what the
// caller must do ({ close }: what is open over the screen; { exit }: the first screen).
export function goBack({ overlay = false } = {}) {
  const step = backStep({ route: state.route, overlay, phone: phoneLayout() });
  if (step?.go) go(step.go);
  return step;
}
// 3.8: a screen that failed to draw: the saved route goes (the app must never reopen on it) and the home screen shows.
export function resetRoute() {
  try { localStorage.removeItem('orb.route'); } catch { /* storage unavailable */ }
  bumpNav();
  setState({ route: { view: phoneLayout() ? 'chats' : 'chat' } });
}

// 3.6 (messaging, M3): the chat list (inbox.list zone «orb»: pins, mutes, unread and the last line of each
// conversation with Orbe). Always this Orb's (the conversations live here, never on a linked server). An Orb without
// inbox.list leaves it empty: the list is then made from the conversations alone (lib/inbox.js › orbItems).
let orbTimer = null;
export const loadOrbInbox = oneAtATime(async () => {
  try {
    const out = await feedCall('inbox.list', { zone: 'orb' }, (x) => x.key);
    const now = getState().orbInbox;
    // an engine of before 3.8.1: the whole object; nothing moved: the same object (nothing draws again)
    const orbInbox = out.plain !== undefined ? out.plain : out.list && (out.changed || !now || now.fallback) ? { ...out.meta, items: out.list } : now;
    if (orbInbox !== now) setState({ orbInbox });
    return orbInbox;
  }
  catch { feeds['inbox.list'] = null; setState({ orbInbox: { zone: 'orb', items: [], sections: [], unread: 0, fallback: true } }); return null; }
});
export function loadOrbInboxSoon(ms = 200) { clearTimeout(orbTimer); orbTimer = setTimeout(() => { loadOrbInbox(); }, ms); }
export async function orbAct(method, params, okText) { const r = await act(call(method, params), okText); loadOrbInboxSoon(0); return r; }
// The info pane of the Orb zone (views/orb/info.jsx): { type: 'chat' } (the conversation on screen) or { type: 'project',
// name }; null: closed.
export const openOrbInfo = (info) => setState({ orbInfo: info });
export const closeOrbInfo = () => setState({ orbInfo: null });

// 3.8.1 (H4c): the lists of every refresh come as changes since what this window holds (src/core/feed.mjs): only the
// rows that moved travel (also to the phone, over its encrypted link), and a list where nothing moved keeps the same
// array, so the screens that read it draw nothing again. One call of each at a time (oneAtATime): a late answer to an
// older request never undoes a newer one. An engine of before 3.8.1 answers whole (applyFeed takes it as it comes).
const feeds = {};
async function feedCall(method, params, key, again = false) {
  const res = await call(method, { ...params, since: sinceOf(feeds[method]) });
  const out = applyFeed(feeds[method], res, key);
  feeds[method] = out.state;
  if (out.again && !again) return feedCall(method, params, key, true); // could not be applied: the whole list
  return out;
}
const listOf = async (method, params = {}, key = undefined) => (await feedCall(method, params, key)).list;
// fn runs once at a time; asked while it runs, it runs once more after it (and every caller waits for that one).
function oneAtATime(fn) {
  let running = null; let queued = null;
  const run = () => {
    if (!running) { running = fn().finally(() => { running = null; }); return running; }
    queued ??= running.catch(() => {}).then(() => { queued = null; return run(); });
    return queued;
  };
  return run;
}

const REFRESHED = ['sessions.list', 'projects.list', 'tasks.list', 'conversations.list'];
export const refresh = oneAtATime(async () => {
  let app, sessions, projects, tasks, conversations;
  try { [app, sessions, projects, tasks, conversations] = await Promise.all([call('app.state'), listOf('sessions.list'), listOf('projects.list', {}, (p) => p.name), listOf('tasks.list', { limit: 200 }), listOf('conversations.list')]); }
  catch (error) { for (const m of REFRESHED) feeds[m] = null; throw error; } // what did arrive is not shown: the next refresh asks for it whole
  // version: views refetch their own data when it moves. A list missing (an answer that came too late) stays as it was.
  setState((s) => ({ app, sessions: sessions ?? s.sessions, projects: projects ?? s.projects, tasks: tasks ?? s.tasks, conversations: conversations ?? s.conversations, ready: true, version: s.version + 1 }));
  const { projects: all } = getState();
  // 3.2: the projects' icons, again only when the list of projects changes (or one is set by hand: loadProjectIcons).
  const names = all.map((p) => p.name).join('|');
  if (names !== iconsFor) loadProjectIcons(names);
  let phoneTheme = null; if (bridge.mobile) { try { phoneTheme = localStorage.getItem('orb.theme'); } catch { /* none */ } }
  applyTheme(phoneTheme || app.config.ui?.theme);
  applyAppearance(app.config.ui);
  document.title = app.config.assistantName;
  document.documentElement.lang = uiLanguage(getState()) === 'en' ? 'en' : 'es';
});
// The app's language (Ajustes › General).
export const uiLanguage = (s) => s.app?.config?.language || 'es';

let iconsFor = null;
export function loadProjectIcons(names = iconsFor) {
  iconsFor = names;
  return call('projects.icons').then((projectIcons) => setState({ projectIcons })).catch(() => {});
}

let timer = null; let missed = false; let firstAsk = 0;
// 3.0: while the window is not visible (minimised, another tab on the phone) nothing is fetched; one refresh when it
// shows again. The notifications of the PC come from the main process, not from here. 3.8.1 (H4c): the engine's events
// in a row make one refresh 120 ms after the last one, and never more than 1 s after the first one (a steady stream of
// events no longer puts it off for ever).
export function refreshSoon() {
  if (document.hidden) { missed = true; return; }
  const now = Date.now();
  if (!timer) firstAsk = now;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; refresh().catch(() => {}); }, Math.max(0, Math.min(120, firstAsk + 1000 - now)));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && missed) { missed = false; refreshSoon(); } });

// Runs an engine action with a toast on error (and on success when okText is given). Returns undefined on error.
export async function act(promise, okText) {
  try { const r = await promise; if (okText) toast.success(okText); return r; }
  catch (error) { toast.error(errorText(error)); return undefined; }
}

// 3.2: «Nuevo chat»: the screen of a new conversation (it is made with its first message), in that project when one is
// given (it becomes the working folder) or in the current one.
export async function newChat(project) {
  if (project !== undefined && (project ?? '') !== (state.app?.activeProject?.name ?? '')) await act(call('projects.setActive', { name: project ?? '' }));
  go({ view: 'chat' });
}
// 3.2: what a conversation with the assistant is doing now (answering, its streamed text, its steps), from app.chats.
export const chatOf = (app, id) => (id == null ? null : (app?.chats ?? []).find((c) => c.conversation === Number(id)) ?? null);
export const anyChatBusy = (app) => (app?.chats ?? []).some((c) => c.busy);

// Whether «Iniciar test» is offered in the chat (decided once per opening of the app, the first time the chat shows).
export function initTestOfTheDay() { if (state.testToday === null) setState({ testToday: firstOpenToday() }); }
export const dismissTest = () => { if (state.testToday) setState({ testToday: false }); };
// «Iniciar test»: a new conversation with «Orquestador» on and the test request (t('test.prompt')), to check that the
// whole chain works: the assistant plans, the agents build a web page and it is opened to try it.
export { navTicket, stillHere };
export async function runTest(prompt) {
  dismissTest();
  const ticket = navTicket();
  const ok = await act((async () => {
    // Cursor cannot coordinate the agents: the test runs with Claude as the brain.
    await call('chat.settings', state.app?.assistant?.agent === 'cursor' ? { agent: 'claude', model: '', orchestrate: true } : { orchestrate: true });
    // 3.2.1: a project of its own (prueba-orb-<date>, never one of the user's) and «decide tú»: the test ran into three
    // questions (which project, the whiteboard, the plan) before any task started.
    const day = new Date().toLocaleDateString('sv').replace(/-/g, '');
    const taken = new Set((state.projects ?? []).map((p) => String(p.name).toLowerCase()));
    let name = `prueba-orb-${day}`; for (let i = 2; taken.has(name.toLowerCase()); i++) name = `prueba-orb-${day}-${i}`;
    const project = await call('projects.create', { name, category: 'web', notes: t('test.projectNotes') });
    return call('chat.send', { text: t('test.wrap', { prompt, project: project.name }), project: project.name });
  })());
  if (!ok) return;
  await refresh().catch(() => {});
  if (stillHere(ticket)) go({ view: 'chat', id: ok.conversation });
}

// Ctrl+J: a terminal in the folder of what is on screen (a conversation's project, the active project) or the assistant's.
export function terminalFolder() {
  const { route, sessions, projects, app } = state;
  const session = route.view === 'session' ? sessions.find((s) => s.id === route.id) : null;
  const named = (name) => projects.find((p) => p.name === name)?.path;
  return session?.cwd ?? (route.project && named(route.project)) ?? app?.activeProject?.path ?? app?.home ?? null;
}
export async function openTerminal(folder = terminalFolder()) {
  if (!bridge.openTerminal) return;
  try { const name = await bridge.openTerminal(folder); toast.success(t('app.terminalOpened', { name })); }
  catch (error) { toast.error(errorText(error)); }
}

// Theme: "sistema" follows Windows, "claro" / "oscuro" force it.
const media = window.matchMedia('(prefers-color-scheme: dark)');
let theme = 'sistema';
export function applyTheme(next = theme) {
  theme = next || 'sistema';
  const dark = theme === 'oscuro' || (theme === 'sistema' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}
media.addEventListener('change', () => applyTheme());
export const isDark = () => document.documentElement.classList.contains('dark');

// Ajustes → Apariencia: visual theme, fonts and colours of code, as data attributes of <html> that the CSS reads
// (data-skin, data-font, data-code-font, data-code-theme). Unknown or missing values fall back to the defaults.
export function applyAppearance(ui = {}) {
  const pick = (value, list) => (list.includes(value) ? value : list[0]);
  const root = document.documentElement.dataset;
  const skin = fullPc() ? pick(ui.skin, SKINS) : SKINS[0]; // 2.7: the phone always wears the default theme
  // 3.8.2: a theme built on another (cristal on profesional) wears its base's data-skin plus its own data-material.
  root.skin = baseSkin(skin);
  if (skin !== root.skin) root.material = skin; else delete root.material;
  root.font = pick(ui.font, FONTS);
  root.codeFont = pick(ui.codeFont, CODE_FONTS);
  root.codeTheme = pick(ui.codeTheme, CODE_THEMES);
  root.motion = ui.motion === 'minima' ? 'minima' : 'completa'; // the themes' moving backdrops stop with it
}
