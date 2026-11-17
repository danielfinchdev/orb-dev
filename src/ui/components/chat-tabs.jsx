// Chat tabs and the split view (logic: src/shared/tabs.mjs). The frame goes around the screen of the window: on a chat it
// adds the bar of open chats on top and, with the split on, shows two chats side by side. On any other screen, or with the
// setting off, it draws the screen as it always was. The chat on screen is always the one of the pane that has the focus,
// so the sidebar, the info pane and every shortcut keep talking about «the chat I am in».
import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, LoaderCircle, MessageSquare, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { IconButton } from '@/components/ui/primitives.jsx';
import { BubbleTip } from '@/components/ui/overlay.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { WindowControlsSlot } from '@/components/window-controls.jsx';
import { cn } from '@/lib/utils.js';
import { t as t0, useT } from '@/lib/i18n.js';
import { useStore, getState, go, phoneLayout, newChat } from '@/lib/store.js';
import { useShortcut } from '@/lib/keys.js';
import { actTabs, pruneTabs, tabsState, useTabs } from '@/lib/tabs.js';
import { useOrbItems } from '@/views/orb/inbox.jsx';
import * as T from '../../shared/tabs.mjs';

// Below this width two chats do not fit: the split stays saved, but only the pane with the focus is shown.
const SPLIT_MIN_WIDTH = 900;

const itemKey = (tab) => (tab.startsWith('session:') ? tab : `conversation:${tab.slice(5)}`);

// A click with Ctrl (or ⌘) on a chat of the list opens it in a tab of its own: this only notes it, the click goes on.
let ctrlAt = 0;
if (typeof window !== 'undefined') window.addEventListener('click', (e) => { if (e.ctrlKey || e.metaKey) ctrlAt = Date.now(); }, true);
const ctrlRecent = () => Date.now() - ctrlAt < 600;

// The state the window shows for this route: the chat of the route is in a tab (and in the focused pane).
function syncedWith(state, key, mode) {
  if (!key) return state;
  const shown = state.split && state.focus === 'right' ? state.right : state.active;
  if (state.tabs.includes(key) && shown === key) return state;
  return T.openTab(state, key, { mode });
}

const goKey = (key) => { const r = T.routeOfKey(key); if (r) go(r); };
const focused = (s) => (s.split && s.focus === 'right' ? s.right : s.active);

// What a tab says about its chat: working (the spinner), waiting for you or unread (a dot).
function Dot({ item, t }) {
  const kind = !item ? null : item.asks || item.asking ? 'needs' : item.busy ? 'working' : item.unread > 0 ? 'unread' : null;
  if (!kind) return null;
  if (kind === 'working') return <LoaderCircle className="otab-spin size-3.5 shrink-0 animate-spin motion-reduce:animate-none" role="img" aria-label={t('tabs.state.working')} />;
  return <span className={cn('size-2 shrink-0 rounded-full', kind === 'needs' ? 'bg-warning' : 'bg-primary-text')} role="img" aria-label={t(`tabs.state.${kind}`)} />;
}

