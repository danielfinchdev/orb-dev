// Tasks: the board. Filters, approvals, details and every action on a task (undo, retry, model, merge, pull request, OK).
import { useEffect, useMemo, useRef, useState } from 'react';
import { notifyOk } from '@/lib/notify.js';
import { Check, X, Zap, RotateCw, Square, Shuffle, Undo2, MessageSquare, GitMerge, GitPullRequest, Trash2, ClipboardCheck, ThumbsUp, ChevronRight, ScanSearch, MessageSquarePlus, Hourglass, GitBranch, Play, Pause, Plus, Layers, Users, Clock, ShieldAlert, RefreshCw, Activity, CircleStop, CircleX, UserCog, Bot, Calendar, Link, BadgeCheck, Folder, Info, FileDiff, MessagesSquare, Ellipsis } from 'lucide-react';
import { PageHeader, PageBody, BackButton } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { useLiveTasks, liveOf, LiveTask, ProgressBar } from '@/components/live-tasks.jsx';
import { modelsOf } from '@/components/brain-picker.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { approveTask, rejectTask } from '@/components/task-approval.jsx';
import { TaskChanges, ChangesSummary, ChangesFiles, ChangesMeta, DiffStat, useDiffStat, useTaskDiffRaw, diffOf, ChangesEmpty } from '@/components/task-changes.jsx';
import { useComments } from '@/lib/turn-comments.js';
import { HeldCard, PausedNote, TaskStatus, waitText, setQueuePaused, acceptHeld, undoHeld, undoTask } from '@/components/task-state.jsx';
import { ChatPanel } from '@/components/chat-panel.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { BarPause } from '@/components/conversation/bar.jsx';
import { Button } from '@/components/ui/button.jsx';
import { askNewTask } from '@/components/new-task.jsx';
import { Badge, Card, Empty, Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { Tabs, TabsList, TabsTrigger, Select, Collapsible, CollapsibleTrigger, CollapsibleContent, BubbleTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { Note, IconButton, MoreButton, ListCard, ListRow, SectionLabel, SearchInput } from '@/components/ui/primitives.jsx';
import { useStore, call, act, go, bridge, phoneLayout, fullPc, refresh } from '@/lib/store.js';
import { activityLabel, activityDetail } from '@/lib/activity.js';
import { AGENT, STATUS, REASONING, MODE, SENSITIVE, options } from '@/lib/labels.js';
import { ago, fmtTime, cn } from '@/lib/utils.js';
import { t, useT, useLocale } from '@/lib/i18n.js';
import { needsApproval } from '@/lib/task-approval.js';

const FILTERS = [
  ['encurso', 'tasks.filter.active', (x) => ['running', 'queued'].includes(x.status)], // working now or waiting its turn
  // also the tasks Orb held for review after they ran (a mass deletion…): they wait for the user's OK too.
  ['aprobar', 'tasks.filter.approve', needsApproval],
  ['hechas', 'tasks.filter.done', (x) => x.status === 'done'],
  ['incidencias', 'tasks.filter.problems', (x) => ['failed', 'blocked', 'limited'].includes(x.status) && !x.held],
  ['todas', 'tasks.filter.all', () => true]
];
const verdictLabel = (v) => (['correcto', 'con fallos'].includes(v) ? t(`tasks.verdict.${v}`) : v);
// Who reviews (Task Review, Security Review): automatic (another provider with quota) or an installed agent.
const reviewers = async () => (await call('agents.status')).filter((a) => a.enabled && a.installed);
const ReviewerField = ({ agents, v, set }) => <Field label={t('tasks.review.reviewer')} hint={t('tasks.review.reviewerHint')}><Select className="w-full" value={v.agent || '__auto'} onValueChange={(agent) => set({ agent: agent === '__auto' ? '' : agent })} options={[{ value: '__auto', label: t('tasks.review.auto') }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} /></Field>;

// Task Review: another model (another provider when there is one) audits the work read-only and gives a verdict.
export async function askReview({ task, project }) {
  const agents = await reviewers();
  return form(task ? t('tasks.review.titleTask', { id: task.id }) : t('tasks.review.titleProject', { project }), {
    description: t('tasks.review.desc'),
    initial: { agent: '', focus: '' },
    body: (v, set) => (<>
      <ReviewerField agents={agents} v={v} set={set} />
      <Field label={t('tasks.review.focus')}><Textarea rows={3} value={v.focus} onChange={(e) => set({ focus: e.target.value })} placeholder={t('tasks.review.focusPh')} /></Field>
    </>),
    ok: t('tasks.review.ok'),
    onOk: async (v) => (task ? call('tasks.review', { id: task.id, agent: v.agent || null, focus: v.focus }) : call('projects.review', { name: project, agent: v.agent || null, focus: v.focus }))
  });
}

// Security Review of a whole project: who audits it (automatic: another provider with quota).
export async function askSecurityReview({ project }) {
  const agents = await reviewers();
  return form(t('tasks.security.title', { project }), {
    description: t('tasks.security.desc'),
    initial: { agent: '' },
    body: (v, set) => <ReviewerField agents={agents} v={v} set={set} />,
    ok: t('tasks.security.ok'),
    onOk: (v) => call('projects.securityReview', { name: project, agent: v.agent || null })
  });
}

// Every action on one task, in one place: the phone's detail, the PC's panel and the rows of the list ask the same calls,
// the same confirmations and show the same texts (tr: the translator, task: the task as the list or tasks.get gives it).
function taskActions(task, tr) {
  const t = task;
  const reassign = async () => {
    const agents = (await call('agents.status')).filter((a) => a.enabled && a.installed);
    // the model is chosen from the agent's real ones (with what each is for), or left to Orb: never typed.
    const catalog = await call('models.catalog').catch(() => []);
    const AUTO = '__auto';
    const modelOptions = (agent) => {
      const list = modelsOf(catalog.find((a) => a.id === agent), agent === t.agent ? t.account : null).filter((m) => m.id);
      const opts = [{ value: AUTO, label: tr('tasks.reassign.auto') }, ...list.map((m) => ({ value: m.id, label: m.tier ? `${m.label} · ${tr(`tasks.tier.${m.tier}`)}` : m.label }))];
      if (t.model && !opts.some((o) => o.value === t.model)) opts.push({ value: t.model, label: t.model });
      return opts;
    };
    await form(tr('tasks.reassign.title', { id: t.id }), {
      initial: { agent: t.agent, model: t.model ?? AUTO, reasoning: t.reasoning },
      body: (v, set) => (<>
        <Field label={tr('tasks.agent')}><Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent, model: AUTO })} options={[{ value: 'any', label: tr('tasks.reassign.any') }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} /></Field>
        <Field label={tr('tasks.reassign.model')} hint={tr('tasks.reassign.modelHint')}><Select className="w-full" value={v.agent === 'any' ? AUTO : v.model} disabled={v.agent === 'any'} onValueChange={(model) => set({ model })} options={modelOptions(v.agent)} data-testid="reassign-model" /></Field>
        <Field label={tr('tasks.reassign.reasoning')}><Select className="w-full" value={v.reasoning} onValueChange={(reasoning) => set({ reasoning })} options={options(REASONING).filter((o) => o.value !== 'xhigh')} /></Field>
      </>),
      ok: tr('tasks.reassign.ok'), onOk: (v) => call('tasks.reassign', { id: t.id, agent: v.agent, model: v.agent === 'any' || v.model === AUTO ? null : v.model, reasoning: v.reasoning })
    });
  };
  const createPr = async () => {
    const url = await form(tr('tasks.pr.title'), {
      wide: true, description: tr('tasks.pr.desc', { branch: t.branch }),
      initial: { title: t.title, body: `${t.result ?? ''}\n\n${tr('tasks.pr.doneBy', { id: t.id, agent: AGENT[t.assigned_to] ?? t.assigned_to })}` },
      body: (v, set) => (<><Field label={tr('tasks.titleField')}><Input value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field><Field label={tr('tasks.pr.descField')}><Textarea rows={6} value={v.body} onChange={(e) => set({ body: e.target.value })} /></Field></>),
      ok: tr('tasks.pr.ok'), onOk: async (v) => (await call('projects.createPr', { name: t.project, branch: t.branch, title: v.title, body: v.body })).url
    });
    if (url) confirm(tr('tasks.pr.created'), url, { cancel: null, ok: tr('tasks.pr.open') }).then((open) => open && bridge.openExternal(url));
  };
  return {
    reassign,
    createPr,
    accept: () => act(call('tasks.accept', { id: t.id }), tr('tasks.accepted')),
    launch: async () => { const r = await act(call('tasks.launchAnyway', { id: t.id })); if (r) notifyOk(tr(r.paused ? 'tasks.launchAnyway.paused' : 'tasks.launchAnyway.done')); },
    retry: () => act(call('tasks.retry', { id: t.id }), tr('tasks.retry.done')),
    undo: () => undoTask(tr, t),
    merge: async () => { if (await confirm(tr('tasks.merge'), tr('tasks.merge.body', { branch: t.branch }), { ok: tr('tasks.merge.ok'), danger: true })) await act(call('projects.merge', { name: t.project, branch: t.branch }), tr('tasks.merge.done')); },
    discard: async () => { if (await confirm(tr('tasks.discard'), tr('tasks.discard.body', { branch: t.branch }), { ok: tr('tasks.discard.ok'), danger: true })) await act(call('tasks.discardBranch', { id: t.id }), tr('tasks.discard.done')); },
    cancel: async () => { if (await confirm(tr('tasks.cancel.title'), t.status === 'running' ? tr('tasks.cancel.running') : tr('tasks.cancel.ask'), { ok: tr('tasks.cancel.title'), cancel: tr('tasks.cancel.back'), danger: true })) await act(call('tasks.cancel', { id: t.id }), tr('tasks.cancel.done')); }
  };
}

// A task read whole (tasks.get), again whenever the lists change.
// `loading` is true from the moment a task is chosen until its first read ends, so the panel can wait instead of
// saying «Selecciona una tarea» next to a row that is already marked.
function useTaskDetailState(id) {
  const version = useStore((s) => s.version);
  const [task, setTask] = useState(null);
  const [settled, setSettled] = useState(null); // the id whose read has ended
  useEffect(() => {
    if (id == null) { setTask(null); setSettled(null); return undefined; }
    let alive = true;
    call('tasks.get', { id }).then((r) => { if (alive) { setTask(r); setSettled(id); } }).catch(() => { if (alive) { setTask(null); setSettled(id); } });
    return () => { alive = false; };
  }, [id, version]);
  return [task && String(task.id) === String(id) ? task : null, id != null && settled !== id];
}
const useTaskDetail = (id) => useTaskDetailState(id)[0];

// The detail of the phone and of a linked browser: one card.
function TaskDetail({ id, live }) {
  const tr = useT();
  const locale = useLocale();
  const t = useTaskDetail(id);
  if (!t) return <Card><Empty title={tr('tasks.pick')} icon={ClipboardCheck} /></Card>;
  const who = t.assigned_to ?? t.agent;
  const A = (props) => <Button size="sm" variant="outline" {...props} />;
  const { reassign, createPr, accept, launch, retry, undo, merge, discard, cancel } = taskActions(t, tr);
  return (
    <Card className="gap-5" data-testid="task-detail">
      <div className="flex items-start gap-3 px-5">
        <AgentIcon agent={who} className="mt-1 size-5" />
        <div className="min-w-0 flex-1"><div className="text-muted-foreground text-xs">{tr('tasks.taskNo', { id: t.id, project: t.project })}</div><h2 className="text-title leading-snug">{t.title}</h2></div>
        {t.accepted ? <Badge variant="success"><ThumbsUp />{tr('tasks.accepted')}</Badge> : null}<TaskStatus status={t.status} undone={Boolean(t.undone)} task={t} />
      </div>
      <div className="flex flex-wrap gap-2 px-5">
        {t.status === 'awaiting_approval' ? (<>
          <Button size="sm" onClick={() => approveTask(t)}><Check />{tr('tasks.approve.ok')}</Button>
          <Button size="sm" variant="outline" onClick={() => rejectTask(t)}><X />{tr('tasks.reject')}</Button>
        </>) : null}
        {t.status === 'done' && !t.accepted && !t.undone ? <Button size="sm" onClick={accept}><ThumbsUp />{tr('tasks.giveOk')}</Button> : null}
        {t.status === 'done' && !t.review_of ? <BubbleTip title={tr('tasks.review.btn')} text={tr('projects.reviewTip')}><A onClick={() => askReview({ task: t })} data-testid="task-review"><ScanSearch />{tr('tasks.review.btn')}</A></BubbleTip> : null}
        {t.session_id ? <A onClick={() => go({ view: 'session', id: t.session_id })}><MessageSquare />{tr('tasks.agentChat')}</A> : null}
        {t.status === 'queued' ? <A onClick={launch}><Zap />{tr('tasks.launchAnyway')}</A> : null}
        {['failed', 'blocked', 'cancelled', 'limited'].includes(t.status) ? <A onClick={retry}><RotateCw />{t.status === 'limited' ? tr('tasks.continueNow') : tr('tasks.retry')}</A> : null}
        {!['running', 'done'].includes(t.status) ? <A onClick={reassign}><Shuffle />{tr('tasks.reassign.btn')}</A> : null}
        {/* (A held task has «Deshacer» on its card below, next to «Aceptar».) */}
        {t.hasCheckpoint && t.status !== 'running' && !t.held ? <A onClick={undo}><Undo2 />{tr('tasks.undo.btn')}</A> : null}
        {t.branch && t.status === 'done' ? (<>
          <A onClick={merge}><GitMerge />{tr('tasks.merge')}</A>
          <A onClick={createPr}><GitPullRequest />{tr('tasks.pr.title')}</A>
          <Button size="sm" variant="danger" onClick={discard}><Trash2 />{tr('tasks.discard')}</Button>
        </>) : null}
        {!['done', 'cancelled'].includes(t.status) ? <Button size="sm" variant="danger" onClick={cancel}><Square />{tr('tasks.cancel')}</Button> : null}
      </div>
      {/* held for review: what it did and where, with «Aceptar» and «Deshacer»; a paused queue, with «Reanudar». */}
      {t.held ? <HeldCard task={t} className="mx-5" /> : null}
      {t.status === 'queued' && t.waiting?.kind === 'paused' ? <PausedNote className="mx-5" /> : null}
      {t.status === 'queued' && t.waiting?.kind === 'manual' ? <Note className="mx-5" data-testid="task-wait-manual">{tr('tasks.wait.manualNote')}</Note> : null}
      {t.status === 'queued' && t.waiting?.kind === 'deps' ? <Note className="mx-5" data-testid="task-wait-deps">{waitText(tr, t)}</Note> : null}
      {t.status === 'running' && live ? <div className="bg-muted/50 mx-5 rounded-xl border px-3.5 py-3" data-testid="task-live"><LiveTask t={live} actions={false} /></div> : null}
      {t.undone ? <Note icon={Undo2} className="mx-5">{tr('tasks.undoneNote', { when: fmtTime(t.undone.at) })}</Note> : null}
      {t.status === 'limited' && t.limited_until ? <Note tone="warning" icon={Hourglass} className="mx-5">{tr('tasks.limitedNote', { when: fmtTime(t.limited_until) })}</Note> : null}
      {t.review ? <div className={cn('mx-5 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-control', t.review.verdict === 'correcto' ? 'border-success/40 bg-success/10' : t.review.verdict === 'con fallos' ? 'border-destructive/40 bg-destructive/10' : 'bg-muted/50')}><ScanSearch className="size-4" />{tr('tasks.review.line', { agent: AGENT[t.review.agent] ?? t.review.agent })} <span className="font-medium">{verdictLabel(t.review.verdict)}</span><Button size="sm" variant="ghost" className="ml-auto" onClick={() => go({ view: 'tasks', id: t.review.task })}>{tr('tasks.review.see', { id: t.review.task })}</Button></div> : null}
      <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5 px-5 text-control">
        <dt className="text-muted-foreground">{tr('tasks.agent')}</dt><dd>{tr('tasks.agentLine', { agent: `${t.accountLabel ?? AGENT[who] ?? who}${t.model ? ` · ${t.modelLabel ?? t.model}` : ''}`, reasoning: REASONING[t.reasoning]?.toLowerCase() ?? t.reasoning })}</dd>
        <dt className="text-muted-foreground">{tr('tasks.where')}</dt><dd className="break-all">{MODE[t.mode]}{t.readonly ? ` · ${tr('tasks.readonlyShort')}` : ''}{t.branch ? ` · ${tr('tasks.branchShort', { branch: t.branch })}` : ''}</dd>
        <dt className="text-muted-foreground">{tr('tasks.created')}</dt><dd>{tr('tasks.createdBy', { time: fmtTime(t.created_at), agent: AGENT[t.created_by] ?? t.created_by })}</dd>
        {t.parent_id ? <><dt className="text-muted-foreground">{tr('tasks.subOf')}</dt><dd><button className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: t.parent_id })}>#{t.parent_id}</button></dd></> : null}
        {t.review_of ? <><dt className="text-muted-foreground">{tr('tasks.reviews')}</dt><dd><button className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: t.review_of })}>#{t.review_of}</button></dd></> : null}
        {t.children?.length ? <><dt className="text-muted-foreground">{tr('tasks.subtasks')}</dt><dd className="flex flex-wrap gap-1">{t.children.map((c) => <button key={c.id} onClick={() => go({ view: 'tasks', id: c.id })} className="cursor-pointer"><Badge variant={STATUS[c.status]?.[1] ?? 'secondary'} className="gap-1"><GitBranch className="size-3" />#{c.id} {AGENT[c.assigned_to ?? c.agent] ?? c.agent} · <TaskStatus task={c} plain /></Badge></button>)}</dd></> : null}
        {t.dependencies?.length ? <><dt className="text-muted-foreground">{tr('tasks.dependsOn')}</dt><dd className="flex flex-wrap gap-1">{t.dependencies.filter(Boolean).map((d) => <Badge key={d.id} variant="secondary">#{d.id} <TaskStatus task={d} plain /></Badge>)}</dd></> : null}
        {t.sensitivity.length ? <><dt className="text-muted-foreground">{tr('tasks.approval')}</dt><dd className="flex flex-wrap gap-1">{t.sensitivity.map((s) => <Badge key={s} variant="warning">{SENSITIVE[s] ?? s}</Badge>)}</dd></> : null}
      </dl>
      <div className="grid gap-1.5 px-5"><div className="text-muted-foreground text-xs">{tr('tasks.brief')}</div><pre className="bg-muted max-h-72 overflow-auto rounded-lg px-3 py-2 font-sans text-control whitespace-pre-wrap">{t.description}</pre></div>
      {t.result ? <div className="grid gap-1.5 px-5"><div className="text-muted-foreground text-xs">{tr('tasks.result')}</div><div className="rounded-lg border px-3.5 py-2.5 text-control"><Markdown>{t.result}</Markdown></div></div> : null}
      {/* the files it changed, with their diff (read only: «Deshacer» above works as before). */}
      {t.hasCheckpoint && t.status !== 'running' ? <TaskChanges taskId={t.id} version={`${t.status}:${t.updated_at}`} className="mx-5" /> : null}
      <Collapsible className="px-5">
        <CollapsibleTrigger className="text-muted-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />{tr('tasks.history', { n: t.events.length })}</CollapsibleTrigger>
        <CollapsibleContent><ol className="mt-2 grid gap-1.5 text-xs">{t.events.slice().reverse().map((e, i) => <li key={i} className="grid grid-cols-[110px_1fr] gap-2"><span className="text-muted-foreground">{fmtTime(e.at)}</span><span><span className="font-medium" title={e.kind}>{activityLabel(tr, e.kind)}</span> <span className="text-muted-foreground">{AGENT[e.actor] ?? e.actor}</span>{activityDetail(tr, e, locale, AGENT) ? <span className="text-muted-foreground block break-all" title={e.detail}>{activityDetail(tr, e, locale, AGENT)}</span> : null}</span></li>)}</ol></CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// the phone: the filter chosen stays when a task is opened and closed again.
let phoneFilter = null;

function TasksLegacy({ route }) {
  const tr = useT();
  const all = useStore((s) => s.tasks);
  const phone = phoneLayout();
  // From a folder of the left menu: only that project's tasks (with a button to see them all).
  const tasks = route.project ? all.filter((t) => t.project === route.project) : all;
  const [filter, setFilterState] = useState(() => (phone && phoneFilter) || (route.id && !phone ? 'todas' : tasks.some(needsApproval) ? 'aprobar' : tasks.some((x) => ['running', 'queued'].includes(x.status)) ? 'encurso' : 'todas'));
  const setFilter = (f) => { setFilterState(f); if (phone) phoneFilter = f; };
  const [selected, setSelected] = useState(route.id ?? null);
  const rows = tasks.filter(FILTERS.find(([k]) => k === filter)[2]);
  const live = useLiveTasks();
  // The first task of the list is shown when nothing (or something no longer listed) is selected (the PC: list and
  // detail side by side; the phone opens a task on a screen of its own).
  useEffect(() => { if (!phone && rows.length && !rows.some((t) => t.id === selected)) setSelected(rows[0].id); }, [filter, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = route.project ? { view: 'tasks', project: route.project } : { view: 'tasks' };
  // the phone: a task on its own screen, with the back arrow to the list (also Android's back).
  if (phone && route.id != null) return (
    <>
      <PageHeader back={<BackButton to={list} />} title={tr('tasks.taskTitle', { id: route.id })} />
      <PageBody className="px-3 py-3"><TaskDetail id={route.id} live={liveOf(live, route.id)} /></PageBody>
    </>
  );
  const open = (t) => (phone ? go({ ...list, id: t.id }) : setSelected(t.id));
  return (
    <>
      <PageHeader icon={<ClipboardCheck className="text-primary-text size-5" />} title={route.project ? tr('tasks.titleProject', { project: route.project }) : tr('nav.tasks')} meta={tr('tasks.sub', { total: tasks.length, shown: rows.length, waiting: tasks.filter(needsApproval).length })}>
        {route.project ? <Button size="sm" variant="ghost" onClick={() => go('tasks')}><X />{tr('tasks.allProjects')}</Button> : null}
      </PageHeader>
      <PageBody className="md:pb-28">
        <Tabs value={filter} onValueChange={setFilter} className="mb-4">
          {/* The phone: chips that wrap to a second line instead of a strip cut at the edge. */}
          <TabsList className={phone ? 'h-auto w-full flex-wrap gap-1' : undefined} data-testid="task-filters">{FILTERS.map(([key, label, fn]) => { const n = tasks.filter(fn).length; return <TabsTrigger key={key} value={key} className={phone ? 'h-8 flex-none' : undefined}>{tr(label)}{key !== 'todas' && n ? <span className="text-muted-foreground text-xs">{n}</span> : null}</TabsTrigger>; })}</TabsList>
        </Tabs>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(400px,1.25fr)]">
          <Card className="gap-0 overflow-hidden py-0">
            {rows.length ? rows.map((t) => {
              const progress = t.status === 'running' && liveOf(live, t.id) ? <div className="mt-1.5 flex items-center gap-2"><ProgressBar percent={liveOf(live, t.id).percent} quiet={liveOf(live, t.id).quietMin >= 5} className="h-1" /><span className="text-muted-foreground shrink-0 text-micro tabular-nums">{liveOf(live, t.id).percent != null ? `${liveOf(live, t.id).percent} %` : tr('tasks.steps', { n: liveOf(live, t.id).steps })}</span></div> : null;
              return (
                <button key={t.id} onClick={() => open(t)} className={cn('flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/50', !phone && selected === t.id && 'bg-accent')} data-testid="task-row">
                  <AgentIcon agent={t.assigned_to ?? t.agent} className={phone ? 'self-start mt-0.5' : undefined} />
                  {/* The phone: the title on up to two lines, and under it the state and where (the agent is the icon). */}
                  {phone ? (
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-body leading-snug">{t.title}</div>
                      <div className="mt-1 flex min-w-0 items-center gap-2"><TaskStatus status={t.status} undone={t.undone} task={t} /><span className="text-muted-foreground truncate text-xs">{t.project} · {ago(t.updated_at)}</span></div>
                      {progress}
                    </div>
                  ) : (<>
                    <div className="min-w-0 flex-1"><div className="truncate text-body">{t.title}</div><div className="text-muted-foreground truncate text-xs">#{t.id} · {t.project} · {AGENT[t.assigned_to ?? t.agent] ?? t.agent} · {ago(t.updated_at)}</div>{progress}</div>
                    <TaskStatus status={t.status} undone={t.undone} task={t} />
                  </>)}
                </button>
              );
            }) : <Empty icon={ClipboardCheck} title={filter === 'aprobar' ? tr('tasks.empty.approve') : tr('tasks.empty.none')}>{tr('tasks.empty.hint')}</Empty>}
          </Card>
          {phone ? null : selected ? <TaskDetail id={selected} live={liveOf(live, selected)} /> : <Card><Empty icon={ClipboardCheck} title={tr('tasks.pick')}>{tr('tasks.pickHint')}</Empty></Card>}
        </div>
      </PageBody>
    </>
  );
}

// ---- The PC: the board as in the mock-up 03-tareas. The list on the left with its filters and the queue's card; the
// task's Detalle and Cambios in the right panel. The phone and a linked browser keep TasksLegacy above.

// Below 44rem of view area (measured on the view, not the window: the sidebar may be folded) the list and the detail panel
// cannot sit side by side without squeezing the list to a word per line, so the panel covers the list and closes back to it.
const NARROW_PANEL = '@max-[44rem]/tasks:absolute! @max-[44rem]/tasks:inset-0 @max-[44rem]/tasks:z-20 @max-[44rem]/tasks:w-full! @max-[44rem]/tasks:max-w-none! @max-[44rem]/tasks:border-l-0 @max-[44rem]/tasks:bg-background! @max-[44rem]/tasks:[&>.chat-panel-resize]:hidden';
const PC_FILTERS = [
  ['todas', 'tasks.filter.all', () => true],
  ['encurso', 'tasks.filter.active', (x) => x.status === 'running'],
  // also the tasks Orb held for review after they ran (a mass deletion…): they wait for the user's OK too.
  ['aprobar', 'tasks.filter.approve', needsApproval],
  ['encola', 'tasks.filter.queued', (x) => x.status === 'queued'],
  ['incidencias', 'tasks.filter.problems', (x) => ['failed', 'blocked', 'limited'].includes(x.status) && !x.held],
  ['hechas', 'tasks.filter.done', (x) => x.status === 'done']
];
const ALL = '__all';
const whoOf = (x) => x.assigned_to ?? x.agent;

function Kv({ children }) { return <dl className="kv my-4 grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-2.5 gap-y-[9px] text-control">{children}</dl>; }
function KvRow({ icon: Icon, label, children }) {
  return (<>
    <dt className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap">{Icon ? <Icon className="size-3.5" /> : null}{label}</dt>
    <dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">{children}</dd>
  </>);
}
const AgentMark = ({ agent, children }) => <span className="inline-flex items-center gap-1.5"><AgentIcon agent={agent} className="size-3.5" />{children}</span>;
const Sec = ({ children, className }) => <SectionLabel className={cn('flex items-center gap-1.5 px-0 pt-[18px] pb-1.5', className)}>{children}</SectionLabel>;

// One action at a time per list or panel: a repeated click cannot confirm twice or land on the row that moves up into the place of the last one.
function useBusy() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = (fn) => async (...args) => {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true);
    try { return await fn(...args); } finally { lock.current = false; setBusy(false); }
  };
  return [busy, run];
}

// «Más acciones»: what a task can still do besides its main buttons.
function MoreActions({ items, label }) {
  if (!items.length) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><Button variant="ghost" data-testid="task-more"><Ellipsis />{label}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {items.map((it) => (
          <div key={it.key}>
            {it.danger ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem variant={it.danger ? 'destructive' : undefined} onSelect={it.run} data-testid={it.testid}><it.icon />{it.label}</DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// «Firma»: what tasks.get says its own check found about the OK of the task (the scheduler's check, run now).
const signState = (a) => (!a.required ? 'none' : !a.signed ? 'unsigned' : a.verified === true ? 'verified' : a.verified === false ? 'invalid' : 'unknown');
function signText(tr, a) {
  const state = signState(a);
  if (state === 'verified' || state === 'invalid' || state === 'unknown') {
    const by = a.by === 'usuario' ? tr('tasks.sign.you') : a.by ?? tr('tasks.sign.you');
    return tr(`tasks.sign.${state}`, { by });
  }
  return tr(`tasks.sign.${state}`);
}

// The Detalle tab of the panel. `live`: the running task's progress; `diff`: what it changed, for the summary.
function TaskPanelDetail({ t, live, diff, onChanges }) {
  const tr = useT();
  const locale = useLocale();
  const who = whoOf(t);
  const { reassign, createPr, accept, launch, retry, undo, merge, discard, cancel } = taskActions(t, tr);
  const canUndo = t.hasCheckpoint && t.status !== 'running' && !t.held;
  const retryable = ['failed', 'blocked', 'cancelled', 'limited'].includes(t.status);
  const approval = t.status === 'awaiting_approval';
  const [busy, run] = useBusy();
  const more = [
    ...(canUndo && t.status !== 'done' ? [{ key: 'undo', icon: Undo2, label: tr('tasks.undo.btn'), run: undo, testid: 'task-undo' }] : []),
    ...(!['running', 'done'].includes(t.status) ? [{ key: 'reassign', icon: UserCog, label: tr('tasks.reassign.btn'), run: reassign, testid: 'task-reassign' }] : []),
    ...(!['done', 'cancelled', 'running'].includes(t.status) ? [{ key: 'cancel', icon: CircleX, label: tr('tasks.cancelTask'), run: run(cancel), danger: true, testid: 'task-cancel' }] : [])
  ];
  const chat = t.session_id ? <Button variant="outline" onClick={() => go({ view: 'session', id: t.session_id })} data-testid="task-agent-chat"><MessagesSquare className="size-3.5" />{tr('tasks.agentChat')}</Button> : null;
  const review = t.review;
  return (
    <div data-testid="task-detail">
      <div className="head flex items-start gap-2">
        <h2 className="prt m-0 min-w-0 flex-1 font-(family-name:--title) text-title leading-snug">{t.title}</h2>
        {t.accepted ? <Badge variant="success"><ThumbsUp />{tr('tasks.accepted')}</Badge> : null}
        <TaskStatus status={t.status} undone={Boolean(t.undone)} task={t} board />
      </div>
      <div className="by text-muted-foreground mt-1 flex items-center gap-1.5 text-control"><ProjectIcon name={t.project} small />{tr('tasks.byLine', { id: t.id, project: t.project })}</div>
      {/* the summary in prose comes first; the buttons follow it (the mock-up's order) */}
      {approval && !t.held ? <p className="text-muted-foreground m-0 mt-2.5 text-control" data-testid="task-summary">{t.sensitivity.length ? tr('tasks.summary.approvalWhy', { why: t.sensitivity.map((x) => SENSITIVE[x] ?? x).join(', ') }) : tr('tasks.summary.approval')}</p> : null}

      {t.held ? (
        <Note tone="warning" icon={ShieldAlert} className="my-2.5 [overflow-wrap:anywhere]" data-testid="task-held">{t.held.folder ? tr('tasks.held.line', { reasons: t.held.reasons, folder: t.held.folder }) : tr('tasks.held.lineNoFolder', { reasons: t.held.reasons })}</Note>
      ) : null}
      {t.status === 'queued' && t.waiting?.kind === 'paused' ? <PausedNote className="my-2.5" /> : null}
      {t.status === 'queued' && t.waiting?.kind === 'manual' ? <Note tone="warning" icon={Clock} className="my-2.5" data-testid="task-wait-manual">{tr('tasks.wait.manualNote')}</Note> : null}
      {t.status === 'queued' && t.waiting?.kind === 'deps' ? <Note tone="warning" icon={Clock} className="my-2.5" data-testid="task-wait-deps">{waitText(tr, t)}</Note> : null}
      {t.status === 'queued' && t.waiting?.kind === 'notice' && t.waiting.text ? <Note tone="warning" icon={Clock} className="my-2.5" data-testid="task-wait-notice">{t.waiting.text}</Note> : null}
      {t.status === 'running' && live ? <div className="bg-muted/50 my-2.5 rounded-card border px-3.5 py-3" data-testid="task-live"><LiveTask t={live} actions={false} /></div> : null}
      {t.undone ? <Note icon={Undo2} className="my-2.5">{tr('tasks.undoneNote', { when: fmtTime(t.undone.at) })}</Note> : null}
      {t.status === 'limited' && t.limited_until ? <Note tone="warning" icon={Hourglass} className="my-2.5">{tr('tasks.limitedNote', { when: fmtTime(t.limited_until) })}</Note> : null}

      {t.status === 'done' && (t.branch || !t.review_of) ? (
        <div className="pacts mt-3 flex flex-wrap gap-1.5">
          {!t.review_of ? <BubbleTip title={tr('tasks.review.btn')} text={tr('projects.reviewTip')}><Button variant="outline" onClick={() => askReview({ task: t })} data-testid="task-review"><ScanSearch className="size-3.5" />{tr('tasks.reviewTask')}</Button></BubbleTip> : null}
          {t.branch ? (<>
            <Button variant="outline" disabled={busy} onClick={run(merge)}><GitMerge className="size-3.5" />{tr('tasks.merge')}</Button>
            <Button variant="outline" onClick={createPr}><GitPullRequest className="size-3.5" />{tr('tasks.pr.title')}</Button>
            <Button variant="danger" disabled={busy} onClick={run(discard)}><Trash2 className="size-3.5" />{tr('tasks.discard')}</Button>
          </>) : null}
        </div>
      ) : null}

      <div className="acts-r my-2.5 flex flex-wrap items-center justify-end gap-1.5">
        {approval && !t.held ? (<>
          <MoreActions items={more} label={tr('tasks.more')} />
          {chat}
          <Button variant="outline" disabled={busy} onClick={run(() => rejectTask(t))}>{tr('tasks.reject')}</Button>
          <Button disabled={busy} onClick={run(() => approveTask(t))}>{tr('tasks.approve.ok')}</Button>
        </>) : null}
        {t.held ? (<>
          <MoreActions items={more} label={tr('tasks.more')} />
          <Button variant="outline" disabled={busy} onClick={() => undoHeld(tr, t, (fn) => run(fn)())} data-testid="task-held-undo"><Undo2 className="size-3.5" />{tr('tasks.undo.btn')}</Button>
          {chat}
          {retryable ? <Button onClick={run(retry)} data-testid="task-retry"><RotateCw className="size-3.5" />{tr('tasks.retry')}</Button> : null}
          <Button disabled={busy} onClick={run(() => acceptHeld(tr, t))} data-testid="task-held-accept">{tr('tasks.held.accept')}</Button>
        </>) : null}
        {!approval && !t.held ? (<>
          <MoreActions items={more} label={tr('tasks.more')} />
          {chat}
          {t.status === 'queued' ? <Button onClick={launch} data-testid="task-launch"><Play className="size-3.5" />{tr('tasks.launchAnyway')}</Button> : null}
          {retryable ? <Button onClick={retry} data-testid="task-retry"><RotateCw className="size-3.5" />{t.status === 'limited' ? tr('tasks.continueNow') : tr('tasks.retry')}</Button> : null}
          {t.status === 'done' && !t.accepted && !t.undone ? <Button onClick={accept} data-testid="task-accept">{tr('tasks.giveOk')}</Button> : null}
          {t.status === 'running' ? <Button variant="danger" disabled={busy} onClick={run(cancel)} data-testid="task-cancel-running"><Square className="size-3.5" />{tr('tasks.cancel')}</Button> : null}
        </>) : null}
      </div>
      {t.held ? <p className="note text-muted-foreground m-0 text-caption">{tr('tasks.held.note')}</p> : null}


      <Kv>
        <KvRow icon={Bot} label={tr('tasks.agent')}><AgentMark agent={who}>{tr('tasks.agentLine', { agent: `${t.accountLabel ?? AGENT[who] ?? who}${t.model ? ` · ${t.modelLabel ?? t.model}` : ''}`, reasoning: REASONING[t.reasoning]?.toLowerCase() ?? t.reasoning })}</AgentMark></KvRow>
        <KvRow icon={t.branch ? GitBranch : Folder} label={tr('tasks.where')}><span className="break-all">{MODE[t.mode]}{t.readonly ? ` · ${tr('tasks.readonlyShort')}` : ''}{t.branch ? <> · <code className="font-mono text-caption">{t.branch}</code></> : ''}</span></KvRow>
        <KvRow icon={Calendar} label={tr('tasks.created')}>{tr('tasks.createdBy', { time: fmtTime(t.created_at), agent: AGENT[t.created_by] ?? t.created_by })}</KvRow>
        {t.parent_id ? <KvRow icon={Link} label={tr('tasks.subOf')}><button className="text-primary-text cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: t.parent_id })}>#{t.parent_id}</button></KvRow> : null}
        {t.review_of ? <KvRow icon={ScanSearch} label={tr('tasks.reviews')}><button className="text-primary-text cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: t.review_of })}>#{t.review_of}</button></KvRow> : null}
        {t.children?.length ? <KvRow icon={GitBranch} label={tr('tasks.subtasks')}>{t.children.map((c) => <button key={c.id} onClick={() => go({ view: 'tasks', id: c.id })} className="cursor-pointer"><Badge variant={STATUS[c.status]?.[1] ?? 'secondary'} className="gap-1"><GitBranch className="size-3" />#{c.id} {AGENT[c.assigned_to ?? c.agent] ?? c.agent} · <TaskStatus task={c} plain /></Badge></button>)}</KvRow> : null}
        {t.dependencies?.length ? <KvRow icon={Link} label={tr('tasks.dependsOn')}>{t.dependencies.filter(Boolean).map((d) => <Badge key={d.id} variant="secondary">#{d.id} <TaskStatus task={d} plain /></Badge>)}</KvRow> : null}
        {t.sensitivity.length ? <KvRow icon={BadgeCheck} label={tr('tasks.approval')}>{t.sensitivity.map((s) => <Badge key={s} variant="warning">{SENSITIVE[s] ?? s}</Badge>)}</KvRow> : null}
        {t.approval ? <KvRow icon={BadgeCheck} label={tr('tasks.sign')}><span data-testid="task-sign" data-state={signState(t.approval)} className={signState(t.approval) === 'invalid' ? 'text-warning-ink' : undefined}>{signText(tr, t.approval)}</span></KvRow> : null}
        {review ? <KvRow icon={ScanSearch} label={tr('tasks.crossReview')}><AgentMark agent={review.agent}>{AGENT[review.agent] ?? review.agent}: {verdictLabel(review.verdict)}</AgentMark><Button size="xs" variant="ghost" onClick={() => go({ view: 'tasks', id: review.task })}>{tr('tasks.review.see', { id: review.task })}</Button></KvRow> : null}
      </Kv>

      <Sec>{tr('tasks.sec.brief')}</Sec>
      <pre className="plain text-control m-0 max-h-72 overflow-auto font-sans whitespace-pre-wrap">{t.description}</pre>
      {diff ? (<>
        <Sec>{tr('tasks.sec.changes')}</Sec>
        <ChangesSummary data={diff} onOpen={onChanges} />
      </>) : null}
      {t.result ? (<>
        <Sec>{tr('tasks.sec.result')}</Sec>
        <div className="rounded-card border px-3.5 py-2.5 text-control"><Markdown>{t.result}</Markdown></div>
      </>) : null}
      <Collapsible>
        <CollapsibleTrigger className="group w-full cursor-pointer text-left"><Sec><ChevronRight className="text-muted-foreground size-3.5 transition-transform group-data-[state=open]:rotate-90" />{tr('tasks.sec.history')}<span className="text-faint-foreground text-caption font-normal">{tr('tasks.sec.events', { n: t.events.length })}</span></Sec></CollapsibleTrigger>
        <CollapsibleContent><ol className="mt-1 grid gap-1.5 text-xs">{t.events.slice().reverse().map((e, i) => <li key={i} className="grid grid-cols-[110px_1fr] gap-2"><span className="text-muted-foreground">{fmtTime(e.at)}</span><span><span className="font-medium" title={e.kind}>{activityLabel(tr, e.kind)}</span> <span className="text-muted-foreground">{AGENT[e.actor] ?? e.actor}</span>{activityDetail(tr, e, locale, AGENT) ? <span className="text-muted-foreground block break-all" title={e.detail}>{activityDetail(tr, e, locale, AGENT)}</span> : null}</span></li>)}</ol></CollapsibleContent>
      </Collapsible>
      {canUndo && t.status === 'done' ? <div className="acts-r mt-2.5 flex justify-start"><Button variant="ghost" disabled={busy} onClick={() => undoTask(tr, t, (fn) => run(fn)())} data-testid="task-undo"><Undo2 className="size-3.5" />{tr('tasks.undo.btn')}</Button></div> : null}
    </div>
  );
}

// The Cambios tab of the panel: the actions that act on the work and, under them, the files it changed.
function TaskPanelChanges({ t, diff, raw }) {
  const tr = useT();
  const { createPr, undo, merge } = taskActions(t, tr);
  const [busy, run] = useBusy();
  const canUndo = t.hasCheckpoint && t.status !== 'running' && !t.held;
  // The comments written on lines wait in the tray of the task's own conversation and go with the next message there.
  const comments = useComments(t.session_id ?? '').length;
  const photoAt = t.events?.find((e) => e.kind === 'checkpoint')?.at;
  return (
    <div data-testid="task-panel-changes">
      <div className="head flex items-start gap-2">
        <h2 className="prt m-0 min-w-0 flex-1 font-(family-name:--title) text-title leading-snug">{tr('tasks.changes.of', { id: t.id })}</h2>
        <TaskStatus status={t.status} undone={Boolean(t.undone)} task={t} board />
      </div>
      <div className="by text-muted-foreground mt-1 text-control">{t.title} · {t.project}{t.branch ? <> · <code className="font-mono text-caption">{t.branch}</code></> : null}</div>
      <div className="acts-r my-2.5 flex flex-wrap items-center justify-end gap-1.5">
        {canUndo ? <Button variant="ghost" disabled={busy} onClick={() => undoTask(tr, t, (fn) => run(fn)())}><Undo2 className="size-3.5" />{tr('tasks.undo.btn')}</Button> : null}
        {t.session_id ? <Button variant="outline" onClick={() => go({ view: 'session', id: t.session_id })} data-testid="task-request-changes"><MessageSquarePlus className="size-3.5" />{comments ? tr('tasks.changes.askN', { n: comments }) : tr('tasks.changes.ask')}</Button> : null}
        {t.branch && t.status === 'done' ? (<>
          <Button variant="outline" onClick={createPr}><GitPullRequest className="size-3.5" />{tr('tasks.pr.title')}</Button>
          <Button disabled={busy} onClick={run(merge)}><GitMerge className="size-3.5" />{tr('tasks.merge')}</Button>
        </>) : null}
      </div>
      {diff ? (<>
        <ChangesMeta data={diff} reviewer={t.review ? (AGENT[t.review.agent] ?? t.review.agent) : null} photoAt={photoAt} canUndo={canUndo} className="mb-2" />
        <ChangesFiles data={diff} sessionId={t.session_id} project={t.project} taskId={t.id} workdir={t.branch && t.workdir ? t.workdir : undefined} />
      </>) : <ChangesEmpty task={t} raw={raw} canUndo={canUndo} />}
    </div>
  );
}

// What a row of the list can do at a glance. Each button is the same call as in the panel (taskActions).
// A rejected task stays 'cancelled' and a sensitive one was already signed as approved, so a retry from a list would skip the
// approval card: only plain failed, blocked or limited tasks are retried from a row.
export const canRetryFromRow = (t) => ['failed', 'blocked', 'limited'].includes(t?.status) && !t?.sensitivity?.length;

function RowActions({ t, onOpen, busy, run }) {
  const tr = useT();
  const a = taskActions(t, tr);
  if (t.undone) {
    return (
      <DropdownMenu modal={false}>
        <BubbleTip title={tr('tasks.moreRow')}><DropdownMenuTrigger asChild><MoreButton small label={tr('tasks.moreRow')} data-testid="task-row-more" /></DropdownMenuTrigger></BubbleTip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onOpen(t)}><ClipboardCheck />{tr('tasks.openTask')}</DropdownMenuItem>
          {t.session_id ? <DropdownMenuItem onSelect={() => go({ view: 'session', id: t.session_id })}><MessagesSquare />{tr('tasks.agentChat')}</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  // «Aceptar» of a held task asks first, with the reason the guard held it (acceptHeld).
  if (t.held) return (<>
    <Button size="xs" variant="outline" disabled={busy} onClick={() => undoHeld(tr, t, (fn) => run(fn)())} data-testid="task-row-undo">{tr('tasks.undo.btn')}</Button>
    <Button size="xs" disabled={busy} onClick={run(() => acceptHeld(tr, t))} data-testid="task-row-accept">{tr('tasks.held.accept')}</Button>
  </>);
  if (t.status === 'awaiting_approval') return (<>
    <Button size="xs" variant="outline" disabled={busy} onClick={run(() => rejectTask(t))} data-testid="task-row-reject">{tr('tasks.reject')}</Button>
    <Button size="xs" disabled={busy} onClick={run(() => approveTask(t))} data-testid="task-row-approve">{tr('tasks.approve.ok')}</Button>
  </>);
  if (t.status === 'running') return <BubbleTip title={tr('tasks.cancelTask')}><IconButton small label={tr('tasks.cancelTask')} disabled={busy} onClick={run(a.cancel)} data-testid="task-row-cancel"><CircleStop /></IconButton></BubbleTip>;
  if (t.status === 'queued') return <Button size="xs" variant="outline" onClick={a.launch} data-testid="task-row-launch">{tr('tasks.launchAnyway')}</Button>;
  // A rejected task or one that needs approval is retried from its panel, never from the list.
  if (canRetryFromRow(t)) return <Button size="xs" disabled={busy} onClick={run(a.retry)} data-testid="task-row-retry"><RotateCw />{t.status === 'limited' ? tr('tasks.continueNow') : tr('tasks.retry')}</Button>;
  if (t.status === 'done' && (!t.review_of || !t.accepted)) return (<>
    {!t.review_of ? <Button size="xs" variant="outline" onClick={() => askReview({ task: t })} data-testid="task-row-review">{tr('tasks.reviewTask')}</Button> : null}
    {!t.accepted ? <Button size="xs" disabled={busy} onClick={run(a.accept)} data-testid="task-row-accept-result">{tr('tasks.giveOk')}</Button> : null}
  </>);
  return null;
}

// A row of the list (.lrow): project dot, title and its line of facts, progress, state and actions.
function TaskRow({ t, live, selected, onOpen, busy, run, reviewer }) {
  const tr = useT();
  const who = whoOf(t);
  // «+120 −18»: only for work that waits for its OK or is finished, read in light mode (tasks.diff {stat}) once the row is on screen.
  const [stat, statRef] = useDiffStat(t, (t.status === 'done' || t.status === 'awaiting_approval') && !t.held && !t.undone && !t.review_of);
  const why = t.status === 'queued' && t.waiting ? { icon: Clock, text: waitText(tr, t) } : t.held ? { icon: ShieldAlert, text: tr('tasks.held.short', { reasons: t.held.reasons }) } : null;
  // The bar is the accent colour at full strength, 84 px wide, with no text: the percentage or the steps done are its tooltip.
  const quiet = live?.quietMin >= 5;
  const progress = t.status === 'running' && live ? (
    <div className="prog shrink-0" title={live.percent != null ? `${live.percent} %` : tr('tasks.progress.steps', { n: live.steps })}>
      <div className="bg-muted relative h-1.5 w-[84px] overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={live.percent ?? undefined}>
        {live.percent != null
          ? <div className={cn('h-full rounded-full transition-[width] duration-700', quiet ? 'bg-warning' : 'bg-primary-text')} style={{ width: `${Math.max(3, live.percent)}%` }} />
          : <div className={cn('absolute inset-y-0 left-0 w-1/3 rounded-full animate-[orb-indeterminate_1.6s_ease-in-out_infinite]', quiet ? 'bg-warning' : 'bg-primary-text')} />}
      </div>
    </div>
  ) : null;
  return (
    <ListRow data-testid="task-row" selected={selected} aria-current={selected ? 'true' : undefined} className="border-border cursor-pointer rounded-none border-t first:border-t-0"
      onClickCapture={(e) => { if (!e.target.closest('button, a, [role=menuitem]')) onOpen(t); }}
      leading={<ProjectIcon name={t.project} small />}
      title={<button type="button" onClick={() => onOpen(t)} className="max-w-full cursor-pointer truncate text-left font-medium outline-none focus-visible:underline" data-testid="task-open">{t.title}</button>}
      meta={(
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span>#{t.id} · {t.project}</span>
          <span className="inline-flex items-center gap-1"><AgentIcon agent={who} className="size-3.5" />{AGENT[who] ?? who} · {ago(t.updated_at)}</span>
          {reviewer ? <span>{tr('tasks.reviewedBy', { agent: AGENT[reviewer] ?? reviewer })}</span> : null}
          {t.branch ? <span className="inline-flex items-center gap-1"><GitBranch className="size-3.5" />{t.branch}</span> : null}
          <span ref={statRef} aria-hidden="true" className="-mr-2.5 size-px" />
          <DiffStat stat={stat} />
          {why ? <span className="text-warning-ink inline-flex max-w-full min-w-0 items-center gap-1"><why.icon className="size-3.5 shrink-0" /><span className="truncate">{why.text}</span></span> : null}
        </span>
      )}
      trailing={<>
        {progress}
        <TaskStatus status={t.status} undone={t.undone} task={t} board />
        <div className="acts flex shrink-0 items-center gap-1.5"><RowActions t={t} onOpen={onOpen} busy={busy} run={run} /></div>
      </>} />
  );
}

// The queue's card: running or paused, how much is going on, and the button that pauses or resumes it.
function QueueCard({ tasks }) {
  const tr = useT();
  const paused = useStore((s) => Boolean(s.app?.paused));
  const max = useStore((s) => s.app?.config?.maxParallel);
  const running = tasks.filter((x) => x.status === 'running').length;
  const queued = tasks.filter((x) => x.status === 'queued').length;
  const sub = paused ? tr('tasks.queue.subPaused') : tr(max ? 'tasks.queue.subMax' : 'tasks.queue.sub', { running, queued, max });
  return (
    <Card className="qbar @container flex-row flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5" data-testid="task-queue" data-paused={paused ? 'true' : undefined}>
      {/* a narrow card stacks: the title and its line take the width, the button goes under them */}
      <Play className="text-muted-foreground hidden size-4 shrink-0 @min-[17rem]:block" />
      <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-0.5"><b className="text-body font-medium">{paused ? tr('tasks.queue.off') : tr('tasks.queue.on')}</b><span className="text-muted-foreground text-caption">{sub}</span></div>
      <Button variant="outline" className="@max-[17rem]:w-full" onClick={() => setQueuePaused(!paused, tr)} data-testid="task-queue-toggle">{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{paused ? tr('tasks.queue.resume') : tr('tasks.queue.pause')}</Button>
    </Card>
  );
}

function TasksPc({ route }) {
  const tr = useT();
  const all = useStore((s) => s.tasks);
  const storedProjects = useStore((s) => s.projects);
  const tasks = route.project ? all.filter((x) => x.project === route.project) : all;
  const [filter, setFilter] = useState(() => (route.id ? 'todas' : tasks.some(needsApproval) ? 'aprobar' : tasks.some((x) => x.status === 'running') ? 'encurso' : tasks.some((x) => x.status === 'queued') ? 'encola' : 'todas'));
  const [project, setProject] = useState(ALL);
  const [agent, setAgent] = useState(ALL);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(route.id ?? null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState('info');
  const [busy, run] = useBusy();
  const live = useLiveTasks();
  useEffect(() => { if (route.id != null) { setSelected(route.id); setPanelOpen(true); } }, [route.id]);

  // Project, agent and search narrow the list; the tabs' numbers count what those leave.
  const q = query.trim().toLowerCase();
  const narrowed = useMemo(() => tasks.filter((x) => (project === ALL || x.project === project) && (agent === ALL || whoOf(x) === agent)
    && (!q || x.title.toLowerCase().includes(q) || `#${x.id}`.includes(q) || x.project.toLowerCase().includes(q))), [tasks, project, agent, q]);
  const rows = narrowed.filter(PC_FILTERS.find(([k]) => k === filter)[2]);
  // Who read each finished task (its Task Review is a task of its own that points back at it).
  const reviewedBy = useMemo(() => new Map(all.filter((x) => x.review_of && x.status === 'done').map((x) => [x.review_of, whoOf(x)])), [all]);
  const projects = [...new Set(tasks.map((x) => x.project))].sort();
  const agents = [...new Set(tasks.map(whoOf))].sort();
  // The first task of the list is the one open when nothing (or something no longer listed) is selected. It is worked out
  // here, not in an effect, so a row is never marked while the panel still has nothing to show for it.
  const current = rows.some((x) => x.id === selected) ? selected : panelOpen && rows.length ? rows[0].id : selected;
  const [sel, loadingSel] = useTaskDetailState(panelOpen ? current : null);
  const raw = useTaskDiffRaw(sel?.id, `${sel?.status}:${sel?.updated_at}`, Boolean(sel?.hasCheckpoint && sel.status !== 'running'));
  const diff = diffOf(raw);
  const shownTab = tab === 'changes' ? 'changes' : 'info';
  const open = (x) => { setSelected(x.id); setPanelOpen(true); setTab('info'); };
  const filtering = project !== ALL || agent !== ALL || Boolean(q);
  const tabs = [{ value: 'info', icon: Info, label: tr('tasks.panel.detail'), testid: 'task-panel-tab-detail' }, { value: 'changes', icon: FileDiff, label: tr('tasks.panel.changes'), testid: 'task-panel-tab-changes' }];

  return (
    <div className="@container/tasks relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader title={route.project ? tr('tasks.titleProject', { project: route.project }) : tr('nav.tasks')} meta={tr('tasks.sub', { total: tasks.length, shown: rows.length, waiting: tasks.filter(needsApproval).length })}>
          {route.project ? <Button size="sm" variant="ghost" onClick={() => go('tasks')}><X />{tr('tasks.allProjects')}</Button> : null}
          <BarPause />
          <NotificationBell />
          <DropdownMenu modal={false}>
            <BubbleTip title={tr('nav.more')}><DropdownMenuTrigger asChild><MoreButton label={tr('nav.more')} data-testid="tasks-more" /></DropdownMenuTrigger></BubbleTip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => refresh()}><RefreshCw />{tr('tasks.refresh')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => go('activity')}><Activity />{tr('tasks.seeActivity')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PageHeader>
        <PageBody className="md:pb-28">
          <div className="grid gap-3.5">
            <QueueCard tasks={all} />
            <div className="toolbar flex flex-wrap items-center gap-1.5">
              <Tabs value={filter} onValueChange={setFilter} className="max-w-full min-w-0 overflow-x-auto">
                <TabsList className="h-auto min-h-(--ctl) flex-wrap" data-testid="task-filters">{PC_FILTERS.map(([key, label, fn]) => { const n = narrowed.filter(fn).length; return <TabsTrigger key={key} value={key}>{tr(label)}{key !== 'todas' ? <span className="n text-micro text-faint-foreground tabular-nums">{n}</span> : null}</TabsTrigger>; })}</TabsList>
              </Tabs>
              {/* One group: it sits beside the tabs when there is room and otherwise takes the next line whole; the search is what gives way. */}
              <div className="flex min-w-0 flex-[1_1_440px] items-center justify-end gap-1.5">
              <Select value={project} onValueChange={setProject} prefix={tr('tasks.fProjectKey')} title={tr('tasks.fProject')} data-testid="task-filter-project"
                options={[{ value: ALL, label: tr('tasks.fAll') }, ...projects.map((name) => ({ value: name, label: name, icon: <ProjectIcon name={name} small /> }))]} />
              <Select value={agent} onValueChange={setAgent} prefix={tr('tasks.fAgentKey')} title={tr('tasks.fAgent')} data-testid="task-filter-agent"
                options={[{ value: ALL, label: tr('tasks.fAll') }, ...agents.map((id) => ({ value: id, label: AGENT[id] ?? id, icon: <AgentIcon agent={id} className="size-3.5" /> }))]} />
              <SearchInput className="w-auto min-w-24 flex-[0_1_220px]" value={query} onChange={setQuery} placeholder={tr('tasks.search')} data-testid="task-search" />
              <Button onClick={async () => { const made = await askNewTask(tr, storedProjects.map((p) => p.name), route.project ?? (project === ALL ? undefined : project)); if (made?.id) { setFilter('todas'); open(made); } }} data-testid="task-new"><Plus />{tr('tasks.new')}</Button>
              </div>
            </div>
            <ListCard data-testid="tasks-list">
              {rows.length ? rows.map((x) => <TaskRow key={x.id} t={x} reviewer={reviewedBy.get(x.id)} live={liveOf(live, x.id)} selected={panelOpen && current === x.id} onOpen={open} busy={busy} run={run} />)
                : filtering ? <Empty icon={ClipboardCheck} title={tr('tasks.empty.filtered')}>{tr('tasks.empty.filteredHint')}</Empty>
                  : <Empty icon={ClipboardCheck} title={filter === 'aprobar' ? tr('tasks.empty.approve') : tr('tasks.empty.none')}>{tr('tasks.empty.hint')}</Empty>}
            </ListCard>
          </div>
        </PageBody>
      </div>
      <ChatPanel open={panelOpen && current != null} tab={shownTab} onTab={setTab} onClose={() => setPanelOpen(false)} tabs={tabs} label={tr('tasks.panel.label')} closeLabel={tr('tasks.panel.close')} closeTestId="task-panel-close" className={NARROW_PANEL}>
        {!sel ? (loadingSel ? <div aria-busy="true" data-testid="task-panel-loading" /> : <Empty icon={ClipboardCheck} title={tr('tasks.pick')}>{tr('tasks.pickHint')}</Empty>)
          : shownTab === 'changes' ? <TaskPanelChanges t={sel} diff={diff} raw={raw} />
            : <TaskPanelDetail t={sel} live={liveOf(live, sel.id)} diff={diff} onChanges={() => setTab('changes')} />}
      </ChatPanel>
    </div>
  );
}

// The PC app has the mock-up's board; the phone and a computer's browser linked with an Orb keep the card layout.
export function TasksView({ route }) {
  return fullPc() ? <TasksPc route={route} /> : <TasksLegacy route={route} />;
}
