// 3.8.2: «Uso», the whole usage page (reached from the usage panel of the context ring and from Ctrl+K): cost and tokens
// by day, agent and model in the last 7, 30 or 90 days (usage.history), and each account's plan limits with the mark of
// an even pace (usage.get). The panel stays as it was; this page only adds detail.
import { useEffect, useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { UsageBar, windowLabel, resetText, shortTokens } from '@/components/usage-bits.jsx';
import { Card, Empty, Spinner } from '@/components/ui/basic.jsx';
import { Tabs, TabsList, TabsTrigger, Tip } from '@/components/ui/overlay.jsx';
import { useStore, call } from '@/lib/store.js';
import { paceOf } from '@/lib/usage-pace.js';
import { AGENT } from '@/lib/labels.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const usd = (n, locale) => `$${Number(n ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokens = shortTokens;

function Stat({ label, value, detail }) {
  return (
    <Card className="gap-1 py-4">
      <div className="text-muted-foreground px-5 text-xs">{label}</div>
      <div className="mt-auto px-5 text-xl font-medium tabular-nums">{value}</div>
      {detail ? <div className="text-muted-foreground px-5 text-xs tabular-nums">{detail}</div> : null}
    </Card>
  );
}

// One bar a day: the cost when the agents report it, else the tokens.
function Days({ days, metric, locale }) {
  const t = useT();
  const value = (d) => (metric === 'usd' ? d.usd : d.tokensIn + d.tokensOut);
  const max = Math.max(...days.map(value), 0);
  return (
    <div className="flex h-36 items-end gap-[2px]" role="img" aria-label={t('usage.byDay')} data-testid="usage-days">
      {days.map((d) => {
        const v = value(d);
        const label = `${new Date(`${d.day}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })} · ${metric === 'usd' ? usd(v, locale) : t('usage.tokensN', { n: tokens(v) })}`;
        return (
          <Tip key={d.day} label={label}>
            <span className="flex h-full min-w-0 flex-1 items-end" tabIndex={0}>
              <span className={cn('w-full rounded-t-sm', v ? 'bg-primary' : 'bg-muted')} style={{ height: v && max ? `${Math.max(3, (v / max) * 100)}%` : '3px' }} />
            </span>
          </Tip>
        );
      })}
    </div>
  );
}

function Table({ rows, head, locale }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="text-muted-foreground text-left text-xs"><th className="py-1.5 font-normal">{head}</th><th className="py-1.5 text-right font-normal">{t('usage.cost')}</th><th className="py-1.5 text-right font-normal">{t('usage.in')}</th><th className="py-1.5 text-right font-normal">{t('usage.out')}</th><th className="py-1.5 text-right font-normal">{t('usage.turns')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="py-2"><span className="flex min-w-0 items-center gap-2"><AgentIcon agent={r.agent} className="size-4 shrink-0" /><span className="truncate">{r.name}</span></span></td>
              <td className="py-2 text-right tabular-nums">{r.usd ? usd(r.usd, locale) : '—'}</td>
              <td className="py-2 text-right tabular-nums">{tokens(r.tokensIn)}</td>
              <td className="py-2 text-right tabular-nums">{tokens(r.tokensOut)}</td>
              <td className="py-2 text-right tabular-nums">{r.turns.toLocaleString(locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Limits({ accounts, locale }) {
  const t = useT();
  const withData = accounts.filter((u) => u.windows?.length);
  if (!withData.length) return <p className="text-muted-foreground text-[13px]">{t('usage.noLimits')}</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {withData.map((u) => (
        <div key={u.account} className="grid content-start gap-2.5 rounded-xl border p-3.5 text-[13px]" data-testid="usage-account">
          <div className="flex items-center gap-2 font-medium"><AgentIcon agent={u.agent} className="size-4" />{AGENT[u.agent] ?? u.agent}{u.label && u.label !== (AGENT[u.agent] ?? u.agent) ? <span className="text-muted-foreground truncate font-normal">· {u.label}</span> : null}</div>
          {u.windows.map((w) => {
            const p = Math.round((w.utilization ?? 0) * 100); const pace = paceOf(w);
            return (
              <div key={w.window} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3"><span className="truncate">{windowLabel(t, w.window)}</span><span className="tabular-nums">{p} %</span></div>
                <UsageBar pct={p} pace={pace} />
                <span className="text-muted-foreground text-xs">{[pace != null ? t(p > pace ? 'usage.aheadOfPace' : 'usage.withinPace', { pace }) : null, w.resetAt ? resetText(t, locale, w.resetAt) : null].filter(Boolean).join(' · ')}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function UsageView() {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const [days, setDays] = useState('30');
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  useEffect(() => { let alive = true; call('usage.history', { days: Number(days) }).then((r) => alive && setData(r)).catch(() => alive && setData(false)); return () => { alive = false; }; }, [days, version]);
  useEffect(() => { let alive = true; call('usage.get').then((r) => alive && setAccounts(r ?? [])).catch(() => {}); return () => { alive = false; }; }, [version]);
  const metric = data?.total?.usd ? 'usd' : 'tokens';
  const agents = useMemo(() => (data?.agents ?? []).map((a) => ({ ...a, key: a.agent, name: AGENT[a.agent] ?? a.agent })), [data]);
  const models = useMemo(() => (data?.models ?? []).map((m) => ({ ...m, key: `${m.agent}:${m.model ?? ''}`, name: m.label ?? m.model ?? t('usage.defaultModel') })), [data, t]);
  return (
    <>
      <PageHeader icon={<Gauge className="text-primary size-5" />} title={t('usage.title')}>
        <Tabs value={days} onValueChange={setDays}><TabsList>{['7', '30', '90'].map((d) => <TabsTrigger key={d} value={d} data-testid={`usage-range-${d}`}>{t('usage.days', { n: d })}</TabsTrigger>)}</TabsList></Tabs>
      </PageHeader>
      <PageBody>
        <div className="@container mx-auto grid max-w-4xl gap-5" data-testid="usage-view">
          {data === null ? <Spinner /> : data === false ? <Empty icon={Gauge} title={t('usage.unavailable')} /> : (<>
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              <Stat label={t('usage.cost')} value={usd(data.total.usd, locale)} />
              <Stat label={t('usage.in')} value={tokens(data.total.tokensIn)} />
              <Stat label={t('usage.out')} value={tokens(data.total.tokensOut)} />
              <Stat label={t('usage.turns')} value={data.total.turns.toLocaleString(locale)} />
            </div>
            <Card className="gap-3"><div className="px-5 text-[13px] font-medium">{metric === 'usd' ? t('usage.costByDay') : t('usage.tokensByDay')}</div><div className="px-5"><Days days={data.days} metric={metric} locale={locale} /></div></Card>
            {agents.length ? <Card className="gap-2"><div className="px-5 text-[13px] font-medium">{t('usage.byAgent')}</div><div className="px-5"><Table rows={agents} head={t('usage.agent')} locale={locale} /></div></Card> : null}
            {models.length ? <Card className="gap-2"><div className="px-5 text-[13px] font-medium">{t('usage.byModel')}</div><div className="px-5"><Table rows={models} head={t('usage.model')} locale={locale} /></div></Card> : null}
            {!data.total.turns ? <p className="text-muted-foreground text-[13px]">{t('usage.empty')}</p> : null}
          </>)}
          <Card className="gap-3"><div className="px-5 text-[13px] font-medium">{t('usage.limits')}</div><div className="px-5"><Limits accounts={accounts} locale={locale} /></div></Card>
        </div>
      </PageBody>
    </>
  );
}
