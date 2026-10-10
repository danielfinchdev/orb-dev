// "Prepara tu equipo": what is installed, and one click to install the rest with the official installers.
import { useEffect, useState } from 'react';
import { Download, RefreshCw, Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Badge, Spinner } from './ui/basic.jsx';
import { Checkbox } from './ui/overlay.jsx';
import { ToolIcon } from './agent-icon.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// bar=false: the screen around it shows the progress itself (the first run puts it in its title), told by onProgress.
export function Installer({ onChange, onProgress, bar = true }) {
  const t = useT();
  const [items, setItems] = useState(null);
  const [chosen, setChosen] = useState({});
  const [progress, setProgress] = useState(null);
  useEffect(() => { if (progress) onProgress?.(progress); }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = async () => {
    const r = await call('installer.check').catch(() => []);
    setItems(r);
    setChosen(Object.fromEntries(r.map((i) => [i.id, !i.installed && !i.optional])));
    onChange?.(r);
  };
  useEffect(() => { load(); call('installer.progress').then((p) => p.steps.length && setProgress(p)).catch(() => {}); return bridge.on('installer:progress', (p) => { setProgress(p); if (p.finished) load(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return <div className="flex items-center gap-2 text-sm"><Spinner />{t('comp.installer.checking')}</div>;
  const missing = items.filter((i) => !i.installed);
  const ids = Object.keys(chosen).filter((k) => chosen[k]);
  const stepOf = (id) => progress?.steps.find((s) => s.id === id);
  return (
    <div className="grid gap-2">
      {items.map((i) => {
        const step = stepOf(i.id);
        return (
          <label key={i.id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', !i.installed && 'cursor-pointer')}>
            {i.installed ? <Check className="text-success size-4" /> : <Checkbox checked={Boolean(chosen[i.id])} onCheckedChange={(c) => setChosen({ ...chosen, [i.id]: c === true })} />}
            <ToolIcon tool={i.id} className="size-5" />
            <div className="min-w-0 flex-1"><div className="text-sm">{i.label}{i.optional ? <span className="text-muted-foreground"> {t('comp.installer.optional')}</span> : null}</div><div className="text-muted-foreground text-xs">{i.why}</div></div>
            {step?.state === 'instalando' ? <Badge variant="info"><LoaderCircle className="animate-spin" />{t('comp.installer.installing')}</Badge>
              : step?.state === 'hecho' ? <Badge variant="success">{t('comp.installer.installed')}</Badge>
                : step?.state === 'error' ? <Badge variant="destructive" title={step.detail}><CircleAlert />{t('comp.installer.failed')}</Badge>
                  : i.installed ? <Badge variant="success">{t('comp.installer.ready')}</Badge> : <Badge variant="secondary">{t('comp.installer.missing')}</Badge>}
          </label>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {missing.length ? <Button size="sm" disabled={!ids.length || progress?.running} onClick={async () => { const p = await act(call('installer.start', { ids })); if (p) setProgress(p); }}><Download />{progress?.running ? t('comp.installer.installingBtn') : t('comp.installer.installMarked', { n: ids.length })}</Button> : <span className="text-success text-sm">{t('comp.installer.allReady')}</span>}
        <Button size="sm" variant="ghost" onClick={load}><RefreshCw />{t('comp.installer.check')}</Button>
      </div>
      {bar && progress?.steps.length ? <InstallProgress progress={progress} /> : null}
      {progress?.running ? <p className="text-muted-foreground text-xs">{t('comp.installer.windowOpened')}</p> : null}
    </div>
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

export function InstallProgress({ progress, fun = true }) {
  const t = useT();
  const { n, phrase } = useFunPhrase(progress.running && fun);
  const { steps } = progress;
  const ended = steps.filter((s) => s.state === 'hecho' || s.state === 'error').length;
  const now = steps.find((s) => s.state === 'instalando');
  const failed = steps.some((s) => s.state === 'error');
  const percent = progress.finished && !progress.interrupted ? 100 : Math.round(((ended + (now ? 0.5 : 0)) / steps.length) * 100);
  const line = progress.interrupted ? t('install.interrupted')
    : progress.finished ? t(failed ? 'install.doneErrors' : 'install.done')
      : now ? t('install.step', { label: now.label, n: steps.indexOf(now) + 1, total: steps.length })
        : ended ? t('install.progress', { n: ended, total: steps.length }) : t('install.starting');
  return (
    <div className="grid gap-2 pt-2" data-testid="install-progress">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={cn(progress.finished && (failed || progress.interrupted) && 'text-destructive', progress.finished && !failed && !progress.interrupted && 'text-success')}>{line}</span>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">{percent} %</span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={line}>
        <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', failed || progress.interrupted ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      {progress.running && fun ? (
        <p key={n} className="text-muted-foreground animate-in fade-in slide-in-from-bottom-1 text-center text-sm italic duration-500" aria-live="polite" data-testid="install-fun">
          {phrase}…
        </p>
      ) : null}
    </div>
  );
}
