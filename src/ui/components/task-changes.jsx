// «Cambios» of a finished task: the files it changed, each one folding out to its diff (tasks.diff, read only,
// from the task's undo checkpoint). Shown in the task's detail and at the end of its agent's conversation; nothing when
// there is nothing to show (running, undone, a folder without git).
import { useEffect, useState } from 'react';
import { Check, ChevronRight, Copy, FileEdit, FileMinus2, FilePlus2, FileDiff } from 'lucide-react';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { DiffLines } from '@/components/diff-view.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/basic.jsx';
import { SearchInput } from '@/components/ui/primitives.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, Tip } from '@/components/ui/overlay.jsx';
import { call } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const ICON = { A: FilePlus2, D: FileMinus2 };
const TONE = { A: 'text-success', D: 'text-destructive' };

function FileRow({ f }) {
  const t = useT();
  const Icon = ICON[f.status] ?? FileEdit;
  const copy = (e) => { e.stopPropagation(); navigator.clipboard?.writeText(f.path).then(() => notifyOk(t('tasks.changes.copied'))).catch(() => notifyError(t('app.copyFailed'))); };
  const note = f.binary ? t('tasks.changes.binary') : f.cut ? t('tasks.changes.tooBig') : !f.patch ? t('tasks.changes.noText') : null;
  return (
    <Collapsible className="border-t first:border-t-0" data-testid="task-change">
      <div className="flex items-center gap-1 pr-1.5">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left text-control">
          <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <Icon className={cn('size-3.5 shrink-0', TONE[f.status] ?? 'text-muted-foreground')} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
          {f.binary ? null : <span className="shrink-0 font-mono text-micro tabular-nums"><span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span></span>}
        </CollapsibleTrigger>
        <Tip label={t('tasks.changes.copyPath')}><Button size="icon-sm" variant="ghost" className="size-7" aria-label={t('tasks.changes.copyPath')} onClick={copy}><Copy className="size-3.5" /></Button></Tip>
      </div>
      <CollapsibleContent>
        {note ? <p className="text-muted-foreground px-9 pb-2.5 text-xs">{note}</p>
          : <div className="mx-3 mb-3 max-h-96 overflow-auto rounded-lg border"><DiffLines text={f.patch} headers={false} /></div>}
      </CollapsibleContent>
    </Collapsible>
  );
}

// The same read as TaskChanges, for a screen that draws the files itself (the task panel of Tareas).
export function useTaskDiff(taskId, version, enabled = true) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled || taskId == null) { setData(null); return undefined; }
    let alive = true;
    call('tasks.diff', { id: taskId }).then((r) => alive && setData(r?.available && r.files.length ? r : null)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [taskId, version, enabled]);
  return data;
}
const sumOf = (data) => ({ added: data.files.reduce((n, f) => n + f.added, 0), removed: data.files.reduce((n, f) => n + f.removed, 0), count: data.files.length + data.more });
const filesLabel = (t, n) => t(n === 1 ? 'tasks.changes.filesOne' : 'tasks.changes.filesOther', { n });

// «+120 −18 · 6 archivos» with the way into the Cambios tab (the task's detail).
export function ChangesSummary({ data, onOpen, className }) {
  const t = useT();
  const { added, removed, count } = sumOf(data);
  return (
    <Card className={cn('flex-row items-center gap-3 px-3.5 py-2.5', className)} data-testid="task-changes-summary">
      <span className="min-w-0 flex-1 text-control"><span className="text-success">+{added}</span> <span className="text-destructive">−{removed}</span> · {filesLabel(t, count)}</span>
      <Button size="xs" variant="outline" onClick={onOpen} data-testid="task-changes-open">{t('tasks.changes.view')}</Button>
    </Card>
  );
}

