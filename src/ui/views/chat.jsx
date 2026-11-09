// The star view: a conversation with the assistant. 3.6 (DESIGN-SYSTEM §2.2): above the text, the project picker and the
// contextual action slot («Compactar» when the context is filling up, «Iniciar test» on the day's first new chat); under
// it, the brain (agent and model), the reasoning (brain button) and, for a new conversation, the orchestrator (icon and a
// small switch: on = with the assistant, who coordinates the agents; off = directly with the agent chosen).
// 3.2: each conversation is its own (route.id), several at once.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDraft } from '@/lib/draft.js';
import { Square, Pause, Play, Gamepad2, Check, CheckCheck, PencilLine, ShieldAlert, X, ExternalLink, ChevronRight, PenTool, History, FlaskConical, Folder, ListChecks, Ellipsis, Info, BellOff, MessageSquare } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Markdown, StreamingMarkdown } from '@/components/markdown.jsx';
import { ExtensionRequestCard } from './extensions.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { useLiveTasks, liveOf, ProgressBar, elapsed } from '@/components/live-tasks.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ChatBar, BackToList } from '@/components/chat-bar.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { useOrbInbox, useOrbActions } from '@/views/orb/inbox.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { WaitLabel, HeldCard, resumeQueue, setQueuePaused } from '@/components/task-state.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { Switch, BubbleTip } from '@/components/ui/overlay.jsx';
import { bridge, useStore, call, act, setState, getState, go, openGames, fullPc, initTestOfTheDay, dismissTest, runTest, chatOf, refresh, refreshSoon, navTicket, stillHere, openOrbInfo, closeOrbInfo, loadOrbInboxSoon, phoneLayout, plainSkin, addPending, movePending, dropPending, pendingShown, usePending } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { approveTask, rejectTask } from '@/components/task-approval.jsx';
import { pickGreeting, pickSubtitle, suggestionsFor, greetingFor } from '@/lib/greeting.js';
import { LiveActivity, QuestionCard } from '@/components/chat-live.jsx';
import { OrchestratorIcon } from '@/components/orchestrator-icon.jsx';
import { BrainPicker, ReasoningMenu, UsageBubble, useCatalog, useUsageBubble } from '@/components/brain-picker.jsx';
import { ContextSlot } from '@/components/context-slot.jsx';
import { cn } from '@/lib/utils.js';
import { DECISION, AGENT, STATUS } from '@/lib/labels.js';
import { useT } from '@/lib/i18n.js';
import { keepSame } from '@/lib/memo.js';
import { useAutoScroll, Composer } from '@/components/conversation/composer.jsx';
import { MsgTime, BarPause, COMPACT_AT, CompactButton } from '@/components/conversation/bar.jsx';
import { ContextMeter } from '@/components/conversation/context-meter.jsx';


// 2.7: a different greeting each time the chat opens (lib/greeting.js); the last one is remembered so it does not repeat.
// 3.8.3: one that names the project («Seguimos con «orb-bots»») follows the project chosen for the new chat afterwards:
// it names the new one, or gives way to one without a project (picked at the same time) after «Sin proyecto».
function useGreeting(project) {
  const [g] = useState(() => {
    const { app, tasks, projects } = getState();
    let last = {}; try { last = JSON.parse(localStorage.getItem('orb.greet') || '{}'); } catch { /* none */ }
    const ask = { tasks, first: !tasks.length && !projects.length, serious: plainSkin(app.config.ui?.skin), last: last.key };
    const pick = pickGreeting({ ...ask, project: app.activeProject?.name ?? null });
    const sub = pickSubtitle({ last: last.sub });
    try { localStorage.setItem('orb.greet', JSON.stringify({ key: pick.key, sub })); } catch { /* storage unavailable */ }
    return { ...pick, sub, plain: pick.key === 'greet.project' ? pickGreeting({ ...ask, project: null }) : null };
  });
  return greetingFor(g, project);
}

