// Expert mode (PC only): an IDE-like view for demanding users. The assistant's chat in the middle, and around it the panels
// chosen in Settings: file explorer and viewer, git changes with their diff, commit history, what is running, account
// usage, the machine's load and live activity. Everything here only reads; the work is still done by the agents.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, File, FileLock2, Folder, FolderOpen, GitBranch, GitCommitHorizontal, RefreshCw, X, LayoutPanelLeft, Cpu, Activity, Gauge, Play, SquareTerminal, MessageSquare, FileDiff, Monitor } from 'lucide-react';
import { ChatView } from './chat.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Empty, Spinner } from '@/components/ui/basic.jsx';
import { Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, Checkbox } from '@/components/ui/overlay.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { useStore, call, act, go, bridge, setState, getState } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { cn, errorText } from '@/lib/utils.js';

export const PANELS = { explorer: 'Explorador de archivos', git: 'Cambios (git)', history: 'Historial de commits', running: 'En marcha', usage: 'Uso de las cuentas', system: 'Equipo: CPU, memoria y disco', activity: 'Actividad en directo' };
const LEFT = ['explorer', 'git', 'history']; const RIGHT = ['running', 'usage', 'system', 'activity'];

const size = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`);
const ago = (iso) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? 'ahora' : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`; };

// Files and git are read again when something changes, but at most once every 5 seconds (git on a big project is slow).
function useCalmVersion(ms = 5000) {
  const version = useStore((s) => s.version);
  const [calm, setCalm] = useState(version);
  const last = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => { last.current = Date.now(); setCalm(version); }, Math.max(0, ms - (Date.now() - last.current)));
    return () => clearTimeout(t);
  }, [version, ms]);
  return calm;
}

export async function savePanels(panels) {
  const config = await act(call('config.save', { patch: { expert: { panels } } }));
  if (config) setState({ app: { ...getState().app, config } });
}

