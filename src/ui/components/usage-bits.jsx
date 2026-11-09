// The pieces of the plans' usage shared by the usage panel of the context ring (session.jsx) and the usage page
// (views/usage.jsx): the bar, a window's name and when it resets.
import { cn } from '@/lib/utils.js';

// 1234 → «1k», 2_500_000 → «2.5M» (the context ring and the usage page).
export const shortTokens = (n) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n ?? 0));
export const toneOf = (pct) => (pct >= 85 ? 'text-destructive' : pct >= 60 ? 'text-warning' : 'text-primary');
// pace: 3.8.2, where an even use of the window would be now (a mark on the bar).
export function UsageBar({ pct, pace = null }) {
  return (
    <span className="bg-muted relative block h-1.5 overflow-hidden rounded-full">
      <span className={cn('block h-full rounded-full bg-current', toneOf(pct))} style={{ width: `${Math.min(100, Math.max(pct, 1))}%` }} />
      {pace != null ? <span className="bg-foreground/60 absolute top-0 h-full w-0.5" style={{ left: `calc(${Math.min(100, Math.max(pace, 0))}% - 1px)` }} data-testid="usage-pace" /> : null}
    </span>
  );
}
// «five_hour», «seven_day_opus», «300min»… in words.
export function windowLabel(t, w) {
  const s = String(w);
  const model = s.match(/seven_day_(\w+)/)?.[1];
  if (/five_hour|^300min$|^5h$/.test(s)) return t('session.usage.session');
  if (model) return t('session.usage.weeklyOf', { model: model[0].toUpperCase() + model.slice(1) });
  if (/seven_day|^10080min$/.test(s)) return t('session.usage.weekly');
  const min = Number(s.match(/^(\d+)min$/)?.[1]);
  if (min) return min % 1440 === 0 ? t('session.usage.days', { n: min / 1440 }) : t('session.usage.hours', { n: Math.round(min / 60) });
  return s;
}
export function resetText(t, locale, at) {
  if (!at) return '';
  const ms = at - Date.now();
  if (ms <= 0) return t('session.usage.resetNow');
  if (ms < 86_400_000) { const h = Math.floor(ms / 3_600_000); const m = Math.floor((ms % 3_600_000) / 60_000); return t('session.usage.resetIn', { time: h ? `${h} h ${m} min` : `${m} min` }); }
  return t('session.usage.resetOn', { when: new Date(at).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) });
}