// Memoised: the list (up to 120 lines) is not drawn again while the assistant streams its answer.
const Message = memo(function Message({ m, name, onChanges }) {
  const t = useT();
  if (m.meta?.kind === 'question') return <QuestionCard m={m} />;
  // 2.7: for a big request, the assistant's advice to define it on the Pizarra, with the way there.
  if (m.meta?.kind === 'board') return (
    <div className="flex gap-3">
      <Robot size={32} still className="mt-0.5" />
      <div className="chat-glass min-w-0 flex-1" data-testid="board-suggestion">
        <div className="text-muted-foreground mb-1 text-xs">{name}</div>
        <Markdown>{m.body}</Markdown>
        <div className="chat-actions mt-2.5"><Button size="sm" onClick={() => go('board')} data-testid="open-board"><PenTool />{t('chat.openBoard')}</Button></div>
        <div className="text-muted-foreground flow-root"><MsgTime at={m.at} /></div>
      </div>
    </div>
  );
  if (m.role === 'usuario') return <div className="bg-bubble text-bubble-foreground ml-auto max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 whitespace-pre-wrap break-words">{m.body}<MsgTime at={m.at} /></div>;
  if (m.role === 'orb') {
    const report = m.meta?.kind === 'report' && m.meta.tasks?.length ? m.meta : null;
    return (
      <div className="flex gap-3">
        <Robot size={32} still className="mt-0.5" />
        <div className="chat-glass min-w-0 flex-1">
          <div className="text-muted-foreground mb-1 text-xs">{name}</div>
          <Markdown>{m.body}</Markdown>
          {report ? (
            <div className="chat-actions mt-2.5 flex flex-wrap items-center gap-2" data-testid="report-actions">
              {report.accepted ? <Badge variant="success"><Check />{t('chat.accepted', { ids: report.tasks.map((id) => `#${id}`).join(', ') })}</Badge> : (<>
                <Button size="xs" className="px-2.5" onClick={() => act(call('chat.accept', { id: m.id }), t('chat.acceptDone'))}><Check />OK</Button>
                <Button size="xs" className="px-2.5" variant="outline" onClick={() => onChanges(report.tasks)}><PencilLine />{t('chat.requestChanges')}</Button>
                <span className="text-muted-foreground text-xs">{t('chat.tasksList', { ids: report.tasks.map((id) => `#${id}`).join(', ') })}</span>
              </>)}
            </div>
          ) : null}
          <div className="text-muted-foreground flow-root"><MsgTime at={m.at} /></div>
        </div>
      </div>
    );
  }
  if (m.meta?.kind === 'approval' || m.meta?.kind === 'task-approval') return <ChatApproval m={m} />;
  // 3.8.1: an agent made a skill or an MCP server and asks for it to be turned on.
  if (m.meta?.kind === 'extension' && m.meta.extension) return <ExtensionRequestCard m={m} />;
  if (m.meta?.kind === 'attention' && m.meta.task) return <TaskApprovalLine m={m} />;
  // 2.6: the assistant's suggestion to play while the agents work, with the button that opens the games.
  if (m.meta?.kind === 'games') return (
    <div className="chat-actions bg-muted/70 text-muted-foreground mx-auto flex max-w-[88%] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-2 text-center text-[13px]">
      <span>{m.body}</span>
      {!fullPc() ? null : <Button size="xs" variant="soft" onClick={openGames} data-testid="chat-play"><Gamepad2 />{t('chat.playButton')}</Button>}
    </div>
  );
  // 3.8.3: the tasks of this chat wait because the queue is paused: «Reanudar» right there (while it still is).
  if (m.meta?.kind === 'paused') return <PausedLine body={m.body} />;
  // 3.1: a finished task says it in one line; what the agent reported (technical) unfolds on request.
  if (m.meta?.kind === 'task-end' && m.meta.result) return (
    <div className="bg-muted/70 text-muted-foreground mx-auto max-w-[88%] rounded-xl px-3.5 py-2 text-center text-[13px]">
      <div className="whitespace-pre-wrap">{m.body}</div>
      <Details label={t('chat.seeResult')} className="text-left"><div className="mt-1.5 max-h-60 overflow-auto text-xs whitespace-pre-wrap break-words">{m.meta.result}</div></Details>
    </div>
  );
  return <div className="bg-muted/70 text-muted-foreground mx-auto max-w-[88%] rounded-xl px-3.5 py-2 text-center text-[13px] whitespace-pre-wrap">{m.body}</div>;
});

// A fold: a small link that shows what is inside (details the user may want, not by default).
function Details({ label, className, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button type="button" className="text-muted-foreground hover:text-foreground mt-1 inline-flex cursor-pointer items-center gap-1 text-xs underline-offset-2 hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />{label}
      </button>
      {open ? children : null}
    </div>
  );
}

// A permission request in the chat: the assistant's own (free mode) or one of a task (answered here or in the task).
function ChatApproval({ m }) {
  const t = useT();
  // 3.1: how the request ended comes from the engine too (answered in the task, nobody answered, the task stopped).
  const [local, setLocal] = useState(null);
  const task = m.meta.kind === 'task-approval';
  // 3.2: the assistant no longer runs commands itself (free mode is a direct conversation now): an old request of its is over.
  const state = local ?? (task ? m.meta.status ?? 'pending' : m.meta.status === 'pending' || !m.meta.status ? 'expired' : m.meta.status);
  const answer = async (decision) => {
    const r = await act(call('sessions.approve', { id: m.meta.session, request: m.meta.request, decision }));
    if (r !== undefined) setLocal(decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'allowed');
  };
  const done = state !== 'pending';
  const badge = DECISION[state] ?? DECISION.denied;
  return (
    <div className={cn('mx-auto w-full max-w-[88%] rounded-xl border px-3.5 py-2.5 text-[13px]', done ? 'bg-muted/50' : 'border-warning/50 bg-warning/10')}>
      <div className="flex items-start gap-2"><ShieldAlert className={cn('mt-0.5 size-4 shrink-0', done ? 'text-muted-foreground' : 'text-warning')} /><div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{m.body}</div></div>
      {/* 3.1: the command itself, for whoever wants to look: never in the sentence. */}
      {m.meta.detail ? <Details label={t('chat.seeDetails')} className="pl-6"><pre className="bg-muted mt-1.5 max-h-48 overflow-auto rounded-md px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">{m.meta.detail}</pre></Details> : null}
      <div className="chat-actions mt-2 flex flex-wrap items-center gap-2 pl-6">
        {done ? <Badge variant={badge[1]}>{badge[0]}</Badge> : (<>
          <Button size="xs" className="px-2.5" onClick={() => answer('allow')}><Check />{t('chat.allow')}</Button>
          <Button size="xs" className="px-2.5" variant="outline" onClick={() => answer('always')}><CheckCheck />{t('chat.always')}</Button>
          <Button size="xs" className="px-2.5" variant="outline" onClick={() => answer('deny')}><X />{t('chat.deny')}</Button>
        </>)}
        {task ? <Button size="xs" className="px-2.5" variant="ghost" onClick={() => go({ view: 'session', id: m.meta.session })}><ExternalLink />{t('chat.viewTask')}</Button> : null}
      </div>
    </div>
  );
}

