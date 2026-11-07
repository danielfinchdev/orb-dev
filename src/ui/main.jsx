// Entry of the window: first-run setup or the app (sidebar + current view), live refresh from the engine's events.
import './lib/app-bridge.js'; // first: in the Android app it tells the web bridge where the linked Orb is
import './lib/web-bridge.js'; // then: in a phone's browser (or the app) it provides window.orb
import './app.css';
// 3.6: the Android app's «glass» look, only in the Android build (the other builds drop this line and its CSS).
if (import.meta.env.MODE === 'android') (await import('./lib/glass.js')).enableGlass();
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { notify } from '@/lib/notify.js';
import { Menu, Smartphone, ScanLine, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input, Textarea, Spinner } from '@/components/ui/basic.jsx';
import { MobileTabs, MoreView } from '@/components/mobile-tabs.jsx';
import { TooltipProvider } from '@/components/ui/overlay.jsx';
import { DialogHost } from '@/components/dialogs.jsx';
import { ImagePreviewHost } from '@/components/image-viewer.jsx';
import { Sidebar } from '@/components/sidebar.jsx';
import { Companion } from '@/components/companion.jsx';
import { UpdateCard } from '@/components/update-card.jsx';
import { Notices } from '@/components/notices.jsx';
import { ActionShortcuts } from '@/components/project-tools.jsx';
import { Scene } from '@/components/scene.jsx';
import { GamesDialog } from '@/games/games.jsx';
import { Robot } from '@/components/robot.jsx';
import { useStore, setState, getState, refresh, refreshSoon, bridge, go, applyTheme, openTerminal, startTour, anyChatBusy, phoneLayout, loadOrbInbox, loadOrbInboxSoon } from '@/lib/store.js';
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
import { OrbChatsView } from '@/views/orb/inbox.jsx';
import { OrbInfoHost } from '@/views/orb/info.jsx';
// 3.6 «Personas»
import { LockScreen, PhoneLock, UpdateNeeded } from '@/components/lock-screen.jsx';
import { NoteOpener } from '@/lib/notes.js';
import { ProfileView } from '@/views/persons.jsx';
import { RecoveryNotice } from '@/views/data.jsx';
import { personSwitched } from '@/lib/store.js';

const COMPANION_VIEWS = new Set(['tasks', 'projects', 'logs', 'activity']);
// 2.7, the phone: the conversations («Chats») and «Más» are screens of their own; Agentes and Modo experto are PC only.
// 3.6 (M3): «Chats» is the Orb zone's chat list (views/orb/inbox.jsx); the PC has it in the sidebar.
const ChatsView = OrbChatsView;
// 3.8: a route of a screen that is gone (a bot's, saved before or in an old notification) falls back to the chat.
const VIEWS = bridge.mobile
  ? { chat: ChatView, session: SessionView, tasks: TasksView, projects: ProjectsView, logs: MemoriesView, activity: MemoriesView, schedules: SchedulesView, phone: PhoneView, profile: ProfileView, tutorials: TutorialsView, chats: ChatsView, more: MoreView, board: WhiteboardView }
  : { chat: ChatView, session: SessionView, tasks: TasksView, projects: ProjectsView, agents: AgentsView, logs: MemoriesView, activity: MemoriesView, schedules: SchedulesView, phone: PhoneView, tutorials: TutorialsView, board: WhiteboardView,
    // 2.7.3: Orb Light (the portable .exe) has no God mode.
    ...(bridge.light ? {} : { expert: ExpertView }) };

// The phone's frame: the screen (each with its own header) and the tabs at the bottom.
function MobileShell() {
  const route = useStore((s) => s.route);
  const View = VIEWS[route.view] ?? ChatView;
  // 3.6 (M3): a conversation (with Orbe, new or not, or directly with an agent) takes the whole screen (with its back
  // arrow); the tabs are on the list.
  const fullChat = route.view === 'chat' || route.view === 'session';
  return (
    <div className="mobile-shell flex h-full flex-col">
      <main className="theme-scene flex min-h-0 min-w-0 flex-1 flex-col">
        <Scene />
        <View key={`${route.view}:${route.id ?? ''}:${route.project ?? ''}`} route={route} />
      </main>
      {fullChat ? null : <MobileTabs />}
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
        <View key={`${route.view}:${route.id ?? ''}:${route.project ?? ''}`} route={route} />
      </main>
      {/* 3.6 (M3): the info pane on the right (a chat, a project). */}
      <OrbInfoHost />
      {/* The floating robot only where there is room for it: never over forms or conversations (it covered the switches of
          Ajustes and took their clicks), and those views leave room at the bottom so nothing stays under it. */}
      {/* 3.5: a browser linked with an Orb gets the PC's layout, not what only the PC itself does. */}
      {bridge.mobile ? null : <><UpdateCard /><SettingsDialog /><GamesDialog /><RecoveryNotice /></>}
      <Notices />
      {bridge.mobile ? null : <ActionShortcuts project={shortcutProject} />}
      <div className="hidden md:contents"><Companion name={app.config.assistantName} base={mood} hidden={app.config.ui?.companion === false || !COMPANION_VIEWS.has(route.view) || bridge.mobile || Boolean(tour)} /></div>
      {tour ? <Tour key={tour.key} /> : null}
    </div>
  );
}

