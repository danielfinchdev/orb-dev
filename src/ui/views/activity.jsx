// Activity: every event of Orb (who did what and when). A newer engine reads it by pages and filters it by source,
// level, project, dates and text; an older one answers the plain list of events, and then only the text search stays.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Copy, Bug, Orbit, Bot, User, Monitor, Info, TriangleAlert, CircleAlert, Check } from 'lucide-react';
import { notifyOk } from '@/lib/notify.js';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, Empty, Input, Spinner } from '@/components/ui/basic.jsx';
import { Select } from '@/components/ui/overlay.jsx';
import { SearchInput, Segmented } from '@/components/ui/primitives.jsx';
import { useStore, call, go } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { cn, fmtTime } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { activityLabel, activityDetail } from '@/lib/activity.js';
import { SOURCES, EMPTY_FILTERS, buildQuery, normalizeActivity, appendPage, hasFilters, hasMethod } from '@/lib/activity-filters.js';
import { quiet } from '@/lib/quiet.js';
import { ReportDialog } from './activity-report.jsx';

// Radix Select has no empty value for «every project»
const ALL = '*';
const SOURCE_ICON = { orb: Orbit, subagentes: Bot, usuario: User, app: Monitor };
// the level is told by icon and word, never by colour alone
const LEVEL_ICON = { info: Info, warn: TriangleAlert, error: CircleAlert };
const LEVEL_TONE = { info: 'text-muted-foreground', warn: 'text-warning-ink', error: 'text-destructive' };

// bare: inside «Bitácoras»: the search and copy go above the list instead of in a header of its own.
export function ActivityView({ bare = false }) {
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
  const gen = useRef(0);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  useEffect(() => {
    const mine = ++gen.current; // a slow older answer never lands over a newer one
    const h = setTimeout(() => call('activity.list', buildQuery(filters)).then((r) => { if (gen.current === mine) setPage(normalizeActivity(r)); }).catch(quiet), 200);
    return () => clearTimeout(h);
  }, [filters, version]);
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
  const projectOptions = useMemo(() => [{ value: ALL, label: t('logbooks.allProjects') }, ...(projects ?? []).map((p) => ({ value: p.name, label: p.name }))], [projects, t]);
  const summary = (r) => `${t(`logbooks.level.${r.level}`)} · ${String(r.text).slice(0, 80)}`;
  return (
    <>
      {bare ? null : <PageHeader icon={<History className="text-primary-text size-5" />} title={t('activity.title')} meta={t('activity.meta')} />}
      <PageBody className="px-5 py-5 md:pb-28">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput value={filters.q} onChange={(q) => set({ q })} placeholder={t('activity.search')} data-testid="activity-search" />
          <span className="flex-1" />
          {paged && canReport ? <Button size="sm" variant="outline" onClick={() => setReport(true)} data-testid="activity-report-open"><Bug />{t('logbooks.report')}</Button> : null}
          <Button size="sm" variant="ghost" onClick={copy}><Copy />{t('activity.copy')}</Button>
        </div>
        {paged ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label={t('logbooks.filters')} data-testid="activity-filters">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-micro uppercase">{t('logbooks.source')}</span>
              {SOURCES.map((s) => {
                const Icon = SOURCE_ICON[s]; const on = filters.sources.includes(s);
                return (
                  <button key={s} type="button" aria-pressed={on} onClick={() => toggleSource(s)} data-testid={`activity-source-${s}`}
                    className={cn('flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-control transition-colors', on ? 'border-primary-text bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {on ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}{t(`logbooks.source.${s}`)}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-micro uppercase">{t('logbooks.level')}</span>
              <Segmented value={filters.level} onChange={(level) => set({ level })} options={[{ value: 'info', label: t('logbooks.levelAll') }, { value: 'warn', label: t('logbooks.levelWarn') }, { value: 'error', label: t('logbooks.levelError') }]} data-testid="activity-level" />
            </div>
            <Select value={filters.project || ALL} onValueChange={(project) => set({ project: project === ALL ? '' : project })} options={projectOptions} title={t('logbooks.project')} size="sm" data-testid="activity-project" />
            <label className="text-muted-foreground flex items-center gap-1.5 text-control">{t('logbooks.from')}<Input type="date" className="h-8 w-40" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} data-testid="activity-from" /></label>
            <label className="text-muted-foreground flex items-center gap-1.5 text-control">{t('logbooks.to')}<Input type="date" className="h-8 w-40" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} data-testid="activity-to" /></label>
            {hasFilters(filters) ? <Button size="sm" variant="ghost" onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, q: f.q }))}>{t('logbooks.clear')}</Button> : null}
          </div>
        ) : null}
        <Card className="gap-0 py-0">
          {items.length ? items.map((r) => (paged ? <PagedRow key={r.id} r={r} t={t} marked={moment?.id === r.id} canMark={canReport} onMark={() => setMoment((m) => (m?.id === r.id ? null : r))} /> : <LegacyRow key={r.id} r={r.legacy} t={t} locale={locale} />)) : <Empty icon={History} title={t('activity.empty')} />}
        </Card>
        {paged ? (
          <div className="text-muted-foreground mt-3 flex items-center justify-between gap-3 text-control">
            <span>{t('logbooks.local')}</span>
            {page.next ? <Button size="sm" variant="outline" onClick={more} disabled={loading} data-testid="activity-more">{loading ? <Spinner /> : null}{t('logbooks.loadMore')}</Button> : null}
          </div>
        ) : null}
      </PageBody>
      {paged && canReport ? <ReportDialog open={report} onOpenChange={setReport} moment={moment?.at ? moment : null} summary={moment ? summary(moment) : ''} /> : null}
    </>
  );
}

