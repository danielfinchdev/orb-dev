// What «Deshacer» will do, shown before it is confirmed: each file with the state it ends in and, for the ones that change,
// the diff from how the file is now to how it will be. All of it comes from tasks.undoPreview, whose `hash` goes back with
// the undo itself: the engine refuses if the plan it would carry out is no longer the one shown here.
import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { PatchView } from '@/components/patch-view.jsx';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

// conflicts first (they need a look), files that stay as they are last
const ORDER = { conflict: 0, remove: 1, recreate: 2, restore: 3, skipped: 4, kept: 5, unchanged: 6 };
const TONE = { conflict: 'text-warning', skipped: 'text-warning', remove: 'text-destructive', recreate: 'text-success', restore: 'text-foreground', kept: 'text-muted-foreground', unchanged: 'text-muted-foreground' };

export function sortPlan(files) {
  return [...files].sort((a, b) => (ORDER[a.action] ?? 9) - (ORDER[b.action] ?? 9) || (a.path < b.path ? -1 : 1));
}

function Row({ f }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const note = f.binary ? t('tasks.undo.preview.binary') : f.tooBig ? t('tasks.undo.preview.tooBig') : f.cut ? t('tasks.undo.preview.cut') : !f.patch ? t('tasks.undo.preview.noText') : null;
  const changes = f.action === 'restore' || f.action === 'recreate' || f.action === 'remove';
  return (
    <li className="grid gap-1.5 py-1.5" data-testid="undo-preview-file" data-action={f.action}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-control">
        <span className="min-w-0 flex-1 basis-40 truncate font-mono text-caption" title={f.path}>{f.path}</span>
        <span className={cn('text-caption', TONE[f.action])}>{t(`tasks.undo.preview.${f.action}`)}</span>
        {changes && !note ? <span className="text-caption tabular-nums"><span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span></span> : null}
        {changes ? <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="undo-preview-toggle">{t(open ? 'tasks.undo.preview.hide' : 'tasks.undo.preview.show')}</Button> : null}
      </div>
      {changes && open ? (note ? <p className="text-muted-foreground m-0 text-caption">{note}</p> : <PatchView text={f.patch} path={f.path} bodyClass="max-h-64" />) : null}
    </li>
  );
}

// `set` is the dialog's setter: it receives { loading, hash } so the dialog keeps the accept button off until the preview is
// known and sends the hash with the undo.
export function UndoPreview({ taskId, set }) {
  const t = useT();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    call('tasks.undoPreview', { id: taskId })
      .then((r) => { if (!alive) return; setState({ preview: r }); set({ loading: false, hash: r?.hash }); })
      .catch(() => { if (!alive) return; setState({ failed: true }); set({ loading: false, hash: undefined }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  const files = useMemo(() => sortPlan(state.preview?.files ?? []), [state.preview]);
  const hint = (text, testid) => <p className="text-muted-foreground m-0 text-control" data-testid={testid}>{text}</p>;
  if (state.loading) return hint(t('tasks.undo.preview.loading'), 'undo-preview-loading');
  if (state.failed) return hint(t('tasks.undo.preview.failed'), 'undo-preview-failed');
  const conflicts = state.preview?.counts?.conflict ?? 0;
  if (!files.length) return hint(t('tasks.undo.preview.none'), 'undo-preview-none');
  return (
    <div className="grid gap-2" data-testid="undo-preview">
      <b className="text-control font-semibold">{t('tasks.undo.preview.heading')}</b>
      {conflicts ? <p className="text-warning m-0 text-caption" data-testid="undo-preview-conflicts">{t('tasks.undo.preview.conflicts', { n: conflicts })}</p> : null}
      <p className="text-muted-foreground m-0 text-caption">{t('tasks.undo.preview.diffNote')}</p>
      <ul className="divide-border m-0 max-h-80 list-none divide-y overflow-auto p-0">{files.map((f) => <Row key={f.path} f={f} />)}</ul>
    </div>
  );
}
