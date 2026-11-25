// «Uso», the usage page (reached from the usage panel of the context ring, from Ctrl+K and from the tab next to «Agentes»):
// three views, Coste · Tokens · Límites, under one row of filters (period, agent, account, model, project). The cost and
// tokens come from the flat records of the ledger (usage.records) and are added up here, so every filter is instant;
// the limits are each account's plan windows (usage.get). The panel of the context ring stays as it was.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronRight, Clock, Download, Gauge, ListChecks, MessageSquare, FilterX, RefreshCw, OctagonX, TriangleAlert, X } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { AgentsUsageTabs } from '@/components/agents-tabs.jsx';
import { UsageChart } from '@/components/usage-chart.jsx';
import { windowLabel, shortTokens } from '@/components/usage-bits.jsx';
import { Badge, Empty, Input, Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { IconButton, ListCard, MoreButton, Segmented } from '@/components/ui/primitives.jsx';
import { BubbleTip, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Select, Switch, Tip } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go, fullPc } from '@/lib/store.js';
import { changeRail } from '@/lib/rules-actions.js';
import { confirmPauseRail, confirmResumeRail } from '@/views/rules-dialogs.jsx';
import { paceOf, windowMs } from '@/lib/usage-pace.js';
import { BY, breakdownOf, daysBetween, daysNeeded, eachDay, filterRecords, menuValue, seriesOf, shiftDay, slotOf, topItems, toCsv, totals, windowOf } from '@/lib/usage-data.js';
import { AGENT } from '@/lib/labels.js';
import { AccountMark } from '@/components/brain-picker.jsx';
import { useT, useLocale } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { Block, Panel, Setting, save } from './settings/rows.jsx';

const usd = (n, locale) => `$${Number(n ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokens = shortTokens;
const ALL = '*';
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayDate = (day) => new Date(`${day}T12:00:00`);

// What is filtered, saved as a CSV (same Blob download as the chat export).
function downloadCsv(text, win, to) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `orb-usage-${win}d-${to}.csv`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A bar like the mock-up's .progress, with the marks over it: the even pace (a thin line) and the brake (a red line).
function Meter({ pct, pace = null, stop = null, warn = null, color = null, label, title, className }) {
  return (
    <span className={cn('bg-muted relative block h-1.5 overflow-hidden rounded-full', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} title={title}>
      <span className={cn('block h-full rounded-full', !color && 'bg-primary-text')} style={{ width: `${Math.min(100, Math.max(pct, 1))}%`, ...(color ? { background: color } : {}) }} />
      {pace != null ? <span className="bg-foreground/60 absolute top-0 h-full w-0.5" style={{ left: `calc(${Math.min(100, Math.max(pace, 0))}% - 1px)` }} data-testid="usage-pace" /> : null}
      {warn != null ? <span className="bg-warning absolute top-0 h-full w-0.5" style={{ left: `calc(${Math.min(100, Math.max(warn, 0))}% - 1px)` }} data-testid="usage-warn" /> : null}
      {stop != null ? <span className="bg-destructive absolute top-0 h-full w-0.5" style={{ left: `calc(${Math.min(100, Math.max(stop, 0))}% - 1px)` }} data-testid="usage-stop" /> : null}
    </span>
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
// What the sessions of Claude Code and Codex on this PC spent by hour and model (history.usage, read-only files), under
// «Uso fuera de Orb» at the end of the page.
function LocalUsage({ data, locale }) {
  const t = useT();
  if (!data?.total?.turns) return null;
  const models = (data.models ?? []).map((m) => ({ key: `${m.agent}:${m.model ?? ''}`, agent: m.agent, name: m.model ?? t('usage.defaultModel'), n: m.tokensIn + m.tokensOut }));
  return (
    <details className="text-muted-foreground text-caption" data-testid="usage-local-box">
      <summary className="cursor-pointer text-control" data-testid="usage-local-toggle">{t('usage.outside')}</summary>
      <ListCard className="mt-1.5 flex flex-col gap-3 p-3.5" data-testid="usage-local">
        <p className="m-0">{t('usage.outsideNote')}</p>
        <div className="text-foreground text-control font-medium">{t('usage.heat')}</div>
        <Heat heat={data.heat} locale={locale} />
        <div className="flex items-center gap-2"><span>{t('usage.heatLess')}</span>{[0.35, 0.55, 0.75, 1].map((o) => <i key={o} className="bg-primary-text inline-block size-2.5 rounded-full" style={{ opacity: o }} />)}<span>{t('usage.heatMore')}</span><span className="grow" /><span>{t('usage.turnsN', { n: data.total.turns.toLocaleString(locale) })}</span></div>
        <table className="w-full text-left text-control"><thead><tr className="text-faint-foreground text-micro"><th className="py-1 font-medium">{t('usage.model')}</th><th className="py-1 text-right font-medium">{t('usage.tokens')}</th></tr></thead>
          <tbody>{models.map((m) => <tr key={m.key} className="border-border text-foreground border-t"><td className="py-1.5"><span className="inline-flex items-center gap-2"><AgentIcon agent={m.agent} />{m.name}</span></td><td className="py-1.5 text-right tabular-nums">{tokens(m.n)}</td></tr>)}</tbody></table>
        {data.truncated ? <p className="m-0">{t('usage.localTruncated')}</p> : null}
      </ListCard>
    </details>
  );
}

// «1 h 5 min», «3 d 4 h»: what is left until a window resets.
function untilReset(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m >= 1440) return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${m} min`;
}

