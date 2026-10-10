// 2.6: mini-games while the agents work. A window with the list of games and the difficulty; the game in the middle with
// its score and best score (kept on this PC). Opened from the gamepad of the top bar or from the assistant's message.
import { lazy, Suspense, useState } from 'react';
import { Gamepad2, RotateCcw, ArrowLeft, Trophy } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useStore, setState } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { LEVELS, best, saveBest } from './kit.js';

// Each game is loaded only when it is played.
const GAMES = [
  { id: 'snake', icon: '🐍', load: lazy(() => import('./snake.jsx')) },
  { id: 'tetris', icon: '🧱', load: lazy(() => import('./tetris.jsx')) },
  { id: 'chess', icon: '♞', load: lazy(() => import('./chess.jsx')) },
  { id: 'runner', icon: '🟦', load: lazy(() => import('./runner.jsx')) },
  { id: 'g2048', icon: '🔢', load: lazy(() => import('./g2048.jsx')) },
  { id: 'breakout', icon: '🏓', load: lazy(() => import('./breakout.jsx')) }
];

export function GamesDialog() {
  const t = useT();
  const open = useStore((s) => s.games);
  const [game, setGame] = useState(null);
  const [level, setLevel] = useState('normal');
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(null); // { score, record }
  const close = () => { setState({ games: false }); setGame(null); setOver(null); };
  const start = (id) => { setGame(id); setScore(0); setOver(null); setRound((r) => r + 1); };
  const g = GAMES.find((x) => x.id === game);
  const Game = g?.load;
  return (
    <Dialog open={Boolean(open)} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-h-[92vh] w-[min(760px,96vw)] max-w-none overflow-y-auto sm:max-w-none" data-testid="games-dialog">
        <div className="flex items-center gap-2.5 pr-6">
          {game ? <Button variant="ghost" size="icon-sm" onClick={() => setGame(null)} aria-label={t('games.back')}><ArrowLeft /></Button> : <Gamepad2 className="text-primary size-5" />}
          <div className="min-w-0 flex-1">
            <DialogTitle>{game ? t(`games.${game}`) : t('games.title')}</DialogTitle>
            <DialogDescription className="mt-1">{game ? t(`games.${game}Help`) : t('games.desc')}</DialogDescription>
          </div>
        </div>
        {/* Difficulty: chosen before playing, and changing it starts the game again. */}
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('games.level')}>
          <span className="text-muted-foreground text-xs">{t('games.level')}</span>
          {LEVELS.map((l) => (
            <button key={l} role="radio" aria-checked={level === l} onClick={() => { setLevel(l); if (game) start(game); }} data-testid={`games-level-${l}`}
              className={cn('cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors', level === l ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent')}>{t(`games.level_${l}`)}</button>
          ))}
        </div>
        {!game ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {GAMES.map((x) => (
              <button key={x.id} onClick={() => start(x.id)} data-testid={`game-${x.id}`}
                className="hover:border-primary/60 hover:bg-accent/50 group grid cursor-pointer gap-1 rounded-2xl border p-4 text-left transition-colors">
                <span className="text-3xl transition-transform group-hover:scale-110" aria-hidden="true">{x.icon}</span>
                <span className="font-medium">{t(`games.${x.id}`)}</span>
                <span className="text-muted-foreground text-xs">{t('games.record', { n: best(x.id, level) })}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid justify-items-center gap-3">
            <div className="flex w-full items-center justify-between text-sm">
              <span>{t('games.score')}: <b className="tabular-nums">{score}</b></span>
              <span className="text-muted-foreground inline-flex items-center gap-1"><Trophy className="size-3.5" />{t('games.best')}: <b className="tabular-nums">{Math.max(best(game, level), score)}</b></span>
              <Button variant="outline" size="xs" onClick={() => start(game)}><RotateCcw />{t('games.restart')}</Button>
            </div>
            <div className="relative">
              <Suspense fallback={<div className="text-muted-foreground p-10 text-sm">…</div>}>
                <Game key={`${game}-${level}-${round}`} level={level} paused={Boolean(over) || !open} onScore={setScore}
                  onOver={(s) => setOver({ score: s, record: saveBest(game, level, s) })} />
              </Suspense>
              {over ? (
                <div className="bg-background/80 absolute inset-0 grid place-items-center rounded-xl backdrop-blur-sm" data-testid="game-over">
                  <div className="grid justify-items-center gap-2 text-center">
                    <div className="text-xl font-medium">{over.record ? t('games.newRecord') : t('games.over')}</div>
                    <div className="text-muted-foreground text-sm">{t('games.score')}: {over.score}</div>
                    <Button size="sm" onClick={() => start(game)}><RotateCcw />{t('games.again')}</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
