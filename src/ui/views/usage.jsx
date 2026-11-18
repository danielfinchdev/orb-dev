// «Uso», the whole usage page (reached from the usage panel of the context ring, from Ctrl+K and from the tab next to
// «Agentes»): each account's plan limits with the marks of the brakes and the even pace (usage.get), and cost and tokens
// by day, project, agent and model in the last 7, 30 or 90 days (usage.history, history.usage). The panel stays as it
// was; this page only adds detail.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Download, Gauge, RefreshCw, OctagonX } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { AgentsUsageTabs } from '@/components/agents-tabs.jsx';
import { windowLabel, shortTokens } from '@/components/usage-bits.jsx';
import { Badge, Empty, Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { IconButton, ListCard, MoreButton, Segmented } from '@/components/ui/primitives.jsx';
import { BubbleTip, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Select, Switch, Tip } from '@/components/ui/overlay.jsx';
import { useStore, call, act, fullPc } from '@/lib/store.js';
import { changeRail } from '@/lib/rules-actions.js';
import { confirmPauseRail, confirmResumeRail } from '@/views/rules-dialogs.jsx';
import { paceOf, windowMs } from '@/lib/usage-pace.js';
import { AGENT } from '@/lib/labels.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { Block, Panel, Setting, MoreOptions, save } from './settings/rows.jsx';

const usd = (n, locale) => `$${Number(n ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokens = shortTokens;
const range1 = (t, n) => (n === '1' ? t('usage.todayRange') : t('usage.days', { n }));
const sum = (list) => list.reduce((n, d) => n + (d.usd ?? 0), 0);

// The rows of «Uso por día» and «Por agente y modelo» as a CSV the user saves (same Blob download as the chat export).
const CR = String.fromCharCode(13); const LF = String.fromCharCode(10); const BOM = String.fromCharCode(0xfeff);
const csvCell = (v) => { const x = String(v ?? ''); return /[",;]/.test(x) || x.includes(CR) || x.includes(LF) ? `"${x.replaceAll('"', '""')}"` : x; };
function downloadUsageCsv(data, rows, days) {
  const lines = [['day', 'tokens_in', 'tokens_out', 'cost_usd'], ...data.days.map((d) => [d.day, d.tokensIn, d.tokensOut, d.usd.toFixed(4)]), [], ['agent', 'model', 'tokens_in', 'tokens_out', 'cost_usd'], ...rows.map((r) => [r.agent, r.model ?? '', r.tokensIn, r.tokensOut, (r.usd ?? 0).toFixed(4)])];
  const url = URL.createObjectURL(new Blob([BOM + lines.map((l) => l.map(csvCell).join(',')).join(CR + LF) + CR + LF], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `orb-usage-${days}d-${data.to}.csv`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A bar like the mock-up's .progress, with the marks over it: the even pace (a thin line) and the brake (a red line).
function Meter({ pct, pace = null, stop = null, label, title, className }) {
  return (
    <span className={cn('bg-muted relative block h-1.5 overflow-hidden rounded-full', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} title={title}>
      <span className="bg-primary-text block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct, 1))}%` }} />
      {pace != null ? <span className="bg-foreground/60 absolute top-0 h-full w-0.5" style={{ left: `calc(${Math.min(100, Math.max(pace, 0))}% - 1px)` }} data-testid="usage-pace" /> : null}
      {stop != null ? <span className="bg-destructive absolute top-0 h-full w-0.5" style={{ left: `calc(${Math.min(100, Math.max(stop, 0))}% - 1px)` }} data-testid="usage-stop" /> : null}
    </span>
  );
}

// One row of a table drawn with a grid: the name (with the agent's mark), tokens, cost and its share as a thin bar.
const COLS = 'grid-cols-[1fr_100px_100px] min-[900px]:grid-cols-[1fr_100px_100px_160px]';
function Rows({ head, rows, locale, total }) {
  const t = useT();
  return (
    <ListCard>
      <div className={cn('text-faint-foreground grid items-center gap-3 px-3.5 py-2 text-micro uppercase', COLS)}>
        <span>{head}</span><span className="text-right">{t('usage.tokens')}</span><span className="text-right">{t('usage.costEst')}</span><span className="max-[899px]:hidden">{t('usage.share')}</span>
      </div>
      {rows.map((r) => {
        const n = (r.tokensIn ?? 0) + (r.tokensOut ?? 0);
        const share = total ? Math.round((n / total) * 100) : 0;
        return (
          <div key={r.key} className={cn('border-border grid items-center gap-3 border-t px-3.5 py-2.5 text-control', COLS)}>
            <span className={cn('flex min-w-0 items-center gap-2', r.indent && 'pl-6')}>{r.project != null ? <ProjectIcon name={r.project} /> : r.agent && !r.plain ? <AgentIcon agent={r.agent} /> : null}<span className={cn('truncate', r.bold && 'font-medium')}>{r.name}</span></span>
            <span className="text-right tabular-nums">{n ? tokens(n) : '—'}</span>
            <span className="text-right tabular-nums">{r.usd ? usd(r.usd, locale) : '—'}</span>
            <span className="max-[899px]:hidden" title={`${share} %`}><Meter pct={share} label={`${share} %`} /></span>
          </div>
        );
      })}
    </ListCard>
  );
}

// One bar a day: the cost when the agents report it, else the tokens; the table under it gives the numbers.
function Days({ days, metric, locale }) {
  const t = useT();
  const value = (d) => (metric === 'usd' ? d.usd : d.tokensIn + d.tokensOut);
  const max = Math.max(...days.map(value), 0);
  const fmt = (v) => (metric === 'usd' ? usd(v, locale) : t('usage.tokensN', { n: tokens(v) }));
  const dayName = (d, i) => {
    const name = new Date(`${d.day}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });
    return i === days.length - 1 ? t('usage.today', { day: name }) : name;
  };
  return (
    <ListCard role="img" aria-label={t('usage.byDay')} data-testid="usage-days">
        {days.map((d, i) => {
          const v = value(d);
          return (
            <div key={d.day} className="border-border grid grid-cols-[110px_1fr_70px] items-center gap-3 px-3.5 py-2 text-control not-first:border-t" title={`${dayName(d, i)} · ${fmt(v)}`}>
              <span>{dayName(d, i)}</span>
              <Meter pct={v && max ? (v / max) * 100 : 0} label={fmt(v)} className={cn(!v && '[&>span]:hidden')} />
              <span className="text-right tabular-nums">{metric === 'usd' ? usd(v, locale) : tokens(v)}</span>
            </div>
          );
        })}
    </ListCard>
  );
}

// The same days as a table for reading the numbers (not in the mock-up): under «Más opciones», which closes the page.
function DaysTable({ days, metric, locale }) {
  const t = useT();
  const dayName = (d, i) => {
    const name = new Date(`${d.day}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });
    return i === days.length - 1 ? t('usage.today', { day: name }) : name;
  };
  return (
    <details className="text-faint-foreground text-caption" data-testid="usage-table">
        <summary className="cursor-pointer" data-testid="usage-table-toggle">{t('usage.tableOf', { what: metric === 'usd' ? t('usage.costByDay') : t('usage.tokensByDay') })}</summary>
        <ListCard className="mt-1.5">
          <div className="text-faint-foreground grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-3 px-3.5 py-2 text-micro uppercase"><span>{t('usage.day')}</span><span>{t('usage.in')}</span><span>{t('usage.out')}</span><span>{metric === 'usd' ? t('usage.cost') : t('usage.total')}</span></div>
          {days.map((d, i) => (
            <div key={d.day} className="border-border text-foreground grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-3 border-t px-3.5 py-2 text-control tabular-nums"><span>{dayName(d, i)}</span><span>{tokens(d.tokensIn)}</span><span>{tokens(d.tokensOut)}</span><span>{metric === 'usd' ? usd(d.usd, locale) : tokens(d.tokensIn + d.tokensOut)}</span></div>
          ))}
        </ListCard>
    </details>
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

// What the sessions of Claude Code and Codex on this PC spent by model and hour (history.usage, read-only files).
function LocalUsage({ data, locale }) {
  const t = useT();
  if (!data?.total?.turns) return null;
  const models = (data.models ?? []).map((m) => ({ ...m, key: `${m.agent}:${m.model ?? ''}`, name: m.model ?? t('usage.defaultModel') }));
  const total = models.reduce((n, m) => n + m.tokensIn + m.tokensOut, 0);
  return (
    <>
      <Block title={t('usage.local')} note={t('usage.localHint')} />
      <ListCard className="flex flex-col gap-3 py-3.5" data-testid="usage-local"><div className="px-3.5 text-control font-medium">{t('usage.heat')}</div><div className="px-3.5"><Heat heat={data.heat} locale={locale} /></div></ListCard>
      <Rows head={t('usage.model')} rows={models} locale={locale} total={total} />
      {data.truncated ? <p className="text-faint-foreground text-caption">{t('usage.localTruncated')}</p> : null}
    </>
  );
}

// What the account will do at its pace: when it would reach the limit, or that it does not, or that it already stopped.
function outlook(t, locale, windows, stop, weeklyStop) {
  const w = [...windows].reverse().find((x) => windowMs(x.window) && x.resetAt && x.utilization != null);
  if (!w) return null;
  const weekly = /seven_day|^10080min$/.test(String(w.window));
  const brake = weekly ? weeklyStop : stop;
  if (w.utilization >= brake) return t('usage.pastBrake', { pct: Math.round(brake * 100) });
  const len = windowMs(w.window); const start = w.resetAt - len; const elapsed = Date.now() - start;
  if (elapsed <= 0 || !w.utilization) return t(weekly ? 'usage.paceNoLimitWeek' : 'usage.paceNoLimit');
  const hit = Date.now() + ((1 - w.utilization) / (w.utilization / elapsed));
  if (hit >= w.resetAt) return t(weekly ? 'usage.paceNoLimitWeek' : 'usage.paceNoLimit');
  return weekly ? t('usage.paceHitsDay', { when: new Date(hit).toLocaleString(locale, { weekday: 'long' }) }) : t('usage.paceHitsTime', { when: new Date(hit).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) });
}

// The short form the card shows: the clock time within a day, the weekday further away.
function renewText(t, locale, at) {
  if (at <= Date.now()) return t('session.usage.resetNow');
  if (at - Date.now() < 86_400_000) return t('usage.renewsAt', { when: new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) });
  return t('usage.renewsOn', { when: new Date(at).toLocaleDateString(locale, { weekday: 'long' }) });
}

function Account({ u, locale, stop, weeklyStop, reload }) {
  const t = useT();
  // the brakes apply to the 5-hour window and to the whole week, not to a window of one model
  const braked = u.windows?.some((w) => w.utilization != null && (/five_hour|^300min$|^5h$/.test(String(w.window)) ? w.utilization >= stop : /^seven_day$|^10080min$/.test(String(w.window)) && w.utilization >= weeklyStop));
  const name = AGENT[u.agent] ?? u.agent;
  const wlabel = (w) => (/five_hour|^300min$|^5h$/.test(String(w.window)) ? t('usage.win5', { h: u.windowHours ?? 5 }) : /^seven_day$|^10080min$/.test(String(w.window)) ? t('usage.winWeek') : windowLabel(t, w.window));
  const line = outlook(t, locale, u.windows ?? [], stop, weeklyStop);
  return (
    <div className="bg-card border-border rounded-card flex flex-col gap-2.5 border px-3.5 py-3 text-control" data-testid="usage-account">
      <div className="flex items-center gap-2"><AgentIcon agent={u.agent} /><b className="min-w-0 flex-1 truncate font-(family-name:--title) text-card-title leading-[1.45] font-semibold">{u.label && u.label !== name ? `${name} · ${u.label}` : name}</b>{u.plan ? <Badge variant="secondary" title={t('agents.planHint')}>{u.plan}</Badge> : null}{braked ? <Badge variant="warning">{t('usage.brake')}</Badge> : null}</div>
      {u.windows?.length ? (
        <div className="text-muted-foreground grid grid-cols-[90px_1fr] items-center gap-x-2.5 gap-y-1.5 text-caption leading-[1.45]">
          {u.windows.map((w) => {
            const p = Math.round((w.utilization ?? 0) * 100); const pace = paceOf(w);
            const paceText = pace != null ? t(p > pace ? 'usage.aheadOfPace' : 'usage.withinPace', { pace }) : '';
            const weekly = /^seven_day$|^10080min$/.test(String(w.window));
            const five = /five_hour|^300min$|^5h$/.test(String(w.window));
            const mark = weekly ? weeklyStop : five ? stop : null;
            return (
              <Fragment key={w.window}>
                <span>{wlabel(w)}</span>
                <div className="flex flex-col gap-1">
                  <b className="text-foreground text-control leading-[1.45] font-medium tabular-nums">{p} %</b>
                  <Meter pct={p} pace={pace} stop={mark != null ? Math.round(mark * 100) : null} label={wlabel(w)} title={paceText || undefined} />
                  <span>{w.resetAt ? renewText(t, locale, w.resetAt) : ''}</span>
                </div>
              </Fragment>
            );
          })}
        </div>
      ) : <p className="text-muted-foreground text-caption">{t('usage.noLimits')}</p>}
      <div className="flex flex-col gap-1">
      {line ? <p className="text-muted-foreground m-0 text-caption leading-[1.45]">{line}</p> : null}
      {/* what the queue holds for this account, and the pause the user can lift when the limit was only of one model or reset earlier. */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-caption leading-[1.45]">
        <span>{u.maxHeavy ? t('agents.tasksUsed', { used: u.used, max: u.max, heavy: u.heavy, maxHeavy: u.maxHeavy }) : t('agents.tasksUsedNoHeavy', { used: u.used, max: u.max })}</span>
        {u.cooldownUntil ? <Badge variant="destructive">{u.cooldownUntil - Date.now() > 20 * 3_600_000 ? t('agents.cooldownDay', { time: new Date(u.cooldownUntil).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('agents.cooldown', { time: new Date(u.cooldownUntil).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</Badge> : null}
        {u.modelLimits?.map((m) => <Badge key={m.model} variant="warning" title={m.model}>{t('agents.modelLimit', { model: m.label, time: new Date(m.until).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</Badge>)}
        {fullPc() && (u.cooldownUntil || u.modelLimits?.length) ? <Button size="xs" variant="outline" data-testid={`clear-cooldown-${u.account}`} onClick={async () => { if (await act(call('accounts.clearCooldown', { account: u.account }), t('agents.clearCooldownDone', { name: u.label }))) reload(); }}>{t('agents.clearCooldown')}</Button> : null}
      </div>
      </div>
    </div>
  );
}

// What Orb does when an account nears its limit: the brakes are the same values as «Ajustes › Tareas» and «Reglas»
// (a change of a brake asks the master password, as there).
function Limits({ cfg, windowHours }) {
  const t = useT();
  const stop = Math.round((cfg.budget?.stopAt ?? 0.92) * 100);
  const weekly = Math.round((cfg.budget?.weeklyStopAt ?? 0.85) * 100);
  const opts = (list, cur) => [...new Set([...list, cur])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n} %` }));
  const resume = cfg.continuity?.resumeAtReset !== false;
  // «Parar la cola» is the rail «freno-uso» of «Normas»: the same confirmation and the master password every time, like there.
  const [rails, setRails] = useState([]);
  const load = () => call('rails.list', {}).then((r) => setRails(Array.isArray(r) ? r : []), quiet);
  useEffect(() => { load(); }, []);
  const stopRail = rails.find((r) => r.id === 'freno-uso');
  return (
    <Block title={t('usage.atLimit')} note={t('usage.atLimitNote')} data-testid="usage-limits">
      <Panel className="mt-1.5">
        {stopRail ? <Setting label={t('usage.stopQueue', { pct: stop })} hint={t('usage.stopQueueHint')}><Switch checked={stopRail.activo !== false} onCheckedChange={async (enabled) => { if (!(await (enabled ? confirmResumeRail(stopRail) : confirmPauseRail(stopRail)))) return; if (await changeRail('freno-uso', { enabled }, t('rules.railSaved'))) load(); }} aria-label={t('usage.stopQueue', { pct: stop })} data-testid="usage-stop-queue" /></Setting> : null}
        <Setting label={t('usage.resume')} hint={t('usage.resumeHint')}><Switch checked={resume} onCheckedChange={(resumeAtReset) => save({ continuity: { resumeAtReset } })} aria-label={t('usage.resume')} /></Setting>
        <Setting label={t('usage.brake5', { h: windowHours })} hint={t('usage.brake5Hint')}><Select caret="solid" value={String(stop)} options={opts([75, 80, 85, 90, 92, 95, 98, 100], stop)} onValueChange={(v) => save({ budget: { profile: null, stopAt: Number(v) / 100 } })} title={t('usage.brake5', { h: windowHours })} data-testid="usage-brake-5h" /></Setting>
        <Setting label={t('usage.brakeWeek')} hint={t('usage.brakeWeekHint')}><Select caret="solid" value={String(weekly)} options={opts([70, 75, 80, 85, 90, 95, 100], weekly)} onValueChange={(v) => save({ budget: { weeklyStopAt: Number(v) / 100 } })} title={t('usage.brakeWeek')} data-testid="usage-brake-week" /></Setting>
      </Panel>
    </Block>
  );
}

export function UsageView() {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const cfg = useStore((s) => s.app.config);
  const [days, setDays] = useState('30');
  const [data, setData] = useState(null);
  const [prev, setPrev] = useState(null);
  const [local, setLocal] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { let alive = true; call('usage.history', { days: Number(days) }).then((r) => alive && setData(r)).catch(() => alive && setData(false)); return () => { alive = false; }; }, [days, version, tick]);
  // the period before this one, from the next longer range (7 → 30, 30 → 90), to say if the cost went up or down.
  useEffect(() => {
    let alive = true; setPrev(null);
    const longer = days === '1' ? 7 : days === '7' ? 30 : days === '30' ? 90 : null;
    if (longer) call('usage.history', { days: longer }).then((r) => { if (alive) setPrev(sum(r.days.slice(-2 * Number(days), -Number(days)))); }).catch(quiet);
    return () => { alive = false; };
  }, [days, version, tick]);
  useEffect(() => { let alive = true; setLocal(null); call('history.usage', { days: Number(days) }).then((r) => alive && setLocal(r)).catch(() => alive && setLocal(false)); return () => { alive = false; }; }, [days, tick]);
  const reload = () => call('usage.get').then((r) => setAccounts(r ?? [])).catch(quiet);
  useEffect(() => { let alive = true; call('usage.get').then((r) => alive && setAccounts(r ?? [])).catch(quiet); return () => { alive = false; }; }, [version, tick]);
  const metric = data?.total?.usd ? 'usd' : 'tokens';
  const totalTokens = data?.total ? data.total.tokensIn + data.total.tokensOut : 0;
  // one flat row per model (an agent that reports no model keeps its own name), with its cost and share.
  const agentRows = useMemo(() => (data?.models ?? []).map((m) => ({ ...m, key: `${m.agent}:${m.model ?? ''}`, name: m.label ?? m.model ?? AGENT[m.agent] ?? m.agent })), [data]);
  // from the ledger of this period (usage.history), the same source as the rest of the page
  const projects = (data?.projects ?? []).map((p) => ({ ...p, key: p.project, name: p.project || '—' }));
  const projectsTotal = projects.reduce((n, p) => n + p.tokensIn + p.tokensOut, 0);
  const stop = cfg.budget?.stopAt ?? 0.92; const weeklyStop = cfg.budget?.weeklyStopAt ?? 0.85;
  const delta = prev && data?.total?.usd ? Math.round(((data.total.usd - prev) / prev) * 100) : null;
  const meta = data?.total ? [range1(t, days), t('usage.tokensN', { n: tokens(totalTokens) }), data.total.usd ? t('usage.estimated', { cost: usd(data.total.usd, locale) }) : null].filter(Boolean).join(' · ') : range1(t, days);
  const range = data?.from ? t('usage.range', { from: new Date(`${data.from}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' }), to: new Date(`${data.to}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' }) }) : '';
  const exportCsv = () => { if (data?.days) downloadUsageCsv(data, data.models ?? [], days); };
  const withTabs = fullPc();
  return (
    <>
      <PageHeader title={t('usage.title')} meta={meta}>
        <BubbleTip title={`${t('usage.exportCsv')} · ${t('usage.exportCsvHint')}`}><IconButton label={t('usage.exportCsv')} disabled={!data?.days} onClick={exportCsv} data-testid="usage-export-icon"><Download /></IconButton></BubbleTip>
        <DropdownMenu modal={false}>
          <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton data-testid="usage-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-48"><DropdownMenuItem onSelect={() => setTick((n) => n + 1)} data-testid="usage-refresh"><RefreshCw />{t('agents.refresh')}</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <PageBody className="pt-5 pb-10 md:pb-28">
        <div className="@container mx-auto flex w-full max-w-[1180px] flex-col gap-4" data-testid="usage-view">
          {withTabs ? <AgentsUsageTabs current="usage" /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={days} onChange={setDays} aria-label={t('usage.period')} options={['1', '7', '30', '90'].map((d) => ({ value: d, label: range1(t, d), testid: `usage-range-${d}` }))} />
            <span className="grow" />
            <Button variant="outline" disabled={!data?.days} onClick={exportCsv} title={t('usage.exportCsvHint')} data-testid="usage-export-csv"><Download />{t('usage.exportCsv')}</Button>
          </div>
          <Block title={t('usage.byAccount')} count={accounts.length || null}>
            <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-caption"><span className="inline-flex items-center gap-1.5"><OctagonX className="size-3.5" />{t('usage.legendBrake', { pct: Math.round(stop * 100) })}</span><span className="inline-flex items-center gap-1.5"><OctagonX className="size-3.5" />{t('usage.legendBrakeWeek', { pct: Math.round(weeklyStop * 100) })}</span></div>
            {accounts.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">{accounts.map((u) => <Account key={u.account} u={u} locale={locale} stop={stop} weeklyStop={weeklyStop} reload={reload} />)}</div> : <p className="text-muted-foreground text-control">{t('usage.noLimits')}</p>}
          </Block>
          {data === null ? <Spinner /> : data === false ? <Empty icon={Gauge} title={t('usage.unavailable')} /> : (<>
            <ListCard className="flex flex-col gap-0.5 p-3.5 leading-[1.45]">
              <span className="text-muted-foreground text-caption leading-[1.45] uppercase">{days === '1' ? t('usage.costToday') : t('usage.costEstimated', { n: days })}</span>
              <div className="flex min-h-5 items-center gap-2"><span className="text-muted-foreground font-(family-name:--title) text-caption leading-[1.45] font-semibold tabular-nums">{usd(data.total.usd, locale)}</span>{delta != null ? <Badge variant={delta > 0 ? 'warning' : 'success'}>{t(delta > 0 ? 'usage.deltaUp' : 'usage.deltaDown', { pct: Math.abs(delta), vs: t(days === '1' ? 'usage.vsYesterday' : days === '7' ? 'usage.vsWeek' : 'usage.vsMonth') })}</Badge> : null}</div>
              <span className="text-muted-foreground text-caption leading-[1.45]">{t('usage.costNote')}</span>
            </ListCard>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
              {[[t('usage.in'), tokens(data.total.tokensIn)], [t('usage.out'), tokens(data.total.tokensOut)], [t('usage.turns'), data.total.turns.toLocaleString(locale)], [t('usage.total'), tokens(totalTokens)]].map(([label, value]) => (
                <div key={label} className="bg-card border-border rounded-card flex flex-col gap-1 border px-3.5 py-3"><span className="text-muted-foreground text-caption">{label}</span><b className="font-(family-name:--title) text-[24px] font-semibold tabular-nums">{value}</b></div>
              ))}
            </div>
            <Block title={t('usage.byDay')} count={[metric === 'usd' ? t('usage.metricCost') : t('usage.metricTokens'), range].filter(Boolean).join(' · ')}>
              <Days days={data.days} metric={metric} locale={locale} />
            </Block>
            {projects.length ? <Block title={t('usage.byProject')}><Rows head={t('usage.project')} rows={projects} locale={locale} total={projectsTotal} /></Block> : null}
            {agentRows.length ? <Block title={t('usage.byAgentModel')}><Rows head={t('usage.agent')} rows={agentRows} locale={locale} total={totalTokens} /></Block> : null}
            {!data.total.turns ? <p className="text-muted-foreground text-control">{t('usage.empty')}</p> : null}
          </>)}
          {/* Orb's own, not drawn by the mock-up: at the end, under «Más opciones». Open, because the limits and the brake are there. */}
          <MoreOptions testid="usage-more-options">
            {fullPc() ? <Limits cfg={cfg} windowHours={accounts[0]?.windowHours ?? cfg.budget?.windowHours ?? 5} /> : null}
            <LocalUsage data={local || null} locale={locale} />
            {data?.days?.length ? <DaysTable days={data.days} metric={metric} locale={locale} /> : null}
          </MoreOptions>
        </div>
      </PageBody>
    </>
  );
}
