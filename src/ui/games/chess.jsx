// Chess against the computer: you play White. Click a piece and then where it goes; the legal squares are marked.
import { useEffect, useState } from 'react';
import { newGame, legalMoves, play, outcome, bestMove, inCheck } from './chess-engine.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export default function Chess({ level, onScore, onOver, paused }) {
  const t = useT();
  const [g, setG] = useState(newGame);
  const [pick, setPick] = useState(null);
  const [last, setLast] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [end, setEnd] = useState(null);
  const moves = pick === null ? [] : legalMoves(g).filter((m) => m.from === pick);
  // Points: the value of the pieces taken from the computer; a win is worth 100 more.
  const taken = (board) => 39 - board.filter((p) => p && p === p.toLowerCase() && p !== 'k').reduce((s, p) => s + VALUE[p], 0);
  const finish = (next) => { const o = outcome(next); if (!o) return false; const won = o === 'mate' && next.turn === 'b'; setEnd(o === 'mate' ? (won ? 'win' : 'lose') : 'draw'); onOver(taken(next.board) + (won ? 100 : 0)); return true; };
  // The computer answers a moment later (the board shows the move first).
  useEffect(() => {
    if (g.turn !== 'b' || end || paused) return undefined;
    setThinking(true);
    const id = setTimeout(() => {
      const m = bestMove(g, level);
      setThinking(false);
      if (!m) return;
      const next = play(g, m); setG(next); setLast(m);
      finish(next);
    }, 250);
    return () => clearTimeout(id);
  }, [g, end, paused]); // eslint-disable-line react-hooks/exhaustive-deps
  const click = (i) => {
    if (g.turn !== 'w' || end || thinking || paused) return;
    const m = moves.find((x) => x.to === i);
    if (m) {
      const next = play(g, m); setG(next); setLast(m); setPick(null);
      onScore(taken(next.board));
      finish(next);
      return;
    }
    setPick(g.board[i] && g.board[i] === g.board[i].toUpperCase() ? i : null);
  };
  const check = inCheck(g) ? g.board.indexOf(g.turn === 'w' ? 'K' : 'k') : -1;
  return (
    <div className="grid justify-items-center gap-2">
      <div className="grid grid-cols-8 grid-rows-8 overflow-hidden rounded-xl border shadow-sm" style={{ width: 400, height: 400 }} aria-label={t('games.chess')}>
        {g.board.map((p, i) => {
          const dark = ((i >> 3) + (i & 7)) % 2 === 1;
          const target = moves.some((m) => m.to === i);
          return (
            <button key={i} onClick={() => click(i)} data-testid={`chess-${i}`}
              className={cn('relative grid cursor-pointer place-items-center text-[34px] leading-none select-none', dark ? 'bg-primary/35' : 'bg-primary/10',
                (last?.from === i || last?.to === i) && 'bg-warning/40', pick === i && 'ring-primary ring-3 ring-inset', check === i && 'bg-destructive/50')}>
              {p ? <span className={cn(p === p.toUpperCase() ? 'text-white drop-shadow-[0_1px_1px_rgb(0_0_0/0.7)]' : 'text-zinc-900')}>{GLYPH[p]}</span> : null}
              {target ? <span className={cn('absolute rounded-full', p ? 'inset-1 border-4 border-primary/60' : 'bg-primary/60 size-3')} /> : null}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground h-5 text-xs">{end === 'win' ? t('games.chessWin') : end === 'lose' ? t('games.chessLose') : end === 'draw' ? t('games.chessDraw') : thinking ? t('games.chessThinking') : check >= 0 ? t('games.chessCheck') : t('games.chessYourTurn')}</p>
    </div>
  );
}
