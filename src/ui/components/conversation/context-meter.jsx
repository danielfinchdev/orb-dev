// How full a conversation's context is (the ring by the message box), shared by the chat and an agent's conversation.
import { useEffect, useState } from 'react';
import { RefreshCw, Gauge } from 'lucide-react';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Spinner } from '@/components/ui/basic.jsx';
import { Tip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { useT, t, useLocale } from '@/lib/i18n.js';
import { reloadWait, markReloaded } from '@/lib/usage-reload.js';
import { UsageBar, windowLabel, resetText, toneOf, shortTokens } from '@/components/usage-bits.jsx';

// How full the agent's context window is (when the agent reports it).
// 2.6: how full the conversation is, as a ring that fills up (no number); a click opens the panel with the context in
// tokens and the limits of the plans working right now (the brain's and the agents' accounts: session, weekly…).
function Ring({ pct, className }) {
  const r = 7; const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className={cn('size-[18px] -rotate-90', className)} aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(pct, 2) / 100)} className="transition-[stroke-dashoffset] duration-500" />
    </svg>
  );
}
function UsagePanel({ context, pct }) {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const [rows, setRows] = useState(null);
  useEffect(() => { let alive = true; call('usage.now').then((r) => alive && setRows(r)).catch(() => alive && setRows([])); return () => { alive = false; }; }, [version]);
  // 3.8.2: «Recargar»: the agents ask their plan now; a spinner meanwhile, and again only after 20 s (lib/usage-reload.js).
  const [reloading, setReloading] = useState(false);
  const [wait, setWait] = useState(() => reloadWait());
  useEffect(() => { if (!wait) return undefined; const id = setTimeout(() => setWait(reloadWait()), wait); return () => clearTimeout(id); }, [wait]);
  const reload = async () => {
    if (reloading || reloadWait()) return;
    setReloading(true); markReloaded();
    try { const r = await act(call('usage.refresh')); if (r) setRows(r); }
    finally { setReloading(false); setWait(reloadWait()); }
  };
  return (
    <div className="grid w-80 gap-3 p-2.5 text-[13px]" data-testid="usage-panel">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{t('session.usage.context')}</span><span className="ml-auto tabular-nums">{shortTokens(context.used)} / {shortTokens(context.size)} ({pct} %)</span>
          <Tip label={t('session.usage.reload')}><Button size="icon-sm" variant="ghost" className="size-6" onClick={reload} disabled={reloading || wait > 0} aria-label={t('session.usage.reload')} aria-busy={reloading} data-testid="usage-reload">{reloading ? <Spinner className="size-3" /> : <RefreshCw className="size-3.5" />}</Button></Tip></div>
        <UsageBar pct={pct} />
        <p className="text-muted-foreground text-xs leading-snug">{t('session.contextTip')}</p>
      </div>
      {rows === null ? <Spinner className="size-3" /> : rows.map((u) => (
        <div key={u.account} className="grid gap-2 border-t pt-3">
          <div className="flex items-center gap-2 font-medium"><AgentIcon agent={u.agent} className="size-4" />{AGENT[u.agent] ?? u.agent}{u.label && u.label !== (AGENT[u.agent] ?? u.agent) ? <span className="text-muted-foreground truncate font-normal">· {u.label}</span> : null}{u.brain ? <Badge variant="outline" className="ml-auto">{t('session.usage.brain')}</Badge> : null}</div>
          {u.windows.length ? u.windows.map((w) => {
            const p = Math.round((w.utilization ?? 0) * 100);
            return (
              <div key={w.window} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3"><span className="truncate">{windowLabel(t, w.window)}</span><span className="tabular-nums">{p} %</span></div>
                <UsageBar pct={p} />
                {w.resetAt ? <span className="text-muted-foreground text-xs">{resetText(t, locale, w.resetAt)}</span> : null}
              </div>
            );
          }) : <p className="text-muted-foreground text-xs leading-snug">{t('session.usage.noData')}</p>}
        </div>
      ))}
      {/* 3.8.2: the whole usage page (cost and tokens by day, agent and model). */}
      <DropdownMenuItem className="border-t pt-2.5" onSelect={() => go({ view: 'usage' })} data-testid="usage-page"><Gauge />{t('usage.open')}</DropdownMenuItem>
    </div>
  );
}
export function ContextMeter({ context, className }) {
  const t = useT();
  if (!context?.size) return null;
  const pct = Math.min(100, Math.round((context.used / context.size) * 100));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('hover:bg-accent inline-grid size-7 cursor-pointer place-items-center rounded-full', toneOf(pct), className)} aria-label={t('session.usage.open', { pct })} data-testid="context-meter"><Ring pct={pct} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-auto p-0"><UsagePanel context={context} pct={pct} /></DropdownMenuContent>
    </DropdownMenu>
  );
}
