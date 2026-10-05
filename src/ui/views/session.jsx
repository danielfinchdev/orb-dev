// A direct conversation with one agent (T3 Code style), live: the answer streams as it is written, commands and changed
// files appear as the agent works, risky actions wait for a click (approval cards), messages written meanwhile correct the
// agent on the fly or wait in a queue, and the context meter shows how full the conversation is. Task runs open here too.
import { useEffect, useMemo, useState } from 'react';
import { Paperclip, FolderOpen, Archive, Trash2, Pencil, Terminal, ChevronRight, ChevronUp, FileText, Search, Globe, Wrench, FilePlus2, FileEdit, FileMinus2, ImageIcon, X, ListTodo, CircleAlert, ShieldAlert, Check, CheckCheck, GitFork, Play, ListOrdered, ArrowUp as ArrowUpIcon, ArrowDown, CornerDownRight } from 'lucide-react';
import { toast } from 'sonner';
import { Markdown } from '@/components/markdown.jsx';
import { PageHeader } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Composer, useAutoScroll } from './chat.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Field, Input, Textarea, Empty } from '@/components/ui/basic.jsx';
import { Select, Collapsible, CollapsibleTrigger, CollapsibleContent, Tip } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go, bridge, refresh, getState } from '@/lib/store.js';
import { AGENT, PERMISSION, PERMISSION_HINT, REASONING, STATUS, DECISION, CAN_STEER as AGENT_CAN_STEER, options } from '@/lib/labels.js';
import { baseName, cn } from '@/lib/utils.js';

// "Nueva conversación": agent, project, model, permissions.
export async function newConversation(preset = {}) {
  let agents = [];
  try { agents = await call('agents.status'); } catch (error) { return toast.error(String(error.message ?? error)); }
  const usable = agents.filter((a) => a.installed && a.enabled);
  if (!usable.length) { toast.error('No hay ningún agente instalado y activado. Revisa la pantalla Agentes.'); return go('agents'); }
  const { projects, app } = getState();
  const first = usable.find((a) => a.id === preset.agent) ?? usable[0];
  const id = await form('Nueva conversación', {
    description: 'Habla directamente con un agente en la carpeta de un proyecto. Para encargos coordinados entre varios agentes, usa el chat del asistente.',
    initial: { agent: first.id, account: first.accounts.find((x) => x.enabled !== false)?.id ?? first.id, project: preset.project ?? app.activeProject?.name ?? '__none', model: first.defaultModel || '', permission: 'editar', reasoning: 'medium', title: '' },
    body: (v, set) => {
      const a = usable.find((x) => x.id === v.agent);
      return (<>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Agente"><Select className="w-full" value={v.agent} onValueChange={(agent) => { const n = usable.find((x) => x.id === agent); set({ agent, model: n.defaultModel || '', account: n.accounts.find((x) => x.enabled !== false)?.id ?? agent }); }} options={usable.map((x) => ({ value: x.id, label: x.label }))} /></Field>
          {a.accounts.length > 1 ? <Field label="Cuenta"><Select className="w-full" value={v.account} onValueChange={(account) => set({ account })} options={a.accounts.filter((x) => x.enabled !== false).map((x) => ({ value: x.id, label: x.label }))} /></Field> : null}
          <Field label="Proyecto"><Select className="w-full" value={v.project} onValueChange={(project) => set({ project })} options={[{ value: '__none', label: 'Carpeta del asistente' }, ...projects.map((p) => ({ value: p.name, label: p.name }))]} /></Field>
          <Field label="Modelo">{a.models.length ? <Select className="w-full" value={v.model || a.models[0]} onValueChange={(model) => set({ model })} options={a.models.map((m) => ({ value: m, label: m }))} />
            : <Input value={v.model} onChange={(e) => set({ model: e.target.value })} placeholder="Predeterminado del programa" />}</Field>
          <Field label="Razonamiento"><Select className="w-full" value={v.reasoning} onValueChange={(reasoning) => set({ reasoning })} options={options(REASONING)} /></Field>
        </div>
        {v.project === '__none'
          ? <p className="text-muted-foreground text-xs">Sin proyecto el agente solo puede leer (la carpeta del asistente guarda sus datos). Elige un proyecto para que pueda editar.</p>
          : <Field label="Permisos" hint={PERMISSION_HINT[v.permission]}><Select className="w-full" value={v.permission} onValueChange={(permission) => set({ permission })} options={options(PERMISSION)} /></Field>}
        <Field label="Título (opcional)"><Input value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} /></Field>
      </>);
    },
    ok: 'Empezar',
    onOk: async (v) => {
      if (v.project !== '__none' && v.permission === 'total' && !(await confirm('Acceso total', 'El agente podrá hacer cualquier cosa en tu equipo sin pedir permiso. ¿Seguro?', { ok: 'Sí, acceso total', danger: true }))) return false;
      const s = await call('sessions.create', { agent: v.agent, account: v.account, project: v.project === '__none' ? null : v.project, model: v.model || null, permission: v.project === '__none' ? 'leer' : v.permission, reasoning: v.reasoning, title: v.title.trim() || null });
      return s.id;
    }
  });
  if (id) { await refresh().catch(() => {}); go({ view: 'session', id }); }
}

