// Entry of the window: first-run setup or the app (sidebar + current view), live refresh from the engine's events.
import './lib/web-bridge.js'; // first: in a phone's browser it provides window.orb
import './app.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { notify } from '@/lib/notify.js';
import { Menu, Smartphone, MessagesSquare } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { MobileTabs, MoreView } from '@/components/mobile-tabs.jsx';
import { TooltipProvider } from '@/components/ui/overlay.jsx';
import { DialogHost } from '@/components/dialogs.jsx';
import { Sidebar } from '@/components/sidebar.jsx';
import { Companion } from '@/components/companion.jsx';
import { UpdateCard } from '@/components/update-card.jsx';
import { Notices } from '@/components/notices.jsx';
import { Scene } from '@/components/scene.jsx';
import { GamesDialog } from '@/games/games.jsx';
import { Robot } from '@/components/robot.jsx';
import { useStore, setState, getState, refresh, refreshSoon, bridge, go, applyTheme, openTerminal, startTour, anyChatBusy } from '@/lib/store.js';
import { Tour } from '@/components/tour.jsx';
import { AGENT } from '@/lib/labels.js';
import { WindowControls } from '@/components/window-controls.jsx';
import { useT, t as tNow } from '@/lib/i18n.js';
import { Setup } from '@/views/setup.jsx';
import { ChatView } from '@/views/chat.jsx';
import { SessionView } from '@/views/session.jsx';
import { TasksView } from '@/views/tasks.jsx';
import { ProjectsView } from '@/views/projects.jsx';
import { AgentsView } from '@/views/agents.jsx';
import { MemoriesView } from '@/views/memories.jsx';
import { SettingsDialog, PhoneView } from '@/views/settings.jsx';
import { SchedulesView } from '@/views/schedules.jsx';
import { ExpertView } from '@/views/expert.jsx';
import { TutorialsView } from '@/views/tutorials.jsx';
import { WhiteboardView } from '@/views/whiteboard.jsx';
import { MonitorView } from '@/views/monitor.jsx';

const COMPANION_VIEWS = new Set(['tasks', 'projects', 'logs', 'activity']);
// 2.7, the phone: the conversations («Chats») and «Más» are screens of their own; Agentes and Modo experto are PC only.
function ChatsView() { const t = useT(); return <><PageHeader icon={<MessagesSquare className="text-primary size-5" />} title={t('nav.chats')} /><Sidebar page /></>; }
const VIEWS = bridge.mobile
  ? { chat: ChatView, session: SessionView, tasks: TasksView, projects: ProjectsView, logs: MemoriesView, activity: MemoriesView, schedules: SchedulesView, phone: PhoneView, tutorials: TutorialsView, chats: ChatsView, more: MoreView, board: WhiteboardView }
  : { chat: ChatView, session: SessionView, tasks: TasksView, projects: ProjectsView, agents: AgentsView, logs: MemoriesView, activity: MemoriesView, schedules: SchedulesView, phone: PhoneView, tutorials: TutorialsView, board: WhiteboardView,
    // 2.7.3: Orb Light (the portable .exe) has no God mode nor PC Status.
    ...(bridge.light ? {} : { expert: ExpertView, monitor: MonitorView }) };

