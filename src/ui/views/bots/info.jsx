// 3.6 (messaging, M2): a chat's info, opened by clicking the name in the conversation's header (mockup mensajeria.html
// ?s=info). The PC: a pane on the right, closed with ✕. The phone: the whole screen (a glass sheet on Android).
// A bot: avatar, name, role, «Editar»; Cerebro, Herramientas, Apps conectadas, Rutinas, Biblioteca (each opens where it is
// changed); Notificaciones (on/off at once: the chat's mute); Pausar, Compartir, Eliminar (red, last).
// A group: its avatar, name and members (add or remove bots and people), Notificaciones, Renombrar, Compartir, Salir del
// grupo (someone else's) or Eliminar (one's own).
import { useEffect, useState } from 'react';
import { X, Pencil, Globe, Bell, AppWindow, Repeat, BookOpen, ChevronRight, Pause, Play, Share2, Trash2, LogOut, UserPlus, UserMinus, Crown, Plus } from 'lucide-react';
import { BrainIcon } from '@/components/brain-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Field, Input, Spinner } from '@/components/ui/basic.jsx';
import { Dialog, DialogContent, DialogTitle, DialogDescription, Switch, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { openShare } from '@/components/share-dialog.jsx';
import { useStore, botCall, act, go, loadBots, loadBotsSoon, inboxAct, loadInboxSoon, phoneLayout } from '@/lib/store.js';
import { useCatalog, modelLabel } from '@/components/brain-picker.jsx';
import { personsOn } from '@/lib/persons.js';
import { AGENT } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { useBots, useCanManage, BotFace, GroupFace } from './common.jsx';
import { moveBot, offerMerge, HomeBadge } from './home.jsx';
import { useHomes, hasCap, openBrowserLive, onServer } from '@/lib/server.js';
import { homeOf, replicaActions, moveTargets, moveLabel } from '@/lib/homes.js';
import { ArrowRightLeft, Compass, Server, Monitor, CopyPlus } from 'lucide-react';

// The frame: a pane (PC) or a full sheet (phone).
export function InfoFrame({ title, onClose, children }) {
  const t = useT();
  if (phoneLayout()) return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-sheet="full" showClose={false} className="flex flex-col gap-3 overflow-y-auto *:shrink-0" data-testid="chat-info">
        <div className="grid grid-cols-[40px_1fr_40px] items-center">
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label={t('comp.close')} data-testid="chat-info-close"><X /></Button>
          <DialogTitle className="text-center text-base font-semibold">{title}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">{title}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
  return (
    <aside className="bg-sidebar/60 flex w-[340px] shrink-0 flex-col border-l" aria-label={title} data-testid="chat-info">
      <div className="app-titlebar flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
        <Button size="icon-sm" variant="ghost" className="no-drag" onClick={onClose} aria-label={t('comp.close')} data-testid="chat-info-close"><X /></Button>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 py-5">{children}</div>
    </aside>
  );
}

// A group of rows (DESIGN-SYSTEM §4: list group) and a row: icon, label, value, chevron when it opens something.
export const List = ({ children, testid }) => <div className="bg-card divide-y overflow-hidden rounded-2xl border" data-testid={testid}>{children}</div>;
export function Row({ icon: Icon, label, value, onClick, danger, testid, children }) {
  const inner = (<>
    {Icon ? <Icon className={cn('size-[18px] shrink-0', danger ? 'text-destructive' : 'text-muted-foreground')} /> : null}
    <span className={cn('truncate', value != null ? 'shrink-0' : 'min-w-0 flex-1')}>{label}</span>
    {value != null ? <span className="text-muted-foreground min-w-0 flex-1 truncate text-right text-[13px]">{value}</span> : null}
    {children}
    {onClick && !danger && !children ? <ChevronRight className="text-muted-foreground size-4 shrink-0" /> : null}
  </>);
  const cls = cn('flex min-h-11 w-full items-center gap-3 px-3.5 py-2 text-left text-[14px]', danger && 'text-destructive', onClick && 'hover:bg-accent/50 cursor-pointer');
  return onClick ? <button type="button" className={cls} onClick={onClick} data-testid={testid}>{inner}</button> : <div className={cls} data-testid={testid}>{inner}</div>;
}

function NotifyRow({ item }) {
  const t = useT();
  const muted = Boolean(item?.muted);
  return (
    <div>
      <List><label className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 text-[14px]"><Bell className="text-muted-foreground size-[18px] shrink-0" /><span className="flex-1">{t('chats.notifications')}</span>
        <Switch checked={!muted} disabled={!item} onCheckedChange={(on) => inboxAct('inbox.mute', { kind: item.kind, id: item.id, muted: !on })} data-testid="info-notify" /></label></List>
      <p className="text-muted-foreground px-1 pt-1.5 text-[12px]">{muted ? t('chats.notifyOff') : t('chats.notifyOn')}</p>
    </div>
  );
}

// ---- a bot
export function BotInfo({ bot, item, onClose }) {
  const t = useT();
  const manage = useCanManage();
  const catalog = useCatalog();
  const me = useStore((s) => s.me);
  const [full, setFull] = useState(null);
  useEffect(() => { let alive = true; botCall('bots.get', { id: bot.id }).then((b) => alive && setFull(b)).catch(() => alive && setFull(false)); return () => { alive = false; }; }, [bot.id, bot.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  // 3.7: where it runs, and what may be done from here (a bot run elsewhere changes there, while that Orb answers).
  const homes = useHomes();
  const server = useStore((s) => s.server);
  const { bots } = useBots();
  const home = homeOf(bot);
  const ra = replicaActions(bot);
  const edit = manage && ra.change ? () => go({ view: 'bots', id: bot.id }) : null;
  const moves = ra.move ? moveTargets(bot, homes) : [];
  const live = (home.kind === 'server' || (home.here && onServer())) && home.online && hasCap(server, 'browser.live.v1');
  // Two bots of the same name in the same place (one came with a move): merge them.
  const twin = bots.find((b) => b.id !== bot.id && b.homeState !== 'archived' && String(b.name).trim().toLowerCase() === String(bot.name).trim().toLowerCase() && (b.home ?? null) === (bot.home ?? null));
  const tools = (full?.effectiveTools ?? full?.tools ?? bot.effectiveTools ?? bot.tools ?? []).map((x) => t(`bots.tool.${x}`));
  const apps = full?.accounts?.mcp?.length ?? 0;
  const reminders = (full?.reminderList ?? []).length;
  const mine = !bot.person_id || bot.person_id === me?.person?.id;
  const pause = async () => { await act(botCall('bots.pause', { id: bot.id, paused: !bot.paused })); loadBotsSoon(); loadInboxSoon(); };
  const remove = async () => {
    if (!(await confirm(t('bots.deleteTitle', { name: bot.name }), t('bots.deleteBody'), { ok: t('bots.delete'), danger: true }))) return;
    if (await act(botCall('bots.delete', { id: bot.id }), t('bots.deleted'))) { onClose(); await loadBots(); loadInboxSoon(0); go({ view: phoneLayout() ? 'bot-chats' : 'bot-chat' }); }
  };
  return (
    <InfoFrame title={t('chats.botInfo')} onClose={onClose}>
      <div className="grid justify-items-center gap-1.5 pb-1 text-center">
        <BotFace bot={bot} size={88} chief={bot.is_chief} label={t('bots.av.aria', { name: bot.name })} />
        <h3 className="mt-1 text-xl font-semibold" data-testid="info-name">{bot.name}</h3>
        <p className="text-muted-foreground max-w-[30ch] text-[13px] leading-snug">{bot.role_text || t('bots.noRole')}</p>
        {edit ? <Button size="sm" variant="outline" className="mt-1" onClick={edit} data-testid="bot-chat-edit"><Pencil />{t('bots.edit')}</Button> : null}
        {!ra.change && !home.here ? <p className="text-muted-foreground max-w-[30ch] text-[12px]" data-testid="info-readonly">{ra.restore ? t('home.archivedHint') : t('home.changeWhenOnline', { name: home.kind === 'server' ? t('home.badge.server') : home.name })}</p> : null}
      </div>
      {twin && mine ? (
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px]" data-testid="info-twin">
          <CopyPlus className="text-muted-foreground size-4 shrink-0" /><span className="min-w-0 flex-1">{t('home.twin', { name: twin.name })}</span>
          <Button size="xs" variant="outline" onClick={() => offerMerge({ id: bot.id, name: bot.name }, { uid: twin.uid, name: twin.name })} data-testid="info-merge">{t('home.sameMerge')}</Button>
        </div>
      ) : null}
      <List testid="info-home">
        <Row icon={home.kind === 'server' || (home.here && onServer()) ? Server : Monitor} label={t('home.where')} testid="info-where"><span className="min-w-0 flex-1" /><HomeBadge bot={bot} /></Row>
        {mine ? moves.map((x) => <Row key={x.key} icon={ArrowRightLeft} label={moveLabel(x, t, { serverHere: onServer() })} onClick={() => moveBot(bot, x)} testid={`info-move-${x.here ? 'here' : 'server'}`} />) : null}
        {live ? <Row icon={Compass} label={t('browserLive.open')} onClick={() => openBrowserLive()} testid="info-browser-live" /> : null}
      </List>
      <List testid="info-bot-parts">
        <Row icon={BrainIcon} label={t('chats.brain')} value={`${AGENT[bot.agent] ?? bot.agent}${bot.model ? ` ${modelLabel(catalog, bot.agent, bot.model)}` : ''} · ${t(`bots.effort.${bot.effort ?? 'medium'}`)}`} onClick={edit} testid="info-brain" />
        <Row icon={Globe} label={t('bots.f.tools')} value={tools.length ? tools.join(', ') : t('chats.none')} onClick={edit} testid="info-tools" />
        <Row icon={AppWindow} label={t('chats.apps')} value={full == null ? <Spinner className="size-3" /> : String(apps)} onClick={edit} testid="info-apps" />
        <Row icon={Repeat} label={t('chats.routines')} value={full == null ? null : String(reminders)} onClick={() => go({ view: 'bot-reminders' })} testid="info-routines" />
        <Row icon={BookOpen} label={t('nav.botMemory')} onClick={() => go({ view: 'bot-memory', bot: bot.id })} testid="info-library" />
      </List>
      <NotifyRow item={item} />
      <List>
        {ra.change ? <Row icon={bot.paused ? Play : Pause} label={bot.paused ? t('chats.resumeBot') : t('chats.pauseBot')} onClick={pause} testid="bot-chat-pause"><span /></Row> : null}
        {personsOn(me) && mine ? <Row icon={Share2} label={t('chats.shareBot')} onClick={() => openShare({ type: 'bot', id: bot.id, name: bot.name, owner: bot.person_id ?? null })} testid="info-share" /> : null}
        {manage && mine && ra.change ? <Row icon={Trash2} label={t('chats.deleteBot')} onClick={remove} danger testid="info-delete" /> : null}
      </List>
    </InfoFrame>
  );
}

// ---- a group
export function GroupInfo({ group, item, onClose }) {
  const t = useT();
  const manage = useCanManage();
  const me = useStore((s) => s.me);
  const people = useStore((s) => s.people ?? []);
  const { bots } = useBots();
  const [g, setG] = useState(null);
  const load = () => botCall('bots.groups.get', { id: group.id }).then(setG).catch(() => setG(false));
  useEffect(() => { load(); }, [group.id, (group.members ?? []).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const myId = me?.person?.id ?? null;
  const mine = !g || g.owner?.person == null || myId == null || g.owner.person === myId;
  const canEdit = manage && (mine || g?.right === 'edit' || g?.right === 'own');
  const members = g?.members ?? (group.members ?? []).map((id) => bots.find((b) => b.id === Number(id))).filter(Boolean);
  const after = (r) => { if (r) { setG(r); loadBots(); loadInboxSoon(0); } };
  const addBot = async (b) => after(await act(botCall('bots.groups.members.add', { id: group.id, bot: b.id }), t('chats.memberAdded', { name: b.name })));
  const addPerson = async (p) => after(await act(botCall('bots.groups.members.add', { id: group.id, person: p.id }), t('chats.memberAdded', { name: p.name })));
  const removeBot = async (b) => { if (members.length <= 1) return; after(await act(botCall('bots.groups.members.remove', { id: group.id, bot: b.id }))); };
  const removePerson = async (p) => after(await act(botCall('bots.groups.members.remove', { id: group.id, person: p.person })));
  const outBots = bots.filter((b) => !members.some((m) => m.id === b.id));
  const outPeople = personsOn(me) ? people.filter((p) => p.id !== myId && !(g?.people ?? []).some((x) => x.person === p.id) && p.id !== g?.owner?.person) : [];
  const rename = () => form(t('chats.renameGroup'), {
    initial: { name: group.name },
    body: (v, set) => <Field label={t('chats.groupName')}><Input autoFocus value={v.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} data-testid="group-rename" /></Field>,
    ok: t('bots.save'),
    onOk: async (v) => { if (!v.name.trim()) return false; const r = await act(botCall('bots.groups.update', { id: group.id, name: v.name.trim() })); if (r) { loadBots(); loadInboxSoon(0); load(); } return Boolean(r); }
  });
  const leave = async () => {
    if (!(await confirm(t('chats.leaveTitle', { name: group.name }), t('chats.leaveBody'), { ok: t('chats.leave'), danger: true }))) return;
    if (await act(botCall('bots.groups.members.remove', { id: group.id, person: myId }))) { onClose(); await loadBots(); loadInboxSoon(0); go({ view: phoneLayout() ? 'bot-chats' : 'bot-chat' }); }
  };
  const remove = async () => {
    if (!(await confirm(t('bots.groups.deleteTitle', { name: group.name }), t('bots.groups.deleteBody'), { ok: t('bots.delete'), danger: true }))) return;
    if (await act(botCall('bots.groups.delete', { id: group.id }))) { onClose(); await loadBots(); loadInboxSoon(0); go({ view: phoneLayout() ? 'bot-chats' : 'bot-chat' }); }
  };
  const count = members.length + (g?.people?.length ?? 0) + (g?.people?.length ? 1 : 0);
  return (
    <InfoFrame title={t('chats.groupInfo')} onClose={onClose}>
      <div className="grid justify-items-center gap-1.5 pb-1 text-center">
        <GroupFace group={{ members: members.map((m) => m.id) }} bots={bots} size={88} label={t('bots.av.group', { name: group.name })} />
        <h3 className="mt-1 text-xl font-semibold" data-testid="info-name">{group.name}</h3>
        <p className="text-muted-foreground text-[13px]">{t('chats.membersCount', { n: count })}</p>
        {canEdit ? <Button size="sm" variant="outline" className="mt-1" onClick={rename} data-testid="group-rename-open"><Pencil />{t('chats.renameGroup')}</Button> : null}
      </div>
      <div>
        <div className="text-muted-foreground flex items-center px-1 pb-1.5 text-[12px] font-medium">
          <span className="flex-1">{t('chats.members')}</span>
          {canEdit && (outBots.length || outPeople.length) ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild><Button size="xs" variant="ghost" data-testid="group-add-member"><UserPlus />{t('chats.addMember')}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                {outBots.length ? <DropdownMenuLabel>{t('nav.bots')}</DropdownMenuLabel> : null}
                {outBots.map((b) => <DropdownMenuItem key={b.id} onSelect={() => addBot(b)} data-testid={`group-add-${b.name}`}><BotFace bot={b} size={20} still /><span className="truncate">{b.name}</span></DropdownMenuItem>)}
                {outPeople.length ? <><DropdownMenuSeparator /><DropdownMenuLabel>{t('chats.groupPeople')}</DropdownMenuLabel></> : null}
                {outPeople.map((p) => <DropdownMenuItem key={p.id} onSelect={() => addPerson(p)}><Plus />{p.name}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <List testid="group-member-list">
          {g === null && !members.length ? <div className="grid place-items-center py-4"><Spinner /></div> : null}
          {members.map((b) => (
            <div key={b.id} className="flex min-h-12 items-center gap-3 px-3 py-1.5" data-testid={`group-member-${b.name}`}>
              <BotFace bot={bots.find((x) => x.id === b.id) ?? b} size={32} still chief={b.is_chief} />
              <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left text-[14px]" onClick={() => go({ view: 'bot-chat', id: b.id })}>{b.name}</button>
              {b.is_chief ? <Crown className="text-muted-foreground size-3.5" aria-label={t('bots.f.chief')} /> : null}
              {canEdit && members.length > 1 ? <Button size="icon-xs" variant="ghost" onClick={() => removeBot(b)} aria-label={t('chats.removeMember', { name: b.name })} data-testid={`group-remove-${b.name}`}><UserMinus /></Button> : null}
            </div>
          ))}
          {g?.people?.length ? [{ person: g.owner?.person, name: g.owner?.name, owner: true }, ...g.people].map((p) => (
            <div key={`p${p.person}`} className="flex min-h-12 items-center gap-3 px-3 py-1.5">
              <span className="bg-primary/12 text-primary grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold">{String(p.name ?? '?').charAt(0).toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{p.name}{p.person === myId ? ` (${t('chats.youShort')})` : ''}</span>
              {p.owner ? <span className="text-muted-foreground text-[12px]">{t('chats.groupOwner')}</span> : canEdit ? <Button size="icon-xs" variant="ghost" onClick={() => removePerson(p)} aria-label={t('chats.removeMember', { name: p.name })}><UserMinus /></Button> : null}
            </div>
          )) : null}
        </List>
      </div>
      <NotifyRow item={item} />
      <List>
        {personsOn(me) && mine ? <Row icon={Share2} label={t('chats.shareGroup')} onClick={() => openShare({ type: 'group', id: group.id, name: group.name, owner: g?.owner?.person ?? null })} testid="info-share" /> : null}
        {!mine ? <Row icon={LogOut} label={t('chats.leave')} onClick={leave} danger testid="group-leave" /> : null}
        {mine && manage ? <Row icon={Trash2} label={t('chats.deleteGroup')} onClick={remove} danger testid="info-delete" /> : null}
      </List>
    </InfoFrame>
  );
}
