import { useEffect, useMemo, useState } from 'react';
import { Smartphone, MessageSquarePlus, ListTodo, FolderKanban, Bot, BookOpen, History, Settings, SquareTerminal, ChevronRight, FolderPlus, ShieldAlert, CalendarClock, CircleCheck, Undo2, GraduationCap, PenTool, HeartPulse, Layers, Search, SlidersHorizontal, X, Sparkles, GitBranch, ListChecks, Clock, MessageCircleQuestion, CirclePause, Folder } from 'lucide-react';
import { Robot } from './robot.jsx';
import { ThemeToggle, SidebarToggle } from './theme-toggle.jsx';
import { Button } from './ui/button.jsx';
import { useStore, go, bridge, call, act, openSettings, fullPc, newChat } from '@/lib/store.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, Tip, BubbleTip, RichTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuCheckboxItem, DropdownMenuSeparator } from './ui/overlay.jsx';
import { createProjectFlow } from './project-actions.jsx';
import { ProjectIcon } from './project-icon.jsx';
import { useCatalog, modelsOf } from './brain-picker.jsx';
import { STATUS, AGENT } from '@/lib/labels.js';
import { cn, ago } from '@/lib/utils.js';
import { AgentIcon } from './agent-icon.jsx';
import { useT } from '@/lib/i18n.js';
import { PRODUCT } from '../../core/product.mjs';

// The assistant's wordmark ORB·E, drawn its own way in each theme (app.css .wordmark): spaced capitals with a dot of the
// theme's colour in Orb, a techno one underlined in Vaporwave…
function Wordmark() {
  return (
    <div className="wordmark" role="img" aria-label={PRODUCT.assistant} data-testid="wordmark">
      <span className="wordmark-orb" aria-hidden="true">ORB</span><span className="wordmark-dot" aria-hidden="true" /><span className="wordmark-e" aria-hidden="true">E</span>
    </div>
  );
}

export function NavItem({ icon: Icon, iconEl, label, active, onClick, children, testid }) {
  return (
    <button data-testid={testid} onClick={onClick} className={cn('group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] transition-colors', active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground')}>
      {iconEl ?? (Icon ? <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </button>
  );
}

const taskDot = { running: 'bg-info animate-pulse', awaiting_approval: 'bg-warning', failed: 'bg-destructive', blocked: 'bg-destructive', done: 'bg-success/70', queued: 'bg-muted-foreground/50', cancelled: 'bg-muted-foreground/30', limited: 'bg-warning' };

// 2.6: the sidebar's width, dragged from its edge (a double click goes back to the usual one), remembered in this window.
const SIDEBAR_DEFAULT = 256; const SIDEBAR_MIN = 216; const SIDEBAR_MAX = 440; const WIDTH_KEY = 'orb.anchoMenu';
function useSidebarWidth() {
  const [width, setRaw] = useState(() => { try { const n = Number(localStorage.getItem(WIDTH_KEY)); return n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT; } catch { return SIDEBAR_DEFAULT; } });
  const clamp = (n) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)));
  const remember = (w) => { try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* storage unavailable */ } };
  const setWidth = (n) => { const w = clamp(n); setRaw(w); remember(w); };
  // While dragging only the width changes (it is saved once, on release); the pointer is captured by the edge, so a
  // release outside the window or a cancelled drag still ends it.
  const startResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget; const x0 = e.clientX; const w0 = handle.parentElement.getBoundingClientRect().width; let last = w0;
    try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    handle.setAttribute('data-dragging', ''); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const move = (ev) => { last = clamp(w0 + ev.clientX - x0); setRaw(last); };
    const end = () => {
      handle.removeAttribute('data-dragging'); document.body.style.cursor = ''; document.body.style.userSelect = '';
      for (const [n, f] of [['pointermove', move], ['pointerup', end], ['pointercancel', end], ['lostpointercapture', end]]) handle.removeEventListener(n, f);
      remember(last);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
  };
  return { width, setWidth, startResize };
}

