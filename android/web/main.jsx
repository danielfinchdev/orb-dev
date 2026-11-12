// The phone's «Juegos» page: the list of games, the difficulty, the score and touch controls around the desktop games
// (src/ui/games, used as they are). Controls send the same key events the desktop games listen to.
import { StrictMode, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RotateCcw, ArrowLeft, Trophy, Flag, Sparkles, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, RotateCw, ChevronsDown, Crosshair, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { LEVELS, best, saveBest } from '../../src/ui/games/kit.js';
import { THUMBS } from '../../src/ui/games/thumbs.jsx';
import { sfx, arm, stopAll, isMuted, setMuted } from '../../src/ui/games/sfx.js';
import './.gen/app.css';

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');

const GAMES = [
  { id: 'snake', load: lazy(() => import('../../src/ui/games/snake.jsx')), pad: 'dpad' },
  { id: 'tetris', load: lazy(() => import('../../src/ui/games/tetris.jsx')), pad: 'tetris' },
  { id: 'chess', load: lazy(() => import('../../src/ui/games/chess.jsx')), pad: null },
  { id: 'runner', load: lazy(() => import('../../src/ui/games/runner.jsx')), pad: 'jump' },
  { id: 'g2048', load: lazy(() => import('../../src/ui/games/g2048.jsx')), pad: 'dpad' },
  { id: 'breakout', load: lazy(() => import('../../src/ui/games/breakout.jsx')), pad: 'sides' },
  { id: 'invaders', load: lazy(() => import('../../src/ui/games/invaders.jsx')), pad: 'shooter' },
  { id: 'pacman', load: lazy(() => import('../../src/ui/games/pacman.jsx')), pad: 'dpad' }
];
const STAGE = 'from-primary/12 via-primary/6 to-transparent dark:from-primary/22 dark:via-primary/10 bg-gradient-to-br';

const host = () => (window.OrbHost && typeof window.OrbHost.saveBest === 'function' ? window.OrbHost : null);
const fire = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));

// A button that presses a key: once per tap, or held (with auto-repeat) while the finger stays on it.
function KeyButton({ k, label, children, hold = false, repeat = 0, className }) {
  const timers = useRef({});
  const stop = () => {
    const tm = timers.current; clearTimeout(tm.start); clearInterval(tm.every);
    if (tm.down) { tm.down = false; if (hold) fire('keyup', k); }
  };
  const start = (e) => {
    e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); stop();
    const tm = timers.current; tm.down = true; fire('keydown', k);
    if (!hold && !repeat) { tm.down = false; fire('keyup', k); return; }
    if (repeat) tm.start = setTimeout(() => { tm.every = setInterval(() => { fire('keyup', k); fire('keydown', k); }, repeat); }, 260);
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button aria-label={label} onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onContextMenu={(e) => e.preventDefault()}
      className={cn('bg-muted text-foreground active:bg-primary active:text-primary-foreground grid size-14 place-items-center rounded-2xl shadow-sm select-none', className)}>{children}</button>
  );
}

function Pad({ kind }) {
  const sz = 'size-6';
  if (kind === 'dpad') {
    return (
      <div className="orb-pad grid grid-cols-3 gap-1.5" data-testid="pad-dpad">
        <span /><KeyButton k="ArrowUp" label="Arriba"><ArrowUp className={sz} /></KeyButton><span />
        <KeyButton k="ArrowLeft" label="Izquierda"><ChevronLeft className={sz} /></KeyButton>
        <KeyButton k="ArrowDown" label="Abajo"><ArrowDown className={sz} /></KeyButton>
        <KeyButton k="ArrowRight" label="Derecha"><ChevronRight className={sz} /></KeyButton>
      </div>
    );
  }
  if (kind === 'tetris') {
    return (
      <div className="orb-pad flex flex-wrap justify-center gap-1.5" data-testid="pad-tetris">
        <KeyButton k="ArrowLeft" label="Izquierda" repeat={110}><ChevronLeft className={sz} /></KeyButton>
        <KeyButton k="ArrowRight" label="Derecha" repeat={110}><ChevronRight className={sz} /></KeyButton>
        <KeyButton k="ArrowDown" label="Bajar" repeat={70}><ArrowDown className={sz} /></KeyButton>
        <KeyButton k="ArrowUp" label="Girar"><RotateCw className={sz} /></KeyButton>
        <KeyButton k=" " label="Soltar de golpe"><ChevronsDown className={sz} /></KeyButton>
      </div>
    );
  }
  if (kind === 'sides' || kind === 'shooter') {
    return (
      <div className="orb-pad flex justify-center gap-3" data-testid={`pad-${kind}`}>
        <KeyButton k="ArrowLeft" label="Izquierda" hold className="w-20"><ChevronLeft className={sz} /></KeyButton>
        {kind === 'shooter' ? <KeyButton k=" " label="Disparar" hold className="bg-primary text-primary-foreground w-24"><Crosshair className={sz} /></KeyButton> : null}
        <KeyButton k="ArrowRight" label="Derecha" hold className="w-20"><ChevronRight className={sz} /></KeyButton>
      </div>
    );
  }
  if (kind === 'jump') {
    return (
      <div className="orb-pad flex justify-center" data-testid="pad-jump">
        <KeyButton k=" " label="Saltar" hold className="bg-primary text-primary-foreground h-16 w-48"><ArrowUp className={sz} /></KeyButton>
      </div>
    );
  }
  return null;
}

