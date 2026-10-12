// 2.7, the phone: a simpler app. The sections are tabs at the bottom (Orbe, Chats, Tareas, Proyectos, Más) instead of the
// sidebar; «Más» holds the screens to look things up and the phone's own options. What only makes sense on the PC
// (Agentes, Ajustes, Modo experto, minijuegos, the themes) is not here.
import { Sparkles, MessagesSquare, ListTodo, FolderKanban, Ellipsis, CalendarClock, PenTool, BookOpen, History, GraduationCap, Smartphone, Moon } from 'lucide-react';
import { NavItem } from './sidebar.jsx';
import { PageHeader } from './page.jsx';
import { Switch } from './ui/overlay.jsx';
import { useStore, go, applyTheme, isDark } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { useState } from 'react';

// Which tab a screen belongs to.
const TAB_OF = { chat: 'chat', session: 'chats', new: 'chats', chats: 'chats', tasks: 'tasks', projects: 'projects' };
export const tabOf = (view) => TAB_OF[view] ?? 'more';

export function MobileTabs() {
  const t = useT();
  const route = useStore((s) => s.route);
  const app = useStore((s) => s.app);
  const tasks = useStore((s) => s.tasks);
  const sessions = useStore((s) => s.sessions);
  const approvals = tasks.filter((x) => x.status === 'awaiting_approval').length;
  const permissions = (app.approvals ?? []).length;
  const working = sessions.some((s) => s.kind === 'chat' && s.status === 'running');
  const current = tabOf(route.view);
  const tabs = [
    { id: 'chat', icon: Sparkles, label: app.config.assistantName, testid: 'nav-chat', dot: (app.chats ?? []).some((c) => c.busy) },
    { id: 'chats', icon: MessagesSquare, label: t('nav.chats'), testid: 'nav-chats', count: permissions, dot: working },
    { id: 'tasks', icon: ListTodo, label: t('nav.tasks'), testid: 'nav-tasks', count: approvals },
    { id: 'projects', icon: FolderKanban, label: t('nav.projects'), testid: 'nav-projects' },
    { id: 'more', icon: Ellipsis, label: t('nav.more'), testid: 'nav-more' }
  ];
  return (
    <nav className="mobile-tabs theme-band bg-sidebar grid shrink-0 grid-cols-5 border-t" aria-label={t('app.menu')} data-testid="mobile-tabs">
      {tabs.map(({ id, icon: Icon, label, testid, count, dot }) => {
        const active = current === id;
        return (
          <button key={id} type="button" onClick={() => go(id)} data-testid={testid} aria-current={active ? 'page' : undefined}
            className={cn('mobile-tab relative grid cursor-pointer justify-items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] font-medium transition-colors', active ? 'text-primary' : 'text-muted-foreground')}>
            <span className={cn('mobile-tab-icon grid h-7 w-12 place-items-center rounded-full transition-colors', active && 'bg-primary/12')}>
              <Icon className="size-5" />
            </span>
            <span className="max-w-full truncate">{label}</span>
            {count ? <span className="bg-warning absolute top-1 left-1/2 ml-2 min-w-4 rounded-full px-1 text-[10px] leading-4 text-white" aria-label={String(count)}>{count}</span>
              : dot ? <span className="bg-primary absolute top-2 left-1/2 ml-3 size-2 animate-pulse rounded-full" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

// «Más»: the screens to look things up and the phone's own options (day / night, kept on this phone).
export function MoreView() {
  const t = useT();
  const [dark, setDark] = useState(isDark);
  const night = (on) => { const next = on ? 'oscuro' : 'claro'; applyTheme(next); setDark(on); try { localStorage.setItem('orb.theme', next); } catch { /* storage unavailable */ } };
  return (
    <>
      <PageHeader icon={<Ellipsis className="text-primary size-5" />} title={t('nav.more')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="mobile-more">
        <div className="mx-auto grid max-w-xl gap-4">
          <div className="bg-card/80 grid gap-0.5 rounded-2xl border p-2">
            <NavItem icon={CalendarClock} label={t('nav.schedules')} onClick={() => go('schedules')} testid="nav-schedules" />
            <NavItem icon={PenTool} label={t('nav.board')} onClick={() => go('board')} testid="nav-board" />
            <NavItem icon={BookOpen} label={t('nav.logs')} onClick={() => go('logs')} testid="nav-logs" />
            <NavItem icon={History} label={t('nav.activity')} onClick={() => go('activity')} testid="nav-activity" />
            <NavItem icon={GraduationCap} label={t('nav.tutorials')} onClick={() => go('tutorials')} testid="nav-tutorials" />
          </div>
          <div className="bg-card/80 grid gap-0.5 rounded-2xl border p-2">
            <NavItem icon={Smartphone} label={t('nav.phone')} onClick={() => go('phone')} testid="nav-phone" />
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[14px]">
              <Moon className="text-muted-foreground size-4 shrink-0" /><span className="flex-1">{t('nav.darkMode')}</span>
              <Switch checked={dark} onCheckedChange={night} data-testid="mobile-dark" />
            </label>
          </div>
        </div>
      </div>
    </>
  );
}