function Root() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const locked = useStore((s) => s.locked);
  const [phase, setPhase] = useState('loading'); // loading | setup | app | error
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      const info = await bridge.info();
      setState({ info });
      if (info.needsSetup) return alive && setPhase('setup');
      if (info.needsPairing) return alive && setPhase('pair');
      // 3.6: this app is older than what the Orb asks for (protocol of the link): update first.
      if (info.needsUpdate) return alive && setPhase('update');
      // The engine may still be starting: retry for a few seconds.
      for (let i = 0; i < 40 && alive; i++) {
        try {
          await refresh();
          try {
            const saved = JSON.parse(localStorage.getItem('orb.route') || 'null');
            const exists = saved?.view === 'session' ? getState().sessions.some((s) => s.id === saved.id) : saved?.view === 'chat' && saved.id != null ? getState().conversations.some((c) => c.id === saved.id) : true;
            if (saved?.view && VIEWS[saved.view] && exists) setState({ route: saved });
            // 3.6 (M3): the phone opens on the Orb zone's chat list (or where it was left).
            else if (phoneLayout()) setState({ route: { view: 'chats' } });
          } catch { /* default */ }
          loadOrbInbox(); // 3.6 (M3): the unread badges
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
  // 3.5, the Android app: something shared from another app («Compartir con Orb») opens the chat, which takes it.
  useEffect(() => {
    if (phase !== 'app' || !bridge.takeShared) return undefined;
    const open = () => { if (getState().route?.view !== 'chat') go({ view: 'chat' }); };
    if (bridge.hasShared?.()) open();
    window.addEventListener('orb:shared', open);
    return () => window.removeEventListener('orb:shared', open);
  }, [phase]);
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
      if (event === 'inbox:changed') loadOrbInboxSoon(120);
      // 3.6 (M3): the chat list follows what its conversations do (a new line comes with inbox:changed).
      if (event === 'chat:state' && !payload?.partial) loadOrbInboxSoon(400);
      // 3.6 «Personas»: someone else at this PC, the window locked or unlocked, the people changed.
      if (event === 'persons:switched') personSwitched();
      if (event === 'persons:locked') setState((st) => ({ locked: st.locked || { locked: true } })); // keeps «Cambiar de usuario»
      if (event === 'persons:unlocked' && getState().locked) refresh().then(() => { if (getState().app?.config) setState({ locked: false }); }).catch(() => {});
      if (event === 'engine:stopped') notify({ body: tNow('app.engineStopped'), tone: 'error' });
      if (event === 'engine:restarted') { notify({ body: tNow('app.engineRestarted'), tone: 'warning' }); refreshSoon(); }
    });
  }, [phase]);
  if (phase === 'setup') return <>{strip}<Setup onDone={async () => { await refresh(); setPhase('app'); }} /></>;
  if (phase === 'pair' && bridge.link) return <>{strip}<AppLink /></>;
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
  if (phase === 'update') return <>{strip}<UpdateNeeded info={getState().info} /></>;
  if (phase === 'app' && locked) return <LockScreen />;
  if (phase === 'error') return <div className="grid h-full place-items-center p-8 text-center">{strip}<div><Robot size={90} mood="worried" /><h1 className="mt-4 text-xl">{t('app.errorTitle')}</h1><p className="text-muted-foreground mt-1 max-w-md text-sm">{error}</p></div></div>;
  if (phase !== 'app' || !ready) return <div className="grid h-full place-items-center">{strip}<Robot size={80} mood="thinking" /></div>;
  // 3.6 (M4): a tapped notification opens its chat once the phone is unlocked (lib/notes.js).
  return bridge.mobile ? <PhoneLock><NoteOpener /><Shell /></PhoneLock> : <Shell />;
}

// 3.5, the Android app: link it with an Orb by scanning its QR (Ajustes › Móvil), or by hand when the camera cannot.
function AppLink() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(getState().info?.pairError ?? '');
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ text: '', code: '', address: '' });
  const run = async (get) => {
    setBusy(true); setError('');
    try { const input = await get(); if (input == null) return; await bridge.link(input); location.reload(); }
    catch (e) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  const field = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  return (
    <div className="brand-sky grid h-full place-items-center overflow-y-auto p-6 text-center" data-testid="app-link">
      <div className="bg-card/95 grid w-full max-w-sm gap-3 rounded-3xl p-7 shadow-2xl">
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
      <ImagePreviewHost />
      <WindowControls />
      <ThemedToaster />
    </TooltipProvider>
  </StrictMode>
);
