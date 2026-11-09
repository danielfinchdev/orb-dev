// 3.6 (messaging, step M3): the chat list (docs/DESIGN-SYSTEM.md › 2.5, mockup mensajeria.html ?z=orb). On the PC it is
// the left pane; on the phone the «Chats» tab. From the top: search (titles, projects, the
// messages and «#12» for a task) with its filter, «+» (Nuevo chat, Nuevo proyecto), the zone's other places (PC: Tareas,
// Proyectos, Programadas, Pizarra, and «Más» with God mode when it is on), the pinned
// chats, then one group per project (its coloured initials, folding) with its chats. Each row: the project's icon with
// the mark of who answers in its corner (OrbAvatar), the title, the time, its latest progress (a running task,
// «Esperando tu aprobación», how its last task ended, else its last line) and the unread count. Right click or ⋯ (PC) and
// a long press (phone) open the chat's menu: info, pin, mute, mark read, complete or reopen, delete.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Plus, X, Ellipsis, ChevronRight, Pin, PinOff, BellOff, Bell, Trash2, CheckCheck, Check, ListTodo, FolderKanban, CalendarClock, PenTool, SquareTerminal, MessageSquarePlus, FolderPlus, Info, CircleCheck, Undo2, SlidersHorizontal, Sparkles, PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { PageHeader } from '@/components/page.jsx';
import { Robot } from '@/components/robot.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { createProjectFlow } from '@/components/project-actions.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuCheckboxItem, Collapsible, CollapsibleTrigger, CollapsibleContent, Dialog, DialogContent, DialogTitle, DialogDescription, Tip } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Input } from '@/components/ui/basic.jsx';
import { useStore, go, call, act, newChat, orbAct, loadOrbInbox, openOrbInfo, closeOrbInfo, getState, phoneLayout, fullPc, refreshSoon, setState, plainSkin } from '@/lib/store.js';
import { orbItems, orbProgress, groupOrb, shortTime, avatarStack } from '@/lib/inbox.js';
import { sameItem } from '@/lib/memo.js';
import { useDay } from '@/lib/use-day.js';
import { usePress } from '@/lib/use-press.js';
import { AGENT, STATUS } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';

// ---- data: the rows of the zone (the conversations and direct chats of the store, the marks of inbox.list)
export function useOrbInbox() {
  const inbox = useStore((s) => s.orbInbox);
  const version = useStore((s) => s.version);
  useEffect(() => { loadOrbInbox(); }, [version]);
  return inbox;
}
export function useOrbItems() {
  const inbox = useOrbInbox();
  const conversations = useStore((s) => s.conversations);
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  const chats = useStore((s) => s.app?.chats);
  const approvals = useStore((s) => s.app?.approvals);
  const completed = useStore((s) => s.app?.completed);
  return useMemo(() => orbItems({ inbox, conversations, sessions, tasks, chats, approvals, completed }).map((x) => ({ ...x, agentName: AGENT[x.agent] ?? x.agent })),
    [inbox, conversations, sessions, tasks, chats, approvals, completed]);
}
export const openOrbItem = (x) => go(x.kind === 'session' ? { view: 'session', id: x.id } : { view: 'chat', id: x.id });
const isOpen = (route, x) => (x.kind === 'session' ? route.view === 'session' : route.view === 'chat') && route.id === x.id;
const conversationRef = (x) => ({ kind: x.kind === 'session' ? 'session' : 'conversation', id: x.id });

