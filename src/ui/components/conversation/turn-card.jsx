// What a direct chat shows between its lines besides the lines themselves: the «Cambió N archivos» card after each finished turn
// (what sessions.turns / sessions.turnDiff already give the Changes panel) and the folded «Trabajó 4 min 20 s» line over a run of tool
// calls. Both only read what the panel reads; «Volver atrás…» is the rewind that «Editar mensaje» already offers.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, FileMinus2, FilePen, FilePlus2, FileText, FlaskConical, Image as ImageIcon, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { rewindFrom } from '@/components/edit-message.jsx';
import { fullPc } from '@/lib/store.js';
import { openChanges } from '@/lib/open-changes.js';
import { groupWorked, placeTurns, formatSpan } from '@/lib/turn-cards.js';
import { readDiff, requestDiff, useTurns } from '@/lib/turn-data.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const SHOWN = 5;
const EMPTY = [];
const PICTURE = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i;
const CODE = /\.(mjs|cjs|js|jsx|ts|tsx|css|html|json|rs|py|kt|java|go|c|cpp|h|sh|ps1)$/i;
const snippet = (user) => { const text = (typeof user?.body === 'string' ? user.body : user?.body?.text ?? '').replace(/\s+/g, ' ').trim(); return text.length > 48 ? `${text.slice(0, 47)}…` : text; };

// The numbers of one card. They are asked one at a time and only once the card is on screen (lib/turn-data.js); a failure leaves
// the card without numbers and asks again the next time it comes back into view.
function useSummary(sessionId, turn) {
  const [data, setData] = useState(() => readDiff(sessionId, turn));
  const [failed, setFailed] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (data) return undefined;
    let alive = true; let seen = false; let busy = false; let armed = true;
    const go = () => {
      busy = true;
      requestDiff(sessionId, turn, () => alive && seen).then((v) => { if (alive) { setData(v); setFailed(false); } })
        .catch((e) => { busy = false; if (alive && !e?.skipped) { setFailed(true); armed = false; } });
    };
    const see = (visible) => { seen = visible; if (!visible) armed = true; else if (armed && !busy) go(); };
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') { seen = true; go(); return () => { alive = false; }; }
    const o = new IntersectionObserver((entries) => { for (const x of entries) see(x.isIntersecting); });
    o.observe(el);
    return () => { alive = false; o.disconnect(); };
  }, [sessionId, turn.n, turn.at, data]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, failed, box];
}

const fileIcon = (f) => (f.status === 'A' ? FilePlus2 : f.status === 'D' ? FileMinus2 : PICTURE.test(f.path) ? ImageIcon : /(^|\/)test\/|\.test\./.test(f.path) ? FlaskConical : CODE.test(f.path) ? FileCode2 : FileText);