// 3.2.1: a task that waits for the user's approval, with «Aprobar» and «Rechazar» right in the chat (before, only in
// Tareas). Once answered, how it ended. 3.6 (M3): a card: «"Publicar la web" necesita tu aprobación»,
// the reason in words and Rechazar · Ver la tarea · Aprobar.
const whyOf = (body) => /\(([^()]*)\)\.?\s*$/.exec(String(body ?? ''))?.[1]?.trim() || null;
function TaskApprovalLine({ m }) {
  const t = useT();
  const task = useStore((s) => s.tasks.find((x) => x.id === m.meta.task) ?? null);
  const [busy, setBusy] = useState(false);
  const waiting = task?.status === 'awaiting_approval';
  const run = async (fn) => { setBusy(true); try { await fn(task); } finally { setBusy(false); } };
  // 3.6: why it waits, in plain words from the task's own data (its sensitivity), not the short labels of the log.
  const reasons = (task?.sensitivity ?? []).map((k) => t(`orbchats.why.${k}`)).filter((x) => x && !x.startsWith('orbchats.why.'));
  const why = reasons.length ? reasons.join(t('orbchats.whyAnd')) : whyOf(m.body);
  return (
    <div className={cn('mx-auto w-full max-w-[92%] rounded-xl border px-3.5 py-3 text-[13.5px] shadow-xs', waiting ? 'bg-card border-warning/45' : 'bg-muted/50')} data-testid="chat-task-approval" data-status={task?.status ?? 'gone'}>
      <div className="flex items-start gap-2">
        <ListChecks className={cn('mt-0.5 size-4 shrink-0', waiting ? 'text-warning' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1">
          {task ? <div className="font-medium">{t('orbchats.cardTitle', { title: task.title })}</div> : <div className="whitespace-pre-wrap break-words">{m.body.replace(/^⚠️\s*/u, '')}</div>}
          {task && why ? <div className="text-muted-foreground mt-0.5 text-[13px]">{t('orbchats.cardWhy', { why })}</div> : null}
        </div>
      </div>
      <div className="chat-actions mt-2.5 flex flex-wrap items-center gap-2 sm:pl-6">
        {waiting ? (<>
          <Button size="xs" className="px-2" variant="ghost" onClick={() => go({ view: 'tasks', id: m.meta.task })} data-testid="chat-task-open">{t('orbchats.taskOpen')}</Button>
          <span className="flex-1" />
          <Button size="xs" className="px-3" variant="outline" disabled={busy} onClick={() => run(rejectTask)} data-testid="chat-task-reject">{t('tasks.reject')}</Button>
          <Button size="xs" className="px-3" disabled={busy} onClick={() => run(approveTask)} data-testid="chat-task-approve"><Check />{t('tasks.approve.ok')}</Button>
        </>) : (<>
          {task ? <Badge variant={STATUS[task.status]?.[1]}>{STATUS[task.status]?.[0] ?? task.status}</Badge> : null}
          <Button size="xs" className="px-2.5" variant="ghost" onClick={() => go({ view: 'tasks', id: m.meta.task })}><ExternalLink />{t('chat.viewTask')}</Button>
        </>)}
      </div>
    </div>
  );
}

// 3.6 (M3): the tasks of this conversation that are running or waiting their turn, each as one live line in the
// conversation (agent, «Tarea #3», what it is doing now, a small bar and the time); a click opens it in Tareas. The
// agent's own conversation and «Cancelar» stay a click away, as in the block they replace.
function TaskLines({ conversation }) {
  const live = useLiveTasks();
  // 3.8.3: and the ones held for review (a mass deletion…), as a card with «Aceptar» and «Deshacer».
  const tasks = useStore((s) => (conversation == null ? [] : s.tasks.filter((x) => x.conversation_id === conversation && (x.status === 'running' || x.status === 'queued' || x.held))));
  if (!tasks.length) return null;
  return <div className="grid gap-2" data-testid="task-lines">{[...tasks].sort((a, b) => a.id - b.id).map((x) => (x.held ? <HeldCard key={x.id} task={x} link className="mx-auto w-full max-w-[92%]" /> : <TaskLine key={x.id} task={x} live={liveOf(live, x.id)} />))}</div>;
}
function TaskLine({ task, live }) {
  const t = useT();
  const running = task.status === 'running';
  const agent = live?.agent ?? task.assigned_to ?? (task.agent !== 'any' ? task.agent : null);
  const now = live?.note || live?.last || task.title;
  const cancel = async () => { if (await confirm(t('comp.live.cancelTask'), t('comp.live.cancelBody', { agent: AGENT[agent] ?? agent ?? '' }), { ok: t('comp.live.cancelTask'), cancel: t('comp.live.back'), danger: true })) act(call('tasks.cancel', { id: task.id }), t('comp.live.cancelled')); };
  return (
    <div className="group/task bg-card/85 mx-auto flex w-full max-w-[92%] items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px]" data-testid="task-line" data-status={task.status}>
      {agent ? <AgentIcon agent={agent} className={cn('size-4', running && 'animate-pulse')} /> : <ListChecks className="text-muted-foreground size-4 shrink-0" />}
      <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline" onClick={() => go({ view: 'tasks', id: task.id })} title={task.title}>
        <span className="font-semibold">{t('orbchats.taskN', { id: task.id })}</span>
        <span className="text-muted-foreground">{agent ? ` · ${AGENT[agent] ?? agent}` : ''} · </span>{now}
      </button>
      {running ? <ProgressBar percent={live?.percent ?? null} quiet={live?.quietMin >= 5} className="w-16 shrink-0 sm:w-24" /> : <WaitLabel task={task} />}
      {running && live?.startedAt ? <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{elapsed(Date.now() - live.startedAt)}</span> : null}
      {live?.sessionId ? <BubbleTip title={t('comp.live.viewConv')}><Button size="icon-xs" variant="ghost" className="opacity-60 group-hover/task:opacity-100" aria-label={t('comp.live.viewConv')} onClick={() => go({ view: 'session', id: live.sessionId })}><MessageSquare /></Button></BubbleTip> : null}
      <BubbleTip title={t('comp.live.cancelTitle')}><Button size="icon-xs" variant="ghost" className="opacity-60 group-hover/task:opacity-100" aria-label={t('comp.live.cancelTitle')} onClick={cancel} data-testid="task-line-cancel"><Square className="size-3 fill-current" /></Button></BubbleTip>
    </div>
  );
}

// The title of a conversation in the middle of a bar, and under it, small, its project with its icon (direct
// conversations, views/session.jsx).
function PausedLine({ body }) {
  const t = useT();
  const paused = useStore((s) => Boolean(s.app?.paused));
  return (
    <div className="chat-actions bg-muted/70 text-muted-foreground mx-auto flex max-w-[88%] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-2 text-center text-[13px]" data-testid="chat-paused">
      <span>{body}</span>
      {paused ? <Button size="xs" variant="soft" onClick={() => resumeQueue(t)} data-testid="chat-resume"><Play />{t('tasks.wait.resume')}</Button> : null}
    </div>
  );
}
// The orchestrator in the composer: its icon and a small switch; the tooltip explains it. A conversation keeps the way it
// started (locked): the switch shows it, and the tooltip says how to talk to an agent directly.
function OrchestratorSwitch({ on, onChange, name, cursor, locked = false }) {
  const t = useT();
  return (
    <BubbleTip title={t('chat.orchestratorTip', { name })} text={locked ? t('chat.orchestratorLocked', { name }) : cursor ? t('chat.orchestratorCursor', { name }) : on ? t('chat.orchestratorOn') : t('chat.orchestratorOff')} side="top">
      <label className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2', locked ? 'cursor-default' : 'hover:bg-accent/60 cursor-pointer')} data-testid="orchestrator">
        <OrchestratorIcon className={cn('size-4', on ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
        <Switch size="sm" checked={on} disabled={locked} onCheckedChange={(v) => onChange(v === true)} aria-label={t('chat.orchestrator')} data-testid="orchestrator-check" />
      </label>
    </BubbleTip>
  );
}

// 3.8.3: the answer being written, the only part of the conversation that follows each streamed piece (drawn once per
// frame: lib/store.js › chatStateSoon); its finished blocks are not parsed again (StreamingMarkdown).
function LiveAnswer({ id, name }) {
  const t = useT();
  const chat = useStore((s) => chatOf(s, id)) ?? {};
  return (
    <div className="flex gap-3">
      <Robot size={32} mood={chat.partial ? 'talking' : 'thinking'} className="mt-0.5" />
      <div className="chat-glass min-w-0 flex-1">
        <div className="text-muted-foreground mb-1 text-xs">{name}</div>
        {chat.partial ? <StreamingMarkdown>{chat.partial}</StreamingMarkdown> : null}
        {chat.waiting ? <div className="text-muted-foreground text-[13px]" data-testid="chat-waiting-turn">{t('chat.waitingTurn')}</div> : <LiveActivity chat={chat} />}
      </div>
    </div>
  );
}

// 3.2: onConversation / project: inside God mode, a new conversation stays there (in its project) instead of navigating.
export function ChatView({ route, onConversation, project: inProject }) {
  const t = useT();
  const app = useStore((s) => s.app);
  const version = useStore((s) => s.version);
  const id = route?.id ?? null;
  const conv = useStore((s) => (id == null ? null : s.conversations.find((c) => c.id === id) ?? null));
  const [rows, setRows] = useState([]);
  const box = useDraft();
  // 3.5, the Android app: what was shared from another app («Compartir con Orb») is waiting in the text box to be sent.
  useEffect(() => {
    if (!bridge.takeShared) return undefined;
    const take = () => { const got = bridge.takeShared(); if (got) box.set((prev) => (prev.trim() ? `${prev.trimEnd()}\n${got}` : got)); };
    take();
    window.addEventListener('orb:shared', take);
    return () => window.removeEventListener('orb:shared', take);
  }, []);
  const name = app.config.assistantName;
  // 3.8.3: only what this view draws from the conversation's live state (the streamed text is LiveAnswer's): a streamed
  // piece does not redraw the whole view.
  const chat = useStore((s) => { const c = chatOf(s, id); return { busy: Boolean(c?.busy), waiting: Boolean(c?.waiting), used: c?.context?.used ?? null, size: c?.context?.size ?? null }; });
  // 3.8: on a phone, the brain and «Orquestador» of a NEW conversation are chosen for that conversation alone (the ones
  // new conversations start with are a setting of the PC).
  const [draft, setDraft] = useState(null);
  const local = Boolean(bridge.mobile) && id == null;
  const defaults = { ...(app.assistant ?? {}), ...(local ? draft ?? {} : {}) };
  useEffect(() => { setRows([]); setOlder([]); setMore(false); }, [id]);
  useEffect(() => {
    if (id == null) return undefined;
    let alive = true;
    call('chat.list', { conversation: id }).then((r) => { if (alive) { setRows((prev) => keepSame(prev, r)); setMore(r.length >= 160); } }).catch(() => {});
    return () => { alive = false; };
  }, [id, version]);
  // A long conversation shows its last 160 lines; the earlier ones, on request.
  const [older, setOlder] = useState([]);
  const [more, setMore] = useState(false);
  const askChanges = useCallback((ids) => box.set(t('chat.changesFor', { ids: ids.map((x) => `#${x}`).join(', ') })), [t, box]);
  const [loading, setLoading] = useState(false);
  const loadOlder = async () => {
    const first = (older[0] ?? rows[0])?.id; if (loading || !first) return; setLoading(true);
    const r = await act(call('chat.list', { conversation: id, before: first }));
    if (r) { setOlder((o) => [...r, ...o]); setMore(r.length >= 120); }
    setLoading(false);
  };
  useEffect(() => { initTestOfTheDay(); }, []);
  // 3.6 (M3): its marks in the Orb zone's list (pinned, muted, unread); what is on screen is marked read.
  useOrbInbox();
  const item = useStore((s) => (id == null ? null : (s.orbInbox?.items ?? []).find((x) => x.key === `conversation:${id}`) ?? null));
  const unread = item?.unread ?? 0;
  useEffect(() => {
    if (id == null || !unread) return undefined;
    const run = () => { if (document.visibilityState === 'visible') call('inbox.markRead', { kind: 'conversation', id }).then(() => loadOrbInboxSoon(0)).catch(() => {}); };
    const timer = setTimeout(run, 350);
    document.addEventListener('visibilitychange', run);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', run); };
  }, [id, unread, rows.length]);
  const showTest = useStore((s) => s.testToday) === true && id == null;
  // 3.8.3: the line the turn just wrote, from the state that ended it (until the conversation is read again), and the
  // messages the user sent that the engine has not saved yet: no wait and no gap on screen.
  const answer = useStore((s) => (id == null ? null : s.answers?.[id] ?? null));
  const pending = usePending(id == null ? 'new' : `chat:${id}`);
  const scroll = useAutoScroll([rows.length, chat.busy, id, pending.length, answer?.id]);
  const catalog = useCatalog();
  const brain = conv
    ? { agent: conv.agent ?? 'claude', model: conv.model ?? '', account: conv.account ?? conv.agent, reasoning: conv.reasoning ?? 'medium' }
    : { agent: defaults.agent ?? 'claude', model: defaults.model ?? '', account: defaults.account, reasoning: defaults.reasoning ?? 'medium' };
  const orchestrate = conv ? true : defaults.orchestrate !== false;
  const bubble = useUsageBubble(catalog, brain);
  const userName = useStore((st) => st.app?.config?.userName?.trim() || '');
  const [sending, setSending] = useState(false);
  // 3.2.1: in God mode, a new conversation goes to the project chosen there, and the bar says that one.
  const projects = useStore((s) => s.projects);
  const workProject = inProject ? projects.find((p) => p.name === inProject) ?? { name: inProject } : app.activeProject ?? null;
  const greeting = useGreeting(workProject?.name ?? null);

  // 3.2.1: inside God mode, the project chosen there right now (the answer to a first message may come after a change).
  const projectNow = useRef(inProject); projectNow.current = inProject;
  // The user went elsewhere while the first message was on its way: they stay where they are, and a notice says where
  // the message is (one click away).
  const leftBehind = (target, title) => notify({ title: t('chat.startedIn', { title }), body: t('chat.startedInBody'), tone: 'info', go: target, action: { label: t('notice.open'), onClick: () => go(target) } });
  const send = async () => {
    const msg = box.get().trim(); if (!msg || sending) return;
    box.set('');
    dismissTest();
    const mine = addPending(id == null ? 'new' : `chat:${id}`, msg, lastId);
    if (id != null) {
      // The send failed: the message goes back to the box (unless something else was written there meanwhile).
      if ((await act(call('chat.send', { text: msg, conversation: id }))) === undefined) { dropPending(mine); box.set((now) => (now.trim() ? now : msg)); }
      else call('chat.list', { conversation: id }).then((r) => { if (getState().route?.id === id) setRows((prev) => keepSame(prev, r)); }).catch(() => {});
      return;
    }
    setSending(true);
    const ticket = navTicket(); const startedIn = inProject;
    const moved = () => !stillHere(ticket) || (onConversation && projectNow.current !== startedIn);
    try {
      if (orchestrate) {
        // 3.2: the first message makes the conversation (in the working folder): then the screen is that conversation.
        const chosen = local && draft ? Object.fromEntries(['agent', 'model', 'reasoning'].filter((k) => draft[k] !== undefined).map((k) => [k, draft[k]])) : {};
        const r = await act(call('chat.send', { text: msg, ...(inProject ? { project: inProject } : {}), ...(Object.keys(chosen).length ? { brain: chosen } : {}) }));
        if (!r) { dropPending(mine); if (!moved()) box.set(msg); return; }
        movePending(mine, `chat:${r.conversation}`);
        await refresh().catch(() => {});
        if (moved()) { leftBehind({ view: 'chat', id: r.conversation }, getState().conversations.find((c) => c.id === r.conversation)?.title ?? msg.slice(0, 60)); return; }
        if (onConversation) onConversation(r.conversation); else go({ view: 'chat', id: r.conversation });
      } else {
        // «Orquestador» off: the user hands out the work, and the conversation is directly with the agent chosen below
        // (3.2.1: in God mode, in the project chosen there).
        const project = inProject ?? app.activeProject?.name ?? null;
        const s = await act(call('sessions.create', { agent: brain.agent, account: brain.account && brain.account !== brain.agent ? brain.account : undefined, model: brain.model || undefined, reasoning: brain.reasoning, project, permission: project ? 'editar' : 'leer' }));
        if (!s) { dropPending(mine); if (!moved()) box.set(msg); return; }
        movePending(mine, `session:${s.id}`);
        if ((await act(call('sessions.send', { id: s.id, text: msg }))) === undefined) dropPending(mine);
        await refresh().catch(() => {});
        if (!stillHere(ticket)) { leftBehind({ view: 'session', id: s.id }, s.title); return; }
        go({ view: 'session', id: s.id });
      }
    } finally { setSending(false); }
  };
  const settings = async (patch) => {
    if (local) { setDraft((d) => ({ ...(d ?? {}), ...patch })); return true; }
    const r = await act(call('chat.settings', { ...patch, ...(id != null ? { conversation: id } : {}) })); if (r) { setState((s) => ({ app: { ...s.app, ...(id == null ? { assistant: r } : {}) } })); refreshSoon(); } return r;
  };
  // 3.2.1: the assistant cannot coordinate with Cursor as its brain (Cursor takes no tools of Orb's): turning the
  // «Orquestador» on moves the brain to Claude (or Codex) and says so, instead of doing nothing.
  const coordinator = ['claude', 'codex'].find((a) => catalog?.some((x) => x.id === a)) ?? null;
  const toggleOrchestrator = async (checked) => {
    if (!checked && !(await confirm(t('chat.freeMode'), t('chat.freeModeBody', { name }), { ok: t('chat.freeModeOk') }))) return;
    if (checked && brain.agent === 'cursor') {
      if (!coordinator) { notify({ title: t('chat.orchestratorNoBrain', { name }), tone: 'warning' }); return; }
      if (await settings({ orchestrate: true, agent: coordinator, model: '' })) notify({ title: t('chat.orchestratorSwitched', { name, agent: AGENT[coordinator] }), tone: 'info' });
      return;
    }
    settings({ orchestrate: checked });
  };
  // Choosing Cursor for a new conversation with the «Orquestador» on: the conversation becomes a direct one with Cursor.
  const pickBrain = async (b) => {
    if (id == null && b.agent === 'cursor' && orchestrate) {
      if (await settings({ agent: b.agent, model: b.model, account: b.account, orchestrate: false })) notify({ title: t('chat.cursorDirect'), tone: 'info' });
      return;
    }
    settings({ agent: b.agent, model: b.model, account: b.account });
  };
  const saved = [...older, ...rows];
  // The answer that ended the turn goes after the lines until a new read of the conversation brings it.
  const lastId = saved.at(-1)?.id ?? 0;
  const lines = answer && answer.id > lastId ? [...saved, answer] : saved;
  const unsaved = pendingShown(pending, lines.filter((m) => m.role === 'usuario').map((m) => ({ id: m.id, text: m.body })));
  useEffect(() => { for (const p of pending) if (!unsaved.includes(p)) dropPending(p.id); }, [pending, unsaved]);
  // 3.6: «Compactar» when the conversation's context is at 70 % or more (never while it answers).
  const live = useMemo(() => (chat.size ? { used: chat.used, size: chat.size } : null), [chat.used, chat.size]);
  const context = live ?? conv?.context ?? null;
  const [compacting, setCompacting] = useState(false);
  const compactable = id != null && !chat.waiting && (compacting || (!chat.busy && context?.size > 0 && context.used / context.size >= COMPACT_AT));
  const compact = async () => {
    setCompacting(true);
    try { const r = await act(call('chat.compact', { conversation: id })); if (r) refreshSoon(); }
    finally { setCompacting(false); }
  };

  const embedded = Boolean(onConversation);
  const slim = phoneLayout() && Boolean(conv);
  const infoOpen = useStore((s) => s.orbInfo?.type === 'chat') && !embedded;
  const headProject = conv ? conv.project ?? null : workProject?.name ?? null;
  const waitingYou = useStore((s) => id != null && s.tasks.some((x) => x.conversation_id === id && x.status === 'awaiting_approval'));
  const chatActions = useOrbActions(conv ? { kind: 'conversation', id: conv.id, title: conv.title, done: conv.status === 'done', pinned: Boolean(item?.pinned), muted: Boolean(item?.muted), unread: 0 } : null);

  return (
    <>
      {/* 3.6 (M3): the bar of a messaging app: (phone: back to the list) the pill with Orbe, the title and, small, the
          project and what it is doing; a click opens the chat's info. On the right: notifications, pause and ⋯. */}
      <ChatBar back={embedded ? null : <BackToList to="chats" />} testid="orb-chat-bar" className="topbar-chat" title={<>
        <h1 className="sr-only">{conv?.title ?? t('orbchats.newChatTitle')}</h1>
        <button type="button" disabled={!conv || embedded} onClick={() => (infoOpen ? closeOrbInfo() : openOrbInfo({ type: 'chat' }))}
          className={cn('press flex min-w-0 items-center gap-2.5 rounded-xl py-1 pr-3 pl-1 text-left', conv && !embedded && 'cursor-pointer', infoOpen ? 'bg-accent' : conv && !embedded ? 'hover:bg-accent/60' : '')}
          aria-expanded={conv ? infoOpen : undefined} aria-label={conv ? t('chats.openInfo', { name: conv.title }) : undefined} data-testid="orb-chat-head">
          <Robot size={36} mood={chat.busy ? 'thinking' : 'idle'} still={!chat.busy} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5"><span className="truncate text-[15px] font-semibold" data-testid="bar-title-text">{conv?.title ?? t('orbchats.newChatTitle')}</span>{item?.muted ? <BellOff className="text-muted-foreground size-3.5 shrink-0" aria-label={t('chats.muted')} /> : null}</span>
            <span className={cn('flex min-w-0 items-center gap-1 text-[12.5px]', chat.busy ? 'text-primary' : waitingYou ? 'text-warning-ink' : 'text-muted-foreground')} data-testid="orb-chat-status">
              {headProject ? <ProjectIcon name={headProject} size={14} /> : <Folder className="size-3 shrink-0" aria-hidden="true" />}
              <span className="truncate">{headProject ?? t('orbchats.noProject')} · {chat.busy ? t('chats.working') : waitingYou ? t('orbchats.awaiting') : name}</span>
            </span>
          </span>
        </button>
      </>}>
        {/* The phone keeps the bar light: the bell is the system's notifications there, and «Pausar» goes into ⋯. */}
        {slim ? null : <NotificationBell />}
        {slim ? null : <BarPause />}
        {/* 3.8.2: only the bell and pause stay on the bar; the chat's actions and the games go into ⋯ (also in «Nuevo chat»). */}
        {conv || fullPc() ? (
          <DropdownMenu modal={false}>
            <BubbleTip title={t('chats.more')}><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={t('chats.more')} data-testid="orb-chat-more"><Ellipsis /></Button></DropdownMenuTrigger></BubbleTip>
            <DropdownMenuContent align="end" className="w-56">
              {conv && !embedded ? <DropdownMenuItem onSelect={() => openOrbInfo({ type: 'chat' })} data-testid="more-info"><Info />{t('orbchats.info')}</DropdownMenuItem> : null}
              {slim ? <DropdownMenuItem onSelect={() => setQueuePaused(!app.paused, t)} data-testid={app.paused ? 'bar-resume' : 'bar-pause'}>{app.paused ? <Play /> : <Pause />}{app.paused ? t('bar.resume') : t('bar.pause')}</DropdownMenuItem> : null}
              {chatActions.filter((a) => a.id !== 'info' && !a.danger).map((a) => <DropdownMenuItem key={a.id} onSelect={a.run} data-testid={`more-${a.id}`}><a.icon />{a.label}</DropdownMenuItem>)}
              {fullPc() ? <DropdownMenuItem onSelect={openGames} data-testid="bar-games"><Gamepad2 />{t('bar.games')}</DropdownMenuItem> : null}
              {chatActions.filter((a) => a.danger).map((a) => <div key={a.id}><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={a.run} data-testid={`more-${a.id}`}><a.icon />{a.label}</DropdownMenuItem></div>)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </ChatBar>
      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="lazy-lines mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6" data-testid="chat-lines">
          {more ? <Button variant="ghost" size="sm" className="text-muted-foreground mx-auto" onClick={loadOlder} disabled={loading} data-testid="chat-older"><History />{t('chat.older')}</Button> : null}
          {id == null && !sending ? (
            <div className="flex flex-col items-center gap-3 pt-10 text-center">
              <Robot size={130} mood="hello" live />
              <div className="chat-glass chat-hero flex flex-col items-center gap-3">
                <h2 className="hero-title mt-2 text-2xl" data-testid="chat-greeting">{userName ? t(greeting.key, { ...greeting, user: userName, name }) : t('chat.hello', { name })}</h2>
                <p className="text-muted-foreground max-w-md">{t(greeting.sub)}</p>
              </div>
              <div className="mt-3 flex max-w-xl flex-wrap justify-center gap-2">{suggestionsFor(workProject?.name).map((s) => <Button key={s} variant="outline" size="sm" className="h-auto max-w-full shrink rounded-full py-1.5 whitespace-normal" onClick={() => box.set(t(s))}>{t(s)}</Button>)}</div>
            </div>
          ) : lines.map((m) => <Message key={m.id} m={m} name={name} onChanges={askChanges} />)}
          {unsaved.map((p) => <Message key={p.id} m={{ id: p.id, role: 'usuario', body: p.text, at: p.at }} name={name} onChanges={askChanges} />)}
          <TaskLines conversation={id} />
          {chat.busy || chat.waiting || sending ? <LiveAnswer id={id} name={name} /> : null}
        </div>
      </div>
      <Composer draft={box} onSend={send} onStop={id != null ? () => act(call('chat.stop', { conversation: id })) : undefined} busy={chat.busy} disabled={sending} testid="chat-input"
        placeholder={chat.busy ? t('chat.placeholderBusy', { name }) : orchestrate ? t('chat.placeholder', { name }) : t('chat.placeholderDirect', { agent: AGENT[brain.agent] ?? brain.agent })}
        top={<>
          {/* 3.2.1: in God mode a new conversation takes the project chosen at the top of God mode. */}
          {inProject && id == null ? null : <ProjectPicker conversation={id} />}
          <ContextSlot items={[
            // 3.6: the context is filling up: compact it (the history stays; the assistant goes on from a summary).
            compactable ? { key: 'compact', node: <CompactButton onCompact={compact} busy={compacting} /> } : null,
            // 3.0: the test of the day (first opening of the day, until the user writes; always in Ajustes › Agentes y uso).
            showTest ? { key: 'test', node: <BubbleTip title={t('test.button')} text={t('test.tip')} side="top"><Button size="xs" variant="soft" onClick={() => runTest(t('test.prompt'))} data-testid="chat-test"><FlaskConical />{t('test.button')}</Button></BubbleTip> } : null
          ]} />
        </>}
        notice={<UsageBubble text={bubble.text} onClose={bubble.close} />}
        bottom={<>
          <BrainPicker catalog={catalog} value={brain} onChange={pickBrain} className="min-w-0 shrink" />
          <ReasoningMenu catalog={catalog} value={brain} onChange={(reasoning) => settings({ reasoning })} />
          {/* 3.2: whether a NEW conversation is with the assistant or directly with the agent chosen; a conversation keeps
              the way it started. 3.6: an icon and a small switch; the tooltip explains it. */}
          <OrchestratorSwitch on={orchestrate} onChange={toggleOrchestrator} name={name} cursor={brain.agent === 'cursor'} locked={id != null} />
          {context ? <span className="text-muted-foreground ml-auto shrink-0 text-xs"><ContextMeter context={context} /></span> : null}
        </>} />
    </>
  );
}
