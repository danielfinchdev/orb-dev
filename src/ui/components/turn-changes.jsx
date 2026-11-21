// «Cambios» tab of the chat panel (components/chat-panel.jsx): what the agent changed in each turn (sessions.turns / sessions.turnDiff, read from
// Orb's light photos of the folder, never from the user's tree) and a «+» on every line to write a comment. The comments
// wait in a tray (lib/turn-comments.js) and travel with the next message.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FileEdit, FileMinus2, FilePlus2, MessageSquarePlus, X } from 'lucide-react';
import { DiffLines } from '@/components/diff-view.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Kbd, Textarea } from '@/components/ui/basic.jsx';
import { IconButton, ListCard } from '@/components/ui/primitives.jsx';
import { Select, Tip } from '@/components/ui/overlay.jsx';
import { call } from '@/lib/store.js';
import { useTurns } from '@/lib/turn-data.js';
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
        <div key={c.key} data-comment={c.key} className="bg-accent/40 mx-2 my-1 flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs whitespace-normal" data-testid="diff-comment">
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
    <section className="rounded-card overflow-hidden border" data-testid="turn-file">
      <header className="bg-secondary text-muted-foreground flex items-center gap-2 px-2.5 py-1.5 font-mono text-xs">
        <Icon className={cn('size-3.5 shrink-0', TONE[f.status] ?? 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate" title={f.path}>{f.path}</span>
      </header>
      {note ? <p className="text-muted-foreground px-3 py-2 text-xs">{note}</p>
        : <div className="overflow-x-auto"><DiffLines text={f.patch} headers={false} onLine={setWriting} below={below} lineLabel={t('turns.comment')} /></div>}
    </section>
  );
}