function TabBar({ state, canSplit, narrow }) {
  const t = useT();
  const items = useOrbItems();
  const byKey = useMemo(() => new Map(items.map((x) => [x.key, x])), [items]);
  const list = useRef(null);
  const titleOf = (tab) => (tab === 'chat:new' ? t('tabs.untitled') : byKey.get(itemKey(tab))?.title || `#${tab.split(':')[1]}`);
  const select = (tab) => { actTabs((s) => T.activate(s, tab)); goKey(focused(tabsState())); };
  const close = (tab) => {
    actTabs((s) => T.closeTab(s, tab));
    const s = tabsState();
    if (s.tabs.length) goKey(focused(s));
  };
  const onKey = (e, tab) => {
    const at = state.tabs.indexOf(tab);
    const move = (to) => { e.preventDefault(); const next = state.tabs[(to + state.tabs.length) % state.tabs.length]; select(next); list.current?.querySelector(`[data-tab="${next}"]`)?.focus(); };
    if (e.key === 'ArrowRight') move(at + 1);
    else if (e.key === 'ArrowLeft') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(state.tabs.length - 1);
    else if (e.key === 'Delete') { e.preventDefault(); close(tab); }
  };
  const shown = new Set([state.active, state.split ? state.right : null]);
  const splitTip = state.split ? t('tabs.unsplit') : state.tabs.length < 2 ? t('tabs.splitNeeds') : !canSplit ? t('tabs.splitNarrow') : t('tabs.split');
  return (
    // One 56 px strip over the chat and its panel, so both headers keep the same line; the window's buttons live here.
    <div className="tabs-strip theme-band app-titlebar" data-testid="chat-tabs">
      <div ref={list} role="tablist" aria-label={t('tabs.label')} className="tabs-list">
        {state.tabs.map((tab) => {
          const on = tab === focused(state);
          const title = titleOf(tab);
          const item = byKey.get(itemKey(tab));
          return (
            <div key={tab} className="otab" data-on={on} data-shown={shown.has(tab)}>
              <button type="button" role="tab" data-tab={tab} aria-selected={on} tabIndex={on ? 0 : -1} title={title} onClick={() => select(tab)} onKeyDown={(e) => onKey(e, tab)} className="otab-main">
                {item?.agent ? <AgentIcon agent={item.agent} /> : null}
                <span className="otab-title">{title}</span>
                <Dot item={item} t={t} />
              </button>
              <IconButton small tabIndex={-1} label={t('tabs.close', { title })} onClick={() => close(tab)} className="otab-x"><X /></IconButton>
            </div>
          );
        })}
        <BubbleTip title={t('tabs.new')}>
          <IconButton label={t('tabs.new')} onClick={() => { actTabs((s) => T.openTab(s, 'chat:new', { mode: 'new' })); go({ view: 'chat' }); }}><Plus /></IconButton>
        </BubbleTip>
      </div>
      <BubbleTip title={splitTip}>
        <Button type="button" variant="ghost" aria-pressed={state.split} aria-disabled={!state.split && (state.tabs.length < 2 || !canSplit)} aria-label={narrow ? splitTip : undefined}
          onClick={() => { if (state.split || (state.tabs.length >= 2 && canSplit)) { actTabs(T.toggleSplit); goKey(focused(tabsState())); } }}
          className={cn('shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-45', state.split && 'bg-accent text-foreground')}>
          <Columns2 className="size-3.5" />{narrow ? null : <span>{state.split ? t('tabs.unsplit') : t('tabs.split')}</span>}
        </Button>
      </BubbleTip>
      <WindowControlsSlot />
    </div>
  );
}

function Divider({ ratio, onChange, boxRef }) {
  const t = useT();
  const drag = (e) => {
    e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId);
    const box = boxRef.current?.getBoundingClientRect(); if (!box) return;
    const move = (m) => onChange(((m.clientX - box.left) / box.width) * 100);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const key = (e) => { const d = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : 0; if (d) { e.preventDefault(); onChange(ratio + d); } else if (e.key === 'Home') onChange(T.MIN_RATIO); else if (e.key === 'End') onChange(T.MAX_RATIO); };
  return <div role="separator" aria-orientation="vertical" aria-label={t('tabs.divider')} aria-valuenow={ratio} aria-valuemin={T.MIN_RATIO} aria-valuemax={T.MAX_RATIO} tabIndex={0} onPointerDown={drag} onKeyDown={key}
    className="hover:bg-primary-text/40 focus-visible:bg-primary-text/60 bg-border w-1.5 shrink-0 cursor-col-resize touch-none outline-none" data-testid="split-divider" />;
}

function Empty({ onNew }) {
  const t = useT();
  const items = useOrbItems();
  const recent = useMemo(() => [...items].filter((x) => !x.done).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 3), [items]);
  const open = (x) => { actTabs((s) => T.openTab(s, x.kind === 'session' ? `session:${x.id}` : `chat:${x.id}`, { mode: 'new' })); go(x.kind === 'session' ? { view: 'session', id: x.id } : { view: 'chat', id: x.id }); };
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center" data-testid="tabs-empty">
      <MessageSquare className="text-muted-foreground size-10" aria-hidden="true" />
      <h2 className="text-card-title font-medium">{t('tabs.empty.title')}</h2>
      <p className="text-muted-foreground max-w-sm text-control">{t('tabs.empty.hint')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={onNew} autoFocus>{t('tabs.empty.new')}</Button>
        {recent.map((x) => <Button key={x.key} size="sm" variant="outline" onClick={() => open(x)} className="max-w-48" title={`${t('tabs.empty.recent')}: ${x.title}`}><span className="truncate">{x.title}</span></Button>)}
      </div>
    </div>
  );
}

