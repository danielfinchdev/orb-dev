// 2.6: the mini-games' sound effects, all synthesized here with Web Audio (no audio files, nothing to license, zero
// bytes of assets): little 8-bit tones, noise bursts and short arpeggios, each a one-shot under a second, so nothing ever
// keeps playing on its own. The same switch and volume as the robot's voice (Ajustes › Sonidos: config.ui.sounds and
// ui.volume) plus the games' own mute (this window only), never with the window in the background and never piling up.
import { getState } from '@/lib/store.js';

const KEY = 'orb.juegos.sonido';
let ctx = null; let out = null; let noiseBuf = null;
const voices = new Set(); // what is sounding or scheduled, so it can all be cut at once
const last = new Map(); // when each effect last played, to keep fast repeats from piling up
let muted = (() => { try { return localStorage.getItem(KEY) === '0'; } catch { return false; } })();

const app = () => { const ui = getState().app?.config?.ui ?? {}; return { on: ui.sounds !== false, volume: ui.volume ?? 0.5 }; };
export const isMuted = () => muted;
export function setMuted(v) {
  muted = Boolean(v);
  try { localStorage.setItem(KEY, muted ? '0' : '1'); } catch { /* storage unavailable: only for this session */ }
  if (muted) stopAll();
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    // A soft low-pass and a little compression keep the square waves round and every effect at a similar loudness.
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 4;
    out = ctx.createGain();
    out.connect(lp); lp.connect(comp); comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  out.gain.value = 0.16 * app().volume;
  return ctx;
}

// While the games are open: the first click or key wakes the audio (Chromium keeps it asleep until a gesture).
// Returns the cleanup, which also silences whatever is still sounding.
export function arm() {
  const wake = () => { if (!muted && app().on) audio(); };
  window.addEventListener('pointerdown', wake, { capture: true, passive: true });
  window.addEventListener('keydown', wake, { capture: true, passive: true });
  return () => { window.removeEventListener('pointerdown', wake, { capture: true }); window.removeEventListener('keydown', wake, { capture: true }); stopAll(); };
}

export function stopAll() {
  for (const v of voices) { try { v.stop(); } catch { /* already stopped */ } }
  voices.clear();
}

// ---- the building blocks.
const hz = (m) => 440 * 2 ** ((m - 69) / 12); // MIDI note number to frequency
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const run = (src, at, dur, offset) => { voices.add(src); src.onended = () => voices.delete(src); src.start(at, offset); src.stop(at + dur + 0.03); };
const env = (g, at, dur, gain, attack) => {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
};
// A tone from f to f2: square, triangle, sine or sawtooth, with an optional vibrato (depth in Hz, rate in Hz).
function tone(at, f, { f2 = f, dur = 0.08, type = 'square', gain = 0.3, attack = 0.005, vib = 0, rate = 18, lin = false } = {}) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, at);
  if (f2 !== f) o.frequency[lin ? 'linearRampToValueAtTime' : 'exponentialRampToValueAtTime'](Math.max(30, f2), at + dur);
  if (vib) {
    const l = ctx.createOscillator(); const lg = ctx.createGain();
    l.frequency.value = rate; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency);
    l.start(at); l.stop(at + dur + 0.03);
  }
  env(g, at, dur, gain, attack);
  o.connect(g); g.connect(out); run(o, at, dur, 0);
}
// A burst of filtered white noise (one shared second of it, made once): thuds, swishes, explosions.
function noise(at, { dur = 0.1, gain = 0.3, type = 'lowpass', f = 1200, f2 = f, q = 0.8 } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, at); if (f2 !== f) fl.frequency.exponentialRampToValueAtTime(Math.max(40, f2), at + dur);
  const g = ctx.createGain(); env(g, at, dur, gain, 0.003);
  src.connect(fl); fl.connect(g); g.connect(out); run(src, at, dur, Math.random() * 0.4);
}
// A run of notes (MIDI numbers; null is a rest), one every `step` seconds; the last one rings for `last`.
function notes(at, list, { step = 0.07, dur = step * 0.9, last: end = dur, ...o } = {}) {
  list.forEach((m, i) => { if (m != null) tone(at + i * step, hz(m), { ...o, dur: i === list.length - 1 ? end : dur }); });
}
// Chess: a small wooden knock (lower for the computer's pieces).
const tock = (at, k = 1, gain = 0.5) => { noise(at, { dur: 0.04, gain: gain * 0.6, type: 'bandpass', f: 2200 * k, q: 2.5 }); tone(at, 420 * k, { f2: 300 * k, dur: 0.07, type: 'sine', gain }); };
// 2048: the tile's value as a note of a pentatonic scale, higher as it grows.
const PENTA = [0, 2, 4, 7, 9];
const tileNote = (v) => { const s = clamp(Math.round(Math.log2(v)) - 1, 0, 14); return 60 + 12 * Math.floor(s / 5) + PENTA[s % 5]; };

