// Chess against the computer: you play White. Click a piece and then where it goes; the legal squares are marked.
// Vector pieces, coordinates, the last move and the check highlighted, the piece slides to its square, the pieces taken
// on each side. The computer thinks in a Web Worker (the board never freezes); without workers it thinks right here.
import { useEffect, useRef, useState } from 'react';
import { newGame, legalMoves, play, outcome, bestMove, inCheck } from './chess-engine.js';
import { Piece } from './chess-pieces.jsx';
import { reducedMotion } from './kit.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const SQ = 50; const SIZE = SQ * 8;
const FILES = 'abcdefgh';

// ---- the computer's brain: a worker when it can, the same code on this thread if not.
let worker = null; let workerBroken = false; let seq = 0;
function think(game, level) {
  return new Promise((resolve) => {
    const local = () => resolve(bestMove(game, level));
    if (workerBroken || typeof Worker === 'undefined') return local();
    try {
      worker ||= new Worker(new URL('./chess-worker.js', import.meta.url), { type: 'module' });
    } catch { workerBroken = true; return local(); }
    const id = ++seq; let done = false;
    const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); worker?.removeEventListener('message', onMessage); worker?.removeEventListener('error', onError); fn(); };
    const onMessage = (e) => { if (e.data?.id === id) finish(() => resolve(e.data.move)); };
    const onError = () => { workerBroken = true; try { worker?.terminate(); } catch { /* already gone */ } worker = null; finish(local); };
    const timer = setTimeout(onError, 12000); // a worker that never answers: think here instead
    worker.addEventListener('message', onMessage); worker.addEventListener('error', onError);
    worker.postMessage({ id, game, level });
  });
}

// What each side has taken, from what is missing on the board.
const captured = (board, color) => {
  const out = [];
  for (const k of ['q', 'r', 'b', 'n', 'p']) {
    const code = color === 'w' ? k.toUpperCase() : k;
    const missing = START_COUNT[k] - board.filter((p) => p === code).length;
    for (let i = 0; i < missing; i++) out.push(code);
  }
  return out;
};
const material = (board, color) => board.filter((p) => p && (p === p.toUpperCase()) === (color === 'w') && p.toLowerCase() !== 'k').reduce((s, p) => s + VALUE[p.toLowerCase()], 0);

