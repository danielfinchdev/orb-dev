// Bitácoras: Orb's journal (the general log and one per project). Read-only here: only the assistant appends.
// Nothing is read until the tab opens, and only the log on screen is loaded; the one search box looks in this log or in
// all of them, and the others are read only while something is typed in it.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Maximize2, BookOpen, Library, Lock, ChevronRight, Circle, CircleHelp, X } from 'lucide-react';
import { notifyOk } from '@/lib/notify.js';
import { Markdown } from '@/components/markdown.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { Badge, Empty, Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { BubbleTip, DropdownMenuItem, Select, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { IconButton, ListCard, NavRow, SearchInput } from '@/components/ui/primitives.jsx';
import { useStore, call } from '@/lib/store.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { highlightIn, foldText } from '@/lib/mark-matches.js';
import { groupLogs, parseEntries, authorAgent, foldedEntries, countFolded } from '@/lib/logbook.js';
import { BitacorasPage } from './bitacoras-page.jsx';

const kb = (size) => `${Math.max(1, Math.ceil(size / 1024))} KB`;
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// «hoy, 11 nov · 10:12»: today and yesterday in words, any other day by its short name.
function stamp(e, t, locale) {
  if (!e.date) return '';
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const short = e.date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const day = dayKey(e.date) === dayKey(now) ? `${t('logbooks.today')}, ${e.date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}` : dayKey(e.date) === dayKey(yesterday) ? `${t('logbooks.yesterday')}, ${e.date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}` : short;
  return e.time ? `${day} · ${e.time}` : day;
}

// A sub-heading of the list of logs (.lbl)
function Lbl({ children }) { return <div className="lbl text-faint-foreground px-2.5 pt-2.5 pb-1 text-micro uppercase first:pt-1">{children}</div>; }

function Entry({ e, t, locale, query }) {
  return (
    <article className="entry bg-card border-border rounded-card [&_mark]:bg-primary-soft [&_mark]:text-foreground border px-3.5 py-3 [&_mark]:rounded-sm [&_mark]:px-0.5" data-testid="log-entry">
      {/* the key holds the query: a new one draws the entry again, so React never reconciles text nodes the marks replaced */}
      <MarkedBody key={query} query={query}>
        <div className="top text-muted-foreground flex items-center gap-2 text-caption">
          <span data-agent={authorAgent(e.author)} aria-hidden="true" className="inline-flex"><Circle className="size-2 fill-current" /></span>
          {e.author ? <b className="text-foreground font-medium">{e.author}</b> : null}
          {e.date ? <time>{stamp(e, t, locale)}</time> : null}
          <span className="ml-auto">#{e.n}</span>
        </div>
        <h3 className="mt-1.5 mb-1 font-(family-name:--title) text-card-title font-semibold">{e.topic}</h3>
        {e.parts?.length ? (
          <>
            {e.lead ? <div className="text-body"><Markdown>{e.lead}</Markdown></div> : null}
            <dl className="kv mt-2 mb-0 grid grid-cols-[80px_minmax(0,1fr)] gap-x-2.5 gap-y-2.25 text-body" data-testid="log-entry-parts">
              {e.parts.map((p, i) => (
                <Fragment key={i}>
                  <dt className="text-muted-foreground" data-part={p.key}>{t(`logbooks.part.${p.key}`)}</dt>
                  <dd className="m-0 min-w-0 [&_p]:m-0"><Markdown>{p.text}</Markdown></dd>
                </Fragment>
              ))}
            </dl>
          </>
        ) : e.body ? <div className="text-body"><Markdown>{e.body}</Markdown></div> : null}
      </MarkedBody>
    </article>
  );
}

// Marks the query on the text nodes once the children are drawn. The cleanup is guarded: the nodes may be gone already.
function MarkedBody({ query, children }) {
  const ref = useRef(null);
  useEffect(() => {
    let undo = () => {};
    try { undo = highlightIn(ref.current, query); } catch { /* an entry without marks is still readable */ }
    return () => { try { undo(); } catch { /* removed with the entry */ } };
  }, [query]);
  return <div ref={ref}>{children}</div>;
}