// What is unfolded (each project folder and, 3.2, the sections Proyectos, Conversaciones and Completadas), remembered in
// this window.
function useRemembered(key, initial) {
  const [open, setOpen] = useState(() => { try { return { ...initial, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return initial; } });
  const set = (name, value) => setOpen((o) => { const next = { ...o, [name]: value }; try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });
  return [open, set];
}

// ---- 3.2: the items of the sidebar: conversations with the assistant («c»), direct ones with an agent («s») and tasks («t»)

// The card of a conversation on hover: its project with its icon, who answers in it, the branch, how its tasks go, its
// state and when it last moved.
const branches = new Map(); // project -> { at, branch }
function ConvCard({ item, modelName }) {
  const t = useT();
  const [branch, setBranch] = useState(() => branches.get(item.project)?.branch ?? null);
  useEffect(() => {
    if (!item.project) return undefined;
    const hit = branches.get(item.project);
    if (hit && Date.now() - hit.at < 30_000) { setBranch(hit.branch); return undefined; }
    let alive = true;
    call('projects.branch', { name: item.project }).then((r) => { branches.set(item.project, { at: Date.now(), branch: r?.branch ?? null }); if (alive) setBranch(r?.branch ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [item.project]);
  const tasks = item.tasks ?? {};
  const taskLine = [['done', 'card.tasksDone'], ['running', 'card.tasksRunning'], ['queued', 'card.tasksQueued'], ['awaiting_approval', 'card.tasksApproval'], ['failed', 'card.tasksFailed'], ['blocked', 'card.tasksBlocked']]
    .filter(([k]) => tasks[k]).map(([k, key]) => t(tasks[k] === 1 ? `${key}One` : key, { n: tasks[k] })).join(' · ');
  const state = item.done ? t('card.done') : item.busy ? t('card.working') : item.asking ? t('card.asking') : item.attention ? t('card.attention') : t('card.idle');
  const who = item.kind === 'orbe'
    ? `${t('card.withAssistant')} · ${AGENT[item.agent] ?? item.agent}${item.model ? ` ${modelName(item.agent, item.model)}` : ''}`
    : `${AGENT[item.agent] ?? item.agent}${item.model ? ` · ${modelName(item.agent, item.model)}` : ''}`;
  const row = 'flex min-w-0 items-center gap-2 text-[12.5px]';
  return (
    <div className="grid gap-1.5" data-testid="conv-card">
      <div className="orb-tip-title text-[13.5px] leading-snug font-semibold">{item.title}</div>
      <div className={cn(row, 'orb-tip-title')}>{item.project ? <ProjectIcon name={item.project} className="size-4" /> : <Folder className="size-4 shrink-0 opacity-70" />}<span className="truncate">{item.project ?? t('card.noProject')}</span></div>
      <div className={cn(row, 'orb-tip-text')}>{item.kind === 'orbe' ? <Sparkles className="text-primary size-4 shrink-0" /> : <AgentIcon agent={item.agent} className="size-4" />}<span className="truncate">{who}</span></div>
      {branch ? <div className={cn(row, 'orb-tip-text')}><GitBranch className="size-4 shrink-0" /><span className="truncate font-mono text-[12px]">{branch}</span></div> : null}
      {taskLine ? <div className={cn(row, 'orb-tip-text')}><ListChecks className="size-4 shrink-0" /><span className="truncate">{taskLine}</span></div> : null}
      <div className={cn(row, item.attention && !item.done ? 'text-warning' : 'orb-tip-text')}>{item.attention && !item.done ? <MessageCircleQuestion className="size-4 shrink-0" /> : <CircleCheck className="size-4 shrink-0" />}<span className="truncate">{state}</span></div>
      <div className={cn(row, 'orb-tip-text opacity-80')}><Clock className="size-4 shrink-0" /><span className="truncate tabular-nums">{t('card.lastActivity', { when: ago(item.at) })}</span></div>
    </div>
  );
}

function ItemIcon({ item }) {
  if (item.kind === 'task') return <span className={cn('size-1.5 shrink-0 rounded-full', taskDot[item.status] ?? 'bg-muted-foreground/40')} />;
  const lead = item.kind === 'orbe' ? <Sparkles className={cn('size-3.5 shrink-0', item.busy ? 'text-primary animate-pulse' : 'text-primary/80')} /> : <AgentIcon agent={item.agent} className={cn('size-3.5', item.busy && 'animate-pulse')} />;
  if (item.done) return lead;
  if (item.asking) return <MessageCircleQuestion className="text-warning size-3.5 shrink-0" />;
  if (item.attention) return item.stalled ? <CirclePause className="text-warning size-3.5 shrink-0" /> : <ShieldAlert className="text-warning size-3.5 shrink-0" />;
  return lead;
}

// A row of the sidebar, with a button on hover that marks it completed (or brings it back).
function SideItem({ item, route, modelName, testid }) {
  const t = useT();
  const label = item.done ? t('comp.sidebar.restore') : t('comp.sidebar.complete');
  const button = (
    <button onClick={item.open} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1 text-left text-[13px]" data-testid={testid ?? `item-${item.key}`}>
      <ItemIcon item={item} /><span className="min-w-0 flex-1 truncate">{item.title}</span>
    </button>
  );
  return (
    <div className={cn('group/item flex items-center rounded-md pr-0.5', item.isActive(route) ? 'bg-accent text-accent-foreground' : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground')}>
      {item.kind === 'task'
        ? <BubbleTip title={item.title} text={item.hint} side="right" offset={40}>{button}</BubbleTip>
        : <RichTip content={<ConvCard item={item} modelName={modelName} />} offset={40}>{button}</RichTip>}
      <Tip label={label}><button className="text-muted-foreground hover:text-success grid size-6 shrink-0 cursor-pointer place-items-center rounded-md opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100" aria-label={label} onClick={(e) => { e.stopPropagation(); act(call('sidebar.complete', { key: item.key, done: !item.done })); }} data-testid={`complete-${item.key}`}>{item.done ? <Undo2 className="size-3.5" /> : <CircleCheck className="size-3.5" />}</button></Tip>
    </div>
  );
}

// A section of the sidebar (PROYECTOS, CONVERSACIONES, COMPLETADAS): a grey heading that folds what is under it.
function Section({ title, count, open, onOpen, action, children, testid, className }) {
  return (
    <Collapsible open={open} onOpenChange={onOpen} className={cn('pt-4', className)}>
      <div className="text-muted-foreground flex items-center px-1 pb-1">
        <CollapsibleTrigger className="hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] tracking-wide uppercase" data-testid={testid}>
          <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
          <span className="flex-1 truncate">{title}</span>{count ? <span className="tabular-nums opacity-70">{count}</span> : null}
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
const Sub = ({ children }) => <div className="text-muted-foreground/80 px-2 pt-1.5 pb-0.5 text-[10.5px] tracking-wide uppercase">{children}</div>;

// 2.6: a project. A click starts a new conversation in it; its arrow (or a double click) unfolds what is going on in it:
// 3.2: its conversations and its tasks, each in its own group (the completed ones are under «Completadas»).
function ProjectFolder({ project, convs, tasks, open, onOpen, route, active, modelName }) {
  const t = useT();
  const SHOWN = 6;
  const all = [...convs, ...tasks];
  const working = all.some((i) => i.busy); const waiting = all.some((i) => i.attention);
  return (
    <Collapsible open={open} onOpenChange={onOpen}>
      <div className={cn('group/folder flex items-center rounded-lg', active && route.view === 'chat' && route.id == null ? 'bg-accent' : 'hover:bg-accent/60')}>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-pointer place-items-center rounded-md" aria-label={t(open ? 'comp.sidebar.fold' : 'comp.sidebar.unfold', { name: project.name })}>
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </CollapsibleTrigger>
        <BubbleTip title={t('comp.sidebar.newIn', { name: project.name })} side="right" offset={12}>
          <button className={cn('flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-2 text-left text-[13.5px] select-none', active ? 'text-foreground font-medium' : 'text-foreground/80')} onClick={() => newChat(project.name)} onDoubleClick={() => onOpen(!open)} data-testid={`folder-${project.name}`}>
            <ProjectIcon name={project.name} className="size-4" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {project.grupo ? <Layers className="text-muted-foreground size-3 shrink-0" aria-label={t('comp.sidebar.group', { name: project.grupo })} /> : null}
            {waiting ? <span className="bg-warning size-1.5 shrink-0 rounded-full" role="img" aria-label={t('comp.sidebar.waitsApproval')} /> : working ? <span className="bg-info size-1.5 shrink-0 animate-pulse rounded-full" role="img" aria-label={t('inbox.working')} /> : null}
          </button>
        </BubbleTip>
      </div>
      <CollapsibleContent>
        <div className="ml-3 grid gap-px border-l pl-1.5" data-testid={`folder-items-${project.name}`}>
          {!all.length ? <p className="text-muted-foreground px-2 py-1 text-xs">{t('comp.sidebar.nothingYet')}</p> : null}
          {convs.length ? <><Sub>{t('comp.sidebar.conversations')}</Sub>{convs.slice(0, SHOWN).map((i) => <SideItem key={i.key} item={i} route={route} modelName={modelName} />)}</> : null}
          {tasks.length ? <><Sub>{t('comp.sidebar.tasks')}</Sub>{tasks.slice(0, SHOWN).map((i) => <SideItem key={i.key} item={i} route={route} modelName={modelName} />)}</> : null}
          {tasks.length > SHOWN ? <button className="text-muted-foreground hover:text-foreground cursor-pointer px-2 py-1 text-left text-xs" onClick={() => go({ view: 'tasks', project: project.name })}>{t('comp.sidebar.viewAll', { n: tasks.length })}</button> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// 3.2: the search over projects, conversations and tasks, with its filter (what, in what state, with which agent).
const FILTER0 = { type: 'all', state: 'all', agent: 'all' };
function SearchBox({ query, setQuery, filter, setFilter, agents }) {
  const t = useT();
  const changed = filter.type !== 'all' || filter.state !== 'all' || filter.agent !== 'all';
  const pick = (k, v) => setFilter((f) => ({ ...f, [k]: f[k] === v ? 'all' : v }));
  const group = (k, label, list) => (<>
    <DropdownMenuLabel>{label}</DropdownMenuLabel>
    {list.map(([v, text]) => <DropdownMenuCheckboxItem key={v} checked={filter[k] === v} onCheckedChange={() => pick(k, v)} onSelect={(e) => e.preventDefault()}>{text}</DropdownMenuCheckboxItem>)}
  </>);
  return (
    <div className="side-search flex items-center gap-1 px-3 pb-2" data-testid="sidebar-search">
      <label className="side-search-box flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2">
        <Search className="text-muted-foreground size-3.5 shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setFilter(FILTER0); } }} placeholder={t('comp.sidebar.search')} aria-label={t('comp.sidebar.search')} className="placeholder:text-muted-foreground h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none" data-testid="sidebar-search-input" />
        {query || changed ? <button type="button" className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded" aria-label={t('comp.sidebar.clearSearch')} onClick={() => { setQuery(''); setFilter(FILTER0); }}><X className="size-3.5" /></button> : null}
      </label>
      <DropdownMenu>
        <Tip label={t('comp.sidebar.filter')}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn('relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border', changed ? 'text-primary border-primary/40' : 'text-muted-foreground hover:text-foreground')} aria-label={t('comp.sidebar.filter')} data-testid="sidebar-filter">
              <SlidersHorizontal className="size-3.5" />{changed ? <span className="notice-dot" aria-hidden="true" /> : null}
            </button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-56">
          {group('type', t('comp.sidebar.filterType'), [['conversations', t('comp.sidebar.conversations')], ['tasks', t('comp.sidebar.tasks')], ['projects', t('nav.projects')]])}
          <DropdownMenuSeparator />
          {group('state', t('comp.sidebar.filterState'), [['active', t('comp.sidebar.stateActive')], ['attention', t('comp.sidebar.stateAttention')], ['done', t('comp.sidebar.completed')]])}
          {agents.length > 1 ? <><DropdownMenuSeparator />{group('agent', t('comp.sidebar.filterAgent'), agents.map((a) => [a, AGENT[a] ?? a]))}</> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function Sidebar({ mood, page = false }) {
  const t = useT();
  const app = useStore((s) => s.app);
  const route = useStore((s) => s.route);
  const tasks = useStore((s) => s.tasks);
  const sessions = useStore((s) => s.sessions);
  const conversations = useStore((s) => s.conversations) ?? [];
  const settingsOpen = useStore((s) => Boolean(s.settings));
  const name = app.config.assistantName;
  const approvals = tasks.filter((x) => x.status === 'awaiting_approval').length;
  const running = tasks.filter((x) => x.status === 'running').length;
  const projects = useStore((s) => s.projects);
  const [openFolders, setOpenFolder] = useRemembered('orb.carpetas', {});
  const [sections, setSection] = useRemembered('orb.secciones', { projects: true, conversations: true, done: false });
  const { width, setWidth, startResize } = useSidebarWidth();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(FILTER0);
  const [found, setFound] = useState(null); // conversations whose messages have the words (engine search)
  const [moreConvs, setMoreConvs] = useState(false);
  const is = (view) => route.view === view;
  const catalog = useCatalog();
  const modelName = (agent, id) => modelsOf(catalog?.find((a) => a.id === agent)).find((m) => m.id === id)?.label ?? id;

  // Everything as rows of one kind: conversations with the assistant, direct ones and tasks.
  const completed = new Set(app.completed ?? []); const kept = new Set(app.kept ?? []);
  const pending = app.approvals ?? [];
  const items = useMemo(() => {
    const convItems = conversations.map((c) => ({
      key: `c${c.id}`, kind: 'orbe', id: c.id, title: c.title, project: c.project, agent: c.agent, model: c.model, at: c.updated_at, tasks: c.tasks,
      done: c.status === 'done', busy: c.busy || c.waiting, asking: c.asking, attention: c.asking || (c.tasks?.awaiting_approval ?? 0) > 0,
      open: () => go({ view: 'chat', id: c.id }), isActive: (r) => r.view === 'chat' && r.id === c.id
    }));
    const directItems = sessions.filter((s) => s.kind === 'chat' && s.id !== app.optiSession).map((s) => {
      const asks = pending.some((a) => a.session_id === s.id); const stalled = ['interrupted', 'limited', 'error'].includes(s.status);
      return { key: `s${s.id}`, kind: 'direct', id: s.id, title: s.title, project: s.project, agent: s.agent, model: s.model, at: s.updated_at,
        done: s.settled || completed.has(`s${s.id}`), busy: s.status === 'running', attention: asks || stalled, stalled: stalled && !asks,
        open: () => go({ view: 'session', id: s.id }), isActive: (r) => r.view === 'session' && r.id === s.id };
    });
    const taskItems = tasks.map((tk) => ({
      key: `t${tk.id}`, kind: 'task', id: tk.id, title: tk.title, project: tk.project, agent: tk.assigned_to ?? tk.agent, model: tk.model, at: tk.updated_at, status: tk.status,
      hint: `#${tk.id} · ${STATUS[tk.status]?.[0] ?? tk.status}`,
      done: completed.has(`t${tk.id}`) || (['done', 'cancelled'].includes(tk.status) && !kept.has(`t${tk.id}`)),
      busy: tk.status === 'running', attention: ['awaiting_approval', 'limited', 'failed', 'blocked'].includes(tk.status),
      open: () => go({ view: 'tasks', id: tk.id }), isActive: (r) => r.view === 'tasks' && r.id === tk.id
    }));
    const byDate = (a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''));
    return { convs: [...convItems, ...directItems].sort(byDate), tasks: taskItems.sort(byDate) };
  }, [conversations, sessions, tasks, app.optiSession, app.completed, app.kept, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  // The engine also looks in the messages (debounced).
  useEffect(() => {
    const q = query.trim(); if (q.length < 2) { setFound(null); return undefined; }
    const id = setTimeout(() => call('conversations.search', { q }).then(setFound).catch(() => setFound(null)), 250);
    return () => clearTimeout(id);
  }, [query]);

  const openConvs = items.convs.filter((i) => !i.done);
  const doneConvs = items.convs.filter((i) => i.done);
  const doneTasks = items.tasks.filter((i) => i.done);
  const folders = projects.map((p) => ({ project: p, convs: openConvs.filter((i) => i.project === p.name), tasks: items.tasks.filter((i) => !i.done && i.project === p.name) }))
    .sort((a, b) => Number(b.project.active) - Number(a.project.active) || String([...b.convs, ...b.tasks][0]?.at ?? '').localeCompare(String([...a.convs, ...a.tasks][0]?.at ?? '')) || a.project.name.localeCompare(b.project.name));
  // 2.7: the projects of a multiplatform group stay together, where the first of them falls.
  for (let i = 0; i < folders.length; i++) {
    const g = folders[i].project.grupo; if (!g) continue;
    const rest = folders.slice(i + 1).filter((f) => f.project.grupo === g);
    if (!rest.length) continue;
    const others = folders.slice(i + 1).filter((f) => f.project.grupo !== g);
    folders.splice(i + 1, folders.length - i - 1, ...rest, ...others);
    i += rest.length;
  }
  const isOpen = (f) => openFolders[f.project.name] ?? [...f.convs, ...f.tasks].some((i) => i.busy || i.attention);
  // «Por aprobar»: permissions and tasks waiting for the user.
  const needs = [
    ...pending.map((a) => ({ key: `a${a.id}`, title: a.session?.title ?? t('comp.sidebar.permission'), hint: t('comp.sidebar.waitsPermission', { title: a.body?.title ?? '' }), open: () => go({ view: 'session', id: a.session_id }), isActive: (r) => r.view === 'session' && r.id === a.session_id })),
    ...tasks.filter((tk) => tk.status === 'awaiting_approval').map((tk) => ({ key: `t${tk.id}`, title: tk.title, hint: t('comp.sidebar.taskWaitsApproval', { id: tk.id }), open: () => go({ view: 'tasks', id: tk.id }), isActive: (r) => r.view === 'tasks' && r.id === tk.id }))
  ];

  // Search and filter: one list of results instead of the sections.
  const searching = query.trim().length > 0 || filter.type !== 'all' || filter.state !== 'all' || filter.agent !== 'all';
  const results = (() => {
    if (!searching) return null;
    const q = query.trim().toLowerCase();
    const hit = (i) => !q || i.title.toLowerCase().includes(q) || String(i.project ?? '').toLowerCase().includes(q) || (i.kind === 'task' && `#${i.id}` === q)
      || (i.kind === 'orbe' && found?.conversations?.includes(i.id)) || (i.kind === 'direct' && found?.sessions?.includes(i.id));
    const state = (i) => filter.state === 'all' || (filter.state === 'active' ? i.busy && !i.done : filter.state === 'attention' ? i.attention && !i.done : i.done);
    const agent = (i) => filter.agent === 'all' || i.agent === filter.agent;
    const ok = (i) => hit(i) && state(i) && agent(i);
    return {
      convs: ['all', 'conversations'].includes(filter.type) ? items.convs.filter(ok).slice(0, 40) : [],
      tasks: ['all', 'tasks'].includes(filter.type) ? items.tasks.filter(ok).slice(0, 40) : [],
      projects: ['all', 'projects'].includes(filter.type) && filter.state === 'all' && filter.agent === 'all' ? projects.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 20) : []
    };
  })();
  const agents = [...new Set([...items.convs, ...items.tasks].map((i) => i.agent).filter(Boolean))];
  const SHOWN = moreConvs ? 60 : 8;

  const newProject = async () => { const p = await createProjectFlow(); if (p) { await act(call('projects.setActive', { name: p.name })); setOpenFolder(p.name, true); } };
  const lists = results ? (
    <div className="grid gap-px pt-2" data-testid="sidebar-results">
      {results.projects.length ? <><Sub>{t('nav.projects')}</Sub>{results.projects.map((p) => (
        <button key={p.name} className="text-foreground/80 hover:bg-accent/60 hover:text-foreground flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]" onClick={() => { setQuery(''); setFilter(FILTER0); setSection('projects', true); setOpenFolder(p.name, true); }}>
          <ProjectIcon name={p.name} className="size-4" /><span className="min-w-0 flex-1 truncate">{p.name}</span>
        </button>))}</> : null}
      {results.convs.length ? <><Sub>{t('comp.sidebar.conversations')}</Sub>{results.convs.map((i) => <SideItem key={i.key} item={i} route={route} modelName={modelName} />)}</> : null}
      {results.tasks.length ? <><Sub>{t('comp.sidebar.tasks')}</Sub>{results.tasks.map((i) => <SideItem key={i.key} item={i} route={route} modelName={modelName} />)}</> : null}
      {!results.projects.length && !results.convs.length && !results.tasks.length ? <p className="text-muted-foreground px-2.5 py-2 text-xs">{t('comp.sidebar.noResults')}</p> : null}
    </div>
  ) : (<>
    {needs.length ? (
      <div className="pt-3">
        <div className="text-warning flex items-center gap-1.5 px-2.5 pb-1 text-[11px] tracking-wide uppercase">{t('inbox.waiting')}<span className="opacity-70">· {needs.length}</span></div>
        <div className="grid gap-px">
          {needs.slice(0, 8).map((i) => (
            <div key={i.key} className={cn('flex items-center rounded-lg', i.isActive(route) ? 'bg-accent' : 'hover:bg-accent/60')}>
              <BubbleTip title={i.title} text={i.hint} side="right" offset={12}>
                <button onClick={i.open} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[13px]" data-testid="inbox-item">
                  <ShieldAlert className="text-warning size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{i.title}</span>
                </button>
              </BubbleTip>
            </div>
          ))}
        </div>
      </div>
    ) : null}
    <Section title={t('nav.folders')} open={sections.projects !== false} onOpen={(v) => setSection('projects', v)} testid="sidebar-folders"
      action={bridge.mobile ? null : <Tip label={t('comp.projects.newTitle')}><button className="hover:text-foreground grid size-6 cursor-pointer place-items-center rounded-md hover:bg-accent/60" aria-label={t('comp.projects.newTitle')} onClick={newProject} data-testid="sidebar-new-project"><FolderPlus className="size-3.5" /></button></Tip>}>
      {folders.length ? folders.map((f) => <ProjectFolder key={f.project.name} project={f.project} convs={f.convs} tasks={f.tasks} open={isOpen(f)} onOpen={(v) => setOpenFolder(f.project.name, v)} route={route} active={f.project.active} modelName={modelName} />)
        : <p className="text-muted-foreground px-2.5 text-xs leading-relaxed">{t('comp.sidebar.foldersHint')}</p>}
    </Section>
    <Section title={t('comp.sidebar.conversations')} count={openConvs.length} open={sections.conversations !== false} onOpen={(v) => setSection('conversations', v)} testid="sidebar-conversations">
      <div className="grid gap-px">
        {openConvs.length ? openConvs.slice(0, SHOWN).map((i) => <SideItem key={i.key} item={i} route={route} modelName={modelName} />)
          : <p className="text-muted-foreground px-2.5 text-xs leading-relaxed">{t('comp.sidebar.noConversations')}</p>}
        {openConvs.length > 8 ? <button className="text-muted-foreground hover:text-foreground cursor-pointer px-2 py-1 text-left text-xs" onClick={() => setMoreConvs(!moreConvs)} data-testid="sidebar-more-conversations">{moreConvs ? t('comp.sidebar.showLess') : t('comp.sidebar.viewMore', { n: openConvs.length - 8 })}</button> : null}
      </div>
    </Section>
    {/* What is completed (by itself or by hand), folded by default: tasks and conversations apart. */}
    {doneConvs.length || doneTasks.length ? (
      <Section title={t('comp.sidebar.completed')} count={doneConvs.length + doneTasks.length} open={sections.done === true} onOpen={(v) => setSection('done', v)} testid="sidebar-completed" className="mt-auto">
        <div className="grid gap-px">
          {doneConvs.length ? <><Sub>{t('comp.sidebar.conversations')}</Sub>{doneConvs.slice(0, 30).map((i) => <SideItem key={i.key} item={i} route={route} modelName={modelName} />)}</> : null}
          {doneTasks.length ? <><Sub>{t('comp.sidebar.tasks')}</Sub>{doneTasks.slice(0, 30).map((i) => <SideItem key={i.key} item={i} route={route} modelName={modelName} />)}</> : null}
        </div>
      </Section>
    ) : null}
  </>);

  const newButton = <Button className={cn('min-w-0 flex-1 justify-start', is('chat') && route.id == null && 'bg-accent')} variant="outline" onClick={() => newChat()} data-testid="new-conversation"><MessageSquarePlus /><span className="truncate">{t('nav.newChat')}</span></Button>;
  // 2.7, the phone: the conversations as a screen of their own (the «Chats» tab); the sections are the tabs below.
  if (page) return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mobile-chats">
      <div className="flex gap-2 px-4 pt-3 pb-2">{newButton}</div>
      <SearchBox query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} agents={agents} />
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-4 pb-4">{lists}</nav>
    </div>
  );
  return (
    <aside className="bg-sidebar relative flex h-full shrink-0 flex-col border-r" style={{ width }}>
      {bridge.mobile ? null : <div className="sidebar-resize" role="separator" aria-orientation="vertical" aria-label={t('comp.sidebar.resize')} onPointerDown={startResize} onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)} data-testid="sidebar-resize" />}
      <div className="theme-band side-band app-titlebar flex h-14 shrink-0 items-center gap-2 border-b px-4">
        {/* 3.0: the robot goes back to the conversation in progress (3.2: the last one opened). */}
        <Tip label={t('nav.backToChat', { name })} side="bottom" align="start">
          <button type="button" className="no-drag relative shrink-0 cursor-pointer rounded-full" onClick={() => go(lastChat(route, conversations))} aria-label={t('nav.backToChat', { name })} data-testid="sidebar-home">
            <Robot size={34} mood={mood} title={name} live />
            {(app.chats ?? []).some((c) => c.busy) ? <span className="bg-primary absolute right-0 bottom-0 size-2 animate-pulse rounded-full" /> : null}
          </button>
        </Tip>
        {/* 2.6: with the default name, the drawn wordmark (Orb·E); a name of one's own, as it is written. 3.2: one line, all
            on the band's middle; the working folder is in the middle of the chat's top bar. */}
        <div className="flex min-w-0 flex-1 items-center">{name === PRODUCT.assistant ? <Wordmark /> : <div className="truncate text-[15px] font-medium">{name}</div>}</div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ThemeToggle />
          <SidebarToggle />
        </div>
      </div>
      {/* 3.2: one button: a new conversation (with the assistant, or directly with an agent when «Orquestador» is off). */}
      <div className="flex gap-2 px-3 pt-3 pb-2">{newButton}</div>
      <SearchBox query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} agents={agents} />
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3 pb-3">
        <NavItem icon={ListTodo} label={t('nav.tasks')} active={is('tasks')} onClick={() => go('tasks')} testid="nav-tasks">
          {approvals ? <span className="bg-warning text-white rounded-full px-1.5 text-[11px] font-medium" aria-label={t('comp.sidebar.waitApproval')}>{approvals}</span>
            : running ? <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px]">{running}</span> : null}
        </NavItem>
        <NavItem icon={FolderKanban} label={t('nav.projects')} active={is('projects')} onClick={() => go('projects')} testid="nav-projects" />
        {/* Expert mode: PC only (wide screens), when turned on in Settings. */}
        {app.config.expert?.enabled && fullPc() ? <div className="hidden lg:block"><NavItem icon={SquareTerminal} label={t('nav.expert')} active={is('expert')} onClick={() => go('expert')} testid="nav-expert" /></div> : null}
        <NavItem icon={CalendarClock} label={t('nav.schedules')} active={is('schedules')} onClick={() => go('schedules')} testid="nav-schedules" />
        {/* 2.7: the project's Pizarra (draw and attach what the assistant should know). */}
        <NavItem icon={PenTool} label={t('nav.board')} active={is('board')} onClick={() => go('board')} testid="nav-board" />
        {/* 2.7: Monitoreo del equipo (Opti Bot), only once turned on in Ajustes, and only on the PC. */}
        {app.config.monitor?.enabled && fullPc() ? <NavItem icon={HeartPulse} label={t('nav.monitor')} active={is('monitor')} onClick={() => go('monitor')} testid="nav-monitor" /> : null}
        {lists}
      </nav>
      <div className="flex flex-col gap-0.5 border-t px-3 py-2.5">
        {bridge.mobile ? null : <NavItem icon={Bot} label={t('nav.agents')} active={is('agents')} onClick={() => go('agents')} testid="nav-agents" />}
        <NavItem icon={BookOpen} label={t('nav.logs')} active={is('logs')} onClick={() => go('logs')} testid="nav-logs" />
        <NavItem icon={History} label={t('nav.activity')} active={is('activity')} onClick={() => go('activity')} testid="nav-activity" />
        {/* 2.6: how the app works, the FAQ and the button that replays the guided tour. */}
        <NavItem icon={GraduationCap} label={t('nav.tutorials')} active={is('tutorials')} onClick={() => go('tutorials')} testid="nav-tutorials" />
        {bridge.mobile ? null : <NavItem icon={Settings} label={t('nav.settings')} active={settingsOpen} onClick={() => openSettings()} testid="nav-settings" />}
        {bridge.mobile ? <NavItem icon={Smartphone} label={t('nav.phone')} active={is('phone')} onClick={() => go('phone')} testid="nav-phone" /> : null}
      </div>
    </aside>
  );
}

// 3.2: the robot of the sidebar goes back to the conversation on screen, or the latest one still open (or a new one).
function lastChat(route, conversations) {
  if (route.view === 'chat') return route;
  const open = conversations.find((c) => c.status === 'open');
  return open ? { view: 'chat', id: open.id } : { view: 'chat' };
}
