// Bitácoras: Orb's journal (the general log and one per project). Read-only here: only the assistant appends.
// Nothing is read until the tab opens, and only the log on screen is loaded.
import { useEffect, useMemo, useRef, useState } from 'react';
import { NotebookPen, Copy, Maximize2, NotebookText, Lock, ShieldCheck } from 'lucide-react';
import { notifyOk } from '@/lib/notify.js';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, Empty, Spinner } from '@/components/ui/basic.jsx';
import { ListRow, SearchInput, SectionLabel } from '@/components/ui/primitives.jsx';
import { useStore, call } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { groupLogs, filterEntries } from '@/lib/logbook.js';

const kb = (size) => `${Math.max(1, Math.ceil(size / 1024))} KB`;

// bare: inside «Bitácoras» (its header is that screen's).
export function LogsView({ route, bare = false }) {
  const t = useT();
  const version = useStore((s) => s.version);
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(route.name ?? 'general');
  const [whole, setWhole] = useState(false);
  const [body, setText] = useState(null);
  const [q, setQ] = useState('');
  // entries are appended at the end (the general log keeps the user's index and rules at its top): the view opens
  // on the newest ones.
  const scroller = useRef(null);
  useEffect(() => { const el = scroller.current; if (el && body != null) el.scrollTop = el.scrollHeight; }, [body, q]);
  useEffect(() => { call('logs.list').then(setLogs).catch(quiet); }, [version]);
  useEffect(() => { setText(null); call('logs.read', { project: selected, whole }).then(setText).catch((e) => setText(e.message)); }, [selected, whole, version]);
  const groups = useMemo(() => groupLogs(logs), [logs]);
  const partial = body?.startsWith('(');
  const shown = useMemo(() => (body == null ? null : filterEntries(body, q)), [body, q]);
  const pick = (name) => { setSelected(name); setWhole(false); setQ(''); };
  const row = (l, title, primary) => (
    <ListRow key={l.name} selected={selected === l.name} onClick={() => pick(l.name)}
      leading={<NotebookText className={cn('size-4', primary ? 'text-primary' : 'text-muted-foreground')} />}
      title={title}
      trailing={<span className="text-muted-foreground text-micro">{kb(l.size)}</span>} />
  );
  return (
    <>
      {bare ? null : <PageHeader icon={<NotebookPen className="text-primary size-5" />} title={t('logs.title')} meta={t('logs.meta')} />}
      <PageBody className="grid grid-cols-[240px_1fr] gap-4 overflow-hidden">
        <Card className="gap-0.5 overflow-y-auto p-2">
          {groups.general ? <><SectionLabel>{t('logbooks.groupGeneral')}</SectionLabel>{row(groups.general, t('logs.general'), true)}</> : null}
          {groups.projects.length ? <><SectionLabel className="mt-2">{t('logbooks.groupProjects')}</SectionLabel>{groups.projects.map((l) => row(l, l.name))}</> : null}
          {groups.deleted.length ? <><SectionLabel className="mt-2">{t('logbooks.groupDeleted')}</SectionLabel>{groups.deleted.map((l) => row(l, l.name.replace(/\s*eliminad[oa]$/i, '')))}</> : null}
          <p className="text-muted-foreground mt-auto flex items-start gap-1.5 px-2.5 pt-3 text-micro"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{t('logbooks.private')}</p>
        </Card>
        <Card className="min-h-0 gap-3 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-5">
            <h2 className="text-title">{selected === 'general' ? t('logs.generalTitle') : t('logs.projectTitle', { name: selected })}</h2>
            <Badge variant="secondary" title={t('logbooks.readOnlyHint')}><Lock className="size-3" />{t('logbooks.readOnly')}</Badge>
            <span className="flex-1" />
            <SearchInput value={q} onChange={setQ} placeholder={t('logbooks.searchEntries')} data-testid="log-search" />
            {partial && !whole ? <Button size="sm" variant="ghost" onClick={() => setWhole(true)}><Maximize2 />{t('logs.whole')}</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(body ?? '').then(() => notifyOk(t('logs.copied')))}><Copy />{t('logs.copy')}</Button>
          </div>
          <p className="text-muted-foreground px-5 text-control">{t('logbooks.readOnlyHint')}{shown?.count != null ? ` ${t('logbooks.entries', { n: shown.count })}` : ''}</p>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 text-body md:pb-24" data-testid="log-body">
            {shown == null ? <Spinner /> : shown.count === 0 ? <Empty icon={NotebookText} title={t('logbooks.noEntries')} /> : <Markdown>{shown.text}</Markdown>}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
