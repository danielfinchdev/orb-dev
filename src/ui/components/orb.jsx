// The robot, alive: the artwork's own pixels (public/robot/*.png, made from docs/diseno/art work by scripts/robot-arte.mjs)
// with the eyes drawn back on top so they can blink, wink, look around, smile or give way to code scrolling inside the
// visor. The same character everywhere: the head alone at small sizes, or one of the four poses of the whole robot.
// Now and then it does something on its own (only the one marked `live`, and never while the window is hidden).
// Click it: it boops; click it a lot and it laughs (with its little sounds, lib/sounds.js). Ajustes → «Animaciones:
// mínimas» keeps it still apart from blinking and its moods.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';
import { useStore } from '@/lib/store.js';
import { play as sound } from '@/lib/sounds.js';
import geo from './robot-geo.json';

const BASE = import.meta.env.BASE_URL;
const FILES = { head: 'cabeza', stand: 'de-pie', wave: 'saluda', point: 'senala', think: 'piensa' };
const STAND = geo['de-pie'];
const ACTS = ['wink', 'look', 'code', 'tilt', 'hop', 'look', 'code'];
// Each pose belongs to a mood, and the face must match it: the hand on the chin (with the «?») only while thinking, the
// pointing one only when happy (laughing too). Waving is for hello, idle or talking; anything else (worried, asleep)
// stands and shows it on its face.
const POSE_OF = { thinking: 'think', happy: 'point' };
const OWN = new Set(Object.values(POSE_OF));
const coherent = (pose, face) => POSE_OF[face] ?? (OWN.has(pose) ? 'stand' : pose);
const LENGTH = { wink: 900, look: 1800, code: 3200, tilt: 2200, hop: 800, boop: 380, laugh: 1600 };

