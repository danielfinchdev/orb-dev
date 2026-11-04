// 2.7, the phone: a simpler app. The sections are tabs at the bottom (3.6: Orbe, Chats, Tareas, Proyectos; the rest is in
// the menu ☰ of each screen's bar, components/mobile-menu.jsx) instead of the sidebar. What only makes sense on the PC
// (Agentes, Ajustes, Modo experto, minijuegos, the themes) is not here.
import { Sparkles, MessagesSquare, ListTodo, FolderKanban, Ellipsis, MessageSquare, Bot, Bell, Home } from 'lucide-react';
import { PageHeader } from './page.jsx';
import { useStore, go, modeOf } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { MoreContent } from './mobile-menu.jsx';
import { unreadOf } from '@/lib/inbox.js';

// Which tab a screen belongs to.
const TAB_OF = { chat: 'chat', session: 'chats', new: 'chats', chats: 'chats', tasks: 'tasks', projects: 'projects',
  // 3.5: the Bots mode has its own tabs (Chat, Bots, Recordatorios, Casa, Más)
  // 3.6 (M2): Chats · Recordatorios · Casa
  'bot-chats': 'bot-chats', 'bot-chat': 'bot-chats', 'bot-group': 'bot-chats', 'bot-reminders': 'bot-reminders', 'bot-home': 'bot-home' };
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
  const botsBusy = useStore((s) => Object.values(s.botStates ?? {}).some((x) => x.busy));
  const unread = useStore((s) => unreadOf(s.inbox));
  const tabs = modeOf(route) === 'bots' ? [
    { id: 'bot-chats', icon: MessagesSquare, label: t('nav.chats'), testid: 'nav-bot-chats', count: unread, tone: 'primary', dot: botsBusy },
    { id: 'bot-reminders', icon: Bell, label: t('nav.botReminders'), testid: 'nav-bot-reminders' },
    { id: 'bot-home', icon: Home, label: t('nav.botHome'), testid: 'nav-bot-home' }
  ] : [
    { id: 'chat', icon: Sparkles, label: app.config.assistantName, testid: 'nav-chat', dot: (app.chats ?? []).some((c) => c.busy) },
    { id: 'chats', icon: MessagesSquare, label: t('nav.chats'), testid: 'nav-chats', count: permissions, dot: working },
    { id: 'tasks', icon: ListTodo, label: t('nav.tasks'), testid: 'nav-tasks', count: approvals },
    { id: 'projects', icon: FolderKanban, label: t('nav.projects'), testid: 'nav-projects' }
  ];
  return (
    <nav className={cn('mobile-tabs theme-band bg-sidebar grid shrink-0 border-t', tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-4')} aria-label={t('app.menu')} data-testid="mobile-tabs">
      {tabs.map(({ id, icon: Icon, label, testid, count, dot, tone }) => {
        const active = current === id;
        return (
          <button key={id} type="button" onClick={() => go(id)} data-testid={testid} aria-current={active ? 'page' : undefined}
            className={cn('mobile-tab relative grid cursor-pointer justify-items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] font-medium transition-colors', active ? 'text-primary' : 'text-muted-foreground')}>
            <span className={cn('mobile-tab-icon grid h-7 w-12 place-items-center rounded-full transition-colors', active && 'bg-primary/12')}>
              <Icon className="size-5" />
            </span>
            <span className="max-w-full truncate">{label}</span>
            {count ? <span className={cn('absolute top-1 left-1/2 ml-2 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums', tone === 'primary' ? 'bg-primary text-primary-foreground' : 'bg-warning text-warning-foreground')} aria-label={String(count)} data-testid={`${testid}-count`}>{count > 99 ? '99+' : count}</span>
              : dot ? <span className="bg-primary absolute top-2 left-1/2 ml-3 size-2 animate-pulse rounded-full" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

// «Más» (3.6: its content is the menu ☰'s; the screen stays for an old saved route or link).
export function MoreView() {
  const t = useT();
  return (
    <>
      <PageHeader icon={<Ellipsis className="text-primary size-5" />} title={t('nav.more')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="mobile-more">
        <div className="mx-auto grid max-w-xl gap-4"><MoreContent /></div>
      </div>
    </>
  );
}
