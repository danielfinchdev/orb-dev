// «Cambios» panel of a direct chat: what the agent changed in each turn (sessions.turns / sessions.turnDiff, read from
// Orb's light photos of the folder, never from the user's tree) and a «+» on every line to write a comment. The comments
// wait in a tray (lib/turn-comments.js) and travel with the next message.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FileDiff, FileEdit, FileMinus2, FilePlus2, MessageSquarePlus, X } from 'lucide-react';
import { DiffLines } from '@/components/diff-view.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/basic.jsx';
import { Select, Tip } from '@/components/ui/overlay.jsx';
import { call } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { addComment, removeComment, useComments } from '@/lib/turn-comments.js';
import { cn } from '@/lib/utils.js';

const ICON = { A: FilePlus2, D: FileMinus2 };
const TONE = { A: 'text-success', D: 'text-destructive' };

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

// a removed line is told apart from the new line with the same number by its side
const sameLine = (a, r) => a.line === r.line && a.side === r.side;

function FileBlock({ f, sessionId, comments }) {
  const t = useT(); const Icon = ICON[f.status] ?? FileEdit;
  const [writing, setWriting] = useState(null); // { line, side } being written
  const mine = comments.filter((c) => c.path === f.path);
  const below = (r) => (
    <>
      {mine.filter((c) => sameLine(c, r)).map((c) => (
        <div key={c.key} className="bg-accent/40 mx-2 my-1 flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs whitespace-normal" data-testid="diff-comment">
          <MessageSquarePlus className="text-primary-text mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 flex-1 break-words">{c.text}</span>
          <button type="button" className="text-muted-foreground cursor-pointer" aria-label={t('turns.trayRemove')} onClick={() => removeComment(sessionId, c.key)}><X className="size-3.5" /></button>
        </div>
      ))}
      {writing && sameLine(writing, r)
        ? <Writer onCancel={() => setWriting(null)} onAdd={(text) => { addComment(sessionId, { path: f.path, ...writing, text }); setWriting(null); }} /> : null}
    </>
  );
  const note = f.binary ? t('tasks.changes.binary') : f.cut ? t('tasks.changes.tooBig') : !f.patch ? t('tasks.changes.noText') : null;
  return (
    <section className="border-t first:border-t-0" data-testid="turn-file">
      <header className="bg-muted/40 sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 text-control">
        <Icon className={cn('size-3.5 shrink-0', TONE[f.status] ?? 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
        {f.binary ? null : <span className="shrink-0 font-mono text-micro tabular-nums"><span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span></span>}
      </header>
      {note ? <p className="text-muted-foreground px-3 py-2 text-xs">{note}</p>
        : <div className="overflow-x-auto"><DiffLines text={f.patch} headers={false} onLine={setWriting} below={below} lineLabel={t('turns.comment')} /></div>}
    </section>
  );
}

// version: anything that changes when a turn ends (the conversation's status or last update), to read the photos again.
export function TurnChanges({ session, version, onClose }) {
  const t = useT(); const id = session.id;
  const [turns, setTurns] = useState(null); const [scope, setScope] = useState('last'); const [data, setData] = useState(null);
  const comments = useComments(id); const box = useRef(null);
  useEffect(() => {
    let alive = true;
    call('sessions.turns', { id }).then((r) => alive && setTurns(r)).catch(() => alive && setTurns({ available: false, turns: [] }));
    return () => { alive = false; };
  }, [id, version]);
  useEffect(() => {
    if (!turns?.available) { setData(null); return undefined; }
    let alive = true; const [kind, n] = scope.split(':');
    call('sessions.turnDiff', { id, scope: kind, n: n ? Number(n) : undefined }).then((r) => alive && setData(r)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [id, scope, turns]);
  // «siguiente / anterior cambio»: jump to the first line of the next (or previous) run of changed lines.
  const jump = useCallback((dir) => {
    const rows = [...(box.current?.querySelectorAll('[data-change]') ?? [])];
    const starts = rows.filter((r) => !r.parentElement?.previousElementSibling?.firstElementChild?.hasAttribute('data-change'));
    const middle = box.current ? box.current.getBoundingClientRect().top + box.current.clientHeight / 2 : 0;
    const at = (r) => r.getBoundingClientRect().top;
    const target = dir > 0 ? starts.find((r) => at(r) > middle + 12) : [...starts].reverse().find((r) => at(r) < middle - 12);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);
  useEffect(() => {
    const on = (e) => { if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); jump(e.key === 'ArrowDown' ? 1 : -1); } };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [jump]);
  const options = [{ value: 'last', label: t('turns.scopeLast') }, { value: 'all', label: t('turns.scopeAll') }, { value: 'head', label: t('turns.scopeHead') },
    ...(turns?.turns ?? []).slice().reverse().map((x) => ({ value: `turn:${x.n}`, label: t('turns.scopeTurn', { n: x.n }) }))];
  const files = data?.files ?? [];
  return (
    <aside className="bg-background flex w-full max-w-[46rem] min-w-0 shrink-0 flex-col border-l md:w-[44%]" data-testid="turn-changes" aria-label={t('turns.title')}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <FileDiff className="text-muted-foreground size-4" /><span className="text-control font-medium">{t('turns.title')}</span>
        <div className="ml-auto flex items-center gap-1">
          <Tip label={t('turns.prev')}><Button size="icon-sm" variant="ghost" onClick={() => jump(-1)} aria-label={t('turns.prev')}><ChevronUp /></Button></Tip>
          <Tip label={t('turns.next')}><Button size="icon-sm" variant="ghost" onClick={() => jump(1)} aria-label={t('turns.next')}><ChevronDown /></Button></Tip>
          <Tip label={t('turns.close')}><Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t('turns.close')} data-testid="turn-changes-close"><X /></Button></Tip>
        </div>
      </div>
      {turns?.available ? (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
          <span className="text-muted-foreground">{t('turns.scope')}</span>
          <Select className="min-w-0 flex-1" value={scope} onValueChange={setScope} options={options} data-testid="turn-scope" />
        </div>) : null}
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto">
        {turns && !turns.available ? <p className="text-muted-foreground p-4 text-sm">{t('turns.empty')}</p>
          : data && !files.length ? <p className="text-muted-foreground p-4 text-sm">{t('turns.noChanges')}</p>
            : files.map((f) => <FileBlock key={`${scope}:${f.path}`} f={f} sessionId={id} comments={comments} />)}
        {data?.more ? <p className="text-muted-foreground border-t px-3 py-2 text-xs">{t('turns.partial')}</p> : null}
      </div>
      {comments.length ? (
        <div className="border-t px-3 py-2" data-testid="turn-tray">
          <div className="text-control mb-1 font-medium">{t('turns.tray', { n: comments.length })} <span className="text-muted-foreground font-normal">· {t('turns.trayNote')}</span></div>
          <ul className="grid max-h-32 gap-1 overflow-y-auto text-xs">
            {comments.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words"><span className="font-mono">{c.path}:{c.line}</span> {c.text}</span>
                <button type="button" className="text-muted-foreground cursor-pointer" aria-label={t('turns.trayRemove')} onClick={() => removeComment(id, c.key)}><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>) : null}
    </aside>
  );
}