// Fake code for the visor: rows of coloured bars, like syntax-highlighted lines seen from afar.
const CODE_COLORS = ['#7ff3ff', '#b79cff', '#7dffb0', '#ffd479', '#8fb8ff'];
const CODE = Array.from({ length: 14 }, (_, i) => {
  let x = ((i * 37) % 3) * 6;
  const segs = [], n = 2 + ((i * 7) % 3);
  for (let k = 0; k < n; k++) { const w = 8 + ((i * 13 + k * 29) % 22); segs.push({ x, w, c: CODE_COLORS[(i + k * 2) % CODE_COLORS.length] }); x += w + 4; }
  return segs;
});

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// pose: head, stand, wave, point, think. size: the width of the head, or of the standing robot (the other poses are
// scaled so the robot itself stays the same size). gesture: play one now (wink, look, code, tilt, hop).
export function Orb({ pose = 'head', size = 34, mood = 'idle', live: wantsLive = false, still = false, gesture, title = 'Orb', className, onPoke }) {
  const calm = useStore((s) => s.app?.config?.ui?.motion === 'minima');
  const live = wantsLive && !calm;
  const [act, setAct] = useState(null);
  const [blink, setBlink] = useState(false);
  const clicks = useRef([]);
  const timers = useRef({});
  const busy = mood !== 'idle';

  // Blinking: every 3–6 s.
  useEffect(() => {
    if (still || reduced()) return;
    let t;
    const next = () => { t = setTimeout(() => { if (!document.hidden) { setBlink(true); setTimeout(() => setBlink(false), 140); } next(); }, 3000 + Math.random() * 3000); };
    next();
    return () => clearTimeout(t);
  }, [still]);

  // Spontaneous gestures: one every 9–20 s, only for the live robot, only when nothing else is going on.
  useEffect(() => {
    if (!live || still || busy || reduced()) return;
    let t;
    const next = () => { t = setTimeout(() => { if (!document.hidden) play(ACTS[Math.floor(Math.random() * ACTS.length)]); next(); }, 9000 + Math.random() * 11000); };
    next();
    return () => clearTimeout(t);
  }, [live, still, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (gesture && !still) play(gesture); }, [gesture]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  function play(name) {
    setAct(name);
    clearTimeout(timers.current.act);
    timers.current.act = setTimeout(() => setAct(null), LENGTH[name] ?? 1000);
  }

  function poke() {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((c) => now - c < 1600), now];
    const laugh = clicks.current.length >= 5;
    if (laugh) clicks.current = [];
    if (!still) play(laugh ? 'laugh' : 'boop');
    sound(laugh ? 'laugh' : 'boop');
    onPoke?.(laugh ? 'laugh' : 'boop');
  }

  const face = act === 'laugh' ? 'happy' : mood;
  const file = pose === 'head' ? FILES.head : FILES[coherent(pose, face)] ?? FILES.stand;
  const G = geo[file];
  const head = file === 'cabeza';
  // The whole robot sits on a box the size of the standing pose; other poses keep the helmet the same size, feet down.
  const box = head ? { w: size, h: size * G.ratio } : { w: size, h: size * STAND.ratio };
  const w = head ? size : (size * STAND.visor.w) / G.visor.w;
  const VW = 1000, VH = Math.round(1000 * G.ratio);
  const k = G.visor.w / geo.cabeza.visor.w; // eye movements are measured on the head
  const url = (n) => `${BASE}robot/${n}.png`;
  return (
    <span className={cn('orb', still && 'still', calm && 'calm', className)} data-mood={face} data-act={act ?? undefined} data-blink={blink || undefined}
      style={{ width: box.w, height: box.h, '--k': k }} role="img" aria-label={title} onClick={poke}>
      <span className="orb-body" style={{ width: w, height: w * G.ratio, left: (box.w - w) / 2 }}>
        <img className="orb-img" src={url(file)} alt="" draggable={false} />
        <span className="orb-visor" style={{ maskImage: `url(${url(`${file}-visera`)})`, WebkitMaskImage: `url(${url(`${file}-visera`)})` }}>
          <span className="orb-code" style={{ left: `${G.visor.x + G.visor.w * 0.18}%`, width: `${G.visor.w * 0.7}%` }}>
            {[...CODE, ...CODE].map((row, i) => (
              <span key={i} className="orb-code-row">{row.map((s, j) => <i key={j} style={{ left: `${s.x}%`, width: `${s.w}%`, background: s.c }} />)}</span>
            ))}
          </span>
          <span className="orb-glint" />
        </span>
        <svg className="orb-face" viewBox={`0 0 ${VW} ${VH}`} aria-hidden="true">
          <defs>
            <filter id={`orb-glow-${file}`} x="-80%" y="-40%" width="260%" height="180%"><feGaussianBlur stdDeviation={16 * k} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <g className="orb-eyes" filter={`url(#orb-glow-${file})`}>
            {G.eyes.map((e, i) => {
              const ew = (e.w / 100) * VW, eh = (e.h / 100) * VH;
              return (
                <g key={i} transform={`translate(${(e.x / 100) * VW} ${(e.y / 100) * VH}) rotate(${e.tilt})`}>
                  <g className={cn('orb-eye', i === 1 && 'orb-eye-r')}>
                    <rect className="orb-pill" x={-ew / 2} y={-eh / 2} width={ew} height={eh} rx={ew / 2} />
                    <path className="orb-arc" d={`M${-eh * 0.42} ${eh * 0.12} Q0 ${-eh * 0.5} ${eh * 0.42} ${eh * 0.12}`} strokeWidth={ew * 0.85} />
                    <path className="orb-shut" d={`M${-eh * 0.38} 0 Q0 ${eh * 0.22} ${eh * 0.38} 0`} strokeWidth={ew * 0.7} />
                    {/* worried: sad brows, inner end up */}
                    <path className="orb-brow" d={i === 0 ? `M${-ew * 1.3} ${-eh * 0.5} Q${-ew * 0.2} ${-eh * 0.62} ${ew * 0.9} ${-eh * 0.86}` : `M${-ew * 0.9} ${-eh * 0.86} Q${ew * 0.2} ${-eh * 0.62} ${ew * 1.3} ${-eh * 0.5}`} strokeWidth={ew * 0.62} />
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
