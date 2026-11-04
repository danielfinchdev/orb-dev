// 3.6 (messaging, step M2): the Bots zone's chat list (docs/DESIGN-SYSTEM.md › 2.5, mockup mensajeria.html). On the PC it
// is the left pane under «Orb | Bots»; on the phone the «Chats» tab. From the top: search and «+» (Nuevo bot, Nuevo grupo,
// Nueva sección), the zone's other places (PC), the pinned bots and groups as big avatars (only there, never repeated
// below; dragged to reorder on the PC), the user's sections (folding) and «Sin asignar». Each row: avatar, name, time,
// the last message (a forward arrow when one bot wrote to another) and the unread count. Right click or ⋯ (PC) and a long
// press (phone) open the chat's menu: pin, move to a section, mute, mark as read, delete the chat.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, X, Bell, Home, BookOpen, Server, Ellipsis, ChevronRight, Pin, PinOff, BellOff, FolderInput, Trash2, CheckCheck, Bot, Users, Settings2, Pencil, Forward, FolderPlus, Check, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { PageHeader } from '@/components/page.jsx';
import { Input, Field } from '@/components/ui/basic.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, Collapsible, CollapsibleTrigger, CollapsibleContent, Dialog, DialogContent, DialogTitle, DialogDescription, Tip } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { useStore, go, botCall, loadInbox, inboxAct, setState, phoneLayout } from '@/lib/store.js';
import { splitInbox, shortTime, previewOf } from '@/lib/inbox.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { useBots, useCanManage, BotFace, GroupFace, NoBots, BotsDown, Loading, CentroBadge } from './common.jsx';

// ---- data: the list of the zone, loaded once and kept fresh by main.jsx (inbox:changed, bot.message, bot.state)
export function useInbox() {
  const inbox = useStore((s) => s.inbox);
  const version = useStore((s) => s.version);
  useEffect(() => { loadInbox(); }, [version]);
  return inbox;
}
// The chat of a route ({ view: 'bot-chat' | 'bot-group', id }) in the list.
export const itemOfRoute = (inbox, route) => (inbox?.items ?? []).find((x) => x.kind === (route.view === 'bot-group' ? 'group' : 'bot') && x.id === Number(route.id)) ?? null;
const openItem = (x) => go({ view: x.kind === 'group' ? 'bot-group' : 'bot-chat', id: x.id });
const isOpen = (route, x) => (route.view === 'bot-chat' || route.view === 'bot-group') && (route.view === 'bot-group') === (x.kind === 'group') && Number(route.id) === x.id;

// The avatar of a chat: the bot's (with its live state and the chief's star) or the group's members together.
export function ItemAvatar({ item, size = 44, bots, botsById }) {
  if (item.kind === 'group') return <GroupFace group={{ members: item.members ?? [] }} bots={bots} size={size} />;
  const bot = botsById.get(item.id) ?? { id: item.id, name: item.title };
  return <BotFace bot={bot} size={size} busy={item.state === 'working'} chief={item.chief} />;
}

// ---- a long press (touch) or a right click (mouse) opens the menu; the click that follows a long press is swallowed.
function usePress(onMenu, ms = 480) {
  const timer = useRef(null); const start = useRef(null); const fired = useRef(false);
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  return {
    onPointerDown: (e) => {
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      start.current = [e.clientX, e.clientY];
      timer.current = setTimeout(() => { fired.current = true; navigator.vibrate?.(8); onMenu(); }, ms);
    },
    onPointerMove: (e) => { if (timer.current && start.current && Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 8) clear(); },
    onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear,
    onContextMenu: (e) => { e.preventDefault(); if (!fired.current && !timer.current) onMenu(); },
    onClickCapture: (e) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } }
  };
}

