// Tutoriales. How the app works, in guides by subject (each opens to its steps and a button to the screen it talks
// about), the keyboard shortcuts and the frequently asked questions, all searchable; and the button that replays the
// robot's guided tour (components/tour.jsx), also in the header's «⋯». Texts: help.* in the locales.
import { useState } from 'react';
import { SearchX, Rocket, MessageSquare, Brain, MessagesSquare, ListChecks, PanelLeft, Bot, Gauge, CalendarClock, NotebookPen, Smartphone, SquareTerminal, Gamepad2, Palette, ShieldCheck, PencilRuler, Keyboard, CircleHelp, ChevronDown, Play, ArrowRight, Route, BookOpen, Info, Lightbulb, Workflow, PanelTop, GitBranch, Users, Mic, Trash2, TabletSmartphone } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Kbd } from '@/components/ui/basic.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, BubbleTip } from '@/components/ui/overlay.jsx';
import { useStore, go, openSettings, openGames, startTour, bridge, newChat } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { SearchInput, MoreButton } from '@/components/ui/primitives.jsx';

// id: texts help.tut.<id>.title and .l1…lN (lines). go: the screen it talks about (pc: a button only on the PC).
const TUTORIALS = {
  start: { icon: Rocket, lines: 5, go: () => go('projects') },
  chat: { icon: MessageSquare, lines: 4, go: () => go('chat') },
  brain: { icon: Brain, lines: 5, go: () => go('chat') },
  reasoning: { icon: Lightbulb, lines: 6, go: () => go('chat') },
  orchestrator: { icon: Workflow, lines: 6, go: () => go('chat') },
  newchat: { icon: MessagesSquare, lines: 4, go: () => newChat() },
  tabs: { icon: PanelTop, lines: 5, go: () => openSettings('apariencia'), pc: true },
  copy: { icon: GitBranch, lines: 9, go: () => go('chat'), pc: true },
  tasks: { icon: ListChecks, lines: 6, go: () => go('tasks') },
  sidebar: { icon: PanelLeft, lines: 7, go: () => go('projects') },
  board: { icon: PencilRuler, lines: 3, go: () => go('board') },
  agents: { icon: Bot, lines: 6, go: () => go('agents'), pc: true },
  accounts: { icon: Users, lines: 6, go: () => go('agents'), pc: true },
  usage: { icon: Gauge, lines: 7, go: () => go({ view: 'usage' }), pc: true },
  schedules: { icon: CalendarClock, lines: 4, go: () => go('schedules') },
  logs: { icon: NotebookPen, lines: 6, go: () => go('logs') },
  phone: { icon: Smartphone, lines: 7, go: () => openSettings('movil'), pc: true },
  android: { icon: TabletSmartphone, lines: 6, go: () => openSettings('movil'), pc: true },
  dictation: { icon: Mic, lines: 7, go: () => openSettings('general'), pc: true },
  expert: { icon: SquareTerminal, lines: 3, go: () => openSettings('experto'), pc: true },
  games: { icon: Gamepad2, lines: 6, go: () => openGames(), pc: true },
  looks: { icon: Palette, lines: 4, go: () => openSettings('apariencia'), pc: true },
  privacy: { icon: ShieldCheck, lines: 6 },
  reset: { icon: Trash2, lines: 10, go: () => openSettings('datos'), pc: true }
};
// The three columns of the accordion, as drawn in the mock-up: one column does not stretch when its neighbour opens.
const COLUMNS = [
  ['start', 'chat', 'newchat', 'sidebar', 'tabs', 'board', 'schedules', 'logs'],
  ['brain', 'reasoning', 'orchestrator', 'copy', 'tasks', 'usage', 'agents', 'accounts'],
  ['phone', 'android', 'dictation', 'expert', 'games', 'looks', 'privacy', 'reset']
];
const PC_ONLY = new Set(['tabs', 'copy', 'agents', 'accounts', 'usage', 'android', 'dictation', 'expert', 'games', 'looks', 'reset']);
const KEYS = 16; // help.key.1…16
const FAQS = 21; // help.faq.1…21
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
// Search without accents or case: «bitacora» finds «Bitácoras».
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Tutorial({ id, item, t, name, defaultOpen }) {
  const Icon = item.icon;
  const [open, setOpen] = useState(!!defaultOpen);
  const lines = range(item.lines).map((n) => t(`help.tut.${id}.l${n}`, { name }));
  const showGo = item.go && !(item.pc && bridge.mobile);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="bg-card border-border rounded-card overflow-hidden border" data-testid={`tutorial-${id}`}>
      <CollapsibleTrigger className="hover:bg-accent/60 flex min-h-13 w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left">
        <span className="bg-primary-soft text-primary-text grid size-8 shrink-0 place-items-center rounded-ctl"><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1 text-control font-medium">{t(`help.tut.${id}.title`, { name })}</span>
        <ChevronDown className={cn('text-faint-foreground size-4 shrink-0 transition-transform duration-150', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-border border-t px-3.5 pt-0.5 pb-3 text-control leading-[1.55]">
          <ol className="text-muted-foreground mt-2.5 flex list-decimal flex-col gap-1.5 pl-4.5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
          {showGo ? <div className="mt-3 flex justify-end"><Button size="sm" variant="outline" onClick={item.go}>{t(`help.tut.${id}.go`)}<ArrowRight /></Button></div> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Faq({ n, t, name }) {
  const [open, setOpen] = useState(n === 1);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-border border-t first:border-t-0">
      <CollapsibleTrigger className="hover:bg-accent/60 flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-3.5 text-left text-control" data-testid={`faq-${n}`}>
        <CircleHelp className="text-faint-foreground size-4 shrink-0" />
        <span className="min-w-0 flex-1 font-medium">{t(`help.faq.${n}.q`, { name })}</span>
        <ChevronDown className={cn('text-faint-foreground size-4 shrink-0 transition-transform duration-150', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent><p className="text-muted-foreground px-3.5 pb-3 pl-10 text-control leading-[1.55]">{t(`help.faq.${n}.a`, { name })}</p></CollapsibleContent>
    </Collapsible>
  );
}

function Section({ icon: Icon, title, count, children }) {
  return (
    <section className="mt-1 grid gap-1.5">
      <div className="sec-h flex items-center gap-2">
        <Icon className="text-muted-foreground size-4" />
        <h2 className="font-(family-name:--title) text-card-title leading-[1.45] font-semibold">{title}</h2>
        {count != null ? <span className="text-faint-foreground text-caption">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function TutorialsView() {
  const t = useT();
  const name = useStore((s) => s.app.config.assistantName);
  const [q, setQ] = useState('');
  const query = fold(q.trim());
  const hit = (...parts) => !query || parts.some((p) => fold(p).includes(query));
  // the phone leaves out what only the PC has (agents, accounts, usage, tabs, separate copies, dictation, expert mode, games, themes, reset).
  const visible = (id) => !(bridge.mobile && PC_ONLY.has(id)) && hit(t(`help.tut.${id}.title`, { name }), ...range(TUTORIALS[id].lines).map((n) => t(`help.tut.${id}.l${n}`, { name })));
  const columns = COLUMNS.map((ids) => ids.filter(visible));
  const total = columns.reduce((n, c) => n + c.length, 0);
  const keys = bridge.mobile ? [] : range(KEYS).filter((n) => hit(t(`help.key.${n}.k`), t(`help.key.${n}.v`)));
  const faqs = range(FAQS).filter((n) => hit(t(`help.faq.${n}.q`, { name }), t(`help.faq.${n}.a`, { name })));
  const nothing = !total && !keys.length && !faqs.length;
  return (
    <>
      <PageHeader title={t('help.title')} meta={t('help.meta')}>
        <NotificationBell />
        {bridge.mobile ? null : (
          <DropdownMenu modal={false}>
            <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton label={t('nav.more')} data-testid="tutorials-more" /></DropdownMenuTrigger></BubbleTip>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={startTour} data-testid="tour-replay-menu"><Play />{t('help.replay')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeader>
      <PageBody data-testid="tutorials-view">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
          {bridge.mobile || query ? null : (
            <div className="bg-card border-border rounded-card flex items-center gap-3.5 border px-4 py-3.5" data-testid="tour-card">
              <span className="bg-primary-soft text-primary-text grid size-10 shrink-0 place-items-center rounded-ctl"><Route className="size-4" /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <b className="font-(family-name:--title) text-card-title leading-[1.45] font-semibold">{t('help.replayTitle')}</b>
                <span className="text-muted-foreground text-control leading-[1.45]">{t('help.replayDesc', { name })}</span>
              </div>
              <Button onClick={startTour} data-testid="tour-replay"><Play />{t('help.replay')}</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <SearchInput value={q} onChange={setQ} placeholder={t('help.search')} className="w-[360px]" data-testid="help-search" />
          </div>
          {nothing ? (
            <div className="text-muted-foreground flex flex-col items-center gap-1.5 px-6 py-12 text-center" data-testid="help-empty">
              <SearchX className="text-faint-foreground size-6" />
              <b className="text-foreground font-(family-name:--title) text-card-title font-semibold">{t('help.noResults', { q: q.trim() })}</b>
              <span>{t('help.noResultsHint')}</span>
            </div>
          ) : null}
          {total ? (
            <Section icon={BookOpen} title={t('help.sec.tutorials')} count={t('help.guideCount', { n: total })}>
              <div className="grid items-start gap-2 min-[901px]:grid-cols-3">
                {columns.map((ids, i) => ids.length ? (
                  <div key={i} className="flex flex-col gap-2">{ids.map((id) => <Tutorial key={id} id={id} item={TUTORIALS[id]} t={t} name={name} defaultOpen={id === 'start' && !query} />)}</div>
                ) : null)}
              </div>
              <p className="text-faint-foreground flex items-center gap-1.5 text-caption"><Info className="size-4 shrink-0" />{t('help.guidesNote')}</p>
            </Section>
          ) : null}
          {keys.length ? (
            <Section icon={Keyboard} title={t('help.sec.keys')}>
              <div className="bg-card border-border rounded-card grid overflow-hidden border px-3.5 py-1 min-[901px]:grid-cols-2 min-[901px]:gap-x-6">
                {keys.map((n, i) => (
                  <div key={n} className={cn('border-border flex items-center gap-3 border-t py-2 text-control', i < 2 ? 'min-[901px]:border-t-0' : '', i === 0 && 'border-t-0')}>
                    <span className="flex w-[150px] shrink-0 flex-wrap gap-1">{t(`help.key.${n}.k`).split(' / ').map((k) => <Kbd key={k} className="h-auto px-1.5 py-0.5 text-caption">{k}</Kbd>)}</span>
                    <span className="text-muted-foreground min-w-0">{t(`help.key.${n}.v`)}</span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
          {faqs.length ? (
            <Section icon={CircleHelp} title={t('help.sec.faq')} count={faqs.length}>
              <div className="bg-card border-border rounded-card overflow-hidden border">{faqs.map((n) => <Faq key={n} n={n} t={t} name={name} />)}</div>
            </Section>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
