// Activity: every event of Orb (who did what and when). A newer engine reads it by pages and filters it by source,
// level, project, dates and text; an older one answers the plain list of events, and then only the text search stays.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Bug, Orbit, Bot, User, Monitor, Activity, ClipboardCopy, FilterX, SquareCheck, ArrowRight, ListFilter, Layers, X, CircleHelp } from 'lucide-react';
import { notifyOk } from '@/lib/notify.js';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Empty, Spinner } from '@/components/ui/basic.jsx';
import { BubbleTip, DropdownMenuItem, Select, Switch } from '@/components/ui/overlay.jsx';
import { IconButton, ListCard, SearchInput } from '@/components/ui/primitives.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { DateField } from '@/components/date-field.jsx';
import { toIso } from '@/lib/date-field.js';
import { useStore, call, go } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { cn, fmtTime } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { activityLabel, activityDetail, activitySentence } from '@/lib/activity.js';
import { TABS, RANGES, EMPTY_VIEW, resolveFilters, activeChips, clearChip, visibleLines, buildQuery, normalizeActivity, appendPage, hasMethod, countsKey } from '@/lib/activity-filters.js';
import { quiet } from '@/lib/quiet.js';
import { ReportDialog } from './activity-report.jsx';
import { BitacorasPage } from './bitacoras-page.jsx';

// Radix Select has no empty value for «every project»
const ALL = '*';
const SOURCE_ICON = { orb: Orbit, subagentes: Bot, usuario: User, app: Orbit };
// the label of the date chip: a preset by its name, a custom span by its days
const rangeLabel = (t, v) => (v.range === 'custom' ? [v.from, v.to].filter(Boolean).join(' – ') || t('logbooks.range.custom') : t(`logbooks.range.${v.range}`));
// the level is told by the word of its badge, never by colour alone
const LEVEL_BADGE = { info: 'info', warn: 'warning', error: 'destructive' };
// the hour only: the day is in the tooltip and in the detail
const hourOf = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const CHIP = 'inline-flex h-(--ctl-sm) cursor-pointer items-center gap-1.5 rounded-[calc(var(--r-ctl)-2px)] px-2.5 text-control whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-ring';
// characters of one event line in the list
const LINE = 140;
const COLS = 'grid-cols-[52px_150px_72px_150px_minmax(0,1fr)]';
// on a phone the row stacks: the sentence at full width, and under it one small line (hour, who, level, project)
const COLS_NARROW = 'max-sm:grid-cols-[auto_auto_auto_minmax(0,1fr)] max-sm:gap-x-2.5 max-sm:gap-y-1';

