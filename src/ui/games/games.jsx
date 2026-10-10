// 2.6: mini-games while the agents work. A window with the list of games and the difficulty; the game in the middle with
// its score and best score (kept on this PC). Opened from the gamepad of the top bar or from the assistant's message.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Gamepad2, RotateCcw, ArrowLeft, Trophy, Flag, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, BubbleTip } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useStore, setState } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { LEVELS, best, saveBest } from './kit.js';
import { THUMBS } from './thumbs.jsx';
import { sfx, arm, stopAll, isMuted, setMuted } from './sfx.js';

// Each game is loaded only when it is played.
const GAMES = [
  { id: 'snake', load: lazy(() => import('./snake.jsx')) },
  { id: 'tetris', load: lazy(() => import('./tetris.jsx')) },
  { id: 'chess', load: lazy(() => import('./chess.jsx')) },
  { id: 'runner', load: lazy(() => import('./runner.jsx')) },
  { id: 'g2048', load: lazy(() => import('./g2048.jsx')) },
  { id: 'breakout', load: lazy(() => import('./breakout.jsx')) },
  { id: 'invaders', load: lazy(() => import('./invaders.jsx')) },
  { id: 'pacman', load: lazy(() => import('./pacman.jsx')) }
];

// The game's picture, on a soft tinted stage.
const STAGE = 'from-primary/12 via-primary/6 to-transparent dark:from-primary/22 dark:via-primary/10 bg-gradient-to-br';