// A line of the older engine: the raw event of the board.
function LegacyRow({ r, t, locale }) {
  return (
    <div onClick={() => r.task_id && go({ view: 'tasks', id: r.task_id })} className={`grid grid-cols-[120px_110px_1fr] gap-3 border-b px-4 py-2.5 text-control last:border-b-0 ${r.task_id ? 'hover:bg-accent/50 cursor-pointer' : ''}`}>
      <span className="text-muted-foreground">{fmtTime(r.at)}</span>
      <span className="truncate">{AGENT[r.actor] ?? r.actor}</span>
      {/* each event in words; the raw one on hover and in «Copiar». */}
      <span className="min-w-0" title={`${r.kind}${r.detail ? ` ${r.detail}` : ''}`}><span className="font-medium">{activityLabel(t, r.kind)}</span>{r.task_id ? <span className="text-muted-foreground"> · #{r.task_id} {r.title ?? ''}</span> : null}{activityDetail(t, r, locale, AGENT) ? <span className="text-muted-foreground block break-words">{activityDetail(t, r, locale, AGENT)}</span> : null}</span>
    </div>
  );
}

// A line of the paged reader. Its text is plain text, never markup.
function PagedRow({ r, t, marked, canMark, onMark }) {
  const SrcIcon = SOURCE_ICON[r.source] ?? Monitor;
  const LvlIcon = LEVEL_ICON[r.level] ?? Info;
  return (
    <div className={cn('grid grid-cols-[96px_120px_90px_120px_1fr_auto] items-start gap-3 border-b px-4 py-2.5 text-control last:border-b-0', marked && 'bg-accent/60')} data-level={r.level}>
      <span className="text-muted-foreground">{fmtTime(r.at)}</span>
      <span className="flex items-center gap-1.5 truncate"><SrcIcon className="text-muted-foreground size-3.5 shrink-0" />{t(`logbooks.source.${r.source}`)}</span>
      <span className={cn('flex items-center gap-1.5', LEVEL_TONE[r.level])}><LvlIcon className="size-3.5 shrink-0" />{t(`logbooks.level.${r.level}`)}</span>
      <span className="text-muted-foreground truncate">{r.project ?? t('logbooks.noProject')}</span>
      <span className="min-w-0 break-words whitespace-pre-wrap" title={r.kind}>{r.text}</span>
      {canMark && r.at ? <button type="button" aria-pressed={marked} title={marked ? t('logbooks.marked') : t('logbooks.mark')} aria-label={marked ? t('logbooks.marked') : t('logbooks.mark')} onClick={onMark} className={cn('cursor-pointer rounded-md p-1', marked ? 'text-primary-text' : 'text-muted-foreground hover:text-foreground')}><Bug className="size-3.5" /></button> : <span />}
    </div>
  );
}
