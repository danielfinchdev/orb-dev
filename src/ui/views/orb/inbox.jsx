// the chat list (docs/DESIGN-SYSTEM.md › 2.5, mockup mensajeria.html ?z=orb). On the PC it is
// the left pane; on the phone the «Chats» tab. From the top: search (titles, projects, the
// messages and «#12» for a task) with its filter, «+» (Nuevo chat, Nuevo proyecto), the zone's other places (PC: Tareas,
// Proyectos, Programadas, Pizarra, and «Más» with God mode when it is on), the pinned
// chats, then one group per project (its coloured initials, folding) with its chats. Each row: the project's icon with
// the mark of who answers in its corner (OrbAvatar), the title, the time, its latest progress (a running task,
// «Esperando tu aprobación», how its last task ended, else its last line) and the unread count. Right click or ⋯ (PC) and
// a long press (phone) open the chat's menu: info, pin, mute, mark read, complete or reopen, delete.
import { placesFit } from '@/lib/places-fit.js';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelTop, Search, Plus, X, Ellipsis, ChevronRight, Pin, PinOff, BellOff, Bell, Trash2, CheckCheck, Check, ClipboardCheck, FolderGit2, CalendarSync, Presentation, SquareTerminal, MessageSquarePlus, FolderPlus, Info, CircleCheck, Undo2, SlidersHorizontal, PencilLine, AlarmClock, AlarmClockOff, Hand, ArrowUpDown, ChevronDown, LoaderCircle, GitBranch, GitPullRequest, CircleDot } from 'lucide-react';
import { openPanel } from '@/lib/open-changes.js';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { Robot } from '@/components/robot.jsx';
import { OrbMark } from '@/components/orb-mark.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { createProjectFlow, startChatFlow } from '@/components/project-actions.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuCheckboxItem, Collapsible, CollapsibleTrigger, CollapsibleContent, Dialog, DialogContent, DialogTitle, DialogDescription, BubbleTip } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Input } from '@/components/ui/basic.jsx';
import { useSearch } from '@/lib/search.js';
import { useStore, go, call, act, newChat, orbAct, loadOrbInbox, loadOrbInboxSoon, openOrbInfo, closeOrbInfo, getState, phoneLayout, fullPc, refreshSoon, setState, robotSkin } from '@/lib/store.js';
import { orbItems, orbProgress, groupOrb, shortTime, avatarStack, snoozeTimes, priorityKeys, nextNeedingYou } from '@/lib/inbox.js';
import { useShortcut, useKeys } from '@/lib/keys.js';
import { actTabs } from '@/lib/tabs.js';
import * as T from '../../../shared/tabs.mjs';
import { DayDigestCard } from '@/components/day-digest.jsx';
import { sameItem } from '@/lib/memo.js';
import { useDay } from '@/lib/use-day.js';
import { usePress } from '@/lib/use-press.js';
import { AGENT } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { needsApproval } from '@/lib/task-approval.js';
import { TaskStatus } from '@/components/task-state.jsx';
import { stepText } from '@/components/chat-live.jsx';
import { SectionLabel, IconButton, MoreButton, SearchInput } from '@/components/ui/primitives.jsx';

// ---- data: the rows of the zone (the conversations and direct chats of the store, the marks of inbox.list)
export function useOrbInbox() {
  const inbox = useStore((s) => s.orbInbox);
  const version = useStore((s) => s.version);
  useEffect(() => { loadOrbInbox(); }, [version]);
  return inbox;
}
// A direct chat with an agent has no lines to count: opening one that was left as unread by hand reads it. Marking the
// chat that is already on screen as unread (its row's menu) leaves it so: only the first moments after the list has
// loaded count as «opening», and nothing is read while the window is hidden.
export function useReadOnOpen(id) {
  useOrbInbox();
  const loaded = useStore((s) => Boolean(s.orbInbox) && !s.orbInbox.fallback);
  const unread = useStore((s) => (id == null ? 0 : (s.orbInbox?.items ?? []).find((x) => x.key === `session:${id}`)?.unread ?? 0));
  const open = useRef({ id: null, at: null });
  if (open.current.id !== id) open.current = { id, at: null };
  if (loaded && open.current.at == null) open.current.at = Date.now();
  useEffect(() => {
    if (id == null || !unread || document.visibilityState !== 'visible') return;
    if (open.current.at == null || Date.now() - open.current.at > 2500) return;
    call('inbox.markRead', { kind: 'session', id }).then(() => loadOrbInboxSoon(0)).catch(quiet);
  }, [id, unread, loaded]);
}
export function useOrbItems() {
  const inbox = useOrbInbox();
  const conversations = useStore((s) => s.conversations);
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  // only which conversations are answering (a streamed piece does not redraw the list).
  const liveKey = useStore((s) => s.chats.filter((c) => c.busy || c.waiting).map((c) => c.conversation).join(','));
  // the newest step each answering conversation has already announced (the row shows it instead of a bare «Trabajando…»)
  const stepKey = useStore((s) => s.chats.filter((c) => c.busy && Array.isArray(c.tools) && c.tools.at(-1)?.name).map((c) => `${c.conversation}\u0001${c.tools.at(-1).name}\u0001${c.tools.at(-1).target ?? ''}`).join('\u0002'));
  const t = useT();
  const chats = useMemo(() => {
    const steps = new Map(stepKey ? stepKey.split('\u0002').map((x) => { const [id, name, target] = x.split('\u0001'); return [Number(id), stepText(t, { name, ...(target ? { target } : {}) })]; }) : []);
    return liveKey ? liveKey.split(',').map((c) => ({ conversation: Number(c), busy: true, step: steps.get(Number(c)) ?? null })) : [];
  }, [liveKey, stepKey, t]);
  const approvals = useStore((s) => s.app?.approvals);
  const completed = useStore((s) => s.app?.completed);
  return useMemo(() => orbItems({ inbox, conversations, sessions, tasks, chats, approvals, completed }).map((x) => ({ ...x, agentName: AGENT[x.agent] ?? x.agent })),
    [inbox, conversations, sessions, tasks, chats, approvals, completed]);
}
export const openOrbItem = (x) => go(x.kind === 'session' ? { view: 'session', id: x.id } : { view: 'chat', id: x.id });
const isOpen = (route, x) => (x.kind === 'session' ? route.view === 'session' : route.view === 'chat') && route.id === x.id;
const conversationRef = (x) => ({ kind: x.kind === 'session' ? 'session' : 'conversation', id: x.id });

