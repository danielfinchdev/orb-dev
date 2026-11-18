// «Cambios» of a finished task: the files it changed, each one folding out to its diff (tasks.diff, read only,
// from the task's undo checkpoint). Shown in the task's detail and at the end of its agent's conversation; nothing when
// there is nothing to show (running, undone, a folder without git).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronRight, Copy, FileEdit, FileMinus2, FilePlus2, FileDiff, MessageSquarePlus, X } from 'lucide-react';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { DiffLines } from '@/components/diff-view.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, Textarea } from '@/components/ui/basic.jsx';
import { SearchInput, Segmented } from '@/components/ui/primitives.jsx';
import { PatchView } from '@/components/patch-view.jsx';
import { OpenInMenu } from '@/components/project-tools.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, Tip } from '@/components/ui/overlay.jsx';
import { call, useStore } from '@/lib/store.js';
import { useT, currentLocale } from '@/lib/i18n.js';
import { addComment, removeComment, useComments } from '@/lib/turn-comments.js';
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

// «+120 −18» of a task for its row of the list: tasks.diff {stat:true} (line counts only), asked only once the row is on screen,
// one read at a time, each with a time limit, kept by task state. A row that leaves the screen or the view drops its place in the queue.
const statCache = new Map(); const statWaiting = new Map(); let statDraining = false;
export const STAT_TIMEOUT_MS = 8000;
const withLimit = (p, ms) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('timeout')), ms); p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); }); });
async function drainStats() {
  if (statDraining) return;
  statDraining = true;
  try {
    while (statWaiting.size) {
      const [key, job] = statWaiting.entries().next().value;
      statWaiting.delete(key);
      await job();
    }
  } finally { statDraining = false; }
}
export function useDiffStat(task, enabled) {
  const key = `${task.id}:${task.status}:${task.updated_at}`;
  const [stat, setStat] = useState(() => statCache.get(key));
  const [seen, setSeen] = useState(false);
  const node = useRef(null);
  useEffect(() => {
    if (!enabled || statCache.has(key)) return undefined;
    const el = node.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [key, enabled]);
  useEffect(() => {
    if (!enabled || !seen) return undefined;
    if (statCache.has(key)) { setStat(statCache.get(key)); return undefined; }
    let alive = true;
    statWaiting.set(key, () => withLimit(call('tasks.diff', { id: task.id, stat: true }), STAT_TIMEOUT_MS)
      .then((r) => { statCache.set(key, r?.available && r.files.length ? sumOf(r) : null); })
      .catch(() => { statCache.set(key, null); })
      .then(() => { if (alive) setStat(statCache.get(key)); }));
    drainStats();
    return () => { alive = false; statWaiting.delete(key); };
  }, [key, enabled, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  return [enabled ? stat : null, node];
}
export function DiffStat({ stat, className }) {
  if (!stat) return null;
  return <span className={cn('tabular-nums', className)} data-testid="task-diff-stat"><span className="text-success">+{stat.added}</span> <span className="text-destructive">−{stat.removed}</span></span>;
}

// How the patch is drawn, shared by the controls of the meta rows and the diff below them: unified or split, and the file
// after the change (the diff) or before it (the old file alone).
let layout = { view: 'unified', side: 'after' };
const layoutListeners = new Set();
const setLayout = (patch) => { layout = { ...layout, ...patch }; layoutListeners.forEach((fn) => fn()); };
const subscribeLayout = (fn) => { layoutListeners.add(fn); return () => layoutListeners.delete(fn); };
export const useDiffLayout = () => [useSyncExternalStore(subscribeLayout, () => layout, () => layout), setLayout];

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }) : '');
// «6 archivos +120 −18 · revisada por Codex» with Unificado / Dividido on the right; under it Después / Antes and the time
// of the photo the task can be undone to.
export function ChangesMeta({ data, reviewer, photoAt, canUndo, className }) {
  const t = useT();
  const [lay, set] = useDiffLayout();
  const { added, removed, count } = sumOf(data);
  return (
    <div className={cn('grid gap-2 text-control', className)} data-testid="task-changes-meta">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">{filesLabel(t, count)} <DiffStat stat={{ added, removed }} />{reviewer ? ` · ${t('tasks.reviewedBy.lower', { agent: reviewer })}` : ''}</span>
        <Segmented className="ml-auto" value={lay.view} onChange={(view) => set({ view })} aria-label={t('tasks.changes.layout')} data-testid="task-changes-layout"
          options={[{ value: 'unified', label: t('tasks.changes.unified'), testid: 'task-changes-unified' }, { value: 'split', label: t('tasks.changes.split'), testid: 'task-changes-split' }]} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Segmented value={lay.side} onChange={(side) => set({ side })} aria-label={t('tasks.changes.version')} data-testid="task-changes-version"
          options={[{ value: 'after', label: t('tasks.changes.after'), testid: 'task-changes-after' }, { value: 'before', label: t('tasks.changes.before'), testid: 'task-changes-before' }]} />
        {photoAt ? <span className="text-faint-foreground ml-auto text-caption" data-testid="task-changes-photo">{t(canUndo ? 'tasks.changes.photoUndo' : 'tasks.changes.photo', { time: clock(photoAt) })}</span> : null}
      </div>
    </div>
  );
}