function Panel({ title, icon: Icon, actions, className, children, testid }) {
  return (
    <section className={cn('flex min-h-0 flex-col border-b last:border-b-0', className)} data-testid={testid}>
      <header className="text-muted-foreground flex h-8 shrink-0 items-center gap-1.5 px-3 text-[11px] tracking-wide uppercase">
        {Icon ? <Icon className="size-3.5" /> : null}<span className="min-w-0 flex-1 truncate">{title}</span>{actions}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
const Mini = ({ label, onClick, children }) => <button type="button" title={label} aria-label={label} onClick={onClick} className="hover:bg-accent hover:text-foreground grid size-6 cursor-pointer place-items-center rounded-md [&_svg]:size-3.5">{children}</button>;

// ---- explorer
function Tree({ project, onOpen, version }) {
  const [dirs, setDirs] = useState({});
  const [open, setOpen] = useState(() => new Set(['']));
  const load = useCallback(async (dir) => { try { const r = await call('expert.tree', { project, dir }); setDirs((d) => ({ ...d, [dir]: r })); } catch (e) { setDirs((d) => ({ ...d, [dir]: { error: errorText(e), entries: [] } })); } }, [project]);
  useEffect(() => { setDirs({}); setOpen(new Set([''])); }, [project]);
  useEffect(() => { for (const dir of open) load(dir); }, [project, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (dir) => { const next = new Set(open); if (next.has(dir)) next.delete(dir); else { next.add(dir); if (!dirs[dir]) load(dir); } setOpen(next); };
  const render = (dir, depth) => {
    const d = dirs[dir];
    if (!d) return <div className="text-muted-foreground px-3 py-1 text-xs" style={{ paddingLeft: 12 + depth * 12 }}><Spinner className="size-3" /></div>;
    if (d.error) return <div className="text-destructive px-3 py-1 text-xs" style={{ paddingLeft: 12 + depth * 12 }}>{d.error}</div>;
    return d.entries.map((e) => (
      <div key={e.path}>
        <button type="button" onClick={() => (e.kind === 'dir' ? toggle(e.path) : e.secret ? null : onOpen(e.path))} title={e.secret ? 'Archivo con secretos: no se muestra' : `${e.path}${e.size != null ? ` · ${size(e.size)}` : ''}`}
          className={cn('hover:bg-accent/60 flex w-full cursor-pointer items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px]', e.secret && 'text-muted-foreground cursor-not-allowed')} style={{ paddingLeft: 8 + depth * 12 }}>
          {e.kind === 'dir' ? <><ChevronRight className={cn('size-3 shrink-0 transition-transform', open.has(e.path) && 'rotate-90')} />{open.has(e.path) ? <FolderOpen className="text-primary size-3.5 shrink-0" /> : <Folder className="text-primary size-3.5 shrink-0" />}</>
            : <><span className="w-3 shrink-0" />{e.secret ? <FileLock2 className="text-warning size-3.5 shrink-0" /> : <File className="text-muted-foreground size-3.5 shrink-0" />}</>}
          <span className="truncate">{e.name}</span>
        </button>
        {e.kind === 'dir' && open.has(e.path) ? render(e.path, depth + 1) : null}
      </div>
    ));
  };
  return <div className="py-1" data-testid="expert-tree">{render('', 0)}{dirs['']?.cut ? <div className="text-muted-foreground px-3 py-1 text-xs">… y más</div> : null}</div>;
}

// ---- viewers
function CodeView({ text }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  return (
    <div className="font-mono text-[12.5px] leading-[1.55]">
      {lines.map((l, i) => <div key={i} className="flex hover:bg-accent/40"><span className="text-muted-foreground/60 w-12 shrink-0 pr-3 text-right select-none">{i + 1}</span><span className="pr-4 whitespace-pre">{l || ' '}</span></div>)}
    </div>
  );
}
function DiffView({ text }) {
  if (!text) return <Empty icon={FileDiff} title="Sin cambios">Nada pendiente de commit en este proyecto.</Empty>;
  return (
    <div className="font-mono text-[12.5px] leading-[1.55]" data-testid="expert-diff">
      {text.split('\n').map((l, i) => (
        <div key={i} className={cn('px-3 whitespace-pre', l.startsWith('+') && !l.startsWith('+++') ? 'bg-success/12 text-success' : l.startsWith('-') && !l.startsWith('---') ? 'bg-destructive/10 text-destructive' : l.startsWith('@@') ? 'text-info bg-info/8' : /^(diff --git|index |new file|deleted file|--- |\+\+\+ )/.test(l) ? 'text-muted-foreground bg-muted/60' : '')}>{l || ' '}</div>
      ))}
    </div>
  );
}
function Viewer({ project, tab, version }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; setError('');
    const req = tab.kind === 'diff' ? call('expert.diff', { project, path: tab.path || undefined }) : call('expert.read', { project, path: tab.path });
    req.then((r) => alive && setData(r)).catch((e) => alive && setError(errorText(e)));
    return () => { alive = false; };
  }, [project, tab.kind, tab.path, version]);
  if (error) return <Empty icon={File} title="No se puede mostrar">{error}</Empty>;
  if (!data) return <div className="p-4"><Spinner /></div>;
  if (tab.kind === 'diff') return <><DiffView text={data.diff} />{data.cut ? <p className="text-muted-foreground p-3 text-xs">Recortado: hay más cambios.</p> : null}</>;
  if (data.binary) return <Empty icon={File} title="Archivo binario">{size(data.size)}: no se muestra como texto.</Empty>;
  return <><CodeView text={data.text} />{data.cut ? <p className="text-muted-foreground p-3 text-xs">Se muestran los primeros 512 KB de {size(data.size)}.</p> : null}</>;
}

// ---- side panels
function GitPanel({ project, version, onDiff }) {
  const [st, setSt] = useState(null);
  useEffect(() => { let alive = true; call('expert.status', { project }).then((r) => alive && setSt(r)).catch(() => alive && setSt({ repo: false, files: [] })); return () => { alive = false; }; }, [project, version]);
  if (!st) return <div className="p-3"><Spinner className="size-3" /></div>;
  if (!st.repo) return <p className="text-muted-foreground px-3 py-2 text-xs">Este proyecto no usa git.</p>;
  const tone = { nuevo: 'text-success', añadido: 'text-success', borrado: 'text-destructive', renombrado: 'text-info', cambiado: 'text-warning' };
  return (
    <div className="pb-1" data-testid="expert-git">
      <button type="button" onClick={() => onDiff('')} className="hover:bg-accent/60 flex w-full cursor-pointer items-center gap-1.5 px-3 py-1 text-left text-[12.5px]">
        <GitBranch className="text-primary size-3.5" /><span className="min-w-0 flex-1 truncate">{st.branch}</span>
        {st.ahead ? <Badge variant="secondary">↑{st.ahead}</Badge> : null}{st.behind ? <Badge variant="secondary">↓{st.behind}</Badge> : null}
        <span className="text-muted-foreground text-[11px]">{st.files.length ? `${st.files.length} cambio${st.files.length > 1 ? 's' : ''}` : 'limpio'}</span>
      </button>
      {st.files.map((f) => (
        <button key={f.path} type="button" disabled={f.secret} onClick={() => onDiff(f.path)} title={f.secret ? 'Archivo con secretos: no se muestra' : f.path} className="hover:bg-accent/60 flex w-full cursor-pointer items-center gap-2 py-[3px] pr-3 pl-7 text-left text-[12.5px] disabled:cursor-not-allowed disabled:opacity-60">
          <span className="min-w-0 flex-1 truncate">{f.path}</span><span className={cn('text-[11px]', tone[f.state])}>{f.secret ? 'secreto' : f.state}</span>
        </button>
      ))}
    </div>
  );
}
function HistoryPanel({ project, version }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { let alive = true; call('expert.log', { project, limit: 60 }).then((r) => alive && setRows(r)).catch(() => alive && setRows([])); return () => { alive = false; }; }, [project, version]);
  if (!rows) return <div className="p-3"><Spinner className="size-3" /></div>;
  if (!rows.length) return <p className="text-muted-foreground px-3 py-2 text-xs">Sin commits todavía.</p>;
  return rows.map((c) => (
    <div key={c.hash} className="flex items-start gap-2 px-3 py-1 text-[12.5px]" title={`${c.hash} · ${c.author} · ${new Date(c.date).toLocaleString('es-ES')}`}>
      <GitCommitHorizontal className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1"><div className="truncate">{c.subject}</div><div className="text-muted-foreground truncate text-[11px]"><span className="font-mono">{c.hash}</span> · {c.author} · {ago(c.date)}{c.refs ? ` · ${c.refs}` : ''}</div></div>
    </div>
  ));
}
function RunningPanel() {
  const tasks = useStore((s) => s.tasks).filter((t) => t.status === 'running');
  const sessions = useStore((s) => s.sessions).filter((s) => s.status === 'running' && s.kind === 'chat');
  const chat = useStore((s) => s.app.chat);
  const name = useStore((s) => s.app.config.assistantName);
  if (!tasks.length && !sessions.length && !chat?.busy) return <p className="text-muted-foreground px-3 py-2 text-xs">Nada en marcha ahora mismo.</p>;
  return (
    <div className="pb-1">
      {chat?.busy ? <div className="flex items-center gap-2 px-3 py-1 text-[12.5px]"><span className="bg-primary size-1.5 animate-pulse rounded-full" />{name} {chat.partial ? 'escribiendo' : 'pensando'}{chat.tools?.length ? <span className="text-muted-foreground truncate">· {chat.tools.slice(-1)[0]}</span> : null}</div> : null}
      {tasks.map((t) => <button key={t.id} type="button" onClick={() => go({ view: 'tasks', id: t.id })} className="hover:bg-accent/60 flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-[12.5px]"><AgentIcon agent={t.assigned_to ?? t.agent} className="size-3.5" /><span className="min-w-0 flex-1 truncate">#{t.id} {t.title}</span><span className="text-muted-foreground text-[11px]">{t.project}</span></button>)}
      {sessions.map((s) => <button key={s.id} type="button" onClick={() => go({ view: 'session', id: s.id })} className="hover:bg-accent/60 flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-[12.5px]"><AgentIcon agent={s.agent} className="size-3.5" /><span className="min-w-0 flex-1 truncate">{s.title}</span><span className="text-muted-foreground text-[11px]">{AGENT[s.agent]}</span></button>)}
    </div>
  );
}
function Bar({ label, value, max, detail }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="grid gap-1 px-3 py-1">
      <div className="flex items-center justify-between text-[12px]"><span>{label}</span><span className="text-muted-foreground">{detail ?? `${pct}%`}</span></div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className={cn('h-full rounded-full transition-all', pct > 85 ? 'bg-destructive' : pct > 65 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
function UsagePanel({ version }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { call('usage.get').then(setRows).catch(() => {}); }, [version]);
  return <div className="py-1">{rows.map((r) => <Bar key={r.account} label={r.label} value={r.used} max={r.max} detail={r.cooldownUntil && r.cooldownUntil > Date.now() ? 'en pausa por límite' : `${r.used}/${r.max} en ${r.windowHours} h`} />)}</div>;
}
function SystemPanel() {
  const [s, setS] = useState(null);
  useEffect(() => { let alive = true; const tick = () => call('expert.system').then((r) => alive && setS(r)).catch(() => {}); tick(); const t = setInterval(tick, 3000); return () => { alive = false; clearInterval(t); }; }, []);
  if (!s) return <div className="p-3"><Spinner className="size-3" /></div>;
  return (
    <div className="py-1" data-testid="expert-system">
      <Bar label={`CPU · ${s.cores} núcleos`} value={s.cpu ?? 0} max={100} detail={s.cpu == null ? 'midiendo…' : `${s.cpu}%`} />
      <Bar label="Memoria" value={s.memory.total - s.memory.free} max={s.memory.total} detail={`${size(s.memory.total - s.memory.free)} de ${size(s.memory.total)}`} />
      {s.disk ? <Bar label="Disco de la carpeta" value={s.disk.total - s.disk.free} max={s.disk.total} detail={`${size(s.disk.free)} libres`} /> : null}
      <div className="text-muted-foreground flex flex-wrap gap-x-3 px-3 pt-1 pb-1.5 text-[11px]"><span>Motor: {size(s.engine)}</span><span>Agentes trabajando: {s.running}</span><span className="truncate">{s.platform}</span></div>
    </div>
  );
}
function ActivityPanel({ version }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { call('activity.list', { limit: 40 }).then(setRows).catch(() => {}); }, [version]);
  return (
    <div className="py-1 font-mono text-[11.5px]">
      {rows.map((r) => <div key={r.id} className="flex gap-2 px-3 py-[2px]" title={r.detail}><span className="text-muted-foreground shrink-0">{new Date(r.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span><span className="text-primary shrink-0">{r.actor}</span><span className="min-w-0 truncate">{r.kind}{r.task_id ? ` #${r.task_id}` : ''} {r.detail}</span></div>)}
    </div>
  );
}

export function PanelsMenu() {
  const panels = useStore((s) => s.app.config.expert?.panels) ?? {};
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="sm" data-testid="expert-panels"><LayoutPanelLeft />Paneles</Button></DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>Qué paneles ver</DropdownMenuLabel>
        {Object.entries(PANELS).map(([id, label]) => (
          <DropdownMenuItem key={id} onSelect={(e) => { e.preventDefault(); savePanels({ ...panels, [id]: panels[id] === false }); }}>
            <Checkbox checked={panels[id] !== false} className="pointer-events-none" />{label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ExpertView() {
  const app = useStore((s) => s.app);
  const projects = useStore((s) => s.projects);
  const [manual, setManual] = useState(0); // the refresh button reads everything again right away
  const version = `${useCalmVersion()}-${manual}`;
  const panels = app.config.expert?.panels ?? {};
  const on = (id) => panels[id] !== false;
  const [project, setProject] = useState(app.activeProject?.name ?? projects[0]?.name ?? '');
  const [tabs, setTabs] = useState([]);
  const [current, setCurrent] = useState('chat');
  useEffect(() => { if (!project && projects[0]) setProject(app.activeProject?.name ?? projects[0].name); }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTabs([]); setCurrent('chat'); }, [project]);
  const openTab = (kind, path) => {
    const id = `${kind}:${path}`;
    if (!tabs.some((t) => t.id === id)) setTabs([...tabs, { id, kind, path, label: kind === 'diff' ? (path ? `Δ ${path.split('/').pop()}` : 'Todos los cambios') : path.split('/').pop() }].slice(-12));
    setCurrent(id);
  };
  const closeTab = (id) => { const rest = tabs.filter((t) => t.id !== id); setTabs(rest); if (current === id) setCurrent(rest.at(-1)?.id ?? 'chat'); };
  if (bridge.mobile) return <Empty icon={Monitor} title="Solo en el PC" className="m-auto">El modo experto necesita una pantalla grande: ábrelo en la app del ordenador.</Empty>;
  const left = LEFT.filter(on); const right = RIGHT.filter(on);
  const tab = tabs.find((t) => t.id === current);
  return (
    <>
      <div className="m-auto max-w-sm p-6 lg:hidden"><Empty icon={Monitor} title="Ventana demasiado estrecha">El modo experto necesita al menos 1024 px de ancho: agranda la ventana.</Empty></div>
      <div className="hidden min-h-0 flex-1 flex-col lg:flex" data-testid="expert-view">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SquareTerminal className="text-primary size-4" /><span className="text-[15px]">Modo experto</span>
          <Select size="sm" value={project} onValueChange={setProject} title="Proyecto" className="ml-2 w-56" placeholder="Elige un proyecto" options={projects.map((p) => ({ value: p.name, label: p.name }))} />
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => go('settings')}>Ajustes</Button>
          <PanelsMenu />
        </header>
        <div className="flex min-h-0 flex-1">
          {left.length && project ? (
            <aside className="bg-sidebar flex w-72 shrink-0 flex-col border-r">
              {on('explorer') ? <Panel title={project} icon={Folder} className="flex-[3]" testid="panel-explorer" actions={<Mini label="Recargar" onClick={() => setManual((n) => n + 1)}><RefreshCw /></Mini>}><Tree project={project} version={version} onOpen={(p) => openTab('file', p)} /></Panel> : null}
              {on('git') ? <Panel title="Cambios" icon={GitBranch} className="flex-[2]" testid="panel-git"><GitPanel project={project} version={version} onDiff={(p) => openTab('diff', p)} /></Panel> : null}
              {on('history') ? <Panel title="Historial" icon={GitCommitHorizontal} className="flex-[2]" testid="panel-history"><HistoryPanel project={project} version={version} /></Panel> : null}
            </aside>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="bg-sidebar flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b px-1">
              {[{ id: 'chat', label: app.config.assistantName, icon: MessageSquare }, ...tabs].map((t) => (
                <div key={t.id} className={cn('group flex h-8 max-w-52 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-[12.5px]', current === t.id ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent')} onClick={() => setCurrent(t.id)} title={t.path}>
                  {t.icon ? <t.icon className="size-3.5" /> : t.kind === 'diff' ? <FileDiff className="size-3.5" /> : <File className="size-3.5" />}
                  <span className="truncate">{t.label}</span>
                  {t.id !== 'chat' ? <button type="button" aria-label="Cerrar" className="hover:bg-accent -mr-1 grid size-4 place-items-center rounded opacity-60 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><X className="size-3" /></button> : null}
                </div>
              ))}
            </div>
            {/* The chat stays mounted so switching tabs never loses what is being written. */}
            <div className={cn('min-h-0 flex-1 flex-col', current === 'chat' ? 'flex' : 'hidden')}><ChatView /></div>
            {tab ? <div className="min-h-0 flex-1 overflow-auto py-2" data-testid="expert-viewer"><Viewer project={project} tab={tab} version={version} /></div> : null}
          </div>
          {right.length ? (
            <aside className="bg-sidebar flex w-80 shrink-0 flex-col overflow-y-auto border-l">
              {on('running') ? <Panel title="En marcha" icon={Play} className="max-h-64 shrink-0" testid="panel-running"><RunningPanel /></Panel> : null}
              {on('usage') ? <Panel title="Uso de las cuentas" icon={Gauge} className="max-h-72 shrink-0" testid="panel-usage"><UsagePanel version={version} /></Panel> : null}
              {on('system') ? <Panel title="Equipo" icon={Cpu} className="shrink-0" testid="panel-system"><SystemPanel /></Panel> : null}
              {on('activity') ? <Panel title="Actividad" icon={Activity} className="min-h-48 flex-1" testid="panel-activity"><ActivityPanel version={version} /></Panel> : null}
            </aside>
          ) : null}
        </div>
      </div>
    </>
  );
}
