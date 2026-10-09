// Tasks: the board. Filters, approvals, details and every action on a task (undo, retry, model, merge, pull request, OK).
import { useEffect, useState } from 'react';
import { Plus, Check, X, Zap, RotateCw, Square, Shuffle, Undo2, MessageSquare, GitMerge, GitPullRequest, Trash2, ListTodo, ThumbsUp, ChevronRight, ScanSearch, Hourglass, GitBranch } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { useLiveTasks, liveOf, LiveTask, ProgressBar } from '@/components/live-tasks.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, Empty, Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { Tabs, TabsList, TabsTrigger, Select, Collapsible, CollapsibleTrigger, CollapsibleContent, Checkbox } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go, bridge, getState } from '@/lib/store.js';
import { AGENT, STATUS, REASONING, MODE, SENSITIVE, options } from '@/lib/labels.js';
import { ago, fmtTime, cn } from '@/lib/utils.js';
import { t, useT } from '@/lib/i18n.js';

const FILTERS = [
  ['encurso', 'tasks.filter.active', (x) => x.status === 'running'], // only what is working right now
  ['aprobar', 'tasks.filter.approve', (x) => x.status === 'awaiting_approval'],
  ['hechas', 'tasks.filter.done', (x) => x.status === 'done'],
  ['incidencias', 'tasks.filter.problems', (x) => ['failed', 'blocked', 'limited'].includes(x.status)],
  ['todas', 'tasks.filter.all', () => true]
];
const verdictLabel = (v) => (['correcto', 'con fallos'].includes(v) ? t(`tasks.verdict.${v}`) : v);
const StatusBadge = ({ status }) => <Badge variant={STATUS[status]?.[1]}>{STATUS[status]?.[0] ?? status}</Badge>;

// Task Review: another model (another provider when there is one) audits the work read-only and gives a verdict.
export async function askReview({ task, project }) {
  const agents = (await call('agents.status')).filter((a) => a.enabled && a.installed);
  return form(task ? t('tasks.review.titleTask', { id: task.id }) : t('tasks.review.titleProject', { project }), {
    description: t('tasks.review.desc'),
    initial: { agent: '', focus: '' },
    body: (v, set) => (<>
      <Field label={t('tasks.review.reviewer')} hint={t('tasks.review.reviewerHint')}><Select className="w-full" value={v.agent || '__auto'} onValueChange={(agent) => set({ agent: agent === '__auto' ? '' : agent })} options={[{ value: '__auto', label: t('tasks.review.auto') }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} /></Field>
      <Field label={t('tasks.review.focus')}><Textarea rows={3} value={v.focus} onChange={(e) => set({ focus: e.target.value })} placeholder={t('tasks.review.focusPh')} /></Field>
    </>),
    ok: t('tasks.review.ok'),
    onOk: async (v) => (task ? call('tasks.review', { id: task.id, agent: v.agent || null, focus: v.focus }) : call('projects.review', { name: project, agent: v.agent || null, focus: v.focus }))
  });
}

async function newTask() {
  const { projects, app } = getState();
  if (!projects.length) { await confirm(t('tasks.new.projectFirst'), t('tasks.new.projectFirstMsg'), { cancel: null, ok: t('tasks.new.goProjects') }); return go('projects'); }
  const agents = (await call('agents.status')).filter((a) => a.enabled);
  return form(t('tasks.new'), {
    wide: true,
    description: t('tasks.new.desc'),
    initial: { project: app.activeProject?.name ?? projects[0].name, title: '', description: '', agent: 'any', mode: 'carpeta', readonly: false },
    body: (v, set) => (<>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('tasks.project')}><Select className="w-full" value={v.project} onValueChange={(project) => set({ project })} options={projects.map((p) => ({ value: p.name, label: p.name }))} /></Field>
        <Field label={t('tasks.agent')}><Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={[{ value: 'any', label: t('tasks.new.anyLeast') }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} /></Field>
      </div>
      <Field label={t('tasks.titleField')}><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} placeholder={t('tasks.new.titlePh')} /></Field>
      <Field label={t('tasks.brief')} hint={t('tasks.new.briefHint')}><Textarea rows={6} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 items-end gap-3">
        <Field label={t('tasks.new.where')}><Select className="w-full" value={v.mode} onValueChange={(mode) => set({ mode })} options={options(MODE)} /></Field>
        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm"><Checkbox checked={v.readonly} onCheckedChange={(c) => set({ readonly: c === true })} />{t('tasks.new.readonly')}</label>
      </div>
    </>),
    ok: t('tasks.new.create'),
    onOk: async (v) => (await call('tasks.create', v)).id
  });
}