// 3.8.1 (H1e): the chat's avatar. Big: its project's icon (its own picture or its coloured initials); without a project,
// Orbe's head. In the corner: the marks of the agents that worked in it (lib/inbox.js › agentsOf: the brain or a direct
// conversation's agent first, then its tasks' agents), stacked like avatars, the first on top; past three, two and
// «+N» (3.8.2: lib/inbox.js › avatarStack keeps any number inside the avatar, fewer marks on a small one). Hovering it
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
    : plainSkin(skin)
      ? <span className="bg-primary/12 text-primary grid place-items-center rounded-full" style={{ width: size, height: size }}><Sparkles className="size-1/2" /></span>
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
export function useOrbActions(item) {
  const t = useT();
  if (!item) return [];
  // 3.6: a direct conversation with an agent: pinned and muted like the others; completed through the sidebar's mark.
  const rename = { id: 'rename', icon: PencilLine, label: t('orbchats.rename'), run: () => renameChat(item, t) };
  if (item.kind === 'session') return [
    rename,
    item.pinned ? { id: 'unpin', icon: PinOff, label: t('chats.unpin'), run: () => orbAct('inbox.unpin', conversationRef(item)) } : { id: 'pin', icon: Pin, label: t('chats.pin'), run: () => orbAct('inbox.pin', conversationRef(item)) },
    item.muted ? { id: 'unmute', icon: Bell, label: t('chats.unmute'), run: () => orbAct('inbox.mute', { ...conversationRef(item), muted: false }) } : { id: 'mute', icon: BellOff, label: t('chats.mute'), run: () => orbAct('inbox.mute', { ...conversationRef(item), muted: true }) },
    item.done
      ? { id: 'reopen', icon: Undo2, label: t('orbchats.reopen'), run: () => act(call('sidebar.complete', { key: `s${item.id}`, done: false })).then(refreshSoon) }
      : { id: 'complete', icon: CircleCheck, label: t('orbchats.complete'), run: () => act(call('sidebar.complete', { key: `s${item.id}`, done: true })).then(refreshSoon) }
  ];
  const ref = conversationRef(item);
  return [
    { id: 'info', icon: Info, label: t('orbchats.info'), run: () => { openOrbItem(item); openOrbInfo({ type: 'chat' }); } },
    rename,
    item.pinned ? { id: 'unpin', icon: PinOff, label: t('chats.unpin'), run: () => orbAct('inbox.unpin', ref) } : { id: 'pin', icon: Pin, label: t('chats.pin'), run: () => orbAct('inbox.pin', ref) },
    item.muted ? { id: 'unmute', icon: Bell, label: t('chats.unmute'), run: () => orbAct('inbox.mute', { ...ref, muted: false }) } : { id: 'mute', icon: BellOff, label: t('chats.mute'), run: () => orbAct('inbox.mute', { ...ref, muted: true }) },
    ...(item.unread ? [{ id: 'read', icon: CheckCheck, label: t('chats.markRead'), run: () => orbAct('inbox.markRead', ref) }] : []),
    item.done
      ? { id: 'reopen', icon: Undo2, label: t('orbchats.reopen'), run: () => act(call('conversations.update', { id: item.id, done: false })).then(refreshSoon) }
      : { id: 'complete', icon: CircleCheck, label: t('orbchats.complete'), run: () => act(call('conversations.update', { id: item.id, done: true })).then(refreshSoon) },
    { id: 'delete', icon: Trash2, label: t('orbchats.delete'), danger: true, run: () => deleteChat(item, t) }
  ];
}
// 3.8.2: «Renombrar» from the list's ⋯ (and the chat's own ⋯): the same title a chat or an agent's conversation already has.
export function renameChat(item, t) {
  const method = item.kind === 'session' ? 'sessions.update' : 'conversations.update';
  return form(t('chat.renameTitle'), {
    initial: { title: item.title ?? '' },
    body: (v, set) => <Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} data-testid="rename-input" />,
    ok: t('session.save'),
    onOk: async (v) => { const r = await call(method, { id: item.id, title: v.title.trim() || item.title }); refreshSoon(); loadOrbInbox(); return r; }
  });
}
export async function deleteChat(item, t) {
  if (!(await confirm(t('orbchats.deleteTitle', { title: item.title }), t('orbchats.deleteBody'), { ok: t('orbchats.delete'), danger: true }))) return false;
  const ok = await act(call('conversations.remove', { id: item.id }), t('orbchats.deleted'));
  if (!ok) return false;
  const r = getState().route;
  if (r.view === 'chat' && r.id === item.id) { closeOrbInfo(); go({ view: phoneLayout() ? 'chats' : 'chat' }); }
  refreshSoon(); loadOrbInbox();
  return true;
}

