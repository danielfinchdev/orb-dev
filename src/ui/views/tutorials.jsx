// Tutoriales. How the app works, in cards by subject (each with a button to the screen it talks about), the
// keyboard shortcuts and the frequently asked questions, all searchable; and the button that replays the robot's guided
// tour (components/tour.jsx). Texts: help.* in the locales.
import { useState } from 'react';
import { LifeBuoy, Search, Rocket, MessageSquare, Brain, MessageSquarePlus, ClipboardCheck, FolderGit2, Orbit, Gauge, CalendarSync, NotebookPen, Smartphone, SquareTerminal, Gamepad2, Palette, ShieldCheck, Presentation, Keyboard, CircleHelp, ChevronRight, Play, ArrowRight } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardHeader, CardTitle, CardContent, Empty, Input, Kbd } from '@/components/ui/basic.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { useStore, go, openSettings, openGames, startTour, bridge, newChat } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { SearchInput } from '@/components/ui/primitives.jsx';

// id: texts help.tut.<id>.title and .l1…lN (lines). go: the screen it talks about (pc: a button only on the PC).
const TUTORIALS = [
  { id: 'start', icon: Rocket, lines: 5, go: () => go('projects') },
  { id: 'chat', icon: MessageSquare, lines: 4, go: () => go('chat') },
  { id: 'brain', icon: Brain, lines: 5, go: () => go('chat') },
  { id: 'newchat', icon: MessageSquarePlus, lines: 4, go: () => newChat() },
  { id: 'tasks', icon: ClipboardCheck, lines: 6, go: () => go('tasks') },
  { id: 'sidebar', icon: FolderGit2, lines: 4, go: () => go('projects') },
  { id: 'board', icon: Presentation, lines: 3, go: () => go('board') },
  { id: 'agents', icon: Orbit, lines: 4, go: () => go('agents'), pc: true },
  { id: 'usage', icon: Gauge, lines: 3, go: () => openSettings('tareas'), pc: true },
  { id: 'schedules', icon: CalendarSync, lines: 3, go: () => go('schedules') },
  { id: 'logs', icon: NotebookPen, lines: 3, go: () => go('logs') },
  { id: 'phone', icon: Smartphone, lines: 3, go: () => openSettings('movil'), pc: true },
  { id: 'expert', icon: SquareTerminal, lines: 2, go: () => openSettings('experto'), pc: true },
  { id: 'games', icon: Gamepad2, lines: 2, go: () => openGames(), pc: true },
  { id: 'looks', icon: Palette, lines: 3, go: () => openSettings('apariencia'), pc: true },
  { id: 'privacy', icon: ShieldCheck, lines: 5 }
];
const PC_ONLY = new Set(['agents', 'usage', 'expert', 'games', 'looks']);
const KEYS = 8; // help.key.1…8
const FAQS = 17; // help.faq.1…17
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
// Search without accents or case: «bitacora» finds «Bitácoras».
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Tutorial({ item, t, name }) {
  const Icon = item.icon;
  const lines = range(item.lines).map((n) => t(`help.tut.${item.id}.l${n}`, { name }));
  const showGo = item.go && !(item.pc && bridge.mobile);
  return (
    <Card className="gap-3 py-4" data-testid={`tutorial-${item.id}`}>
      <CardHeader className="flex-row items-center gap-3">
        <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-xl"><Icon className="size-4.5" /></span>
        <CardTitle className="text-[15.5px]">{t(`help.tut.${item.id}.title`, { name })}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="text-foreground/85 grid list-disc gap-1.5 pl-4 text-[13.5px] leading-relaxed marker:text-primary/60">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </CardContent>
      {showGo ? <CardContent><Button size="sm" variant="outline" onClick={item.go}>{t(`help.tut.${item.id}.go`)}<ArrowRight /></Button></CardContent> : null}
    </Card>
  );
}

