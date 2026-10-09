// The robot's head, alive: the artwork's own pixels (public/robot/cabeza.png, made by scripts/robot-arte.mjs) with the
// eyes drawn back on top so they can blink, wink, look around, smile or give way to code scrolling inside the visor.
// Now and then it does something on its own (only the one marked `live`, and never while the window is hidden).
// Click it: it boops; click it a lot and it laughs.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';
import geo from './robot-geo.json';

const G = geo.head;
const VW = 1000, VH = Math.round(1000 * G.ratio);
const BASE = import.meta.env.BASE_URL;
const ACTS = ['wink', 'look', 'code', 'turn', 'hop', 'look', 'code'];

// Fake code for the visor: rows of coloured bars, like syntax-highlighted lines seen from afar.
const CODE_COLORS = ['#7ff3ff', '#b79cff', '#7dffb0', '#ffd479', '#8fb8ff'];
const CODE = Array.from({ length: 14 }, (_, i) => {
  let x = (i * 37) % 3 * 6, segs = [];
  const n = 2 + ((i * 7) % 3);
  for (let k = 0; k < n; k++) { const w = 8 + ((i * 13 + k * 29) % 22); segs.push({ x, w, c: CODE_COLORS[(i + k * 2) % CODE_COLORS.length] }); x += w + 4; }
  return segs;
});

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// gesture: play one gesture now (wink, look, code, turn, hop), e.g. when a task finishes.
export function OrbHead({ size = 34, mood = 'idle', live = false, still = false, gesture, title = 'Orb', className, onPoke }) {
  const [act, setAct] = useState(null);
  const [blink, setBlink] = useState(false);
  const clicks = useRef([]);
  const timers = useRef({});
  const busy = mood !== 'idle';

  // Blinking: every 3–6 s while idle.
  useEffect(() => {
    if (still || reduced()) return;
    let t;
    const next = () => { t = setTimeout(() => { if (!document.hidden) { setBlink(true); setTimeout(() => setBlink(false), 140); } next(); }, 3000 + Math.random() * 3000); };
    next();
    return () => clearTimeout(t);
  }, [still]);

  // Spontaneous gestures: one every 9–20 s, only for the live head, only when nothing else is going on.
  useEffect(() => {
    if (!live || still || busy || reduced()) return;
    let t;
    const next = () => { t = setTimeout(() => { if (!document.hidden) play(ACTS[Math.floor(Math.random() * ACTS.length)]); next(); }, 9000 + Math.random() * 11000); };
    next();
    return () => clearTimeout(t);
  }, [live, still, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (gesture && !still) play(gesture); }, [gesture]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  function play(name, ms = { wink: 900, look: 1800, code: 3200, turn: 1300, hop: 800, boop: 380, laugh: 1600 }[name]) {
    setAct(name);
    clearTimeout(timers.current.act);
    timers.current.act = setTimeout(() => setAct(null), ms);
  }

  function poke() {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((c) => now - c < 1600), now];
    const laugh = clicks.current.length >= 5;
    if (laugh) clicks.current = [];
    if (!still) play(laugh ? 'laugh' : 'boop');
    onPoke?.(laugh ? 'laugh' : 'boop');
  }

  const face = act === 'laugh' ? 'happy' : mood;
  return (
    <span className={cn('orb', still && 'still', className)} data-mood={face} data-act={act ?? undefined} data-blink={blink || undefined}
      style={{ width: size, height: size * G.ratio }} title={title} role="img" aria-label={title} onClick={poke}>
      <span className="orb-body">
        <img className="orb-img" src={`${BASE}robot/cabeza.png`} alt="" draggable={false} />
        <span className="orb-visor" style={{ maskImage: `url(${BASE}robot/cabeza-visera.png)`, WebkitMaskImage: `url(${BASE}robot/cabeza-visera.png)` }}>
          <span className="orb-code" style={{ left: `${G.visor.x + G.visor.w * 0.18}%`, width: `${G.visor.w * 0.7}%` }}>
            {[...CODE, ...CODE].map((row, i) => (
              <span key={i} className="orb-code-row">{row.map((s, k) => <i key={k} style={{ left: `${s.x}%`, width: `${s.w}%`, background: s.c }} />)}</span>
            ))}
          </span>
          <span className="orb-glint" />
        </span>
        <svg className="orb-face" viewBox={`0 0 ${VW} ${VH}`} aria-hidden="true">
          <defs>
            <filter id="orb-glow" x="-80%" y="-40%" width="260%" height="180%"><feGaussianBlur stdDeviation="16" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <g className="orb-eyes" filter="url(#orb-glow)">
            {G.eyes.map((e, i) => {
              const w = (e.w / 100) * VW, h = (e.h / 100) * VH;
              return (
                <g key={i} transform={`translate(${(e.x / 100) * VW} ${(e.y / 100) * VH}) rotate(${e.tilt})`}>
                  <g className={cn('orb-eye', i === 1 && 'orb-eye-r')}>
                    <rect className="orb-pill" x={-w / 2} y={-h / 2} width={w} height={h} rx={w / 2} />
                    <path className="orb-arc" d={`M${-h * 0.42} ${h * 0.12} Q0 ${-h * 0.5} ${h * 0.42} ${h * 0.12}`} strokeWidth={w * 0.85} />
                    <path className="orb-shut" d={`M${-h * 0.38} 0 Q0 ${h * 0.22} ${h * 0.38} 0`} strokeWidth={w * 0.7} />
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
        {G.button ? <span className="orb-led" style={{ left: `${G.button.x}%`, top: `${G.button.y}%`, width: `${G.button.r * 2.6}%` }} /> : null}
      </span>
    </span>
  );
}
