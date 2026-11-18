// Bitácoras: Orb's journal (the general log and one per project). Read-only here: only the assistant appends.
// Nothing is read until the tab opens, and only the log on screen is loaded; the search across all of them reads the
// others only while something is typed in it.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Maximize2, BookOpen, Lock, ChevronRight, Circle } from 'lucide-react';
import { notifyOk } from '@/lib/notify.js';
import { Markdown } from '@/components/markdown.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { Badge, Empty, Spinner } from '@/components/ui/basic.jsx';
import { BubbleTip, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { IconButton, ListCard, NavRow, SearchInput } from '@/components/ui/primitives.jsx';
import { useStore, call } from '@/lib/store.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { groupLogs, parseEntries, authorAgent, countHits } from '@/lib/logbook.js';
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

function Entry({ e, t, locale }) {
  return (
    <article className="entry bg-card border-border rounded-card border px-3.5 py-3" data-testid="log-entry">
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
    </article>
  );
}

export function LogsView({ route, tabs }) {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const [logs, setLogs] = useState([]);
  const dir = logs.find((l) => l.dir)?.dir;
  const [selected, setSelected] = useState(route.name ?? 'general');
  const [whole, setWhole] = useState(false);
  const [body, setText] = useState(null);
  const [q, setQ] = useState('');
  const [all, setAll] = useState('');
  const [hits, setHits] = useState(null);
  const [tick, setTick] = useState(0);
  const cache = useRef({});
  useEffect(() => { call('logs.list').then(setLogs).catch(quiet); }, [version, tick]);
  useEffect(() => { setText(null); call('logs.read', { project: selected, whole }).then(setText).catch((e) => setText(e.message)); }, [selected, whole, version, tick]);
  useEffect(() => { cache.current = {}; }, [tick]);
  // The search across all of them reads each log whole (the short reading only has the latest entries) and one after
  // another, and keeps it until its size changes: a refresh of the app while agents work reads nothing again.
  const sizes = logs.map((l) => `${l.name}:${l.size}`).join('|');
  useEffect(() => {
    const needle = all.trim();
    if (needle.length < 2) { setHits(null); return undefined; }
    let alive = true;
    const h = setTimeout(async () => {
      for (const l of logs) {
        if (!alive) return;
        if (cache.current[l.name]?.size === l.size) continue;
        const text = await call('logs.read', { project: l.name, whole: true }).then((b) => String(b ?? ''), () => '');
        cache.current[l.name] = { size: l.size, text };
      }
      if (alive) setHits(countHits(Object.fromEntries(logs.map((l) => [l.name, cache.current[l.name]?.text ?? ''])), needle));
    }, 300);
    return () => { alive = false; clearTimeout(h); };
    // `sizes` stands for `logs`: the list is a new array on every refresh, its sizes only change when a log is written
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, sizes, tick]);
  const groups = useMemo(() => groupLogs(logs), [logs]);
  const partial = body?.startsWith('(');
  const parsed = useMemo(() => (body == null ? null : parseEntries(body)), [body]);
  const needle = q.trim().toLowerCase();
  const entries = useMemo(() => {
    if (!parsed) return null;
    const list = needle ? parsed.entries.filter((e) => e.raw.toLowerCase().includes(needle)) : parsed.entries;
    return [...list].reverse();
  }, [parsed, needle]);
  const pick = (name) => { setSelected(name); setWhole(false); setQ(all.trim().length >= 2 ? all.trim() : ''); };
  const searching = all.trim().length >= 2;
  const visible = (l) => !searching || hits == null || Boolean(hits[l.name]);
  const row = (l, title, mark) => (
    <NavRow key={l.name} label={title} active={selected === l.name} onClick={() => pick(l.name)} iconEl={mark}>
      <span className="nn text-faint-foreground text-caption" title={kb(l.size)}>{searching && hits?.[l.name] ? hits[l.name] : l.entries ?? kb(l.size)}</span>
    </NavRow>
  );
  const none = searching && hits != null && !Object.keys(hits).length;
  const title = selected === 'general' ? t('logs.general') : selected.replace(/\s*eliminad[oa]$/i, '');
  const count = parsed?.entries.length ?? 0;
  const copy = () => navigator.clipboard.writeText(body ?? '').then(() => notifyOk(t('logs.copied')));
  const actions = (
    <>
      {partial && !whole ? <BubbleTip title={t('logs.whole')}><IconButton label={t('logs.whole')} onClick={() => setWhole(true)} data-testid="log-whole"><Maximize2 /></IconButton></BubbleTip> : null}
      <BubbleTip title={t('logs.copy')}><IconButton label={t('logs.copy')} onClick={copy} data-testid="log-copy"><Copy /></IconButton></BubbleTip>
    </>
  );
  return (
    <BitacorasPage meta={t('nav.logbooksHint')} actions={actions} onRefresh={() => setTick((n) => n + 1)} tabs={tabs}>
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 lg:sticky lg:top-0">
          <SearchInput value={all} onChange={setAll} placeholder={t('logbooks.searchAll')} className="h-(--ctl-sm) w-full" data-testid="log-search-all" />
          <ListCard className="smenu p-1.5" role="navigation" aria-label={t('logbooks.title')}>
            {none ? <p className="text-muted-foreground px-2.5 py-2 text-caption">{t('logbooks.noHits')}</p> : null}
            {groups.general && visible(groups.general) ? <><Lbl>{t('logbooks.groupGeneral')}</Lbl>{row(groups.general, t('logs.general'), <BookOpen className="size-4 shrink-0" />)}</> : null}
            {groups.projects.some(visible) ? <><Lbl>{t('logbooks.groupProjects')}</Lbl>{groups.projects.filter(visible).map((l) => row(l, l.name, <ProjectIcon name={l.name} />))}</> : null}
            {groups.deleted.some(visible) ? <><Lbl>{t('logbooks.groupDeleted')}</Lbl>{groups.deleted.filter(visible).map((l) => row(l, l.name.replace(/\s*eliminad[oa]$/i, ''), <Circle className="size-2.5 shrink-0" />))}</> : null}
          </ListCard>
          <p className="note text-muted-foreground m-0 flex items-start gap-1.5 px-1 text-caption"><Lock className="mt-0.5 size-3.5 shrink-0" />{dir ? t('logbooks.privateAt', { dir }) : t('logbooks.private')}</p>
        </div>
        <div className="entries flex min-w-0 flex-col gap-3">
          <div className="bhead flex min-h-(--ctl) items-center gap-2">
            {selected === 'general' ? null : <ProjectIcon small name={title} />}
            <h2 className="m-0 font-(family-name:--title) text-title font-semibold">{title}</h2>
            <span className="text-muted-foreground text-caption">{t('logbooks.entriesCount', { n: count })}</span>
            <span className="flex-1" />
            <Badge variant="secondary" title={t('logbooks.readOnlyHint')}>{t('logbooks.readOnly')}</Badge>
          </div>
          <p className="bintro text-muted-foreground -mt-1.5 text-control">{t(selected === 'general' ? 'logbooks.introGeneral' : 'logbooks.intro', { name: title })}</p>
          <SearchInput value={q} onChange={setQ} placeholder={t('logbooks.searchEntries')} className="h-(--ctl-sm) w-full" data-testid="log-search" />
          <div className="flex flex-col gap-3" data-testid="log-body">
            {partial && parsed?.pre ? <p className="text-muted-foreground text-caption">{parsed.pre}</p> : null}
            {entries == null ? <Spinner /> : entries.length === 0 ? <Empty icon={BookOpen} title={t(needle ? 'logbooks.noEntries' : 'logbooks.noEntriesYet')} /> : entries.map((e) => <Entry key={e.n} e={e} t={t} locale={locale} />)}
            {!needle && !partial && parsed?.pre ? (
              <Collapsible className="bg-card border-border rounded-card border" data-testid="log-intro">
                <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left text-control">
                  <ChevronRight className="text-muted-foreground size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />{t('logbooks.preamble')}
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3.5 pb-3 text-body"><Markdown>{parsed.pre}</Markdown></CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        </div>
      </div>
    </BitacorasPage>
  );
}