// Swipes on the board turn into arrow keys (snake, pacman, 2048).
function Swipe({ on, children }) {
  const from = useRef(null);
  if (!on) return children;
  return (
    <div className="touch-none" data-testid="swipe-area"
      onTouchStart={(e) => { const p = e.touches[0]; from.current = { x: p.clientX, y: p.clientY }; }}
      onTouchEnd={(e) => {
        const a = from.current; from.current = null; if (!a) return;
        const p = e.changedTouches[0]; const dx = p.clientX - a.x; const dy = p.clientY - a.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        const key = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
        fire('keydown', key); fire('keyup', key);
      }}>{children}</div>
  );
}

function App() {
  const t = useT();
  const [game, setGame] = useState(null);
  const [level, setLevel] = useState('normal');
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(null);
  const [mute, setMute] = useState(isMuted);
  useEffect(() => arm(), []);
  const start = (id) => { stopAll(); sfx('start'); setGame(id); setScore(0); setOver(null); setRound((r) => r + 1); };
  const back = () => { stopAll(); sfx('select'); setGame(null); setOver(null); };
  const toggleSound = () => { setMuted(!mute); setMute(!mute); if (mute) sfx('select'); };
  const ended = (s) => {
    const rec = saveBest(game, level, s);
    host()?.saveBest(game, Math.max(0, Math.round(s)));
    setOver({ score: s, record: rec });
    const own = game === 'chess' || game === 'runner';
    if (rec) sfx('record', null, { delay: own ? 0.9 : 0.5 }); else if (!own) sfx('over', null, { delay: 0.5 });
  };
  // The native back button asks the page first: inside a game it returns to the list.
  useEffect(() => {
    window.orbBack = () => { if (!game) return false; back(); return true; };
    return () => { window.orbBack = undefined; };
  });
  const g = GAMES.find((x) => x.id === game);
  const Game = g?.load;
  const record = game ? best(game, level) : 0;
  return (
    <div className="mx-auto grid max-w-xl gap-3 p-3">
      <div className="flex items-center gap-2">
        {game ? <button className="bg-muted grid size-10 place-items-center rounded-xl" onClick={back} aria-label={t('games.back')}><ArrowLeft /></button> : null}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{game ? t(`games.${game}`) : t('games.title')}</h1>
        <button className={cn('bg-muted grid size-10 place-items-center rounded-xl', mute && 'text-muted-foreground')} onClick={toggleSound} aria-label={t('games.sound')} aria-pressed={!mute}>{mute ? <VolumeX /> : <Volume2 />}</button>
      </div>
      <p className="text-muted-foreground text-sm">{game ? t(`games.${game}Help`) : t('games.desc')}</p>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('games.level')}>
        <span className="text-muted-foreground text-xs">{t('games.level')}</span>
        <div className="bg-muted inline-flex gap-0.5 rounded-full p-0.5">
          {LEVELS.map((l) => (
            <button key={l} role="radio" aria-checked={level === l} onClick={() => { setLevel(l); if (game) start(game); else sfx('select'); }}
              className={cn('rounded-full px-3 py-1.5 text-xs font-medium', level === l ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground')}>{t(`games.level_${l}`)}</button>
          ))}
        </div>
      </div>
      {!game ? (
        <div className="grid grid-cols-2 gap-3" data-testid="game-list">
          {GAMES.map((x) => {
            const Thumb = THUMBS[x.id]; const n = best(x.id, level);
            return (
              <button key={x.id} onClick={() => start(x.id)} data-testid={`game-${x.id}`} className="bg-card grid gap-2 overflow-hidden rounded-2xl border p-2 pb-3 text-left shadow-xs active:scale-[0.98]">
                <div className={cn('relative aspect-[3/2] overflow-hidden rounded-xl', STAGE)}>
                  <div className="h-full w-full"><Thumb /></div>
                  {n > 0 ? <span className="bg-card/85 text-foreground absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shadow-sm"><Trophy className="text-warning size-3" />{n}</span> : null}
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
              <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1"><Trophy className="text-warning size-3.5" /><b className="tabular-nums">{Math.max(record, score)}</b></span>
            </div>
            <button className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium" onClick={() => start(game)}><RotateCcw className="size-3.5" />{t('games.restart')}</button>
          </div>
          <div className="relative max-w-full">
            <Swipe on={g.pad === 'dpad'}>
              <Suspense fallback={<div className="text-muted-foreground p-10 text-sm">…</div>}>
                <Game key={`${game}-${level}-${round}`} level={level} paused={Boolean(over)} onScore={setScore} onOver={ended} />
              </Suspense>
            </Swipe>
            {over ? (
              <div className="bg-background/60 absolute inset-0 grid place-items-center rounded-2xl backdrop-blur-sm" data-testid="game-over">
                <div className="bg-card text-card-foreground grid min-w-52 justify-items-center gap-3 rounded-2xl border p-6 text-center shadow-xl">
                  <span className={cn('grid size-12 place-items-center rounded-full', over.record ? 'bg-warning/15 text-warning' : 'bg-primary/12 text-primary')}>{over.record ? <Sparkles className="size-6" /> : <Flag className="size-6" />}</span>
                  <div className="text-lg leading-tight font-medium">{over.record ? t('games.newRecord') : t('games.over')}</div>
                  <div className="text-3xl font-semibold tabular-nums">{over.score}</div>
                  <button className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium" onClick={() => start(game)}><RotateCcw className="size-4" />{t('games.again')}</button>
                </div>
              </div>
            ) : null}
          </div>
          <Pad kind={g.pad} />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
