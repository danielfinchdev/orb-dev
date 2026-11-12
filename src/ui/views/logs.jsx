// Bitácoras: the assistant's memory (general log and one per project). Read-only here: only the assistant appends.
import { useEffect, useRef, useState } from 'react';
import { NotebookPen, Copy, Maximize2, NotebookText } from 'lucide-react';
import { notifyOk } from '@/lib/notify.js';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, Spinner } from '@/components/ui/basic.jsx';
import { ListRow } from '@/components/ui/primitives.jsx';
import { useStore, call } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';

// bare: inside «Memorias» (its header is that screen's).
export function LogsView({ route, bare = false }) {
  const t = useT();
  const version = useStore((s) => s.version);
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(route.name ?? 'general');
  const [whole, setWhole] = useState(false);
  const [body, setText] = useState(null);
  // entries are appended at the end (the general log keeps the user's index and rules at its top): the view opens
  // on the newest ones.
  const scroller = useRef(null);
  useEffect(() => { const el = scroller.current; if (el && body != null) el.scrollTop = el.scrollHeight; }, [body]);
  useEffect(() => { call('logs.list').then(setLogs).catch(quiet); }, [version]);
  useEffect(() => { setText(null); call('logs.read', { project: selected, whole }).then(setText).catch((e) => setText(e.message)); }, [selected, whole, version]);
  const partial = body?.startsWith('(');
  return (
    <>
      {bare ? null : <PageHeader icon={<NotebookPen className="text-primary size-5" />} title={t('logs.title')} meta={t('logs.meta')} />}
      <PageBody className="grid grid-cols-[240px_1fr] gap-4 overflow-hidden">
        <Card className="gap-0.5 overflow-y-auto p-2">
          {logs.map((l) => (
            <ListRow key={l.name} selected={selected === l.name} onClick={() => { setSelected(l.name); setWhole(false); }}
              leading={<NotebookText className={cn('size-4', l.name === 'general' ? 'text-primary' : 'text-muted-foreground')} />}
              title={l.name === 'general' ? t('logs.general') : l.name}
              trailing={<span className="text-muted-foreground text-micro">{Math.max(1, Math.ceil(l.size / 1024))} KB</span>} />
          ))}
        </Card>
        <Card className="min-h-0 gap-3 overflow-hidden">
          <div className="flex items-center gap-2 px-5">
            <h2 className="flex-1 text-title">{selected === 'general' ? t('logs.generalTitle') : t('logs.projectTitle', { name: selected })}</h2>
            {partial && !whole ? <Button size="sm" variant="ghost" onClick={() => setWhole(true)}><Maximize2 />{t('logs.whole')}</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(body ?? '').then(() => notifyOk(t('logs.copied')))}><Copy />{t('logs.copy')}</Button>
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 text-body md:pb-24" data-testid="log-body">{body == null ? <Spinner /> : <Markdown>{body}</Markdown>}</div>
        </Card>
      </PageBody>
    </>
  );
}
