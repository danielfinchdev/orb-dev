// 3.8: «Ordenar carpetas»: the folders an earlier Orb kept at the top of the workspace (bitacora, android\adb-tools,
// each server in mcp-servers) and what to do with each. Nothing moves until «Aplicar» (src/core/core-folder.mjs ›
// applyLayout); a folder some program is using stops it all with a clear message and «Reintentar». Shown after the
// welcome and when an updated Orb finds them (main.jsx, phase 'layout').
import { useState } from 'react';
import { ArrowRight, RotateCw } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { Select } from '@/components/ui/overlay.jsx';
import { bridge } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { layoutOptions, layoutTitle } from '@/lib/core-access.js';

export function LayoutReview({ plan, onDone }) {
  const t = useT();
  const items = (plan?.items ?? []).filter((it) => !it.kept);
  const [choices, setChoices] = useState(() => Object.fromEntries(items.map((it) => [it.id, it.choice])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = async (all) => {
    setBusy(true); setError('');
    try { await bridge.call('app.layoutApply', { choices: all ?? choices }); onDone(); }
    catch (e) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  const toCore = items.some((it) => ['move', 'mcp'].includes(choices[it.id]));
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6" data-testid="layout-review">
      <div className="grid w-full max-w-xl gap-4">
        <div className="flex justify-center"><Robot size={80} mood={busy ? 'thinking' : 'hello'} /></div>
        <div className="text-center">
          <h1 className="text-xl">{t('layout.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('layout.intro', { home: plan?.home ?? '' })}</p>
        </div>
        <div className="grid gap-2">
          {items.map((it) => (
            <div key={it.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border px-3 py-2" data-testid={`layout-item-${it.id}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{t(layoutTitle(it))}</div>
                <div className="text-muted-foreground truncate font-mono text-xs">{it.name}</div>
                {it.project ? <div className="text-muted-foreground text-xs">{t('layout.mcpProject')}</div> : null}
              </div>
              <Select className="w-full sm:w-56" value={choices[it.id]} disabled={busy} onValueChange={(v) => setChoices({ ...choices, [it.id]: v })}
                options={layoutOptions(it).map((o) => ({ value: o.value, label: t(o.key, o.vars) }))} data-testid={`layout-choice-${it.id}`} />
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">{toCore ? `${t('layout.coreNote')} ` : ''}{t('layout.pathsNote')}</p>
        {error ? <p className="text-destructive text-sm" role="alert" data-testid="layout-error">{error}</p> : null}
        <div className="flex flex-wrap justify-center gap-2">
          <Button disabled={busy} onClick={() => apply()} data-testid="layout-apply">{busy ? <Spinner /> : error ? <RotateCw /> : <ArrowRight />}{t(error ? 'layout.retry' : 'layout.apply')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => apply(Object.fromEntries(items.map((it) => [it.id, 'keep'])))} data-testid="layout-keep-all">{t('layout.keepAll')}</Button>
        </div>
      </div>
    </div>
  );
}
