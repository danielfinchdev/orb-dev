// «Uso», the whole usage page (reached from the usage panel of the context ring and from Ctrl+K): cost and tokens
// by day, agent and model in the last 7, 30 or 90 days (usage.history), and each account's plan limits with the mark of
// an even pace (usage.get). The panel stays as it was; this page only adds detail.
import { Fragment, useEffect, useMemo, useState } from 'react';
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
import { quiet } from '@/lib/quiet.js';

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
              <span className={cn('w-full rounded-t-sm', v ? 'bg-primary-text' : 'bg-chart-empty')} style={{ height: v && max ? `${Math.max(3, (v / max) * 100)}%` : '3px' }} />
            </span>
          </Tip>
        );
      })}
    </div>
  );
}

function Table({ rows, head, locale, plain = false }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-control">
        <thead><tr className="text-muted-foreground text-left text-xs"><th className="py-1.5 font-normal">{head}</th><th className="py-1.5 text-right font-normal">{t('usage.cost')}</th><th className="py-1.5 text-right font-normal">{t('usage.in')}</th><th className="py-1.5 text-right font-normal">{t('usage.out')}</th><th className="py-1.5 text-right font-normal">{t('usage.turns')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="py-2"><span className="flex min-w-0 items-center gap-2">{plain ? null : <AgentIcon agent={r.agent} className="size-4 shrink-0" />}<span className="truncate">{r.name}</span></span></td>
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

// Heat map of the hours: a row per weekday (Monday first), a column per hour, darker where there were more turns.
function Heat({ heat, locale }) {
  const t = useT();
  const max = Math.max(...heat.flat(), 0);
  return (
    <div className="overflow-x-auto" data-testid="usage-heat">
      <div className="grid min-w-[420px] gap-[2px]" style={{ gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))' }} role="img" aria-label={t('usage.heat')}>
        {heat.map((row, d) => (
          <Fragment key={d}>
            <span className="text-muted-foreground pr-2 text-xs">{t(`usage.days${d}`)}</span>
            {row.map((n, h) => (
              <Tip key={h} label={t('usage.heatCell', { day: t(`usage.days${d}`), hour: h, n: n.toLocaleString(locale) })}>
                <span tabIndex={0} className={cn('aspect-square rounded-[3px]', n ? 'bg-primary-text' : 'bg-chart-empty')} style={n && max ? { opacity: 0.2 + 0.8 * (n / max) } : undefined} />
              </Tip>
            ))}
          </Fragment>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-muted-foreground text-center text-[10px]">{h % 6 === 0 ? h : ''}</span>)}
      </div>
    </div>
  );
}

// What the sessions of Claude Code and Codex on this PC spent (history.usage), by model, project and hour.
function LocalUsage({ days, locale }) {
  const t = useT();
  const [data, setData] = useState(null);
  useEffect(() => { let alive = true; setData(null); call('history.usage', { days }).then((r) => alive && setData(r)).catch(() => alive && setData(false)); return () => { alive = false; }; }, [days]);
  if (data === false) return null;
  const models = (data?.models ?? []).map((m) => ({ ...m, key: `${m.agent}:${m.model ?? ''}`, name: m.model ?? t('usage.defaultModel') }));
  const projects = (data?.projects ?? []).map((p) => ({ ...p, key: p.project, name: p.project || '—' }));
  return (
    <>
      <div><div className="text-control font-medium">{t('usage.local')}</div><p className="text-muted-foreground text-xs">{t('usage.localHint')}</p></div>
      {data === null ? <Spinner /> : !data.total.turns ? <p className="text-muted-foreground text-control">{t('usage.empty')}</p> : (<>
        <Card className="gap-3" data-testid="usage-local"><div className="px-5 text-control font-medium">{t('usage.heat')}</div><div className="px-5"><Heat heat={data.heat} locale={locale} /></div></Card>
        <Card className="gap-2"><div className="px-5 text-control font-medium">{t('usage.byModel')}</div><div className="px-5"><Table rows={models} head={t('usage.model')} locale={locale} /></div></Card>
        <Card className="gap-2"><div className="px-5 text-control font-medium">{t('usage.byProject')}</div><div className="px-5"><Table rows={projects} head={t('usage.project')} locale={locale} plain /></div></Card>
        {data.truncated ? <p className="text-muted-foreground text-xs">{t('usage.localTruncated')}</p> : null}
      </>)}
    </>
  );
}

function Limits({ accounts, locale }) {
  const t = useT();
  const withData = accounts.filter((u) => u.windows?.length);
  if (!withData.length) return <p className="text-muted-foreground text-control">{t('usage.noLimits')}</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {withData.map((u) => (
        <div key={u.account} className="grid content-start gap-2.5 rounded-xl border p-3.5 text-control" data-testid="usage-account">
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
  useEffect(() => { let alive = true; call('usage.get').then((r) => alive && setAccounts(r ?? [])).catch(quiet); return () => { alive = false; }; }, [version]);
  const metric = data?.total?.usd ? 'usd' : 'tokens';
  const agents = useMemo(() => (data?.agents ?? []).map((a) => ({ ...a, key: a.agent, name: AGENT[a.agent] ?? a.agent })), [data]);
  const models = useMemo(() => (data?.models ?? []).map((m) => ({ ...m, key: `${m.agent}:${m.model ?? ''}`, name: m.label ?? m.model ?? t('usage.defaultModel') })), [data, t]);
  return (
    <>
      <PageHeader icon={<Gauge className="text-primary-text size-5" />} title={t('usage.title')}>
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
            <Card className="gap-3"><div className="px-5 text-control font-medium">{metric === 'usd' ? t('usage.costByDay') : t('usage.tokensByDay')}</div><div className="px-5"><Days days={data.days} metric={metric} locale={locale} /></div></Card>
            {agents.length ? <Card className="gap-2"><div className="px-5 text-control font-medium">{t('usage.byAgent')}</div><div className="px-5"><Table rows={agents} head={t('usage.agent')} locale={locale} /></div></Card> : null}
            {models.length ? <Card className="gap-2"><div className="px-5 text-control font-medium">{t('usage.byModel')}</div><div className="px-5"><Table rows={models} head={t('usage.model')} locale={locale} /></div></Card> : null}
            {!data.total.turns ? <p className="text-muted-foreground text-control">{t('usage.empty')}</p> : null}
          </>)}
          <LocalUsage days={Number(days)} locale={locale} />
          <Card className="gap-3"><div className="px-5 text-control font-medium">{t('usage.limits')}</div><div className="px-5"><Limits accounts={accounts} locale={locale} /></div></Card>
        </div>
      </PageBody>
    </>
  );
}
