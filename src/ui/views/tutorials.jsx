// 2.6: Tutoriales. How the app works, in cards by subject (each with a button to the screen it talks about), the
// keyboard shortcuts and the frequently asked questions, all searchable; and the button that replays the robot's guided
// tour (components/tour.jsx). Texts: help.* in the locales.
import { useState } from 'react';
import { GraduationCap, Search, Rocket, MessageSquare, Brain, MessageSquarePlus, ListTodo, FolderKanban, Bot, Gauge, CalendarClock, BookOpen, Smartphone, SquareTerminal, Gamepad2, Palette, ShieldCheck, Keyboard, CircleHelp, ChevronRight, Play, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardHeader, CardTitle, CardContent, Empty, Input, Kbd } from '@/components/ui/basic.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { useStore, go, openSettings, openGames, startTour, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// id: texts help.tut.<id>.title and .l1…lN (lines). go: the screen it talks about (pc: a button only on the PC).
const TUTORIALS = [
  { id: 'start', icon: Rocket, lines: 4, go: () => go('projects') },
  { id: 'chat', icon: MessageSquare, lines: 4, go: () => go('chat') },
  { id: 'brain', icon: Brain, lines: 4, go: () => go('chat') },
  { id: 'newchat', icon: MessageSquarePlus, lines: 4, go: () => go('new') },
  { id: 'tasks', icon: ListTodo, lines: 5, go: () => go('tasks') },
  { id: 'sidebar', icon: FolderKanban, lines: 4, go: () => go('projects') },
  { id: 'agents', icon: Bot, lines: 4, go: () => go('agents'), pc: true },
  { id: 'usage', icon: Gauge, lines: 3, go: () => openSettings('tareas'), pc: true },
  { id: 'schedules', icon: CalendarClock, lines: 3, go: () => go('schedules') },
  { id: 'logs', icon: BookOpen, lines: 3, go: () => go('logs') },
  { id: 'phone', icon: Smartphone, lines: 3, go: () => openSettings('movil'), pc: true },
  { id: 'expert', icon: SquareTerminal, lines: 2, go: () => openSettings('experto'), pc: true },
  { id: 'games', icon: Gamepad2, lines: 2, go: () => openGames(), pc: true },
  { id: 'looks', icon: Palette, lines: 3, go: () => openSettings('apariencia'), pc: true },
  { id: 'privacy', icon: ShieldCheck, lines: 5 }
];
const KEYS = 8; // help.key.1…8
const FAQS = 14; // help.faq.1…14
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
  const tutorials = TUTORIALS.filter((item) => hit(t(`help.tut.${item.id}.title`, { name }), ...range(item.lines).map((n) => t(`help.tut.${item.id}.l${n}`, { name }))));
  const keys = range(KEYS).filter((n) => hit(t(`help.key.${n}.k`), t(`help.key.${n}.v`)));
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
      <PageHeader icon={<GraduationCap className="text-primary size-5" />} title={t('help.title')} meta={t('help.meta')}>
        <div className="relative"><Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" /><Input className="h-8 w-64 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('help.search')} aria-label={t('help.search')} data-testid="help-search" /></div>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5" data-testid="tutorials-view">
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
            <Section icon={GraduationCap} title={t('help.sec.tutorials')}>
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
      </div>
    </>
  );
}
