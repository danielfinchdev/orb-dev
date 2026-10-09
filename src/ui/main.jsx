// Entry of the window: first-run setup or the app (sidebar + current view), live refresh from the engine's events.
import './lib/web-bridge.js'; // first: in a phone's browser it provides window.orb
import './app.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { Menu, Smartphone } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/overlay.jsx';
import { DialogHost } from '@/components/dialogs.jsx';
import { Sidebar } from '@/components/sidebar.jsx';
import { Companion } from '@/components/companion.jsx';
import { UpdateCard } from '@/components/update-card.jsx';
import { Robot } from '@/components/robot.jsx';
import { useStore, setState, getState, refresh, refreshSoon, bridge, go, applyTheme, openTerminal } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { useT, t as tNow } from '@/lib/i18n.js';
import { Setup } from '@/views/setup.jsx';
import { ChatView } from '@/views/chat.jsx';
import { SessionView } from '@/views/session.jsx';
import { TasksView } from '@/views/tasks.jsx';
import { ProjectsView } from '@/views/projects.jsx';
import { AgentsView } from '@/views/agents.jsx';
import { LogsView } from '@/views/logs.jsx';
import { ActivityView } from '@/views/activity.jsx';
import { SettingsView, PhoneView } from '@/views/settings.jsx';
import { SchedulesView } from '@/views/schedules.jsx';
import { ExpertView } from '@/views/expert.jsx';

const COMPANION_VIEWS = new Set(['tasks', 'projects', 'logs', 'activity']);
const VIEWS = { chat: ChatView, session: SessionView, tasks: TasksView, projects: ProjectsView, agents: AgentsView, logs: LogsView, activity: ActivityView, settings: SettingsView, expert: ExpertView, schedules: SchedulesView, phone: PhoneView };

function Shell() {
  const t = useT();
  const route = useStore((s) => s.route);
  const app = useStore((s) => s.app);
  const View = VIEWS[route.view] ?? ChatView;
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { if (!drawer) return undefined; const esc = (e) => { if (e.key === 'Escape') setDrawer(false); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [drawer]);
  const busy = app.chat?.busy;
  const mood = busy ? (app.chat.partial ? 'talking' : 'thinking') : 'idle';
  AGENT.orb = app.config.assistantName;
  return (
    <div className="flex h-full">
      <div className="hidden md:flex"><Sidebar mood={mood} /></div>
      {/* Phones and narrow windows: the sidebar is a drawer behind a menu button. */}
      {drawer ? <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setDrawer(false)}><div className="animate-in slide-in-from-left flex h-full shadow-2xl" onClick={(e) => { if (e.target.closest('button')) setTimeout(() => setDrawer(false), 50); }}><Sidebar mood={mood} /></div><div className="flex-1 bg-black/40" /></div> : null}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="bg-sidebar flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <button className="hover:bg-accent grid size-9 cursor-pointer place-items-center rounded-lg" onClick={() => setDrawer(true)} aria-label={t('app.menu')}><Menu className="size-5" /></button>
          <Robot size={26} mood={mood} /><span className="truncate text-[15px] font-medium">{app.config.assistantName}</span>
        </div>
        <View key={`${route.view}:${route.id ?? ''}:${route.project ?? ''}`} route={route} />
      </main>
      {/* The floating robot only where there is room for it: never over forms or conversations (it covered the switches of
          Ajustes and took their clicks), and those views leave room at the bottom so nothing stays under it. */}
      <UpdateCard />
      <div className="hidden md:contents"><Companion name={app.config.assistantName} base={mood} hidden={app.config.ui?.companion === false || !COMPANION_VIEWS.has(route.view) || bridge.mobile} /></div>
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
          try { const saved = JSON.parse(localStorage.getItem('orb.route') || 'null'); if (saved?.view && VIEWS[saved.view] && (saved.view !== 'session' || getState().sessions.some((s) => s.id === saved.id))) setState({ route: saved }); } catch { /* default */ }
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
  useEffect(() => {
    if (phase !== 'app') return undefined;
    return bridge.on('*', (event, payload) => {
      if (event === 'board:changed' || event === 'session:update' || event === 'session:removed' || event === 'config:changed' || event === 'approval:changed') refreshSoon();
      if (event === 'chat:state') setState((s) => ({ app: { ...s.app, chat: payload } }));
      if (event === 'ui:navigate') go(payload);
      if (event === 'engine:stopped') toast.error(tNow('app.engineStopped'));
      if (event === 'engine:restarted') { toast.warning(tNow('app.engineRestarted')); refreshSoon(); }
    });
  }, [phase]);
  if (phase === 'setup') return <Setup onDone={async () => { await refresh(); setPhase('app'); }} />;
  if (phase === 'pair') return (
    <div className="brand-sky grid h-full place-items-center p-6 text-center">
      <div className="bg-card/95 grid max-w-sm gap-3 rounded-3xl p-7 shadow-2xl">
        <div className="-mt-16 flex justify-center"><Robot size={110} mood="idle" /></div>
        <h1 className="text-xl">{t('app.pairTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('app.pairBody1')}<b>{t('app.pairBodyPath')}</b>{t('app.pairBody2')}</p>
        {getState().info?.pairError ? <p className="text-destructive text-sm" role="alert">{getState().info.pairError}</p> : null}
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs"><Smartphone className="size-3.5" />{t('app.pairPrivate')}</p>
      </div>
    </div>
  );
  if (phase === 'error') return <div className="grid h-full place-items-center p-8 text-center"><div><Robot size={90} mood="worried" /><h1 className="mt-4 text-xl">{t('app.errorTitle')}</h1><p className="text-muted-foreground mt-1 max-w-md text-sm">{error}</p></div></div>;
  if (phase !== 'app' || !ready) return <div className="grid h-full place-items-center"><Robot size={80} mood="thinking" /></div>;
  return <Shell />;
}

applyTheme();
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TooltipProvider>
      <Root />
      <DialogHost />
      <Toaster position="top-center" richColors closeButton toastOptions={{ className: 'font-sans' }} />
    </TooltipProvider>
  </StrictMode>
);
