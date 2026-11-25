// "Prepara tu equipo": what is installed, and one click to install the rest with the official installers.
import { useEffect, useState } from 'react';
import { CircleAlert, GitBranch, Hexagon, LoaderCircle, Network, CodeXml, Sparkles, Bot, Zap } from 'lucide-react';
import { Badge } from './ui/basic.jsx';
import { ListCard, SectionLabel } from './ui/primitives.jsx';
import { Checkbox, BubbleTip } from './ui/overlay.jsx';
import { AgentIcon, GithubIcon } from './agent-icon.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';

// What the first run's «Prepara tu equipo» shows and does: what is installed, what is missing (marked by default unless
// it is optional) and the progress of the installer that is running. The engine's calls: installer.check / start / progress.
export function useInstaller() {
  const [items, setItems] = useState(null);
  const [chosen, setChosen] = useState({});
  const [progress, setProgress] = useState(null);
  const load = async () => {
    // the tools of the Agents page's other groups are not part of the first run
    const r = (await call('installer.check').catch(() => [])).filter((i) => !i.extra);
    setItems(r);
    setChosen(Object.fromEntries(r.map((i) => [i.id, !i.installed && !i.optional])));
  };
  useEffect(() => { load(); call('installer.progress').then((p) => p.steps.length && setProgress(p)).catch(quiet); return bridge.on('installer:progress', (p) => { setProgress(p); if (p.finished) load(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = Object.keys(chosen).filter((k) => chosen[k]);
  const start = async () => { const p = await act(call('installer.start', { ids })); if (p) setProgress(p); };
  return { items, chosen, setChosen, progress, load, ids, start, missing: (items ?? []).filter((i) => !i.installed) };
}

// The mock-up draws the agents with their own marks and everything else with a plain line icon.
const LINE_ICON = { git: GitBranch, node: Hexagon, tailscale: Network, gemini: Sparkles, copilot: Bot, opencode: CodeXml, qwen: Zap };
function RowMark({ id }) {
  if (id === 'gh') return <span className="text-muted-foreground grid size-6 flex-none place-items-center"><GithubIcon /></span>;
  const Icon = LINE_ICON[id];
  if (Icon) return <span className="text-muted-foreground grid size-6 flex-none place-items-center"><Icon className="size-4" aria-hidden="true" /></span>;
  return <span className="grid size-6 flex-none place-items-center"><AgentIcon agent={id} className="size-4" /></span>;
}

// The tools and agents as the mock-up draws them: one card of rows with hairlines, then «Opcionales» in its own card.
export function InstallRows({ items, chosen, setChosen, progress }) {
  const t = useT();
  const stepOf = (id) => progress?.steps.find((x) => x.id === id);
  const row = (i) => {
    const step = stepOf(i.id);
    const done = i.installed || step?.state === 'hecho';
    return (
      <label key={i.id} className={cn('border-border flex min-w-0 items-center gap-3 px-3.5 py-3 not-first:border-t', !done && 'hover:bg-accent/60 cursor-pointer')} data-testid={`install-row-${i.id}`}>
        <RowMark id={i.id} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="block truncate text-body font-medium">{i.label}{i.optional ? ` ${t('comp.installer.optional')}` : ''}</b>
          <span className="text-muted-foreground block truncate text-caption">{i.why}</span>
        </span>
        {step?.state === 'instalando' ? <Badge variant="info"><LoaderCircle className="animate-spin" />{t('comp.installer.installing')}</Badge>
          : step?.state === 'hecho' ? <Badge variant="success">{t('comp.installer.installed')}</Badge>
            : step?.state === 'error' ? <BubbleTip title={t('comp.installer.failed')} text={step.detail}><Badge variant="destructive" tabIndex={0}><CircleAlert />{t('comp.installer.failed')}</Badge></BubbleTip>
              : i.installed ? <Badge variant="success">{t('comp.installer.ready')}</Badge> : <Badge variant="secondary">{t('comp.installer.missing')}</Badge>}
        {/* the mock-up has no way to choose; the first run keeps its checkboxes (what to install), in a column of their own */}
        {done ? <span className="size-[18px] flex-none" aria-hidden="true" /> : <Checkbox checked={Boolean(chosen[i.id])} onCheckedChange={(c) => setChosen({ ...chosen, [i.id]: c === true })} aria-label={i.label} />}
      </label>
    );
  };
  const main = items.filter((i) => !i.optional);
  const extra = items.filter((i) => i.optional);
  return (
    <>
      <ListCard data-testid="install-list">{main.map(row)}</ListCard>
      {extra.length ? (
        <>
          <SectionLabel className="px-0 pt-1 pb-0 [margin-bottom:-6px]">{t('install.optionals')}</SectionLabel>
          <ListCard data-testid="install-optional">{extra.map(row)}</ListCard>
        </>
      ) : null}
    </>
  );
}

// The progress bar of an installation: finished steps count whole, the one installing counts half, so the bar moves as
// soon as a step starts. Underneath, a light phrase changes every few seconds while it works.
const FUN = 11;
const EVERY = 3200;

// The light phrase of the moment while `running`, and a counter that changes with it (a key to animate each new one).
export function useFunPhrase(running) {
  const t = useT();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setN((x) => x + 1), EVERY);
    return () => clearInterval(id);
  }, [running]);
  return { n, phrase: t(`install.fun.${(n % FUN) + 1}`) };
}

// Where an installation is: the sentence, the percent (only steps: no finer figure exists) and whether it failed.
function describe(progress, t) {
  const { steps } = progress;
  const ended = steps.filter((s) => s.state === 'hecho' || s.state === 'error').length;
  const now = steps.find((s) => s.state === 'instalando');
  const failed = steps.some((s) => s.state === 'error');
  const percent = progress.finished && !progress.interrupted ? 100 : Math.round(((ended + (now ? 0.5 : 0)) / steps.length) * 100);
  const line = progress.interrupted ? t('install.interrupted')
    : progress.finished ? t(failed ? 'install.doneErrors' : 'install.done')
      : now ? t('install.step', { label: now.label, n: steps.indexOf(now) + 1, total: steps.length })
        : ended ? t('install.progress', { n: ended, total: steps.length }) : t('install.starting');
  return { failed, percent, line };
}

// The progress card of the first run (the mock-up's .card with its bar): the sentence and the percent, the bar, the note.
export function InstallCard({ progress }) {
  const t = useT();
  const { failed, percent, line } = describe(progress, t);
  const bad = failed || progress.interrupted;
  return (
    <div className="bg-card border-border rounded-card border px-3 py-2.5" data-testid="install-progress">
      <div className="flex items-baseline gap-2">
        <b className={cn('min-w-0 flex-1 text-control font-medium', progress.finished && bad && 'text-destructive')} aria-live="polite">{line}</b>
        <span className="text-muted-foreground text-caption tabular-nums">{percent} %</span>
      </div>
      <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={line}>
        <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', bad ? 'bg-destructive' : 'bg-primary-text')} style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      {progress.running ? <p className="text-muted-foreground m-0 mt-2 text-control">{t('comp.installer.windowOpened')}</p> : null}
    </div>
  );
}

export function InstallProgress({ progress, fun = true }) {
  const t = useT();
  const { n, phrase } = useFunPhrase(progress.running && fun);
  const { failed, percent, line } = describe(progress, t);
  return (
    <div className="grid gap-2 pt-2" data-testid="install-progress">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={cn(progress.finished && (failed || progress.interrupted) && 'text-destructive', progress.finished && !failed && !progress.interrupted && 'text-success')}>{line}</span>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">{percent} %</span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={line}>
        <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', failed || progress.interrupted ? 'bg-destructive' : 'bg-primary-text')} style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      {progress.running && fun ? (
        <p key={n} className="text-muted-foreground animate-in fade-in slide-in-from-bottom-1 text-center text-sm italic duration-500" aria-live="polite" data-testid="install-fun">
          {phrase}…
        </p>
      ) : null}
    </div>
  );
}
