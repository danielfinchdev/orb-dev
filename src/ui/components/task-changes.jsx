// 3.8.2: «Cambios» of a finished task: the files it changed, each one folding out to its diff (tasks.diff, read only,
// from the task's undo checkpoint). Shown in the task's detail and at the end of its agent's conversation; nothing when
// there is nothing to show (running, undone, a folder without git).
import { useEffect, useState } from 'react';
import { ChevronRight, Copy, FileEdit, FileMinus2, FilePlus2, FileDiff } from 'lucide-react';
import { toast } from 'sonner';
import { DiffLines } from '@/components/diff-view.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, Tip } from '@/components/ui/overlay.jsx';
import { call } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const ICON = { A: FilePlus2, D: FileMinus2 };
const TONE = { A: 'text-success', D: 'text-destructive' };

function FileRow({ f }) {
  const t = useT();
  const Icon = ICON[f.status] ?? FileEdit;
  const copy = (e) => { e.stopPropagation(); navigator.clipboard?.writeText(f.path).then(() => toast.success(t('tasks.changes.copied'))).catch(() => {}); };
  const note = f.binary ? t('tasks.changes.binary') : f.cut ? t('tasks.changes.tooBig') : !f.patch ? t('tasks.changes.noText') : null;
  return (
    <Collapsible className="border-t first:border-t-0" data-testid="task-change">
      <div className="flex items-center gap-1 pr-1.5">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px]">
          <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <Icon className={cn('size-3.5 shrink-0', TONE[f.status] ?? 'text-muted-foreground')} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
          {f.binary ? null : <span className="shrink-0 font-mono text-[11px] tabular-nums"><span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span></span>}
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
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left text-[13px]">
        <ChevronRight className="text-muted-foreground size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <FileDiff className="text-muted-foreground size-4" />
        <span className="font-medium">{t('tasks.changes.title')}</span>
        <span className="text-muted-foreground">{t(data.files.length + data.more === 1 ? 'tasks.changes.filesOne' : 'tasks.changes.filesOther', { n: data.files.length + data.more })}</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums"><span className="text-success">+{added}</span> <span className="text-destructive">−{removed}</span></span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        {data.files.map((f) => <FileRow key={f.path} f={f} />)}
        {data.more ? <p className="text-muted-foreground border-t px-3.5 py-2 text-xs">{t('tasks.changes.more', { n: data.more })}</p> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
