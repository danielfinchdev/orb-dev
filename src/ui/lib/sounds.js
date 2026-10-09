// The robot's voice: little synthesized blips (no audio files), Animal Crossing style. Orb babbles the first words of
// what it says, boops when you touch it, laughs when you click it a lot, chimes when something is done and goes "uh-oh"
// when it needs you. Quiet by default; Ajustes turns it off or sets the volume (config.ui.sounds / ui.volume).
// Never while you are typing, never with the window in the background, and never piling up.
import { getState } from './store.js';

let ctx = null, out = null, lastKey = 0, busyUntil = 0;
window.addEventListener('keydown', () => { lastKey = Date.now(); }, { capture: true, passive: true });

const settings = () => { const ui = getState().app?.config?.ui ?? {}; return { on: ui.sounds !== false, volume: ui.volume ?? 0.5 }; };

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // A soft low-pass and a touch of compression keep every blip round and at the same loudness.
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    out = ctx.createGain();
    out.connect(lp); lp.connect(comp); comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  out.gain.value = 0.22 * settings().volume;
  return ctx;
}

// One blip: a short tone that glides from f to f2, with a quick attack and decay. type: sine, triangle, square.
function blip(at, f, { f2 = f, dur = 0.07, type = 'triangle', gain = 1, vibrato = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, f2), at + dur);
  if (vibrato) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 28; lg.gain.value = vibrato;
    lfo.connect(lg); lg.connect(o.frequency); lfo.start(at); lfo.stop(at + dur + 0.02);
  }
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(out);
  o.start(at); o.stop(at + dur + 0.02);
  return at + dur;
}

// The babble: one blip per syllable of the text, pitched by its vowel, like a tiny robot reading it out.
const VOWEL = { a: 1, e: 1.19, i: 1.42, o: 0.89, u: 0.79, á: 1, é: 1.19, í: 1.42, ó: 0.89, ú: 0.79 };
function babble(text, t0) {
  const syl = String(text).toLowerCase().normalize('NFC').match(/[^aeiouáéíóú\s\W]*[aeiouáéíóú]+/g)?.slice(0, 14) ?? [];
  const base = 440 + Math.random() * 40;
  let t = t0;
  syl.forEach((s, i) => {
    const f = base * (VOWEL[s.at(-1)] ?? 1) * (1 + ((s.charCodeAt(0) % 7) - 3) * 0.025);
    blip(t, f * 1.06, { f2: f * 0.94, dur: 0.055, type: i % 3 ? 'triangle' : 'square', gain: i % 3 ? 0.9 : 0.35 });
    t += 0.075 + (s.length > 3 ? 0.02 : 0);
  });
  return t;
}

const SOUNDS = {
  boop: (t) => blip(t, 520, { f2: 880, dur: 0.11, type: 'sine', gain: 1 }),
  laugh: (t) => { for (let i = 0; i < 6; i++) t = blip(t + 0.025, 820 - i * 55, { f2: 640 - i * 50, dur: 0.075, type: 'triangle', vibrato: 30 }); return t; },
  done: (t) => { [523, 659, 784, 1047].forEach((f, i) => blip(t + i * 0.085, f, { dur: i === 3 ? 0.22 : 0.1, type: 'sine', gain: 0.8 })); return t + 0.48; },
  uhoh: (t) => { blip(t, 660, { f2: 640, dur: 0.14, type: 'triangle' }); return blip(t + 0.17, 500, { f2: 420, dur: 0.22, type: 'triangle' }); },
  yawn: (t) => blip(t, 560, { f2: 230, dur: 0.75, type: 'sine', gain: 0.6, vibrato: 6 }),
  wake: (t) => { blip(t, 380, { f2: 620, dur: 0.09, type: 'sine' }); return blip(t + 0.1, 620, { f2: 900, dur: 0.09, type: 'sine' }); },
};

// play('boop') or play('talk', 'Hola, Ana…'). force: also when the window is in the background (important alerts).
export function play(name, text, { force = false } = {}) {
  const s = settings();
  if (!name || !s.on || s.volume <= 0) return;
  if (document.documentElement.dataset.skin === 'profesional') return; // that visual theme has no robot, nor its voice
  if (!force && (document.hidden || !document.hasFocus())) return;
  if (name === 'talk' && Date.now() - lastKey < 1500) return; // you are typing: let you think
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  if (now < busyUntil && name !== 'boop') return; // never pile up
  const end = name === 'talk' ? babble(text, now + 0.02) : SOUNDS[name]?.(now + 0.02);
  busyUntil = end ?? now;
}
