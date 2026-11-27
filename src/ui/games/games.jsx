// mini-games while the agents work. A window with the list of games and the difficulty; the game in the middle with
// its score and best score (kept on this PC). Opened from the gamepad of the top bar or from the assistant's message.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, RotateCcw, ArrowLeft, X, Volume2, VolumeX, Music, CircleHelp, Maximize2, Minimize2, Worm, Blocks, Crown, Footprints, Grid2x2, BrickWall, Rocket, Ghost } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogClose, DialogTitle, DialogDescription, BubbleTip } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { useStore, setState, robotSkin } from '@/lib/store.js';
import { OrbMark } from '@/components/orb-mark.jsx';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { LEVELS, best, saveBest, setBoost } from './kit.js';
import { sfx, arm, stopAll, isMuted, setMuted, hearGame } from './sfx.js';
import { available as musicAvailable, startGameMusic, stopGameMusic, setGameMusic, gameMusicEvent, endGameMusic } from '@/lib/music.js';

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

// The game fills the room it is given: the game keeps its own size and proportion and is scaled (never stretched) to the
// largest it can be in the box. The canvases are drawn denser by the same factor (kit.setBoost), so a big game stays sharp.
function Fit({ children }) {
  const box = useRef(null); const inner = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const measure = () => {
      const b = box.current; const g = inner.current; if (!b || !g || !g.offsetWidth || !g.offsetHeight) return;
      const next = Math.min(MAX_SCALE, b.clientWidth / g.offsetWidth, b.clientHeight / g.offsetHeight);
      setScale((old) => (Math.abs(old - next) < 0.005 ? old : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box.current); ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setBoost(scale); }, [scale]);
  useEffect(() => () => setBoost(1), []);
  return (
    <div ref={box} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="game-stage">
      <div ref={inner} className="absolute top-1/2 left-1/2 w-max [&_canvas]:max-w-none!" style={{ transform: `translate(-50%, -50%) scale(${scale})` }} data-testid="game-fit" data-scale={scale.toFixed(2)}>{children}</div>
    </div>
  );
}
const MAX_SCALE = 3.5;

