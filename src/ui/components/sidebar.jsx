import { useEffect, useState } from 'react';
import { Bot, BookOpen, Bug, ChevronUp, ChevronDown, Settings, GraduationCap, Music, Pause, SkipForward, LoaderCircle } from 'lucide-react';
import { Robot } from './robot.jsx';
import { ThemeToggle, SidebarToggle } from './theme-toggle.jsx';
import { useStore, go, bridge, openSettings, anyChatBusy } from '@/lib/store.js';
import { Tip, BubbleTip } from './ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { PRODUCT } from '../../core/product.mjs';
import { BrowserSettingsMenu } from './browser-settings-menu.jsx';
import { OrbInbox } from '@/views/orb/inbox.jsx';
import { available as musicAvailable, musicState, subscribe as onMusic, toggleMusic, skipTrack } from '@/lib/music.js';
import { trackOf } from '../../core/music.mjs';

// The assistant's wordmark ORB·E, drawn its own way in each theme (app.css .wordmark): spaced capitals with a dot of the
// theme's colour in Orb, a techno one underlined in Vaporwave…
function Wordmark() {
  return (
    <div className="wordmark" role="img" aria-label={PRODUCT.assistant} data-testid="wordmark">
      <span className="wordmark-orb" aria-hidden="true">ORB</span><span className="wordmark-dot" aria-hidden="true" /><span className="wordmark-e" aria-hidden="true">E</span>
    </div>
  );
}

export function NavItem({ icon: Icon, iconEl, label, active, onClick, children, testid }) {
  return (
    <button data-testid={testid} onClick={onClick} className={cn('group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] transition-colors', active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground')}>
      {iconEl ?? (Icon ? <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </button>
  );
}

// 2.6: the sidebar's width, dragged from its edge (a double click goes back to the usual one), remembered in this window.
const SIDEBAR_DEFAULT = 256; const SIDEBAR_MIN = 216; const SIDEBAR_MAX = 440; const WIDTH_KEY = 'orb.anchoMenu';
function useSidebarWidth() {
  const [width, setRaw] = useState(() => { try { const n = Number(localStorage.getItem(WIDTH_KEY)); return n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT; } catch { return SIDEBAR_DEFAULT; } });
  const clamp = (n) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)));
  const remember = (w) => { try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* storage unavailable */ } };
  const setWidth = (n) => { const w = clamp(n); setRaw(w); remember(w); };
  // While dragging only the width changes (it is saved once, on release); the pointer is captured by the edge, so a
  // release outside the window or a cancelled drag still ends it.
  const startResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget; const x0 = e.clientX; const w0 = handle.parentElement.getBoundingClientRect().width; let last = w0;
    try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    handle.setAttribute('data-dragging', ''); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const move = (ev) => { last = clamp(w0 + ev.clientX - x0); setRaw(last); };
    const end = () => {
      handle.removeAttribute('data-dragging'); document.body.style.cursor = ''; document.body.style.userSelect = '';
      for (const [n, f] of [['pointermove', move], ['pointerup', end], ['pointercancel', end], ['lostpointercapture', end]]) handle.removeEventListener(n, f);
      remember(last);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
  };
  return { width, setWidth, startResize };
}

