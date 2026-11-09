// Entry of the window: first-run setup or the app (sidebar + current view), live refresh from the engine's events.
import './lib/tauri-bridge.js'; // first of all: in the desktop app it provides window.orb
import './lib/app-bridge.js'; // then: in the Android app it tells the web bridge where the linked Orb is
import './lib/web-bridge.js'; // last: in a phone's browser (or the app) it provides window.orb
import './app.css';
// 3.6: the Android app's «glass» look, only in the Android build (the other builds drop this line and its CSS).
if (import.meta.env.MODE === 'android') (await import('./lib/glass.js')).enableGlass();
import { StrictMode, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { notify } from '@/lib/notify.js';
import { Menu, Smartphone, ScanLine, Link2, RotateCw, FolderOpen, Download, KeyRound, ArrowLeft, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Field, Input, Textarea, Spinner } from '@/components/ui/basic.jsx';
import { MobileTabs, MoreView } from '@/components/mobile-tabs.jsx';
import { TooltipProvider, Checkbox } from '@/components/ui/overlay.jsx';
import { DialogHost, confirm, form } from '@/components/dialogs.jsx';
import { ImagePreviewHost } from '@/components/image-viewer.jsx';
import { Sidebar } from '@/components/sidebar.jsx';
import { Companion } from '@/components/companion.jsx';
import { UpdateCard, useUpdate, updateActions } from '@/components/update-card.jsx';
import { migrationView } from '@/lib/migration.js';
import { Notices } from '@/components/notices.jsx';
import { ActionShortcuts } from '@/components/project-tools.jsx';
import { CommandPalette } from '@/components/command-palette.jsx';
import { Scene } from '@/components/scene.jsx';
import { Robot } from '@/components/robot.jsx';
import { useStore, setState, getState, refresh, refreshSoon, call, bridge, act, go, goBack, resetRoute, setViews, applyTheme, openTerminal, startTour, closeSettings, anyChatBusy, chatStateSoon, flushChatStates, phoneLayout, loadOrbInbox, loadOrbInboxSoon } from '@/lib/store.js';
import { restoreRoute, keyboardOpen } from '@/lib/phone-nav.js';
import { listenPoints } from '@/lib/browser-points.js';
import { startupPhase } from '@/lib/startup.js';
import { watchIdle, lockMinutesOf } from '@/lib/idle-lock.js';
import { startMusic, pauseAll } from '@/lib/music.js';
import { dropUnlock } from '@/lib/core-access.js';
import { isReloadKey, reloadOrb } from '@/lib/reload.js';
import { isOffline, retryLoop } from '@/lib/net.js';
import { ago } from '@/lib/utils.js';
import { ErrorBoundary } from '@/components/error-boundary.jsx';
import { lazyScreen } from '@/lib/lazy.js';
import { AGENT } from '@/lib/labels.js';
import { WindowControls } from '@/components/window-controls.jsx';
import { useT, t as tNow } from '@/lib/i18n.js';
import { MasterCreate, MasterLocked } from '@/views/master.jsx';
import { ChatView } from '@/views/chat.jsx';
import { SessionView } from '@/views/session.jsx';
import { OrbChatsView } from '@/views/orb/inbox.jsx';
import { OrbInfoHost } from '@/views/orb/info.jsx';
import { UpdateNeeded } from '@/components/update-needed.jsx';
import { NoteOpener } from '@/lib/notes.js';
import { RecoveryNotice } from '@/views/data.jsx';

// 3.8.1 (H4a): the screens other than the chats load the first time they open, so the app starts with less to read; once
// it is up, they load in the background while the window is idle (opening one later is instant; on a phone's browser
// they come from the PC over the network). A load that fails can be tried again (lib/lazy.js, ErrorBoundary).
const later = [];
const deferred = (load, name) => { const Screen = lazyScreen(load, name); later.push(Screen.preload); return Screen; };
const loadSettings = () => import('@/views/settings.jsx');
const TasksView = deferred(() => import('@/views/tasks.jsx'), 'TasksView');
const ProjectsView = deferred(() => import('@/views/projects.jsx'), 'ProjectsView');
const AgentsView = deferred(() => import('@/views/agents.jsx'), 'AgentsView');
const MemoriesView = deferred(() => import('@/views/memories.jsx'), 'MemoriesView');
const SchedulesView = deferred(() => import('@/views/schedules.jsx'), 'SchedulesView');
const UsageView = deferred(() => import('@/views/usage.jsx'), 'UsageView');
const ExpertView = deferred(() => import('@/views/expert.jsx'), 'ExpertView');
const TutorialsView = deferred(() => import('@/views/tutorials.jsx'), 'TutorialsView');
const WhiteboardView = deferred(() => import('@/views/whiteboard.jsx'), 'WhiteboardView');
const PhoneView = deferred(loadSettings, 'PhoneView');
const SettingsDialog = deferred(loadSettings, 'SettingsDialog');
const GamesDialog = deferred(() => import('@/games/games.jsx'), 'GamesDialog');
const Tour = deferred(() => import('@/components/tour.jsx'), 'Tour');
// The start's own screens: only on a first run, a missing core or folders to review.
const Setup = lazy(() => import('@/views/setup.jsx').then((m) => ({ default: m.Setup })));
const CoreMissing = lazy(() => import('@/views/core-missing.jsx').then((m) => ({ default: m.CoreMissing })));
const LayoutReview = lazy(() => import('@/views/layout.jsx').then((m) => ({ default: m.LayoutReview })));
function loadTheRest() {
  const run = () => { for (const preload of later) preload(); };
  if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 1500);
}
// A screen still loading (only seen when its file is slow to come, as over a phone's network): a spinner that shows
// after a moment, so a quick load never flashes.
const Loading = () => <div className="screen-loading grid min-h-0 flex-1 place-items-center" data-testid="screen-loading"><Spinner className="size-5" /></div>;
// A window over the screen that failed (Ajustes, the games, the tour): it closes and says why; opening it again retries.
const windowFailed = (close) => ({ offline }) => { close(); notify({ body: tNow(offline ? 'app.loadOfflineToast' : 'app.crashTitle'), tone: 'error' }); };
const closeSettingsFailed = windowFailed(closeSettings);
const closeGamesFailed = windowFailed(() => setState({ games: false }));
const closeTourFailed = windowFailed(() => setState({ tour: null }));
// Settings and the games are windows over the screen: drawn once first asked for, then kept (they close with their animation).
function OnceOpened({ when, onFail, children }) {
  const opened = useRef(false);
  if (when) opened.current = true;
  return opened.current ? <ErrorBoundary onFail={onFail} resetKey={when}><Suspense fallback={null}>{children}</Suspense></ErrorBoundary> : null;
}