// The phone's frame: the screen (each with its own header) and the tabs at the bottom.
function MobileShell() {
  const route = useStore((s) => s.route);
  const View = VIEWS[route.view] ?? ChatView;
  return (
    <div className="flex h-full flex-col">
      <main className="theme-scene flex min-h-0 min-w-0 flex-1 flex-col">
        <Scene />
        <View key={`${route.view}:${route.id ?? ''}:${route.project ?? ''}`} route={route} />
      </main>
      <MobileTabs />
      <Notices />
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
  useEffect(() => { if (!drawer) return undefined; const esc = (e) => { if (e.key === 'Escape') setDrawer(false); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [drawer]);
  // 3.2: the robot thinks while the assistant answers in any conversation (and talks while one streams its answer).
  const busy = anyChatBusy(app);
  const mood = busy ? ((app.chats ?? []).some((c) => c.partial) ? 'talking' : 'thinking') : 'idle';
  AGENT.orb = app.config.assistantName;
  // 2.6: the guided tour, once, the first time the app opens after the setup (never on the phone); later from Tutoriales.
  const tour = useStore((s) => s.tour);
  useEffect(() => {
    if (bridge.mobile || getState().app?.config?.ui?.tourDone === true) return undefined;
    const id = setTimeout(startTour, 900);
    return () => clearTimeout(id);
  }, []);
  if (bridge.mobile) return <MobileShell />;
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
          <Robot size={26} mood={mood} /><span className="truncate text-[15px] font-medium">{app.config.assistantName}</span>
        </div>
        <View key={`${route.view}:${route.id ?? ''}:${route.project ?? ''}`} route={route} />
      </main>
      {/* The floating robot only where there is room for it: never over forms or conversations (it covered the switches of
          Ajustes and took their clicks), and those views leave room at the bottom so nothing stays under it. */}
      <UpdateCard />
      <SettingsDialog />
      <GamesDialog />
      <Notices />
      <div className="hidden md:contents"><Companion name={app.config.assistantName} base={mood} hidden={app.config.ui?.companion === false || !COMPANION_VIEWS.has(route.view) || bridge.mobile || Boolean(tour)} /></div>
      {tour ? <Tour key={tour.key} /> : null}
    </div>
  );
}

function Root() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const [phase, setPhase] = useState('loading'); // loading | setup | app | error
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      const info = await bridge.info();
      setState({ info });
      if (info.needsSetup) return alive && setPhase('setup');
      if (info.needsPairing) return alive && setPhase('pair');
      // The engine may still be starting: retry for a few seconds.
      for (let i = 0; i < 40 && alive; i++) {
        try {
          await refresh();
          try {
            const saved = JSON.parse(localStorage.getItem('orb.route') || 'null');
            const exists = saved?.view === 'session' ? getState().sessions.some((s) => s.id === saved.id) : saved?.view === 'chat' && saved.id != null ? getState().conversations.some((c) => c.id === saved.id) : true;
            if (saved?.view && VIEWS[saved.view] && exists) setState({ route: saved });
          } catch { /* default */ }
          return setPhase('app');
        } catch (e) { setError(String(e?.message ?? e)); await new Promise((r) => setTimeout(r, 250)); }
      }
      if (alive) setPhase('error');
    })();
    return () => { alive = false; };
  }, []);
  // Ctrl+J: a terminal in the folder on screen (also from the menu Ver → Abrir terminal).
  useEffect(() => {
    if (phase !== 'app' || !bridge.openTerminal) return undefined;
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyJ') { e.preventDefault(); openTerminal(); } };
    window.addEventListener('keydown', key);
    const off = bridge.on('ui:terminal', () => openTerminal());
    return () => { window.removeEventListener('keydown', key); off(); };
  }, [phase]);
  useEffect(() => { const off = () => setPhase('pair'); window.addEventListener('orb:unpaired', off); return () => window.removeEventListener('orb:unpaired', off); }, []);
  // Screens without a top bar of their own (welcome, loading, error): a strip at the top still moves the window.
  const strip = <div className="app-titlebar fixed inset-x-0 top-0 z-40 h-14" aria-hidden="true" />;
  useEffect(() => {
    if (phase !== 'app') return undefined;
    return bridge.on('*', (event, payload) => {
      if (event === 'board:changed' || event === 'session:update' || event === 'session:removed' || event === 'config:changed' || event === 'approval:changed') refreshSoon();
      // 3.2: what one conversation is doing now (answering, waiting its turn or idle again).
      if (event === 'chat:state' && payload?.conversation != null) setState((s) => {
        const others = (s.app?.chats ?? []).filter((c) => c.conversation !== payload.conversation);
        return { app: { ...s.app, chats: payload.busy || payload.waiting ? [...others, payload] : others } };
      });
      // 2.7: what only informs (working folder, brain in use, schedule created…) passes by as a notification.
      // 3.2: through lib/notify.js: one at a time, never repeated, kept under the bell.
      if (event === 'notice' && payload?.body) notify({ body: payload.body, tone: payload.tone });
      if (event === 'ui:navigate') go(payload);
      if (event === 'engine:stopped') notify({ body: tNow('app.engineStopped'), tone: 'error' });
      if (event === 'engine:restarted') { notify({ body: tNow('app.engineRestarted'), tone: 'warning' }); refreshSoon(); }
    });
  }, [phase]);
  if (phase === 'setup') return <>{strip}<Setup onDone={async () => { await refresh(); setPhase('app'); }} /></>;
  if (phase === 'pair') return (
    <div className="brand-sky grid h-full place-items-center p-6 text-center">
      {strip}
      <div className="bg-card/95 grid max-w-sm gap-3 rounded-3xl p-7 shadow-2xl">
        <div className="-mt-16 flex justify-center"><Robot size={110} mood="idle" /></div>
        <h1 className="text-xl">{t('app.pairTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('app.pairBody1')}<b>{t('app.pairBodyPath')}</b>{t('app.pairBody2')}</p>
        {getState().info?.pairError ? <p className="text-destructive text-sm" role="alert">{getState().info.pairError}</p> : null}
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs"><Smartphone className="size-3.5" />{t('app.pairPrivate')}</p>
      </div>
    </div>
  );
  if (phase === 'error') return <div className="grid h-full place-items-center p-8 text-center">{strip}<div><Robot size={90} mood="worried" /><h1 className="mt-4 text-xl">{t('app.errorTitle')}</h1><p className="text-muted-foreground mt-1 max-w-md text-sm">{error}</p></div></div>;
  if (phase !== 'app' || !ready) return <div className="grid h-full place-items-center">{strip}<Robot size={80} mood="thinking" /></div>;
  return <Shell />;
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
  return <Toaster position="top-center" offset={72} mobileOffset={72} visibleToasts={1} theme={dark ? 'dark' : 'light'} richColors closeButton toastOptions={{ className: 'font-sans' }} />;
}

applyTheme();
if (window.orb?.windowControls) document.documentElement.classList.add('has-win-controls');
// The animated backdrop pauses while the window is in the background or hidden (themes.css: html.window-idle).
const idle = () => document.documentElement.classList.toggle('window-idle', document.hidden || !document.hasFocus());
window.addEventListener('blur', idle); window.addEventListener('focus', idle); document.addEventListener('visibilitychange', idle);
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TooltipProvider>
      <Root />
      <DialogHost />
      <WindowControls />
      <ThemedToaster />
    </TooltipProvider>
  </StrictMode>
);
