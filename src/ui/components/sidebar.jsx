import { MessageSquarePlus, ListTodo, FolderKanban, Bot, BookOpen, History, Settings, Sparkles, SquareTerminal } from 'lucide-react';
import { Robot } from './robot.jsx';
import { ThemeToggle } from './theme-toggle.jsx';
import { Button } from './ui/button.jsx';
import { useStore, go, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { AgentIcon } from './agent-icon.jsx';
import { newConversation } from '@/views/session.jsx';

function NavItem({ icon: Icon, iconEl, label, active, onClick, children, testid }) {
  return (
    <button data-testid={testid} onClick={onClick} className={cn('group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] transition-colors', active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground')}>
      {iconEl ?? (Icon ? <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </button>
  );
}

const statusDot = { running: 'bg-info animate-pulse', error: 'bg-destructive', idle: 'bg-success/70' };

export function Sidebar({ mood }) {
  const app = useStore((s) => s.app);
  const route = useStore((s) => s.route);
  const tasks = useStore((s) => s.tasks);
  const sessions = useStore((s) => s.sessions);
  const name = app.config.assistantName;
  const approvals = tasks.filter((t) => t.status === 'awaiting_approval').length;
  const running = tasks.filter((t) => t.status === 'running').length;
  const chats = sessions.filter((s) => s.kind === 'chat').slice(0, 40);
  const is = (view) => route.view === view;
  return (
    <aside className="bg-sidebar flex h-full w-64 shrink-0 flex-col border-r">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Robot size={34} mood={mood} title={name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{name}</div>
          <div className="text-muted-foreground truncate text-xs">{app.activeProject ? app.activeProject.name : 'Sin proyecto'}</div>
        </div>
        <ThemeToggle />
      </div>
      <div className="px-3 pb-2">
        <Button className="w-full justify-start" variant="outline" onClick={() => newConversation()} data-testid="new-conversation"><MessageSquarePlus />Nueva conversación</Button>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        <NavItem icon={Sparkles} label={name} active={is('chat')} onClick={() => go('chat')} testid="nav-chat">
          {app.chat?.busy ? <span className="bg-primary size-2 animate-pulse rounded-full" /> : null}
        </NavItem>
        <NavItem icon={ListTodo} label="Tareas" active={is('tasks')} onClick={() => go('tasks')} testid="nav-tasks">
          {approvals ? <span className="bg-warning text-white rounded-full px-1.5 text-[11px] font-medium" title="Esperan tu aprobación">{approvals}</span>
            : running ? <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px]">{running}</span> : null}
        </NavItem>
        <NavItem icon={FolderKanban} label="Proyectos" active={is('projects')} onClick={() => go('projects')} testid="nav-projects" />
        {/* Expert mode: PC only (wide screens), when turned on in Settings. */}
        {app.config.expert?.enabled && !bridge.mobile ? <div className="hidden lg:block"><NavItem icon={SquareTerminal} label="Modo experto" active={is('expert')} onClick={() => go('expert')} testid="nav-expert" /></div> : null}
        <div className="text-muted-foreground px-2.5 pt-5 pb-1.5 text-[11px] tracking-wide uppercase">Conversaciones</div>
        {chats.length ? chats.map((s) => (
          <NavItem key={s.id} iconEl={<AgentIcon agent={s.agent} className="size-3.5" />} label={s.title} active={is('session') && route.id === s.id} onClick={() => go({ view: 'session', id: s.id })}>
            <span className={cn('size-1.5 shrink-0 rounded-full', statusDot[s.status] ?? 'bg-muted-foreground/40')} />
          </NavItem>
        ))
          : <p className="text-muted-foreground px-2.5 text-xs leading-relaxed">Habla directamente con Claude, Codex o Cursor, como en T3 Code.</p>}
      </nav>
      <div className="flex flex-col gap-0.5 border-t px-3 py-2.5">
        {bridge.mobile ? null : <NavItem icon={Bot} label="Agentes" active={is('agents')} onClick={() => go('agents')} testid="nav-agents" />}
        <NavItem icon={BookOpen} label="Bitácoras" active={is('logs')} onClick={() => go('logs')} testid="nav-logs" />
        <NavItem icon={History} label="Actividad" active={is('activity')} onClick={() => go('activity')} testid="nav-activity" />
        {bridge.mobile ? null : <NavItem icon={Settings} label="Ajustes" active={is('settings')} onClick={() => go('settings')} testid="nav-settings" />}
      </div>
    </aside>
  );
}