const COMPANION_VIEWS = new Set(['tasks', 'projects', 'logs', 'activity']);
// 2.7, the phone: the conversations («Chats») and «Más» are screens of their own; Agentes and Modo experto are PC only.
// 3.6 (M3): «Chats» is the Orb zone's chat list (views/orb/inbox.jsx); the PC has it in the sidebar.
const ChatsView = OrbChatsView;
// 3.8: a route of a screen that is gone (a bot's, saved before or in an old notification) falls back to the chat.
const VIEWS = bridge.mobile
  ? { chat: ChatView, session: SessionView, tasks: TasksView, projects: ProjectsView, logs: MemoriesView, activity: MemoriesView, schedules: SchedulesView, usage: UsageView, phone: PhoneView, tutorials: TutorialsView, chats: ChatsView, more: MoreView, board: WhiteboardView }
  : { chat: ChatView, session: SessionView, tasks: TasksView, projects: ProjectsView, agents: AgentsView, logs: MemoriesView, activity: MemoriesView, schedules: SchedulesView, usage: UsageView, phone: PhoneView, tutorials: TutorialsView, board: WhiteboardView, expert: ExpertView };
setViews(Object.keys(VIEWS));
const routeKey = (route) => `${route.view}:${route.id ?? ''}:${route.project ?? ''}`;

// 3.8: the floating tab bar hides while the on-screen keyboard is up (it rose over the keyboard): a text field has the
// focus and the window lost height (lib/phone-nav.js › keyboardOpen).
const EDITABLE = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"]), textarea, [contenteditable="true"]';
function useKeyboard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let full = window.innerHeight;
    const check = () => {
      const editing = Boolean(document.activeElement?.matches?.(EDITABLE));
      if (!editing) full = Math.max(full, window.innerHeight);
      setOpen(keyboardOpen({ editing, height: window.visualViewport?.height ?? window.innerHeight, fullHeight: full }));
    };
    const later = () => setTimeout(check, 60); // focusout: wait for the next field to take the focus
    window.addEventListener('focusin', check); window.addEventListener('focusout', later);
    window.addEventListener('resize', check); window.visualViewport?.addEventListener('resize', check);
    return () => { window.removeEventListener('focusin', check); window.removeEventListener('focusout', later); window.removeEventListener('resize', check); window.visualViewport?.removeEventListener('resize', check); };
  }, []);
  return open;
}

// 3.8: the link with the PC dropped while the app is open (web-bridge.js: link:offline / link:online): a thin line at
// the top of the screen, in the flow (it never covers the status bar or the header), and a refresh when it is back.
function useLinkDown() {
  const [down, setDown] = useState(false);
  useEffect(() => bridge.on('*', (event) => {
    if (event === 'link:offline') setDown(true);
    if (event === 'link:online') { setDown(false); refreshSoon(); }
  }), []);
  return down;
}

// The phone's frame: the screen (each with its own header) and the tabs at the bottom.
function MobileShell() {
  const t = useT();
  const route = useStore((s) => s.route);
  const View = VIEWS[route.view] ?? ChatView;
  const keyboard = useKeyboard();
  const down = useLinkDown();
  // 3.6 (M3): a conversation (with Orbe, new or not, or directly with an agent) takes the whole screen (with its back
  // arrow); the tabs are on the list.
  const fullChat = route.view === 'chat' || route.view === 'session';
  return (
    <div className="mobile-shell flex h-full flex-col">
      {down ? <div className="bg-warning text-warning-foreground flex shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-[12.5px] font-medium" role="status" data-testid="link-down"><WifiOff className="size-3.5" />{t('app.offlineBar')}</div> : null}
      <main className="theme-scene flex min-h-0 min-w-0 flex-1 flex-col">
        <Scene />
        <ErrorBoundary key={routeKey(route)} onHome={resetRoute}>
          <Suspense fallback={<Loading />}><View key={routeKey(route)} route={route} /></Suspense>
        </ErrorBoundary>
      </main>
      {fullChat || keyboard ? null : <><NotifyOffer /><MobileTabs /></>}
      <Notices />
      <OrbInfoHost />
    </div>
  );
}

