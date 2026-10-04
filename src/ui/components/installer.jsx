// "Prepara tu equipo": what is installed, and one click to install the rest with the official installers.
import { useEffect, useState } from 'react';
import { Download, RefreshCw, Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Badge, Spinner } from './ui/basic.jsx';
import { Checkbox } from './ui/overlay.jsx';
import { ToolIcon } from './agent-icon.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';

export function Installer({ onChange }) {
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
  if (!items) return <div className="flex items-center gap-2 text-sm"><Spinner />Comprobando qué tienes instalado…</div>;
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
            <div className="min-w-0 flex-1"><div className="text-sm">{i.label}{i.optional ? <span className="text-muted-foreground"> (opcional)</span> : null}</div><div className="text-muted-foreground text-xs">{i.why}</div></div>
            {step?.state === 'instalando' ? <Badge variant="info"><LoaderCircle className="animate-spin" />Instalando</Badge>
              : step?.state === 'hecho' ? <Badge variant="success">Instalado</Badge>
                : step?.state === 'error' ? <Badge variant="destructive" title={step.detail}><CircleAlert />Falló</Badge>
                  : i.installed ? <Badge variant="success">Listo</Badge> : <Badge variant="secondary">Falta</Badge>}
          </label>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {missing.length ? <Button size="sm" disabled={!ids.length || progress?.running} onClick={async () => { const p = await act(call('installer.start', { ids })); if (p) setProgress(p); }}><Download />{progress?.running ? 'Instalando…' : `Instalar lo marcado (${ids.length})`}</Button> : <span className="text-success text-sm">Todo listo.</span>}
        <Button size="sm" variant="ghost" onClick={load}><RefreshCw />Comprobar</Button>
      </div>
      {progress?.running ? <p className="text-muted-foreground text-xs">Se ha abierto una ventana de instalación: sigue ahí lo que pasa y acepta si Windows pregunta. Después inicia sesión en cada agente desde «Agentes».</p> : null}
    </div>
  );
}
