// 3.6 (messaging, step M3): the info of a chat with Orbe and of a project (mockup mensajeria.html ?z=orb&s=info). The PC:
// a pane on the right of the conversation, closed with ✕; the phone: the whole screen (a glass sheet on Android). Opened
// by clicking the conversation's header, from a chat's menu or from a project's heading in the list (lib/store.js ›
// openOrbInfo). The frame, groups and rows: components/info-frame.jsx.
// A chat: Orbe, its title (rename), when it started; Proyecto (opens the project's info) and «Cambiar de proyecto»,
// Modelo, Razonamiento, Orquestador; «Tareas de este chat» with their state (each opens in Tareas); Notificaciones; Archivos
// adjuntos (the project's whiteboard), Compactar, Exportar, Fijar, Marcar como completado; Eliminar (red, last).
// A project: its initials or icon, name and folder, «Nuevo chat aquí»; Chats, Tareas, Programadas, Pizarra, Bitácora,
// Compartir (with two or more users), Ajustes del proyecto (Proyectos) and, on the PC with God mode on, «Abrir en God mode».
import { useEffect, useState } from 'react';
import { Folder, ChevronRight, Sparkles, Bell, ListTodo, Paperclip, Shrink, Download, Pin, PinOff, CircleCheck, Undo2, Trash2, Pencil, MessageSquarePlus, MessagesSquare, CalendarClock, PenTool, BookOpen, Settings2, SquareTerminal } from 'lucide-react';
import { BrainIcon } from '@/components/brain-icon.jsx';
import { OrchestratorIcon } from '@/components/orchestrator-icon.jsx';
import { Robot } from '@/components/robot.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { BrainPicker, ReasoningMenu, useCatalog } from '@/components/brain-picker.jsx';
import { form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Input, Spinner } from '@/components/ui/basic.jsx';
import { Switch, BubbleTip } from '@/components/ui/overlay.jsx';
import { InfoFrame, List, Row } from '@/components/info-frame.jsx';
import { useStore, call, act, go, setState, newChat, orbAct, closeOrbInfo, openOrbInfo, refreshSoon, phoneLayout, fullPc } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { STATUS } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { useOrbItems, deleteChat } from './inbox.jsx';

const OPEN = ['queued', 'running', 'awaiting_approval', 'limited'];
// On the phone the info covers the screen: going somewhere from it closes it.
const leave = (route) => { if (phoneLayout()) closeOrbInfo(); go(route); };

// ---- the host: shows the pane (PC) or the sheet (phone) the store asks for (s.orbInfo), for the conversation on screen
export function OrbInfoHost() {
  const info = useStore((s) => s.orbInfo);
  const route = useStore((s) => s.route);
  const conv = useStore((s) => (s.orbInfo?.type === 'chat' && s.route.view === 'chat' && s.route.id != null ? s.conversations.find((c) => c.id === s.route.id) ?? null : null));
  // A chat's info follows the conversation on screen; anywhere else it closes.
  useEffect(() => { if (info?.type === 'chat' && !(route.view === 'chat' && route.id != null)) closeOrbInfo(); }, [info?.type, route.view, route.id]);
  if (info?.type === 'project') return <ProjectInfo key={info.name} name={info.name} />;
  if (info?.type === 'chat' && conv) return <ChatInfo key={conv.id} conv={conv} />;
  return null;
}

// The whole conversation as Markdown, saved as a file (the earlier lines are read in pages).
async function exportChat(conv, { assistant, you, locale }) {
  let lines = await call('chat.list', { conversation: conv.id });
  for (let more = lines.length >= 160, i = 0; more && i < 40; i++) {
    const older = await call('chat.list', { conversation: conv.id, before: lines[0].id });
    lines = [...older, ...lines];
    more = older.length >= 120;
  }
  const when = (at) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }); };
  const who = (m) => (m.role === 'usuario' ? you : m.role === 'orb' ? assistant : null);
  const body = lines.map((m) => (who(m) ? `**${who(m)}** · ${when(m.at)}\n\n${m.body}` : `> ${String(m.body).replace(/\n/g, '\n> ')}`)).join('\n\n---\n\n');
  const text = `# ${conv.title}\n\n${conv.project ? `${conv.project} · ` : ''}${when(new Date().toISOString())}\n\n---\n\n${body}\n`;
  const name = `${String(conv.title).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').trim().slice(0, 60) || 'chat'}.md`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

