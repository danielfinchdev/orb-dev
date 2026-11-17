// «Reanudar costará releer todo»: the notice over the message box of a Claude conversation that was left idle for a long
// time with a lot of context (src/shared/cold-session.mjs). Two ways out, none taken for the person: compact, or start afresh.
// The person can also dismiss it and write on; it does not come back for the same stop.
import { useEffect, useState } from 'react';
import { Snowflake, Shrink, SquarePen, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { coldSession, idleText } from '../../../shared/cold-session.mjs';
import { useT } from '@/lib/i18n.js';

const dismissed = new Set(); // `<conversation>:<last activity>`: what was already dismissed

export function ColdNotice({ id, agent, used, lastAt, busy, compacting, onCompact, onFresh }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [, redraw] = useState(0);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const { cold, minutes } = coldSession({ agent, used, lastAt, now, busy });
  const key = `${id}:${lastAt}`;
  if (!cold || dismissed.has(key)) return null;
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 bg-card absolute bottom-full left-3 z-10 mb-3 w-max max-w-[min(26rem,calc(100%-1.5rem))] rounded-2xl border px-4 py-3 shadow-lg" role="status" data-testid="cold-notice">
      <div className="flex items-start gap-3">
        <Snowflake className="text-primary-text mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium">{t('cold.title', { idle: idleText(minutes) })}</div>
          <p className="text-muted-foreground mt-0.5 text-control leading-snug">{t('cold.body')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={onCompact} disabled={compacting} data-testid="cold-compact">{compacting ? <Spinner className="size-3.5" /> : <Shrink />}{t('cold.compact')}</Button>
            <Button size="sm" variant="outline" onClick={onFresh} data-testid="cold-fresh"><SquarePen />{t('cold.fresh')}</Button>
          </div>
        </div>
        <button type="button" className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 cursor-pointer rounded p-1" onClick={() => { dismissed.add(key); redraw((n) => n + 1); }} aria-label={t('cold.dismiss')}><X className="size-3.5" /></button>
      </div>
    </div>
  );
}
