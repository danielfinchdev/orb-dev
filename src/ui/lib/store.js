// App state shared by every view: what the engine knows (assistant, projects, tasks, conversations) plus the current
// route. A tiny external store read with useSyncExternalStore; engine events trigger a debounced refresh.
import { useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { errorText } from './utils.js';
import { bumpNav, navTicket, stillHere } from './nav.js';
import { t } from './i18n.js';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES } from '../../core/appearance.mjs';
import { modeOf, botsPrefix } from './bots.js';
import { fallbackInbox } from './inbox.js';

// The bridge to the PC: Electron's preload, or the phone's web bridge (src/ui/lib/web-bridge.js). Read when used, not when
// this module loads: the bundler may load this module before the phone's bridge has defined window.orb.
export const bridge = new Proxy({}, { get: (_, key) => window.orb?.[key], has: (_, key) => Boolean(window.orb) && key in window.orb });
export const call = (method, params) => bridge.call(method, params);
// 2.7.3: the whole PC app (the installer), not the phone nor Orb Light (the portable .exe): mini-games, God mode, PC Status
// and the themes live only here.
export const fullPc = () => !bridge.mobile && !bridge.light;
// 3.5: a computer's browser linked with an Orb (above all the server's, which has no window): the PC's layout, with what
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
  bumpNav(); // even to the same screen («Nuevo chat» while on a new chat): the user chose where to be
  setState({ route: next });
  const keep = KEEPS_ID.has(next.view) ? next : { view: next.view, ...(next.mode === 'bots' ? { mode: 'bots' } : {}) };
  try { localStorage.setItem('orb.route', JSON.stringify(keep)); } catch { /* storage unavailable */ }
  rememberMode(keep);
}

// 3.5: the two modes, «Orb» (the app as always) and «Bots». Each one remembers its last screen (on this device) and the
// mode in use is kept in the settings of the assistant's folder (ui.mode), so the PC opens in the same one.
const KEEPS_ID = new Set(['session', 'chat', 'bot-chat', 'bot-group', 'bots']);
const MODES_KEY = 'orb.modos';
const lastOf = () => { try { return JSON.parse(localStorage.getItem(MODES_KEY) || '{}') ?? {}; } catch { return {}; } };
function rememberMode(route) { try { localStorage.setItem(MODES_KEY, JSON.stringify({ ...lastOf(), [modeOf(route)]: route })); } catch { /* storage unavailable */ } }
// 3.6 (M2): the phone opens the Bots zone on its chat list («bot-chats»); the PC on the last chat (its list is beside).
// 3.6 (M3): the same for the Orb zone: the phone on its chat list («chats»), the PC on the last conversation.
export const modeHome = (mode) => lastOf()[mode] ?? (mode === 'bots' ? { view: phoneLayout() ? 'bot-chats' : 'bot-chat' } : { view: phoneLayout() ? 'chats' : 'chat' });
export function setMode(mode) {
  const next = mode === 'bots' ? 'bots' : 'orb';
  if (modeOf(state.route) !== next) go(modeHome(next));
  if (!bridge.mobile && state.app?.config?.ui?.mode !== next) call('config.save', { patch: { ui: { mode: next } } }).then((config) => setState((s) => ({ app: s.app ? { ...s.app, config } : s.app }))).catch(() => {});
}
export { modeOf };

// 3.5: the bots (bots.list), shared by the menu and the screens of the Bots mode; read again when a bot changes
// (bot.updated) and when the screens move on (version). What each bot is doing now comes live (bot.state).
// Where the bots live is the user's choice (Ajustes › Magic Link › «¿Dónde quieres tus bots?», bots.location): in this
// Orb, or in a linked Orb that keeps bots (centro.<method>, live as centro:bot.*). A phone talks to the bots of the Orb it
// is linked with.
export const botsVia = () => botsPrefix(getState().centro);
export const botCall = (method, params) => call(`${botsVia()}${method}`, params);
// A live event of the bots in use (bot.message, bot.state, bot.updated), wherever they live.
export function onBotEvent(name, fn) {
  const offLocal = bridge.on(name, (p) => { if (!botsVia()) fn(p); });
  const offCentro = bridge.on(`centro:${name}`, (p) => { if (botsVia()) fn(p); });
  return () => { offLocal(); offCentro(); };
}
export async function loadCentro() {
  if (bridge.mobile) return null;
  const before = getState().centro;
  let centro; try { centro = await call('centro.status'); } catch { centro = { linked: false }; }
  setState({ centro });
  if (botsPrefix(before) !== botsPrefix(centro) || before?.id !== centro.id) { setState({ bots: null, inbox: null }); loadBots(); loadInbox(); }
  return centro;
}
let botsTimer = null;
export async function loadBots() {
  try { const bots = await botCall('bots.list'); setState((s) => ({ bots, botsError: null, botStates: Object.fromEntries((bots.states ?? []).map((x) => [x.bot, x])) })); return bots; }
  catch (error) { setState({ botsError: errorText(error) }); return null; }
}
export function loadBotsSoon() { clearTimeout(botsTimer); botsTimer = setTimeout(() => { loadBots(); }, 150); }
// 3.6 (messaging, M2): the Bots zone's chat list (inbox.list: pins, sections, unread, last message), read again when it
// changes (inbox:changed, a bot's line or state). An Orb that does not answer inbox.list gets the same shape from
// bots.list (no pins, sections or unread). The changes (pin, mute, sections…) go through inboxAct.
let inboxTimer = null;
export async function loadInbox() {
  try { const inbox = await botCall('inbox.list', { zone: 'bots' }); setState({ inbox }); return inbox; }
  catch {
    const b = getState().bots ?? await loadBots();
    const inbox = fallbackInbox(b?.bots ?? [], b?.groups ?? [], getState().botStates ?? {});
    setState({ inbox }); return inbox;
  }
}
export function loadInboxSoon(ms = 200) { clearTimeout(inboxTimer); inboxTimer = setTimeout(() => { loadInbox(); }, ms); }
export async function inboxAct(method, params, okText) { const r = await act(botCall(method, params), okText); loadInboxSoon(0); return r; }
// 3.6 (messaging, M3): the Orb zone's chat list (inbox.list zone «orb»: pins, mutes, unread and the last line of each
// conversation with Orbe). Always this Orb's (the conversations live here, never on a linked server). An Orb without
// inbox.list leaves it empty: the list is then made from the conversations alone (lib/inbox.js › orbItems).
let orbTimer = null;
export async function loadOrbInbox() {
  try { const orbInbox = await call('inbox.list', { zone: 'orb' }); setState({ orbInbox }); return orbInbox; }
  catch { setState({ orbInbox: { zone: 'orb', items: [], sections: [], unread: 0, fallback: true } }); return null; }
}
export function loadOrbInboxSoon(ms = 200) { clearTimeout(orbTimer); orbTimer = setTimeout(() => { loadOrbInbox(); }, ms); }
export async function orbAct(method, params, okText) { const r = await act(call(method, params), okText); loadOrbInboxSoon(0); return r; }
// The info pane of the Orb zone (views/orb/info.jsx): { type: 'chat' } (the conversation on screen) or { type: 'project',
// name }; null: closed.
export const openOrbInfo = (info) => setState({ orbInfo: info });
export const closeOrbInfo = () => setState({ orbInfo: null });
export function botStateChanged(p) {
  if (p?.bot == null) return;
  setState((s) => ({ botStates: { ...(s.botStates ?? {}), [p.bot]: p } }));
}