export function GamesDialog() {
  const t = useT();
  const open = useStore((s) => s.games);
  const skin = useStore((s) => s.app?.config?.ui?.skin);
  const [game, setGame] = useState(null);
  const [level, setLevel] = useState('normal');
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(null); // { score, record }
  const [help, setHelp] = useState(false);
  const [full, setFull] = useState(false);
  const shell = useRef(null);
  // Sound: Ajustes › Sonidos rules; the games' own mute is kept for this window.
  const appSounds = useStore((s) => s.app?.config?.ui?.sounds !== false);
  const [mute, setMute] = useState(isMuted);
  const soundOn = appSounds && !mute;
  useEffect(() => (open ? arm() : undefined), [open]);
  useEffect(() => { if (!open) stopGameMusic(); }, [open]);
  useEffect(() => stopGameMusic, []);
  // The game's music follows the play: it hears what happens in it, with the sound effects on or off.
  useEffect(() => (open ? hearGame(gameMusicEvent) : undefined), [open]);
  const toggleSound = () => { if (!appSounds) return; setMuted(soundOn); setMute(soundOn); if (!soundOn) sfx('select'); };
  // Full screen: the dialog takes the whole window (and the browser's full screen when it lets it). F toggles it.
  const toggleFull = () => {
    const next = !full; setFull(next);
    try { if (next) shell.current?.requestFullscreen?.().catch(() => { /* refused: the window's own size is used */ }); else if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* already left */ }); } catch { /* the window's own full size is enough */ }
  };
  useEffect(() => {
    if (!open || !game) return undefined;
    const key = (e) => { if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]')) { e.preventDefault(); toggleFull(); } };
    const leave = () => { if (!document.fullscreenElement) setFull(false); };
    window.addEventListener('keydown', key); document.addEventListener('fullscreenchange', leave);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', leave); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!game) setFull(false); }, [game]);
  // each game's own music (Windows, lib/music.js): made by Orb as the game is played, with its own mute, remembered (ui.gameMusic).
  const music = useStore((s) => s.app?.config?.ui?.gameMusic !== false);
  const close = () => { stopAll(); stopGameMusic(); setState({ games: false }); setGame(null); setOver(null); setFull(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* already left */ }); };
  const start = (id) => { stopAll(); sfx('start'); setHelp(false); setGame(id); setScore(0); setOver(null); setRound((r) => r + 1); startGameMusic(id); };
  const back = () => { stopAll(); stopGameMusic(); sfx('select'); setGame(null); setOver(null); };
  // The end of a game: a new record gets a fanfare, otherwise a short falling tune after the game's own crash. Chess
  // and Jumper end with a tune of their own, so they only add the record one.
  const ended = (s) => {
    const rec = saveBest(game, level, s);
    setOver({ score: s, record: rec });
    endGameMusic(rec);
    const own = game === 'chess' || game === 'runner';
    if (rec) sfx('record', null, { delay: own ? 0.9 : 0.5 }); else if (!own) sfx('over', null, { delay: 0.5 });
  };
  const g = GAMES.find((x) => x.id === game);
  const Game = g?.load;
  const record = game ? best(game, level) : 0;
  const soundText = !appSounds ? t('games.soundAppOff') : soundOn ? t('games.soundOn') : t('games.soundOff');
  const levelPicker = (
    <div className={cn('flex items-center gap-2 text-control', !game && 'justify-between')} role="radiogroup" aria-label={t('games.level')}>
      <span className={cn('text-muted-foreground', game && 'sr-only')}>{t('games.level')}</span>
      <div className="segm bg-secondary inline-flex gap-0.5 rounded-ctl p-0.5">
        {LEVELS.map((l) => (
          <button key={l} role="radio" aria-checked={level === l} onClick={() => { setLevel(l); if (game) start(game); else sfx('select'); }} data-testid={`games-level-${l}`}
            className={cn('inline-flex h-(--ctl-sm) cursor-pointer items-center rounded-[calc(var(--r-ctl)-2px)] px-2.5 text-control transition-[color,background-color] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-ring', level === l ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground')}>{t(`games.level_${l}`)}</button>
        ))}
      </div>
    </div>
  );
  return (
    <Dialog open={Boolean(open)} onOpenChange={(v) => { if (!v) close(); }}>
      {/* in a game the dialog is as big as the window lets it and the game takes what the one-line bar leaves */}
      <DialogContent ref={shell} showClose={false} className={cn('max-w-none outline-none sm:max-w-none', game ? 'h-[min(860px,94vh)] w-[min(1180px,97vw,calc(100vw-2*var(--wco-inset)))] max-h-[94vh] grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden p-3' : 'max-h-[92vh] w-[min(760px,96vw)] overflow-y-auto', full && 'h-dvh max-h-none w-screen max-w-none rounded-none sm:max-w-none')} data-testid="games-dialog" data-full={full || undefined}>
        <DialogHeader className={cn('flex-row items-center gap-2 pr-2.5', game && 'min-h-0 flex-wrap border-b-0 p-0')}>
          {game ? <Button variant="ghost" size="icon-sm" onClick={back} aria-label={t('games.back')}><ArrowLeft /></Button> : null}
          <DialogTitle className={cn('min-w-0 text-card-title', game ? 'shrink-0' : 'flex-1')}>{game ? t(`games.${game}`) : t('games.title')}</DialogTitle>
          {game ? levelPicker : null}
          {game ? (
            <span className="text-muted-foreground text-caption mr-auto ml-1 tabular-nums" data-testid="games-scoreline">
              {t('games.score')} <b className="text-foreground font-semibold" data-testid="games-score">{score}</b> · {t('games.best')} <b className="text-foreground font-semibold" data-testid="games-best">{Math.max(record, score)}</b>
            </span>
          ) : null}
          {game ? (
            <>
              <BubbleTip title={t('games.helpButton')} text={t(`games.${game}Help`)}>
                <Button variant="ghost" size="icon-sm" onClick={() => setHelp(!help)} aria-label={t('games.helpButton')} aria-pressed={help} data-testid="games-help"><CircleHelp /></Button>
              </BubbleTip>
              <BubbleTip title={t('games.restart')}>
                <Button variant="ghost" size="icon-sm" onClick={() => start(game)} aria-label={t('games.restart')} data-testid="games-restart"><RotateCcw /></Button>
              </BubbleTip>
              <BubbleTip title={full ? t('games.fullOff') : t('games.fullOn')} text={t('games.fullKey')}>
                <Button variant="ghost" size="icon-sm" onClick={toggleFull} aria-label={full ? t('games.fullOff') : t('games.fullOn')} aria-pressed={full} data-testid="games-full">{full ? <Minimize2 /> : <Maximize2 />}</Button>
              </BubbleTip>
            </>
          ) : null}
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
        {!game ? (
          <div className="flex flex-col gap-3.5 pt-1.5">
            <DialogDescription className="text-control">{t('games.desc')}</DialogDescription>
            {/* Difficulty: chosen before playing, and changing it starts the game again. */}
            {levelPicker}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {GAMES.map((x) => {
                const Icon = ICONS[x.id]; const n = best(x.id, level);
                return (
                  <button key={x.id} onClick={() => start(x.id)} data-testid={`game-${x.id}`}
                    className="bg-card border-border hover:bg-accent focus-visible:outline-ring rounded-card flex cursor-pointer flex-col items-start gap-1 border p-2.5 text-left transition-[background-color,transform] duration-200 outline-none hover:-translate-y-0.5 focus-visible:outline-2">
                    <span className="bg-primary-soft text-primary-text relative grid h-18 w-full place-items-center rounded-ctl"><Icon className="size-6" />{n > 0 ? <Badge className="absolute top-1.5 right-1.5 tabular-nums">{n}</Badge> : null}</span>
                    <b className="text-control leading-[1.45] font-medium">{t(`games.${x.id}`)}</b>
                    <span className="text-muted-foreground text-caption leading-[1.45]">{t('games.record', { n })}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            {/* the explanation is one line, only when asked for with the ? */}
            <DialogDescription className={cn('text-muted-foreground text-caption truncate leading-[1.45]', !help && 'sr-only')} title={t(`games.${game}Help`)} data-testid="games-help-line">{t(`games.${game}Help`)}</DialogDescription>
            <Fit>
              <div className="relative">
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
                      <Button className="mt-1" onClick={() => start(game)} data-testid="games-again"><RotateCcw />{t('games.again')}</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </Fit>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