// Items → blocks: a tool call and its result become one block (the latest call with that id gets the result).
function toBlocks(items) {
  const blocks = []; const tools = new Map();
  for (const it of items) {
    if (it.kind === 'tool') { const b = { type: 'tool', key: it.id, call: it.body, result: null }; if (it.body?.id) tools.set(it.body.id, b); blocks.push(b); continue; }
    if (it.kind === 'tool_result') { const b = it.body?.id ? tools.get(it.body.id) : null; if (b) b.result = it.body; else blocks.push({ type: 'tool', key: it.id, call: { name: 'Resultado' }, result: it.body }); continue; }
    if (it.kind === 'file') { const last = blocks.at(-1); if (last?.type === 'files') last.files.push(it.body); else blocks.push({ type: 'files', key: it.id, files: [it.body] }); continue; }
    blocks.push({ type: 'item', key: it.id, item: it });
  }
  return blocks;
}

// An icon that says what the tool does (reading, writing, searching, the web, a command…).
function toolIcon(name = '') {
  if (/^(Write|Edit|MultiEdit|NotebookEdit|edit|write|applyPatch)/i.test(name)) return FileEdit;
  if (/^(Read|read)/.test(name)) return FileText;
  if (/^(Glob|Grep|glob|grep|ls|LS)|Búsqueda/.test(name)) return Search;
  if (/^(WebFetch|WebSearch|orb:browser)|browser/i.test(name)) return Globe;
  if (/^(Bash|Comando|shell|run_terminal)/i.test(name)) return Terminal;
  return Wrench;
}

