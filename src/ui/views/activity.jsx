// Activity: every event of Orb (who did what and when). A newer engine reads it by pages and filters it by source,
// level, project, dates and text; an older one answers the plain list of events, and then only the text search stays.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Bug, Orbit, Bot, User, Monitor, Activity, ClipboardCopy, FilterX, SquareCheck } from 'lucide-react';
import { notifyOk } from '@/lib/notify.js';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Empty, Input, Spinner } from '@/components/ui/basic.jsx';
import { DropdownMenuItem, Select } from '@/components/ui/overlay.jsx';
import { ListCard, SearchInput } from '@/components/ui/primitives.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { useStore, call, go } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { cn, fmtTime } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { activityLabel, activityDetail } from '@/lib/activity.js';
import { SOURCES, LEVELS, EMPTY_FILTERS, buildQuery, normalizeActivity, appendPage, hasFilters, hasMethod } from '@/lib/activity-filters.js';
import { quiet } from '@/lib/quiet.js';
import { ReportDialog } from './activity-report.jsx';
import { BitacorasPage } from './bitacoras-page.jsx';

// Radix Select has no empty value for «every project»
const ALL = '*';
const SOURCE_ICON = { orb: Orbit, subagentes: Bot, usuario: User, app: Monitor };
// the level is told by the word of its badge, never by colour alone
const LEVEL_BADGE = { info: 'info', warn: 'warning', error: 'destructive' };
// the hour only: the day is in the tooltip and in the detail
const hourOf = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
// The level filter keeps its threshold (info = everything, warn = warnings and errors, error = errors only); the three chips
// show which levels that threshold lets in, and a chip moves it: the lowest lit one turns off, any other sets it.
const levelOn = (level, l) => LEVELS.indexOf(l) >= LEVELS.indexOf(level);
const nextLevel = (level, l) => (l === level ? LEVELS[Math.min(LEVELS.indexOf(level) + 1, LEVELS.length - 1)] : l);
const CHIP = 'inline-flex h-(--ctl-sm) cursor-pointer items-center gap-1.5 rounded-[calc(var(--r-ctl)-2px)] px-2.5 text-control whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-ring';
const COLS = 'grid-cols-[52px_150px_72px_150px_minmax(0,1fr)]';