// ---- what can be done with a chat (the same list in the PC's menu and the phone's sheet)
function useChatActions(item, inbox) {
  const t = useT();
  const me = useStore((s) => s.me?.person?.id ?? null);
  const { groups } = useBots();
  if (!item) return [];
  const ref = { kind: item.kind, id: item.id };
  const group = item.kind === 'group' ? groups.find((g) => g.id === item.id) : null;
  // A group's chat is one for everyone in it: only whose the group is may empty it (the engine checks it too).
  const canClear = item.kind === 'bot' || !group || group.person_id == null || me == null || group.person_id === me;
  const sections = inbox?.sections ?? [];
  return [
    item.pinned ? { id: 'unpin', icon: PinOff, label: t('chats.unpin'), run: () => inboxAct('inbox.unpin', ref) } : { id: 'pin', icon: Pin, label: t('chats.pin'), run: () => inboxAct('inbox.pin', ref) },
    { id: 'move', icon: FolderInput, label: t('chats.move'), sub: [
      ...sections.map((s) => ({ id: `s${s.id}`, label: s.name, checked: item.section === s.id, run: () => inboxAct('inbox.sections.move', { ...ref, section: s.id }) })),
      { id: 'none', label: t('chats.noSection'), checked: item.section == null, run: () => inboxAct('inbox.sections.move', { ...ref, section: null }) },
      { id: 'new', icon: FolderPlus, label: t('chats.newSection'), run: async () => { const s = await newSection(t); if (s) await inboxAct('inbox.sections.move', { ...ref, section: s.id }); } }
    ] },
    item.muted ? { id: 'unmute', icon: Bell, label: t('chats.unmute'), run: () => inboxAct('inbox.mute', { ...ref, muted: false }) } : { id: 'mute', icon: BellOff, label: t('chats.mute'), run: () => inboxAct('inbox.mute', { ...ref, muted: true }) },
    ...(item.unread ? [{ id: 'read', icon: CheckCheck, label: t('chats.markRead'), run: () => inboxAct('inbox.markRead', ref) }] : []),
    ...(canClear ? [{ id: 'clear', icon: Trash2, label: t('chats.clear'), danger: true, run: async () => {
      if (!(await confirm(t('chats.clearTitle', { name: item.title }), item.kind === 'group' ? t('chats.clearBodyGroup') : t('chats.clearBody'), { ok: t('chats.clearOk'), danger: true }))) return;
      await inboxAct('inbox.clear', ref, t('chats.cleared'));
      setState((s) => ({ chatCleared: (s.chatCleared ?? 0) + 1 }));
    } }] : [])
  ];
}
async function newSection(t) {
  let made = null;
  await form(t('chats.newSection'), {
    initial: { name: '' },
    body: (v, set) => <Field label={t('chats.sectionName')}><Input autoFocus value={v.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder={t('chats.sectionPh')} data-testid="section-name" /></Field>,
    ok: t('chats.create'),
    onOk: async (v) => { if (!v.name.trim()) return false; made = await inboxAct('inbox.sections.create', { zone: 'bots', name: v.name.trim() }); return Boolean(made); }
  });
  return made;
}

// The PC: a ⋯ button (shown on hover or focus) whose menu also opens with a right click on the row.
function ChatMenu({ item, inbox, open, setOpen, className }) {
  const t = useT();
  const actions = useChatActions(item, inbox);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('text-muted-foreground hover:text-foreground hover:bg-accent grid size-7 shrink-0 cursor-pointer place-items-center rounded-md opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100', className)} aria-label={t('chats.menu', { name: item.title })} data-testid="chat-menu" onClick={(e) => e.stopPropagation()}>
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-testid="chat-menu-list">
        {actions.map((a) => (a.sub ? (
          <div key={a.id}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2"><a.icon className="size-3.5" />{a.label}</DropdownMenuLabel>
            {a.sub.map((s) => <DropdownMenuItem key={s.id} onSelect={s.run} data-testid={`chat-move-${s.id}`} className="pl-7">{s.icon ? <s.icon /> : null}<span className="min-w-0 flex-1 truncate">{s.label}</span>{s.checked ? <Check className="text-primary! size-3.5" /> : null}</DropdownMenuItem>)}
            <DropdownMenuSeparator />
          </div>
        ) : (<div key={a.id}>{a.danger ? <DropdownMenuSeparator /> : null}<DropdownMenuItem variant={a.danger ? 'destructive' : undefined} onSelect={a.run} data-testid={`chat-${a.id}`}><a.icon />{a.label}</DropdownMenuItem></div>)))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The phone: a sheet from the bottom with the chat's avatar and name, then its actions (moving opens the sections).
function ChatSheet({ item, inbox, bots, botsById, onClose }) {
  const t = useT();
  const actions = useChatActions(item, inbox);
  const [moving, setMoving] = useState(false);
  const run = (fn) => () => { onClose(); fn(); };
  const row = (a) => (
    <button key={a.id} type="button" onClick={a.sub ? () => setMoving(true) : run(a.run)} data-testid={`chat-${a.id}`}
      className={cn('press flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-accent/60', a.danger && 'text-destructive')}>
      {a.icon ? <a.icon className={cn('size-5 shrink-0', a.danger ? 'text-destructive' : 'text-muted-foreground')} /> : <span className="size-5" />}
      <span className="min-w-0 flex-1 truncate">{a.label}</span>
      {a.checked ? <Check className="text-primary size-4" /> : a.sub ? <ChevronRight className="text-muted-foreground size-4" /> : null}
    </button>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-sheet="bottom" showClose={false} className="gap-2" data-testid="chat-sheet">
        <div className="flex items-center gap-3 px-1 pb-1">
          <ItemAvatar item={item} size={40} bots={bots} botsById={botsById} />
          <DialogTitle className="min-w-0 flex-1 truncate text-[16px] font-semibold">{moving ? t('chats.move') : item.title}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">{t('chats.menu', { name: item.title })}</DialogDescription>
        <div className="grid gap-0.5">{moving ? actions.find((a) => a.sub)?.sub.map(row) : actions.map(row)}</div>
      </DialogContent>
    </Dialog>
  );
}

// ---- a row of the list
function ChatRow({ item, inbox, bots, botsById, phone, onSheet }) {
  const t = useT();
  const locale = useLocale();
  const route = useStore((s) => s.route);
  const me = useStore((s) => s.me?.person?.id ?? null);
  const [menu, setMenu] = useState(false);
  const press = usePress(() => (phone ? onSheet(item) : setMenu(true)));
  const active = isOpen(route, item);
  const p = previewOf(item, t, { me });
  const time = item.lastMessage?.at ? shortTime(item.lastMessage.at, { locale, yesterday: t('chats.yesterday') }) : '';
  return (
    <div className={cn('group/row relative flex items-center rounded-xl', active ? 'bg-accent' : 'hover:bg-accent/50')} data-testid={`chat-row-${item.title}`} data-kind={item.kind} data-unread={item.unread || 0} {...press}>
      <button type="button" onClick={() => openItem(item)} className={cn('flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2.5 text-left', phone ? 'py-2.5' : 'py-2')} data-testid={item.kind === 'group' ? `side-group-${item.title}` : `side-bot-${item.title}`}>
        <ItemAvatar item={item} size={phone ? 48 : 42} bots={bots} botsById={botsById} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-[15px]', item.unread && !item.muted ? 'font-semibold' : 'font-medium')}>{item.title}</span>
            <span className={cn('shrink-0 text-[12px] tabular-nums', item.unread && !item.muted ? 'text-primary font-medium' : 'text-muted-foreground')}>{time}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className={cn('min-w-0 flex-1 truncate text-[13px]', p.tone === 'live' ? 'text-primary' : 'text-muted-foreground')} data-testid="chat-preview">
              {p.relay ? <Forward className="mr-1 inline size-3.5 -translate-y-px" aria-label={t('chats.relay')} /> : null}
              {p.prefix ? <span className="text-foreground/70">{p.prefix}</span> : null}{p.text}
            </span>
            {item.muted ? <BellOff className="text-muted-foreground size-3.5 shrink-0" aria-label={t('chats.muted')} /> : null}
            {item.unread ? <span className={cn('min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums', item.muted ? 'bg-muted-foreground/25 text-foreground/70' : 'bg-primary text-primary-foreground')} data-testid="chat-unread" aria-label={t('chats.unread', { n: item.unread })}>{item.unread > 99 ? '99+' : item.unread}</span> : null}
          </span>
        </span>
      </button>
      {phone ? null : <ChatMenu item={item} inbox={inbox} open={menu} setOpen={setMenu} className="mr-1" />}
    </div>
  );
}

// ---- the pinned row: big avatars with the name under them; dragged to reorder (PC)
function PinnedRow({ items, inbox, bots, botsById, phone, onSheet }) {
  const t = useT();
  const route = useStore((s) => s.route);
  const [drag, setDrag] = useState(null);
  const drop = async (target) => {
    if (drag == null || drag === target) return setDrag(null);
    const keys = items.map((x) => x.key).filter((k) => k !== drag);
    keys.splice(keys.indexOf(target), 0, drag);
    setDrag(null);
    // At once on screen; the engine keeps the order.
    setState((s) => ({ inbox: s.inbox ? { ...s.inbox, items: s.inbox.items.map((x) => (x.pinned ? { ...x, pinOrder: keys.indexOf(x.key) } : x)) } : s.inbox }));
    await inboxAct('inbox.reorderPins', { zone: 'bots', order: keys });
  };
  return (
    <div className={cn('flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]', phone ? 'px-3' : 'px-2')} role="list" aria-label={t('chats.pinned')} data-testid="chat-pinned">
      {items.map((x) => <PinnedItem key={x.key} item={x} inbox={inbox} bots={bots} botsById={botsById} phone={phone} onSheet={onSheet} active={isOpen(route, x)} drag={drag} setDrag={setDrag} drop={drop} />)}
    </div>
  );
}
function PinnedItem({ item, inbox, bots, botsById, phone, onSheet, active, drag, setDrag, drop }) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const press = usePress(() => (phone ? onSheet(item) : setMenu(true)));
  return (
    <div role="listitem" className={cn('group/row relative shrink-0 rounded-2xl', active ? 'bg-accent' : 'hover:bg-accent/50', drag === item.key && 'opacity-50')} data-testid={`pinned-${item.title}`}
      draggable={!phone} onDragStart={(e) => { setDrag(item.key); e.dataTransfer.effectAllowed = 'move'; }} onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); drop(item.key); }} onDragEnd={() => setDrag(null)} {...press}>
      <button type="button" onClick={() => openItem(item)} className={cn('relative grid cursor-pointer justify-items-center gap-1 px-1.5 pt-2 pb-1.5', phone ? 'w-[84px]' : 'w-[74px]')} aria-label={item.unread ? `${item.title} · ${t('chats.unread', { n: item.unread })}` : item.title}>
        <ItemAvatar item={item} size={phone ? 60 : 52} bots={bots} botsById={botsById} />
        <span className="max-w-full truncate text-[12.5px]">{item.title}</span>
        {item.unread ? <span className={cn('absolute top-1.5 right-2 size-3 rounded-full ring-2 ring-sidebar', item.muted ? 'bg-muted-foreground/50' : 'bg-primary')} data-testid="chat-unread-dot" /> : null}
      </button>
      {phone ? null : <ChatMenu item={item} inbox={inbox} open={menu} setOpen={setMenu} className="bg-background/80 absolute top-0.5 right-0.5 size-6" />}
    </div>
  );
}