function Faq({ n, t, name }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="hover:bg-accent/50 flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left text-[14px] font-medium" data-testid={`faq-${n}`}>
        <ChevronRight className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">{t(`help.faq.${n}.q`, { name })}</span>
      </CollapsibleTrigger>
      <CollapsibleContent><p className="text-muted-foreground px-4 pb-3.5 pl-10.5 text-[13.5px] leading-relaxed">{t(`help.faq.${n}.a`, { name })}</p></CollapsibleContent>
    </Collapsible>
  );
}

export function TutorialsView() {
  const t = useT();
  const name = useStore((s) => s.app.config.assistantName);
  const [q, setQ] = useState('');
  const query = fold(q.trim());
  const hit = (...parts) => !query || parts.some((p) => fold(p).includes(query));
  // the phone leaves out what it does not have (agents, settings, expert mode, games, themes).
  const tutorials = TUTORIALS.filter((item) => !(bridge.mobile && PC_ONLY.has(item.id))).filter((item) => hit(t(`help.tut.${item.id}.title`, { name }), ...range(item.lines).map((n) => t(`help.tut.${item.id}.l${n}`, { name }))));
  const keys = bridge.mobile ? [] : range(KEYS).filter((n) => hit(t(`help.key.${n}.k`), t(`help.key.${n}.v`)));
  const faqs = range(FAQS).filter((n) => hit(t(`help.faq.${n}.q`, { name }), t(`help.faq.${n}.a`, { name })));
  const nothing = !tutorials.length && !keys.length && !faqs.length;
  const Section = ({ icon: Icon, title, children }) => (
    <section className="grid gap-3">
      <h2 className="flex items-center gap-2 text-[13px] font-medium tracking-wide uppercase"><Icon className="text-primary size-4" />{title}</h2>
      {children}
    </section>
  );
  return (
    <>
      <PageHeader icon={<LifeBuoy className="text-primary size-5" />} title={t('help.title')} meta={t('help.meta')}>
        <SearchInput value={q} onChange={setQ} placeholder={t('help.search')} data-testid="help-search" />
      </PageHeader>
      <PageBody className="px-5 py-5" data-testid="tutorials-view">
        <div className="mx-auto grid max-w-5xl gap-7">
          {bridge.mobile || query ? null : (
            <Card className="flex-row items-center gap-4 px-5 py-4" data-testid="tour-card">
              <Robot size={96} mood="hello" title={name} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{t('help.replayTitle')}</div>
                <p className="text-muted-foreground mt-0.5 text-[13px] leading-relaxed">{t('help.replayDesc', { name })}</p>
              </div>
              <Button onClick={startTour} data-testid="tour-replay"><Play />{t('help.replay')}</Button>
            </Card>
          )}
          {nothing ? <Empty icon={Search} title={t('help.noResults', { q: q.trim() })} /> : null}
          {tutorials.length ? (
            <Section icon={LifeBuoy} title={t('help.sec.tutorials')}>
              <div className="grid items-start gap-4 lg:grid-cols-2">{tutorials.map((item) => <Tutorial key={item.id} item={item} t={t} name={name} />)}</div>
            </Section>
          ) : null}
          {keys.length ? (
            <Section icon={Keyboard} title={t('help.sec.keys')}>
              <Card className="gap-0 py-1">
                {keys.map((n) => (
                  <div key={n} className="grid grid-cols-[minmax(9rem,auto)_1fr] items-center gap-3 border-b px-4 py-2.5 text-[13.5px] last:border-b-0">
                    <span className="flex flex-wrap gap-1">{t(`help.key.${n}.k`).split(' / ').map((k) => <Kbd key={k} className="h-6 text-[11px]">{k}</Kbd>)}</span>
                    <span className="text-foreground/85">{t(`help.key.${n}.v`)}</span>
                  </div>
                ))}
              </Card>
            </Section>
          ) : null}
          {faqs.length ? (
            <Section icon={CircleHelp} title={t('help.sec.faq')}>
              <Card className="gap-0 py-0">{faqs.map((n) => <Faq key={n} n={n} t={t} name={name} />)}</Card>
            </Section>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
