// the info of a chat with Orbe and of a project (mockup mensajeria.html ?z=orb&s=info). The PC:
// a pane on the right of the conversation, closed with ✕; the phone: the whole screen (a glass sheet on Android). Opened
// by clicking the conversation's header, from a chat's menu or from a project's heading in the list (lib/store.js ›
// openOrbInfo). The frame, groups and rows: components/info-frame.jsx.
// A chat: Orbe, its title (rename), when it started; Proyecto (opens the project's info) and «Cambiar de proyecto»,
// Modelo, Razonamiento, Orquestador; «Tareas de este chat» with their state (each opens in Tareas); Notificaciones; Archivos
// adjuntos (the project's whiteboard), Compactar, Exportar, Fijar, Marcar como completado; Eliminar (red, last).
// A project: its initials or icon, name and folder, «Nuevo chat aquí»; Chats, Tareas, Programadas, Pizarra, Bitácora,
// Compartir (with two or more users), Ajustes del proyecto (Proyectos) and, on the PC with God mode on, «Abrir en God mode».
import { useEffect, useState } from 'react';
import { Plus, Folder, FolderGit2, GitBranch, PencilLine, ChevronRight, Sparkles, Bell, ClipboardCheck, Shrink, Download, Pin, PinOff, CircleCheck, Undo2, Trash2, Pencil, MessageSquarePlus, MessagesSquare, CalendarSync, Presentation, NotebookPen, Settings2, SquareTerminal } from 'lucide-react';
import { BrainIcon } from '@/components/brain-icon.jsx';
import { OrchestratorIcon } from '@/components/orchestrator-icon.jsx';
import { Robot } from '@/components/robot.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { BrainPicker, ReasoningMenu, useCatalog } from '@/components/brain-picker.jsx';
import { form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { askNewTask } from '@/components/new-task.jsx';
import { Input, Spinner } from '@/components/ui/basic.jsx';
import { Switch, BubbleTip } from '@/components/ui/overlay.jsx';
import { IconButton } from '@/components/ui/primitives.jsx';
import { InfoFrame, List, Row } from '@/components/info-frame.jsx';
import { useStore, call, act, go, setState, newChat, orbAct, closeOrbInfo, openOrbInfo, refreshSoon, phoneLayout, fullPc, chatOf } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { useOrbItems, deleteChat } from './inbox.jsx';
import { TaskStatus, acceptHeld, undoHeld } from '@/components/task-state.jsx';
import { ChatNotes, PinnedList } from '@/components/conversation/chat-notes.jsx';
import { quiet } from '@/lib/quiet.js';
import { approveTask, rejectTask } from '@/components/task-approval.jsx';
import { lastEntry } from '@/lib/logbook.js';

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
  const you = useStore((s) => s.app?.config?.userName?.trim()) || t('orbchats.exportYou');
  const tasks = useStore((s) => s.tasks.filter((x) => x.conversation_id === conv.id));
  const liveContext = useStore((s) => chatOf(s, conv.id)?.context ?? null); // compared field by field: not redrawn per streamed piece
  const item = useOrbItems().find((x) => x.key === `conversation:${conv.id}`) ?? null;
  const [busy, setBusy] = useState(null);
  const ref = { kind: 'conversation', id: conv.id };
  const brain = { agent: conv.agent ?? 'claude', model: conv.model ?? '', account: conv.account ?? conv.agent, reasoning: conv.reasoning ?? 'medium' };
  const settings = async (patch) => { const r = await act(call('chat.settings', { ...patch, conversation: conv.id })); if (r) refreshSoon(); };
  const context = liveContext ?? conv.context ?? null;
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
        <Robot size={phoneLayout() ? 92 : 80} mark={48} mood="idle" still head />
        <h3 className="mt-1 max-w-full text-xl font-semibold text-balance" data-testid="info-name">{conv.title}</h3>
        <p className="text-muted-foreground text-control">{started}</p>
        <Button size="sm" variant="outline" className="mt-1" onClick={rename} data-testid="info-rename"><Pencil />{t('orbchats.rename')}</Button>
      </div>
      <List testid="info-chat-brain">
        {/* Its project: changed right here; the arrow opens the project's info. */}
        <Row icon={Folder} label={t('orbchats.project')} value="">
          <ProjectPicker conversation={conv.id} />
          {conv.project ? <Button size="icon-xs" variant="ghost" className="-mr-1.5" onClick={() => openOrbInfo({ type: 'project', name: conv.project })} aria-label={t('orbchats.projectInfo')} data-testid="info-project"><ChevronRight /></Button> : null}
        </Row>
        <Row icon={Sparkles} label={t('orbchats.model')} value=""><BrainPicker catalog={catalog} value={brain} onChange={(b) => settings({ agent: b.agent, model: b.model, account: b.account, ...(b.reasoning ? { reasoning: b.reasoning } : {}) })} className="max-w-48 min-w-0 shrink" /></Row>
        <Row icon={BrainIcon} label={t('orbchats.reasoning')} value=""><ReasoningMenu catalog={catalog} value={brain} onChange={(reasoning) => settings({ reasoning })} /></Row>
        <BubbleTip title={t('orbchats.orchestrator')} text={t('orbchats.orchestratorTip', { name })} side="left">
          <div><Row icon={OrchestratorIcon} label={t('orbchats.orchestrator')} value={t('orbchats.orchestratorOn')} testid="info-orchestrator" /></div>
        </BubbleTip>
      </List>
      <PinnedList conversation={conv.id} assistant={name} you={you} />
      <ChatNotes conversation={conv.id} />
      <div>
        <div className="text-muted-foreground px-1 pb-1.5 text-caption font-medium tracking-wide uppercase">{t('orbchats.tasks')}</div>
        <List testid="info-tasks">
          {sorted.length ? sorted.slice(0, 12).map((x) => (
            <button key={x.id} type="button" onClick={() => leave({ view: 'tasks', id: x.id })} className="hover:bg-accent/50 flex min-h-11 w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left text-body" data-testid={`info-task-${x.id}`}>
              <ClipboardCheck className={cn('size-[18px] shrink-0', x.status === 'running' ? 'text-primary-text' : 'text-muted-foreground')} />
              <span className="min-w-0 flex-1 truncate">#{x.id} {x.title}</span>
              <TaskStatus task={x} className="shrink-0" />
            </button>
          )) : <p className="text-muted-foreground px-3.5 py-3 text-control">{t('orbchats.noTasks')}</p>}
          {sorted.length > 12 ? <Row label={t('comp.sidebar.viewAll', { n: sorted.length })} onClick={() => leave({ view: 'tasks', project: conv.project ?? undefined })} /> : null}
        </List>
      </div>
      <div>
        <List><label className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 text-body"><Bell className="text-muted-foreground size-[18px] shrink-0" /><span className="flex-1">{t('chats.notifications')}</span>
          <Switch checked={!item?.muted} disabled={!item} onCheckedChange={(on) => orbAct('inbox.mute', { ...ref, muted: !on })} data-testid="info-notify" /></label></List>
        <p className="text-muted-foreground px-1 pt-1.5 text-caption">{item?.muted ? t('chats.notifyOff') : t('chats.notifyOn')}</p>
      </div>
      <List testid="info-actions">
        {/* no «Archivos adjuntos» row: a chat with Orbe takes no attachments of its own (the project's Pizarra is in the
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
        <p className="text-muted-foreground max-w-full truncate font-mono text-caption" title={p?.path}>{p?.path ?? t('orbchats.pNoPath')}</p>
        <Button size="sm" className="mt-1" onClick={() => { closeOrbInfo(); newChat(name); }} data-testid="project-info-new-chat"><MessageSquarePlus />{t('orbchats.projectNewChat')}</Button>
      </div>
      <List testid="project-info-rows">
        <Row icon={MessagesSquare} label={t('orbchats.chats')} value={String(chats)} testid="project-info-chats" />
        <Row icon={ClipboardCheck} label={t('orbchats.pTasks')} value={open ? t('orbchats.pOpen', { n: open }) : String(total)} onClick={() => leave({ view: 'tasks', project: name })} testid="project-info-tasks" />
        <Row icon={CalendarSync} label={t('orbchats.pSchedules')} onClick={() => active({ view: 'schedules' })} testid="project-info-schedules" />
        <Row icon={Presentation} label={t('orbchats.pBoard')} onClick={() => active({ view: 'board' })} testid="project-info-board" />
        <Row icon={NotebookPen} label={t('orbchats.pLog')} onClick={() => leave({ view: 'logs', name })} testid="project-info-log" />
      </List>
      <List>
        <Row icon={Settings2} label={t('orbchats.pSettings')} onClick={() => leave({ view: 'projects', name })} testid="project-info-settings" />
        {god ? <Row icon={SquareTerminal} label={t('orbchats.pGod')} onClick={() => { setState({ expertProject: name }); leave({ view: 'expert' }); }} testid="project-info-god" /> : null}
      </List>
    </InfoFrame>
  );
}

// ---- the «Ficha» tab of the panel of a chat with an agent (mock-up 01-chat): its name, where it works, its alerts, its
// tasks and the project's logbook. `line` is the agent · model · permission text the chat already computed.
export function SessionInfo({ session: s, line, onRename, task }) {
  const t = useT();
  const locale = useLocale();
  const item = useOrbItems().find((x) => x.key === `session:${s.id}`) ?? null;
  const tasks = useStore((st) => st.tasks.filter((x) => (String(x.session_id) === String(s.id) || String(x.origin_session) === String(s.id)) && x.id !== task?.id));
  const [info, setInfo] = useState(null);
  const [tree, setTree] = useState(null); // the chat's own worktree (branch it works on), when it has one
  const [entry, setEntry] = useState(null);
  useEffect(() => {
    let alive = true; setInfo(null); setTree(null); setEntry(null);
    if (s.project) {
      call('projects.info', { name: s.project }).then((r) => { if (alive) setInfo(r); }).catch(quiet);
      call('logs.read', { project: s.project }).then((r) => { if (alive) setEntry(lastEntry(r)); }).catch(quiet);
    }
    call('worktrees.status', { id: String(s.id) }).then((r) => { if (alive) setTree(r?.has === true ? r : null); }).catch(quiet);
    return () => { alive = false; };
  }, [s.id, s.project]);
  const dt = 'text-muted-foreground flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5';
  const mine = [...(task ? [task] : []), ...[...tasks].sort((a, b) => b.id - a.id)];
  const branch = tree?.branch ?? (info?.git ? info.branch : null);
  return (
    <section className="grid gap-0" data-testid="orb-info">
      <div className="bg-card rounded-card border px-3 py-2.5">
        {/* a full-size rename button (32 px) sets the row's height, as in the mock-up: the card is 73-75 px, not 63 */}
        <div className="flex min-h-(--ctl) items-center justify-between gap-2">
          <b className="min-w-0 truncate font-(family-name:--title) text-[15px] font-semibold" data-testid="info-name">{s.title}</b>
          {s.kind === 'chat' ? <BubbleTip title={t('panel.info.rename')}><IconButton label={t('panel.info.rename')} onClick={onRename} data-testid="info-rename"><PencilLine /></IconButton></BubbleTip> : null}
        </div>
        <div className="text-muted-foreground mt-1 text-xs">{line}</div>
      </div>
      <dl className="my-4 grid grid-cols-[minmax(120px,max-content)_1fr] items-center gap-x-2.5 gap-y-[9px] text-control">
        {s.project ? <><dt className={dt}><FolderGit2 />{t('panel.info.project')}</dt><dd className="m-0 flex min-w-0 items-center gap-1.5" data-testid="info-project"><ProjectIcon name={s.project} className="size-3.5" /><span className="truncate">{s.project}</span></dd></> : null}
        {/* the folder the chat works in: it left the box (the permissions row) for here; «Abrir la carpeta» is in the ⋯ menu. */}
        <dt className={dt}><Folder />{t('panel.info.folder')}</dt>
        <dd className="m-0 min-w-0 font-mono text-xs break-all" data-testid="session-folder">{s.cwd}</dd>
        {branch ? <><dt className={dt}><GitBranch />{tree ? t('panel.info.worktree') : t('panel.info.branch')}</dt><dd className="m-0 min-w-0 font-mono text-xs break-all">{branch}</dd></> : null}
        <dt className={dt}><BubbleTip title={t('panel.info.notify')} text={t('panel.info.notifyTip')} side="left"><span className="inline-flex items-center gap-1.5"><Bell />{t('panel.info.notify')}</span></BubbleTip></dt>
        <dd className="m-0"><Switch checked={!item?.muted} disabled={!item} onCheckedChange={(on) => orbAct('inbox.mute', { kind: 'session', id: s.id, muted: !on })} aria-label={t('panel.info.notify')} data-testid="info-notify" /></dd>
      </dl>
      {mine.length ? (
        <>
          <div className="mt-[18px] mb-1.5 font-(family-name:--title) text-[15px] font-semibold">{t('panel.info.tasks')}</div>
          <div className="grid gap-2" data-testid="info-tasks">
            {mine.slice(0, 8).map((x) => (
              <div key={x.id} className="bg-card rounded-card border text-control">
                <button type="button" onClick={() => go({ view: 'tasks', id: x.id })} className="hover:bg-accent/60 rounded-card focus-visible:outline-ring flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left focus-visible:outline-2" data-testid={`info-task-${x.id}`}>
                  <span className="min-w-0 truncate">#{x.id} {x.title}</span><TaskStatus task={x} className="shrink-0" />
                </button>
                {/* the same approval as Tareas (components/task-approval.jsx): what is approved is shown and confirmed there. */}
                {x.status === 'awaiting_approval' ? (
                  <div className="flex justify-end gap-2 px-3 pb-2.5" data-testid={`info-task-approval-${x.id}`}>
                    <Button size="sm" variant="ghost" onClick={() => rejectTask(x)} data-testid={`info-task-reject-${x.id}`}>{t('tasks.reject')}</Button>
                    <Button size="sm" onClick={() => approveTask(x)} data-testid={`info-task-approve-${x.id}`}>{t('tasks.approve.ok')}</Button>
                  </div>
                ) : x.held ? (
                  /* a held task is not waiting for approval: its two ways out are the ones of the Tareas panel. */
                  <div className="flex justify-end gap-2 px-3 pb-2.5" data-testid={`info-task-held-${x.id}`}>
                    <Button size="sm" variant="outline" onClick={() => undoHeld(t, x)} data-testid={`info-task-undo-${x.id}`}>{t('tasks.undo.btn')}</Button>
                    <Button size="sm" onClick={() => acceptHeld(t, x)} data-testid={`info-task-accept-${x.id}`}>{t('tasks.held.accept')}</Button>
                  </div>
                ) : null}
              </div>
            ))}
            {mine.length > 8 ? <button type="button" onClick={() => go({ view: 'tasks', project: s.project ?? undefined })} className="text-info w-fit cursor-pointer text-control hover:underline">{t('comp.sidebar.viewAll', { n: mine.length })}</button> : null}
          </div>
        </>) : null}
      {/* the user hands a task to this chat's project from here: the chat is kept on it as its origin (a label only). */}
      {s.project ? (
        <>
          {mine.length ? null : <div className="mt-[18px] mb-1.5 font-(family-name:--title) text-[15px] font-semibold">{t('panel.info.tasks')}</div>}
          <Button size="sm" variant="outline" className="mt-2 w-fit" onClick={() => askNewTask(t, [s.project], s.project, String(s.id))} data-testid="info-new-task"><Plus />{t('projects.tasks.new')}</Button>
        </>) : null}
      {s.project ? (
        <>
          <div className="mt-[18px] mb-1.5 font-(family-name:--title) text-[15px] font-semibold">{t('panel.info.log')}</div>
          {entry ? <p className="text-muted-foreground mb-1.5 truncate text-control" data-testid="info-log-last">{entry.date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} · {entry.topic}</p> : null}
          <button type="button" onClick={() => go({ view: 'logs', name: s.project })} className="text-info focus-visible:outline-ring inline-flex w-fit cursor-pointer items-center gap-1 rounded-sm text-control hover:underline focus-visible:outline-2" data-testid="info-open-log">{t('panel.info.openLog')}<ChevronRight className="size-3.5" /></button>
        </>) : null}
    </section>
  );
}
