import { useState } from 'react';
import { Smartphone, MessageSquarePlus, ListTodo, FolderKanban, Bot, BookOpen, History, Settings, Sparkles, SquareTerminal, ChevronRight, Plus, FolderPlus, ShieldAlert, Hourglass, CirclePause, Check, CalendarClock } from 'lucide-react';
import { Robot } from './robot.jsx';
import { ThemeToggle, SidebarToggle } from './theme-toggle.jsx';
import { Button } from './ui/button.jsx';
import { useStore, go, bridge, call, act, openSettings } from '@/lib/store.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, Tip } from './ui/overlay.jsx';
import { createProjectFlow } from './project-actions.jsx';
import { STATUS } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { AgentIcon } from './agent-icon.jsx';
import { useT } from '@/lib/i18n.js';

function NavItem({ icon: Icon, iconEl, label, active, onClick, children, testid }) {
  return (
    <button data-testid={testid} onClick={onClick} className={cn('group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] transition-colors', active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground')}>
      {iconEl ?? (Icon ? <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </button>
  );
}

const statusDot = { running: 'bg-info animate-pulse', error: 'bg-destructive', idle: 'bg-success/70', interrupted: 'bg-warning', limited: 'bg-warning' };

// The inbox at the top (2.3, like T3 Code's): what needs you (a permission, a task to approve, something stopped halfway or
// waiting for the usage limit) and what is working right now. A conversation leaves it with «Listo» (settled).
function Inbox({ title, tone, items, route, settleLabel }) {
  if (!items.length) return null;
  return (
    <div className="pt-4">
      <div className={cn('flex items-center gap-1.5 px-2.5 pb-1 text-[11px] tracking-wide uppercase', tone)}>{title}<span className="opacity-70">· {items.length}</span></div>
      <div className="grid gap-px">
        {items.slice(0, 8).map((i) => (
          <div key={i.key} className={cn('group/inbox flex items-center rounded-lg pr-1', i.isActive(route) ? 'bg-accent' : 'hover:bg-accent/60')}>
            <button onClick={i.open} title={i.hint} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[13px]" data-testid="inbox-item">
              {i.icon}<span className="min-w-0 flex-1 truncate">{i.title}</span>
            </button>
            {i.settle ? <Tip label={settleLabel}><button className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-pointer place-items-center rounded-md opacity-0 group-hover/inbox:opacity-100 focus-visible:opacity-100" aria-label={settleLabel} onClick={i.settle}><Check className="size-3.5" /></button></Tip> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
const taskDot = { running: 'bg-info animate-pulse', awaiting_approval: 'bg-warning', failed: 'bg-destructive', blocked: 'bg-destructive', done: 'bg-success/70', queued: 'bg-muted-foreground/50', cancelled: 'bg-muted-foreground/30', limited: 'bg-warning' };

// Which project folders are unfolded, remembered in this window.
const OPEN_KEY = 'orb.carpetas';
function useOpenFolders() {
  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; } });
  const set = (name, value) => setOpen((o) => { const next = { ...o, [name]: value }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });
  return [open, set];
}

// A project as a folder that unfolds into what was asked in it: its tasks and its direct conversations, newest first.
function ProjectFolder({ project, items, open, onOpen, route, active }) {
  const t = useT();
  const SHOWN = 8;
  const running = items.filter((i) => i.status === 'running').length;
  const waiting = items.filter((i) => i.status === 'awaiting_approval').length;
  return (
    <Collapsible open={open} onOpenChange={onOpen}>
      <div className="group/folder flex items-center rounded-lg pr-1 hover:bg-accent/60">
        <CollapsibleTrigger className={cn('flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 py-1.5 text-left text-[13.5px]', active ? 'text-foreground font-medium' : 'text-foreground/80')} data-testid={`folder-${project.name}`}>
          <ChevronRight className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          {waiting ? <span className="bg-warning size-1.5 shrink-0 rounded-full" title={t('comp.sidebar.waitsApproval')} /> : running ? <span className="bg-info size-1.5 shrink-0 animate-pulse rounded-full" title={t('inbox.working')} /> : null}
        </CollapsibleTrigger>
        <Tip label={t('comp.sidebar.askHere')}><button className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-pointer place-items-center rounded-md opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100" aria-label={t('comp.sidebar.askIn', { name: project.name })} onClick={async () => { await act(call('projects.setActive', { name: project.name })); go('chat'); }}><Plus className="size-3.5" /></button></Tip>
      </div>
      <CollapsibleContent>
        <div className="ml-3.5 grid gap-px border-l pl-1.5">
          {items.length ? items.slice(0, SHOWN).map((i) => (
            <button key={i.key} onClick={i.open} title={i.hint} className={cn('flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors', i.isActive(route) ? 'bg-accent text-accent-foreground' : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground')}>
              {i.icon}<span className="min-w-0 flex-1 truncate">{i.title}</span>
            </button>
          )) : <p className="text-muted-foreground px-2 py-1 text-xs">{t('comp.sidebar.nothingYet')}</p>}
          {items.length > SHOWN ? <button className="text-muted-foreground hover:text-foreground cursor-pointer px-2 py-1 text-left text-xs" onClick={() => go({ view: 'tasks', project: project.name })}>{t('comp.sidebar.viewAll', { n: items.length })}</button> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Sidebar({ mood }) {
  const t = useT();
  const app = useStore((s) => s.app);
  const route = useStore((s) => s.route);
  const tasks = useStore((s) => s.tasks);
  const sessions = useStore((s) => s.sessions);
  const settingsOpen = useStore((s) => Boolean(s.settings));
  const name = app.config.assistantName;
  const approvals = tasks.filter((t) => t.status === 'awaiting_approval').length;
  const running = tasks.filter((t) => t.status === 'running').length;
  const projects = useStore((s) => s.projects);
  const [openFolders, setOpenFolder] = useOpenFolders();
  const chats = sessions.filter((s) => s.kind === 'chat').slice(0, 40);
  const is = (view) => route.view === view;
  // Tasks and conversations grouped by project folder; conversations without a project go to «Sin carpeta».
  const asTask = (t) => ({ key: `t${t.id}`, at: t.updated_at, status: t.status, title: t.title, hint: `#${t.id} · ${STATUS[t.status]?.[0] ?? t.status}`, icon: <span className={cn('size-1.5 shrink-0 rounded-full', taskDot[t.status] ?? 'bg-muted-foreground/40')} />, open: () => go({ view: 'tasks', id: t.id }), isActive: (r) => r.view === 'tasks' && r.id === t.id });
  const asChat = (c) => ({ key: `s${c.id}`, at: c.updated_at, status: c.status, title: c.title, hint: t('comp.sidebar.directChat'), icon: <AgentIcon agent={c.agent} className="size-3.5" />, open: () => go({ view: 'session', id: c.id }), isActive: (r) => r.view === 'session' && r.id === c.id });
  const byDate = (a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''));
  const folders = projects.map((p) => ({ project: p, items: [...tasks.filter((t) => t.project === p.name).map(asTask), ...chats.filter((c) => c.project === p.name).map(asChat)].sort(byDate) }))
    .sort((a, b) => Number(b.project.active) - Number(a.project.active) || String(b.items[0]?.at ?? '').localeCompare(String(a.items[0]?.at ?? '')) || a.project.name.localeCompare(b.project.name));
  const loose = chats.filter((c) => !c.project || !projects.some((p) => p.name === c.project)).map(asChat);
  const isOpen = (f) => openFolders[f.project.name] ?? (f.project.active || f.items.some((i) => i.status === 'running' || i.status === 'awaiting_approval'));
  // Inbox: what needs the user, then what is working.
  const pending = app.approvals ?? [];
  const settle = (c) => (e) => { e.stopPropagation(); act(call('sessions.settle', { id: c.id })); };
  // «Por aprobar»: permissions and tasks waiting for the user's approval. «Incidencias»: tasks waiting for quota and
  // conversations that stopped (the same names as the filters of Tareas).
  const needs = [
    ...pending.map((a) => ({ key: `a${a.id}`, title: a.session?.title ?? t('comp.sidebar.permission'), hint: t('comp.sidebar.waitsPermission', { title: a.body?.title ?? '' }), icon: <ShieldAlert className="text-warning size-3.5 shrink-0" />, open: () => go({ view: 'session', id: a.session_id }), isActive: (r) => r.view === 'session' && r.id === a.session_id })),
    ...tasks.filter((tk) => tk.status === 'awaiting_approval').map((tk) => ({ ...asTask(tk), hint: t('comp.sidebar.taskWaitsApproval', { id: tk.id }), icon: <ShieldAlert className="text-warning size-3.5 shrink-0" /> }))
  ];
  const issues = [
    ...tasks.filter((tk) => tk.status === 'limited').map((tk) => ({ ...asTask(tk), hint: t('comp.sidebar.taskWaitsQuota', { id: tk.id }), icon: <Hourglass className="text-warning size-3.5 shrink-0" /> })),
    ...chats.filter((c) => ['interrupted', 'limited', 'error'].includes(c.status) && !c.settled && !pending.some((a) => a.session_id === c.id)).map((c) => ({ ...asChat(c), hint: c.status === 'error' ? t('comp.sidebar.endedError') : c.status === 'limited' ? t('comp.sidebar.noQuota') : t('comp.sidebar.halfway'), icon: <CirclePause className="text-warning size-3.5 shrink-0" />, settle: settle(c) }))
  ];
  const working = [
    ...chats.filter((c) => c.status === 'running').map(asChat),
    ...tasks.filter((t) => t.status === 'running').map((t) => ({ ...asTask(t), icon: <AgentIcon agent={t.assigned_to ?? t.agent} className="size-3.5" /> }))
  ];
  return (
    <aside className="bg-sidebar flex h-full w-64 shrink-0 flex-col border-r">
      <div className="theme-band side-band app-titlebar flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Robot size={34} mood={mood} title={name} live />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{name}</div>
          <div className="text-muted-foreground truncate text-xs">{app.activeProject ? app.activeProject.name : t('nav.noProject')}</div>
        </div>
        <ThemeToggle />
        <SidebarToggle />
      </div>
      <div className="px-3 pb-2">
        <Button className="w-full justify-start" variant="outline" onClick={() => go('new')} data-testid="new-conversation"><MessageSquarePlus />{t('nav.newChat')}</Button>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3 pb-3">
        <NavItem icon={Sparkles} label={name} active={is('chat')} onClick={() => go('chat')} testid="nav-chat">
          {app.chat?.busy ? <span className="bg-primary size-2 animate-pulse rounded-full" /> : null}
        </NavItem>
        <NavItem icon={ListTodo} label={t('nav.tasks')} active={is('tasks')} onClick={() => go('tasks')} testid="nav-tasks">
          {approvals ? <span className="bg-warning text-white rounded-full px-1.5 text-[11px] font-medium" title={t('comp.sidebar.waitApproval')}>{approvals}</span>
            : running ? <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px]">{running}</span> : null}
        </NavItem>
        <NavItem icon={FolderKanban} label={t('nav.projects')} active={is('projects')} onClick={() => go('projects')} testid="nav-projects" />
        {/* Expert mode: PC only (wide screens), when turned on in Settings. */}
        {app.config.expert?.enabled && !bridge.mobile ? <div className="hidden lg:block"><NavItem icon={SquareTerminal} label={t('nav.expert')} active={is('expert')} onClick={() => go('expert')} testid="nav-expert" /></div> : null}
        <NavItem icon={CalendarClock} label={t('nav.schedules')} active={is('schedules')} onClick={() => go('schedules')} testid="nav-schedules" />
        <Inbox title={t('inbox.waiting')} tone="text-warning" items={needs} route={route} />
        <Inbox title={t('inbox.working')} tone="text-info" items={working} route={route} />
        <Inbox title={t('inbox.issues')} tone="text-destructive" items={issues} route={route} settleLabel={t('inbox.settle')} />
        <div className="text-muted-foreground flex items-center px-2.5 pt-5 pb-1 text-[11px] tracking-wide uppercase">
          <span className="flex-1">{t('nav.folders')}</span>
          {bridge.mobile ? null : <Tip label={t('comp.projects.newTitle')}><button className="hover:text-foreground grid size-6 cursor-pointer place-items-center rounded-md hover:bg-accent/60" aria-label={t('comp.projects.newTitle')} onClick={async () => { const p = await createProjectFlow(); if (p) { await act(call('projects.setActive', { name: p.name })); setOpenFolder(p.name, true); } }} data-testid="sidebar-new-project"><FolderPlus className="size-3.5" /></button></Tip>}
        </div>
        {folders.length ? folders.map((f) => <ProjectFolder key={f.project.name} project={f.project} items={f.items} open={isOpen(f)} onOpen={(v) => setOpenFolder(f.project.name, v)} route={route} active={f.project.active} />)
          : <p className="text-muted-foreground px-2.5 text-xs leading-relaxed">{t('comp.sidebar.foldersHint')}</p>}
        <div className="text-muted-foreground px-2.5 pt-4 pb-1 text-[11px] tracking-wide uppercase">{t('nav.loose')}</div>
        {loose.length ? loose.map((i) => (
          <NavItem key={i.key} iconEl={i.icon} label={i.title} active={i.isActive(route)} onClick={i.open}>
            <span className={cn('size-1.5 shrink-0 rounded-full', statusDot[i.status] ?? 'bg-muted-foreground/40')} />
          </NavItem>
        ))
          : <p className="text-muted-foreground px-2.5 text-xs leading-relaxed">{t('comp.sidebar.looseHint')}</p>}
      </nav>
      <div className="flex flex-col gap-0.5 border-t px-3 py-2.5">
        {bridge.mobile ? null : <NavItem icon={Bot} label={t('nav.agents')} active={is('agents')} onClick={() => go('agents')} testid="nav-agents" />}
        <NavItem icon={BookOpen} label={t('nav.logs')} active={is('logs')} onClick={() => go('logs')} testid="nav-logs" />
        <NavItem icon={History} label={t('nav.activity')} active={is('activity')} onClick={() => go('activity')} testid="nav-activity" />
        {bridge.mobile ? null : <NavItem icon={Settings} label={t('nav.settings')} active={settingsOpen} onClick={() => openSettings()} testid="nav-settings" />}
        {bridge.mobile ? <NavItem icon={Smartphone} label={t('nav.phone')} active={is('phone')} onClick={() => go('phone')} testid="nav-phone" /> : null}
      </div>
    </aside>
  );
}