// ---- a chat with Orbe
function ChatInfo({ conv }) {
  const t = useT();
  const locale = useLocale();
  const catalog = useCatalog();
  const name = useStore((s) => s.app?.config?.assistantName ?? 'Orbe');
  const you = useStore((s) => s.me?.person?.name) || t('orbchats.exportYou');
  const tasks = useStore((s) => s.tasks.filter((x) => x.conversation_id === conv.id));
  const chat = useStore((s) => (s.app?.chats ?? []).find((c) => c.conversation === conv.id) ?? null);
  const item = useOrbItems().find((x) => x.key === `conversation:${conv.id}`) ?? null;
  const [busy, setBusy] = useState(null);
  const ref = { kind: 'conversation', id: conv.id };
  const brain = { agent: conv.agent ?? 'claude', model: conv.model ?? '', account: conv.account ?? conv.agent, reasoning: conv.reasoning ?? 'medium' };
  const settings = async (patch) => { const r = await act(call('chat.settings', { ...patch, conversation: conv.id })); if (r) refreshSoon(); };
  const context = chat?.context ?? conv.context ?? null;
  const pct = context?.size ? Math.min(100, Math.round((context.used / context.size) * 100)) : null;
  const started = (() => {
    const d = new Date(conv.created_at ?? ''); if (Number.isNaN(d.getTime())) return '';
    const today = d.toDateString() === new Date().toDateString();
    return t('orbchats.started', { name, when: today ? t('orbchats.startedToday', { time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) : t('orbchats.startedOn', { date: d.toLocaleDateString(locale, { day: 'numeric', month: 'long' }) }) });
  })();
  const rename = () => form(t('chat.renameTitle'), { initial: { title: conv.title }, body: (v, set) => <Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} data-testid="rename-input" />, ok: t('session.save'), onOk: async (v) => { const r = await call('conversations.update', { id: conv.id, title: v.title.trim() || conv.title }); refreshSoon(); return r; } });
  const run = async (key, fn) => { setBusy(key); try { await fn(); } finally { setBusy(null); } };
  const compact = () => run('compact', async () => { if (await act(call('chat.compact', { conversation: conv.id }))) refreshSoon(); });
  const exportIt = () => run('export', async () => { const file = await act(exportChat(conv, { assistant: name, you, locale })); if (file) notify({ title: t('orbchats.exported'), body: file, tone: 'success' }); });
  const sorted = [...tasks].sort((a, b) => b.id - a.id);
  return (
    <InfoFrame title={t('orbchats.info')} onClose={closeOrbInfo}>
      <div className="grid justify-items-center gap-1.5 pb-1 text-center" data-testid="orb-info">
        <Robot size={phoneLayout() ? 92 : 80} mood="idle" still head />
        <h3 className="mt-1 max-w-full text-xl font-semibold text-balance" data-testid="info-name">{conv.title}</h3>
        <p className="text-muted-foreground text-[13px]">{started}</p>
        <Button size="sm" variant="outline" className="mt-1" onClick={rename} data-testid="info-rename"><Pencil />{t('orbchats.rename')}</Button>
      </div>
      <List testid="info-chat-brain">
        {/* Its project: changed right here; the arrow opens the project's info. */}
        <Row icon={Folder} label={t('orbchats.project')} value="">
          <ProjectPicker conversation={conv.id} />
          {conv.project ? <Button size="icon-xs" variant="ghost" className="-mr-1.5" onClick={() => openOrbInfo({ type: 'project', name: conv.project })} aria-label={t('orbchats.projectInfo')} data-testid="info-project"><ChevronRight /></Button> : null}
        </Row>
        <Row icon={Sparkles} label={t('orbchats.model')} value=""><BrainPicker catalog={catalog} value={brain} onChange={(b) => settings({ agent: b.agent, model: b.model, account: b.account })} className="max-w-48 min-w-0 shrink" /></Row>
        <Row icon={BrainIcon} label={t('orbchats.reasoning')} value=""><ReasoningMenu catalog={catalog} value={brain} onChange={(reasoning) => settings({ reasoning })} /></Row>
        <BubbleTip title={t('orbchats.orchestrator')} text={t('orbchats.orchestratorTip', { name })} side="left">
          <div><Row icon={OrchestratorIcon} label={t('orbchats.orchestrator')} value={t('orbchats.orchestratorOn')} testid="info-orchestrator" /></div>
        </BubbleTip>
      </List>
      <div>
        <div className="text-muted-foreground px-1 pb-1.5 text-[12px] font-medium tracking-wide uppercase">{t('orbchats.tasks')}</div>
        <List testid="info-tasks">
          {sorted.length ? sorted.slice(0, 12).map((x) => (
            <button key={x.id} type="button" onClick={() => leave({ view: 'tasks', id: x.id })} className="hover:bg-accent/50 flex min-h-11 w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left text-[14px]" data-testid={`info-task-${x.id}`}>
              <ListTodo className={cn('size-[18px] shrink-0', x.status === 'running' ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0 flex-1 truncate">#{x.id} {x.title}</span>
              <Badge variant={STATUS[x.status]?.[1] ?? 'secondary'} className="shrink-0">{STATUS[x.status]?.[0] ?? x.status}</Badge>
            </button>
          )) : <p className="text-muted-foreground px-3.5 py-3 text-[13px]">{t('orbchats.noTasks')}</p>}
          {sorted.length > 12 ? <Row label={t('comp.sidebar.viewAll', { n: sorted.length })} onClick={() => leave({ view: 'tasks', project: conv.project ?? undefined })} /> : null}
        </List>
      </div>
      <div>
        <List><label className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 text-[14px]"><Bell className="text-muted-foreground size-[18px] shrink-0" /><span className="flex-1">{t('chats.notifications')}</span>
          <Switch checked={!item?.muted} disabled={!item} onCheckedChange={(on) => orbAct('inbox.mute', { ...ref, muted: !on })} data-testid="info-notify" /></label></List>
        <p className="text-muted-foreground px-1 pt-1.5 text-[12px]">{item?.muted ? t('chats.notifyOff') : t('chats.notifyOn')}</p>
      </div>
      <List testid="info-actions">
        {/* 3.6: no «Archivos adjuntos» row: a chat with Orbe takes no attachments of its own (the project's Pizarra is in the
            project's info), so the row only sent people somewhere else. */}
        {context?.size ? <Row icon={Shrink} label={t('orbchats.compact')} value={busy === 'compact' ? <Spinner className="size-3" /> : `${pct} %`} onClick={busy ? null : compact} testid="info-compact" /> : null}
        <Row icon={Download} label={t('orbchats.export')} value={busy === 'export' ? <Spinner className="size-3" /> : null} onClick={busy ? null : exportIt} testid="info-export" />
        {item?.pinned
          ? <Row icon={PinOff} label={t('chats.unpin')} onClick={() => orbAct('inbox.unpin', ref)} testid="info-unpin"><span /></Row>
          : <Row icon={Pin} label={t('chats.pin')} onClick={() => orbAct('inbox.pin', ref)} testid="info-pin"><span /></Row>}
        {conv.status === 'done'
          ? <Row icon={Undo2} label={t('orbchats.reopen')} onClick={() => act(call('conversations.update', { id: conv.id, done: false })).then(refreshSoon)} testid="info-reopen"><span /></Row>
          : <Row icon={CircleCheck} label={t('orbchats.complete')} onClick={() => act(call('conversations.update', { id: conv.id, done: true })).then(refreshSoon)} testid="info-complete"><span /></Row>}
        <Row icon={Trash2} label={t('orbchats.delete')} onClick={() => deleteChat({ id: conv.id, title: conv.title }, t)} danger testid="info-delete" />
      </List>
    </InfoFrame>
  );
}

// ---- a project
function ProjectInfo({ name }) {
  const t = useT();
  const p = useStore((s) => s.projects.find((x) => x.name === name) ?? null);
  const chats = useStore((s) => s.conversations.filter((c) => c.project === name).length + s.sessions.filter((x) => x.kind === 'chat' && x.project === name).length);
  const open = useStore((s) => s.tasks.filter((x) => x.project === name && OPEN.includes(x.status)).length);
  const total = useStore((s) => s.tasks.filter((x) => x.project === name).length);
  const god = useStore((s) => Boolean(s.app?.config?.expert?.enabled)) && fullPc();
  const active = async (then) => { await act(call('projects.setActive', { name })); leave(then); };
  return (
    <InfoFrame title={t('orbchats.projectInfo')} onClose={closeOrbInfo}>
      <div className="grid justify-items-center gap-1.5 pb-1 text-center" data-testid="project-info-panel">
        <ProjectIcon name={name} size={phoneLayout() ? 88 : 76} />
        <h3 className="mt-1 max-w-full truncate text-xl font-semibold" data-testid="info-name">{name}</h3>
        <p className="text-muted-foreground max-w-full truncate font-mono text-[12px]" title={p?.path}>{p?.path ?? t('orbchats.pNoPath')}</p>
        <Button size="sm" className="mt-1" onClick={() => { closeOrbInfo(); newChat(name); }} data-testid="project-info-new-chat"><MessageSquarePlus />{t('orbchats.projectNewChat')}</Button>
      </div>
      <List testid="project-info-rows">
        <Row icon={MessagesSquare} label={t('orbchats.chats')} value={String(chats)} testid="project-info-chats" />
        <Row icon={ListTodo} label={t('orbchats.pTasks')} value={open ? t('orbchats.pOpen', { n: open }) : String(total)} onClick={() => leave({ view: 'tasks', project: name })} testid="project-info-tasks" />
        <Row icon={CalendarClock} label={t('orbchats.pSchedules')} onClick={() => active({ view: 'schedules' })} testid="project-info-schedules" />
        <Row icon={PenTool} label={t('orbchats.pBoard')} onClick={() => active({ view: 'board' })} testid="project-info-board" />
        <Row icon={BookOpen} label={t('orbchats.pLog')} onClick={() => leave({ view: 'logs', name })} testid="project-info-log" />
      </List>
      <List>
        <Row icon={Settings2} label={t('orbchats.pSettings')} onClick={() => leave({ view: 'projects', name })} testid="project-info-settings" />
        {god ? <Row icon={SquareTerminal} label={t('orbchats.pGod')} onClick={() => { setState({ expertProject: name }); leave({ view: 'expert' }); }} testid="project-info-god" /> : null}
      </List>
    </InfoFrame>
  );
}
