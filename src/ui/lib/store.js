// App state shared by every view: what the engine knows (assistant, projects, tasks, conversations) plus the current
// route. A tiny external store read with useSyncExternalStore; engine events trigger a debounced refresh.
import { useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { errorText } from './utils.js';
import { t } from './i18n.js';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES } from '../../core/appearance.mjs';

// The bridge to the PC: Electron's preload, or the phone's web bridge (src/ui/lib/web-bridge.js). Read when used, not when
// this module loads: the bundler may load this module before the phone's bridge has defined window.orb.
export const bridge = new Proxy({}, { get: (_, key) => window.orb?.[key], has: (_, key) => Boolean(window.orb) && key in window.orb });
export const call = (method, params) => bridge.call(method, params);
// 2.7.3: the whole PC app (the installer), not the phone nor Orb Light (the portable .exe): mini-games, God mode, PC Status
// and the themes live only here.
export const fullPc = () => !bridge.mobile && !bridge.light;

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
export function openSettings(section = 'general') { setState({ settings: section }); }
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

export function go(route) {
  const next = typeof route === 'string' ? { view: route } : route;
  if (next.view === 'settings') { openSettings(next.section); return; }
  setState({ route: next });
  try { localStorage.setItem('orb.route', JSON.stringify(next.view === 'session' || next.view === 'chat' ? next : { view: next.view })); } catch { /* storage unavailable */ }
}

export async function refresh() {
  const [app, sessions, projects, tasks, conversations] = await Promise.all([call('app.state'), call('sessions.list'), call('projects.list'), call('tasks.list', { limit: 200 }), call('conversations.list')]);
  setState((s) => ({ app, sessions, projects, tasks, conversations, ready: true, version: s.version + 1 })); // version: views refetch their own data when it moves
  // 3.2: the projects' icons, again only when the list of projects changes (or one is set by hand: loadProjectIcons).
  const names = projects.map((p) => p.name).join('|');
  if (names !== iconsFor) loadProjectIcons(names);
  let phoneTheme = null; if (bridge.mobile) { try { phoneTheme = localStorage.getItem('orb.theme'); } catch { /* none */ } }
  applyTheme(phoneTheme || app.config.ui?.theme);
  applyAppearance(app.config.ui);
  document.title = app.config.assistantName;
  document.documentElement.lang = app.config.language === 'en' ? 'en' : 'es';
}

let iconsFor = null;
export function loadProjectIcons(names = iconsFor) {
  iconsFor = names;
  return call('projects.icons').then((projectIcons) => setState({ projectIcons })).catch(() => {});
}

let timer = null; let missed = false;
// 3.0: while the window is not visible (minimised, another tab on the phone) nothing is fetched; one refresh when it
// shows again. The notifications of the PC come from the main process, not from here.
export function refreshSoon() {
  if (document.hidden) { missed = true; return; }
  clearTimeout(timer); timer = setTimeout(() => refresh().catch(() => {}), 120);
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
export async function runTest(prompt) {
  dismissTest();
  const ok = await act((async () => {
    // Cursor cannot coordinate the agents: the test runs with Claude as the brain.
    await call('chat.settings', state.app?.assistant?.agent === 'cursor' ? { agent: 'claude', model: '', orchestrate: true } : { orchestrate: true });
    return call('chat.send', { text: prompt, project: null });
  })());
  if (!ok) return;
  await refresh().catch(() => {});
  go({ view: 'chat', id: ok.conversation });
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
  root.skin = fullPc() ? pick(ui.skin, SKINS) : SKINS[0]; // 2.7: the phone (and Orb Light) always wears the default theme
  root.font = pick(ui.font, FONTS);
  root.codeFont = pick(ui.codeFont, CODE_FONTS);
  root.codeTheme = pick(ui.codeTheme, CODE_THEMES);
  root.motion = ui.motion === 'minima' ? 'minima' : 'completa'; // the themes' moving backdrops stop with it
}
