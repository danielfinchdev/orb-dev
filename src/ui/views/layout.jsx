// 3.8: «Ordenar carpetas»: the folders an earlier Orb kept at the top of the workspace (bitacora, android\adb-tools,
// each server in mcp-servers) and what to do with each. Nothing moves until «Aplicar» (src/core/core-folder.mjs ›
// applyLayout); a folder some program is using stops it all with a clear message and «Reintentar». Shown after the
// welcome and when an updated Orb finds them (main.jsx, phase 'layout'). 3.8.1: when the logs went into core, a last
// screen says once where they are now (other tools, like the user's AGENTS.md or CLAUDE.md, must point there).
import { useState } from 'react';
import { ArrowRight, Copy, RotateCw } from 'lucide-react';
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
  const [moved, setMoved] = useState(null); // { dir, files }: the logs, now in core
  const apply = async (all) => {
    setBusy(true); setError('');
    try { const r = await bridge.call('app.layoutApply', { choices: all ?? choices }); if (r?.logsMoved) setMoved(r.logsMoved); else onDone(); }
    catch (e) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  if (moved) return <LogsMoved moved={moved} onDone={onDone} />;
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
                {it.kind === 'logs' ? <div className="text-muted-foreground text-xs" data-testid="layout-logs-note">{t('layout.logsNote')}</div> : null}
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

// The logs are in core now: their exact new place, and what to change outside Orb.
function LogsMoved({ moved, onDone }) {
  const t = useT();
  const files = moved.files?.length ? moved.files : [moved.dir];
  const copy = (p) => navigator.clipboard?.writeText(p).catch(() => {});
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6" data-testid="layout-logs-moved">
      <div className="grid w-full max-w-xl gap-4">
        <div className="flex justify-center"><Robot size={80} mood="happy" /></div>
        <div className="text-center">
          <h1 className="text-xl">{t('layout.logsMovedTitle')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('layout.logsMovedIntro')}</p>
        </div>
        <div className="grid gap-2">
          {files.map((f) => (
            <div key={f} className="grid gap-1 rounded-lg border px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 font-mono text-xs break-all" data-testid="layout-logs-path">{f}</span>
                <Button variant="ghost" size="icon" title={t('layout.copyPath')} aria-label={t('layout.copyPath')} onClick={() => copy(f)}><Copy /></Button>
              </div>
              {moved.readOnly?.includes(f) ? <span className="text-muted-foreground text-xs" data-testid="layout-logs-readonly">{t('layout.logsReadOnly')}</span> : null}
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">{t('layout.logsMovedNote')}</p>
        <div className="flex justify-center"><Button onClick={onDone} data-testid="layout-logs-ok"><ArrowRight />{t('layout.continue')}</Button></div>
      </div>
    </div>
  );
}