// The list of turns comes from the store the turn cards share (lib/turn-data.js), read once per finished turn.
// turn: a turn «Revisar» asked for (lib/open-changes.js); turnAt tells a repeated ask from the same turn apart.
export function TurnChanges({ session, turn, turnAt }) {
  const t = useT(); const id = session.id;
  const turns = useTurns(session); const [scope, setScope] = useState(turn != null ? `turn:${turn}` : 'last'); const [data, setData] = useState(null);
  const [pick, setPick] = useState(null);
  const [seek, setSeek] = useState(null); // { dir }: a jump that ran out of changes in a file and goes on in the next one
  const [reveal, setReveal] = useState(null); // key of the tray comment to show once its file is on screen
  useEffect(() => { if (turn != null) setScope(`turn:${turn}`); }, [turn, turnAt]);
  const comments = useComments(id); const box = useRef(null);
  useEffect(() => {
    if (!turns?.available) { setData(null); return undefined; }
    let alive = true; const [kind, n] = scope.split(':');
    call('sessions.turnDiff', { id, scope: kind, n: n ? Number(n) : undefined }).then((r) => alive && setData(r)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [id, scope, turns]);
  const files = data?.files ?? [];
  const current = files.find((f) => f.path === pick) ?? files[0] ?? null;
  const latest = useRef({}); latest.current = { files, path: current?.path };
  // the first line of each run of changed lines in the file on screen
  const starts = useCallback(() => {
    const rows = [...(box.current?.querySelectorAll('[data-change]') ?? [])];
    return rows.filter((r) => !r.parentElement?.previousElementSibling?.firstElementChild?.hasAttribute('data-change'));
  }, []);
  // «siguiente / anterior cambio»: the next (or previous) run of changed lines; past the last one of a file it goes on in the next file
  // with changes (and from the first one back to the last of the previous file), so every change of the turn can be walked through.
  const jump = useCallback((dir) => {
    const rows = starts();
    // the panel's body is what scrolls
    const scroller = box.current?.closest('[role="tabpanel"]') ?? box.current;
    const middle = scroller ? scroller.getBoundingClientRect().top + scroller.clientHeight / 2 : 0;
    const at = (r) => r.getBoundingClientRect().top;
    const target = dir > 0 ? rows.find((r) => at(r) > middle + 12) : [...rows].reverse().find((r) => at(r) < middle - 12);
    if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const { files: list, path } = latest.current;
    const next = list[list.findIndex((f) => f.path === path) + dir];
    if (next) { setPick(next.path); setSeek({ dir }); }
  }, [starts]);
  useEffect(() => {
    if (!seek || !current) return undefined;
    const shown = !current.binary && !current.cut && current.patch;
    let frame = 0; let tries = 0;
    const look = () => {
      const rows = starts();
      if (rows.length) { (seek.dir > 0 ? rows[0] : rows.at(-1)).scrollIntoView({ block: 'center', behavior: 'smooth' }); setSeek(null); return; }
      if (shown && tries++ < 10) { frame = requestAnimationFrame(look); return; }
      // nothing to walk through here (binary, too big, no text): on to the next file
      const list = latest.current.files; const i = list.findIndex((f) => f.path === current.path) + seek.dir;
      if (i >= 0 && i < list.length) setPick(list[i].path); else setSeek(null);
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [seek, current?.path, starts]); // eslint-disable-line react-hooks/exhaustive-deps
  // a tray comment pressed: its file opens (the scope widens to every change when it is not in this one) and the comment scrolls into view
  useEffect(() => {
    if (!reveal || !data) return undefined;
    if (current?.path !== reveal.path) { if (!files.some((f) => f.path === reveal.path)) setReveal(null); return undefined; }
    const frame = requestAnimationFrame(() => { box.current?.querySelector(`[data-comment="${reveal.key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); setReveal(null); });
    return () => cancelAnimationFrame(frame);
  }, [reveal, data, current?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = (c) => {
    if (!files.some((f) => f.path === c.path) && scope !== 'all') { setScope('all'); setData(null); }
    setPick(c.path); setReveal({ key: c.key, path: c.path });
  };
  useEffect(() => {
    const on = (e) => { if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); jump(e.key === 'ArrowDown' ? 1 : -1); } };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [jump]);
  const options = [{ value: 'last', label: t('turns.scopeLast') }, { value: 'all', label: t('turns.scopeAll') }, { value: 'head', label: t('turns.scopeHead') },
    ...(turns?.turns ?? []).slice().reverse().map((x) => ({ value: `turn:${x.n}`, label: t('turns.scopeTurn', { n: x.n }) }))];
  return (
    <section ref={box} className="grid gap-3" data-testid="turn-changes" aria-label={t('turns.title')}>
      {turns?.available ? (
        <div className="flex items-center gap-2 text-control">
          <span className="text-muted-foreground">{t('turns.scope')}</span>
          <Select caret="solid" className="min-w-0" value={scope} onValueChange={setScope} options={options} data-testid="turn-scope" />
          <span className="ml-auto flex items-center gap-1">
            <Tip label={t('turns.prev')}><IconButton small label={t('turns.prev')} onClick={() => jump(-1)}><ChevronUp /></IconButton></Tip>
            <Tip label={t('turns.next')}><IconButton small label={t('turns.next')} onClick={() => jump(1)}><ChevronDown /></IconButton></Tip>
            <Kbd>Ctrl+D</Kbd>
          </span>
        </div>) : null}
      {turns && !turns.available ? <p className="text-muted-foreground text-sm">{t('turns.empty')}</p>
        : data && !files.length ? <p className="text-muted-foreground text-sm">{t('turns.noChanges')}</p>
          : files.length ? (
            <>
              <ListCard data-testid="turn-files">
                {files.map((f) => {
                  const Icon = ICON[f.status] ?? FileEdit;
                  return (
                    <button key={f.path} type="button" onClick={() => setPick(f.path)} aria-pressed={f === current} title={f.path} data-testid="turn-file-row"
                      className="hover:bg-accent focus-visible:outline-ring aria-pressed:bg-accent flex w-full cursor-pointer items-center gap-2.5 border-t px-3 py-2 text-left text-control outline-none first:border-t-0 focus-visible:outline-2">
                      <Icon className={cn('size-3.5 shrink-0', TONE[f.status] ?? 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs"><bdi>{f.path}</bdi></span>
                      {f.binary ? null : <span className="shrink-0 font-mono text-xs tabular-nums"><span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span></span>}
                    </button>
                  );
                })}
              </ListCard>
              {current ? <FileBlock key={`${scope}:${current.path}`} f={current} sessionId={id} comments={comments} /> : null}
            </>) : null}
      {data?.more ? <p className="text-muted-foreground text-xs">{t('turns.partial')}</p> : null}
      {comments.length ? (
        <div className="bg-primary-soft rounded-card px-2.5 py-2 text-control" data-testid="turn-tray">
          <div className="mb-1 font-medium">{t('turns.tray', { n: comments.length })} <span className="text-muted-foreground font-normal">· {t('turns.trayNote')}</span></div>
          <ul className="grid max-h-32 gap-1 overflow-y-auto text-xs">
            {comments.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words"><button type="button" className="text-primary-text cursor-pointer font-mono underline-offset-2 hover:underline" onClick={() => show(c)} title={t('turns.trayGo')} data-testid="turn-tray-go">{c.path}:{c.line}</button> {c.text}</span>
                <button type="button" className="text-muted-foreground cursor-pointer" aria-label={t('turns.trayRemove')} onClick={() => removeComment(id, c.key)}><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>) : null}
    </section>
  );
}