const LETTER = { A: 'text-success', D: 'text-destructive' };
function PanelFile({ f, seen, onSeen }) {
  const t = useT();
  const copy = (e) => { e.stopPropagation(); navigator.clipboard?.writeText(f.path).then(() => notifyOk(t('tasks.changes.copied'))).catch(() => notifyError(t('app.copyFailed'))); };
  const note = f.binary ? t('tasks.changes.binary') : f.cut ? t('tasks.changes.tooBig') : !f.patch ? t('tasks.changes.noText') : null;
  return (
    <Collapsible className="frow-wrap border-border border-t first:border-t-0" data-testid="task-change">
      <div className="frow hover:bg-accent flex items-center gap-2.5 py-1.5 pr-1.5 pl-3">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-0.5 text-left text-control">
          <span className={cn('st w-4 shrink-0 text-center text-caption font-semibold', LETTER[f.status] ?? 'text-info')}>{f.status === 'A' || f.status === 'D' ? f.status : 'M'}</span>
          <span className="p min-w-0 flex-1 truncate font-mono text-caption" title={f.path}>{f.path}</span>
          {f.binary ? null : <span className="nums shrink-0 text-caption tabular-nums"><span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span></span>}
        </CollapsibleTrigger>
        <Tip label={t('tasks.changes.copyPath')}><Button size="icon-xs" variant="ghost" aria-label={t('tasks.changes.copyPath')} onClick={copy}><Copy /></Button></Tip>
      </div>
      <CollapsibleContent>
        {note ? <p className="text-muted-foreground px-4 pb-2.5 text-caption">{note}</p>
          : <div className="mx-3 mb-2 max-h-96 overflow-auto rounded-lg border"><DiffLines text={f.patch} headers={false} /></div>}
        <div className="flex justify-end px-3 pb-2"><Button size="xs" variant={seen ? 'soft' : 'ghost'} onClick={onSeen} aria-pressed={seen} data-testid="task-change-seen"><Check />{t('tasks.changes.seen')}</Button></div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// The files a task changed as the mock-up's .flist: a letter for what happened to each, its numbers, and its diff when opened.
export function ChangesFiles({ data, className }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [seen, setSeen] = useState(() => new Set());
  const q = query.trim().toLowerCase();
  const files = q ? data.files.filter((f) => f.path.toLowerCase().includes(q)) : data.files;
  const toggle = (path) => setSeen((prev) => { const next = new Set(prev); if (!next.delete(path)) next.add(path); return next; });
  return (
    <div className={cn('grid gap-2', className)} data-testid="task-changes">
      <div className="flex items-center gap-2">
        <b className="text-control font-medium">{t('tasks.changes.files')}</b>
        <span className="text-faint-foreground text-caption">{t('tasks.changes.seenCount', { n: seen.size, total: data.files.length })}</span>
        <SearchInput className="ml-auto w-auto min-w-0 flex-1" value={query} onChange={setQuery} placeholder={t('tasks.changes.search')} data-testid="task-changes-search" />
      </div>
      <div className="flist border-border bg-card overflow-hidden rounded-card border">
        {files.map((f) => <PanelFile key={f.path} f={f} seen={seen.has(f.path)} onSeen={() => toggle(f.path)} />)}
        {data.more && !q ? <p className="text-muted-foreground border-border border-t px-3 py-2 text-control">{t('tasks.changes.more', { n: data.more })}</p> : null}
      </div>
      <p className="text-faint-foreground m-0 text-caption">{t('tasks.changes.legend')}</p>
    </div>
  );
}

// version: anything that changes when the task does (its status, its last update), to read the changes again.
export function TaskChanges({ taskId, version, className }) {
  const t = useT();
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    call('tasks.diff', { id: taskId }).then((r) => alive && setData(r)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [taskId, version]);
  if (!data?.available || !data.files.length) return null;
  const added = data.files.reduce((n, f) => n + f.added, 0); const removed = data.files.reduce((n, f) => n + f.removed, 0);
  return (
    <Collapsible className={cn('bg-card rounded-xl border', className)} data-testid="task-changes">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left text-control">
        <ChevronRight className="text-muted-foreground size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <FileDiff className="text-muted-foreground size-4" />
        <span className="font-medium">{t('tasks.changes.title')}</span>
        <span className="text-muted-foreground">{t(data.files.length + data.more === 1 ? 'tasks.changes.filesOne' : 'tasks.changes.filesOther', { n: data.files.length + data.more })}</span>
        <span className="ml-auto font-mono text-micro tabular-nums"><span className="text-success">+{added}</span> <span className="text-destructive">−{removed}</span></span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        {data.files.map((f) => <FileRow key={f.path} f={f} />)}
        {data.more ? <p className="text-muted-foreground border-t px-3.5 py-2 text-xs">{t('tasks.changes.more', { n: data.more })}</p> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
