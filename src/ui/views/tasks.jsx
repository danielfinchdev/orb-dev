// Tasks: the board. Filters, approvals, details and every action on a task (undo, retry, model, merge, pull request, OK).
import { useEffect, useState } from 'react';
import { Plus, Check, X, Zap, RotateCw, Square, Shuffle, Undo2, MessageSquare, GitMerge, GitPullRequest, Trash2, ListTodo, ThumbsUp, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, Empty, Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { Tabs, TabsList, TabsTrigger, Select, Collapsible, CollapsibleTrigger, CollapsibleContent, Checkbox } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go, bridge, getState } from '@/lib/store.js';
import { AGENT, STATUS, REASONING, MODE, SENSITIVE, options } from '@/lib/labels.js';
import { ago, fmtTime, cn } from '@/lib/utils.js';

const FILTERS = [
  ['activas', 'Activas', (t) => !['done', 'cancelled'].includes(t.status)],
  ['aprobar', 'Aprobar', (t) => t.status === 'awaiting_approval'],
  ['hechas', 'Hechas', (t) => t.status === 'done'],
  ['problemas', 'Problemas', (t) => ['failed', 'blocked'].includes(t.status)],
  ['todas', 'Todas', () => true]
];
const StatusBadge = ({ status }) => <Badge variant={STATUS[status]?.[1]}>{STATUS[status]?.[0] ?? status}</Badge>;

async function newTask() {
  const { projects, app } = getState();
  if (!projects.length) { await confirm('Primero un proyecto', 'Crea un proyecto antes de crear tareas.', { cancel: null, ok: 'Ir a Proyectos' }); return go('projects'); }
  const agents = (await call('agents.status')).filter((a) => a.enabled);
  return form('Nueva tarea', {
    wide: true,
    description: 'Normalmente se las pides al asistente; aquí puedes crear una a mano.',
    initial: { project: app.activeProject?.name ?? projects[0].name, title: '', description: '', agent: 'any', mode: 'carpeta', readonly: false },
    body: (v, set) => (<>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Proyecto"><Select className="w-full" value={v.project} onValueChange={(project) => set({ project })} options={projects.map((p) => ({ value: p.name, label: p.name }))} /></Field>
        <Field label="Agente"><Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={[{ value: 'any', label: 'Cualquiera (el menos usado)' }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} /></Field>
      </div>
      <Field label="Título"><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} placeholder="Qué hay que hacer, en pocas palabras" /></Field>
      <Field label="Encargo" hint="El agente solo verá esto: qué hacer, dónde y cuándo se da por terminado."><Textarea rows={6} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 items-end gap-3">
        <Field label="Dónde trabaja"><Select className="w-full" value={v.mode} onValueChange={(mode) => set({ mode })} options={options(MODE)} /></Field>
        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm"><Checkbox checked={v.readonly} onCheckedChange={(c) => set({ readonly: c === true })} />Solo lectura (investigar o revisar)</label>
      </div>
    </>),
    ok: 'Crear tarea',
    onOk: async (v) => (await call('tasks.create', v)).id
  });
}