const displayName = (name, t) => (name === 'general' ? t('logs.general') : name.replace(/\s*eliminad[oa]$/i, ''));

export function LogsView({ route, tabs }) {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const [logs, setLogs] = useState([]);
  const dir = logs.find((l) => l.dir)?.dir;
  const [selected, setSelected] = useState(route.name ?? 'general');
  const [whole, setWhole] = useState(false);
  const [read, setRead] = useState({ log: null, text: null });
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [scope, setScope] = useState('here');
  const [hits, setHits] = useState(null);
  const [tick, setTick] = useState(0);
  const cache = useRef({});
  // the filter, the marks and the other logs wait for a pause in the typing
  useEffect(() => { const h = setTimeout(() => setDq(q), 180); return () => clearTimeout(h); }, [q]);
  const shown = dq.trim();
  const needle = foldText(shown);
  // the text of this log stays on view while the whole one is read (the list keeps its scroll); another log starts empty
  const body = read.log === selected ? read.text : null;
  // a search in this log reads it whole: the short reading only has its latest entries
  const full = whole || needle.length > 0;
  useEffect(() => { call('logs.list').then(setLogs).catch(quiet); }, [version, tick]);
  useEffect(() => {
    let alive = true;
    const put = (text) => { if (alive) setRead({ log: selected, text }); };
    call('logs.read', { project: selected, whole: full }).then(put).catch((e) => put(e.message));
    return () => { alive = false; };
  }, [selected, full, version, tick]);
  useEffect(() => { cache.current = {}; }, [tick]);
  // The search across all of them reads each log whole (the short reading only has the latest entries) and one after
  // another, and keeps it until its size changes: a refresh of the app while agents work reads nothing again.
  const sizes = logs.map((l) => `${l.name}:${l.size}`).join('|');
  const searching = shown.length >= 2;
  useEffect(() => {
    setHits(null);
    if (!searching) return undefined;
    let alive = true;
    const h = setTimeout(async () => {
      for (const l of logs) {
        if (!alive) return;
        if (cache.current[l.name]?.size !== l.size) {
          const text = await call('logs.read', { project: l.name, whole: true }).then((b) => String(b ?? ''), () => '');
          cache.current[l.name] = { size: l.size, entries: foldedEntries(text) };
        }
        // give the window a turn between two logs
        await new Promise((done) => { setTimeout(done, 0); });
      }
      if (alive) setHits(countFolded(Object.fromEntries(logs.map((l) => [l.name, cache.current[l.name]?.entries ?? []])), needle));
    }, 300);
    return () => { alive = false; clearTimeout(h); };
    // `sizes` stands for `logs`: the list is a new array on every refresh, its sizes only change when a log is written
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, searching, sizes, tick]);
  const groups = useMemo(() => groupLogs(logs), [logs]);
  const partial = body?.startsWith('(');
  const parsed = useMemo(() => (body == null ? null : parseEntries(body)), [body]);
  // each entry folded once; the filter and the marks use the same folding (no case, no accents)
  const folded = useMemo(() => (parsed ? parsed.entries.map((e) => foldText(e.raw)) : null), [parsed]);
  const entries = useMemo(() => {
    if (!parsed) return null;
    const list = needle ? parsed.entries.filter((e, i) => folded[i].includes(needle)) : parsed.entries;
    return [...list].reverse();
  }, [parsed, folded, needle]);
  const pick = (name) => { setSelected(name); setWhole(false); setScope('here'); };
  const row = (l, title, mark) => (
    <NavRow key={l.name} label={title} active={selected === l.name} onClick={() => pick(l.name)} iconEl={mark}>
      <span className="nn text-faint-foreground text-caption" title={kb(l.size)}>{l.entries ?? kb(l.size)}</span>
    </NavRow>
  );
  const title = displayName(selected, t);
  // the header says how many entries the log has (the list of logs knows), not how many of them are loaded
  const mine = logs.find((l) => l.name === selected);
  const loaded = parsed?.entries.length ?? 0;
  const total = Number.isFinite(mine?.entries) ? mine.entries : loaded;
  const copy = () => navigator.clipboard.writeText(body ?? '').then(() => notifyOk(t('logs.copied')));
  // the other logs that mention the text, most hits first
  const others = hits ? logs.filter((l) => l.name !== selected && hits[l.name]).sort((a, b) => hits[b.name] - hits[a.name]) : [];
  const ranked = hits ? logs.filter((l) => hits[l.name]).sort((a, b) => hits[b.name] - hits[a.name]) : [];
  const allMode = scope === 'all' && searching;
  const markOf = (l) => (l.name === 'general' ? <BookOpen className="size-4 shrink-0" /> : /eliminad[oa]$/i.test(l.name) ? <Circle className="size-2.5 shrink-0" /> : <ProjectIcon name={l.name} />);
  const scopeOptions = useMemo(() => [{ value: 'here', label: t('logbooks.scope.here'), icon: <BookOpen className="size-4" /> }, { value: 'all', label: t('logbooks.scope.all'), icon: <Library className="size-4" /> }], [t]);
  // «Copiar» and «Ver completa» are not in the mock-up's bar: they live in the «⋯» of the page.
  const menuItems = (
    <>
      {partial && !whole ? <DropdownMenuItem onSelect={() => setWhole(true)} data-testid="log-whole"><Maximize2 />{t('logs.whole')}</DropdownMenuItem> : null}
      <DropdownMenuItem onSelect={copy} data-testid="log-copy"><Copy />{t('logs.copy')}</DropdownMenuItem>
    </>
  );
  return (
    <BitacorasPage meta={t('nav.logbooksHint')} menuItems={menuItems} onRefresh={() => setTick((n) => n + 1)} tabs={tabs}>
      <div className="toolbar flex flex-wrap items-center gap-2" data-testid="log-search-bar">
        <SearchInput value={q} onChange={setQ} placeholder={t('logbooks.searchEntries')} className="min-w-56 flex-1" data-testid="log-search" />
        <Select value={scope} onValueChange={setScope} options={scopeOptions} title={t('logbooks.scope')} data-testid="log-scope" />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 lg:sticky lg:top-0">
          <ListCard className="smenu p-1.5" role="navigation" aria-label={t('logbooks.title')}>
            {groups.general ? <><Lbl>{t('logbooks.groupGeneral')}</Lbl>{row(groups.general, t('logs.general'), <BookOpen className="size-4 shrink-0" />)}</> : null}
            {groups.projects.length ? <><Lbl>{t('logbooks.groupProjects')}</Lbl>{groups.projects.map((l) => row(l, l.name, <ProjectIcon name={l.name} />))}</> : null}
            {groups.deleted.length ? <><Lbl>{t('logbooks.groupDeleted')}</Lbl>{groups.deleted.map((l) => row(l, displayName(l.name, t), <Circle className="size-2.5 shrink-0" />))}</> : null}
          </ListCard>
          <p className="note text-muted-foreground m-0 flex items-center gap-1.5 px-1 text-caption">
            <Lock className="size-3.5 shrink-0" />{t('logbooks.private')}
            <BubbleTip title={dir ? t('logbooks.privateAt', { dir }) : t('logbooks.private')}><IconButton small label={t('logbooks.where')} data-testid="log-private-help"><CircleHelp /></IconButton></BubbleTip>
          </p>
        </div>
        {allMode ? (
          <div className="entries flex min-w-0 flex-col gap-3" data-testid="log-all">
            <div className="bhead flex min-h-(--ctl) items-center gap-2">
              <Library className="size-4 shrink-0" />
              <h2 className="m-0 font-(family-name:--title) text-title font-semibold">{t('logbooks.allTitle')}</h2>
              {hits ? <span className="text-muted-foreground text-caption" data-testid="log-all-count">{t('logbooks.hitsTitle', { n: Object.values(hits).reduce((a, b) => a + b, 0), q: shown })}</span> : null}
            </div>
            {hits == null ? <Spinner /> : ranked.length === 0 ? (
              <Empty icon={BookOpen} title={t('logbooks.noHits')}>
                <p className="m-0 mb-3">{t('logbooks.noHitsHint')}</p>
                <Button variant="outline" onClick={() => { setQ(''); setDq(''); }} data-testid="log-search-clear"><X />{t('logbooks.clearSearch')}</Button>
              </Empty>
            ) : (
              <ListCard>
                {ranked.map((l) => (
                  <div key={l.name} className="lrow border-border flex items-center gap-3 border-b px-3.5 py-2.5 last:border-b-0" data-testid="log-all-row">
                    <span className="inline-flex w-5 justify-center">{markOf(l)}</span>
                    <div className="min-w-0 flex-1"><b className="font-medium">{displayName(l.name, t)}</b><div className="text-muted-foreground text-caption">{hits[l.name] === 1 ? t('logbooks.hitsOne') : t('logbooks.hitsMany', { n: hits[l.name] })}</div></div>
                    <Button variant="outline" onClick={() => pick(l.name)} data-testid="log-all-open">{t('logbooks.open')}</Button>
                  </div>
                ))}
              </ListCard>
            )}
          </div>
        ) : (
          <div className="entries flex min-w-0 flex-col gap-3">
            <div className="bhead flex min-h-(--ctl) items-center gap-2">
              {selected === 'general' ? null : <ProjectIcon small name={title} />}
              <h2 className="m-0 font-(family-name:--title) text-title font-semibold">{title}</h2>
              <span className="text-muted-foreground text-caption" data-testid="log-count">{needle ? t('logbooks.entriesOf', { n: entries?.length ?? 0, total }) : t('logbooks.entriesCount', { n: total })}</span>
              <span className="flex-1" />
              <Badge variant="secondary" title={t('logbooks.readOnlyHint')}>{t('logbooks.readOnly')}</Badge>
            </div>
            <p className="bintro text-muted-foreground -mt-1.5 text-control">{t(selected === 'general' ? 'logbooks.introGeneral' : 'logbooks.intro', { name: title })}</p>
            {searching && hits == null ? <p className="text-muted-foreground m-0 flex items-center gap-2 text-caption" data-testid="log-also-loading"><Spinner />{t('logbooks.searching')}</p> : null}
            {searching && others.length ? (
              <div className="also flex flex-wrap items-center gap-2" data-testid="log-also">
                <span className="text-muted-foreground text-caption">{t('logbooks.alsoIn')}</span>
                {others.map((l) => <Button key={l.name} variant="secondary" onClick={() => pick(l.name)} data-testid="log-also-open">{displayName(l.name, t)} <span className="text-muted-foreground tabular-nums">{hits[l.name]}</span></Button>)}
              </div>
            ) : null}
            {!needle && !partial && parsed?.pre ? (
              <Collapsible className="bg-card border-border rounded-card border" data-testid="log-intro">
                <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left text-control">
                  <ChevronRight className="text-muted-foreground size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />{t('logbooks.preamble')}
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3.5 pb-3 text-body"><Markdown>{parsed.pre}</Markdown></CollapsibleContent>
              </Collapsible>
            ) : null}
            <div className="flex flex-col gap-3" data-testid="log-body">
              {partial && !needle && parsed?.pre ? <p className="text-muted-foreground text-caption">{parsed.pre}</p> : null}
              {entries == null ? <Spinner /> : entries.length === 0 ? <Empty icon={BookOpen} title={t(needle ? 'logbooks.noEntries' : 'logbooks.noEntriesYet')} /> : entries.map((e) => <Entry key={e.n} e={e} t={t} locale={locale} query={shown} />)}
              {partial && !whole && !needle && entries?.length ? (
                <div className="viewing text-muted-foreground flex items-center justify-center gap-2 text-control" data-testid="log-viewing">
                  <span>{t('logbooks.viewing', { n: loaded })}</span><span aria-hidden="true">·</span>
                  <Button variant="ghost" onClick={() => setWhole(true)} data-testid="log-more">{t('logbooks.viewMore')}</Button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </BitacorasPage>
  );
}
