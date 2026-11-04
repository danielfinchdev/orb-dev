// 3.5: the menu of the Bots mode (the sidebar's body when «Bots» is chosen): its screens, then the user's bots and
// groups, each one opening its chat.
import { MessageSquare, Bot, Users, Bell, BookOpen, Home, Server, Settings2, Plus } from 'lucide-react';
import { NavItem } from './sidebar.jsx';
import { Button } from './ui/button.jsx';
import { useStore, go } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { useBots, useCanManage, BotFace, GroupFace, CentroBadge } from '@/views/bots/common.jsx';
import { SharedWithMe } from './share-dialog.jsx';

export const BOT_NAV = [
  ['bot-chat', MessageSquare, 'nav.botChat'], ['bots', Bot, 'nav.bots'], ['bot-groups', Users, 'nav.botGroups'], ['bot-reminders', Bell, 'nav.botReminders'],
  ['bot-memory', BookOpen, 'nav.botMemory'], ['bot-home', Home, 'nav.botHome'], ['bot-server', Server, 'nav.botServer'], ['bot-settings', Settings2, 'nav.botSettings']
];

export function BotsNav() {
  const t = useT();
  const route = useStore((s) => s.route);
  const { bots, groups, states } = useBots();
  const manage = useCanManage();
  const at = (view, id) => route.view === view && (id == null || Number(route.id) === id);
  const pending = bots.filter((b) => states[b.id]?.busy).length;
  return (
    <>
      <div className="flex items-center gap-2 px-3 pt-1 pb-2">
        {manage ? <Button className="min-w-0 flex-1 justify-start" variant="outline" onClick={() => go({ view: 'bots', id: 'new' })} data-testid="bots-nav-new"><Plus /><span className="truncate">{t('bots.new')}</span></Button> : null}
      </div>
      <CentroBadge className="px-4 pb-1" />
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3 pb-3" data-testid="bots-nav">
        {BOT_NAV.map(([view, Icon, label]) => (
          <NavItem key={view} icon={Icon} label={t(label)} active={view === 'bot-chat' ? route.view === 'bot-chat' && route.id == null : route.view === view && (view !== 'bots' || route.id == null)} onClick={() => go({ view })} testid={`nav-${view}`}>
            {view === 'bot-chat' && pending ? <span className="bg-primary size-1.5 animate-pulse rounded-full" /> : null}
          </NavItem>
        ))}
        {bots.length ? <div className="text-muted-foreground px-2.5 pt-4 pb-1 text-[11px] tracking-wide uppercase">{t('bots.yours')}</div> : null}
        {bots.map((b) => (
          <button key={b.id} type="button" onClick={() => go({ view: 'bot-chat', id: b.id })} data-testid={`side-bot-${b.name}`}
            className={cn('flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]', at('bot-chat', b.id) ? 'bg-accent text-accent-foreground' : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground', b.paused && 'opacity-60')}>
            <BotFace bot={b} size="sm" busy={Boolean(states[b.id]?.busy)} chief={b.is_chief} /><span className="min-w-0 flex-1 truncate">{b.name}</span>
          </button>
        ))}
        {groups.length ? <div className="text-muted-foreground px-2.5 pt-4 pb-1 text-[11px] tracking-wide uppercase">{t('nav.botGroups')}</div> : null}
        {/* 3.6: bots and groups other people shared with this one. */}
        <SharedWithMe kinds={['bot', 'group']} />
        {groups.map((g) => (
          <button key={g.id} type="button" onClick={() => go({ view: 'bot-group', id: g.id })} data-testid={`side-group-${g.name}`}
            className={cn('flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]', at('bot-group', g.id) ? 'bg-accent text-accent-foreground' : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground')}>
            <GroupFace group={g} bots={bots} size="sm" /><span className="min-w-0 flex-1 truncate">{g.name}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