// 3.6 «Personas»: who is using this window or device (persons.me: { person, role, rights, personsCount }). An Orb before
// 3.6 has no persons.me: then it is one person, the owner (nothing of people shows). The server decides what each one
// sees; this only picks what to draw. What was shared with the caller (shares.list) comes along when there are several.
export async function loadMe() {
  let me = null; try { me = await call('persons.me'); } catch { me = null; }
  let shared = null; let people = [];
  if (Number(me?.personsCount ?? 1) > 1) {
    [shared, people] = await Promise.all([call('shares.list').catch(() => null), call('persons.list').catch(() => [])]);
  }
  setState({ me, shared, people });
  return me;
}
// A person's name by id (the names everyone may see: persons.list).
export const personNameOf = (id) => (state.people ?? []).find((p) => p.id === id)?.name ?? '';
export async function refresh() {
  // 3.6: this PC's window locked (persons.lock): the engine answers only the lock's minimal app.state.
  const first = bridge.mobile ? null : await call('app.state');
  if (first?.locked === true && !first.config) { setState({ locked: first, ready: true }); return; }
  const [app, sessions, projects, tasks, conversations] = await Promise.all([first ?? call('app.state'), call('sessions.list'), call('projects.list'), call('tasks.list', { limit: 200 }), call('conversations.list'), loadMe()]);
  setState((s) => ({ app, sessions, projects, tasks, conversations, ready: true, version: s.version + 1 })); // version: views refetch their own data when it moves
  // 3.2: the projects' icons, again only when the list of projects changes (or one is set by hand: loadProjectIcons).
  const names = projects.map((p) => p.name).join('|');
  if (names !== iconsFor) loadProjectIcons(names);
  let phoneTheme = null; if (bridge.mobile) { try { phoneTheme = localStorage.getItem('orb.theme'); } catch { /* none */ } }
  applyTheme(phoneTheme || app.config.ui?.theme);
  applyAppearance(app.config.ui);
  document.title = app.config.assistantName;
  document.documentElement.lang = uiLanguage(getState()) === 'en' ? 'en' : 'es';
}
// 3.6: the language of the person at the window (Mi perfil), else the Orb's.
export const uiLanguage = (s) => (Number(s.me?.personsCount ?? 1) > 1 && s.me?.person?.language) || s.app?.config?.language || 'es';
// 3.6: someone else sat down (persons.switch / persons.unlock): everything is read again as them; what was on screen
// (a conversation, a bot) may not be theirs, so the window goes back to the start of its mode.
export async function personSwitched() {
  setState({ route: { view: 'chat' }, bots: null, botStates: {}, inbox: null, orbInbox: null, orbInfo: null, settings: null, share: null });
  try { localStorage.removeItem('orb.route'); localStorage.removeItem(MODES_KEY); } catch { /* storage unavailable */ }
  await refresh().catch(() => {});
  if (getState().app?.config) setState({ locked: false });
  loadBots(); loadInbox(); loadOrbInbox();
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
  root.skin = fullPc() ? pick(ui.skin, SKINS) : SKINS[0]; // 2.7: the phone (and Orb Light) always wears the default theme
  root.font = pick(ui.font, FONTS);
  root.codeFont = pick(ui.codeFont, CODE_FONTS);
  root.codeTheme = pick(ui.codeTheme, CODE_THEMES);
  root.motion = ui.motion === 'minima' ? 'minima' : 'completa'; // the themes' moving backdrops stop with it
}