function TurnCard({ sessionId, turn, user, running }) {
  const t = useT();
  const [data, failed, box] = useSummary(sessionId, turn);
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const files = data?.files ?? [];
  const more = data?.more ?? 0; // files past the engine's cap: counted, never shown
  // a card is drawn once it has files: while the numbers are on their way, or when the turn changed nothing, only its marker stays
  if (!failed && (!data || !files.length)) return <div ref={box} className="min-h-px" />;
  const added = files.reduce((a, f) => a + f.added, 0); const removed = files.reduce((a, f) => a + f.removed, 0);
  const shown = all ? files : files.slice(0, SHOWN);
  const review = () => openChanges(sessionId, turn.n);
  return (
    <div ref={box} className="turn-card bg-card overflow-hidden rounded-[var(--r-card)] border text-[13px] leading-snug" data-testid="turn-card" data-turn={turn.n}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <FilePen className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium" data-testid="turn-card-title">{data ? t(files.length + more === 1 ? 'turn.changedOne' : 'turn.changedMany', { n: files.length + more }) : t('turn.changedUnknown')}</div>
          {data ? <div className="font-mono text-xs tabular-nums"><span className="text-success">+{added}</span> <span className="text-destructive">−{removed}</span></div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {user && !running && fullPc() ? <Button variant="ghost" onClick={() => rewindFrom(sessionId, user)} title={t('turn.rewindTip', { message: snippet(user) })} data-testid="turn-rewind"><Undo2 className="size-3.5" />{t('turn.rewind')}</Button> : null}
          <Button variant="outline" onClick={review} title={t('turn.reviewTip')} data-testid="turn-review">{t('turn.review')}</Button>
          <Button variant="ghost" size="icon-xs" aria-label={open ? t('turn.fold') : t('turn.unfold')} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="turn-fold"><ChevronDown className={cn('transition-transform', !open && '-rotate-90')} /></Button>
        </div>
      </div>
      {open ? (
        <div data-testid="turn-card-files">
          {shown.map((f) => {
            const Icon = fileIcon(f);
            return (
              <button key={f.path} type="button" onClick={review} className="hover:bg-accent flex w-full cursor-pointer items-center gap-2.5 border-t px-3 py-[9px] text-left" data-testid="turn-card-file">
                <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>{f.path}</span>
                {f.binary ? <span className="text-faint-foreground text-xs">{t(PICTURE.test(f.path) ? 'turn.image' : 'turn.binary')}</span>
                  : <><span className="text-success font-mono text-xs tabular-nums">+{f.added}</span><span className="text-destructive font-mono text-xs tabular-nums">−{f.removed}</span></>}
                <ChevronDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
              </button>
            );
          })}
          {files.length > SHOWN && !all ? <button type="button" onClick={() => setAll(true)} className="hover:bg-accent text-muted-foreground flex w-full cursor-pointer items-center gap-2.5 border-t px-3 py-[9px] text-left" data-testid="turn-card-more"><ChevronRight className="size-3.5" aria-hidden="true" />{t('turn.moreFiles', { n: files.length - SHOWN })}</button> : null}
          {more ? <p className="text-muted-foreground border-t px-3 py-2 text-xs" data-testid="turn-card-cut">{t('tasks.changes.more', { n: more })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// «Trabajó 4 min 20 s»: the tool calls of a run under one line, folded once the answer is out; the run still going stays open.
function Worked({ entry, live, children }) {
  const t = useT();
  const [manual, setManual] = useState(null);
  const open = manual ?? live;
  const span = formatSpan(entry.ms);
  const line = live ? t('worked.running') : span ? t('worked.line', { time: span }) : t('worked.lineNoTime');
  return (
    <Collapsible open={open} onOpenChange={setManual} className="worked-group" data-testid="worked">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex w-full cursor-pointer items-center gap-1.5 text-[13px]" aria-label={t('worked.toggle', { line })} data-testid="worked-toggle">
        <span>{line}</span><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent><div className="mt-2 grid gap-2 pl-5">{children}</div></CollapsibleContent>
    </Collapsible>
  );
}

// The blocks of a conversation with the turn cards and the folded «Trabajó…» lines; the view says how to draw one block.
export function TurnFlow({ blocks, session, running, renderBlock }) {
  const enabled = session.kind === 'chat' && Boolean(session.project) && fullPc();
  const list = useTurns(session, enabled);
  const turns = list?.available ? list.turns : EMPTY;
  const placed = useMemo(() => placeTurns(blocks, turns), [blocks, turns]);
  const entries = useMemo(() => groupWorked(blocks), [blocks]);
  return entries.map((entry, i) => {
    const last = entry.blocks.at(-1);
    const card = placed.get(last.key);
    const live = running && i === entries.length - 1;
    return (
      <Fragment key={entry.key ?? last.key}>
        {entry.worked ? <Worked entry={entry} live={live}>{entry.blocks.map(renderBlock)}</Worked> : renderBlock(last)}
        {card ? <TurnCard sessionId={session.id} turn={turns.find((x) => x.n === card.n)} user={card.user} running={running || session.status === 'running'} /> : null}
      </Fragment>
    );
  });
}