function TaskDetail({ id, live }) {
  const tr = useT();
  const version = useStore((s) => s.version);
  const [t, setT] = useState(null);
  useEffect(() => { let alive = true; call('tasks.get', { id }).then((r) => alive && setT(r)).catch(() => alive && setT(null)); return () => { alive = false; }; }, [id, version]);
  if (!t) return <Card><Empty title={tr('tasks.pick')} icon={ListTodo} /></Card>;
  const who = t.assigned_to ?? t.agent;
  const A = (props) => <Button size="sm" variant="outline" {...props} />;
  const reassign = async () => {
    const agents = (await call('agents.status')).filter((a) => a.enabled);
    await form(tr('tasks.reassign.title', { id: t.id }), {
      initial: { agent: t.agent, model: t.model ?? '', reasoning: t.reasoning },
      body: (v, set) => (<>
        <Field label={tr('tasks.agent')}><Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={[{ value: 'any', label: tr('tasks.reassign.any') }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} /></Field>
        <Field label={tr('tasks.reassign.model')} hint={tr('tasks.reassign.modelHint')}><Input value={v.model} onChange={(e) => set({ model: e.target.value })} maxLength={80} /></Field>
        <Field label={tr('tasks.reassign.reasoning')}><Select className="w-full" value={v.reasoning} onValueChange={(reasoning) => set({ reasoning })} options={options(REASONING)} /></Field>
      </>),
      ok: tr('tasks.reassign.ok'), onOk: (v) => call('tasks.reassign', { id: t.id, agent: v.agent, model: v.model.trim() || null, reasoning: v.reasoning })
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
  return (
    <Card className="gap-5" data-testid="task-detail">
      <div className="flex items-start gap-3 px-5">
        <AgentIcon agent={who} className="mt-1 size-5" />
        <div className="min-w-0 flex-1"><div className="text-muted-foreground text-xs">{tr('tasks.taskNo', { id: t.id, project: t.project })}</div><h2 className="text-[17px] leading-snug">{t.title}</h2></div>
        {t.accepted ? <Badge variant="success"><ThumbsUp />{tr('tasks.accepted')}</Badge> : null}<StatusBadge status={t.status} />
      </div>
      <div className="flex flex-wrap gap-2 px-5">
        {t.status === 'awaiting_approval' ? (<>
          <Button size="sm" onClick={async () => { if (await confirm(tr('tasks.approve.title', { id: t.id }), tr('tasks.approve.body', { title: t.title, agent: `${AGENT[t.agent] ?? t.agent}${t.model ? ` (${t.model})` : ''}`, path: t.project_path, reason: t.sensitivity.map((s) => SENSITIVE[s] ?? s).join(', ') }), { ok: tr('tasks.approve.ok') })) act(call('tasks.approve', { id: t.id, decision: 'approved', hash: t.previewHash }), tr('tasks.approve.done')); }}><Check />{tr('tasks.approve.ok')}</Button>
          <Button size="sm" variant="outline" onClick={() => act(call('tasks.approve', { id: t.id, decision: 'rejected', hash: t.previewHash }), tr('tasks.reject.done'))}><X />{tr('tasks.reject')}</Button>
        </>) : null}
        {t.status === 'done' && !t.accepted ? <Button size="sm" onClick={() => act(call('tasks.accept', { id: t.id }), tr('tasks.accepted'))}><ThumbsUp />{tr('tasks.giveOk')}</Button> : null}
        {t.status === 'done' && !t.review_of ? <A onClick={() => askReview({ task: t })} data-testid="task-review"><ScanSearch />{tr('tasks.review.btn')}</A> : null}
        {t.session_id ? <A onClick={() => go({ view: 'session', id: t.session_id })}><MessageSquare />{tr('tasks.agentChat')}</A> : null}
        {t.status === 'queued' ? <A onClick={() => act(call('tasks.launchAnyway', { id: t.id }), tr('tasks.launchAnyway.done'))}><Zap />{tr('tasks.launchAnyway')}</A> : null}
        {['failed', 'blocked', 'cancelled', 'limited'].includes(t.status) ? <A onClick={() => act(call('tasks.retry', { id: t.id }), tr('tasks.retry.done'))}><RotateCw />{t.status === 'limited' ? tr('tasks.continueNow') : tr('tasks.retry')}</A> : null}
        {!['running', 'done'].includes(t.status) ? <A onClick={reassign}><Shuffle />{tr('tasks.reassign.btn')}</A> : null}
        {t.hasCheckpoint && t.status !== 'running' ? <A onClick={async () => { if (await confirm(tr('tasks.undo.title'), tr('tasks.undo.body'), { ok: tr('tasks.undo.ok'), danger: true })) act(call('tasks.undo', { id: t.id })); }}><Undo2 />{tr('tasks.undo.btn')}</A> : null}
        {t.branch && t.status === 'done' ? (<>
          <A onClick={async () => { if (await confirm(tr('tasks.merge'), tr('tasks.merge.body', { branch: t.branch }), { ok: tr('tasks.merge.ok') })) act(call('projects.merge', { name: t.project, branch: t.branch }), tr('tasks.merge.done')); }}><GitMerge />{tr('tasks.merge')}</A>
          <A onClick={createPr}><GitPullRequest />{tr('tasks.pr.title')}</A>
          <Button size="sm" variant="danger" onClick={async () => { if (await confirm(tr('tasks.discard'), tr('tasks.discard.body', { branch: t.branch }), { ok: tr('tasks.discard.ok'), danger: true })) act(call('tasks.discardBranch', { id: t.id }), tr('tasks.discard.done')); }}><Trash2 />{tr('tasks.discard')}</Button>
        </>) : null}
        {!['done', 'cancelled'].includes(t.status) ? <Button size="sm" variant="danger" onClick={async () => { if (await confirm(tr('tasks.cancel.title'), t.status === 'running' ? tr('tasks.cancel.running') : tr('tasks.cancel.ask'), { ok: tr('tasks.cancel.title'), cancel: tr('tasks.cancel.back'), danger: true })) act(call('tasks.cancel', { id: t.id }), tr('tasks.cancel.done')); }}><Square />{tr('tasks.cancel')}</Button> : null}
      </div>
      {t.status === 'running' && live ? <div className="bg-muted/50 mx-5 rounded-xl border px-3.5 py-3" data-testid="task-live"><LiveTask t={live} actions={false} /></div> : null}
      {t.status === 'limited' && t.limited_until ? <div className="bg-warning/10 border-warning/40 mx-5 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px]"><Hourglass className="text-warning size-4" />{tr('tasks.limitedNote', { when: fmtTime(t.limited_until) })}</div> : null}
      {t.review ? <div className={cn('mx-5 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px]', t.review.verdict === 'correcto' ? 'border-success/40 bg-success/10' : t.review.verdict === 'con fallos' ? 'border-destructive/40 bg-destructive/10' : 'bg-muted/50')}><ScanSearch className="size-4" />{tr('tasks.review.line', { agent: AGENT[t.review.agent] ?? t.review.agent })} <span className="font-medium">{verdictLabel(t.review.verdict)}</span><Button size="sm" variant="ghost" className="ml-auto" onClick={() => go({ view: 'tasks', id: t.review.task })}>{tr('tasks.review.see', { id: t.review.task })}</Button></div> : null}
      <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5 px-5 text-[13px]">
        <dt className="text-muted-foreground">{tr('tasks.agent')}</dt><dd>{tr('tasks.agentLine', { agent: `${AGENT[who] ?? who}${t.model ? ` · ${t.model}` : ''}`, reasoning: REASONING[t.reasoning]?.toLowerCase() ?? t.reasoning })}</dd>
        <dt className="text-muted-foreground">{tr('tasks.where')}</dt><dd className="break-all">{MODE[t.mode]}{t.readonly ? ` · ${tr('tasks.readonlyShort')}` : ''}{t.branch ? ` · ${tr('tasks.branchShort', { branch: t.branch })}` : ''}</dd>
        <dt className="text-muted-foreground">{tr('tasks.created')}</dt><dd>{tr('tasks.createdBy', { time: fmtTime(t.created_at), agent: AGENT[t.created_by] ?? t.created_by })}</dd>
        {t.parent_id ? <><dt className="text-muted-foreground">{tr('tasks.subOf')}</dt><dd><button className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: t.parent_id })}>#{t.parent_id}</button></dd></> : null}
        {t.review_of ? <><dt className="text-muted-foreground">{tr('tasks.reviews')}</dt><dd><button className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: t.review_of })}>#{t.review_of}</button></dd></> : null}
        {t.children?.length ? <><dt className="text-muted-foreground">{tr('tasks.subtasks')}</dt><dd className="flex flex-wrap gap-1">{t.children.map((c) => <button key={c.id} onClick={() => go({ view: 'tasks', id: c.id })} className="cursor-pointer"><Badge variant={STATUS[c.status]?.[1] ?? 'secondary'} className="gap-1"><GitBranch className="size-3" />#{c.id} {AGENT[c.assigned_to ?? c.agent] ?? c.agent} · {STATUS[c.status]?.[0] ?? c.status}</Badge></button>)}</dd></> : null}
        {t.dependencies?.length ? <><dt className="text-muted-foreground">{tr('tasks.dependsOn')}</dt><dd className="flex flex-wrap gap-1">{t.dependencies.filter(Boolean).map((d) => <Badge key={d.id} variant="secondary">#{d.id} {STATUS[d.status]?.[0]}</Badge>)}</dd></> : null}
        {t.sensitivity.length ? <><dt className="text-muted-foreground">{tr('tasks.approval')}</dt><dd className="flex flex-wrap gap-1">{t.sensitivity.map((s) => <Badge key={s} variant="warning">{SENSITIVE[s] ?? s}</Badge>)}</dd></> : null}
      </dl>
      <div className="grid gap-1.5 px-5"><div className="text-muted-foreground text-xs">{tr('tasks.brief')}</div><pre className="bg-muted max-h-72 overflow-auto rounded-lg px-3 py-2 font-sans text-[13px] whitespace-pre-wrap">{t.description}</pre></div>
      {t.result ? <div className="grid gap-1.5 px-5"><div className="text-muted-foreground text-xs">{tr('tasks.result')}</div><div className="rounded-lg border px-3.5 py-2.5 text-[13.5px]"><Markdown>{t.result}</Markdown></div></div> : null}
      <Collapsible className="px-5">
        <CollapsibleTrigger className="text-muted-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />{tr('tasks.history', { n: t.events.length })}</CollapsibleTrigger>
        <CollapsibleContent><ol className="mt-2 grid gap-1.5 text-xs">{t.events.slice().reverse().map((e, i) => <li key={i} className="grid grid-cols-[110px_1fr] gap-2"><span className="text-muted-foreground">{fmtTime(e.at)}</span><span><span className="font-medium">{e.kind}</span> <span className="text-muted-foreground">{AGENT[e.actor] ?? e.actor}</span>{e.detail ? <span className="text-muted-foreground block break-all">{e.detail}</span> : null}</span></li>)}</ol></CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function TasksView({ route }) {
  const tr = useT();
  const all = useStore((s) => s.tasks);
  // From a folder of the left menu: only that project's tasks (with a button to see them all).
  const tasks = route.project ? all.filter((t) => t.project === route.project) : all;
  const [filter, setFilter] = useState(() => (route.id ? 'todas' : tasks.some((x) => x.status === 'awaiting_approval') ? 'aprobar' : tasks.some((x) => x.status === 'running') ? 'encurso' : 'todas'));
  const [selected, setSelected] = useState(route.id ?? null);
  const rows = tasks.filter(FILTERS.find(([k]) => k === filter)[2]);
  const live = useLiveTasks();
  // The first task of the list is shown when nothing (or something no longer listed) is selected.
  useEffect(() => { if (rows.length && !rows.some((t) => t.id === selected)) setSelected(rows[0].id); }, [filter, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader icon={<ListTodo className="text-primary size-5" />} title={route.project ? tr('tasks.titleProject', { project: route.project }) : tr('nav.tasks')} meta={tr('tasks.meta')}>
        {route.project ? <Button size="sm" variant="ghost" onClick={() => go('tasks')}><X />{tr('tasks.allProjects')}</Button> : null}
        <Button size="sm" onClick={async () => { const id = await newTask(); if (id) { setFilter('todas'); setSelected(id); } }}><Plus />{tr('tasks.new')}</Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:pb-28">
        <Tabs value={filter} onValueChange={setFilter} className="mb-4">
          <TabsList>{FILTERS.map(([key, label, fn]) => { const n = tasks.filter(fn).length; return <TabsTrigger key={key} value={key}>{tr(label)}{key !== 'todas' && n ? <span className="text-muted-foreground text-xs">{n}</span> : null}</TabsTrigger>; })}</TabsList>
        </Tabs>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(400px,1.25fr)]">
          <Card className="gap-0 overflow-hidden py-0">
            {rows.length ? rows.map((t) => (
              <button key={t.id} onClick={() => setSelected(t.id)} className={cn('flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/50', selected === t.id && 'bg-accent')}>
                <AgentIcon agent={t.assigned_to ?? t.agent} />
                <div className="min-w-0 flex-1"><div className="truncate text-[14px]">{t.title}</div><div className="text-muted-foreground truncate text-xs">#{t.id} · {t.project} · {AGENT[t.assigned_to ?? t.agent] ?? t.agent} · {ago(t.updated_at)}</div>
                  {t.status === 'running' && liveOf(live, t.id) ? <div className="mt-1.5 flex items-center gap-2"><ProgressBar percent={liveOf(live, t.id).percent} quiet={liveOf(live, t.id).quietMin >= 5} className="h-1" /><span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">{liveOf(live, t.id).percent != null ? `${liveOf(live, t.id).percent} %` : tr('tasks.steps', { n: liveOf(live, t.id).steps })}</span></div> : null}</div>
                <StatusBadge status={t.status} />
              </button>
            )) : <Empty icon={ListTodo} title={filter === 'aprobar' ? tr('tasks.empty.approve') : tr('tasks.empty.none')}>{tr('tasks.empty.hint')}</Empty>}
          </Card>
          {selected ? <TaskDetail id={selected} live={liveOf(live, selected)} /> : <Card><Empty icon={ListTodo} title={tr('tasks.pick')}>{tr('tasks.pickHint')}</Empty></Card>}
        </div>
      </div>
    </>
  );
}