// the chat's avatar. Big: its project's icon (its own picture or its coloured initials); without a project,
// Orbe's head. In the corner: the marks of the agents that worked in it (lib/inbox.js › agentsOf: the brain or a direct
// conversation's agent first, then its tasks' agents), stacked like avatars, the first on top; past three, two and
// «+N» (lib/inbox.js › avatarStack keeps any number inside the avatar, fewer marks on a small one). Hovering it
// lists every agent. An agent Orb no longer knows gets the neutral mark.
const STACK = 3;
export function OrbAvatar({ item, size = 40 }) {
  const t = useT();
  const locale = useLocale();
  const skin = useStore((s) => s.app?.config?.ui?.skin);
  const agents = item.agents ?? (item.agent ? [item.agent] : []);
  const { badge, marks, more, moreRight, moreFont } = avatarStack(agents.length, size, STACK);
  const shown = agents.slice(0, marks.length);
  const who = agents.length ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(agents.map((a) => AGENT[a] ?? a)) : '';
  const body = item.project
    ? <ProjectIcon name={item.project} size={size} />
    : !robotSkin(skin)
      ? <span className="grid place-items-center" style={{ width: size, height: size }}><OrbMark size={Math.round(size * 0.7)} /></span>
      : <Robot size={size} still mood={item.busy ? 'thinking' : 'idle'} />;
  return (
    <span className="relative inline-grid shrink-0" style={{ width: size, height: size }} role="img" aria-label={who ? `${item.project ?? t('orbchats.noProject')} · ${who}` : (item.project ?? t('orbchats.noProject'))} title={who || undefined} data-testid="orb-avatar">
      {body}
      {agents.length ? (
        <span className={cn('orb-avatar-badges', item.busy && 'animate-pulse')} data-badges={agents.join(' ')}>
          {shown.map((a, i) => (
            <span key={a} className="orb-avatar-badge" style={{ width: badge, height: badge, right: marks[i], zIndex: STACK - i }} data-badge={a}>
              <AgentIcon agent={a} className="size-[64%]" />
            </span>
          ))}
          {more ? <span className="orb-avatar-badge orb-avatar-more" style={{ width: badge, height: badge, right: moreRight, zIndex: 0, fontSize: moreFont }} data-badge="more" data-more={more}>+{more}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

// ---- what can be done with a chat (the same list in the PC's menu and the phone's sheet)
// tab: the PC's list also offers «Abrir en pestaña nueva» (what Ctrl+click on the row does); the chat's own ⋯ and the phone's sheet do not.
export function useOrbActions(item, { tab = false } = {}) {
  const t = useT();
  const tabsOn = useStore((s) => !phoneLayout() && s.app?.config?.ui?.tabs !== false);
  const list = actionList(item, t, tab);
  if (!tab || !tabsOn || !item) return list;
  const newTab = { id: 'newtab', icon: PanelTop, label: t('orbchats.openNewTab'), run: () => { actTabs((s) => T.openTab(s, `${item.kind === 'session' ? 'session' : 'chat'}:${item.id}`, { mode: 'new' })); openOrbItem(item); } };
  const at = list.findIndex((a) => a.danger);
  return at < 0 ? [...list, newTab] : [...list.slice(0, at), newTab, ...list.slice(at)];
}
// row: the PC row's menu, with the short labels of the mock-up («Posponer…», «Eliminar…»).
function actionList(item, t, row = false) {
  if (!item) return [];
  // a direct conversation with an agent: pinned and muted like the others; completed through the sidebar's mark.
  const rename = { id: 'rename', icon: PencilLine, label: t('orbchats.rename'), run: () => renameChat(item, t) };
  // snooze until a time (the scheduler brings it back), or back now.
  const snooze = item.snoozedUntil
    ? { id: 'unsnooze', icon: AlarmClockOff, label: t('orbchats.unsnooze'), run: () => orbAct('inbox.snooze', { ...conversationRef(item), until: null }) }
    : { id: 'snooze', icon: AlarmClock, label: row ? t('orbchats.rowSnooze') : t('orbchats.snooze'), run: () => snoozeChat(item, t) };
  const ref = conversationRef(item);
  const info = { id: 'info', icon: Info, label: row ? t('orbchats.rowInfo') : t('orbchats.info'), run: () => { openOrbItem(item); if (item.kind === 'session') openPanel(item.id, 'info'); else openOrbInfo({ type: 'chat' }); } };
  const pin = item.pinned ? { id: 'unpin', icon: PinOff, label: t('chats.unpin'), run: () => orbAct('inbox.unpin', ref) } : { id: 'pin', icon: Pin, label: row ? t('orbchats.rowPin') : t('chats.pin'), run: () => orbAct('inbox.pin', ref) };
  const mute = item.muted ? { id: 'unmute', icon: Bell, label: t('chats.unmute'), run: () => orbAct('inbox.mute', { ...ref, muted: false }) } : { id: 'mute', icon: BellOff, label: t('chats.mute'), run: () => orbAct('inbox.mute', { ...ref, muted: true }) };
  // One entry that turns into its pair: «Marcar como leído» while something is unread, else «Marcar como no leído»
  // (the row's menu always lists it: the mock-up's nine entries; the phone-sized list only offers it when it can read).
  const read = item.unread
    ? [{ id: 'read', icon: CheckCheck, label: t('chats.markRead'), run: () => orbAct('inbox.markRead', ref) }]
    : row ? [{ id: 'unread', icon: CircleDot, label: t('chats.markUnread'), run: () => orbAct('inbox.markUnread', ref) }] : [];
  const done = (method, args) => (item.done
    ? { id: 'reopen', icon: Undo2, label: t('orbchats.reopen'), run: () => act(call(method, { ...args, done: false })).then(refreshSoon) }
    : { id: 'complete', icon: CircleCheck, label: row ? t('orbchats.rowComplete') : t('orbchats.complete'), run: () => act(call(method, { ...args, done: true })).then(refreshSoon) });
  const remove = { id: 'delete', icon: Trash2, label: row ? t('orbchats.rowDelete') : t('orbchats.delete'), danger: true, run: () => (item.kind === 'session' ? deleteSessionChat(item, t) : deleteChat(item, t)) };
  if (item.kind === 'session') return [info, rename, pin, snooze, mute, ...read, done('sidebar.complete', { key: `s${item.id}` }), remove];
  return [info, rename, pin, snooze, mute, ...read, done('conversations.update', { id: item.id }), remove];
}
// «Renombrar» from the list's ⋯ (and the chat's own ⋯): the same title a chat or an agent's conversation already has.
export function renameChat(item, t) {
  const method = item.kind === 'session' ? 'sessions.update' : 'conversations.update';
  return form(t('chat.renameTitle'), {
    initial: { title: item.title ?? '' },
    body: (v, set) => <Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} data-testid="rename-input" />,
    ok: t('session.save'),
    onOk: async (v) => { const r = await call(method, { id: item.id, title: v.title.trim() || item.title }); refreshSoon(); loadOrbInbox(); return r; }
  });
}
// «Posponer»: a quick time or a date and time of the user's choice (local), sent as an ISO time.
const localInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function snoozeChat(item, t) {
  const quick = snoozeTimes();
  // The dialog opens with the focus on the time already chosen (it went to the first one, which looked chosen too).
  const initialAt = localInput(quick[2]?.[1] ?? quick[1][1]);
  return form(t('orbchats.snoozeTitle', { title: item.title }), {
    description: t('orbchats.snoozeDesc'),
    initial: { at: initialAt },
    body: (v, set) => (
      <>
        <div className="grid gap-1" role="radiogroup">
          {quick.map(([key, d]) => (
            <button key={key} type="button" role="radio" aria-checked={v.at === localInput(d)} autoFocus={initialAt === localInput(d)} onClick={() => set({ at: localInput(d) })} data-testid={`snooze-${key}`}
              className={cn('flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left text-body', v.at === localInput(d) ? 'border-primary-text bg-primary-soft' : 'hover:bg-accent/60')}>
              <span>{t(`orbchats.${key}`)}</span>
            </button>
          ))}
        </div>
        <label className="grid gap-1.5 text-control font-medium">{t('orbchats.snoozeCustom')}
          <Input type="datetime-local" value={v.at} min={localInput(new Date())} onChange={(e) => set({ at: e.target.value })} data-testid="snooze-at" />
        </label>
      </>
    ),
    ok: t('orbchats.snooze'),
    onOk: async (v) => {
      const at = new Date(v.at);
      if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) throw new Error(t('orbchats.snoozeBad'));
      await orbAct('inbox.snooze', { ...conversationRef(item), until: at.toISOString() });
      return true;
    }
  });
}
export async function deleteChat(item, t) {
  if (!(await confirm(t('orbchats.deleteTitle', { title: item.title }), t('orbchats.deleteBody'), { ok: t('orbchats.delete'), danger: true }))) return false;
  const ok = await act(call('conversations.remove', { id: item.id }), t('orbchats.deleted'));
  if (!ok) return false;
  const r = getState().route;
  if (r.view === 'chat' && r.id === item.id) { closeOrbInfo(); go({ view: phoneLayout() ? 'chats' : 'chat' }); }
  // gone from the list as soon as the engine agrees (it waited for the refresh that follows); the reads after it
  // bring the same.
  const key = `conversation:${item.id}`;
  setState((s) => ({ conversations: s.conversations.filter((c) => c.id !== item.id), ...(s.orbInbox?.items ? { orbInbox: { ...s.orbInbox, items: s.orbInbox.items.filter((x) => x.key !== key) } } : {}) }));
  refreshSoon(); loadOrbInbox();
  return true;
}

// «Eliminar…» of an agent's chat: the same confirmation and removal as the chat's own ⋯ (its worktree is only removed when no work is lost).
export async function deleteSessionChat(item, t) {
  let kept = false;
  try { kept = (await call('worktrees.status', { id: item.id })).has === true; } catch { kept = false; }
  if (!(await confirm(t('session.deleteTitle'), t('session.deleteBody') + (kept ? ` ${t('session.wt.deleteKept')}` : ''), { ok: t('session.delete'), danger: true }))) return false;
  const ok = await act(call('sessions.remove', { id: item.id }));
  if (!ok) return false;
  const r = getState().route;
  if (r.view === 'session' && r.id === item.id) go({ view: phoneLayout() ? 'chats' : 'chat' });
  refreshSoon(); loadOrbInbox();
  return true;
}

function OrbMenu({ item, open, setOpen, className }) {
  const t = useT();
  const actions = useOrbActions(item, { tab: true });
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <MoreButton small label={t('chats.menu', { name: item.title })} className={cn('shrink-0 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100', className)} data-testid="chat-menu" onClick={(e) => e.stopPropagation()} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[230px]" data-testid="chat-menu-list">
        {actions.map((a) => <div key={a.id}>{a.danger ? <DropdownMenuSeparator /> : null}<DropdownMenuItem variant={a.danger ? 'destructive' : undefined} disabled={a.disabled} onSelect={a.run} data-testid={`chat-${a.id}`}><a.icon />{a.label}</DropdownMenuItem></div>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The phone: a sheet from the bottom with the chat's avatar and title, then its actions.
function OrbSheet({ item, onClose }) {
  const t = useT();
  const actions = useOrbActions(item);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-sheet="bottom" showClose={false} className="gap-2" data-testid="chat-sheet">
        <div className="flex items-center gap-3 px-1 pb-1">
          <OrbAvatar item={item} size={40} />
          <DialogTitle className="min-w-0 flex-1 truncate text-title font-semibold">{item.title}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">{t('chats.menu', { name: item.title })}</DialogDescription>
        <div className="grid gap-0.5">
          {actions.map((a) => (
            <button key={a.id} type="button" onClick={() => { onClose(); a.run(); }} data-testid={`chat-${a.id}`}
              className={cn('press flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-card-title hover:bg-accent/60', a.danger && 'text-destructive')}>
              <a.icon className={cn('size-5 shrink-0', a.danger ? 'text-destructive' : 'text-muted-foreground')} /><span className="min-w-0 flex-1 truncate">{a.label}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- a row of the list
// Memoised: the list is made again on every refresh of the app's state, and hundreds of rows drew again each time (and
// every row whenever the screen changed). A row draws again when what it shows changes, or when it opens or closes.
// a chat completed a moment ago, still in its place: «Deshacer» puts it back before the list lets it go
export const undoDone = (item) => act(call(item.kind === 'session' ? 'sidebar.complete' : 'conversations.update', { ...(item.kind === 'session' ? { key: `s${item.id}` } : { id: item.id }), done: false })).then(refreshSoon);
function UndoDone({ item, className }) {
  const t = useT();
  return <button type="button" onClick={() => undoDone(item)} className={cn('text-primary-text hover:bg-accent shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-caption font-medium', className)} data-testid="orb-undo-done">{t('orbchats.undoDone')}</button>;
}
const OrbRow = memo(function OrbRow({ item, phone, onSheet, showProject = false, fade = null }) {
  const t = useT();
  const locale = useLocale();
  const active = useStore((s) => isOpen(s.route, item));
  const assistant = useStore((s) => s.app?.config?.assistantName ?? 'Orbe');
  const skin = useStore((s) => s.app?.config?.ui?.skin);
  const [menu, setMenu] = useState(false);
  const press = usePress(() => (phone ? onSheet(item) : setMenu(true)));
  const p = orbProgress(item, t, { assistant });
  const time = item.at ? shortTime(item.at, { locale, yesterday: t('chats.yesterday') }) : '';
  // an unread row is told apart by its counter alone, in every layout (the mock-up keeps the title in normal weight and the time grey)
  if (!phone) {
    // The PC's row (the mock-up's .row): the mark of the agent that answers, the title, what it is doing, the time and the
    // unread count on the first line; its latest progress under it. The ⋯ sits over the room the first line keeps for it.
    const agents = item.agents ?? (item.agent ? [item.agent] : []);
    const who = agents.length ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(agents.map((a) => AGENT[a] ?? a)) : '';
    const needsYou = Boolean(p.badge);
    const working = Boolean(item.busy || p.tone === 'live');
    // a chat waiting for the user reads like the mock-up's («Esperando tu aprobación»); what it asks for stays in the tooltip.
    const waitText = needsYou ? t('orbchats.awaiting') : '';
    return (
      <div className={cn('lazy-row group/row relative rounded-ctl', fade && 'transition-[opacity,max-height] duration-200 motion-reduce:transition-none', fade === 'on' && 'max-h-16', fade === 'leaving' && 'max-h-0 overflow-hidden opacity-0', active ? 'bg-accent' : 'hover:bg-accent')} data-testid={`orb-row-${item.title}`} data-fade={fade || undefined} data-kind={item.kind} data-unread={item.unread || 0} {...press}>
        <button type="button" onClick={() => openOrbItem(item)} aria-current={active ? 'true' : undefined} className="block w-full min-w-0 cursor-pointer rounded-ctl px-2 py-[7px] text-left" data-testid={`item-${item.kind === 'session' ? 's' : 'c'}${item.id}`}>
          <span className="flex min-h-5 items-center gap-1.5">
            <span className="grid shrink-0 place-items-center" role="img" aria-label={who || t('orbchats.noProject')} title={who || undefined} data-testid="orb-agent-mark">{!agents[0] && robotSkin(skin) ? <Robot size={16} still /> : <AgentIcon agent={agents[0]} className="size-2.5 opacity-70" />}</span>
            <span className={cn('min-w-0 flex-1 truncate text-control leading-5', 'font-normal', item.done && 'text-foreground/70', fade && 'text-muted-foreground line-through')}>{item.title}</span>
            {working ? <LoaderCircle className="text-muted-foreground size-3.5 shrink-0 animate-spin" aria-label={t('chats.working')} data-testid="orb-working" /> : null}
            {item.snoozedUntil ? <AlarmClock className="text-muted-foreground size-3.5 shrink-0" aria-label={t('orbchats.snoozed', { when: new Date(item.snoozedUntil).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })} data-testid="chat-snoozed" /> : null}
            {item.muted ? <BellOff className="text-muted-foreground size-3.5 shrink-0" aria-label={t('chats.muted')} /> : null}
            {working ? null : <span className="text-faint-foreground shrink-0 text-micro tabular-nums">{time}</span>}
            {item.unread ? <span className={cn('grid h-[17px] min-w-[17px] shrink-0 place-items-center rounded-full px-[5px] text-micro font-semibold tabular-nums', item.muted ? 'bg-muted-foreground/25 text-foreground/70' : 'bg-primary text-primary-foreground')} data-testid="chat-unread" aria-label={t('chats.unread', { n: item.unread })}>{item.unread > 99 ? '99+' : item.unread}</span> : null}
            <span className="-mr-1 w-6 shrink-0" aria-hidden="true" />
          </span>
          <span className={cn('mt-0.5 flex items-center gap-2 overflow-hidden text-caption whitespace-nowrap', needsYou || p.tone === 'warn' ? 'text-warning-ink' : p.tone === 'error' ? 'text-destructive' : 'text-faint-foreground')} data-testid="orb-progress" data-tone={p.tone}>
            {showProject && item.project ? <span className="inline-flex shrink-0 items-center gap-1"><ProjectIcon name={item.project} small />{item.project}</span> : null}
            {item.branch && p.tone === 'muted' && !needsYou
              ? (
                <span className="inline-flex min-w-0 items-center gap-2" data-testid="orb-branch">
                  {item.prNumber ? <span className="text-info inline-flex shrink-0 items-center gap-[3px] tabular-nums" data-testid="orb-pr"><GitPullRequest className="size-3.5" aria-hidden="true" />#{item.prNumber}</span> : null}
                  <span className="inline-flex min-w-0 items-center gap-[3px]" title={item.branch}><GitBranch className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{item.branch}</span></span>
                </span>
              )
              : (
                <span className="inline-flex min-w-0 items-center gap-[3px]" title={needsYou ? p.text : undefined}>
                  {needsYou ? <Hand className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                  <span className="min-w-0 truncate">{p.prefix ? <span className="text-foreground/70">{p.prefix}</span> : null}{needsYou ? waitText : p.text}</span>
                </span>
              )}
          </span>
        </button>
        {fade ? <UndoDone item={item} className="absolute top-[3px] right-2" /> : <OrbMenu item={item} open={menu} setOpen={setMenu} className="absolute top-[5px] right-2" />}
      </div>
    );
  }
  return (
    <div className={cn('lazy-row group/row relative flex items-center rounded-xl', fade && 'transition-[opacity,max-height] duration-200 motion-reduce:transition-none', fade === 'on' && 'max-h-24', fade === 'leaving' && 'max-h-0 overflow-hidden opacity-0', active ? 'bg-accent' : 'hover:bg-accent/50')} data-testid={`orb-row-${item.title}`} data-fade={fade || undefined} data-kind={item.kind} data-unread={item.unread || 0} {...press}>
      <button type="button" onClick={() => openOrbItem(item)} className={cn('flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2.5 text-left', phone ? 'py-2.5' : 'py-2')} data-testid={`item-${item.kind === 'session' ? 's' : 'c'}${item.id}`}>
        <OrbAvatar item={item} size={phone ? 46 : 40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-card-title compact:text-control', 'font-medium', item.done && 'text-foreground/70', fade && 'text-muted-foreground line-through')}>{item.title}</span>
            <span className={cn('shrink-0 text-caption tabular-nums', 'text-muted-foreground')}>{time}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {p.badge
              ? <span className="bg-warning/18 text-warning-ink min-w-0 truncate rounded-md px-1.5 py-px text-caption font-medium" data-testid="orb-progress" data-tone={p.tone}>{p.text}</span>
              : (
                <span className={cn('flex min-w-0 flex-1 items-center gap-1.5 truncate text-control', p.tone === 'live' ? 'text-primary-text' : p.tone === 'error' ? 'text-destructive' : p.tone === 'warn' ? 'text-warning-ink' : 'text-muted-foreground')} data-testid="orb-progress" data-tone={p.tone}>
                  {p.tone === 'live' ? <span className="bg-primary-text size-1.5 shrink-0 animate-pulse rounded-full" aria-hidden="true" /> : null}
                  <span className="min-w-0 truncate">{p.prefix ? <span className="text-foreground/70">{p.prefix}</span> : null}{p.text}</span>
                </span>
              )}
            {p.badge ? <span className="flex-1" /> : null}
            {item.snoozedUntil ? <AlarmClock className="text-muted-foreground size-3.5 shrink-0" aria-label={t('orbchats.snoozed', { when: new Date(item.snoozedUntil).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })} data-testid="chat-snoozed" /> : null}
            {item.muted ? <BellOff className="text-muted-foreground size-3.5 shrink-0" aria-label={t('chats.muted')} /> : null}
            {item.unread ? <span className={cn('min-w-5 shrink-0 rounded-full px-1.5 text-center text-micro leading-5 font-semibold tabular-nums', item.muted ? 'bg-muted-foreground/25 text-foreground/70' : 'bg-primary text-primary-foreground')} data-testid="chat-unread" aria-label={t('chats.unread', { n: item.unread })}>{item.unread > 99 ? '99+' : item.unread}</span> : null}
          </span>
        </span>
      </button>
      {fade ? <UndoDone item={item} className="mr-1" /> : phone ? null : <OrbMenu item={item} open={menu} setOpen={setMenu} className="mr-1" />}
    </div>
  );
}, (a, b) => a.phone === b.phone && a.showProject === b.showProject && a.onSheet === b.onSheet && a.day === b.day && a.fade === b.fade && sameItem(a.item, b.item));

// ---- a project's heading: its initials in colour, its name; folds its chats; its ⋯: new chat there, its info
function ProjectHead({ group, open, phone, done = false }) {
  const t = useT();
  const name = group.project;
  const head = done ? `done-head-${name ?? 'none'}` : `project-head-${name ?? 'none'}`;
  if (!phone) {
    // The PC's heading (the mock-up's .grp): a chevron, the project's 10 px dot, its name, and on hover «+» (its menu).
    return (
      <div className="group/row text-faint-foreground hover:text-foreground flex items-center pr-1">
        <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-ctl px-2 pt-2.5 pb-[3px] text-left text-caption" data-testid={head}>
          <ChevronDown className={cn('size-3.5 shrink-0 transition-transform duration-150', !open && '-rotate-90')} />
          {name ? <ProjectIcon name={name} /> : <span className="size-2.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--faint-foreground)]" aria-hidden="true" />}
          <span className="min-w-0 truncate">{name ?? t('orbchats.noProject')}</span>
          <span className="flex-1" />
          {/* the rows say it themselves while the group is open; folded, its state shows here */}
          {open ? null : <>
            {group.waiting ? <span className="bg-warning size-1.5 shrink-0 rounded-full" role="img" aria-label={t('orbchats.awaiting')} /> : group.working ? <span className="bg-primary-text size-1.5 shrink-0 animate-pulse rounded-full" role="img" aria-label={t('chats.working')} /> : null}
            {group.unread ? <span className="bg-primary size-1.5 rounded-full" aria-label={t('chats.unread', { n: group.unread })} /> : null}
            <span className="tabular-nums opacity-70">{group.items.length}</span>
          </>}
        </CollapsibleTrigger>
        {name && !done ? (
          <>
          <IconButton small label={t('orbchats.projectNewChat')} className="mt-1.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100" onClick={() => newChat(name)} data-testid={`project-new-${name}`}><Plus /></IconButton>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton small label={t('orbchats.projectMenu', { name })} className="mt-1.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" data-testid={`project-menu-${name}`}><Ellipsis /></IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => newChat(name)} data-testid="project-new-chat"><MessageSquarePlus />{t('orbchats.projectNewChat')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openOrbInfo({ type: 'project', name })} data-testid="project-info"><Info />{t('orbchats.projectInfo')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </>
        ) : null}
      </div>
    );
  }
  return (
    <div className="group/row text-muted-foreground flex items-center pr-1">
      <CollapsibleTrigger className="hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-micro font-semibold tracking-wide uppercase" data-testid={head}>
        {name ? <ProjectIcon name={name} size={18} /> : <span className="bg-muted-foreground/30 grid size-[18px] shrink-0 place-items-center rounded-full" aria-hidden="true"><span className="bg-muted-foreground size-1 rounded-full" /></span>}
        <span className="min-w-0 truncate">{name ?? t('orbchats.noProject')}</span>
        {group.waiting ? <span className="bg-warning size-1.5 shrink-0 rounded-full" role="img" aria-label={t('orbchats.awaiting')} /> : group.working ? <span className="bg-primary-text size-1.5 shrink-0 animate-pulse rounded-full" role="img" aria-label={t('chats.working')} /> : null}
        <span className="flex-1" />
        {group.unread ? <span className="bg-primary size-1.5 rounded-full" aria-label={t('chats.unread', { n: group.unread })} /> : null}
        {open ? null : <span className="tabular-nums opacity-70">{group.items.length}</span>}
        <ChevronRight className={cn('size-3 shrink-0 opacity-60 transition-transform duration-150', open && 'rotate-90')} />
      </CollapsibleTrigger>
      {name && !done ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn('hover:text-foreground hover:bg-accent grid size-7 cursor-pointer place-items-center rounded-md', phone ? '' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100')} aria-label={t('orbchats.projectMenu', { name })} data-testid={`project-menu-${name}`}><Ellipsis className="size-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => newChat(name)} data-testid="project-new-chat"><MessageSquarePlus />{t('orbchats.projectNewChat')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openOrbInfo({ type: 'project', name })} data-testid="project-info"><Info />{t('orbchats.projectInfo')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// a long list draws its first rows at once and the rest right after, a step each time the window is idle:
// the app's first screen does not wait for hundreds of rows nobody sees yet.
function useGrowing(total, first = 40, step = 80) {
  const [n, setN] = useState(first);
  useEffect(() => {
    if (n >= total) return undefined;
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 16));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const id = idle(() => setN((x) => x + step), { timeout: 300 });
    return () => cancel(id);
  }, [n, total]);
  return n;
}

// Folded projects, remembered on this device.
function useFolded() {
  const KEY = 'orb.seccionesOrb';
  const [folded, setRaw] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {}; } catch { return {}; } });
  const set = (id, open) => setRaw((f) => { const next = { ...f, [id]: !open }; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });
  return [folded, set];
}

// ---- the «+»: Nuevo chat, Nuevo proyecto (a new project opens a new chat in it)
export async function newProjectChat() {
  const p = await createProjectFlow();
  if (p) await newChat(p.name);
}
// The PC's two buttons next to the search (one row, icons with their tooltip): «New project» and «New chat», which opens the
// project picker at once (components/new-chat-picker.jsx).
function OrbNewButtons() {
  const t = useT();
  const newKey = useKeys().table.get('chat.new')?.key;
  const tabsOn = useStore((s) => !phoneLayout() && s.app?.config?.ui?.tabs !== false);
  return (
    <>
      <BubbleTip title={t('newchat.project')}><IconButton label={t('newchat.project')} className="shrink-0" onClick={newProjectChat} data-testid="sidebar-new-project"><FolderPlus /></IconButton></BubbleTip>
      <BubbleTip title={t('nav.newChat')} text={tabsOn && newKey ? newKey : t('newchat.hint')}><IconButton label={t('nav.newChat')} className="shrink-0" onClick={startChatFlow} data-testid="chats-new"><MessageSquarePlus /></IconButton></BubbleTip>
    </>
  );
}
// The phone's round button: a menu with the same two actions (the PC has the two buttons beside the search).
function OrbNewMenu() {
  const t = useT();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="press bg-primary text-primary-foreground fixed right-4 bottom-[calc(84px+env(safe-area-inset-bottom,0px))] z-30 grid size-14 cursor-pointer place-items-center rounded-2xl shadow-lg" aria-label={t('chats.new')} data-testid="chats-new"><Plus className="size-6" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[220px]">
        <DropdownMenuItem onSelect={startChatFlow} data-testid="new-conversation"><MessageSquarePlus />{t('nav.newChat')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={newProjectChat} data-testid="sidebar-new-project"><FolderPlus />{t('newchat.project')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---- the zone's other places (PC): Tareas (with what waits for approval), Proyectos, Programadas, Pizarra, and «Más»
// with God mode when it is on (PC only).
export function Places() {
  const t = useT();
  const view = useStore((s) => s.route.view);
  const approvals = useStore((s) => s.tasks.filter(needsApproval).length);
  const running = useStore((s) => s.tasks.filter((x) => x.status === 'running').length);
  const config = useStore((s) => s.app?.config);
  const places = [['tasks', ClipboardCheck, 'nav.tasks'], ['projects', FolderGit2, 'nav.projects'], ['schedules', CalendarSync, 'nav.schedules'], ['board', Presentation, 'nav.board']];
  const extra = config?.expert?.enabled && fullPc() ? [['expert', SquareTerminal, 'nav.expert']] : [];
  const nav = useRef(null);
  const [fit, setFit] = useState(places.length);
  useEffect(() => {
    const el = nav.current; if (!el) return undefined;
    const measure = () => setFit(placesFit(el.clientWidth - 16, places.length, { forceMore: extra.length > 0 }));
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [extra.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = places.slice(0, fit);
  const more = [...places.slice(fit), ...extra];
  // The gap is a fixed length in the grid (never a share of the free room), so the columns give way first and the names are
  // cut with «…». The hover is a faint tint so it is never mistaken for the chosen place.
  // The four places keep their names as the mock-up draws them; «Más» (God mode adds it) is a narrow column of its own
  // with only its icon, so «Programadas» still fits beside it.
  const cls = (on) => cn('press relative flex min-w-0 cursor-pointer flex-col items-center gap-[3px] rounded-ctl pt-[7px] pb-1.5 text-caption leading-[1.45] transition-colors', on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/35 hover:text-foreground');
  return (
    <nav ref={nav} style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))${more.length ? ' 1.75rem' : ''}` }} className="grid gap-x-[3px] px-2 pb-1.5" aria-label={t('orbchats.places')} data-testid="orb-places">
      {shown.map(([id, Icon, label]) => (
        <button key={id} type="button" className={cls(view === id)} onClick={() => go({ view: id })} aria-current={view === id ? 'page' : undefined} data-testid={`nav-${id}`}>
          <span className="relative grid place-items-center">
            <Icon className={cn('size-5', view === id && 'text-primary-text')} />
            {id === 'tasks' && approvals ? <span className="bg-warning text-warning-foreground absolute -top-2 -right-3 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-micro font-bold tabular-nums shadow-[0_0_0_2px_var(--sidebar)]" aria-label={t('comp.sidebar.waitApproval')} title={t('comp.sidebar.waitApproval')} data-testid="nav-tasks-count">{approvals}</span>
              : id === 'tasks' && running ? <span className="bg-primary-text absolute -top-1 -right-2 size-1.5 animate-pulse rounded-full" aria-hidden="true" /> : null}
          </span>
          <span className="max-w-full truncate">{t(label)}</span>
        </button>
      ))}
      {more.length ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(cls(more.some(([id]) => id === view)), 'justify-center px-0 pt-0 pb-0')} title={t('nav.more')} aria-label={t('nav.more')} data-testid="orb-places-more"><Ellipsis className="size-5" /><span className="sr-only">{t('nav.more')}</span></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {more.map(([id, Icon, label]) => <DropdownMenuItem key={id} onSelect={() => go({ view: id })} data-testid={`nav-${id}`}><Icon />{t(label)}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}

// ---- search: titles and projects at once; from two letters, the messages too (lib/search.js); «#12» finds that task.
const FILTER0 = { state: 'all', agent: 'all' };
function FilterMenu({ filter, setFilter, agents, snoozed = 0, order = 'recent', setOrder = () => {}, inline = false }) {
  const t = useT();
  const changed = filter.state !== 'all' || filter.agent !== 'all';
  const pick = (k, v) => setFilter((f) => ({ ...f, [k]: f[k] === v ? 'all' : v }));
  return (
    <DropdownMenu modal={false}>
      <BubbleTip title={t('orbchats.filter')} text={t('orbchats.filterHint')}>
        <DropdownMenuTrigger asChild>
          {inline
            ? <IconButton small label={t('orbchats.filter')} className={cn('relative', changed && 'text-primary-text')} data-testid="sidebar-filter"><SlidersHorizontal />{changed ? <span className="bg-primary-text absolute top-0.5 right-0.5 size-1.5 rounded-full" aria-hidden="true" /> : null}</IconButton>
            : (
              <button type="button" className={cn('relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border', changed ? 'text-primary-text border-primary-text/40' : 'text-muted-foreground hover:text-foreground')} aria-label={t('orbchats.filter')} data-testid="sidebar-filter">
                <SlidersHorizontal className="size-4" />{changed ? <span className="notice-dot" aria-hidden="true" /> : null}
              </button>
            )}
        </DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('orbchats.filterState')}</DropdownMenuLabel>
        {[['active', 'orbchats.stateActive'], ['attention', 'orbchats.stateAttention'], ['done', 'orbchats.stateDone'], ...(snoozed || filter.state === 'snoozed' ? [['snoozed', 'orbchats.stateSnoozed']] : [])].map(([v, k]) => <DropdownMenuCheckboxItem key={v} checked={filter.state === v} onCheckedChange={() => pick('state', v)} onSelect={(e) => e.preventDefault()} data-testid={`filter-${v}`}>{t(k)}{v === 'snoozed' && snoozed ? <span className="text-muted-foreground ml-auto tabular-nums">{snoozed}</span> : null}</DropdownMenuCheckboxItem>)}
        <DropdownMenuSeparator /><DropdownMenuLabel>{t('orbchats.order')}</DropdownMenuLabel>
        {[['recent', 'orbchats.orderRecent'], ['priority', 'orbchats.orderPriority']].map(([v, k]) => <DropdownMenuCheckboxItem key={v} checked={order === v} onCheckedChange={() => setOrder(v)} onSelect={(e) => e.preventDefault()} data-testid={`order-${v}`}>{t(k)}</DropdownMenuCheckboxItem>)}
        {agents.length > 1 ? <><DropdownMenuSeparator /><DropdownMenuLabel>{t('orbchats.filterAgent')}</DropdownMenuLabel>{agents.map((a) => <DropdownMenuCheckboxItem key={a} checked={filter.agent === a} onCheckedChange={() => pick('agent', a)} onSelect={(e) => e.preventDefault()}>{AGENT[a] ?? a}</DropdownMenuCheckboxItem>)}</> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The list's own order and state, one click from its heading (the mock-up's second sort button); the same choices as the filter.
function SortMenu({ filter, setFilter, order, setOrder }) {
  const t = useT();
  const pick = (v) => setFilter((f) => ({ ...f, state: f.state === v ? 'all' : v }));
  return (
    <DropdownMenu modal={false}>
      <BubbleTip title={t('orbchats.sortFilter')}>
        <DropdownMenuTrigger asChild>
          <IconButton label={t('orbchats.sortFilter')} data-testid="sidebar-sort"><ArrowUpDown className="size-3.5" /></IconButton>
        </DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('orbchats.order')}</DropdownMenuLabel>
        {[['recent', 'orbchats.orderRecent'], ['priority', 'orbchats.orderPriority']].map(([v, k]) => <DropdownMenuCheckboxItem key={v} checked={order === v} onCheckedChange={() => setOrder(v)} onSelect={(e) => e.preventDefault()} data-testid={`order-${v}`}>{t(k)}</DropdownMenuCheckboxItem>)}
        <DropdownMenuSeparator /><DropdownMenuLabel>{t('orbchats.filterState')}</DropdownMenuLabel>
        {[['attention', 'orbchats.stateAttention'], ['done', 'orbchats.stateDone']].map(([v, k]) => <DropdownMenuCheckboxItem key={v} checked={filter.state === v} onCheckedChange={() => pick(v)} onSelect={(e) => e.preventDefault()} data-testid={`filter-${v}`}>{t(k)}</DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const Sub = SectionLabel;

// Chats completed while the list is open stay in their place for a few seconds (struck out, with «Deshacer») and then leave
// with a short fade, instead of vanishing at once. → { [key]: 'on' | 'leaving' }.
const LINGER_MS = 6000; const FADE_MS = 220;
function useLinger(items) {
  const [linger, setLinger] = useState({});
  const seen = useRef(null);
  const timers = useRef(new Map());
  useEffect(() => () => { for (const id of timers.current.values()) clearTimeout(id); }, []);
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(items.map((x) => [x.key, Boolean(x.done)]));
    if (!before) return;
    const drop = (key) => { clearTimeout(timers.current.get(key)); timers.current.delete(key); setLinger((l) => { if (!(key in l)) return l; const { [key]: _gone, ...rest } = l; return rest; }); };
    for (const x of items) {
      if (x.done && before.get(x.key) === false && !timers.current.has(x.key)) {
        setLinger((l) => ({ ...l, [x.key]: 'on' }));
        timers.current.set(x.key, setTimeout(() => {
          setLinger((l) => (x.key in l ? { ...l, [x.key]: 'leaving' } : l));
          timers.current.set(x.key, setTimeout(() => drop(x.key), FADE_MS));
        }, LINGER_MS));
      } else if (!x.done && timers.current.has(x.key)) drop(x.key);
    }
  }, [items]);
  return linger;
}

export function OrbInbox({ page = false }) {
  const t = useT();
  const phone = page && phoneLayout();
  const items = useOrbItems();
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(FILTER0);
  const [showDone, setShowDone] = useState(false);
  const linger = useLinger(items);
  const found = useSearch(query);
  const [folded, setFolded] = useFolded();
  const [sheet, setSheet] = useState(null);
  const sheetItem = sheet ? items.find((x) => x.key === sheet) ?? null : null;
  // «Prioridad» (the tray «Te necesita»): the order is taken once, when the list opens or the user asks, and kept while the
  // rows are attended; a chat that arrives later goes on top, none of the others moves.
  const [order, setOrderState] = useState(() => { try { return localStorage.getItem('orb.inbox.order') === 'priority' ? 'priority' : 'recent'; } catch { return 'recent'; } });
  const [frozen, setFrozen] = useState(null);
  const setOrder = (v) => { setOrderState(v); setFrozen(null); try { localStorage.setItem('orb.inbox.order', v); } catch { /* the order is a convenience */ } };
  useEffect(() => { if (order === 'priority' && !frozen && items.length) setFrozen(priorityKeys(items)); }, [order, frozen, items]);
  const parts = useMemo(() => groupOrb(items, { filter, order, frozen, linger: new Set(Object.keys(linger)) }), [items, filter, order, frozen, linger]);
  // Ctrl+K is named here (the headers carry no magnifier); the key comes from the shortcut table.
  const paletteKey = useKeys().table.get('palette.open')?.key;
  const searchTitle = paletteKey ? `${t('orbchats.search')} (${paletteKey})` : t('orbchats.search');
  // Ctrl+Alt+A: the next chat that needs the user, in the order the list shows.
  const route = useStore((s) => s.route);
  // the key is a command of the shortcut table (lib/keys.js): Ajustes › Atajos can change it
  useShortcut('inbox.nextNeeds', (e) => {
    const shown = [...parts.pinned, ...parts.groups.flatMap((g) => g.items)];
    const cur = shown.find((x) => isOpen(route, x))?.key ?? null;
    const next = nextNeedingYou(shown, cur);
    if (next) { e.preventDefault(); openOrbItem(next); }
  });
  const onSheet = useCallback((x) => setSheet(x.key), []);
  // the day: «ayer» and the times of the rows move on at midnight
  const day = useDay();
  const rowProps = { phone, onSheet, day };
  const fadeOf = (x) => linger[x.key] ?? null;
  const agents = useMemo(() => [...new Set(items.map((x) => x.agent).filter(Boolean))], [items]);
  const shown = useGrowing(parts.pinned.length + parts.groups.reduce((n, g) => n + (folded[g.project ?? ''] ? 0 : g.items.length), 0));

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const results = (() => {
    if (!searching) return null;
    const hit = (x) => x.title.toLowerCase().includes(q) || String(x.project ?? '').toLowerCase().includes(q)
      || (x.kind === 'conversation' ? found?.conversations?.has(x.id) : found?.sessions?.has(x.id));
    const okAgent = (x) => filter.agent === 'all' || x.agent === filter.agent;
    return {
      chats: items.filter((x) => hit(x) && okAgent(x)).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 40),
      // after the tasks found by their title or number, the ones whose brief or result say it (tasks.search).
      tasks: (() => { const own = tasks.filter((x) => `#${x.id}` === q || String(x.title).toLowerCase().includes(q)).slice(0, 12); const ids = new Set(own.map((x) => x.id)); return [...own, ...(found?.tasks ?? []).filter((x) => !ids.has(x.id))].slice(0, 12); })(),
      projects: projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 10)
    };
  })();

  const phoneSearch = (
    <div className="flex items-center gap-2">
      <label className="side-search-box bg-background/60 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setFilter(FILTER0); } }} placeholder={t('orbchats.search')} aria-label={t('orbchats.search')} className={cn('placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none', phone ? 'text-title' : 'text-control')} data-testid="sidebar-search-input" />
        {query ? <button type="button" className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded" aria-label={t('comp.sidebar.clearSearch')} onClick={() => setQuery('')}><X className="size-3.5" /></button> : null}
      </label>
      <FilterMenu filter={filter} setFilter={setFilter} agents={agents} snoozed={parts.snoozed} order={order} setOrder={setOrder} />
    </div>
  );
  // The PC's search (the mock-up's .search): the filter sits inside the box, at its right end, then «New project» and «New chat».
  const pcSearch = (
    <div className="flex items-center gap-1">
      <div className="relative min-w-0 flex-1">
        <SearchInput value={query} onChange={setQuery} placeholder={t('orbchats.search')} title={searchTitle} className="w-full" inputClassName="pr-8" data-testid="sidebar-search-input"
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setFilter(FILTER0); } }} />
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
          {query ? <IconButton small label={t('comp.sidebar.clearSearch')} onClick={() => setQuery('')}><X /></IconButton> : null}
          <FilterMenu inline filter={filter} setFilter={setFilter} agents={agents} snoozed={parts.snoozed} order={order} setOrder={setOrder} />
        </div>
      </div>
      <OrbNewButtons />
    </div>
  );
  const search = phone ? phoneSearch : pcSearch;

  let body;
  if (results) body = (
    <div className="grid gap-0.5" data-testid="sidebar-results">
      {results.projects.length ? <><Sub>{t('orbchats.projectsFound')}</Sub>{results.projects.map((p) => (
        <button key={p.name} type="button" className="hover:bg-accent/50 flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left text-body compact:text-control" onClick={() => openOrbInfo({ type: 'project', name: p.name })} data-testid={`found-project-${p.name}`}>
          <ProjectIcon name={p.name} size={28} /><span className="min-w-0 flex-1 truncate">{p.name}</span>
        </button>))}</> : null}
      {results.chats.length ? <><Sub>{t('orbchats.chatsFound')}</Sub>{results.chats.map((x) => <OrbRow key={x.key} item={x} showProject {...rowProps} />)}</> : null}
      {found?.messages?.length ? <><Sub>{t('chats.messages')}</Sub>{found.messages.map((m) => {
        const x = items.find((y) => y.key === m.key); if (!x) return null;
        return (
          <button key={`${m.key}:${m.line.id}`} type="button" onClick={() => openOrbItem(x)} className="hover:bg-accent/50 flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left" data-testid="chats-message-hit">
            <OrbAvatar item={x} size={34} />
            <span className="min-w-0 flex-1"><span className="block truncate text-body compact:text-control font-medium">{x.title}</span><span className="text-muted-foreground block truncate text-control">{m.line.text}</span></span>
          </button>
        );
      })}</> : null}
      {results.tasks.length ? <><Sub>{t('orbchats.tasksFound')}</Sub>{results.tasks.map((x) => (
        <button key={x.id} type="button" onClick={() => go({ view: 'tasks', id: x.id })} className="hover:bg-accent/50 flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-control compact:text-control" data-testid={`item-t${x.id}`}>
          <ClipboardCheck className="text-muted-foreground size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate">#{x.id} {x.title}</span>{x.snippet ? <span className="text-muted-foreground block truncate text-caption" data-testid="task-hit-snippet">{x.snippet}</span> : null}</span><span className="text-muted-foreground shrink-0 text-caption"><TaskStatus task={x} plain /></span>
        </button>))}</> : null}
      {!results.projects.length && !results.chats.length && !results.tasks.length && !found?.messages?.length ? <p className="text-muted-foreground px-3 py-4 text-sm compact:text-control">{t('chats.noResults')}</p> : null}
    </div>
  );
  else { let left = shown; const take = (list) => { const part = list.slice(0, Math.max(0, left)); left -= part.length; return part; }; body = (
    <>
      <DayDigestCard phone={phone} />
      {order === 'priority' ? <button type="button" onClick={() => setFrozen(null)} className="text-muted-foreground hover:text-foreground hover:bg-accent/50 mt-1 flex cursor-pointer items-center gap-2 self-start rounded-lg px-2.5 py-1 text-caption" data-testid="orb-reorder">{t('orbchats.reorder')}</button> : null}
      {parts.pinned.length ? (
        <div className={phone ? 'pt-2' : undefined} data-testid="orb-pinned">
          {phone
            ? <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-micro font-semibold tracking-wide uppercase"><Pin className="size-3.5" />{t('chats.pinned')}</div>
            : <div className="text-faint-foreground flex items-center gap-1.5 px-2 pt-2.5 pb-[3px] text-caption"><Pin className="size-3.5" />{t('chats.pinned')}</div>}
          <div className={cn('grid', phone && 'gap-0.5')}>{take(parts.pinned).map((x) => <OrbRow key={x.key} item={x} showProject fade={fadeOf(x)} {...rowProps} />)}</div>
        </div>
      ) : null}
      {parts.groups.map((g) => {
        const id = g.project ?? '';
        const open = !folded[id];
        return (
          <Collapsible key={id || 'none'} open={open} onOpenChange={(v) => setFolded(id, v)} className={phone ? 'pt-2' : undefined} data-testid={`orb-group-${g.project ?? 'none'}`}>
            {g.flat ? null : <ProjectHead group={g} open={open} phone={phone} />}
            <CollapsibleContent className={cn('grid', phone && 'gap-0.5')}>
              {(open ? take(g.items) : []).map((x) => <OrbRow key={x.key} item={x} fade={fadeOf(x)} {...rowProps} />)}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {!items.length ? <p className="text-muted-foreground px-3 py-4 text-sm leading-relaxed" data-testid="orb-empty">{t('orbchats.empty')}</p> : null}
      {parts.hidden || showDone ? (
        <button type="button" onClick={() => setShowDone(!showDone)} className={phone
          ? 'text-muted-foreground hover:text-foreground hover:bg-accent/50 mt-2 flex cursor-pointer items-center gap-2 self-start rounded-lg px-2.5 py-1.5 text-control'
          : 'text-faint-foreground hover:text-foreground flex cursor-pointer items-center gap-0.5 self-start px-2 pt-2.5 pb-1 text-caption'} data-testid="sidebar-completed">
          {phone ? (showDone ? <Undo2 className="size-4" /> : <Check className="size-4" />) : null}
          {showDone ? t('orbchats.hideDone') : phone ? t('orbchats.showDone', { n: parts.hidden }) : t('orbchats.doneCount', { n: parts.hidden })}
          {phone ? null : <ChevronRight className={cn('size-3.5 transition-transform duration-150', showDone && 'rotate-90')} />}
        </button>
      ) : null}
      {/* the one place for the completed ones: by project, like the open ones, a little dimmer; each opens again from its menu */}
      {showDone ? parts.completed.map((g) => {
        const id = `done:${g.project ?? ''}`;
        const open = !folded[id];
        return (
          <Collapsible key={id} open={open} onOpenChange={(v) => setFolded(id, v)} className={cn('opacity-75', phone && 'pt-2')} data-testid={`orb-done-${g.project ?? 'none'}`}>
            <ProjectHead group={g} open={open} phone={phone} done />
            <CollapsibleContent className={cn('grid', phone && 'gap-0.5')}>
              {open ? g.items.map((x) => <OrbRow key={x.key} item={x} {...rowProps} />) : null}
            </CollapsibleContent>
          </Collapsible>
        );
      }) : null}
    </>
  ); }


  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', page && 'bg-background')} data-testid="orb-inbox">
      <div className={cn('grid gap-2', phone ? 'px-4 pt-3 pb-2' : 'mt-0.5 mr-2.5 mb-2 ml-3')} data-testid="sidebar-search">{search}</div>
      {phone ? null : <Places />}
      {phone ? null : (
        <div className="text-faint-foreground flex items-center justify-between px-4 pt-2.5 pb-1 text-caption leading-[1.45]">
          <BubbleTip title={t('orbchats.activityTip')}>
            <button type="button" onClick={() => go('activity')} className="hover:text-foreground inline-flex cursor-pointer items-center gap-0.5" data-testid="sidebar-activity">{t('orbchats.activity')}<ChevronRight className="size-3.5" /></button>
          </BubbleTip>
          <SortMenu filter={filter} setFilter={setFilter} order={order} setOrder={setOrder} />
        </div>
      )}
      <nav className={cn('flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto', phone ? 'px-2 pb-28' : 'px-2 pb-2')} aria-label={t('chats.list')} data-testid="mobile-chats">{body}</nav>
      {phone ? <OrbNewMenu /> : null}
      {sheetItem ? <OrbSheet item={sheetItem} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

// The phone's «Chats» tab of the Orb zone.
export function OrbChatsView() {
  const t = useT();
  useEffect(() => { setState((s) => (s.orbInfo?.type === 'chat' ? { orbInfo: null } : {})); }, []);
  return (
    <>
      <PageHeader title={t('nav.modeOrb')} className="chats-head" />
      {/* the list scrolls on its own inside (the search stays on top) */}
      <PageBody className="flex flex-col overflow-hidden p-0 [scrollbar-gutter:auto]"><OrbInbox page /></PageBody>
    </>
  );
}
