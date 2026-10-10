// App state shared by every view: what the engine knows (assistant, projects, tasks, conversations) plus the current
// route. A tiny external store read with useSyncExternalStore; engine events trigger a debounced refresh.
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { errorText } from './utils.js';
import { t } from './i18n.js';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES } from '../../core/appearance.mjs';

// The bridge to the PC: Electron's preload, or the phone's web bridge (src/ui/lib/web-bridge.js). Read when used, not when
// this module loads: the bundler may load this module before the phone's bridge has defined window.orb.
export const bridge = new Proxy({}, { get: (_, key) => window.orb?.[key], has: (_, key) => Boolean(window.orb) && key in window.orb });
export const call = (method, params) => bridge.call(method, params);

let state = { version: 0, ready: false, info: null, app: null, sessions: [], projects: [], tasks: [], route: { view: 'chat' }, settings: null };
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };
export const getState = () => state;
export function setState(patch) { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; emit(); }
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function useStore(select = (s) => s) { return select(useSyncExternalStore(subscribe, getState)); }

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
  const [app, sessions, projects, tasks] = await Promise.all([call('app.state'), call('sessions.list'), call('projects.list'), call('tasks.list', { limit: 200 })]);
  setState((s) => ({ app, sessions, projects, tasks, ready: true, version: s.version + 1 })); // version: views refetch their own data when it moves
  let phoneTheme = null; if (bridge.mobile) { try { phoneTheme = localStorage.getItem('orb.theme'); } catch { /* none */ } }
  applyTheme(phoneTheme || app.config.ui?.theme);
  applyAppearance(app.config.ui);
  document.title = app.config.assistantName;
  document.documentElement.lang = app.config.language === 'en' ? 'en' : 'es';
}

let timer = null;
export function refreshSoon() { clearTimeout(timer); timer = setTimeout(() => refresh().catch(() => {}), 120); }

// Runs an engine action with a toast on error (and on success when okText is given). Returns undefined on error.
export async function act(promise, okText) {
  try { const r = await promise; if (okText) toast.success(okText); return r; }
  catch (error) { toast.error(errorText(error)); return undefined; }
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
  root.skin = pick(ui.skin, SKINS);
  root.font = pick(ui.font, FONTS);
  root.codeFont = pick(ui.codeFont, CODE_FONTS);
  root.codeTheme = pick(ui.codeTheme, CODE_THEMES);
  root.motion = ui.motion === 'minima' ? 'minima' : 'completa'; // the themes' moving backdrops stop with it
}
