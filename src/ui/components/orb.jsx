// The robot, alive: the artwork's own pixels (public/robot/*.png, made from docs/diseno/art work by scripts/robot-arte.mjs)
// with the eyes drawn back on top so they can blink, wink, look around, smile or give way to code scrolling inside the
// visor. The same character everywhere: the head alone at small sizes, or one of the four poses of the whole robot.
// Now and then it does something on its own (only the one marked `live`, and never while the window is hidden).
// 3.8.1 (H4e): it floats (and its chest light pulses) only while something happens: thinking, talking, a mood, agents
// working (`active`), the pointer over it, saying hello, and now and then at random; otherwise it stands still and only
// blinks, so nothing keeps the compositor drawing 60 frames a second for it.
// Click it: it boops; click it a lot and it laughs (with its little sounds, lib/sounds.js). Ajustes → «Animaciones:
// mínimas» keeps it still apart from blinking and its moods.
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';
import { useStore } from '@/lib/store.js';
import { play as sound } from '@/lib/sounds.js';
import geo from './robot-geo.json';

const BASE = import.meta.env.BASE_URL;
const FILES = { head: 'cabeza', stand: 'de-pie', wave: 'saluda', point: 'senala', think: 'piensa' };
const STAND = geo['de-pie'];
const ACTS = ['wink', 'look', 'code', 'tilt', 'hop', 'look', 'code', 'float', 'float'];
// Each pose belongs to a mood, and the face must match it: the hand on the chin (with the «?») only while thinking, the
// pointing one only when happy (laughing too). Waving is for hello, idle or talking; anything else (worried, asleep)
// stands and shows it on its face.
const POSE_OF = { thinking: 'think', happy: 'point' };
const OWN = new Set(Object.values(POSE_OF));
const coherent = (pose, face) => POSE_OF[face] ?? (OWN.has(pose) ? 'stand' : pose);
const LENGTH = { wink: 900, look: 1800, code: 3200, tilt: 2200, hop: 800, boop: 380, laugh: 1600 };
// 3.8.1 (H4e): the moods that keep it floating (sleeping breathes instead; idle stands still), and how long a moment of
// floating lasts (a random one, or hello): two sways of orb-float (4.2 s each, app.css).
const MOVING = new Set(['thinking', 'talking', 'happy', 'worried']);
const MOMENT = 8400;
// Whether one of its CSS animations is running now on `el` (a paused, finished or replaced one is not).
const runs = (el, name) => Boolean(el?.getAnimations?.().some((a) => a.animationName === name && a.playState === 'running'));