export function GamesDialog() {
  const t = useT();
  const open = useStore((s) => s.games);
  const [game, setGame] = useState(null);
  const [level, setLevel] = useState('normal');
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(null); // { score, record }
  // Sound: Ajustes › Sonidos rules; the games' own mute is kept for this window.
  const appSounds = useStore((s) => s.app?.config?.ui?.sounds !== false);
  const [mute, setMute] = useState(isMuted);
  const soundOn = appSounds && !mute;
  useEffect(() => (open ? arm() : undefined), [open]);
  const toggleSound = () => { if (!appSounds) return; setMuted(soundOn); setMute(soundOn); if (!soundOn) sfx('select'); };
  const close = () => { stopAll(); setState({ games: false }); setGame(null); setOver(null); };
  const start = (id) => { stopAll(); sfx('start'); setGame(id); setScore(0); setOver(null); setRound((r) => r + 1); };
  const back = () => { stopAll(); sfx('select'); setGame(null); setOver(null); };
  // The end of a game: a new record gets a fanfare, otherwise a short falling tune after the game's own crash. Chess
  // and Jumper end with a tune of their own, so they only add the record one.
  const ended = (s) => {
    const rec = saveBest(game, level, s);
    setOver({ score: s, record: rec });
    const own = game === 'chess' || game === 'runner';
    if (rec) sfx('record', null, { delay: own ? 0.9 : 0.5 }); else if (!own) sfx('over', null, { delay: 0.5 });
  };
  const g = GAMES.find((x) => x.id === game);
  const Game = g?.load;
  const record = game ? best(game, level) : 0;
  const soundText = !appSounds ? t('games.soundAppOff') : soundOn ? t('games.soundOn') : t('games.soundOff');
  return (
    <Dialog open={Boolean(open)} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-h-[92vh] w-[min(760px,96vw)] max-w-none overflow-y-auto outline-none sm:max-w-none" data-testid="games-dialog">
        <div className="flex items-center gap-2.5 pr-6">
          {game ? <Button variant="ghost" size="icon-sm" onClick={back} aria-label={t('games.back')}><ArrowLeft /></Button> : <span className="bg-primary/12 text-primary grid size-9 place-items-center rounded-xl"><Gamepad2 className="size-5" /></span>}
          <div className="min-w-0 flex-1">
            <DialogTitle>{game ? t(`games.${game}`) : t('games.title')}</DialogTitle>
            <DialogDescription className="mt-1">{game ? t(`games.${game}Help`) : t('games.desc')}</DialogDescription>
          </div>
          <BubbleTip title={t('games.sound')} text={soundText}>
            <Button variant="ghost" size="icon-sm" onClick={toggleSound} aria-label={t('games.sound')} aria-pressed={soundOn} aria-disabled={!appSounds || undefined} data-testid="games-sound"
              className={cn(!soundOn && 'text-muted-foreground', !appSounds && 'opacity-60')}>{soundOn ? <Volume2 /> : <VolumeX />}</Button>
          </BubbleTip>
        </div>
        {/* Difficulty: chosen before playing, and changing it starts the game again. */}
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('games.level')}>
          <span className="text-muted-foreground text-xs">{t('games.level')}</span>
          <div className="bg-muted inline-flex gap-0.5 rounded-full p-0.5">
            {LEVELS.map((l) => (
              <button key={l} role="radio" aria-checked={level === l} onClick={() => { setLevel(l); if (game) start(game); else sfx('select'); }} data-testid={`games-level-${l}`}
                className={cn('cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-all', level === l ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{t(`games.level_${l}`)}</button>
            ))}
          </div>
        </div>
        {!game ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {GAMES.map((x) => {
              const Thumb = THUMBS[x.id]; const n = best(x.id, level);
              return (
                <button key={x.id} onClick={() => start(x.id)} data-testid={`game-${x.id}`}
                  className="group bg-card hover:border-primary/50 focus-visible:ring-ring/50 grid cursor-pointer gap-2 overflow-hidden rounded-2xl border p-2 pb-3 text-left shadow-xs transition-all duration-200 outline-none hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-[3px] motion-reduce:hover:translate-y-0">
                  <div className={cn('relative aspect-[3/2] overflow-hidden rounded-xl', STAGE)}>
                    <div className="h-full w-full transition-transform duration-300 group-hover:scale-[1.06] motion-reduce:group-hover:scale-100"><Thumb /></div>
                    {n > 0 ? <span className="bg-card/85 text-foreground absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shadow-sm backdrop-blur"><Trophy className="text-warning size-3" />{n}</span> : null}
                  </div>
                  <div className="px-1.5">
                    <div className="font-medium">{t(`games.${x.id}`)}</div>
                    <div className="text-muted-foreground text-xs">{t('games.record', { n })}</div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid justify-items-center gap-3">
            <div className="flex w-full items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1"><span className="text-muted-foreground text-xs">{t('games.score')}</span><b className="tabular-nums">{score}</b></span>
                <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1"><Trophy className="text-warning size-3.5" /><span className="text-muted-foreground text-xs">{t('games.best')}</span><b className="tabular-nums">{Math.max(record, score)}</b></span>
              </div>
              <Button variant="outline" size="xs" onClick={() => start(game)}><RotateCcw />{t('games.restart')}</Button>
            </div>
            <div className="relative max-w-full">
              <Suspense fallback={<div className="text-muted-foreground p-10 text-sm">…</div>}>
                <Game key={`${game}-${level}-${round}`} level={level} paused={Boolean(over) || !open} onScore={setScore}
                  onOver={ended} />
              </Suspense>
              {over ? (
                <div className="bg-background/60 absolute inset-0 grid place-items-center rounded-2xl backdrop-blur-sm" data-testid="game-over">
                  <div className="bg-card text-card-foreground animate-in fade-in-0 zoom-in-95 grid min-w-56 justify-items-center gap-3 rounded-2xl border p-6 text-center shadow-xl duration-300">
                    <span className={cn('grid size-12 place-items-center rounded-full', over.record ? 'bg-warning/15 text-warning' : 'bg-primary/12 text-primary')}>{over.record ? <Sparkles className="size-6" /> : <Flag className="size-6" />}</span>
                    <div className="text-lg leading-tight font-medium">{over.record ? t('games.newRecord') : t('games.over')}</div>
                    <div className="grid gap-0.5">
                      <div className="text-3xl font-semibold tabular-nums">{over.score}</div>
                      <div className="text-muted-foreground inline-flex items-center justify-center gap-1 text-xs"><Trophy className="text-warning size-3" />{t('games.record', { n: Math.max(record, over.score) })}</div>
                    </div>
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