export function ActivityView({ tabs }) {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const projects = useStore((s) => s.projects);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState({ paged: false, items: [], next: null });
  const [loading, setLoading] = useState(false);
  const [canReport, setCanReport] = useState(false);
  const [report, setReport] = useState(false);
  const [moment, setMoment] = useState(null);
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);
  const gen = useRef(0);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  useEffect(() => {
    const mine = ++gen.current; // a slow older answer never lands over a newer one
    const h = setTimeout(() => call('activity.list', buildQuery(filters)).then((r) => { if (gen.current === mine) setPage(normalizeActivity(r)); }).catch(quiet), 200);
    return () => clearTimeout(h);
  }, [filters, version, tick]);
  // the report button only exists when the engine can write the report
  useEffect(() => { if (page.paged) hasMethod(call, 'activity.report', { lines: 1 }).then(setCanReport); }, [page.paged]);
  const more = useCallback(() => {
    const mine = gen.current;
    setLoading(true);
    call('activity.list', buildQuery(filters, page.next)).then((r) => { if (gen.current === mine) { const n = normalizeActivity(r); setPage((p) => ({ ...p, next: n.next, items: appendPage(p.items, n.items) })); } }).catch(quiet).finally(() => setLoading(false));
  }, [filters, page.next]);
  const { items, paged } = page;
  const copy = () => navigator.clipboard.writeText(items.map((r) => (r.legacy ? `${r.legacy.at}\t${r.legacy.actor}\t${r.legacy.kind}\t${r.legacy.task_id ? `#${r.legacy.task_id} ` : ''}${r.legacy.detail}` : `${r.at ?? ''}\t${r.source}\t${r.level}\t${r.project ?? ''}\t${r.text}`)).join('\n')).then(() => notifyOk(t('activity.copied')));
  const toggleSource = (s) => set({ sources: filters.sources.includes(s) ? filters.sources.filter((x) => x !== s) : [...filters.sources, s] });
  const projectOptions = useMemo(() => [{ value: ALL, label: t('logbooks.all') }, ...(projects ?? []).map((p) => ({ value: p.name, label: p.name, icon: <ProjectIcon name={p.name} /> }))], [projects, t]);
  const summary = (r) => `${t(`logbooks.level.${r.level}`)} · ${String(r.text).slice(0, 80)}`;
  // a source on show is one with no filter at all (every source) or the ones picked
  const sourceOn = (s) => (filters.sources.length ? filters.sources.includes(s) : true);
  // «Copiar» is not in the mock-up's bar: it lives in the «⋯» of the page.
  const menuItems = <DropdownMenuItem onSelect={copy} data-testid="activity-copy"><Copy />{t('activity.copy')}</DropdownMenuItem>;
  return (
    <BitacorasPage meta={t('nav.logbooksHint')} menuItems={menuItems} onRefresh={() => setTick((n) => n + 1)} tabs={tabs}>
      {paged ? (
        <div className="toolbar flex flex-wrap items-center gap-2" role="group" aria-label={t('logbooks.filters')} data-testid="activity-filters">
          <div className="segm bg-secondary inline-flex gap-0.5 rounded-ctl p-0.5" role="group" aria-label={t('logbooks.source')}>
            {SOURCES.map((s) => (
              <button key={s} type="button" aria-pressed={sourceOn(s)} onClick={() => toggleSource(s)} data-testid={`activity-source-${s}`}
                className={cn(CHIP, sourceOn(s) ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground')}>{t(`logbooks.source.${s}`)}</button>
            ))}
          </div>
          <div className="segm bg-secondary inline-flex gap-0.5 rounded-ctl p-0.5" role="group" aria-label={t('logbooks.level')} data-testid="activity-level">
            {LEVELS.map((l) => (
              <button key={l} type="button" aria-pressed={levelOn(filters.level, l)} onClick={() => set({ level: nextLevel(filters.level, l) })} data-testid={`activity-level-${l}`}
                className={cn(CHIP, levelOn(filters.level, l) ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground')}>{t(`logbooks.level.${l}`)}</button>
            ))}
          </div>
          <span className="flex-1" />
          {canReport ? <Button variant="outline" onClick={() => setReport(true)} data-testid="activity-report-open"><ClipboardCopy />{t('logbooks.report')}</Button> : null}
        </div>
      ) : null}
      <div className="toolbar flex flex-wrap items-center gap-2">
        {paged ? (
          <>
            <Select value={filters.project || ALL} onValueChange={(project) => set({ project: project === ALL ? '' : project })} options={projectOptions} prefix={t('logbooks.project')} title={t('logbooks.project')} data-testid="activity-project" />
            <Input type="date" className="w-34" aria-label={t('logbooks.from')} value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} data-testid="activity-from" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" className="w-34" aria-label={t('logbooks.to')} value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} data-testid="activity-to" />
          </>
        ) : null}
        <SearchInput value={filters.q} onChange={(q) => set({ q })} placeholder={t('activity.search')} className="w-70 flex-[0_1_280px]" data-testid="activity-search" />
        {paged ? <Button variant="ghost" disabled={!hasFilters(filters)} onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, q: f.q }))} data-testid="activity-clear"><FilterX />{t('logbooks.clear')}</Button> : null}
      </div>
      <ListCard>
        {paged ? (
          <div className={cn('arow head text-faint-foreground grid items-center gap-3 px-3.5 py-2 text-micro uppercase', COLS)} aria-hidden="true">
            <span>{t('logbooks.colTime')}</span><span>{t('logbooks.colSource')}</span><span>{t('logbooks.colLevel')}</span><span>{t('logbooks.colProject')}</span><span>{t('logbooks.colWhat')}</span>
          </div>
        ) : null}
        {items.length ? items.map((r) => (paged
          ? <PagedRow key={r.id} r={r} t={t} open={open === r.id} onOpen={() => setOpen((o) => (o === r.id ? null : r.id))} marked={moment?.id === r.id} canMark={canReport} onMark={() => setMoment((m) => (m?.id === r.id ? null : r))} />
          : <LegacyRow key={r.id} r={r.legacy} t={t} locale={locale} />)) : <Empty icon={Activity} title={t('activity.empty')} />}
      </ListCard>
      {paged ? (
        <div className="toolbar flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground m-0 text-caption">{t('logbooks.local')}</span>
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
      <span className="min-w-0" title={`${r.kind}${r.detail ? ` ${r.detail}` : ''}`}><span className="font-medium">{activityLabel(t, r.kind)}</span>{r.task_id ? <span className="text-muted-foreground"> · #{r.task_id} {r.title ?? ''}</span> : null}{activityDetail(t, r, locale, AGENT) ? <span className="text-muted-foreground block break-words">{activityDetail(t, r, locale, AGENT)}</span> : null}</span>
    </div>
  );
}

// A line of the paged reader; it opens to show where it came from. Its text is plain text, never markup.
function PagedRow({ r, t, open, onOpen, marked, canMark, onMark }) {
  const SrcIcon = SOURCE_ICON[r.source] ?? Monitor;
  return (
    <div className={cn('border-border border-b last:border-b-0', marked && 'bg-accent/60')} data-level={r.level} data-testid="activity-row">
      <button type="button" onClick={onOpen} aria-expanded={open} className={cn('lrow arow hover:bg-accent/60 grid w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-ring', COLS)}>
        <span className="text-muted-foreground font-mono text-caption" title={fmtTime(r.at)}>{hourOf(r.at)}</span>
        <span className="src inline-flex items-center gap-1.5 truncate text-control"><SrcIcon className="text-muted-foreground size-3.5 shrink-0" />{t(`logbooks.source.${r.source}`)}</span>
        <Badge variant={LEVEL_BADGE[r.level] ?? 'info'} className="w-full justify-center">{t(`logbooks.level.${r.level}`)}</Badge>
        <span className="proj text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-caption">{r.project ? <ProjectIcon name={r.project} /> : null}<span className="truncate">{r.project ?? t('logbooks.noProject')}</span></span>
        <span className="what min-w-0 text-control break-words whitespace-pre-wrap">{r.text}</span>
      </button>
      {open ? (
        <div className="detail bg-secondary border-border border-t px-3.5 pt-3 pb-3.5 pl-16" data-testid="activity-detail">
          <dl className="kv m-0 mb-2.5 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-control">
            <dt className="text-muted-foreground">{t('logbooks.source')}</dt><dd className="m-0">{t(`logbooks.source.${r.source}`)}{r.kind ? ` · ${r.kind}` : ''}</dd>
            <dt className="text-muted-foreground">{t('logbooks.colTime')}</dt><dd className="m-0">{fmtTime(r.at)}</dd>
            <dt className="text-muted-foreground">{t('logbooks.project')}</dt><dd className="m-0">{r.project ?? t('logbooks.noProject')}</dd>
          </dl>
          <pre className="bg-card border-border rounded-ctl m-0 mb-2.5 border px-2.5 py-2 text-caption whitespace-pre-wrap break-words"><code>{r.text}</code></pre>
          {canMark && r.at ? (
            <div className="flex justify-end gap-1.5">
              <Button variant="outline" aria-pressed={marked} onClick={onMark} title={marked ? t('logbooks.marked') : t('logbooks.mark')} data-testid="activity-mark">{marked ? <SquareCheck /> : <Bug />}{t(marked ? 'logbooks.marked' : 'logbooks.markShort')}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