function ToolBlock({ b }) {
  const error = b.result?.error;
  const Icon = toolIcon(b.call?.name);
  return (
    <Collapsible className={cn('bg-card rounded-xl border text-[13px]', error && 'border-destructive/40')}>
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left">
        <ChevronRight className="text-muted-foreground size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <Icon className="text-muted-foreground size-3.5" />
        <span className="font-medium">{b.call?.name ?? 'herramienta'}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">{b.call?.input ?? ''}</span>
        {!b.result ? <span className="bg-info size-1.5 animate-pulse rounded-full" /> : error ? <CircleAlert className="text-destructive size-3.5" /> : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="bg-muted mx-3 mb-3 max-h-80 overflow-auto rounded-lg px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words">{b.result?.output || (b.result ? '(sin salida)' : 'Trabajando…')}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

const FILE_ICON = { add: FilePlus2, delete: FileMinus2 };
function Block({ b, agent, sessionId }) {
  if (b.type === 'tool') return <ToolBlock b={b} />;
  if (b.type === 'item' && b.item.kind === 'approval') return <ApprovalCard sessionId={sessionId} body={b.item.body} />;
  if (b.type === 'files') return <div className="flex flex-wrap gap-1.5">{b.files.map((f, i) => { const I = FILE_ICON[f?.change] ?? FileEdit; return <Badge key={i} variant="info" className="font-mono font-normal"><I />{f?.path}</Badge>; })}</div>;
  const it = b.item; const body = it.body;
  if (it.role === 'user') {
    const textBody = typeof body === 'string' ? body : body?.text ?? '';
    const images = typeof body === 'object' && body?.images ? body.images : [];
    const long = textBody.length > 1200 && /^Encargo de /.test(textBody);
    return (
      <div className="bg-bubble text-bubble-foreground ml-auto max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 break-words whitespace-pre-wrap">
        {typeof body === 'object' && body?.steer ? <div className="mb-1 flex items-center gap-1 text-[11px] opacity-80"><CornerDownRight className="size-3" />Corrección en marcha</div> : null}
        {long ? <Collapsible><CollapsibleTrigger className="cursor-pointer text-left underline-offset-2 hover:underline">{textBody.split('\n')[0]} (ver encargo completo)</CollapsibleTrigger><CollapsibleContent className="mt-2 text-[13px] opacity-90">{textBody}</CollapsibleContent></Collapsible> : textBody}
        {images.length ? <div className="mt-2 flex flex-wrap gap-1.5">{images.map((p) => <span key={p} className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs"><ImageIcon className="size-3" />{baseName(p)}</span>)}</div> : null}
      </div>
    );
  }
  if (it.kind === 'text' && it.role === 'assistant') return <div className="flex gap-3"><AgentIcon agent={agent} className="mt-1 size-5" /><div className="min-w-0 flex-1"><Markdown>{body}</Markdown></div></div>;
  if (it.kind === 'reasoning') return <div className="text-muted-foreground border-l-2 pl-3 text-[13px] italic whitespace-pre-wrap line-clamp-4">{body}</div>;
  if (it.kind === 'usage') {
    const parts = [body?.costUsd != null ? `$${Number(body.costUsd).toFixed(3)}` : null, body?.inputTokens != null ? `${(body.inputTokens + (body.cacheReadTokens ?? 0) + (body.cacheWriteTokens ?? 0)).toLocaleString('es-ES')} tokens de entrada${body.cacheReadTokens ? ` (${body.cacheReadTokens.toLocaleString('es-ES')} en caché)` : ''}` : null, body?.outputTokens != null ? `${body.outputTokens.toLocaleString('es-ES')} de salida` : null].filter(Boolean);
    return parts.length ? <div className="text-muted-foreground text-right text-[11px]">{parts.join(' · ')}</div> : null;
  }
  if (it.role === 'error') return <div className="bg-destructive/10 text-destructive rounded-xl px-3.5 py-2.5 text-[13px] whitespace-pre-wrap break-words">{typeof body === 'string' ? body : JSON.stringify(body)}</div>;
  return <div className="text-muted-foreground text-center text-xs">{typeof body === 'string' ? body : JSON.stringify(body)}</div>;
}

// An approval card: the agent wants to do something risky and waits for the user's click.
export function ApprovalCard({ sessionId, body, compact = false }) {
  const [busy, setBusy] = useState(false);
  const answer = async (decision) => { setBusy(true); await act(call('sessions.approve', { id: sessionId, request: body.id, decision })); setBusy(false); };
  const done = body.status && body.status !== 'pending' ? DECISION[body.status] : null;
  return (
    <div className={cn('rounded-xl border px-3.5 py-3 text-[13px]', done ? 'bg-card' : 'border-warning/50 bg-warning/10')} data-testid="approval-card">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className={cn('mt-0.5 size-4 shrink-0', done ? 'text-muted-foreground' : 'text-warning')} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{done ? 'Pidió permiso para' : 'Quiere hacer esto y espera tu permiso'}</div>
          <div className="bg-muted mt-1.5 rounded-md px-2.5 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">{body.title}</div>
          {body.reason ? <div className="text-muted-foreground mt-1.5 text-xs">Motivo: {body.reason}</div> : null}
          {done ? <Badge variant={done[1]} className="mt-2">{done[0]}</Badge> : (
            <div className={cn('mt-2.5 flex flex-wrap gap-2', compact && 'gap-1.5')}>
              <Button size="sm" disabled={busy} onClick={() => answer('allow')} data-testid="approve-allow"><Check />Permitir</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => answer('always')}><CheckCheck />Permitir siempre aquí</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => answer('deny')} data-testid="approve-deny"><X />Denegar</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// How full the agent's context window is (when the agent reports it).
export function ContextMeter({ context, className }) {
  if (!context?.size) return null;
  const pct = Math.min(100, Math.round((context.used / context.size) * 100));
  const tone = pct >= 85 ? 'bg-destructive' : pct >= 60 ? 'bg-warning' : 'bg-primary';
  return (
    <Tip label={`Contexto: ${context.used.toLocaleString('es-ES')} de ${context.size.toLocaleString('es-ES')} tokens. Cuanto más lleno, más cara cada respuesta.`}>
      <span className={cn('inline-flex items-center gap-1.5', className)} data-testid="context-meter">
        <span className="bg-muted inline-block h-1.5 w-14 overflow-hidden rounded-full"><span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} /></span>
        <span className="tabular-nums">{pct} %</span>
      </span>
    </Tip>
  );
}

export function SessionView({ route }) {
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  const app = useStore((s) => s.app);
  const [archived, setArchived] = useState(null);
  const s = sessions.find((x) => x.id === route.id) ?? archived;
  const [items, setItems] = useState([]);
  const [more, setMore] = useState(false);
  const [partial, setPartial] = useState('');
  const [queue, setQueue] = useState([]);
  const [text, setText] = useState('');
  const [images, setImages] = useState([]);
  const PAGE = 200;
  useEffect(() => {
    let alive = true;
    setItems([]); setPartial(''); setQueue([]);
    if (!sessions.some((x) => x.id === route.id)) call('sessions.list', { archived: true }).then((all) => alive && setArchived(all.find((x) => x.id === route.id) ?? null)).catch(() => {});
    call('sessions.items', { id: route.id, limit: PAGE }).then((r) => { if (alive) { setItems(r); setMore(r.length >= PAGE); } }).catch(() => {});
    call('sessions.queue', { id: route.id }).then((q) => alive && setQueue(q)).catch(() => {});
    const offItem = bridge.on('session:item', (it) => {
      if (it.session_id !== route.id) return;
      setItems((prev) => { const i = prev.findIndex((p) => p.id === it.id); if (i >= 0) { const next = prev.slice(); next[i] = it; return next; } return [...prev, it]; });
      if (it.role === 'assistant' && it.kind === 'text') setPartial('');
    });
    const offDelta = bridge.on('session:delta', (d) => { if (d.id === route.id) setPartial((p) => (p + d.text).slice(-6000)); });
    const offQueue = bridge.on('session:queue', (q) => { if (q.id === route.id) setQueue(q.queue); });
    return () => { alive = false; offItem(); offDelta(); offQueue(); };
  }, [route.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocks = useMemo(() => toBlocks(items), [items]);
  const scroll = useAutoScroll([blocks.length, items.at(-1)?.id, partial.length > 0, Math.floor(partial.length / 200)]);
  useEffect(() => { if (s && s.status !== 'running') setPartial(''); }, [s?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <Empty title="Esta conversación ya no existe" className="flex-1" />;
  const task = s.task_id ? tasks.find((t) => t.id === s.task_id) : null;
  const running = s.status === 'running';
  const models = app?.config?.agents?.[s.agent]?.models ?? [];
  const stalled = ['interrupted', 'limited'].includes(s.status) && s.kind === 'chat';

  const loadOlder = async () => {
    const first = items[0]?.id; if (!first) return;
    const older = await act(call('sessions.items', { id: s.id, before: first, limit: PAGE }));
    if (older) { setItems((prev) => [...older, ...prev]); setMore(older.length >= PAGE); }
  };
  const addImages = (paths) => setImages((prev) => [...new Set([...prev, ...(paths ?? []).filter(Boolean)])].slice(0, 10));
  const fromTransfer = (dt) => [...(dt?.files ?? [])].filter((f) => /^image\//.test(f.type)).map((f) => bridge.pathForFile(f)).filter(Boolean);
  // While the agent works, Enter corrects it on the fly (it reads the message at its next step) and Ctrl+Enter queues
  // the message for after the turn. Agents that cannot be corrected on the fly always queue.
  const send = async ({ alt = false } = {}) => {
    const t = text.trim(); if (!t && !images.length) return;
    const mode = running ? (alt ? 'queue' : 'auto') : 'auto';
    const r = await act(call('sessions.send', { id: s.id, text: t || 'Mira estas imágenes.', images, mode }));
    if (r === undefined) return;
    setText(''); setImages([]);
    if (r?.steered) toast.success('Corrección enviada: la leerá en su siguiente paso');
    else if (r?.queued) toast.success(s.kind === 'task' && !running ? 'Enviado: la tarea vuelve a la cola' : 'En cola: se enviará al terminar este turno');
  };
  const rename = () => form('Título', { initial: { title: s.title }, body: (v, set) => <Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} />, ok: 'Guardar', onOk: (v) => call('sessions.update', { id: s.id, title: v.title.trim() || s.title }) });
  const fork = async () => { const copy = await act(call('sessions.fork', { id: s.id }), 'Bifurcada: prueba otra idea sin perder la original'); if (copy) { await refresh().catch(() => {}); go({ view: 'session', id: copy.id }); } };
  const editQueued = (q, patch) => act(call('sessions.editQueued', { id: s.id, queueId: q.id, ...patch }));

  return (
    <>
      <PageHeader icon={<AgentIcon agent={s.agent} className="size-5" />} title={s.title}
        meta={<span className="inline-flex flex-wrap items-center gap-x-1.5">{AGENT[s.agent]}{s.model ? ` · ${s.model}` : ''} · {s.project ?? 'carpeta del asistente'}{bridge.mobile ? null : <> · <a className="hover:text-foreground cursor-pointer underline-offset-2 hover:underline" onClick={() => act(bridge.openPath(s.cwd))}>abrir carpeta</a></>}{s.context ? <> · <ContextMeter context={s.context} /></> : null}</span>}>
        {s.kind === 'chat' ? (<>
          {models.length ? <Select size="sm" value={s.model || models[0]} title="Modelo" options={models.map((m) => ({ value: m, label: m }))} onValueChange={(model) => act(call('sessions.update', { id: s.id, model }), `Modelo: ${model}`)} /> : null}
          <Select size="sm" value={s.permission} title={s.project ? 'Permisos' : 'Sin proyecto: solo leer'} disabled={!s.project} options={options(PERMISSION).filter((o) => !bridge.mobile || o.value !== 'total')} onValueChange={async (permission) => {
            if (permission === 'total' && !(await confirm('Acceso total', 'El agente podrá hacer cualquier cosa en tu equipo sin pedir permiso. ¿Seguro?', { ok: 'Sí', danger: true }))) return;
            act(call('sessions.update', { id: s.id, permission }), 'Permisos cambiados');
          }} />
          <Select size="sm" value={s.reasoning ?? 'medium'} title="Razonamiento" options={options(REASONING)} onValueChange={(reasoning) => act(call('sessions.update', { id: s.id, reasoning }))} />
          <Tip label="Bifurcar: una copia desde aquí para probar otra idea"><Button variant="ghost" size="icon-sm" disabled={running} onClick={fork} data-testid="fork"><GitFork /></Button></Tip>
          <Tip label="Cambiar el título"><Button variant="ghost" size="icon-sm" onClick={rename}><Pencil /></Button></Tip>
          <Tip label={s.archived ? 'Recuperar' : 'Archivar'}><Button variant="ghost" size="icon-sm" onClick={async () => { await act(call('sessions.update', { id: s.id, archived: !s.archived })); if (!s.archived) go('chat'); }}><Archive /></Button></Tip>
          <Tip label="Borrar la conversación"><Button variant="danger" size="icon-sm" onClick={async () => { if (await confirm('Borrar conversación', 'Se borra este historial. Los archivos del proyecto no se tocan.', { ok: 'Borrar', danger: true })) { await act(call('sessions.remove', { id: s.id })); go('chat'); } }}><Trash2 /></Button></Tip>
        </>) : (<>
          {task ? <Badge variant={STATUS[task.status]?.[1]}>{STATUS[task.status]?.[0]}</Badge> : null}
          <Tip label="Bifurcar: seguir en una conversación aparte desde aquí"><Button variant="ghost" size="icon-sm" disabled={running} onClick={fork}><GitFork /></Button></Tip>
          <Button variant="outline" size="sm" onClick={() => go({ view: 'tasks', id: s.task_id })}><ListTodo />Ver tarea #{s.task_id}</Button>
        </>)}
      </PageHeader>
      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3.5 px-5 py-6">
          {more ? <Button variant="ghost" size="sm" className="self-center" onClick={loadOlder}><ChevronUp />Ver mensajes anteriores</Button> : null}
          {blocks.length ? blocks.map((b) => <Block key={b.key} b={b} agent={s.agent} sessionId={s.id} />)
            : <Empty title={`Conversación con ${AGENT[s.agent]}`}>Trabaja en <span className="font-mono text-xs">{s.cwd}</span> con permiso «{PERMISSION[s.permission]}».</Empty>}
          {partial ? <div className="flex gap-3" data-testid="partial"><AgentIcon agent={s.agent} className="mt-1 size-5" /><div className="min-w-0 flex-1 opacity-90"><Markdown>{partial}</Markdown></div></div> : null}
          {running && !partial ? <div className="text-muted-foreground flex items-center gap-2 text-[13px]"><span className="bg-info size-2 animate-pulse rounded-full" />{AGENT[s.agent]} está trabajando…</div> : null}
          {stalled ? (
            <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3 text-[13px]">
              <span className="min-w-0 flex-1">{s.status === 'limited' ? 'Se paró al llegar al límite de uso de la cuenta.' : 'Se quedó a medias (la app se cerró mientras trabajaba).'}</span>
              <Button size="sm" onClick={() => act(call('sessions.resume', { id: s.id }))}><Play />Continuar</Button>
            </div>
          ) : null}
        </div>
      </div>
      {queue.length ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-5 pb-2" data-testid="queue">
          <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"><ListOrdered className="size-3.5" />En cola: se enviarán en orden cuando termine</div>
          <div className="grid gap-1.5">
            {queue.map((q, i) => (
              <div key={q.id} className="bg-card flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px]">
                <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{q.text}</span>
                <Tip label="Subir"><Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => editQueued(q, { move: 'up' })}><ArrowUpIcon /></Button></Tip>
                <Tip label="Bajar"><Button variant="ghost" size="icon-sm" disabled={i === queue.length - 1} onClick={() => editQueued(q, { move: 'down' })}><ArrowDown /></Button></Tip>
                <Tip label="Editar"><Button variant="ghost" size="icon-sm" onClick={() => form('Editar mensaje en cola', { initial: { text: q.text }, body: (v, set) => <Textarea autoFocus rows={4} value={v.text} onChange={(e) => set({ text: e.target.value })} />, ok: 'Guardar', onOk: (v) => call('sessions.editQueued', { id: s.id, queueId: q.id, text: v.text }) })}><Pencil /></Button></Tip>
                <Tip label="Quitar"><Button variant="ghost" size="icon-sm" onClick={() => editQueued(q, { remove: true })}><X /></Button></Tip>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Composer value={text} onChange={setText} onSend={send} canSend={Boolean(text.trim() || images.length)} onStop={() => act(call('sessions.stop', { id: s.id }))} busy={running} testid="session-input"
        placeholder={running ? (AGENT_CAN_STEER[s.agent] ? `Corrige a ${AGENT[s.agent]} sobre la marcha (Ctrl+Intro: ponerlo en cola)…` : `Se enviará cuando ${AGENT[s.agent]} termine este turno…`) : s.kind === 'task' ? 'Escribe al agente de esta tarea (sigue en la misma conversación)…' : `Escribe a ${AGENT[s.agent]}…`}
        onPaste={(e) => { const f = fromTransfer(e.clipboardData); if (f.length) addImages(f); }}
        onDrop={(e) => addImages(fromTransfer(e.dataTransfer))}
        top={images.length ? images.map((p) => <Badge key={p} variant="secondary" className="gap-1.5 font-normal"><ImageIcon />{baseName(p)}<button className="cursor-pointer" onClick={() => setImages(images.filter((x) => x !== p))}><X className="size-3" /></button></Badge>) : null}
        bottom={<>
          <Tip label="Adjuntar imágenes de referencia"><Button variant="ghost" size="icon-sm" onClick={async () => addImages(await bridge.pickImages())}><Paperclip /></Button></Tip>
          <span className="text-muted-foreground flex min-w-0 items-center gap-1 truncate text-xs"><FolderOpen className="size-3.5 shrink-0" />{PERMISSION[s.permission]} · {s.cwd}</span>
        </>} />
    </>
  );
}