function OrbMenu({ item, open, setOpen, className }) {
  const t = useT();
  const actions = useOrbActions(item);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('text-muted-foreground hover:text-foreground hover:bg-accent grid size-7 shrink-0 cursor-pointer place-items-center rounded-md opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100', className)} aria-label={t('chats.menu', { name: item.title })} data-testid="chat-menu" onClick={(e) => e.stopPropagation()}>
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-testid="chat-menu-list">
        {actions.map((a) => <div key={a.id}>{a.danger ? <DropdownMenuSeparator /> : null}<DropdownMenuItem variant={a.danger ? 'destructive' : undefined} onSelect={a.run} data-testid={`chat-${a.id}`}><a.icon />{a.label}</DropdownMenuItem></div>)}
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
          <DialogTitle className="min-w-0 flex-1 truncate text-[16px] font-semibold">{item.title}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">{t('chats.menu', { name: item.title })}</DialogDescription>
        <div className="grid gap-0.5">
          {actions.map((a) => (
            <button key={a.id} type="button" onClick={() => { onClose(); a.run(); }} data-testid={`chat-${a.id}`}
              className={cn('press flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-accent/60', a.danger && 'text-destructive')}>
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
const OrbRow = memo(function OrbRow({ item, phone, onSheet }) {
  const t = useT();
  const locale = useLocale();
  const active = useStore((s) => isOpen(s.route, item));
  const assistant = useStore((s) => s.app?.config?.assistantName ?? 'Orbe');
  const [menu, setMenu] = useState(false);
  const press = usePress(() => (phone ? onSheet(item) : setMenu(true)));
  const p = orbProgress(item, t, { assistant });
  const time = item.at ? shortTime(item.at, { locale, yesterday: t('chats.yesterday') }) : '';
  const strong = item.unread && !item.muted;
  return (
    <div className={cn('lazy-row group/row relative flex items-center rounded-xl', active ? 'bg-accent' : 'hover:bg-accent/50')} data-testid={`orb-row-${item.title}`} data-kind={item.kind} data-unread={item.unread || 0} {...press}>
      <button type="button" onClick={() => openOrbItem(item)} className={cn('flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2.5 text-left', phone ? 'py-2.5' : 'py-2')} data-testid={`item-${item.kind === 'session' ? 's' : 'c'}${item.id}`}>
        <OrbAvatar item={item} size={phone ? 46 : 40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-[15px]', strong ? 'font-semibold' : 'font-medium', item.done && 'text-foreground/70')}>{item.title}</span>
            <span className={cn('shrink-0 text-[12px] tabular-nums', strong ? 'text-primary font-medium' : 'text-muted-foreground')}>{time}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {p.badge
              ? <span className="bg-warning/18 text-warning-foreground dark:text-warning min-w-0 truncate rounded-md px-1.5 py-px text-[12px] font-medium" data-testid="orb-progress" data-tone={p.tone}>{p.text}</span>
              : (
                <span className={cn('flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px]', p.tone === 'live' ? 'text-primary' : p.tone === 'error' ? 'text-destructive' : p.tone === 'warn' ? 'text-warning-foreground dark:text-warning' : 'text-muted-foreground')} data-testid="orb-progress" data-tone={p.tone}>
                  {p.tone === 'live' ? <span className="bg-primary size-1.5 shrink-0 animate-pulse rounded-full" aria-hidden="true" /> : null}
                  <span className="min-w-0 truncate">{p.prefix ? <span className="text-foreground/70">{p.prefix}</span> : null}{p.text}</span>
                </span>
              )}
            {p.badge ? <span className="flex-1" /> : null}
            {item.muted ? <BellOff className="text-muted-foreground size-3.5 shrink-0" aria-label={t('chats.muted')} /> : null}
            {item.unread ? <span className={cn('min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums', item.muted ? 'bg-muted-foreground/25 text-foreground/70' : 'bg-primary text-primary-foreground')} data-testid="chat-unread" aria-label={t('chats.unread', { n: item.unread })}>{item.unread > 99 ? '99+' : item.unread}</span> : null}
          </span>
        </span>
      </button>
      {phone ? null : <OrbMenu item={item} open={menu} setOpen={setMenu} className="mr-1" />}
    </div>
  );
}, (a, b) => a.phone === b.phone && a.onSheet === b.onSheet && a.day === b.day && sameItem(a.item, b.item));

// ---- a project's heading: its initials in colour, its name; folds its chats; its ⋯: new chat there, its info
function ProjectHead({ group, open, phone }) {
  const t = useT();
  const name = group.project;
  return (
    <div className="group/row text-muted-foreground flex items-center pr-1">
      <CollapsibleTrigger className="hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] font-semibold tracking-wide uppercase" data-testid={`project-head-${name ?? 'none'}`}>
        {name ? <ProjectIcon name={name} size={18} /> : <span className="bg-muted-foreground/30 grid size-[18px] shrink-0 place-items-center rounded-full" aria-hidden="true"><span className="bg-muted-foreground size-1 rounded-full" /></span>}
        <span className="min-w-0 truncate">{name ?? t('orbchats.noProject')}</span>
        {group.waiting ? <span className="bg-warning size-1.5 shrink-0 rounded-full" role="img" aria-label={t('orbchats.awaiting')} /> : group.working ? <span className="bg-primary size-1.5 shrink-0 animate-pulse rounded-full" role="img" aria-label={t('chats.working')} /> : null}
        <span className="flex-1" />
        {group.unread ? <span className="bg-primary size-1.5 rounded-full" aria-label={t('chats.unread', { n: group.unread })} /> : null}
        {open ? null : <span className="tabular-nums opacity-70">{group.items.length}</span>}
        <ChevronRight className={cn('size-3 shrink-0 opacity-60 transition-transform duration-150', open && 'rotate-90')} />
      </CollapsibleTrigger>
      {name ? (
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

// 3.8.1 (H4a): a long list draws its first rows at once and the rest right after, a step each time the window is idle:
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
export function OrbNewMenu({ fab = false }) {
  const t = useT();
  const trigger = fab
    ? <button type="button" className="press bg-primary text-primary-foreground fixed right-4 bottom-[calc(84px+env(safe-area-inset-bottom,0px))] z-30 grid size-14 cursor-pointer place-items-center rounded-2xl shadow-lg" aria-label={t('chats.new')} data-testid="chats-new"><Plus className="size-6" /></button>
    : <Button size="icon" className="size-9 shrink-0 rounded-lg" aria-label={t('chats.new')} data-testid="chats-new"><Plus /></Button>;
  return (
    <DropdownMenu modal={false}>
      {fab ? <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger> : <Tip label={t('chats.new')}><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger></Tip>}
      <DropdownMenuContent align="end" side={fab ? 'top' : 'bottom'} className="w-52">
        <DropdownMenuItem onSelect={() => newChat()} data-testid="new-conversation"><MessageSquarePlus />{t('nav.newChat')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={newProjectChat} data-testid="sidebar-new-project"><FolderPlus />{t('comp.projects.newTitle')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---- the zone's other places (PC): Tareas (with what waits for approval), Proyectos, Programadas, Pizarra, and «Más»
// with God mode when it is on (PC only).
function Places() {
  const t = useT();
  const view = useStore((s) => s.route.view);
  const approvals = useStore((s) => s.tasks.filter((x) => x.status === 'awaiting_approval').length);
  const running = useStore((s) => s.tasks.filter((x) => x.status === 'running').length);
  const config = useStore((s) => s.app?.config);
  const places = [['tasks', ListTodo, 'nav.tasks'], ['projects', FolderKanban, 'nav.projects'], ['schedules', CalendarClock, 'nav.schedules'], ['board', PenTool, 'nav.board']];
  const more = config?.expert?.enabled && fullPc() ? [['expert', SquareTerminal, 'nav.expert']] : [];
  const cls = (on) => cn('press relative flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11.5px] transition-colors', on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground');
  return (
    <nav className={cn('grid gap-0.5 px-2 pb-1', more.length ? 'grid-cols-5' : 'grid-cols-4')} aria-label={t('orbchats.places')} data-testid="orb-places">
      {places.map(([id, Icon, label]) => (
        <button key={id} type="button" className={cls(view === id)} onClick={() => go({ view: id })} data-testid={`nav-${id}`}>
          <Icon className={cn('size-4', view === id && 'text-primary')} /><span className="max-w-full truncate">{t(label)}</span>
          {id === 'tasks' && approvals ? <span className="bg-warning text-warning-foreground absolute -top-0.5 right-[calc(50%-26px)] min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums" aria-label={t('comp.sidebar.waitApproval')} data-testid="nav-tasks-count">{approvals}</span>
            : id === 'tasks' && running ? <span className="bg-primary absolute top-1.5 right-[calc(50%-14px)] size-1.5 animate-pulse rounded-full" aria-hidden="true" /> : null}
        </button>
      ))}
      {more.length ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cls(more.some(([id]) => id === view))} data-testid="orb-places-more"><Ellipsis className="size-4" /><span className="max-w-full truncate">{t('nav.more')}</span></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {more.map(([id, Icon, label]) => <DropdownMenuItem key={id} onSelect={() => go({ view: id })} data-testid={`nav-${id}`}><Icon />{t(label)}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}

// ---- search: titles and projects at once; from two letters, the messages too (inbox.search and, for the direct
// conversations, conversations.search); «#12» finds that task.
function useSearch(query) {
  const [found, setFound] = useState(null);
  useEffect(() => {
    const q = query.trim(); if (q.length < 2) { setFound(null); return undefined; }
    let alive = true;
    const id = setTimeout(async () => {
      const [inbox, direct] = await Promise.all([call('inbox.search', { zone: 'orb', q }).catch(() => null), call('conversations.search', { q }).catch(() => null)]);
      if (alive) setFound({ messages: inbox?.messages ?? [], conversations: new Set([...(inbox?.items ?? []).map((x) => x.id), ...(direct?.conversations ?? [])]), sessions: new Set(direct?.sessions ?? []) });
    }, 220);
    return () => { alive = false; clearTimeout(id); };
  }, [query]);
  return found;
}
const FILTER0 = { state: 'all', agent: 'all' };
function FilterMenu({ filter, setFilter, agents }) {
  const t = useT();
  const changed = filter.state !== 'all' || filter.agent !== 'all';
  const pick = (k, v) => setFilter((f) => ({ ...f, [k]: f[k] === v ? 'all' : v }));
  return (
    <DropdownMenu modal={false}>
      <Tip label={t('orbchats.filter')}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn('relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border', changed ? 'text-primary border-primary/40' : 'text-muted-foreground hover:text-foreground')} aria-label={t('orbchats.filter')} data-testid="sidebar-filter">
            <SlidersHorizontal className="size-4" />{changed ? <span className="notice-dot" aria-hidden="true" /> : null}
          </button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('orbchats.filterState')}</DropdownMenuLabel>
        {[['active', 'orbchats.stateActive'], ['attention', 'orbchats.stateAttention'], ['done', 'orbchats.stateDone']].map(([v, k]) => <DropdownMenuCheckboxItem key={v} checked={filter.state === v} onCheckedChange={() => pick('state', v)} onSelect={(e) => e.preventDefault()} data-testid={`filter-${v}`}>{t(k)}</DropdownMenuCheckboxItem>)}
        {agents.length > 1 ? <><DropdownMenuSeparator /><DropdownMenuLabel>{t('orbchats.filterAgent')}</DropdownMenuLabel>{agents.map((a) => <DropdownMenuCheckboxItem key={a} checked={filter.agent === a} onCheckedChange={() => pick('agent', a)} onSelect={(e) => e.preventDefault()}>{AGENT[a] ?? a}</DropdownMenuCheckboxItem>)}</> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const Sub = ({ children }) => <div className="text-muted-foreground px-2.5 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">{children}</div>;

export function OrbInbox({ page = false }) {
  const t = useT();
  const phone = page && phoneLayout();
  const items = useOrbItems();
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(FILTER0);
  const [showDone, setShowDone] = useState(false);
  const found = useSearch(query);
  const [folded, setFolded] = useFolded();
  const [sheet, setSheet] = useState(null);
  const sheetItem = sheet ? items.find((x) => x.key === sheet) ?? null : null;
  const parts = useMemo(() => groupOrb(items, { showDone, filter }), [items, showDone, filter]);
  const onSheet = useCallback((x) => setSheet(x.key), []);
  // the day: «ayer» and the times of the rows move on at midnight
  const day = useDay();
  const rowProps = { phone, onSheet, day };
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
      tasks: tasks.filter((x) => `#${x.id}` === q || String(x.title).toLowerCase().includes(q)).slice(0, 12),
      projects: projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 10)
    };
  })();

  const search = (
    <div className="flex items-center gap-2">
      <label className="side-search-box bg-background/60 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setFilter(FILTER0); } }} placeholder={t('orbchats.search')} aria-label={t('orbchats.search')} className={cn('placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none', phone ? 'text-[16px]' : 'text-[13.5px]')} data-testid="sidebar-search-input" />
        {query ? <button type="button" className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded" aria-label={t('comp.sidebar.clearSearch')} onClick={() => setQuery('')}><X className="size-3.5" /></button> : null}
      </label>
      <FilterMenu filter={filter} setFilter={setFilter} agents={agents} />
      {phone ? null : <OrbNewMenu />}
    </div>
  );

  let body;
  if (results) body = (
    <div className="grid gap-0.5" data-testid="sidebar-results">
      {results.projects.length ? <><Sub>{t('orbchats.projectsFound')}</Sub>{results.projects.map((p) => (
        <button key={p.name} type="button" className="hover:bg-accent/50 flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[14px]" onClick={() => openOrbInfo({ type: 'project', name: p.name })} data-testid={`found-project-${p.name}`}>
          <ProjectIcon name={p.name} size={28} /><span className="min-w-0 flex-1 truncate">{p.name}</span>
        </button>))}</> : null}
      {results.chats.length ? <><Sub>{t('orbchats.chatsFound')}</Sub>{results.chats.map((x) => <OrbRow key={x.key} item={x} {...rowProps} />)}</> : null}
      {found?.messages?.length ? <><Sub>{t('chats.messages')}</Sub>{found.messages.map((m) => {
        const x = items.find((y) => y.key === m.key); if (!x) return null;
        return (
          <button key={`${m.key}:${m.line.id}`} type="button" onClick={() => openOrbItem(x)} className="hover:bg-accent/50 flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left" data-testid="chats-message-hit">
            <OrbAvatar item={x} size={34} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{x.title}</span><span className="text-muted-foreground block truncate text-[13px]">{m.line.text}</span></span>
          </button>
        );
      })}</> : null}
      {results.tasks.length ? <><Sub>{t('orbchats.tasksFound')}</Sub>{results.tasks.map((x) => (
        <button key={x.id} type="button" onClick={() => go({ view: 'tasks', id: x.id })} className="hover:bg-accent/50 flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px]" data-testid={`item-t${x.id}`}>
          <ListTodo className="text-muted-foreground size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">#{x.id} {x.title}</span><span className="text-muted-foreground shrink-0 text-[12px]">{STATUS[x.status]?.[0] ?? x.status}</span>
        </button>))}</> : null}
      {!results.projects.length && !results.chats.length && !results.tasks.length && !found?.messages?.length ? <p className="text-muted-foreground px-3 py-4 text-sm">{t('chats.noResults')}</p> : null}
    </div>
  );
  else { let left = shown; const take = (list) => { const part = list.slice(0, Math.max(0, left)); left -= part.length; return part; }; body = (
    <>
      {parts.pinned.length ? (
        <div className="pt-2" data-testid="orb-pinned">
          <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-[11.5px] font-semibold tracking-wide uppercase"><Pin className="size-3.5" />{t('chats.pinned')}</div>
          <div className="grid gap-0.5">{take(parts.pinned).map((x) => <OrbRow key={x.key} item={x} {...rowProps} />)}</div>
        </div>
      ) : null}
      {parts.groups.map((g) => {
        const id = g.project ?? '';
        const open = !folded[id];
        return (
          <Collapsible key={id || 'none'} open={open} onOpenChange={(v) => setFolded(id, v)} className="pt-2" data-testid={`orb-group-${g.project ?? 'none'}`}>
            <ProjectHead group={g} open={open} phone={phone} />
            <CollapsibleContent className="grid gap-0.5">
              {(open ? take(g.items) : []).map((x) => <OrbRow key={x.key} item={x} {...rowProps} />)}
              {!g.items.length && g.hidden ? <p className="text-muted-foreground px-3 py-1 text-xs">{t('orbchats.showDone', { n: g.hidden })}</p> : null}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {!items.length ? <p className="text-muted-foreground px-3 py-4 text-sm leading-relaxed" data-testid="orb-empty">{t('orbchats.empty')}</p> : null}
      {parts.hidden || showDone ? (
        <button type="button" onClick={() => setShowDone(!showDone)} className="text-muted-foreground hover:text-foreground hover:bg-accent/50 mt-2 flex cursor-pointer items-center gap-2 self-start rounded-lg px-2.5 py-1.5 text-[13px]" data-testid="sidebar-completed">
          {showDone ? <Undo2 className="size-4" /> : <Check className="size-4" />}{showDone ? t('orbchats.hideDone') : t('orbchats.showDone', { n: parts.hidden })}
        </button>
      ) : null}
    </>
  ); }


  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', page && 'bg-background')} data-testid="orb-inbox">
      <div className={cn('grid gap-2 pb-2', phone ? 'px-4 pt-3' : 'px-3 pt-1')} data-testid="sidebar-search">{search}</div>
      {phone ? null : <Places />}
      <nav className={cn('flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto', phone ? 'px-2 pb-28' : 'px-1.5 pb-3')} aria-label={t('chats.list')} data-testid="mobile-chats">{body}</nav>
      {phone ? <OrbNewMenu fab /> : null}
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
      <OrbInbox page />
    </>
  );
}