// render(route): the screen for a route (the window's error boundary and loading around the view).
export function ChatTabs({ route, render }) {
  const state = useTabs();
  const enabled = useStore((s) => !phoneLayout() && s.app?.config?.ui?.tabs !== false);
  const conversations = useStore((s) => s.conversations);
  const sessions = useStore((s) => s.sessions);
  const key = enabled ? T.keyOfRoute(route) : null;
  const mode = useRef('replace');
  const [empty, setEmpty] = useState(false);
  const box = useRef(null);
  const [width, setWidth] = useState(1200);
  const canSplit = width >= SPLIT_MIN_WIDTH;

  // the route says which chat is on screen: it goes into the tabs (in a new one with Ctrl+click on the list)
  if (key && !state.tabs.includes(key)) mode.current = ctrlRecent() ? 'new' : 'replace';
  const eff = empty ? state : syncedWith(state, key, mode.current);
  useEffect(() => { if (key) { setEmpty(false); if (eff !== tabsState()) actTabs((s) => syncedWith(s, key, mode.current)); } }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // chats that were deleted leave the tabs
  useEffect(() => {
    if (!enabled || !getState().app || !Array.isArray(conversations) || !Array.isArray(sessions) || (!conversations.length && !sessions.length)) return;
    const have = new Set([...conversations.map((c) => `chat:${c.id}`), ...sessions.filter((x) => x.kind === 'chat').map((x) => `session:${x.id}`)]);
    pruneTabs((k) => have.has(k));
  }, [enabled, conversations, sessions]);
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  });

  const fresh = () => { setEmpty(false); actTabs((s) => T.openTab(s, 'chat:new', { mode: 'new' })); newChat(); };
  useShortcut('tabs.new', (e) => { if (!enabled) return; e.preventDefault(); fresh(); }, { capture: true });
  useShortcut('tabs.close', (e) => {
    const k = focused(tabsState()); if (!enabled || !k) return;
    e.preventDefault(); actTabs((s) => T.closeTab(s, k));
    const s = tabsState(); if (s.tabs.length) goKey(focused(s)); else setEmpty(true);
  }, { capture: true });
  const step = (dir) => (e) => { if (!enabled) return; e.preventDefault(); actTabs((s) => T.cycle(s, dir)); goKey(focused(tabsState())); };
  useShortcut('tabs.next', step(1), { capture: true });
  useShortcut('tabs.prev', step(-1), { capture: true });
  useShortcut('tabs.split', (e) => { if (!enabled) return; e.preventDefault(); if (eff.split || (eff.tabs.length >= 2 && canSplit)) { actTabs(T.toggleSplit); goKey(focused(tabsState())); } }, { capture: true });
  useShortcut('tabs.focusOther', (e) => { if (!enabled || !eff.split) return; e.preventDefault(); actTabs(T.focusOther); goKey(focused(tabsState())); }, { capture: true });

  if (!enabled || !key) return render(route);
  const lonely = eff.tabs.length < 2 && !eff.split;
  if (empty && !eff.tabs.length) return <div className="flex min-h-0 flex-1 flex-col" ref={box}><Empty onNew={fresh} /></div>;
  const left = T.routeOfKey(eff.active) ?? route;
  const right = eff.split && canSplit ? T.routeOfKey(eff.right) : null;
  const pick = (side) => { if (!eff.split || eff.focus === side) return; actTabs(T.focusOther); goKey(focused(tabsState())); };
  const pane = (side, r, label) => (
    <section key={side} data-testid={`pane-${side}`} aria-label={label || undefined} onMouseDownCapture={() => pick(side)} onFocusCapture={() => pick(side)}
      className={cn('flex min-h-0 min-w-0 flex-col', right && eff.focus === side && 'ring-ring/30 ring-1 ring-inset')}
      style={right ? { flexBasis: `${side === 'right' ? 100 - eff.ratio : eff.ratio}%`, flexGrow: 0, flexShrink: 1 } : { flex: '1 1 0%' }}>
      {render(r)}
    </section>
  );
  // with the split on but no room, the pane that has the focus stays alone
  const only = eff.split && !right ? (eff.focus === 'right' ? T.routeOfKey(eff.right) ?? route : left) : null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" ref={box}>
      {lonely ? null : <TabBar state={eff} canSplit={canSplit} narrow={width < 560} />}
      <div className="flex min-h-0 flex-1">
        {right ? <>{pane('left', left, t0('tabs.paneLeft'))}<Divider ratio={eff.ratio} boxRef={box} onChange={(v) => actTabs((s) => T.setRatio(s, v))} />{pane('right', right, t0('tabs.paneRight'))}</> : pane('left', only ?? left, '')}
      </div>
    </div>
  );
}