// One account of «Límites»: what is left of each window of its plan, with the marks of the warning and the pause, the
// countdown to its reset and what the queue holds. now: the clock of the page, so the countdown moves while it is open.
function LimitCard({ u, locale, stop, weeklyStop, warn = 0, now, reload }) {
  const t = useT();
  const name = AGENT[u.agent] ?? u.agent;
  const five = (w) => /five_hour|^300min$|^5h$/.test(String(w.window));
  const weekly = (w) => /^seven_day$|^10080min$/.test(String(w.window));
  const wlabel = (w) => (five(w) ? t('usage.limit5', { h: u.windowHours ?? 5 }) : weekly(w) ? t('usage.limitWeek') : windowLabel(t, w.window));
  const braked = u.windows?.some((w) => w.utilization != null && (five(w) ? w.utilization >= stop : weekly(w) && w.utilization >= weeklyStop));
  const warned = !braked && warn > 0 && u.windows?.some((w) => w.utilization != null && w.utilization >= warn && (five(w) || weekly(w)));
  const paused = Boolean(u.cooldownUntil);
  const line = outlook(t, locale, u.windows ?? [], stop, weeklyStop);
  const fiveStop = u.windows?.some((w) => five(w) && w.utilization >= warn) ? stop : weeklyStop;
  const resetText = (w) => {
    if (!w.resetAt) return '';
    if (w.resetAt <= now) return t('session.usage.resetNow');
    const when = weekly(w) ? t('usage.onDay', { day: new Date(w.resetAt).toLocaleDateString(locale, { weekday: 'long' }) }) : new Date(w.resetAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return `${t('usage.resetsIn', { time: untilReset(w.resetAt - now) })} · ${when}`;
  };
  return (
    <div className="bg-card border-border rounded-card flex flex-col gap-3 border p-3.5 text-control" data-testid="usage-account">
      <div className="flex flex-wrap items-center gap-2"><AgentIcon agent={u.agent} /><AccountMark agent={u.agent} id={u.account} /><b className="min-w-30 flex-1 truncate font-(family-name:--title) text-card-title leading-[1.45] font-semibold">{u.label && u.label !== name ? `${name} · ${u.label}` : name}</b>{u.plan ? <Badge variant="secondary" title={t('agents.planHint')}>{u.plan}</Badge> : null}{braked || paused ? <Badge variant="destructive">{t('usage.brake')}</Badge> : warned ? <Badge variant="warning" data-testid="usage-warned">{t('usage.warnBadge')}</Badge> : null}</div>
      {u.windows?.length ? u.windows.map((w) => {
        const used = Math.round((w.utilization ?? 0) * 100); const pace = paceOf(w);
        const mark = weekly(w) ? weeklyStop : five(w) ? stop : null;
        const stopPct = mark != null ? Math.round(mark * 100) : null;
        const warnMark = warn > 0 && mark != null && warn < mark ? Math.round(warn * 100) : null;
        const over = stopPct != null && used >= stopPct; const near = !over && warnMark != null && used >= warnMark;
        const paceText = pace != null ? t(used > pace ? 'usage.aheadOfPace' : 'usage.withinPace', { pace }) : '';
        return (
          <div key={w.window} className="flex flex-col gap-1.5" data-testid="usage-window">
            <span className="text-muted-foreground text-caption">{wlabel(w)}</span>
            <div className="flex items-center gap-2"><b className="font-(family-name:--title) text-[24px] leading-none font-semibold tabular-nums">{t('usage.left', { pct: Math.max(0, 100 - used) })}</b><span className="text-muted-foreground text-caption">{t('usage.free')}</span><span className="grow" />{over ? <Badge variant="destructive">{t('usage.brake')}</Badge> : near ? <Badge variant="warning">{t('usage.warnBadge')}</Badge> : null}</div>
            <Meter pct={used} pace={pace} stop={stopPct} warn={warnMark} color={over ? 'var(--destructive)' : near ? 'var(--warning)' : null} label={t('usage.usedOf', { label: wlabel(w), pct: used })} title={paceText || undefined} />
            {w.resetAt ? <span className="text-muted-foreground inline-flex items-center gap-1.5 text-caption"><Clock className="size-3.5" />{resetText(w)}</span> : null}
          </div>
        );
      }) : <p className="text-muted-foreground m-0 text-caption">{t('usage.noLimits')}</p>}
      {warned ? <p className="text-muted-foreground m-0 text-caption leading-[1.45]" data-testid="usage-past-warn">{t('usage.pastWarn', { pct: Math.round(fiveStop * 100) })}</p> : line ? <p className="text-muted-foreground m-0 text-caption leading-[1.45]">{line}</p> : null}
      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-caption leading-[1.45]">
        <span>{u.maxHeavy ? t('agents.tasksUsed', { used: u.used, max: u.max, heavy: u.heavy, maxHeavy: u.maxHeavy }) : t('agents.tasksUsedNoHeavy', { used: u.used, max: u.max })}</span>
        {u.cooldownUntil ? <Badge variant="destructive">{u.cooldownUntil - Date.now() > 20 * 3_600_000 ? t('agents.cooldownDay', { time: new Date(u.cooldownUntil).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('agents.cooldown', { time: new Date(u.cooldownUntil).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</Badge> : null}
        {u.modelLimits?.map((m) => <Badge key={m.model} variant="warning" title={m.model}>{t('agents.modelLimit', { model: m.label, time: new Date(m.until).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</Badge>)}
        {fullPc() && (u.cooldownUntil || u.modelLimits?.length) ? <Button size="xs" variant="outline" data-testid={`clear-cooldown-${u.account}`} onClick={async () => { if (await act(call('accounts.clearCooldown', { account: u.account }), t('agents.clearCooldownDone', { name: u.label }))) reload(); }}>{t('agents.clearCooldown')}</Button> : null}
      </div>
    </div>
  );
}

// One card of «Por proyecto», «Por modelo» or «Por cuenta»: horizontal bars, the biggest first; a click filters by that row.
function BreakdownCard({ title, by, rows, picked, onPick, fmt, nameOf }) {
  if (!rows.length) return null;
  const top = Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <div className="bg-card border-border rounded-card flex flex-col gap-0.5 border px-2 pt-3 pb-2" data-testid={`usage-by-${by}`}>
      <h3 className="m-0 mx-2 mb-1.5 font-(family-name:--title) text-card-title font-semibold">{title}</h3>
      {rows.map((r) => (
        <button key={r.key} type="button" aria-pressed={picked === menuValue(r.key)} title={nameOf(r)} onClick={() => onPick(menuValue(r.key))} data-testid="usage-row"
          className={cn('hover:bg-accent grid w-full cursor-pointer grid-cols-[minmax(110px,44%)_1fr_auto] items-center gap-2 rounded-ctl px-2 py-1.5 text-left text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-ring', picked === menuValue(r.key) && 'bg-primary-soft')}>
          <span className="inline-flex min-w-0 items-center gap-1.5">{by === 'project' ? (r.key ? <ProjectIcon name={r.key} /> : null) : <AgentIcon agent={r.agent} />}<span className="truncate">{nameOf(r)}</span></span>
          <span className="bg-secondary h-2 overflow-hidden rounded-full"><i className="bg-primary-text block h-full rounded-full" style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} /></span>
          <span className="text-muted-foreground text-right text-[12px] tabular-nums"><b className="text-foreground text-[13px] font-medium">{fmt(r.value)}</b> · {Math.round(r.share * 100)} %</span>
        </button>
      ))}
    </div>
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

export function Account({ u, locale, stop, weeklyStop, warn = 0, reload }) {
  const t = useT();
  // the brakes apply to the 5-hour window and to the whole week, not to a window of one model
  const braked = u.windows?.some((w) => w.utilization != null && (/five_hour|^300min$|^5h$/.test(String(w.window)) ? w.utilization >= stop : /^seven_day$|^10080min$/.test(String(w.window)) && w.utilization >= weeklyStop));
  const name = AGENT[u.agent] ?? u.agent;
  const wlabel = (w) => (/five_hour|^300min$|^5h$/.test(String(w.window)) ? t('usage.win5', { h: u.windowHours ?? 5 }) : /^seven_day$|^10080min$/.test(String(w.window)) ? t('usage.winWeek') : windowLabel(t, w.window));
  const line = outlook(t, locale, u.windows ?? [], stop, weeklyStop);
  // «Aviso»: a window that is past the warning level and still short of its brake (past the brake, «Freno» says it)
  const warned = !braked && warn > 0 && u.windows?.some((w) => w.utilization != null && w.utilization >= warn && (/five_hour|^300min$|^5h$/.test(String(w.window)) || /^seven_day$|^10080min$/.test(String(w.window))));
  const fiveStop = u.windows?.some((w) => /five_hour|^300min$|^5h$/.test(String(w.window)) && w.utilization >= warn) ? stop : weeklyStop;
  return (
    <div className="bg-card border-border rounded-card flex flex-col gap-2.5 border px-3.5 py-3 text-control" data-testid="usage-account">
      <div className="flex items-center gap-2"><AgentIcon agent={u.agent} /><AccountMark agent={u.agent} id={u.account} /><b className="min-w-0 flex-1 truncate font-(family-name:--title) text-card-title leading-[1.45] font-semibold">{u.label && u.label !== name ? `${name} · ${u.label}` : name}</b>{u.plan ? <Badge variant="secondary" title={t('agents.planHint')}>{u.plan}</Badge> : null}{braked ? <Badge variant="warning">{t('usage.brake')}</Badge> : warned ? <Badge variant="warning" data-testid="usage-warned">{t('usage.warnBadge')}</Badge> : null}</div>
      {u.windows?.length ? (
        <div className="text-muted-foreground grid grid-cols-[90px_1fr] items-center gap-x-2.5 gap-y-1.5 text-caption leading-[1.45]">
          {u.windows.map((w) => {
            const p = Math.round((w.utilization ?? 0) * 100); const pace = paceOf(w);
            const paceText = pace != null ? t(p > pace ? 'usage.aheadOfPace' : 'usage.withinPace', { pace }) : '';
            const weekly = /^seven_day$|^10080min$/.test(String(w.window));
            const five = /five_hour|^300min$|^5h$/.test(String(w.window));
            const mark = weekly ? weeklyStop : five ? stop : null;
            const warnMark = warn > 0 && mark != null && warn < mark ? Math.round(warn * 100) : null;
            return (
              <Fragment key={w.window}>
                <span>{wlabel(w)}</span>
                <div className="flex flex-col gap-1">
                  <b className="text-foreground text-control leading-[1.45] font-medium tabular-nums">{p} %</b>
                  <Meter pct={p} pace={pace} stop={mark != null ? Math.round(mark * 100) : null} warn={warnMark} label={wlabel(w)} title={paceText || undefined} />
                  <span>{w.resetAt ? renewText(t, locale, w.resetAt) : ''}</span>
                </div>
              </Fragment>
            );
          })}
        </div>
      ) : <p className="text-muted-foreground text-caption">{t('usage.noLimits')}</p>}
      <div className="flex flex-col gap-1">
      {warned ? <p className="text-muted-foreground m-0 text-caption leading-[1.45]" data-testid="usage-past-warn">{t('usage.pastWarn', { pct: Math.round(fiveStop * 100) })}</p> : line ? <p className="text-muted-foreground m-0 text-caption leading-[1.45]">{line}</p> : null}
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

// «Pasaría de A a B»: the account the agent is using now (the first of an agent that has several) and the one Orb would
// pass to (the next that is not paused); one line with what would happen, or that there is nowhere to go.
const accountName = (u) => { const n = AGENT[u.agent] ?? u.agent; return u.label && u.label !== n ? `${n} · ${u.label}` : n; };
export function switchPreview(t, accounts) {
  for (const u of accounts) {
    const others = accounts.filter((x) => x.agent === u.agent && x.account !== u.account);
    if (accounts.find((x) => x.agent === u.agent) !== u || !others.length) continue;
    const to = others.find((x) => !x.cooldownUntil) ?? others[0];
    return t('usage.switchWould', { from: accountName(u), to: accountName(to) });
  }
  return t('usage.switchNone');
}

// What Orb does when an account nears its limit: the brakes are the same values as «Ajustes › Tareas» and «Reglas»
// (a change of a brake asks the master password, as there).
function Limits({ cfg, windowHours, accounts = [] }) {
  const t = useT();
  const switchHint = switchPreview(t, accounts);
  const stop = Math.round((cfg.budget?.stopAt ?? 0.92) * 100);
  const weekly = Math.round((cfg.budget?.weeklyStopAt ?? 0.85) * 100);
  const opts = (list, cur) => [...new Set([...list, cur])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n} %` }));
  const resume = cfg.continuity?.resumeAtReset !== false;
  const switchAccount = cfg.continuity?.switchAccount !== false;
  const warn = Math.round((cfg.budget?.warnAt ?? 0) * 100);
  // the warning is only a heads-up (never a rail value): it is offered below the brake of the window, and 0 turns it off
  const warnOpts = [{ value: '0', label: t('usage.warnOff') }, ...[...new Set([75, 80, 85, 90].filter((n) => n < stop).concat(warn ? [warn] : []))].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n} %` }))];
  // «Parar la cola» is the rail «freno-uso» of «Normas»: the same confirmation and the master password every time, like there.
  const [rails, setRails] = useState([]);
  const load = () => call('rails.list', {}).then((r) => setRails(Array.isArray(r) ? r : []), quiet);
  useEffect(() => { load(); }, []);
  const stopRail = rails.find((r) => r.id === 'freno-uso');
  return (
    <Block title={t('usage.atLimit')} note={t('usage.atLimitNote')} data-testid="usage-limits">
      <Panel className="mt-1.5">
        {stopRail ? <Setting label={t('usage.stopQueue', { pct: stop })} hint={t('usage.stopQueueHint')}><Switch checked={stopRail.activo !== false} onCheckedChange={async (enabled) => { const ok = await (enabled ? confirmResumeRail(stopRail) : confirmPauseRail(stopRail)); if (ok && await changeRail('freno-uso', { enabled }, t('rules.railSaved'), ok.unlock)) load(); }} aria-label={t('usage.stopQueue', { pct: stop })} data-testid="usage-stop-queue" /></Setting> : null}
        <Setting label={t('usage.resume')} hint={t('usage.resumeHint')}><Switch checked={resume} onCheckedChange={(resumeAtReset) => save({ continuity: { resumeAtReset } })} aria-label={t('usage.resume')} /></Setting>
        <Setting label={t('usage.switchAccount')} hint={switchHint} title={t('usage.switchAccountHint')}><Switch checked={switchAccount} onCheckedChange={(v) => save({ continuity: { switchAccount: v } })} aria-label={t('usage.switchAccount')} data-testid="usage-switch-account" /></Setting>
        <Setting label={t('usage.warnAt')} hint={t('usage.warnAtHint')}><Select caret="solid" value={String(warn)} options={warnOpts} onValueChange={(v) => save({ budget: { warnAt: Number(v) / 100 } })} title={t('usage.warnAt')} data-testid="usage-warn-at" /></Setting>
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
  const [view, setView] = useState(null);
  const [period, setPeriod] = useState('7');
  const [custom, setCustom] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [filters, setFilters] = useState({ agent: '', account: '', model: '', project: '' });
  const [sel, setSel] = useState(null);
  const [group, setGroup] = useState('agent');
  const [hidden, setHidden] = useState({});
  const [shown, setShown] = useState(8);
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [local, setLocal] = useState(null);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(Date.now());
  const withTabs = fullPc();

  // what the ledger holds for the window and the one before it (to compare), asked once and filtered here
  const askToday = localToday();
  const askWin = windowOf(period, custom, askToday);
  const need = daysNeeded(askWin, askToday);
  useEffect(() => { let alive = true; call('usage.records', { days: need }).then((r) => alive && setData({ ...r, need })).catch(() => alive && setData(false)); return () => { alive = false; }; }, [need, version, tick]);
  const reload = () => call('usage.get').then((r) => setAccounts(r ?? [])).catch(quiet);
  useEffect(() => { let alive = true; call('usage.get').then((r) => alive && setAccounts(r ?? [])).catch(() => alive && setAccounts((a) => a ?? [])); return () => { alive = false; }; }, [version, tick]);
  const localDays = askWin.days <= 1 ? 1 : askWin.days <= 7 ? 7 : askWin.days <= 30 ? 30 : 90;
  useEffect(() => { let alive = true; setLocal(null); call('history.usage', { days: localDays }).then((r) => alive && setLocal(r)).catch(() => alive && setLocal(false)); return () => { alive = false; }; }, [localDays, tick]);

  // «Límites» first when every account is a subscription (its dollars say little); else the cost
  const allPlans = Boolean(accounts?.length) && accounts.every((u) => u.plan || u.windows?.length);
  const current = view ?? (allPlans ? 'limits' : 'cost');
  const limitsView = current === 'limits';
  useEffect(() => { if (!limitsView) return undefined; setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, [limitsView]);

  const records = useMemo(() => data?.records ?? [], [data]);
  const today = data?.to ?? askToday;
  const win = windowOf(period, custom, today);
  const active = sel ? { from: sel[0], to: sel[1] } : win;
  const span = daysBetween(active.from, active.to) + 1;
  const costless = !records.some((r) => r.usd > 0);
  const metric = current === 'tokens' || costless ? 'tokens' : 'cost';
  const cur = useMemo(() => filterRecords(records, filters, active.from, active.to), [records, filters, active.from, active.to]);
  const prev = useMemo(() => filterRecords(records, filters, shiftDay(active.from, span), shiftDay(active.from, 1)), [records, filters, active.from, span]);
  const tot = useMemo(() => totals(cur), [cur]);
  const ptot = useMemo(() => totals(prev), [prev]);
  const pick = (x) => (current === 'tokens' ? x.tokens : x.usd);
  const delta = pick(ptot) > 0 ? Math.round(((pick(tot) - pick(ptot)) / pick(ptot)) * 100) : null;
  const loading = data && data.need !== need;

  // names as the page says them: «Cuenta principal» and «Sin proyecto» are the old rows without that data
  const names = useMemo(() => {
    const model = new Map(); const account = new Map(); const accAgent = new Map();
    for (const u of accounts ?? []) { account.set(u.account, accountName(u)); accAgent.set(u.account, u.agent); }
    for (const r of records) {
      if (!model.has(r.model)) model.set(r.model, r.model ? (r.modelLabel || r.model) : t('usage.defaultModel'));
      if (!account.has(r.account)) { const a = AGENT[r.agent] ?? r.agent; account.set(r.account, r.account ? (r.accountLabel && r.accountLabel !== a ? `${a} · ${r.accountLabel}` : a) : t('usage.mainAccount')); }
      if (!accAgent.has(r.account)) accAgent.set(r.account, r.agent);
    }
    return { model, account, accAgent };
  }, [records, accounts, t]);
  const nameFor = (by, key) => (by === 'agent' ? (AGENT[key] ?? key) : by === 'model' ? (names.model.get(key) ?? (key || t('usage.defaultModel'))) : by === 'project' ? (key || t('usage.noProject')) : (names.account.get(key) ?? (key || t('usage.mainAccount'))));
  const agentOfAccount = (key) => names.accAgent.get(key) ?? 'claude';

  const setFilter = (name, value) => { setFilters((f) => ({ ...f, [name]: value === ALL ? '' : value })); setShown(8); };
  const flip = (name) => (value) => setFilter(name, filters[name] === value ? ALL : value);
  const filterKeys = limitsView ? ['agent', 'account'] : ['agent', 'account', 'model', 'project'];
  const anyFilter = filterKeys.some((k) => filters[k] !== '') || (!limitsView && sel) || period !== '7';
  const clearFilters = () => { setFilters({ agent: '', account: '', model: '', project: '' }); setSel(null); setShown(8); };

  const options = (by, all) => {
    const keys = new Set(by === 'agent' ? [...records.map((r) => r.agent), ...(accounts ?? []).map((u) => u.agent)] : by === 'account' ? [...(accounts ?? []).map((u) => u.account), ...records.map((r) => r.account)] : records.map((r) => by === 'model' ? r.model : r.project));
    const list = [...keys].sort((a, b) => nameFor(by, a).localeCompare(nameFor(by, b), locale));
    return [{ value: ALL, label: all }, ...list.map((k) => ({ value: menuValue(k), label: nameFor(by, k), icon: by === 'agent' ? <AgentIcon agent={k} /> : by === 'project' ? (k ? <ProjectIcon name={k} /> : null) : <AgentIcon agent={by === 'account' ? agentOfAccount(k) : (records.find((r) => r.model === k)?.agent ?? 'claude')} /> }))];
  };

  const dayName = (d, long) => {
    const x = dayDate(d).toLocaleDateString(locale, long ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' }).replaceAll(',', '');
    return d === today ? (long ? t('usage.today', { day: x }) : t('usage.todayShort')) : x;
  };
  const periodName = (p, c) => (p === '1' ? t('usage.todayRange') : p === 'custom' && c ? `${dayDate(c.from <= c.to ? c.from : c.to).toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${dayDate(c.from <= c.to ? c.to : c.from).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}` : t('usage.days', { n: p }));
  const periodOptions = [...['1', '7', '30', '90'].map((p) => ({ value: p, label: periodName(p) })), { value: 'custom', label: period === 'custom' ? periodName('custom', custom) : t('usage.pickDates'), icon: <CalendarRange className="size-4" /> }];
  const changePeriod = (v) => {
    if (v === 'custom') { setEditing(true); setDraft(custom ?? { from: shiftDay(today, 13), to: today }); return; }
    setEditing(false); setPeriod(v); setCustom(null); setSel(null); setShown(8);
  };
  const applyDates = () => { if (!draft.from || !draft.to) return; setCustom({ from: draft.from, to: draft.to }); setPeriod('custom'); setEditing(false); setSel(null); setShown(8); };

  const fmt = (v) => (metric === 'cost' ? usd(v, locale) : tokens(v));
  const fmtAxis = (v) => (metric === 'cost' ? `$${v >= 10 ? Math.round(v) : +v.toFixed(2)}` : tokens(Math.round(v)));
  const days = useMemo(() => eachDay(win.from, win.to), [win.from, win.to]);
  const chartRecords = useMemo(() => filterRecords(records, filters, win.from, win.to), [records, filters, win.from, win.to]);
  const series = useMemo(() => seriesOf(chartRecords, days, group, metric), [chartRecords, days, group, metric]);
  const lines = useMemo(() => {
    const universe = records.map((r) => (group === 'agent' ? r.agent : group === 'model' ? r.model : group === 'project' ? r.project : r.account));
    return series.lines.map((l) => ({ ...l, label: nameFor(group, l.key), slot: slotOf(group, l.key, universe) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, group, records, names]);
  const rangeText = days.length === 1 ? dayName(days[0], true) : `${dayName(days[0])} – ${dayName(days.at(-1))}`;
  const metricTitle = metric === 'cost' ? t('usage.costByDay') : t('usage.tokensByDay');

  const top = useMemo(() => topItems(cur, metric), [cur, metric]);
  const open = (x) => go(x.kind === 'task' ? { view: 'tasks', id: x.id } : x.kind === 'session' ? { view: 'session', id: x.id } : { view: 'chat', id: x.id });
  const exportCsv = () => {
    if (!cur.length) return;
    downloadCsv(toCsv(cur, { noProject: t('usage.noProject'), defaultModel: t('usage.defaultModel'), agent: (a) => AGENT[a] ?? a, account: (r) => nameFor('account', r.account) }), span, active.to);
  };
  const canExport = !limitsView && cur.length > 0;

  const limitAccounts = (accounts ?? []).filter((u) => (!filters.agent || u.agent === filters.agent) && (!filters.account || u.account === (filters.account === '-' ? '' : filters.account)));
  const stop = cfg.budget?.stopAt ?? 0.92; const weeklyStop = cfg.budget?.weeklyStopAt ?? 0.85; const warn = cfg.budget?.warnAt ?? 0;
  const chips = [];
  if (!limitsView && period !== '7') chips.push(['period', `${t('usage.fPeriod')}: ${periodName(period, custom)}`, () => { setPeriod('7'); setCustom(null); setEditing(false); setSel(null); }]);
  for (const [k, label] of [['agent', t('usage.fAgent')], ['account', t('usage.fAccount')], ['model', t('usage.fModel')], ['project', t('usage.fProject')]]) {
    if (!filterKeys.includes(k) || filters[k] === '') continue;
    chips.push([k, `${label}: ${nameFor(k, rawOf(filters[k]))}`, () => setFilter(k, ALL)]);
  }
  if (!limitsView && sel) chips.push(['sel', sel[0] === sel[1] ? `${t('usage.fDay')}: ${dayName(sel[0])}` : t('usage.fRange', { from: dayName(sel[0]), to: dayName(sel[1]) }), () => setSel(null)]);

  const meta = limitsView ? t('usage.limitsMeta') : [periodName(period, custom), t('usage.tokensN', { n: tokens(tot.tokens) }), tot.usd ? t('usage.estimated', { cost: usd(tot.usd, locale) }) : null].filter(Boolean).join(' · ');
  const deltaBadge = delta == null || delta === 0 ? null : <Badge variant={delta > 0 ? 'warning' : 'success'}>{t(delta > 0 ? 'usage.deltaUp' : 'usage.deltaDown', { pct: Math.abs(delta) })}</Badge>;
  const kpis = current === 'cost'
    ? [[t('usage.costEst2'), usd(tot.usd, locale), deltaBadge], [t('usage.tokensTitle'), tokens(tot.tokens)], [t('usage.perDay'), usd(tot.usd / span, locale)], [t('usage.chatsTasks'), tot.items]]
    : [[t('usage.total'), tokens(tot.tokens), deltaBadge], [t('usage.in'), tokens(tot.tokensIn)], [t('usage.out'), tokens(tot.tokensOut)], [t('usage.cache'), tot.tokensCache ? tokens(tot.tokensCache) : '—'], [t('usage.chatsTasks'), tot.items]];
  const tableLines = lines.filter((l) => !hidden[l.key]);

  return (
    <>
      <PageHeader title={t('usage.title')} meta={meta}>
        <BubbleTip title={`${t('usage.exportCsv')} · ${t('usage.exportCsvHint')}`}><IconButton label={t('usage.exportCsv')} disabled={!canExport} onClick={exportCsv} data-testid="usage-export-icon"><Download /></IconButton></BubbleTip>
        <DropdownMenu modal={false}>
          <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton data-testid="usage-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => setTick((n) => n + 1)} data-testid="usage-refresh"><RefreshCw />{t('agents.refresh')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <PageBody className="pt-5 pb-10 md:pb-28">
        <div className="@container mx-auto flex w-full max-w-[1180px] flex-col gap-4" data-testid="usage-view">
          {withTabs ? <AgentsUsageTabs current="usage" /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={current} onChange={(v) => { setView(v); setShown(8); }} aria-label={t('usage.viewLabel')} options={[{ value: 'cost', label: t('usage.cost'), testid: 'usage-view-cost' }, { value: 'tokens', label: t('usage.tokensTitle'), testid: 'usage-view-tokens' }, { value: 'limits', label: t('usage.limits'), testid: 'usage-view-limits' }]} />
            <span className="grow" />
            {!limitsView ? <Button variant="outline" disabled={!canExport} onClick={exportCsv} title={t('usage.exportCsvHint')} data-testid="usage-export-csv"><Download />{t('usage.exportCsv')}</Button> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('usage.filters')} data-testid="usage-filters">
            <Select caret="solid" prefix={t('usage.fPeriod')} value={period} onValueChange={changePeriod} options={periodOptions} disabled={limitsView} title={t('usage.fPeriod')} data-testid="usage-period" />
            <Select caret="solid" prefix={t('usage.fAgent')} value={filters.agent || ALL} onValueChange={(v) => setFilter('agent', v)} options={options('agent', t('usage.allM'))} title={t('usage.fAgent')} data-testid="usage-f-agent" />
            <Select caret="solid" prefix={t('usage.fAccount')} value={filters.account || ALL} onValueChange={(v) => setFilter('account', v)} options={options('account', t('usage.allF'))} title={t('usage.fAccount')} data-testid="usage-f-account" />
            <Select caret="solid" prefix={t('usage.fModel')} value={filters.model || ALL} onValueChange={(v) => setFilter('model', v)} options={options('model', t('usage.allM'))} disabled={limitsView} title={t('usage.fModel')} data-testid="usage-f-model" />
            <Select caret="solid" prefix={t('usage.fProject')} value={filters.project || ALL} onValueChange={(v) => setFilter('project', v)} options={options('project', t('usage.allM'))} disabled={limitsView} title={t('usage.fProject')} data-testid="usage-f-project" />
          </div>
          {editing && !limitsView ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-control" data-testid="usage-custom">
              <span>{t('usage.from')}</span><Input type="date" className="w-[150px]" value={draft.from} max={today} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} aria-label={t('usage.fromLabel')} data-testid="usage-date-from" />
              <span>{t('usage.to')}</span><Input type="date" className="w-[150px]" value={draft.to} max={today} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} aria-label={t('usage.toLabel')} data-testid="usage-date-to" />
              <Button variant="outline" onClick={applyDates} disabled={!draft.from || !draft.to} data-testid="usage-date-apply">{t('usage.apply')}</Button>
            </div>
          ) : null}
          {chips.length ? (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="usage-chips">
              {chips.map(([k, label, remove]) => (
                <span key={k} className="bg-primary-soft text-primary-text inline-flex h-6 items-center gap-1 rounded-full pr-1 pl-2.5 text-[12px] font-semibold whitespace-nowrap" data-testid={`usage-chip-${k}`}>{label}
                  <button type="button" onClick={remove} aria-label={t('usage.removeFilter', { name: label })} className="hover:bg-primary-text/15 grid size-5 cursor-pointer place-items-center rounded-full"><X className="size-3" /></button>
                </span>
              ))}
              <Button variant="ghost" onClick={() => { clearFilters(); if (period !== '7') { setPeriod('7'); setCustom(null); setEditing(false); } }} data-testid="usage-clear"><FilterX />{t('usage.clear')}</Button>
            </div>
          ) : null}

          {limitsView ? (
            <>
              <Block title={t('usage.byAccount')} count={limitAccounts.length || null} actions={<span className="text-muted-foreground flex flex-wrap items-center gap-3 text-caption">{warn > 0 ? <span className="inline-flex items-center gap-1.5" data-testid="usage-legend-warn"><TriangleAlert className="size-3.5" />{t('usage.legendWarn', { pct: Math.round(warn * 100) })}</span> : null}<span className="inline-flex items-center gap-1.5"><OctagonX className="size-3.5" />{t('usage.legendBrake', { pct: Math.round(stop * 100) })}</span><span className="inline-flex items-center gap-1.5"><OctagonX className="size-3.5" />{t('usage.legendBrakeWeek', { pct: Math.round(weeklyStop * 100) })}</span></span>}>
                {accounts == null ? <Spinner /> : limitAccounts.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">{limitAccounts.map((u) => <LimitCard key={u.account} u={u} locale={locale} stop={stop} weeklyStop={weeklyStop} warn={warn} now={now} reload={reload} />)}</div>
                  : accounts.length ? <Empty icon={Gauge} title={t('usage.noAccounts')}>{t('usage.noAccountsHint')}<div className="mt-2"><Button variant="outline" onClick={clearFilters}><FilterX />{t('usage.clear')}</Button></div></Empty> : <p className="text-muted-foreground text-control">{t('usage.noLimits')}</p>}
              </Block>
              {fullPc() ? <Limits cfg={cfg} accounts={accounts ?? []} windowHours={accounts?.[0]?.windowHours ?? cfg.budget?.windowHours ?? 5} /> : null}
            </>
          ) : data === null || loading ? <Spinner /> : data === false ? <Empty icon={Gauge} title={t('usage.unavailable')} /> : (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5" data-testid="usage-kpis">
                {kpis.map(([label, value, extra]) => (
                  <div key={label} className="bg-card border-border rounded-card flex flex-col gap-1 border px-3.5 py-3"><span className="text-muted-foreground text-caption">{label}</span><b className="font-(family-name:--title) text-[24px] font-semibold tabular-nums">{value}</b>{extra ? <div className="flex flex-wrap items-center gap-1.5">{extra}</div> : null}</div>
                ))}
              </div>
              {current === 'cost' && !costless ? <p className="text-muted-foreground m-0 text-caption">{t('usage.costNote')}</p> : null}
              {!cur.length ? (
                <Empty icon={Gauge} title={anyFilter ? t('usage.noneFiltered') : t('usage.empty')} className="bg-card border-border rounded-card border">{anyFilter ? t('usage.noneFilteredHint') : t('usage.emptyHint')}{anyFilter ? <div className="mt-2"><Button variant="outline" onClick={() => { clearFilters(); setPeriod('7'); setCustom(null); setEditing(false); }} data-testid="usage-empty-clear"><FilterX />{t('usage.clear')}</Button></div> : null}</Empty>
              ) : (
                <>
                  <div className="bg-card border-border rounded-card flex flex-col gap-3 border px-3.5 pt-3 pb-3.5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <h2 className="m-0 font-(family-name:--title) text-card-title font-semibold">{metricTitle}</h2><span className="text-faint-foreground text-caption">{rangeText}</span><span className="grow" />
                      <Select caret="solid" prefix={t('usage.groupBy')} value={group} onValueChange={(v) => { setGroup(v); setHidden({}); }} options={BY.map((b) => ({ value: b, label: t(`usage.f${b[0].toUpperCase()}${b.slice(1)}`) }))} title={t('usage.groupBy')} data-testid="usage-group" />
                    </div>
                    <UsageChart days={days} lines={lines} hidden={hidden} onToggle={(k) => setHidden((h) => ({ ...h, [k]: !h[k] }))} fmt={fmt} fmtAxis={fmtAxis}
                      dayLabel={(d) => dayName(d, true)} dayShort={(d) => dayName(d, false)} sel={sel} onSel={(r) => { setSel(r); setShown(8); }} itemsByDay={series.items} ariaLabel={t('usage.chartLabel')}
                      labels={{ noUse: t('usage.noUse'), noUseDay: t('usage.noUseDay'), total: t('usage.total'), series: t('usage.series'), items: (n) => (n === 1 ? t('usage.itemsOne') : t('usage.itemsN', { n })) }} />
                    <p className="text-faint-foreground m-0 text-[12px]" data-testid="usage-hint">{sel ? t('usage.hintSel', { range: sel[0] === sel[1] ? dayName(sel[0], true) : t('usage.fRange', { from: dayName(sel[0]), to: dayName(sel[1]) }) }) : t('usage.hint')}</p>
                  </div>
                  <details className="text-muted-foreground text-caption" data-testid="usage-table">
                    <summary className="cursor-pointer" data-testid="usage-table-toggle">{t('usage.tableOf', { what: metricTitle })}</summary>
                    <ListCard className="mt-1.5 max-h-[260px] overflow-auto">
                      <table className="w-full border-collapse text-[12px] tabular-nums">
                        <thead><tr><th scope="col" className="text-faint-foreground bg-card sticky top-0 px-3.5 py-2 text-left text-[11px] font-medium">{t('usage.day')}</th>{tableLines.map((l) => <th key={l.key} scope="col" className="text-faint-foreground bg-card sticky top-0 px-3.5 py-2 text-right text-[11px] font-medium">{l.label}</th>)}<th scope="col" className="text-faint-foreground bg-card sticky top-0 px-3.5 py-2 text-right text-[11px] font-medium">{t('usage.total')}</th></tr></thead>
                        <tbody>{[...days].reverse().map((d) => { const i = days.indexOf(d); const total = tableLines.reduce((s, l) => s + l.values[i], 0); return <tr key={d} className="border-border text-foreground border-t"><th scope="row" className="px-3.5 py-1.5 text-left font-normal">{dayName(d)}</th>{tableLines.map((l) => <td key={l.key} className="px-3.5 py-1.5 text-right">{l.values[i] ? fmt(l.values[i]) : '—'}</td>)}<td className="px-3.5 py-1.5 text-right">{total ? fmt(total) : '—'}</td></tr>; })}</tbody>
                      </table>
                    </ListCard>
                  </details>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-2.5">
                    {[['project', t('usage.byProject')], ['model', t('usage.byModel')], ['account', t('usage.byAccount')]].map(([by, title]) => (
                      <BreakdownCard key={by} title={title} by={by} rows={breakdownOf(cur, by, metric)} picked={filters[by]} onPick={flip(by)} fmt={fmt} nameOf={(r) => nameFor(by, r.key)} />
                    ))}
                  </div>
                  <Block title={t('usage.topTitle')} count={top.length ? t('usage.xOfY', { x: Math.min(shown, top.length), y: top.length }) : null}>
                    <ListCard data-testid="usage-top">
                      <div className="text-faint-foreground grid grid-cols-[1fr_80px_80px] items-center gap-3 px-3.5 py-2 text-micro uppercase min-[900px]:grid-cols-[1fr_190px_90px_90px_20px]"><span>{t('usage.colName')}</span><span className="max-[899px]:hidden">{t('usage.colAgentModel')}</span><span className="text-right">{t('usage.tokens')}</span><span className="text-right">{t('usage.costEst')}</span><span className="max-[899px]:hidden" /></div>
                      {top.slice(0, shown).map((x) => (
                        <button key={x.key} type="button" onClick={() => open(x)} data-testid="usage-top-row" className="border-border hover:bg-accent/60 grid w-full cursor-pointer grid-cols-[1fr_80px_80px] items-center gap-3 border-t px-3.5 py-2.5 text-left text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-ring min-[900px]:grid-cols-[1fr_190px_90px_90px_20px]">
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <b className="flex items-center gap-1.5 truncate font-medium">{x.kind === 'task' ? <ListChecks className="size-3.5 shrink-0" /> : <MessageSquare className="size-3.5 shrink-0" />}<span className="truncate">{x.kind === 'task' ? `#${x.id} ` : ''}{x.title || t('usage.untitled')}</span></b>
                            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[12px]">{x.project ? <ProjectIcon name={x.project} /> : null}{x.project || t('usage.noProject')} · {dayName(x.last)}</span>
                          </span>
                          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[12px] max-[899px]:hidden"><AgentIcon agent={x.agent} /><span className="truncate">{AGENT[x.agent] ?? x.agent} · {x.model ? (x.modelLabel || x.model) : t('usage.defaultModel')}</span></span>
                          <span className="text-right tabular-nums">{x.tokens ? tokens(x.tokens) : '—'}</span>
                          <span className="text-right tabular-nums">{x.usd ? usd(x.usd, locale) : '—'}</span>
                          <ChevronRight className="text-faint-foreground size-4 max-[899px]:hidden" />
                        </button>
                      ))}
                      {top.length > shown ? <div className="border-border flex justify-center border-t p-2.5"><Button variant="outline" onClick={() => setShown((n) => n + 8)} data-testid="usage-more-top">{t('usage.seeMore')}</Button></div> : null}
                    </ListCard>
                  </Block>
                </>
              )}
              <LocalUsage data={local || null} locale={locale} />
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}
const rawOf = (v) => (v === '-' ? '' : v);
