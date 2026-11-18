// mini-games while the agents work. A window with the list of games and the difficulty; the game in the middle with
// its score and best score (kept on this PC). Opened from the gamepad of the top bar or from the assistant's message.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Sparkles, RotateCcw, ArrowLeft, X, Volume2, VolumeX, Music, Worm, Blocks, Crown, Footprints, Grid2x2, BrickWall, Rocket, Ghost } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogClose, DialogTitle, DialogDescription, BubbleTip } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { useStore, setState, robotSkin } from '@/lib/store.js';
import { OrbMark } from '@/components/orb-mark.jsx';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { LEVELS, best, saveBest } from './kit.js';
import { sfx, arm, stopAll, isMuted, setMuted } from './sfx.js';
import { available as musicAvailable, startGameMusic, stopGameMusic, setGameMusic } from '@/lib/music.js';

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

// The game's glyph on its card of the list.
const ICONS = { snake: Worm, tetris: Blocks, chess: Crown, runner: Footprints, g2048: Grid2x2, breakout: BrickWall, invaders: Rocket, pacman: Ghost };

export function GamesDialog() {
  const t = useT();
  const open = useStore((s) => s.games);
  const skin = useStore((s) => s.app?.config?.ui?.skin);
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
  useEffect(() => { if (!open) stopGameMusic(); }, [open]);
  useEffect(() => stopGameMusic, []);
  const toggleSound = () => { if (!appSounds) return; setMuted(soundOn); setMute(soundOn); if (!soundOn) sfx('select'); };
  // each game's own music (Windows, lib/music.js), with its own mute, remembered (ui.gameMusic).
  const music = useStore((s) => s.app?.config?.ui?.gameMusic !== false);
  const close = () => { stopAll(); stopGameMusic(); setState({ games: false }); setGame(null); setOver(null); };
  const start = (id) => { stopAll(); sfx('start'); setGame(id); setScore(0); setOver(null); setRound((r) => r + 1); startGameMusic(id); };
  const back = () => { stopAll(); stopGameMusic(); sfx('select'); setGame(null); setOver(null); };
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
      <DialogContent showClose={false} className={cn('max-h-[92vh] max-w-none overflow-y-auto outline-none sm:max-w-none', game ? 'w-[min(560px,96vw)]' : 'w-[min(760px,96vw)]')} data-testid="games-dialog">
        <DialogHeader className="flex-row items-center gap-2 pr-2.5">
          {game ? <Button variant="ghost" size="icon-sm" onClick={back} aria-label={t('games.back')}><ArrowLeft /></Button> : null}
          <DialogTitle className="min-w-0 flex-1 text-card-title">{game ? t(`games.${game}`) : t('games.title')}</DialogTitle>
          <BubbleTip title={t('games.sound')} text={soundText}>
            <Button variant="ghost" size="icon-sm" onClick={toggleSound} aria-label={t('games.sound')} aria-pressed={soundOn} aria-disabled={!appSounds || undefined} data-testid="games-sound"
              className={cn('aria-[pressed=false]:opacity-50', !appSounds && 'opacity-60')}>{soundOn ? <Volume2 /> : <VolumeX />}</Button>
          </BubbleTip>
          {musicAvailable() ? (
            <BubbleTip title={t('games.music')} text={music ? t('games.musicOn') : t('games.musicOff')}>
              <Button variant="ghost" size="icon-sm" onClick={() => setGameMusic(!music, game)} aria-label={t('games.music')} aria-pressed={music} data-testid="games-music"
                className="relative aria-[pressed=false]:opacity-50"><Music />{music ? null : <span className="absolute h-[1.5px] w-5 rotate-45 rounded bg-current" aria-hidden="true" />}</Button>
            </BubbleTip>
          ) : null}
          <DialogClose asChild><Button variant="ghost" size="icon-sm" aria-label={t('comp.close')} data-testid="games-close"><X /></Button></DialogClose>
        </DialogHeader>
        <div className="flex flex-col gap-3.5">
          <DialogDescription className={cn('text-control', game && 'text-center')}>{game ? t(`games.${game}Help`) : t('games.desc')}</DialogDescription>
          {/* Difficulty: chosen before playing, and changing it starts the game again. */}
          <div className={cn('flex items-center gap-3 text-control', game ? 'justify-center' : 'justify-between')} role="radiogroup" aria-label={t('games.level')}>
            <span className="text-muted-foreground">{t('games.level')}</span>
            <div className="segm bg-secondary inline-flex gap-0.5 rounded-ctl p-0.5">
              {LEVELS.map((l) => (
                <button key={l} role="radio" aria-checked={level === l} onClick={() => { setLevel(l); if (game) start(game); else sfx('select'); }} data-testid={`games-level-${l}`}
                  className={cn('inline-flex h-(--ctl-sm) cursor-pointer items-center rounded-[calc(var(--r-ctl)-2px)] px-2.5 text-control transition-[color,background-color] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-ring', level === l ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground')}>{t(`games.level_${l}`)}</button>
              ))}
            </div>
          </div>
          {!game ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {GAMES.map((x) => {
                const Icon = ICONS[x.id]; const n = best(x.id, level);
                return (
                  <button key={x.id} onClick={() => start(x.id)} data-testid={`game-${x.id}`}
                    className="bg-card border-border hover:bg-accent focus-visible:outline-ring rounded-card flex cursor-pointer flex-col items-start gap-1 border p-2.5 text-left transition-[background-color,transform] duration-200 outline-none hover:-translate-y-0.5 focus-visible:outline-2 motion-reduce:hover:translate-y-0">
                    <span className="bg-primary-soft text-primary-text relative grid h-18 w-full place-items-center rounded-ctl"><Icon className="size-6" />{n > 0 ? <Badge className="absolute top-1.5 right-1.5 tabular-nums">{n}</Badge> : null}</span>
                    <b className="text-control font-medium">{t(`games.${x.id}`)}</b>
                    <span className="text-muted-foreground text-caption">{t('games.record', { n })}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3.5">
              <div className="flex w-full gap-2.5">
                {[[t('games.score'), score], [t('games.best'), Math.max(record, score)]].map(([label, value]) => (
                  <div key={label} className="bg-card border-border rounded-card flex flex-1 flex-col gap-1 border px-3.5 py-3"><span className="text-muted-foreground text-caption leading-[1.45]">{label}</span><b className="font-(family-name:--title) text-2xl leading-[1.45] font-semibold tabular-nums">{value}</b></div>
                ))}
              </div>
              <div className="relative max-w-full [&_canvas]:h-auto! [&_canvas]:max-w-[362px]">
                <Suspense fallback={<div className="text-muted-foreground p-10 text-control">…</div>}>
                  <Game key={`${game}-${level}-${round}`} level={level} paused={Boolean(over) || !open} onScore={setScore}
                    onOver={ended} />
                </Suspense>
                {over ? (
                  <div className="absolute inset-0 grid place-items-center rounded-card bg-[color-mix(in_oklab,var(--background)_82%,transparent)] text-center" data-testid="game-over">
                    <div className="animate-in fade-in-0 zoom-in-95 flex flex-col items-center gap-1.5 duration-300">
                      <b className="font-(family-name:--title) text-lg font-semibold">{t('games.over')}</b>
                      {over.record ? (
                        <>
                          {/* the record's burst: a pop of the spark (the robot only with the Orb theme); still with reduced motion */}
                          <span className="bg-warning/15 text-warning-ink animate-in zoom-in-50 fade-in-0 mb-1 grid size-12 place-items-center rounded-full duration-500 motion-reduce:animate-none [html[data-motion=minima]_&]:animate-none" data-testid="game-record">{robotSkin(skin) ? <OrbMark size={24} /> : <Sparkles className="size-6" />}</span>
                          <span className="text-primary-text font-medium">{t('games.newRecord')}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
        {game ? (
          <DialogFooter>
            <Button variant="ghost" className="sm:mr-auto" onClick={back}>{t('games.back')}</Button>
            <Button onClick={() => start(game)}><RotateCcw />{over ? t('games.again') : t('games.restart')}</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