// ---- a section's heading: folds its chats; its ⋯ renames or deletes it
function SectionHead({ section, open, onOpen, phone }) {
  const t = useT();
  const rename = () => form(t('chats.renameSection'), {
    initial: { name: section.name },
    body: (v, set) => <Field label={t('chats.sectionName')}><Input autoFocus value={v.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} data-testid="section-name" /></Field>,
    ok: t('bots.save'),
    onOk: async (v) => (v.name.trim() ? Boolean(await inboxAct('inbox.sections.rename', { id: section.id, name: v.name.trim() })) : false)
  });
  const remove = async () => { if (await confirm(t('chats.deleteSectionTitle', { name: section.name }), t('chats.deleteSectionBody'), { ok: t('bots.delete'), danger: true })) inboxAct('inbox.sections.delete', { id: section.id }); };
  return (
    <div className="group/row text-muted-foreground flex items-center pr-1">
      <CollapsibleTrigger className="hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-medium tracking-wide uppercase" data-testid={`section-${section.name}`}>
        <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-150', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">{section.name}</span>
        {section.unread ? <span className="bg-primary size-1.5 rounded-full" aria-label={t('chats.unread', { n: section.unread })} /> : null}
        <span className="tabular-nums opacity-70">{section.items.length}</span>
      </CollapsibleTrigger>
      {section.id == null ? null : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn('hover:text-foreground hover:bg-accent grid size-7 cursor-pointer place-items-center rounded-md', phone ? '' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100')} aria-label={t('chats.sectionMenu', { name: section.name })} data-testid={`section-menu-${section.name}`}><Ellipsis className="size-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={rename}><Pencil />{t('chats.renameSection')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove} data-testid="section-delete"><Trash2 />{t('chats.deleteSection')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// Folded sections, remembered on this device.
function useFolded() {
  const KEY = 'orb.seccionesBots';
  const [folded, setRaw] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {}; } catch { return {}; } });
  const set = (id, open) => setRaw((f) => { const next = { ...f, [id]: !open }; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });
  return [folded, set];
}

// ---- the «+»: Nuevo bot, Nuevo grupo, Nueva sección
export function NewMenu({ fab = false }) {
  const t = useT();
  const manage = useCanManage();
  const { bots } = useBots();
  const trigger = fab
    ? <button type="button" className="press bg-primary text-primary-foreground fixed right-4 bottom-[calc(84px+env(safe-area-inset-bottom,0px))] z-30 grid size-14 cursor-pointer place-items-center rounded-2xl shadow-lg" aria-label={t('chats.new')} data-testid="chats-new"><Plus className="size-6" /></button>
    : <Button size="icon" className="size-9 shrink-0 rounded-lg" aria-label={t('chats.new')} data-testid="chats-new"><Plus /></Button>;
  return (
    <DropdownMenu modal={false}>
      {fab ? <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger> : <Tip label={t('chats.new')}><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger></Tip>}
      <DropdownMenuContent align="end" side={fab ? 'top' : 'bottom'} className="w-52">
        {manage ? <DropdownMenuItem onSelect={() => go({ view: 'bots', id: 'new' })} data-testid="bots-nav-new"><Bot />{t('bots.new')}</DropdownMenuItem> : null}
        {manage && bots.length ? <DropdownMenuItem onSelect={() => setState({ newGroup: true })} data-testid="group-new"><UserPlus />{t('bots.groups.new')}</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => newSection(t)} data-testid="section-new"><FolderPlus />{t('chats.newSection')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---- the zone's other places (PC): a row of icon buttons, each with its name in a bubble (the names did not fit the
// list's width), and «Más» (all bots, groups, the bots' settings). The name is also each button's accessible name.
export const BOT_PLACES = [['bot-reminders', Bell, 'nav.botReminders'], ['bot-home', Home, 'nav.botHome'], ['bot-memory', BookOpen, 'nav.botMemory'], ['bot-server', Server, 'nav.botServer']];
function Places() {
  const t = useT();
  const view = useStore((s) => s.route.view);
  const more = [['bots', Bot, 'nav.bots'], ['bot-groups', Users, 'nav.botGroups'], ['bot-settings', Settings2, 'nav.botSettings']];
  const cls = (on) => cn('press grid h-9 min-w-0 cursor-pointer place-items-center rounded-lg transition-colors', on ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground');
  return (
    <nav className="grid grid-cols-5 gap-1 px-3 pb-1.5" aria-label={t('chats.places')} data-testid="bots-places">
      {BOT_PLACES.map(([id, Icon, label]) => (
        <Tip key={id} label={t(label)} side="bottom"><button type="button" className={cls(view === id)} onClick={() => go({ view: id })} aria-label={t(label)} data-testid={`nav-${id}`}><Icon className="size-[18px]" /></button></Tip>
      ))}
      <DropdownMenu modal={false}>
        <Tip label={t('nav.more')} side="bottom">
          <DropdownMenuTrigger asChild>
            <button type="button" className={cls(more.some(([id]) => id === view))} aria-label={t('nav.more')} data-testid="bots-places-more"><Ellipsis className="size-[18px]" /></button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end">
          {more.map(([id, Icon, label]) => <DropdownMenuItem key={id} onSelect={() => go({ view: id })} data-testid={`nav-${id}`}><Icon />{t(label)}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

// ---- search: the names at once; from two letters, the messages too (inbox.search)
function useSearch(query) {
  const [found, setFound] = useState(null);
  useEffect(() => {
    const q = query.trim(); if (q.length < 2) { setFound(null); return undefined; }
    let alive = true;
    const id = setTimeout(() => botCall('inbox.search', { zone: 'bots', q }).then((r) => alive && setFound(r)).catch(() => alive && setFound(null)), 220);
    return () => { alive = false; clearTimeout(id); };
  }, [query]);
  return found;
}

export function BotsInbox({ page = false }) {
  const t = useT();
  const phone = page && phoneLayout();
  const inbox = useInbox();
  const { bots, groups, loaded, error } = useBots();
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const [query, setQuery] = useState('');
  const found = useSearch(query);
  const [folded, setFolded] = useFolded();
  const [sheet, setSheet] = useState(null);
  const sheetItem = sheet ? (inbox?.items ?? []).find((x) => x.key === sheet) ?? null : null;
  const parts = useMemo(() => splitInbox(inbox), [inbox]);
  const rowProps = { inbox, bots, botsById, phone, onSheet: (x) => setSheet(x.key) };

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const byKey = new Map((inbox?.items ?? []).map((x) => [x.key, x]));
  const titleHits = searching ? (inbox?.items ?? []).filter((x) => x.title.toLowerCase().includes(q) || found?.items?.some((f) => f.key === x.key)) : [];

  const search = (
    <div className="flex items-center gap-2">
      <label className="side-search-box bg-background/60 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} placeholder={t('chats.search')} aria-label={t('chats.search')} className={cn('placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none', phone ? 'text-[16px]' : 'text-[13.5px]')} data-testid="chats-search" />
        {query ? <button type="button" className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded" aria-label={t('comp.sidebar.clearSearch')} onClick={() => setQuery('')}><X className="size-3.5" /></button> : null}
      </label>
      {phone ? null : <NewMenu />}
    </div>
  );

  let body;
  if (!loaded && !inbox) body = error ? <BotsDown error={error} /> : <Loading />;
  else if (!bots.length && !groups.length) body = <NoBots />;
  else if (!inbox) body = <Loading />;
  else if (searching) body = (
    <div className="grid gap-0.5" data-testid="chats-results">
      {titleHits.map((x) => <ChatRow key={x.key} item={x} {...rowProps} />)}
      {found?.messages?.length ? <div className="text-muted-foreground px-2.5 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">{t('chats.messages')}</div> : null}
      {(found?.messages ?? []).map((m) => {
        const x = byKey.get(m.key); if (!x) return null;
        return (
          <button key={`${m.key}:${m.line.id}`} type="button" onClick={() => openItem(x)} className="hover:bg-accent/50 flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left" data-testid="chats-message-hit">
            <ItemAvatar item={x} size={36} bots={bots} botsById={botsById} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{x.title}</span><span className="text-muted-foreground block truncate text-[13px]">{m.line.text}</span></span>
          </button>
        );
      })}
      {!titleHits.length && !found?.messages?.length ? <p className="text-muted-foreground px-3 py-4 text-sm">{t('chats.noResults')}</p> : null}
    </div>
  );
  else body = (
    <>
      {parts.pinned.length ? <PinnedRow items={parts.pinned} {...rowProps} /> : null}
      {parts.sections.map((s) => {
        const open = !folded[s.id];
        return (
          <Collapsible key={s.id} open={open} onOpenChange={(v) => setFolded(s.id, v)} className="pt-2" data-testid={`chat-section-${s.name}`}>
            <SectionHead section={s} open={open} phone={phone} />
            <CollapsibleContent className="grid gap-0.5">
              {s.items.length ? s.items.map((x) => <ChatRow key={x.key} item={x} {...rowProps} />) : <p className="text-muted-foreground px-3 py-1.5 text-xs">{t('chats.sectionEmpty')}</p>}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {parts.loose.length ? (
        parts.sections.length ? (
          <Collapsible open={!folded.loose} onOpenChange={(v) => setFolded('loose', v)} className="pt-2" data-testid="chat-section-loose">
            <SectionHead section={{ id: null, name: t('chats.unassigned'), items: parts.loose, unread: parts.loose.reduce((n, x) => n + (x.muted ? 0 : x.unread || 0), 0) }} open={!folded.loose} phone={phone} />
            <CollapsibleContent className="grid gap-0.5">{parts.loose.map((x) => <ChatRow key={x.key} item={x} {...rowProps} />)}</CollapsibleContent>
          </Collapsible>
        ) : <div className="grid gap-0.5 pt-1">{parts.loose.map((x) => <ChatRow key={x.key} item={x} {...rowProps} />)}</div>
      ) : null}
      <button type="button" onClick={() => newSection(t)} className="text-primary hover:bg-accent/50 mt-2 flex cursor-pointer items-center gap-2 self-start rounded-lg px-2.5 py-1.5 text-[13px]" data-testid="section-new-inline"><Plus className="size-4" />{t('chats.newSection')}</button>
    </>
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', page && 'bg-background')} data-testid="bot-inbox">
      <div className={cn('grid gap-2 pb-2', phone ? 'px-4 pt-3' : 'px-3 pt-1')}>{search}</div>
      {phone ? null : <Places />}
      <CentroBadge className="px-4 pb-1" />
      <nav className={cn('flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto', phone ? 'px-2 pb-28' : 'px-1.5 pb-3')} aria-label={t('chats.list')} data-testid="bots-nav">{body}</nav>
      {phone ? <NewMenu fab /> : null}
      {sheetItem ? <ChatSheet item={sheetItem} {...rowProps} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

// The phone's «Chats» tab of the Bots zone.
export function BotChatsView() {
  const t = useT();
  return (
    <>
      <PageHeaderLite title={t('nav.modeBots')} />
      <BotsInbox page />
    </>
  );
}
// The phone's bar: ☰ and a large title (the glass build styles it, glass.css).
function PageHeaderLite({ title }) { return <PageHeader title={title} className="chats-head" />; }