// ---- the effects. Each one gets the start time and an optional argument.
const FX = {
  // The window of the games.
  select: (t) => tone(t, 660, { f2: 990, dur: 0.06, type: 'triangle', gain: 0.4 }),
  start: (t) => notes(t, [72, 76, 79, 84], { step: 0.06, dur: 0.07, last: 0.14, type: 'square', gain: 0.16 }),
  record: (t) => { notes(t, [72, 76, 79, 84, 88], { step: 0.07, dur: 0.08, last: 0.22, type: 'square', gain: 0.15 }); notes(t + 0.28, [91, 96], { step: 0.06, dur: 0.12, type: 'triangle', gain: 0.22 }); },
  over: (t) => notes(t, [67, 64, 60, 55], { step: 0.11, dur: 0.1, last: 0.24, type: 'triangle', gain: 0.38 }),
  // Snake: a bite that climbs as it grows; a thud when it crashes.
  'snake.eat': (t, n = 0) => { const k = 2 ** (Math.min(n, 30) / 36); tone(t, 520 * k, { f2: 1040 * k, dur: 0.07, type: 'square', gain: 0.15 }); tone(t + 0.05, 1320 * k, { dur: 0.06, type: 'triangle', gain: 0.26 }); },
  'snake.crash': (t) => { noise(t, { dur: 0.3, gain: 0.45, f: 1600, f2: 150 }); tone(t, 260, { f2: 60, dur: 0.32, type: 'sawtooth', gain: 0.18 }); },
  // Tetris.
  'tetris.move': (t) => tone(t, 320, { dur: 0.025, type: 'square', gain: 0.08 }),
  'tetris.rotate': (t) => tone(t, 480, { f2: 720, dur: 0.045, type: 'triangle', gain: 0.26 }),
  'tetris.soft': (t) => tone(t, 200, { dur: 0.02, type: 'triangle', gain: 0.16 }),
  'tetris.lock': (t) => { noise(t, { dur: 0.05, gain: 0.22, f: 900 }); tone(t, 150, { f2: 100, dur: 0.06, type: 'triangle', gain: 0.3 }); },
  'tetris.drop': (t) => { noise(t, { dur: 0.14, gain: 0.36, f: 2400, f2: 250 }); tone(t, 220, { f2: 55, dur: 0.14, type: 'triangle', gain: 0.4 }); },
  'tetris.lines': (t, n = 1) => {
    const runs = [[76, 84], [76, 81, 88], [77, 81, 84, 89], [79, 83, 86, 91, 95]];
    notes(t, runs[clamp(n, 1, 4) - 1], { step: 0.055, dur: 0.06, last: 0.16, type: 'square', gain: 0.14 });
    if (n >= 4) noise(t + 0.2, { dur: 0.2, gain: 0.12, type: 'highpass', f: 5000 });
  },
  'tetris.level': (t) => notes(t, [84, 88, 91, 96], { step: 0.05, dur: 0.06, last: 0.15, type: 'triangle', gain: 0.32 }),
  'tetris.top': (t) => { notes(t, [64, 60, 57, 52], { step: 0.09, dur: 0.09, last: 0.2, type: 'square', gain: 0.13 }); noise(t, { dur: 0.4, gain: 0.16, f: 800, f2: 120 }); },
  // Chess: wooden knocks, a two-tone alert for check and a short tune at the end.
  'chess.move': (t, mine = true) => tock(t, mine ? 1 : 0.85),
  'chess.capture': (t, mine = true) => { tock(t, mine ? 1.1 : 0.9, 0.55); noise(t + 0.03, { dur: 0.12, gain: 0.26, f: 1400, f2: 300 }); tock(t + 0.06, mine ? 0.8 : 0.7, 0.35); },
  'chess.castle': (t, mine = true) => { tock(t, mine ? 1 : 0.85); tock(t + 0.1, mine ? 1.12 : 0.95); },
  'chess.promo': (t) => notes(t, [79, 84, 91], { step: 0.05, dur: 0.07, last: 0.14, type: 'triangle', gain: 0.3 }),
  'chess.check': (t) => { tone(t, 880, { dur: 0.07, type: 'square', gain: 0.12 }); tone(t + 0.08, 1175, { dur: 0.12, type: 'square', gain: 0.12 }); },
  'chess.win': (t) => { notes(t, [72, 76, 79, 84, 79, 84], { step: 0.09, dur: 0.08, last: 0.3, type: 'square', gain: 0.13 }); notes(t, [48, 55, 60], { step: 0.15, dur: 0.14, last: 0.42, type: 'triangle', gain: 0.32 }); },
  'chess.lose': (t) => notes(t, [67, 66, 65, 64], { step: 0.15, dur: 0.13, last: 0.32, type: 'triangle', gain: 0.36, vib: 5, rate: 7 }),
  'chess.draw': (t) => notes(t, [72, 67, 72], { step: 0.12, dur: 0.1, last: 0.22, type: 'triangle', gain: 0.34 }),
  // Jumper.
  'runner.jump': (t) => tone(t, 320, { f2: 640, dur: 0.08, type: 'square', gain: 0.12 }),
  'runner.land': (t) => noise(t, { dur: 0.04, gain: 0.16, f: 700 }),
  'runner.pad': (t) => tone(t, 360, { f2: 1300, dur: 0.18, type: 'square', gain: 0.11, vib: 40, rate: 30 }),
  'runner.orb': (t) => { tone(t, 700, { f2: 1400, dur: 0.1, type: 'sine', gain: 0.36 }); tone(t + 0.06, 1760, { dur: 0.1, type: 'triangle', gain: 0.22 }); },
  'runner.flip': (t) => { tone(t, 300, { f2: 1100, dur: 0.22, type: 'sine', gain: 0.3 }); noise(t, { dur: 0.22, gain: 0.12, type: 'bandpass', f: 500, f2: 3000, q: 1.5 }); },
  'runner.dead': (t) => { noise(t, { dur: 0.45, gain: 0.5, f: 3200, f2: 90 }); tone(t, 220, { f2: 45, dur: 0.4, type: 'sawtooth', gain: 0.17 }); },
  'runner.checkpoint': (t) => notes(t, [84, 91], { step: 0.07, dur: 0.08, last: 0.2, type: 'triangle', gain: 0.28 }),
  'runner.done': (t) => { notes(t, [72, 74, 76, 79, 76, 79, 84], { step: 0.08, dur: 0.07, last: 0.3, type: 'square', gain: 0.12 }); notes(t + 0.24, [48, 55, 60], { step: 0.16, dur: 0.15, last: 0.3, type: 'triangle', gain: 0.28 }); },
  // 2048: a swish when the tiles slide, a note by the value when they join, a fanfare at 2048.
  'g2048.slide': (t) => noise(t, { dur: 0.07, gain: 0.14, type: 'bandpass', f: 1800, f2: 700, q: 1.2 }),
  'g2048.merge': (t, v = 4) => { const m = tileNote(v); tone(t + 0.03, hz(m), { dur: 0.1, type: 'triangle', gain: 0.36 }); tone(t + 0.03, hz(m + 12), { dur: 0.07, type: 'square', gain: 0.06 }); },
  'g2048.win': (t) => { notes(t, [72, 76, 79, 84, 88], { step: 0.07, dur: 0.07, last: 0.25, type: 'square', gain: 0.13 }); tone(t + 0.3, hz(96), { dur: 0.25, type: 'triangle', gain: 0.2, vib: 8, rate: 8 }); },
  // Bricks: the higher the row, the higher the note.
  'breakout.paddle': (t) => tone(t, 330, { f2: 300, dur: 0.06, type: 'square', gain: 0.14 }),
  'breakout.brick': (t, row = 0) => { const m = 86 - row * 3; tone(t, hz(m), { dur: 0.07, type: 'square', gain: 0.1 }); tone(t, hz(m + 12), { dur: 0.05, type: 'triangle', gain: 0.16 }); },
  'breakout.wall': (t) => tone(t, 240, { dur: 0.035, type: 'triangle', gain: 0.22 }),
  'breakout.lose': (t) => tone(t, 520, { f2: 110, dur: 0.45, type: 'triangle', gain: 0.36, vib: 12, rate: 9 }),
  'breakout.wave': (t) => notes(t, [76, 79, 84, 88, 91], { step: 0.06, dur: 0.07, last: 0.22, type: 'square', gain: 0.13 }),
  // Space Invaders: the march is four low notes going down, one per step of the formation (the game sets the pace).
  'inv.shoot': (t) => { tone(t, 1100, { f2: 240, dur: 0.12, type: 'square', gain: 0.08 }); noise(t, { dur: 0.05, gain: 0.06, type: 'highpass', f: 3000 }); },
  'inv.kill': (t) => { noise(t, { dur: 0.16, gain: 0.34, type: 'bandpass', f: 2200, f2: 400, q: 1 }); tone(t, 700, { f2: 120, dur: 0.12, type: 'square', gain: 0.08 }); },
  'inv.march': (t, { i = 0, ms = 400 } = {}) => {
    const m = [43, 41, 40, 38][i % 4]; const d = clamp((ms / 1000) * 0.55, 0.05, 0.13);
    tone(t, hz(m), { f2: hz(m) * 0.94, dur: d, type: 'square', gain: 0.13 }); tone(t, hz(m - 12), { dur: d, type: 'triangle', gain: 0.32 });
  },
  'inv.ufo': (t, k = 0) => tone(t, k % 2 ? 1250 : 1050, { f2: k % 2 ? 1050 : 1250, dur: 0.11, type: 'sine', gain: 0.1, vib: 30, rate: 24 }),
  'inv.ufoHit': (t) => { notes(t, [96, 91, 88, 84, 79], { step: 0.045, dur: 0.06, last: 0.14, type: 'square', gain: 0.09 }); noise(t, { dur: 0.25, gain: 0.26, f: 2500, f2: 300 }); },
  'inv.hit': (t) => { noise(t, { dur: 0.55, gain: 0.45, f: 2000, f2: 80 }); tone(t, 180, { f2: 50, dur: 0.5, type: 'sawtooth', gain: 0.17, vib: 25, rate: 14 }); },
  'inv.wave': (t) => notes(t, [72, 79, 84, 88, 91], { step: 0.07, dur: 0.07, last: 0.2, type: 'square', gain: 0.13 }),
  // Pac-Man: a chomp that alternates up and down, and an original little tune to start (not the arcade's).
  'pac.waka': (t, alt = false) => tone(t, alt ? 260 : 520, { f2: alt ? 520 : 260, dur: 0.085, type: 'triangle', gain: 0.28, lin: true }),
  'pac.power': (t) => { tone(t, 180, { f2: 900, dur: 0.22, type: 'square', gain: 0.1, vib: 25, rate: 20 }); tone(t + 0.2, 900, { f2: 450, dur: 0.15, type: 'triangle', gain: 0.26 }); },
  'pac.ghost': (t, combo = 0) => { const k = 2 ** (combo / 6); tone(t, 200 * k, { f2: 1600 * k, dur: 0.28, type: 'triangle', gain: 0.34 }); tone(t + 0.02, 400 * k, { f2: 2400 * k, dur: 0.24, type: 'square', gain: 0.05 }); },
  'pac.fruit': (t) => notes(t, [79, 86, 91], { step: 0.06, dur: 0.07, last: 0.16, type: 'square', gain: 0.12 }),
  'pac.death': (t) => {
    for (let i = 0; i < 6; i++) tone(t + i * 0.09, 700 - i * 80, { f2: 420 - i * 55, dur: 0.085, type: 'square', gain: 0.1 });
    tone(t + 0.58, 330, { f2: 90, dur: 0.16, type: 'triangle', gain: 0.34 }); tone(t + 0.7, 300, { f2: 80, dur: 0.14, type: 'triangle', gain: 0.34 });
  },
  'pac.start': (t) => { notes(t, [76, 79, 84, 79, 81, 77, 74, 79, 84], { step: 0.1, dur: 0.08, last: 0.22, type: 'square', gain: 0.12 }); [48, 53, 55, 60].forEach((m, i) => tone(t + i * 0.2 + (i === 3 ? 0.2 : 0), hz(m), { dur: 0.18, type: 'triangle', gain: 0.3 })); },
  'pac.clear': (t) => notes(t, [84, 88, 91, 96], { step: 0.07, dur: 0.07, last: 0.22, type: 'triangle', gain: 0.3 })
};
// Effects that can come very fast: at most one every so many seconds.
const GAP = { 'tetris.move': 0.03, 'tetris.soft': 0.03, 'pac.waka': 0.06, 'breakout.wall': 0.04, 'breakout.brick': 0.03, 'runner.land': 0.05, 'runner.jump': 0.05, 'inv.ufo': 0.08, 'g2048.slide': 0.05, 'inv.shoot': 0.05 };

// sfx('snake.eat', length) or sfx('over', null, { delay: 0.5 }).
export function sfx(name, arg, { delay = 0 } = {}) {
  const s = app();
  if (muted || !s.on || s.volume <= 0 || document.hidden || !document.hasFocus()) return;
  const fx = FX[name]; if (!fx || voices.size > 48) return;
  const a = audio(); if (!a || a.state === 'closed') return;
  const now = a.currentTime;
  if (now - (last.get(name) ?? -1) < (GAP[name] ?? 0.015)) return;
  last.set(name, now);
  try { fx(now + 0.01 + delay, arg); } catch { /* audio unavailable: play on in silence */ }
}