export default function Chess({ level, onScore, onOver, paused }) {
  const t = useT();
  const [g, setG] = useState(newGame);
  const [pick, setPick] = useState(null);
  const [last, setLast] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [end, setEnd] = useState(null);
  const [anim, setAnim] = useState(null); // { id, from, to, piece, go }
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const moves = pick === null ? [] : legalMoves(g).filter((m) => m.from === pick);
  // Points: the value of the pieces taken from the computer; a win is worth 100 more.
  const taken = (board) => 39 - material(board, 'b');
  const finish = (next) => { const o = outcome(next); if (!o) return false; const won = o === 'mate' && next.turn === 'b'; setEnd(o === 'mate' ? (won ? 'win' : 'lose') : 'draw'); onOver(taken(next.board) + (won ? 100 : 0)); return true; };
  // The piece slides from its square to the new one (the board already shows the move underneath).
  const slide = (m, piece) => { if (reducedMotion()) return; setAnim({ id: ++seq, from: m.from, to: m.to, piece, go: false }); };
  useEffect(() => {
    if (!anim || anim.go) return undefined;
    const raf = requestAnimationFrame(() => setAnim((a) => (a && !a.go ? { ...a, go: true } : a)));
    return () => cancelAnimationFrame(raf);
  }, [anim]);
  useEffect(() => {
    if (!anim?.go) return undefined;
    const id = setTimeout(() => setAnim((a) => (a?.id === anim.id ? null : a)), 190);
    return () => clearTimeout(id);
  }, [anim]);
  // The computer answers a moment later (the board shows your move first).
  useEffect(() => {
    if (g.turn !== 'b' || end || paused) return undefined;
    setThinking(true);
    let cancelled = false;
    const id = setTimeout(async () => {
      const started = performance.now();
      const m = await think(g, level);
      // At least a short pause, so the answer does not feel instant.
      await new Promise((r) => setTimeout(r, Math.max(0, 320 - (performance.now() - started))));
      if (cancelled || !alive.current) return;
      setThinking(false);
      if (!m) return;
      const next = play(g, m); setG(next); setLast(m); slide(m, m.promo ? 'q' : m.piece);
      finish(next);
    }, 120);
    return () => { cancelled = true; clearTimeout(id); };
  }, [g, end, paused]); // eslint-disable-line react-hooks/exhaustive-deps
  const click = (i) => {
    if (g.turn !== 'w' || end || thinking || paused) return;
    const m = moves.find((x) => x.to === i);
    if (m) {
      const next = play(g, m); setG(next); setLast(m); setPick(null); slide(m, m.promo ? 'Q' : m.piece);
      onScore(taken(next.board));
      finish(next);
      return;
    }
    setPick(g.board[i] && g.board[i] === g.board[i].toUpperCase() ? i : null);
  };
  const check = inCheck(g) ? g.board.indexOf(g.turn === 'w' ? 'K' : 'k') : -1;
  const pos = (i) => `translate(${(i & 7) * SQ}px, ${(i >> 3) * SQ}px)`;
  const diff = material(g.board, 'w') - material(g.board, 'b');
  const strip = (color, side) => {
    const list = captured(g.board, color === 'w' ? 'b' : 'w'); // what this side has taken
    const lead = color === 'w' ? diff : -diff;
    return (
      <div className={cn('flex h-6 items-center gap-0.5 px-1', side)} style={{ width: SIZE }} aria-hidden="true">
        {list.map((p, i) => <Piece key={i} code={p} size={20} className={cn(i > 0 && list[i - 1] === p && '-ml-2.5')} />)}
        {lead > 0 ? <span className="text-muted-foreground ml-1 text-[11px] font-semibold tabular-nums">+{lead}</span> : null}
      </div>
    );
  };
  const status = end === 'win' ? t('games.chessWin') : end === 'lose' ? t('games.chessLose') : end === 'draw' ? t('games.chessDraw') : thinking ? t('games.chessThinking') : check >= 0 ? t('games.chessCheck') : t('games.chessYourTurn');
  return (
    <div className="grid justify-items-center gap-1.5">
      {strip('b', 'justify-start')}
      <div className="relative overflow-hidden rounded-xl shadow-lg ring-1 ring-black/10 dark:ring-white/10" style={{ width: SIZE, height: SIZE }}>
        <div className="grid grid-cols-8 grid-rows-8" style={{ width: SIZE, height: SIZE }} aria-label={t('games.chess')}>
          {g.board.map((p, i) => {
            const dark = ((i >> 3) + (i & 7)) % 2 === 1;
            const target = moves.some((m) => m.to === i);
            const lastSq = last?.from === i || last?.to === i;
            const hidden = anim && anim.to === i; // the sliding copy is drawn above
            return (
              <button key={i} onClick={() => click(i)} data-testid={`chess-${i}`} aria-label={`${FILES[i & 7]}${8 - (i >> 3)}${p ? ` ${p}` : ''}`}
                className={cn('relative grid cursor-pointer place-items-center select-none outline-none transition-colors duration-150',
                  // Light theme: tinted card; dark theme: a lighter board, so the black pieces still stand out.
                  dark ? 'bg-[color-mix(in_oklab,var(--primary)_42%,var(--card))] dark:bg-[color-mix(in_oklab,var(--primary)_72%,var(--card))]' : 'bg-[color-mix(in_oklab,var(--primary)_9%,var(--card))] dark:bg-[color-mix(in_oklab,var(--primary)_28%,var(--muted-foreground))]',
                  lastSq && (dark ? 'bg-[color-mix(in_oklab,var(--warning)_45%,var(--card))] dark:bg-[color-mix(in_oklab,var(--warning)_70%,var(--card))]' : 'bg-[color-mix(in_oklab,var(--warning)_28%,var(--card))] dark:bg-[color-mix(in_oklab,var(--warning)_55%,var(--muted-foreground))]'),
                  pick === i && 'bg-[color-mix(in_oklab,var(--primary)_60%,var(--card))] dark:bg-[color-mix(in_oklab,var(--primary)_90%,var(--card))]',
                  check === i && 'bg-[radial-gradient(circle,var(--destructive)_0%,color-mix(in_oklab,var(--destructive)_55%,transparent)_45%,transparent_75%)]',
                  !end && g.turn === 'w' && !thinking && 'hover:brightness-105')}>
                {(i & 7) === 0 ? <span className={cn('pointer-events-none absolute top-0.5 left-1 text-[9px] font-semibold', dark ? 'text-white/70' : 'text-foreground/45')}>{8 - (i >> 3)}</span> : null}
                {i >= 56 ? <span className={cn('pointer-events-none absolute right-1 bottom-0 text-[9px] font-semibold', dark ? 'text-white/70' : 'text-foreground/45')}>{FILES[i & 7]}</span> : null}
                {p && !hidden ? <Piece code={p} size={SQ - 6} className={cn('drop-shadow-[0_2px_1.5px_rgb(0_0_0/0.35)]', pick === i && '-translate-y-0.5 scale-105')} style={{ transition: 'transform 120ms' }} /> : null}
                {target ? <span className={cn('pointer-events-none absolute rounded-full', p ? 'inset-[3px] border-[5px] border-[color-mix(in_oklab,var(--primary)_55%,transparent)] dark:border-black/35' : 'size-4 bg-[color-mix(in_oklab,var(--primary)_55%,transparent)] dark:bg-black/35')} /> : null}
              </button>
            );
          })}
        </div>
        {anim ? <div className="pointer-events-none absolute top-0 left-0 grid place-items-center" style={{ width: SQ, height: SQ, transform: pos(anim.go ? anim.to : anim.from), transition: anim.go ? 'transform 170ms cubic-bezier(.2,.8,.2,1)' : 'none', zIndex: 5 }}><Piece code={anim.piece} size={SQ - 6} className="drop-shadow-[0_4px_4px_rgb(0_0_0/0.35)]" /></div> : null}
      </div>
      {strip('w', 'justify-start')}
      <p className={cn('flex h-5 items-center gap-1.5 text-xs', end === 'win' ? 'text-success font-medium' : end === 'lose' ? 'text-destructive font-medium' : check >= 0 && !end && !thinking ? 'text-destructive font-medium' : 'text-muted-foreground')}>
        {thinking && !end ? <span className="bg-primary inline-block size-1.5 animate-pulse rounded-full" /> : null}
        {status}
      </p>
    </div>
  );
}