function TaskDetail({ id }) {
  const version = useStore((s) => s.version);
  const [t, setT] = useState(null);
  useEffect(() => { let alive = true; call('tasks.get', { id }).then((r) => alive && setT(r)).catch(() => alive && setT(null)); return () => { alive = false; }; }, [id, version]);
  if (!t) return <Card><Empty title="Elige una tarea" icon={ListTodo} /></Card>;
  const who = t.assigned_to ?? t.agent;
  const A = (props) => <Button size="sm" variant="outline" {...props} />;
  const reassign = async () => {
    const agents = (await call('agents.status')).filter((a) => a.enabled);
    await form(`Cambiar modelo de la tarea #${t.id}`, {
      initial: { agent: t.agent, model: t.model ?? '', reasoning: t.reasoning },
      body: (v, set) => (<>
        <Field label="Agente"><Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={[{ value: 'any', label: 'Cualquiera' }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} /></Field>
        <Field label="Modelo" hint="Vacío = el predeterminado del agente"><Input value={v.model} onChange={(e) => set({ model: e.target.value })} maxLength={80} /></Field>
        <Field label="Razonamiento"><Select className="w-full" value={v.reasoning} onValueChange={(reasoning) => set({ reasoning })} options={options(REASONING)} /></Field>
      </>),
      ok: 'Cambiar', onOk: (v) => call('tasks.reassign', { id: t.id, agent: v.agent, model: v.model.trim() || null, reasoning: v.reasoning })
    });
  };
  const createPr = async () => {
    const url = await form('Crear pull request', {
      wide: true, description: `Se sube la rama ${t.branch} a GitHub (git push) y se abre un pull request con tu cuenta. Esto publica el código.`,
      initial: { title: t.title, body: `${t.result ?? ''}\n\nTarea #${t.id} hecha por ${AGENT[t.assigned_to] ?? t.assigned_to}.` },
      body: (v, set) => (<><Field label="Título"><Input value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field><Field label="Descripción"><Textarea rows={6} value={v.body} onChange={(e) => set({ body: e.target.value })} /></Field></>),
      ok: 'Publicar y crear', onOk: async (v) => (await call('projects.createPr', { name: t.project, branch: t.branch, title: v.title, body: v.body })).url
    });
    if (url) confirm('Pull request creado', url, { cancel: null, ok: 'Abrir en GitHub' }).then((open) => open && bridge.openExternal(url));
  };
  return (
    <Card className="gap-5" data-testid="task-detail">
      <div className="flex items-start gap-3 px-5">
        <AgentIcon agent={who} className="mt-1 size-5" />
        <div className="min-w-0 flex-1"><div className="text-muted-foreground text-xs">Tarea #{t.id} · {t.project}</div><h2 className="text-[17px] leading-snug">{t.title}</h2></div>
        {t.accepted ? <Badge variant="success"><ThumbsUp />Aceptada</Badge> : null}<StatusBadge status={t.status} />
      </div>
      <div className="flex flex-wrap gap-2 px-5">
        {t.status === 'awaiting_approval' ? (<>
          <Button size="sm" onClick={async () => { if (await confirm(`Aprobar la tarea #${t.id}`, `${t.title}\nAgente: ${AGENT[t.agent] ?? t.agent}${t.model ? ` (${t.model})` : ''}\nCarpeta: ${t.project_path}\nMotivo: ${t.sensitivity.map((s) => SENSITIVE[s] ?? s).join(', ')}\n\nSi la tarea cambia después, volverá a pedir tu aprobación.`, { ok: 'Aprobar' })) act(call('tasks.approve', { id: t.id, decision: 'approved', hash: t.previewHash }), 'Aprobada'); }}><Check />Aprobar</Button>
          <Button size="sm" variant="outline" onClick={() => act(call('tasks.approve', { id: t.id, decision: 'rejected', hash: t.previewHash }), 'Rechazada')}><X />Rechazar</Button>
        </>) : null}
        {t.status === 'done' && !t.accepted ? <Button size="sm" onClick={() => act(call('tasks.accept', { id: t.id }), 'Aceptada')}><ThumbsUp />Dar el OK</Button> : null}
        {t.session_id ? <A onClick={() => go({ view: 'session', id: t.session_id })}><MessageSquare />Conversación del agente</A> : null}
        {t.status === 'queued' ? <A onClick={() => act(call('tasks.launchAnyway', { id: t.id }), 'Se lanzará aunque supere el cupo')}><Zap />Lanzar igualmente</A> : null}
        {['failed', 'blocked', 'cancelled'].includes(t.status) ? <A onClick={() => act(call('tasks.retry', { id: t.id }), 'En cola otra vez')}><RotateCw />Reintentar</A> : null}
        {!['running', 'done'].includes(t.status) ? <A onClick={reassign}><Shuffle />Cambiar modelo</A> : null}
        {t.hasCheckpoint && t.status !== 'running' ? <A onClick={async () => { if (await confirm('Deshacer la tarea', 'Vuelven a como estaban solo los archivos que cambió esta tarea. Los que alguien cambió después no se tocan.', { ok: 'Deshacer', danger: true })) act(call('tasks.undo', { id: t.id })); }}><Undo2 />Deshacer esta tarea</A> : null}
        {t.branch && t.status === 'done' ? (<>
          <A onClick={async () => { if (await confirm('Integrar rama', `Se une la rama ${t.branch} a la rama actual del proyecto. Si hay conflictos, no se toca nada.`, { ok: 'Integrar' })) act(call('projects.merge', { name: t.project, branch: t.branch }), 'Rama integrada'); }}><GitMerge />Integrar rama</A>
          <A onClick={createPr}><GitPullRequest />Crear pull request</A>
          <Button size="sm" variant="danger" onClick={async () => { if (await confirm('Descartar rama', `Se borran la copia aislada y la rama ${t.branch}. No se puede deshacer.`, { ok: 'Descartar', danger: true })) act(call('tasks.discardBranch', { id: t.id }), 'Rama descartada'); }}><Trash2 />Descartar rama</Button>
        </>) : null}
        {!['done', 'cancelled'].includes(t.status) ? <Button size="sm" variant="danger" onClick={async () => { if (await confirm('Cancelar tarea', t.status === 'running' ? 'El agente se detendrá ahora.' : '¿Cancelar esta tarea?', { ok: 'Cancelar tarea', cancel: 'Volver', danger: true })) act(call('tasks.cancel', { id: t.id }), 'Cancelada'); }}><Square />Cancelar</Button> : null}
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5 px-5 text-[13px]">
        <dt className="text-muted-foreground">Agente</dt><dd>{AGENT[who] ?? who}{t.model ? ` · ${t.model}` : ''} · razonamiento {REASONING[t.reasoning]?.toLowerCase() ?? t.reasoning}</dd>
        <dt className="text-muted-foreground">Dónde</dt><dd className="break-all">{MODE[t.mode]}{t.readonly ? ' · solo lectura' : ''}{t.branch ? ` · rama ${t.branch}` : ''}</dd>
        <dt className="text-muted-foreground">Creada</dt><dd>{fmtTime(t.created_at)} por {AGENT[t.created_by] ?? t.created_by}</dd>
        {t.dependencies?.length ? <><dt className="text-muted-foreground">Depende de</dt><dd className="flex flex-wrap gap-1">{t.dependencies.filter(Boolean).map((d) => <Badge key={d.id} variant="secondary">#{d.id} {STATUS[d.status]?.[0]}</Badge>)}</dd></> : null}
        {t.sensitivity.length ? <><dt className="text-muted-foreground">Aprobación</dt><dd className="flex flex-wrap gap-1">{t.sensitivity.map((s) => <Badge key={s} variant="warning">{SENSITIVE[s] ?? s}</Badge>)}</dd></> : null}
      </dl>
      <div className="grid gap-1.5 px-5"><div className="text-muted-foreground text-xs">Encargo</div><pre className="bg-muted max-h-72 overflow-auto rounded-lg px-3 py-2 font-sans text-[13px] whitespace-pre-wrap">{t.description}</pre></div>
      {t.result ? <div className="grid gap-1.5 px-5"><div className="text-muted-foreground text-xs">Resultado</div><div className="rounded-lg border px-3.5 py-2.5 text-[13.5px]"><Markdown>{t.result}</Markdown></div></div> : null}
      <Collapsible className="px-5">
        <CollapsibleTrigger className="text-muted-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />Historial ({t.events.length})</CollapsibleTrigger>
        <CollapsibleContent><ol className="mt-2 grid gap-1.5 text-xs">{t.events.slice().reverse().map((e, i) => <li key={i} className="grid grid-cols-[110px_1fr] gap-2"><span className="text-muted-foreground">{fmtTime(e.at)}</span><span><span className="font-medium">{e.kind}</span> <span className="text-muted-foreground">{AGENT[e.actor] ?? e.actor}</span>{e.detail ? <span className="text-muted-foreground block break-all">{e.detail}</span> : null}</span></li>)}</ol></CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function TasksView({ route }) {
  const tasks = useStore((s) => s.tasks);
  const [filter, setFilter] = useState(() => (route.id ? 'todas' : tasks.some((t) => t.status === 'awaiting_approval') ? 'aprobar' : 'activas'));
  const [selected, setSelected] = useState(route.id ?? null);
  const rows = tasks.filter(FILTERS.find(([k]) => k === filter)[2]);
  // The first task of the list is shown when nothing (or something no longer listed) is selected.
  useEffect(() => { if (rows.length && !rows.some((t) => t.id === selected)) setSelected(rows[0].id); }, [filter, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader icon={<ListTodo className="text-primary size-5" />} title="Tareas" meta="Lo que hacen los agentes, con aprobaciones, deshacer y tu OK">
        <Button size="sm" onClick={async () => { const id = await newTask(); if (id) { setFilter('todas'); setSelected(id); } }}><Plus />Nueva tarea</Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <Tabs value={filter} onValueChange={setFilter} className="mb-4">
          <TabsList>{FILTERS.map(([key, label, fn]) => { const n = tasks.filter(fn).length; return <TabsTrigger key={key} value={key}>{label}{key !== 'todas' && n ? <span className="text-muted-foreground text-xs">{n}</span> : null}</TabsTrigger>; })}</TabsList>
        </Tabs>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(400px,1.25fr)]">
          <Card className="gap-0 overflow-hidden py-0">
            {rows.length ? rows.map((t) => (
              <button key={t.id} onClick={() => setSelected(t.id)} className={cn('flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/50', selected === t.id && 'bg-accent')}>
                <AgentIcon agent={t.assigned_to ?? t.agent} />
                <div className="min-w-0 flex-1"><div className="truncate text-[14px]">{t.title}</div><div className="text-muted-foreground truncate text-xs">#{t.id} · {t.project} · {AGENT[t.assigned_to ?? t.agent] ?? t.agent} · {ago(t.updated_at)}</div></div>
                <StatusBadge status={t.status} />
              </button>
            )) : <Empty icon={ListTodo} title={filter === 'aprobar' ? 'Nada que aprobar' : 'Sin tareas aquí'}>Pídele algo al asistente o crea una tarea.</Empty>}
          </Card>
          {selected ? <TaskDetail id={selected} /> : <Card><Empty icon={ListTodo} title="Elige una tarea">Verás su encargo, el resultado y lo que puedes hacer con ella.</Empty></Card>}
        </div>
      </div>
    </>
  );
}