const LETTER = { A: 'text-success', D: 'text-destructive' };
// The comment box of a line (the same words as the chat's Cambios).
function Writer({ onAdd, onCancel }) {
  const t = useT(); const [text, setText] = useState('');
  return (
    <div className="bg-card mx-2 my-1.5 grid gap-1.5 rounded-lg border p-2 whitespace-normal" data-testid="diff-comment-box">
      <Textarea autoFocus rows={2} value={text} placeholder={t('turns.commentPlaceholder')} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) onAdd(text); if (e.key === 'Escape') onCancel(); }} />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>{t('turns.commentCancel')}</Button>
        <Button size="sm" disabled={!text.trim()} onClick={() => onAdd(text)} data-testid="diff-comment-save">{t('turns.commentAdd')}</Button>
      </div>
    </div>
  );
}

// The diff of the file chosen: its name and numbers, «Visto», copying its path and, when the task has a conversation of its
// own, a «+» on each line to write a comment that goes with the next message there (lib/turn-comments.js).
function PanelDiff({ f, seen, onSeen, sessionId, project }) {
  const t = useT();
  const [lay] = useDiffLayout();
  const comments = useComments(sessionId ?? '');
  const [writing, setWriting] = useState(null);
  const copy = () => navigator.clipboard?.writeText(f.path).then(() => notifyOk(t('tasks.changes.copied'))).catch(() => notifyError(t('app.copyFailed')));
  const note = f.binary ? t('tasks.changes.binary') : f.cut ? t('tasks.changes.tooBig') : !f.patch ? t('tasks.changes.noText') : null;
  const mine = sessionId ? comments.filter((c) => c.path === f.path) : [];
  const same = (a, r) => a.line === r.line && a.side === r.side;
  const below = (r) => (<>
    {mine.filter((c) => same(c, r)).map((c) => (
      <div key={c.key} data-comment={c.key} className="bg-accent/40 mx-2 my-1 flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs whitespace-normal" data-testid="diff-comment">
        <MessageSquarePlus className="text-primary-text mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 flex-1 break-words">{c.text}</span>
        <button type="button" className="text-muted-foreground cursor-pointer" aria-label={t('turns.trayRemove')} onClick={() => removeComment(sessionId, c.key)}><X className="size-3.5" /></button>
      </div>
    ))}
    {writing && same(writing, r) ? <Writer onCancel={() => setWriting(null)} onAdd={(text) => { addComment(sessionId, { path: f.path, ...writing, text }); setWriting(null); }} /> : null}
  </>);
  return (
    <div className="grid gap-2" data-testid="task-diff">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-control">
        <b className="min-w-0 flex-1 basis-32 truncate font-mono text-caption font-semibold" title={f.path}>{f.path}</b>
        {f.binary ? null : <span className="text-caption tabular-nums"><span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span></span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Tip label={t('tasks.changes.copyPath')}><Button size="icon-xs" variant="ghost" aria-label={t('tasks.changes.copyPath')} onClick={copy}><Copy /></Button></Tip>
          <Button size="xs" variant={seen ? 'soft' : 'ghost'} onClick={onSeen} aria-pressed={seen} data-testid="task-change-seen"><Check />{t('tasks.changes.seen')}</Button>
          {project ? <OpenInMenu project={project} /> : null}
        </span>
      </div>
      {note ? <p className="text-muted-foreground m-0 text-caption">{note}</p>
        : <PatchView text={f.patch} path={f.path} view={lay.view} side={lay.side} onLine={sessionId ? setWriting : undefined} below={sessionId ? below : undefined} lineLabel={t('turns.comment')} />}
    </div>
  );
}

// The files a task changed as the mock-up's .flist: a letter for what happened to each and its numbers; the one chosen shows its diff below.
export function ChangesFiles({ data, sessionId, project, className }) {
  const t = useT();
  const projects = useStore((st) => st.projects);
  const proj = project ? (typeof project === 'string' ? (projects ?? []).find((p) => p.name === project) : project) : null;
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState(null);
  const [seen, setSeen] = useState(() => new Set());
  const q = query.trim().toLowerCase();
  const files = q ? data.files.filter((f) => f.path.toLowerCase().includes(q)) : data.files;
  const current = files.find((f) => f.path === pick) ?? files[0] ?? null;
  const toggle = (path) => setSeen((prev) => { const next = new Set(prev); if (!next.delete(path)) next.add(path); return next; });
  return (
    <div className={cn('grid gap-2', className)} data-testid="task-changes">
      <div className="flex items-center gap-2">
        <b className="text-control font-medium">{t('tasks.changes.files')}</b>
        <span className="text-faint-foreground text-caption">{t('tasks.changes.seenCount', { n: seen.size, total: data.files.length })}</span>
        <SearchInput className="ml-auto w-auto min-w-0 flex-1" value={query} onChange={setQuery} placeholder={t('tasks.changes.search')} data-testid="task-changes-search" />
      </div>
      <div className="flist border-border bg-card overflow-hidden rounded-card border">
        {files.map((f) => (
          <button key={f.path} type="button" onClick={() => setPick(f.path)} aria-pressed={f === current} title={f.path} data-testid="task-change"
            className="frow hover:bg-accent aria-pressed:bg-accent border-border focus-visible:outline-ring flex h-9 w-full cursor-pointer items-center gap-2.5 border-t px-3 text-left text-control outline-none first:border-t-0 focus-visible:outline-2">
            <span className={cn('st w-4 shrink-0 text-center text-caption font-semibold', LETTER[f.status] ?? 'text-info')}>{f.status === 'A' || f.status === 'D' ? f.status : 'M'}</span>
            <span className="p min-w-0 flex-1 truncate font-mono text-control"><bdi>{f.path}</bdi></span>
            {f.binary ? null : <span className="nums shrink-0 text-caption tabular-nums"><span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span></span>}
          </button>
        ))}
        {data.more && !q ? <p className="text-muted-foreground border-border m-0 border-t px-3 py-2 text-control">{t('tasks.changes.more', { n: data.more })}</p> : null}
      </div>
      <p className="text-faint-foreground m-0 text-caption">{t('tasks.changes.legend')}</p>
      {current ? <PanelDiff key={current.path} f={current} seen={seen.has(current.path)} onSeen={() => toggle(current.path)} sessionId={sessionId} project={proj} /> : null}
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
