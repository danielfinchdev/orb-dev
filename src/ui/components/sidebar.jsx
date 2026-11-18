import { useEffect, useState } from 'react';
import { Orbit, NotebookPen, MessageSquareWarning, Settings, LifeBuoy, Headphones, SkipForward, LoaderCircle } from 'lucide-react';
import { Robot } from './robot.jsx';
import { ThemeToggle, SidebarToggle } from './theme-toggle.jsx';
import { useStore, go, bridge, openSettings, anyChatBusy } from '@/lib/store.js';
import { Tip, BubbleTip, PopoverTrigger } from './ui/overlay.jsx';
import { MusicPlayer } from './music-player.jsx';
import { FeedbackPop } from './feedback-pop.jsx';
import { NavRow, IconButton } from '@/components/ui/primitives.jsx';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { PRODUCT } from '../../shared/product.mjs';
import { BrowserSettingsMenu } from './browser-settings-menu.jsx';
import { OrbInbox } from '@/views/orb/inbox.jsx';
import { available as musicAvailable, musicState, subscribe as onMusic, skipTheme, setMusicTheme } from '@/lib/music.js';
import { musicPrefs, nextTheme } from '../../shared/music.mjs';

// The assistant's wordmark ORB·E, drawn its own way in each theme (app.css .wordmark): spaced capitals with a dot of the
// theme's colour in Orb, a techno one underlined in Vaporwave…
function Wordmark() {
  return (
    <div className="wordmark" role="img" aria-label={PRODUCT.assistant} data-testid="wordmark">
      <span className="wordmark-orb" aria-hidden="true">ORB</span><span className="wordmark-dot" aria-hidden="true" /><span className="wordmark-e" aria-hidden="true">E</span>
    </div>
  );
}

// A place in the menu (components/ui/primitives.jsx › NavRow).
export const NavItem = NavRow;

// the sidebar's width, dragged from its edge (a double click goes back to the usual one), remembered in this window.
const SIDEBAR_DEFAULT = 340; const SIDEBAR_MIN = 340; const SIDEBAR_MAX = 480; const WIDTH_KEY = 'orb.anchoMenu';
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

// the foot of the sidebar: only icons, each with its bubble (its name and what it holds); on the right the music, the bug
// to send feedback and Orb's version.
function SidebarFooter({ version, is, settingsOpen }) {
  const t = useT();
  const memories = is('logs') || is('activity') || is('rules');
  // the same slots and icons on the PC and in a linked browser (Ajustes, Agentes, Bitácoras, Tutoriales); what a
  // browser does not have is left out (Agentes, the bug), never swapped for other icons. Its gear opens this device.
  const items = [
    { icon: Settings, label: t('nav.settings'), active: settingsOpen || is('phone'), onClick: () => openSettings(), testid: 'nav-settings' },
    ...(bridge.mobile ? [] : [{ icon: Orbit, label: t('nav.agents'), active: is('agents'), onClick: () => go('agents'), testid: 'nav-agents' }]),
    { icon: NotebookPen, label: t('nav.logbooks'), hint: t('nav.logbooksHint'), active: memories, onClick: () => go('logs'), testid: 'nav-memories' },
    // how the app works, the FAQ and the button that replays the guided tour.
    { icon: LifeBuoy, label: t('nav.tutorials'), active: is('tutorials'), onClick: () => go('tutorials'), testid: 'nav-tutorials' }
  ];
  return (
    <div className="side-foot border-border relative flex items-center gap-1 border-t px-2.5 py-2" data-testid="sidebar-footer">
      {/* A linked browser's gear opens this device's settings (browser-settings-menu.jsx). */}
      {items.map((i, n) => (i.testid === 'nav-settings' && bridge.mobile ? <BrowserSettingsMenu key={i.testid} active={i.active} /> : (
        // the first icon sits at the window's left edge: its bubble starts at the icon instead of being cut there.
        <BubbleTip key={i.testid} title={i.label} text={i.hint} side="top" align={n === 0 ? 'start' : 'center'}>
          <button type="button" onClick={i.onClick} aria-label={i.hint ? `${i.label}: ${i.hint}` : i.label} aria-current={i.active ? 'page' : undefined} data-testid={i.testid} className="side-foot-icon"><i.icon className="size-5" /></button>
        </BubbleTip>
      )))}
      <span className="flex-1" />
      {musicAvailable() ? <MusicButtons /> : null}
      {/* The bug: «Enviar comentarios» opens over the foot (the same form is in Ajustes › Acerca de), with the version next to it. */}
      {bridge.mobile ? null : (
        <FeedbackPop>
          <BubbleTip title={t('nav.feedback')} side="top">
            <PopoverTrigger asChild>
              <button type="button" aria-label={t('nav.feedback')} data-testid="nav-feedback" className="side-foot-icon"><MessageSquareWarning className="size-5" /></button>
            </PopoverTrigger>
          </BubbleTip>
        </FeedbackPop>
      )}
      {version ? <span className="side-foot-version" data-testid="app-version">v{version}</span> : null}
    </div>
  );
}