export function ActivityView({ tabs }) {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const projects = useStore((s) => s.projects);
  const [view, setView] = useState(EMPTY_VIEW);
  const [technical, setTechnical] = useState(false);
  const [page, setPage] = useState({ paged: false, items: [], next: null, counts: null });
  const [loading, setLoading] = useState(false);
  const [canReport, setCanReport] = useState(false);
  const [report, setReport] = useState(false);
  const [moment, setMoment] = useState(null);
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);
  const gen = useRef(0);
  const lastKey = useRef(null);
  const set = (patch) => setView((v) => ({ ...v, ...patch }));
  const today = toIso(new Date());
  // the engine query is built from the view; the days of «Hoy / 7 días / 30 días» follow the calendar
  const filters = useMemo(() => resolveFilters(view), [view, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const mine = ++gen.current; // a slow older answer never lands over a newer one
    // typing in the search box keeps the last totals; they are asked again once after a pause
    const key = JSON.stringify([countsKey(filters), version, tick]);
    const typing = lastKey.current === key;
    lastKey.current = key;
    const run = (counts) => call('activity.list', buildQuery(filters, null, { counts })).then((r) => { if (gen.current === mine) setPage((p) => { const n = normalizeActivity(r); return counts ? n : { ...n, counts: p.counts }; }); }).catch(quiet);
    const h = setTimeout(() => run(!typing), 200);
    const h2 = typing ? setTimeout(() => run(true), 800) : null;
    return () => { clearTimeout(h); if (h2) clearTimeout(h2); };
  }, [filters, version, tick]);
  // the report button only exists when the engine can write the report
  useEffect(() => { if (page.paged) hasMethod(call, 'activity.report', { lines: 1 }).then(setCanReport); }, [page.paged]);
  const more = useCallback(() => {
    const mine = gen.current;
    setLoading(true);
    call('activity.list', buildQuery(filters, page.next)).then((r) => { if (gen.current === mine) { const n = normalizeActivity(r); setPage((p) => ({ ...p, next: n.next, items: appendPage(p.items, n.items) })); } }).catch(quiet).finally(() => setLoading(false));
  }, [filters, page.next]);
  const { paged, counts } = page;
  // the technical lines wait behind the switch; «Copiar» and the report take every line anyway
  const items = useMemo(() => (paged ? visibleLines(page.items, technical) : page.items), [page.items, paged, technical]);
  // «Problemas» counts what the engine found (warnings and errors), not only the lines loaded; the engine counts under the
  // tab's own sources and a log longer than it reads in one go shows a «+»
  const problems = counts ? counts.levels.warn + counts.levels.error : null;
  const copy = () => navigator.clipboard.writeText(page.items.map((r) => (r.legacy ? `${r.legacy.at}\t${r.legacy.actor}\t${r.legacy.kind}\t${r.legacy.task_id ? `#${r.legacy.task_id} ` : ''}${r.legacy.detail}` : `${r.at ?? ''}\t${r.source}\t${r.level}\t${r.project ?? ''}\t${r.text}`)).join('\n')).then(() => notifyOk(t('activity.copied')));
  const projectOptions = useMemo(() => [{ value: ALL, label: t('logbooks.allProjects'), icon: <Layers className="size-4" /> }, ...(projects ?? []).map((p) => ({ value: p.name, label: p.name, icon: <ProjectIcon name={p.name} /> }))], [projects, t]);
  const rangeOptions = useMemo(() => RANGES.map((r) => ({ value: r, label: t(`logbooks.range.${r}`) })), [t]);
  const chips = activeChips(view);
  const chipText = (c) => `${t(`logbooks.chip.${c.key}`)}: ${c.key === 'range' ? rangeLabel(t, view) : c.value}`;
  const summary = (r) => `${t(`logbooks.level.${r.level}`)} · ${String(r.text).slice(0, 80)}`;
  // «Copiar» is not in the mock-up's bar: it lives in the «⋯» of the page.
  const menuItems = <DropdownMenuItem onSelect={copy} data-testid="activity-copy"><Copy />{t('activity.copy')}</DropdownMenuItem>;
  const tabLabel = { todo: t('logbooks.tab.todo'), tu: t('logbooks.tab.tu'), agentes: t('logbooks.tab.agentes'), problemas: t('logbooks.tab.problemas') };
  return (
    <BitacorasPage meta={t('nav.logbooksHint')} menuItems={menuItems} onRefresh={() => setTick((n) => n + 1)} tabs={tabs}>
      {paged ? (
        <div className="toolbar flex flex-wrap items-center gap-2" role="group" aria-label={t('logbooks.filters')} data-testid="activity-filters">
          <div className="segm bg-secondary inline-flex gap-0.5 rounded-ctl p-0.5" role="group" aria-label={t('logbooks.view')} data-testid="activity-tabs">
            {TABS.map((k) => (
              <button key={k} type="button" aria-pressed={view.tab === k} onClick={() => set({ tab: k })} data-testid={`activity-tab-${k}`}
                className={cn(CHIP, view.tab === k ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {tabLabel[k]}
                {k === 'problemas' && problems ? <Badge variant="destructive" data-testid="activity-problems">{problems.toLocaleString(locale)}{counts?.partial ? '+' : ''}</Badge> : null}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <label className="text-muted-foreground inline-flex items-center gap-2 text-control">
            {t('logbooks.technical')}
            <Switch checked={technical} onCheckedChange={setTechnical} aria-label={t('logbooks.technical')} data-testid="activity-technical" />
          </label>
          {canReport ? <Button variant="outline" onClick={() => setReport(true)} data-testid="activity-report-open"><ClipboardCopy />{t('logbooks.report')}</Button> : null}
        </div>
      ) : null}
      <div className="toolbar flex flex-wrap items-center gap-2">
        {paged ? (
          <>
            <Select value={view.project || ALL} onValueChange={(project) => set({ project: project === ALL ? '' : project })} options={projectOptions} prefix={t('logbooks.project')} title={t('logbooks.project')} data-testid="activity-project" />
            <Select value={view.range} onValueChange={(range) => set({ range })} options={rangeOptions} prefix={t('logbooks.date')} title={t('logbooks.date')} data-testid="activity-range" />
          </>
        ) : null}
        <SearchInput value={view.q} onChange={(q) => set({ q })} placeholder={t('activity.search')} className="min-w-56 flex-1" data-testid="activity-search" />
      </div>
      {paged && view.range === 'custom' ? (
        <div className="toolbar flex flex-wrap items-center gap-2" data-testid="activity-custom">
          <DateField label={t('logbooks.from')} value={view.from} max={view.to || undefined} fallback={today} onChange={(from) => set({ from })} data-testid="activity-from" />
          <span className="text-muted-foreground">–</span>
          <DateField label={t('logbooks.to')} value={view.to} min={view.from || undefined} fallback={today} onChange={(to) => set({ to })} data-testid="activity-to" />
        </div>
      ) : null}
      {paged && chips.length ? (
        <div className="fchips flex flex-wrap items-center gap-2" data-testid="activity-chips">
          {chips.map((c) => (
            <span key={c.key} className="fchip bg-secondary text-foreground inline-flex h-(--ctl-sm) items-center gap-1 rounded-full pr-1 pl-3 text-control" data-testid={`activity-chip-${c.key}`}>
              {chipText(c)}
              <IconButton small label={t('logbooks.removeFilter', { name: chipText(c) })} onClick={() => setView((v) => clearChip(v, c.key))}><X /></IconButton>
            </span>
          ))}
          <Button variant="ghost" onClick={() => setView(EMPTY_VIEW)} data-testid="activity-clear"><FilterX />{t('logbooks.clear')}</Button>
        </div>
      ) : null}
      <ListCard>
        {paged && items.length ? (
          <div className={cn('arow head text-faint-foreground grid items-center gap-3 px-3.5 py-2 text-micro uppercase max-sm:hidden', COLS)} aria-hidden="true">
            <span>{t('logbooks.colTime')}</span><span>{t('logbooks.colSource')}</span><span>{t('logbooks.colLevel')}</span><span>{t('logbooks.colProject')}</span><span>{t('logbooks.colWhat')}</span>
          </div>
        ) : null}
        {items.length ? items.map((r) => (paged
          ? <PagedRow key={r.id} r={r} t={t} locale={locale} technical={technical} open={open === r.id} onOpen={() => setOpen((o) => (o === r.id ? null : r.id))} marked={moment?.id === r.id} canMark={canReport} onMark={() => setMoment((m) => (m?.id === r.id ? null : r))} />
          : <LegacyRow key={r.id} r={r.legacy} t={t} locale={locale} />))
          : paged && (chips.length || view.tab !== 'todo') ? (
            <Empty icon={ListFilter} title={t('logbooks.noMatch')}>
              <p className="m-0 mb-3">{t('logbooks.noMatchHint')}</p>
              <Button variant="outline" onClick={() => setView(EMPTY_VIEW)} data-testid="activity-clear-empty"><FilterX />{t('logbooks.clear')}</Button>
            </Empty>
          ) : <Empty icon={Activity} title={t('activity.empty')} />}
      </ListCard>
      {paged ? (
        <div className="toolbar flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground m-0 text-caption">{t('logbooks.local')}</span>
          <BubbleTip title={t('logbooks.localHint')}><IconButton small label={t('logbooks.localHelp')} data-testid="activity-local-help"><CircleHelp /></IconButton></BubbleTip>
          <span className="flex-1" />
          {page.next ? <Button variant="outline" onClick={more} disabled={loading} data-testid="activity-more">{loading ? <Spinner /> : null}{t('logbooks.loadMore')}</Button> : null}
        </div>
      ) : null}
      {paged && canReport ? <ReportDialog open={report} onOpenChange={setReport} moment={moment?.at ? moment : null} summary={moment ? summary(moment) : ''} /> : null}
    </BitacorasPage>
  );
}

// A line of the older engine: the raw event of the board.
function LegacyRow({ r, t, locale }) {
  return (
    <div onClick={() => r.task_id && go({ view: 'tasks', id: r.task_id })} className={`lrow grid grid-cols-[120px_110px_1fr] gap-3 border-b px-3.5 py-2.5 text-control last:border-b-0 ${r.task_id ? 'hover:bg-accent/50 cursor-pointer' : ''}`}>
      <span className="text-muted-foreground">{fmtTime(r.at)}</span>
      <span className="truncate">{AGENT[r.actor] ?? r.actor}</span>
      {/* each event in words; the raw one on hover and in «Copiar». */}
      <span className="min-w-0" title={`${r.kind}${r.detail ? ` ${r.detail}` : ''}`}><span className="font-medium">{activityLabel(t, r.kind)}</span>{r.task_id ? <span className="text-muted-foreground"> · #{r.task_id} {r.title ?? ''}</span> : null}{activityDetail(t, r, locale, AGENT, LINE) ? <span className="text-muted-foreground block break-words">{activityDetail(t, r, locale, AGENT, LINE)}</span> : null}</span>
    </div>
  );
}

// What a line of the paged reader says: one sentence («Claude Code empezó la tarea #42 «…»»), from the event's own parts or
// from the line's text. r.text stays as the engine wrote it (hover and «Copiar»).
const what = (r, t, locale, max = 0) => activitySentence(t, r, locale, AGENT, max);

// A line of the paged reader; it opens to show where it came from. Its text is plain text, never markup.
function PagedRow({ r, t, locale, technical, open, onOpen, marked, canMark, onMark }) {
  const SrcIcon = SOURCE_ICON[r.source] ?? Monitor;
  // the event's name in words; the engine's own names (a log stream, an unknown kind) say nothing to a person
  const kindLabel = r.kind && activityLabel(t, r.kind) !== r.kind ? activityLabel(t, r.kind) : '';
  return (
    <div className={cn('border-border border-b last:border-b-0', marked && 'bg-accent/60')} data-level={r.level} data-testid="activity-row">
      <button type="button" onClick={onOpen} aria-expanded={open} className={cn('lrow arow hover:bg-accent/60 grid w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-ring', COLS, COLS_NARROW)}>
        <span className="text-muted-foreground font-mono text-caption" title={fmtTime(r.at)}>{hourOf(r.at)}</span>
        <span className="src inline-flex max-sm:text-caption items-center gap-1.5 truncate text-control"><SrcIcon className="text-muted-foreground size-3.5 shrink-0" />{t(`logbooks.source.${r.source}`)}</span>
        <Badge variant={LEVEL_BADGE[r.level] ?? 'info'} className="w-full justify-center">{t(`logbooks.level.${r.level}`)}</Badge>
        <span className="proj text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-caption">{r.project ? <ProjectIcon name={r.project} /> : null}<span className="truncate">{r.project ?? t('logbooks.noProject')}</span></span>
        <span className="what max-sm:order-first max-sm:col-span-full min-w-0 text-control break-words whitespace-pre-wrap" title={r.text}>{what(r, t, locale, LINE)}</span>
      </button>
      {open ? (
        <div className="detail bg-secondary border-border border-t px-3.5 pt-3 pb-3.5 pl-16" data-testid="activity-detail">
          <dl className="kv m-0 mb-2.5 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-control">
            <dt className="text-muted-foreground">{t('logbooks.source')}</dt><dd className="m-0">{t(`logbooks.source.${r.source}`)}{kindLabel ? ` · ${kindLabel}` : ''}</dd>
            <dt className="text-muted-foreground">{t('logbooks.colTime')}</dt><dd className="m-0">{fmtTime(r.at)}</dd>
            {r.task != null ? <><dt className="text-muted-foreground">{t('logbooks.task')}</dt><dd className="m-0" data-testid="activity-task">#{r.task}</dd></> : null}
            <dt className="text-muted-foreground">{t('logbooks.project')}</dt><dd className="m-0">{r.project ?? t('logbooks.noProject')}</dd>
          </dl>
          <pre className="bg-card border-border rounded-ctl m-0 mb-2.5 border px-2.5 py-2 text-caption whitespace-pre-wrap break-words"><code>{what(r, t, locale)}</code></pre>
          {technical && r.text && r.text !== what(r, t, locale) ? <pre className="bg-card border-border text-muted-foreground rounded-ctl m-0 mb-2.5 border px-2.5 py-2 font-mono text-caption whitespace-pre-wrap break-words" data-testid="activity-raw"><code>{r.text}</code></pre> : null}
          {(canMark && r.at) || r.task != null ? (
            <div className="flex justify-end gap-1.5">
              {canMark && r.at ? <Button variant="outline" aria-pressed={marked} onClick={onMark} title={marked ? t('logbooks.marked') : t('logbooks.mark')} data-testid="activity-mark">{marked ? <SquareCheck /> : <Bug />}{t(marked ? 'logbooks.marked' : 'logbooks.markShort')}</Button> : null}
              {/* the engine names a task only while it exists */}
              {r.task != null ? <Button onClick={() => go({ view: 'tasks', id: r.task })} data-testid="activity-review-task"><ArrowRight />{t('logbooks.reviewTask', { n: r.task })}</Button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
