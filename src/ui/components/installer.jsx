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

export function Installer({ onChange }) {
  const t = useT();
  const [items, setItems] = useState(null);
  const [chosen, setChosen] = useState({});
  const [progress, setProgress] = useState(null);
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
      {progress?.running ? <p className="text-muted-foreground text-xs">{t('comp.installer.windowOpened')}</p> : null}
    </div>
  );
}