// the background music (Windows only, lib/music.js): the headphones open the player (components/music-player.jsx) over the
// foot; they show whether it plays. Their bubble says what plays, or what a click on Play would start.
function MusicButtons() {
  const t = useT();
  const [s, setS] = useState(musicState);
  // the engine also reports how far the music has risen, several times a second: the foot only needs what it draws
  useEffect(() => onMusic((n) => setS((o) => (o.playing === n.playing && o.loading === n.loading && o.error === n.error && o.theme === n.theme ? o : n))), []);
  const theme = useStore((st) => musicPrefs(st.app?.config?.ui).theme);
  const text = s.error ? t('nav.musicErrorAdaptive') : s.playing ? t('nav.musicNowAdaptive', { theme: t(`nav.musicTheme.${s.theme}`) }) : t('nav.musicHintAdaptive');
  const next = t('nav.musicNextTheme');
  // While it plays the engine moves on by itself; before, the arrow only chooses the style the next play starts with.
  const skip = () => (s.playing ? skipTheme() : setMusicTheme(nextTheme(theme)));
  return (
    <MusicPlayer next={<IconButton label={next} onClick={skip} data-testid="nav-music-next"><SkipForward className="size-4" /></IconButton>}>
      <BubbleTip title={t('nav.music')} text={text} side="top">
        <PopoverTrigger asChild>
          <button type="button" aria-label={t('nav.music')} aria-pressed={s.playing} data-testid="nav-music" data-music-button=""
            className={cn('side-foot-icon', s.playing && 'is-active')}>{s.loading ? <LoaderCircle className="size-5 animate-spin" /> : <Headphones className="size-5" />}</button>
        </PopoverTrigger>
      </BubbleTip>
    </MusicPlayer>
  );
}

export function Sidebar({ mood }) {
  const t = useT();
  const app = useStore((s) => s.app);
  const chatBusy = useStore(anyChatBusy);
  const route = useStore((s) => s.route);
  const conversations = useStore((s) => s.conversations) ?? [];
  const settingsOpen = useStore((s) => Boolean(s.settings));
  // while an agent works on a task the robot floats (its face stays as the conversations say).
  const working = useStore((s) => s.tasks.some((x) => x.status === 'running'));
  const name = app.config.assistantName;
  const { width, setWidth, startResize } = useSidebarWidth();
  const is = (view) => route.view === view;
  return (
    // the chat list of a messaging app, with the places' labels under the search: at least 340 px.
    <aside className="bg-sidebar relative flex h-full shrink-0 flex-col border-r" style={{ width }} data-testid="sidebar">
      {bridge.mobile ? null : <div className="sidebar-resize" role="separator" aria-orientation="vertical" aria-label={t('comp.sidebar.resize')} onPointerDown={startResize} onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)} data-testid="sidebar-resize" />}
      <div className="theme-band side-band app-titlebar flex h-14 shrink-0 items-center gap-1 pr-2.5 pl-4">
        {/* the brand goes back to the conversation in progress (the last one opened). Only the Orb theme has the robot's
            head next to the wordmark; every other theme shows the wordmark alone, in the same place. */}
        <Tip label={t('nav.backToChat', { name })} side="bottom" align="start">
          <button type="button" className="side-brand no-drag flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-ctl px-0.5 py-1 text-left" onClick={() => go(lastChat(route, conversations))} aria-label={t('nav.backToChat', { name })} data-testid="sidebar-home">
            <Robot size={34} head mood={mood} title={name} live active={working} />
            {/* with the default name, the drawn wordmark (Orb·E); a name of one's own, as it is written. */}
            <span className="flex min-w-0 items-center">{name === PRODUCT.assistant ? <Wordmark /> : <span className="truncate text-[15px] font-semibold">{name}</span>}</span>
            {chatBusy ? <span className="bg-primary-text size-1.5 shrink-0 animate-pulse rounded-full" aria-hidden="true" /> : null}
          </button>
        </Tip>
        <ThemeToggle />
        <SidebarToggle />
      </div>
      {/* the chat list of a messaging app (views/orb/inbox.jsx). */}
      <div className="flex min-h-0 flex-1 flex-col"><OrbInbox /></div>
      <SidebarFooter version={app.version} is={is} settingsOpen={settingsOpen} />
    </aside>
  );
}

// the robot of the sidebar goes back to the conversation on screen, or the latest one still open (or a new one).
function lastChat(route, conversations) {
  if (route.view === 'chat') return route;
  const open = conversations.find((c) => c.status === 'open');
  return open ? { view: 'chat', id: open.id } : { view: 'chat' };
}