// Fake code for the visor: rows of coloured bars, like syntax-highlighted lines seen from afar.
const CODE_COLORS = ['#7ff3ff', '#b79cff', '#7dffb0', '#ffd479', '#8fb8ff'];
const CODE = Array.from({ length: 14 }, (_, i) => {
  let x = ((i * 37) % 3) * 6;
  const segs = [], n = 2 + ((i * 7) % 3);
  for (let k = 0; k < n; k++) { const w = 8 + ((i * 13 + k * 29) % 22); segs.push({ x, w, c: CODE_COLORS[(i + k * 2) % CODE_COLORS.length] }); x += w + 4; }
  return segs;
});

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 3.8.1 (H4d): whether a robot that moves is on screen. One IntersectionObserver for all of them: a robot out of view (a
// screen scrolled away, a hidden sidebar) or in a hidden window has its animations paused (data-away, app.css) and no
// blinking or gestures scheduled, so nothing keeps the compositor drawing frames for what nobody can see. Still robots
// (the lists) are not watched: they never move.
const watchers = new Map();
let observer = null;
const watch = (el, fn) => {
  if (typeof IntersectionObserver === 'undefined') { fn(true); return () => {}; }
  observer ??= new IntersectionObserver((entries) => { for (const e of entries) watchers.get(e.target)?.(e.isIntersecting); });
  watchers.set(el, fn); observer.observe(el);
  return () => { watchers.delete(el); observer.unobserve(el); };
};
function useOnScreen(ref, on) {
  const [inView, setInView] = useState(true);
  const [shown, setShown] = useState(() => !document.hidden);
  useEffect(() => {
    if (!on || !ref.current) return;
    const unwatch = watch(ref.current, setInView);
    const vis = () => setShown(!document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => { unwatch(); document.removeEventListener('visibilitychange', vis); setInView(true); };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return !on || (inView && shown);
}

// pose: head, stand, wave, point, think. size: the width of the head, or of the standing robot (the other poses are
// scaled so the robot itself stays the same size). gesture: play one now (wink, look, code, tilt, hop).
// active: something is going on that its mood does not show (agents working): it floats. greet: it floats a moment
// when it appears (hello).
export function Orb({ pose = 'head', size = 34, mood = 'idle', live: wantsLive = false, still = false, active = false, greet = false, gesture, title = 'Orb', className, onPoke }) {
  const calm = useStore((s) => s.app?.config?.ui?.motion === 'minima');
  const live = wantsLive && !calm;
  const [act, setAct] = useState(null);
  const [blink, setBlink] = useState(false);
  const clicks = useRef([]);
  const self = useRef(null);
  const seen = useOnScreen(self, !still);
  const timers = useRef({});
  const busy = mood !== 'idle';
  const [hover, setHover] = useState(false);
  const [moment, setMoment] = useState(false);

  // Blinking: every 3–6 s (while it is seen).
  useEffect(() => {
    if (still || !seen || reduced()) return;
    let t;
    const next = () => { t = setTimeout(() => { if (!document.hidden) { setBlink(true); setTimeout(() => setBlink(false), 140); } next(); }, 3000 + Math.random() * 3000); };
    next();
    return () => clearTimeout(t);
  }, [still, seen]);

  // Spontaneous gestures: one every 30–90 s (3.8.1, H4e: was 9–20 s), only for the live robot, only when nothing else is
  // going on: a wink, a look around, code on the visor, a peek, a hop or a moment of floating.
  useEffect(() => {
    if (!live || still || busy || !seen || reduced()) return;
    let t;
    const next = () => { t = setTimeout(() => { if (!document.hidden) play(ACTS[Math.floor(Math.random() * ACTS.length)]); next(); }, 30000 + Math.random() * 60000); };
    next();
    return () => clearTimeout(t);
  }, [live, still, busy, seen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hello: a moment of floating when it appears.
  useEffect(() => { if (greet && !still) float(); }, [greet]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3.8.1 (H4e): floating and the chest light's pulse, only while something happens. Both start where they rest (the
  // first frame of orb-float and orb-led is the still pose), so starting never jumps; when it is over, each finishes the
  // sway or pulse it is in and stops at its end (animationiteration), which is the still pose again. Out of view, in a
  // hidden window, with reduced motion or when nothing runs (another move replaced it, «mínimas»), it stops at once:
  // there is nothing to ease out of.
  const want = !still && seen && !reduced() && ((busy && MOVING.has(mood)) || active || hover || moment);
  const [loops, setLoops] = useState({ float: false, glow: false });
  const ending = useRef({});
  useEffect(() => {
    if (want) { ending.current = {}; setLoops((l) => (l.float && l.glow ? l : { float: true, glow: true })); return; }
    const body = self.current?.querySelector('.orb-body'), led = self.current?.querySelector('.orb-led');
    const keep = { float: loops.float && seen && runs(body, 'orb-float'), glow: loops.glow && seen && runs(led, 'orb-led') };
    ending.current = keep;
    if (keep.float !== loops.float || keep.glow !== loops.glow) setLoops(keep);
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  function loopEnded(e) {
    const k = e.animationName === 'orb-float' ? 'float' : e.animationName === 'orb-led' ? 'glow' : null;
    if (!k || !ending.current[k]) return;
    ending.current = { ...ending.current, [k]: false };
    setLoops((l) => ({ ...l, [k]: false }));
  }

  useEffect(() => { if (gesture && !still) play(gesture); }, [gesture]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  function float() {
    setMoment(true);
    clearTimeout(timers.current.moment);
    timers.current.moment = setTimeout(() => setMoment(false), MOMENT);
  }

  function play(name) {
    if (name === 'float') { float(); return; }
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
  // The visor's code rows (about a hundred elements) are only built once this robot first shows them: a list of chats
  // draws hundreds of still robots that never do.
  const [coded, setCoded] = useState(false);
  if (!coded && (face === 'thinking' || act === 'code')) setCoded(true);
  const file = pose === 'head' ? FILES.head : FILES[coherent(pose, face)] ?? FILES.stand;
  const G = geo[file];
  const head = file === 'cabeza';
  // The whole robot sits on a box the size of the standing pose; other poses keep the helmet the same size, feet down.
  const box = head ? { w: size, h: size * G.ratio } : { w: size, h: size * STAND.ratio };
  const w = head ? size : (size * STAND.visor.w) / G.visor.w;
  const VW = 1000, VH = Math.round(1000 * G.ratio);
  const k = G.visor.w / geo.cabeza.visor.w; // eye movements are measured on the head
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, ''); // each robot's glow filters are its own (sizes differ)
  const url = (n) => `${BASE}robot/${n}.png`;
  return (
    <span ref={self} className={cn('orb', still && 'still', calm && 'calm', className)} data-away={seen ? undefined : ''} data-mood={face} data-act={act ?? undefined} data-blink={blink || undefined}
      data-float={loops.float || undefined} data-glow={loops.glow || undefined} onAnimationIteration={loopEnded}
      onPointerEnter={still ? undefined : () => setHover(true)} onPointerLeave={still ? undefined : () => setHover(false)}
      style={{ width: box.w, height: box.h, '--k': k }} role="img" aria-label={title} onClick={still ? undefined : poke}>
      <span className="orb-body" style={{ width: w, height: w * G.ratio, left: (box.w - w) / 2, '--u': `${w / VW}px` }}>
        <img className="orb-img" src={url(file)} alt="" draggable={false} />
        <span className="orb-visor" style={{ maskImage: `url(${url(`${file}-visera`)})`, WebkitMaskImage: `url(${url(`${file}-visera`)})` }}>
          {coded ? (
            <span className="orb-code" style={{ left: `${G.visor.x + G.visor.w * 0.18}%`, width: `${G.visor.w * 0.7}%` }}>
              {[...CODE, ...CODE].map((row, i) => (
                <span key={i} className="orb-code-row">{row.map((s, j) => <i key={j} style={{ left: `${s.x}%`, width: `${s.w}%`, background: s.c }} />)}</span>
              ))}
            </span>
          ) : null}
          <span className="orb-glint" />
        </span>
        {/* 3.8.3: each eye is its own little picture inside an HTML box (placed and tilted like the artwork's eye): blinking
            and talking scale that box, which the compositor does alone. They used to scale an SVG group, which the main
            thread redrew, glow filter included, on every frame of every blink and all through an answer. The glow is the
            same SVG filter, applied to the unscaled box around the eye (in CSS px), so a shut eye glows as it did. */}
        <span className="orb-gaze">
          <span className="orb-eyes">
            {G.eyes.map((e, i) => {
              const ew = (e.w / 100) * VW, eh = (e.h / 100) * VH;
              const glow = 16 * k;
              // Room for the brows (the widest part) and three times the glow's spread around them.
              const R = Math.ceil(Math.max(ew * 1.3, eh * 0.86) + glow * 3);
              const id = `orb-glow-${uid}-${i}`;
              return (
                <span key={i} className="orb-eye-at" style={{ left: `${e.x}%`, top: `${e.y}%`, width: `calc(${2 * R} * var(--u))`, height: `calc(${2 * R} * var(--u))`, transform: `translate(-50%, -50%) rotate(${e.tilt}deg)`, filter: `url(#${id})` }}>
                  <span className={cn('orb-eye', i === 1 && 'orb-eye-r')}>
                    <svg className="orb-face" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} aria-hidden="true">
                      <defs>
                        <filter id={id}><feGaussianBlur stdDeviation={glow * (w / VW)} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                      </defs>
                      <g>
                        <rect className="orb-pill" x={-ew / 2} y={-eh / 2} width={ew} height={eh} rx={ew / 2} />
                        <path className="orb-arc" d={`M${-eh * 0.42} ${eh * 0.12} Q0 ${-eh * 0.5} ${eh * 0.42} ${eh * 0.12}`} strokeWidth={ew * 0.85} />
                        <path className="orb-shut" d={`M${-eh * 0.38} 0 Q0 ${eh * 0.22} ${eh * 0.38} 0`} strokeWidth={ew * 0.7} />
                        {/* worried: sad brows, inner end up */}
                        <path className="orb-brow" d={i === 0 ? `M${-ew * 1.3} ${-eh * 0.5} Q${-ew * 0.2} ${-eh * 0.62} ${ew * 0.9} ${-eh * 0.86}` : `M${-ew * 0.9} ${-eh * 0.86} Q${ew * 0.2} ${-eh * 0.62} ${ew * 1.3} ${-eh * 0.5}`} strokeWidth={ew * 0.62} />
                      </g>
                    </svg>
                  </span>
                </span>
              );
            })}
          </span>
        </span>
        {G.button ? <span className="orb-led" style={{ left: `${G.button.x}%`, top: `${G.button.y}%`, width: `${G.button.r * 2.6}%` }} /> : null}
      </span>
    </span>
  );
}