function Shell() {
  const t = useT();
  const route = useStore((s) => s.route);
  const app = useStore((s) => s.app);
  const View = VIEWS[route.view] ?? ChatView;
  const [drawer, setDrawer] = useState(false);
  const folded = useStore((s) => s.sidebarCollapsed);
  // 3.2: the shortcuts of the project's actions: God mode's project there, the working folder elsewhere.
  const projects = useStore((s) => s.projects);
  const expertProject = useStore((s) => s.expertProject);
  const shortcutProject = projects.find((p) => p.name === (route.view === 'expert' ? expertProject : app.activeProject?.name)) ?? null;
  useEffect(() => { if (!drawer) return undefined; const esc = (e) => { if (e.key === 'Escape') setDrawer(false); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [drawer]);
  // 3.2: the robot thinks while the assistant answers in any conversation (and talks while one streams its answer).
  // 3.8.3: a word, not the states themselves: a streamed piece does not redraw the whole window.
  const mood = useStore((s) => (anyChatBusy(s) ? (s.chats.some((c) => c.partial) ? 'talking' : 'thinking') : 'idle'));
  AGENT.orb = app.config.assistantName;
  // 2.6: the guided tour, once, the first time the app opens after the setup (never on the phone); later from Tutoriales.
  const tour = useStore((s) => s.tour);
  const settingsOpen = useStore((s) => Boolean(s.settings));
  const gamesOpen = useStore((s) => Boolean(s.games));
  useEffect(loadTheRest, []);
  useEffect(() => {
    if (bridge.mobile || getState().app?.config?.ui?.tourDone === true) return undefined;
    const id = setTimeout(startTour, 900);
    return () => clearTimeout(id);
  }, []);
  if (phoneLayout()) return <MobileShell />;
  return (
    <div className="flex h-full">
      {/* 2.6: folded away (its button next to day / night), the screens take the whole width. */}
      <div className={folded ? 'hidden' : 'hidden md:flex'}><Sidebar mood={mood} /></div>
      {/* Narrow windows: the sidebar is a drawer behind a menu button (phones have their own shell). */}
      {drawer ? <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setDrawer(false)}><div className="animate-in slide-in-from-left flex h-full shadow-2xl" onClick={(e) => { if (e.target.closest('button')) setTimeout(() => setDrawer(false), 50); }}><Sidebar mood={mood} /></div><div className="flex-1 bg-black/40" /></div> : null}
      <main className="theme-scene flex min-w-0 flex-1 flex-col">
        <Scene />
        <div className="topbar theme-band app-titlebar wco-pad bg-sidebar flex h-14 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <button className="hover:bg-accent grid size-9 cursor-pointer place-items-center rounded-lg" onClick={() => setDrawer(true)} aria-label={t('app.menu')}><Menu className="size-5" /></button>
          <Robot size={26} mood={mood} /><span className="min-w-0 flex-1 truncate text-[15px] font-medium">{app.config.assistantName}</span>
        </div>
        <ErrorBoundary key={routeKey(route)} onHome={resetRoute}>
          <Suspense fallback={<Loading />}><View key={routeKey(route)} route={route} /></Suspense>
        </ErrorBoundary>
      </main>
      {/* 3.6 (M3): the info pane on the right (a chat, a project). */}
      <OrbInfoHost />
      {/* The floating robot only where there is room for it: never over forms or conversations (it covered the switches of
          Ajustes and took their clicks), and those views leave room at the bottom so nothing stays under it. */}
      {/* 3.5: a browser linked with an Orb gets the PC's layout, not what only the PC itself does. */}
      {bridge.mobile ? null : <><UpdateCard /><OnceOpened when={settingsOpen} onFail={closeSettingsFailed}><SettingsDialog /></OnceOpened><OnceOpened when={gamesOpen} onFail={closeGamesFailed}><GamesDialog /></OnceOpened><RecoveryNotice /></>}
      <Notices />
      {bridge.mobile ? null : <><ActionShortcuts project={shortcutProject} /><CommandPalette /></>}
      <div className="hidden md:contents"><Companion name={app.config.assistantName} base={mood} hidden={app.config.ui?.companion === false || !COMPANION_VIEWS.has(route.view) || bridge.mobile || Boolean(tour)} /></div>
      {tour ? <ErrorBoundary key={tour.key} onFail={closeTourFailed}><Suspense fallback={null}><Tour /></Suspense></ErrorBoundary> : null}
    </div>
  );
}

document.addEventListener('visibilitychange', flushChatStates);

let coreLost = false;
// The linking screen's own «back» (AppLink): true when it took the press.
const linkBack = { current: null };
// 3.8 (F5b): after linking, the phone's notifications (off until turned on) are offered, saying what they do. 3.8.1: in the
// list of chats, in the flow above the tabs (never over a screen's buttons, as the toast was), until the person answers.
// The Android app updated from 3.8.0 starts with no choice saved (a new origin: review Android M2): notifications are
// turned back on by themselves when Android already allows them, else offered the same way.
const OFFER_NOTIFY = 'orb.ofrecerAvisos';
const offerNotify = () => { try { localStorage.setItem(OFFER_NOTIFY, '1'); } catch { /* storage unavailable */ } };
function NotifyOffer() {
  const t = useT();
  const view = useStore((s) => s.route.view);
  const [show, setShow] = useState(false);
  useEffect(() => {
    let gone = false;
    (async () => {
      const p = bridge.push;
      if (!p || p.enabled() || !p.supported() || (p.ios() && !p.installed())) return;
      let flag = null; try { flag = localStorage.getItem(OFFER_NOTIFY); } catch { /* storage unavailable */ }
      if (flag !== '1' && p.undecided?.()) {
        if (await p.adopt?.().catch(() => false)) return;
        flag = '1'; offerNotify();
      }
      if (flag === '1' && !gone) setShow(true);
    })();
    return () => { gone = true; };
  }, []);
  if (!show || view !== 'chats') return null;
  const done = () => { try { localStorage.removeItem(OFFER_NOTIFY); } catch { /* storage unavailable */ } setShow(false); };
  const p = bridge.push;
  return (
    <div className="bg-card flex shrink-0 flex-col gap-2 border-t px-4 py-3 text-[13px]" role="region" aria-label={t('app.notifyOfferOk')} data-testid="notify-offer">
      <span>{t(p?.whenClosed?.() === false ? 'app.notifyOfferApp' : 'app.notifyOffer')}</span>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => { p?.decline?.(); done(); }} data-testid="notify-offer-later">{t('app.notifyOfferLater')}</Button>
        <Button size="sm" onClick={async () => { if (await act(p.enable()) !== undefined) { toast.success(tNow('app.notifyOn')); done(); } }} data-testid="notify-offer-ok">{t('app.notifyOfferOk')}</Button>
      </div>
    </div>
  );
}
function Root() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const [phase, setPhase] = useState('loading'); // loading | setup | pair | update | offline | core | migration | master | unlock | layout | app | error
  const [error, setError] = useState('');
  const [startError, setStartError] = useState(null); // Tauri: why the engine did not start ({ code, message })
  const [migration, setMigration] = useState(null);
  const [core, setCore] = useState(null);
  const [layout, setLayout] = useState(null);
  const [masterState, setMasterState] = useState(null);
  const [resume, setResume] = useState(null); // a welcome left halfway: { step, plan }
  useEffect(() => {
    let alive = true;
    (async () => {
      // 3.8.1 (Tauri): the engine could not look for the workspace: an error to retry, never the welcome.
      let info;
      try { info = await bridge.info(); } catch (e) { setError(String(e?.message ?? e)); return alive && setPhase('error'); }
      setState({ info });
      if (info.needsSetup) return alive && setPhase('setup');
      if (info.needsPairing) return alive && setPhase('pair');
      // 3.6: this app is older than what the Orb asks for (protocol of the link): update first.
      if (info.needsUpdate) return alive && setPhase('update');
      // 3.8: the phone cannot reach its PC (off, asleep, another network, Orb closed): a calm screen that keeps trying.
      if (info.offline) return alive && setPhase('offline');
      // The engine may still be starting: retry for a few seconds.
      for (let i = 0; i < 40 && alive; i++) {
        try {
          // 3.8 (this PC only): core gone, the data of 3.7 not updated, the master password (typed, or made once), a
          // welcome left halfway, folders of an earlier Orb to decide about (lib/startup.js).
          const start = await startupPhase((method) => bridge.call(method), { mobile: bridge.mobile });
          if (start.phase !== 'app') {
            if (start.phase === 'core') setCore(start.data);
            else if (start.phase === 'migration') setMigration(start.data);
            else if (start.phase === 'unlock' || start.phase === 'master') setMasterState(start.data);
            else if (start.phase === 'layout') setLayout(start.data);
            else if (start.phase === 'setup') setResume(start.data);
            return alive && setPhase(start.phase);
          }
          await refresh();
          // 3.8: the saved route only if it still exists (lib/phone-nav.js › restoreRoute): the phone opens on its chat
          // list unless it was left in a chat that is still there or on one of its tabs; a broken one is forgotten.
          let saved = null; try { saved = JSON.parse(localStorage.getItem('orb.route') || 'null'); } catch { /* broken: home */ }
          const { sessions, conversations } = getState();
          const route = restoreRoute(saved, { views: Object.keys(VIEWS), phone: phoneLayout(), sessions, conversations });
          setState({ route });
          try { localStorage.setItem('orb.route', JSON.stringify(route)); } catch { /* storage unavailable */ }
          loadOrbInbox(); // 3.6 (M3): the unread badges
          return setPhase('app');
        } catch (e) {
          // 3.8: the phone lost its PC while starting: the same calm screen, never «No se pudo iniciar Orb».
          if (bridge.mobile && isOffline(e)) { setState({ info: { ...getState().info, offline: true } }); return alive && setPhase('offline'); }
          setError(String(e?.message ?? e)); await new Promise((r) => setTimeout(r, 250));
        }
      }
      if (bridge.retryStart) { const again = await bridge.info().catch(() => null); if (again?.startError) { setStartError(again.startError); setError(again.startError.message); } }
      if (alive) setPhase('error');
    })();
    return () => { alive = false; };
  }, []);
  // 3.8.2: F5 reloads Orb's window on the PC, on every screen (the engine goes on; unsent messages come back).
  useEffect(() => {
    if (!bridge.desktop) return undefined;
    const key = (e) => { if (isReloadKey(e)) { e.preventDefault(); reloadOrb(getState().route); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  // Ctrl+J: a terminal in the folder on screen (also from the menu Ver → Abrir terminal).
  useEffect(() => {
    if (phase !== 'app' || !bridge.openTerminal) return undefined;
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyJ') { e.preventDefault(); openTerminal(); } };
    window.addEventListener('keydown', key);
    const off = bridge.on('ui:terminal', () => openTerminal());
    return () => { window.removeEventListener('keydown', key); off(); };
  }, [phase]);
  // 3.8.2 (T3 3.11): the agents' browser, from its little window: an element pointed at opens its chat (its message box
  // gets it) and a recording is said once saved. This PC's window only.
  useEffect(() => {
    if (phase !== 'app' || bridge.mobile) return undefined;
    const offPoint = listenPoints(bridge, (id) => go({ view: 'session', id }));
    const offRec = bridge.on('browser:recorded', () => toast.success(tNow('session.recordingSaved')));
    return () => { offPoint(); offRec(); };
  }, [phase]);
  // 3.8.1: Orb's lock screen (decision 20): Windows locked, the PC asleep, «Bloquear» or the minutes of Ajustes › Datos
  // without use (lib/idle-lock.js). The engine says so with 'master:locked' { screen: true }; the screen comes back,
  // without reloading, once the password is typed (the agents never stopped).
  useEffect(() => {
    if (bridge.mobile || !bridge.on) return undefined;
    return bridge.on('master:locked', (p) => {
      if (!p?.screen) return;
      pauseAll(); // 3.8.2: the music stops with the lock and does not come back by itself (lib/music.js)
      dropUnlock();
      setMasterState((s) => ({ ...(s ?? {}), exists: true, locked: false, lost: false, screenLocked: true }));
      setPhase((now) => (now === 'app' ? 'unlock' : now));
    });
  }, []);
  // 3.8.2: the background music (Windows): remembered as on, it comes back with the first click (lib/music.js).
  useEffect(() => (phase === 'app' ? startMusic() : undefined), [phase]);
  useEffect(() => {
    if (phase !== 'app' || bridge.mobile) return undefined;
    return watchIdle({ minutes: () => lockMinutesOf(getState().app?.config), onIdle: () => { call('master.lock', { reason: 'idle' }).catch(() => {}); } });
  }, [phase]);
  useEffect(() => { const off = () => setPhase('pair'); window.addEventListener('orb:unpaired', off); return () => window.removeEventListener('orb:unpaired', off); }, []);
  // 3.8: Android's back button or gesture, and a phone browser's back: inside the app (lib/phone-nav.js › backStep).
  const phaseRef = useRef(phase); phaseRef.current = phase;
  useEffect(() => {
    if (!bridge.mobile) return undefined;
    let lastExit = 0;
    const back = () => {
      const overlay = document.querySelector(OVERLAYS);
      // 3.8 (F5b): linking the app has steps of its own (the password back to scanning, «Enlazar sin cámara» closed).
      if (phaseRef.current !== 'app' && !overlay && linkBack.current?.()) return 'stay';
      const step = phaseRef.current === 'app' ? goBack({ overlay: Boolean(overlay) }) : overlay ? { close: true } : { exit: true };
      if (step?.close) { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return 'stay'; }
      if (!step?.exit) return 'stay';
      // The first screen: twice within 2 s leaves (the app goes to the background; a browser goes back).
      if (Date.now() - lastExit < 2000) return 'exit';
      lastExit = Date.now();
      toast(tNow('app.backExit'), { duration: 2000 });
      return 'stay';
    };
    if (bridge.onBack) return bridge.onBack(() => { if (back() === 'exit') bridge.minimize?.(); });
    // A phone's browser: one entry of its history stands for «inside Orb»; going back from it runs the same steps.
    if (!phoneLayout()) return undefined;
    history.pushState({ orb: 'back' }, '');
    const pop = () => { if (back() === 'exit') history.back(); else history.pushState({ orb: 'back' }, ''); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  // 3.5, the Android app: something shared from another app («Compartir con Orb») opens the chat, which takes it.
  useEffect(() => {
    if (phase !== 'app' || !bridge.takeShared) return undefined;
    const open = () => { if (getState().route?.view !== 'chat') go({ view: 'chat' }); };
    if (bridge.hasShared?.()) open();
    window.addEventListener('orb:shared', open);
    return () => window.removeEventListener('orb:shared', open);
  }, [phase]);
  // Screens without a top bar of their own (welcome, loading, error): a strip at the top still moves the window (the
  // PC's only: on a phone it would only take the taps at the top of the screen).
  const strip = bridge.mobile ? null : <div className="app-titlebar fixed inset-x-0 top-0 z-40 h-14" aria-hidden="true" />;
  useEffect(() => {
    if (phase !== 'app') return undefined;
    return bridge.on('*', (event, payload) => {
      if (event === 'board:changed' || event === 'session:update' || event === 'session:removed' || event === 'config:changed' || event === 'approval:changed') refreshSoon();
      // 3.2: what one conversation is doing now (answering, waiting its turn or idle again). 3.8.1 (H4a): an answer
      // streams in many small pieces; the screen takes them once per frame (the newest state of each conversation).
      if (event === 'chat:state' && payload?.conversation != null) chatStateSoon(payload);
      // 2.7: what only informs (working folder, brain in use, schedule created…) passes by as a notification.
      // 3.2: through lib/notify.js: one at a time, never repeated, kept under the bell.
      if (event === 'notice' && payload?.body) notify({ body: payload.body, tone: payload.tone });
      if (event === 'ui:navigate') go(payload);
      if (event === 'inbox:changed') loadOrbInboxSoon(120);
      // 3.6 (M3): the chat list follows what its conversations do (a new line comes with inbox:changed).
      if (event === 'chat:state' && !payload?.partial && payload?.append == null) loadOrbInboxSoon(400);
      if (event === 'engine:stopped') notify({ body: tNow('app.engineStopped'), tone: 'error' });
      // 3.8: core went missing while Orb ran: the engine starts again and brings it back (or says why it cannot).
      if (event === 'core:lost') coreLost = true;
      if (event === 'engine:restarted') { if (coreLost) { location.reload(); return; } notify({ body: tNow('app.engineRestarted'), tone: 'warning' }); refreshSoon(); }
    });
  }, [phase]);
  // 3.8.1: the main screen's first frame, marked for scripts/medir.mjs (the same mark under every app, read whenever the
  // measurement reaches the page).
  useEffect(() => {
    if (phase !== 'app' || !ready) return;
    try { if (!performance.getEntriesByName('orb:ready').length) requestAnimationFrame(() => performance.mark('orb:ready')); } catch { /* no performance API */ }
  }, [phase, ready]);
  if (phase === 'setup') return <>{strip}<Suspense fallback={null}><Setup resume={resume} onDone={async (route) => { await refresh(); setPhase('app'); if (route) go(route); }} /></Suspense></>;
  if (phase === 'pair' && bridge.link) return <>{strip}<AppLink /></>;
  // 3.8: a browser opened from the QR: the master password before linking.
  if (phase === 'pair' && getState().info?.pairLink && bridge.pairPending) return <>{strip}<BrowserPair /></>;
  if (phase === 'pair') return (
    <div className="brand-sky flex h-full overflow-y-auto p-6 pt-20 text-center">
      {strip}
      <div className="bg-card/95 m-auto grid w-full max-w-sm gap-3 rounded-3xl p-7 shadow-2xl">
        <div className="-mt-16 flex justify-center"><Robot size={110} mood="idle" /></div>
        <h1 className="text-xl">{t('app.pairTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('app.pairBody1')}<b>{t('app.pairBodyPath')}</b>{t('app.pairBody2')}</p>
        {getState().info?.pairError ? <p className="text-destructive text-sm" role="alert">{getState().info.pairError}</p> : null}
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs"><Smartphone className="size-3.5" />{t('app.pairPrivate')}</p>
      </div>
    </div>
  );
  if (phase === 'update') return <>{strip}<UpdateNeeded info={getState().info} /></>;
  if (phase === 'offline') return <PcOffline info={getState().info} onRelink={() => setPhase('pair')} />;
  if (phase === 'core') return <>{strip}<Suspense fallback={null}><CoreMissing state={core} /></Suspense></>;
  if (phase === 'master') return <>{strip}<MasterCreate upgrade={Boolean(masterState?.upgraded)} onDone={() => location.reload()} /></>;
  if (phase === 'unlock') return <>{strip}<MasterLocked state={masterState} onDone={() => { if (masterState?.screenLocked && getState().ready) { setPhase('app'); refreshSoon(); } else location.reload(); }} /></>;
  if (phase === 'layout') return <>{strip}<Suspense fallback={null}><LayoutReview plan={layout} onDone={() => location.reload()} /></Suspense></>;
  if (phase === 'migration') return <>{strip}<MigrationFailed state={migration} /></>;
  // 3.8 (F5b): on the phone, a way out: try again, or link with another PC.
  if (phase === 'error') return (
    <div className="grid h-full place-items-center overflow-y-auto p-8 text-center" data-testid="app-error">{strip}
      <div className="grid max-w-md justify-items-center gap-3">
        <Robot size={90} mood="worried" /><h1 className="mt-1 text-xl">{t('app.errorTitle')}</h1><p className="text-muted-foreground text-sm break-words">{error}</p>
        {bridge.mobile ? <Button size="lg" onClick={() => location.reload()} data-testid="app-error-retry"><RotateCw />{t('app.offlineRetry')}</Button> : null}
        {/* 3.8.1 (Tauri): start the engine again; after sealed keys that do not open, also with a new key (asked first). */}
        {bridge.retryStart ? <Button size="lg" onClick={() => bridge.retryStart().catch(() => {}).finally(() => location.reload())} data-testid="app-error-retry"><RotateCw />{t('app.offlineRetry')}</Button> : null}
        {bridge.retryStart && startError?.code === 'secretUnreadable' ? <Button variant="ghost" size="sm" data-testid="app-error-new-secret" onClick={async () => {
          if (!(await askNewSecret(startError))) return;
          await bridge.retryStart({ newSecret: true }).catch(() => {}); location.reload();
        }}>{t('app.newSecretOk')}</Button> : null}
        {bridge.mobile && bridge.unlink ? <Button variant="ghost" size="sm" onClick={async () => { if (await relinkPhone(getState().info?.pcName)) setPhase('pair'); }} data-testid="app-error-relink"><Link2 />{t('app.offlineRelink')}</Button> : null}
      </div>
    </div>
  );
  if (phase !== 'app' || !ready) return <div className="grid h-full place-items-center">{strip}<Robot size={80} mood="thinking" /></div>;
  // 3.6 (M4): a tapped notification opens its chat (lib/notes.js).
  return bridge.mobile ? <><NoteOpener /><Shell /></> : <Shell />;
}

// What counts as «something open over the screen» for back: a dialog or sheet, the menu ☰, a menu or a list.
const OVERLAYS = '[data-slot="dialog-content"], [data-slot="drawer-content"], [data-slot="menu-content"], [data-slot="select-content"], [role="dialog"]';

// 3.8: the phone cannot reach its PC. It keeps trying (3 s, 6 s, 12 s… up to 30 s, and at once when the phone comes back
// to the app or to a network) and opens Orb as soon as the PC answers.
// One loop of tries (lib/net.js › retryLoop): never two at once, none while the app is hidden.
// 3.8 (F5b): «Vincular con otro PC» forgets this phone's keys for its PC: asked first (with the PC off, linking again
// needs it on). → whether it was done.
async function relinkPhone(name) {
  if (!bridge.unlink) return false;
  if (!await confirm(tNow('app.relinkTitle'), tNow(name ? 'app.relinkBodyNamed' : 'app.relinkBody', { name }), { ok: tNow('app.offlineRelink'), danger: true })) return false;
  await bridge.unlink();
  return true;
}
function PcOffline({ info, onRelink }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(null); // seconds to the next try
  // 3.8.2 (review F2.5b M6): the PC answers but needs attention (its data could not be updated): said so, still retrying.
  const [attention, setAttention] = useState(info?.attention ?? null);
  const loop = useRef(null);
  useEffect(() => {
    const l = retryLoop({
      attempt: async () => { const r = await bridge.info(); if (r.offline) { setAttention(r.attention ?? null); return false; } location.reload(); return true; },
      onWait: (s, b) => { setWait(s); setBusy(b); },
      hidden: () => document.visibilityState === 'hidden'
    });
    loop.current = l;
    l.now();
    const seen = () => { if (document.visibilityState === 'visible') l.now({ reset: true }); else l.pause(); };
    const online = () => l.now({ reset: true });
    document.addEventListener('visibilitychange', seen); window.addEventListener('online', online);
    return () => { l.stop(); document.removeEventListener('visibilitychange', seen); window.removeEventListener('online', online); };
  }, []);
  const relink = async () => { if (await relinkPhone(info?.pcName)) { loop.current.stop(); onRelink(); } };
  return (
    <div className="brand-sky flex h-full overflow-y-auto p-6 pt-20" data-testid="pc-offline" data-attention={attention ?? undefined}>
      <div className="bg-card/95 m-auto grid w-full max-w-sm gap-3 rounded-3xl p-7 text-center shadow-2xl">
        <div className="-mt-16 flex justify-center"><Robot size={110} mood={busy ? 'thinking' : 'sleeping'} /></div>
        {attention ? (
          <>
            <h1 className="text-xl">{info?.pcName ? t('app.pcAttentionTitleNamed', { name: info.pcName }) : t('app.pcAttentionTitle')}</h1>
            <p className="text-muted-foreground text-sm" data-testid="pc-attention">{t('app.pcAttentionBody')}</p>
          </>
        ) : (
          <>
            <h1 className="text-xl">{info?.pcName ? t('app.offlineTitleNamed', { name: info.pcName }) : t('app.offlineTitle')}</h1>
            <p className="text-muted-foreground text-sm">{t('app.offlineBody')}</p>
          </>
        )}
        {/* 3.8.1, the Android app: a PC still on Orb 3.8.0 refuses it (another origin) and looks just like one turned off. */}
        {window.__orbHost?.app && !attention ? <p className="text-muted-foreground text-sm" data-testid="pc-offline-old">{t('app.offlineOldPc')}</p> : null}
        {info?.seenAt ? <p className="text-muted-foreground text-xs">{t('app.offlineSeen', { when: ago(info.seenAt) })}</p> : null}
        <Button size="lg" disabled={busy} onClick={() => loop.current?.now({ reset: true })} data-testid="pc-offline-retry">{busy ? <Spinner /> : <RotateCw />}{t('app.offlineRetry')}</Button>
        <p className="text-muted-foreground min-h-4 text-xs" aria-live="polite">{wait ? t('app.offlineNext', { s: wait }) : ''}</p>
        {bridge.unlink ? <Button variant="ghost" size="sm" onClick={relink} data-testid="pc-offline-relink"><Link2 />{t('app.offlineRelink')}</Button> : null}
      </div>
    </div>
  );
}

// 3.8: the data of Orb 3.7 could not be updated (src/core/migrate-38.mjs): what to do, where the copy is («Abrir
// carpeta»), «Reintentar», a new version of Orb (the way out when the cause is Orb's own) and the reason under «Detalles».
function MigrationFailed({ state }) {
  const t = useT();
  const [s, setS] = useState(state);
  const [busy, setBusy] = useState(false);
  const v = migrationView(s, useUpdate());
  const u = v.update;
  const retry = async () => {
    setBusy(true);
    try { const r = await bridge.call('app.migrationRetry'); if (r?.failed) setS(r); else location.reload(); }
    catch (e) { setS({ ...s, reason: String(e?.message ?? e) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-8 text-center" data-testid="migration-failed">
      <div className="grid max-w-md gap-3">
        <div className="flex justify-center"><Robot size={90} mood={busy ? 'thinking' : 'worried'} /></div>
        <h1 className="text-xl">{t('data.migration38.title')}</h1>
        <p className="text-muted-foreground text-sm">{t(v.body)}</p>
        <p className="text-sm" role="alert">{t('data.migration38.help')}</p>
        <p className="text-muted-foreground text-xs break-all">{s.backup ? t('data.migration38.backup', { path: s.backup }) : t('data.migration38.noBackup', { path: s.data })}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button disabled={busy} onClick={retry} data-testid="migration-retry">{busy ? <Spinner /> : <RotateCw />}{t('data.migration38.retry')}</Button>
          {v.folder && bridge.openPath ? <Button variant="outline" onClick={() => act(bridge.openPath(v.folder))}><FolderOpen />{t('data.migration38.openFolder')}</Button> : null}
          {u?.action === 'check' ? <Button variant="outline" disabled={u.busy} onClick={updateActions.check} data-testid="migration-update">{u.busy ? <Spinner /> : <Download />}{t('data.migration38.checkUpdate')}</Button> : null}
          {u?.action === 'update' ? <Button variant="outline" onClick={() => updateActions.update({ portable: u.portable })} data-testid="migration-update"><Download />{t(u.portable ? 'update.download' : 'update.update')} {u.version}</Button> : null}
          {u?.action === 'restart' ? <Button variant="outline" onClick={updateActions.restart} data-testid="migration-update"><RotateCw />{t('update.restart')}</Button> : null}
        </div>
        {u?.percent != null ? <p className="text-muted-foreground text-xs">{t('update.downloading', { percent: u.percent })}</p> : null}
        {u?.none ? <p className="text-muted-foreground text-xs">{t('data.migration38.noUpdate')}</p> : null}
        <details className="text-muted-foreground text-left text-xs"><summary className="cursor-pointer text-center">{t('data.migration38.details')}</summary><p className="mt-2 break-words">{t('data.migration38.reason', { reason: s.reason })}</p></details>
      </div>
    </div>
  );
}

// 3.8: the PC's master password, the second step of linking (the app after scanning, a browser opened from the QR). It
// never leaves the phone (src/core/mobile-crypto.mjs › linkDevice proves it is known) and is never kept. fp: the PC's
// 3.8.1 (Tauri, review D-fix M2): «Empezar con una clave nueva» says what is lost (startError: recovery, master = the
// recovery code and the master password exist in core). Without a recovery code the backups made until now will not
// open any more: the word EMPEZAR must be typed.
async function askNewSecret(startError) {
  const lines = [t('app.newSecretIntro'), startError?.master ? t('app.newSecretMaster') : startError?.vault ? t('app.newSecretVault') : null, startError?.recovery ? t('app.newSecretRecovery') : t('app.newSecretNoRecovery'), t('app.newSecretBack')].filter(Boolean).join('\n\n');
  if (startError?.recovery) return confirm(t('app.newSecretTitle'), lines, { ok: t('app.newSecretOk'), danger: true });
  const word = t('app.newSecretWord');
  return Boolean(await form(t('app.newSecretTitle'), {
    description: lines,
    initial: { word: '' },
    body: (v, set) => <Field label={t('app.newSecretType', { word })}><Input autoComplete="off" value={v.word} onChange={(e) => set({ word: e.target.value })} data-testid="new-secret-word" /></Field>,
    ok: t('app.newSecretOk'),
    onOk: (v) => { if (v.word.trim().toUpperCase() !== word.toUpperCase()) throw new Error(t('app.newSecretWrong', { word })); return true; }
  }));
}

// fingerprint, to compare with the PC's screen (with a typed short code it must be confirmed first: confirmFp).
function PairPassword({ name, fp = null, confirmFp = false, busy, error, onSubmit, onBack = null }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [sure, setSure] = useState(!confirmFp);
  const field = useMemo(() => `p${Math.random().toString(36).slice(2)}`, []); // no saved password offered for this address
  return (
    <form className="grid gap-3 text-left" onSubmit={(e) => { e.preventDefault(); if (password && sure) onSubmit(password); }} data-testid="pair-password" autoComplete="off">
      <h1 className="text-center text-xl">{name ? t('app.linkPassTitleNamed', { name }) : t('app.linkPassTitle')}</h1>
      {fp ? (
        <div className="bg-muted/60 grid gap-1 rounded-xl px-3 py-2 text-center" data-testid="pair-fp">
          <span className="font-mono text-sm font-medium tracking-wide break-words">{t('app.linkFp', { fp })}</span>
          <span className="text-muted-foreground text-xs">{t('app.linkFpCheck')}</span>
          {confirmFp ? <label className="flex cursor-pointer items-center justify-center gap-2 text-[13px]"><Checkbox checked={sure} onCheckedChange={(c) => setSure(c === true)} data-testid="pair-fp-ok" />{t('app.linkFpConfirm')}</label> : null}
        </div>
      ) : null}
      <p className="text-muted-foreground text-center text-sm">{t('app.linkPassBody')}</p>
      <Input type="password" name={field} autoComplete="off" autoFocus={!confirmFp} disabled={!sure} aria-label={t('app.linkPassLabel')} placeholder={t('app.linkPassLabel')} value={password} onChange={(e) => setPassword(e.target.value)} enterKeyHint="go" data-testid="pair-password-input" />
      <Button type="submit" size="lg" disabled={busy || !password || !sure}>{busy ? <Spinner /> : <KeyRound />}{t('app.linkPassGo')}</Button>
      {onBack ? <Button type="button" variant="ghost" size="sm" onClick={onBack}><ArrowLeft />{t('app.linkBack')}</Button> : null}
      {error ? <p className="text-destructive text-center text-sm" role="alert">{error}</p> : null}
    </form>
  );
}

function BrowserPair() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(getState().info?.pairError ?? '');
  const [gone, setGone] = useState(false);
  const link = getState().info?.pairLink;
  const submit = async (password) => {
    setBusy(true); setError('');
    try { await bridge.pairPending(password); offerNotify(); location.reload(); }
    catch (e) { setError(String(e?.message ?? e)); if (e?.reason === 'newCode' || e?.status === 426) setGone(true); }
    finally { setBusy(false); }
  };
  return (
    <div className="brand-sky flex h-full overflow-y-auto p-6 pt-20" data-testid="browser-pair">
      <div className="bg-card/95 m-auto grid w-full max-w-sm gap-3 rounded-3xl p-7 shadow-2xl">
        <div className="-mt-16 flex justify-center"><Robot size={110} mood={busy ? 'thinking' : 'idle'} /></div>
        {/* 3.8: never the master password in a page that came without encryption (plain http on the Wi-Fi). */}
        {link?.insecure ? <p className="text-destructive text-center text-sm" role="alert" data-testid="pair-http">{t('app.linkHttp')}</p>
          : gone ? <p className="text-destructive text-center text-sm" role="alert">{error}</p> : <PairPassword name={link?.name} fp={link?.fp} busy={busy} error={error} onSubmit={submit} />}
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs"><Smartphone className="size-3.5" />{t('app.pairPrivate')}</p>
      </div>
    </div>
  );
}

// 3.5, the Android app: link it with an Orb by scanning its QR (Ajustes › Móvil), or by hand when the camera cannot.
// 3.8: then the PC's master password.
function AppLink() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(getState().info?.pairError ?? '');
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ text: '', code: '', address: '' });
  const [link, setLink] = useState(null); // { input, name, fp, short }: read, waiting for the password
  const run = async (get) => {
    setBusy(true); setError('');
    try { const input = await get(); if (input == null) return; const p = await bridge.checkLink(input); setLink({ input, name: p?.name ?? null, fp: p?.fp ?? null, short: Boolean(p?.short) }); }
    catch (e) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  const pair = async (password) => {
    setBusy(true); setError('');
    try { await bridge.link(link.input, { password }); offerNotify(); location.reload(); }
    catch (e) { setError(String(e?.message ?? e)); if (e?.reason === 'newCode' || e?.status === 426) setLink(null); }
    finally { setBusy(false); }
  };
  const field = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  useEffect(() => {
    linkBack.current = () => { if (link) { setLink(null); setError(''); return true; } if (manual) { setManual(false); return true; } return false; };
    return () => { linkBack.current = null; };
  }, [link, manual]);
  if (link) return (
    <div className="brand-sky flex h-full overflow-y-auto p-6 pt-20" data-testid="app-link">
      <div className="bg-card/95 m-auto grid w-full max-w-sm gap-3 rounded-3xl p-7 shadow-2xl">
        <div className="-mt-16 flex justify-center"><Robot size={110} mood={busy ? 'thinking' : 'idle'} /></div>
        <PairPassword key={link.fp ?? ''} name={link.name} fp={link.fp} confirmFp={link.short} busy={busy} error={error} onSubmit={pair} onBack={() => { setLink(null); setError(''); }} />
      </div>
    </div>
  );
  return (
    <div className="brand-sky flex h-full overflow-y-auto p-6 pt-20 text-center" data-testid="app-link">
      <div className="bg-card/95 m-auto grid w-full max-w-sm gap-3 rounded-3xl p-7 shadow-2xl">
        <div className="-mt-16 flex justify-center"><Robot size={110} mood={busy ? 'thinking' : 'idle'} /></div>
        <h1 className="text-xl">{t('app.linkTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('app.linkBody')}</p>
        <Button size="lg" disabled={busy} onClick={() => run(() => bridge.scanLink())} data-testid="app-link-scan">{busy ? <Spinner /> : <ScanLine />}{t('app.linkScan')}</Button>
        {manual ? (
          <form className="grid gap-2 text-left" onSubmit={(e) => { e.preventDefault(); run(() => (form.text.trim() ? form.text : { code: form.code, address: form.address })); }}>
            <Textarea rows={2} placeholder={t('app.linkPastePh')} aria-label={t('app.linkPaste')} {...field('text')} />
            <p className="text-muted-foreground text-center text-xs">{t('app.linkOr')}</p>
            <Input placeholder={t('app.linkCodePh')} aria-label={t('app.linkCode')} autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" {...field('code')} />
            <Input placeholder={t('app.linkAddressPh')} aria-label={t('app.linkAddress')} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" {...field('address')} />
            <Button type="submit" variant="outline" disabled={busy}><Link2 />{t('app.linkGo')}</Button>
          </form>
        ) : <Button variant="ghost" size="sm" onClick={() => setManual(true)} data-testid="app-link-manual">{t('app.linkManual')}</Button>}
        {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs"><Smartphone className="size-3.5" />{t('app.pairPrivate')}</p>
      </div>
    </div>
  );
}

// 2.7: the notifications follow the app's day / night (not the system's): more of them now that the notices pass by here.
function ThemedToaster() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  // 3.1: below the window's header (offset), so a passing notice never covers the menu or the window buttons.
  // 3.2: one on screen at a time (the newest); the others are under the bell of the top bar.
  // 3.8: on a phone, below the status bar as well (edge to edge, the page starts under it).
  return <Toaster position="top-center" offset={72} mobileOffset={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }} visibleToasts={1} theme={dark ? 'dark' : 'light'} richColors closeButton toastOptions={{ className: 'font-sans' }} />;
}

applyTheme();
if (window.orb?.windowControls) document.documentElement.classList.add('has-win-controls');
// The animated backdrop pauses while the window is in the background or hidden (themes.css: html.window-idle).
const idle = () => document.documentElement.classList.toggle('window-idle', document.hidden || !document.hasFocus());
window.addEventListener('blur', idle); window.addEventListener('focus', idle); document.addEventListener('visibilitychange', idle);
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TooltipProvider>
      <ErrorBoundary onHome={() => { resetRoute(); location.reload(); }}><Root /></ErrorBoundary>
      <DialogHost />
      <ImagePreviewHost />
      <WindowControls />
      <ThemedToaster />
    </TooltipProvider>
  </StrictMode>
);