// What is unfolded (3.2: the foot of the sidebar), remembered in this window.
function useRemembered(key, initial) {
  const [open, setOpen] = useState(() => { try { return { ...initial, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return initial; } });
  const set = (name, value) => setOpen((o) => { const next = { ...o, [name]: value }; try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });
  return [open, set];
}

// 3.2: the foot of the sidebar. Folded (by default) only the icons, each with its bubble, and on the right the bug to send
// feedback with Orb's version; unfolded, the list with names. The little arrow on the line above unfolds and folds it.
function SidebarFooter({ version, is, settingsOpen, open, onOpen }) {
  const t = useT();
  const memories = is('logs') || is('activity');
  // 3.6: the same slots and icons on the PC and in a linked browser (Ajustes, Agentes, Memorias, Tutoriales); what a
  // browser does not have is left out (Agentes, the bug), never swapped for other icons. Its gear opens this device.
  const items = [
    { icon: Settings, label: t('nav.settings'), active: settingsOpen || is('phone'), onClick: () => openSettings(), testid: 'nav-settings' },
    ...(bridge.mobile ? [] : [{ icon: Bot, label: t('nav.agents'), active: is('agents'), onClick: () => go('agents'), testid: 'nav-agents' }]),
    { icon: BookOpen, label: t('nav.memories'), hint: t('nav.memoriesHint'), active: memories, onClick: () => go('logs'), testid: 'nav-memories' },
    // 2.6: how the app works, the FAQ and the button that replays the guided tour.
    { icon: GraduationCap, label: t('nav.tutorials'), active: is('tutorials'), onClick: () => go('tutorials'), testid: 'nav-tutorials' }
  ];
  const toggle = open ? t('nav.footerFold') : t('nav.footerUnfold');
  // A linked browser's gear opens this device's settings (browser-settings-menu.jsx).
  const row = (i) => (i.testid === 'nav-settings' && bridge.mobile ? <BrowserSettingsMenu key={i.testid} list={open} active={i.active} /> : null);
  return (
    <div className="side-foot relative border-t px-3 pt-2.5 pb-2" data-testid="sidebar-footer" data-open={open}>
      <Tip label={toggle}>
        <button type="button" className="side-foot-toggle" onClick={() => onOpen(!open)} aria-label={toggle} aria-expanded={open} data-testid="sidebar-footer-toggle">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
      </Tip>
      {open ? <div className="mb-1 flex flex-col gap-0.5">{items.map((i) => row(i) ?? <NavItem key={i.testid} icon={i.icon} label={i.label} active={i.active} onClick={i.onClick} testid={i.testid} />)}</div> : null}
      <div className="flex items-center gap-0.5">
        {/* 3.8.2: the first icon sits at the window's left edge: its bubble starts at the icon instead of being cut there. */}
        {open ? null : items.map((i, n) => row(i) ?? (
          <BubbleTip key={i.testid} title={i.label} text={i.hint} side="top" align={n === 0 ? 'start' : 'center'}>
            <button type="button" onClick={i.onClick} aria-label={i.label} data-testid={i.testid} className={cn('side-foot-icon', i.active && 'is-active')}><i.icon className="size-4" /></button>
          </BubbleTip>
        ))}
        <span className="flex-1" />
        {musicAvailable() ? <MusicButtons /> : null}
        {/* The bug: straight to «Enviar comentarios» (Ajustes › Acerca de), with the version next to it. */}
        {bridge.mobile ? null : (
          <BubbleTip title={t('nav.feedback')} side="top">
            <button type="button" onClick={() => openSettings('contribuye')} aria-label={t('nav.feedback')} data-testid="nav-feedback" className="side-foot-icon"><Bug className="size-4" /></button>
          </BubbleTip>
        )}
        {version ? <span className="side-foot-version" data-testid="app-version">v{version}</span> : null}
      </div>
    </div>
  );
}

// 3.8.2: the background music (Windows only, lib/music.js): play / pause, and the next track while it plays.
function MusicButtons() {
  const t = useT();
  const [s, setS] = useState(musicState);
  useEffect(() => onMusic(setS), []);
  const now = trackOf(s.track);
  const text = s.error ? t('nav.musicError') : s.loading ? t('nav.musicLoading') : s.playing && now ? t('nav.musicNow', { title: now.title, author: now.author }) : t('nav.musicHint');
  return (
    <>
      {s.playing ? (
        <BubbleTip title={t('nav.musicNext')} side="top">
          <button type="button" onClick={skipTrack} aria-label={t('nav.musicNext')} data-testid="nav-music-next" className="side-foot-icon"><SkipForward className="size-4" /></button>
        </BubbleTip>
      ) : null}
      <BubbleTip title={t('nav.music')} text={text} side="top">
        <button type="button" onClick={toggleMusic} aria-label={s.playing || s.loading ? t('nav.musicPause') : t('nav.musicPlay')} aria-pressed={s.playing} data-testid="nav-music" data-music-button=""
          className={cn('side-foot-icon', s.playing && 'is-active')}>{s.loading ? <LoaderCircle className="size-4 animate-spin" /> : s.playing ? <Pause className="size-4" /> : <Music className="size-4" />}</button>
      </BubbleTip>
    </>
  );
}

export function Sidebar({ mood }) {
  const t = useT();
  const app = useStore((s) => s.app);
  const chatBusy = useStore(anyChatBusy);
  const route = useStore((s) => s.route);
  const conversations = useStore((s) => s.conversations) ?? [];
  const settingsOpen = useStore((s) => Boolean(s.settings));
  // 3.8.1 (H4e): while an agent works on a task the robot floats (its face stays as the conversations say).
  const working = useStore((s) => s.tasks.some((x) => x.status === 'running'));
  const name = app.config.assistantName;
  const [sections, setSection] = useRemembered('orb.secciones', { footer: false });
  const { width, setWidth, startResize } = useSidebarWidth();
  const is = (view) => route.view === view;
  return (
    // 3.6 (M3): the chat list of a messaging app, with the places' labels under the search: at least 340 px.
    <aside className="bg-sidebar relative flex h-full shrink-0 flex-col border-r" style={{ width: Math.max(width, 340) }}>
      {bridge.mobile ? null : <div className="sidebar-resize" role="separator" aria-orientation="vertical" aria-label={t('comp.sidebar.resize')} onPointerDown={startResize} onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)} data-testid="sidebar-resize" />}
      <div className="theme-band side-band app-titlebar flex h-14 shrink-0 items-center gap-2 border-b px-4">
        {/* 3.0: the robot goes back to the conversation in progress (3.2: the last one opened). */}
        <Tip label={t('nav.backToChat', { name })} side="bottom" align="start">
          <button type="button" className="no-drag relative shrink-0 cursor-pointer rounded-full" onClick={() => go(lastChat(route, conversations))} aria-label={t('nav.backToChat', { name })} data-testid="sidebar-home">
            <Robot size={34} mood={mood} title={name} live active={working} />
            {chatBusy ? <span className="bg-primary absolute right-0 bottom-0 size-2 animate-pulse rounded-full" /> : null}
          </button>
        </Tip>
        {/* 2.6: with the default name, the drawn wordmark (Orb·E); a name of one's own, as it is written. */}
        <div className="flex min-w-0 flex-1 items-center">{name === PRODUCT.assistant ? <Wordmark /> : <div className="truncate text-[15px] font-medium">{name}</div>}</div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ThemeToggle />
          <SidebarToggle />
        </div>
      </div>
      {/* 3.6 (M3): the chat list of a messaging app (views/orb/inbox.jsx). */}
      <div className="flex min-h-0 flex-1 flex-col pt-2"><OrbInbox /></div>
      <SidebarFooter version={app.version} is={is} settingsOpen={settingsOpen} open={sections.footer === true} onOpen={(v) => setSection('footer', v)} />
    </aside>
  );
}

// 3.2: the robot of the sidebar goes back to the conversation on screen, or the latest one still open (or a new one).
function lastChat(route, conversations) {
  if (route.view === 'chat') return route;
  const open = conversations.find((c) => c.status === 'open');
  return open ? { view: 'chat', id: open.id } : { view: 'chat' };
}
