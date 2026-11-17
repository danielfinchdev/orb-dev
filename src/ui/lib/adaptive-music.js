// The adaptive music: endless background music made on the spot with Web Audio, which follows what happens in Orb.
// No audio files, no libraries and no network, so there is nothing to download and no third-party licence.
// lib/music.js loads this module the first time adaptive music plays and drives it; lib/music-signals.js tells it
// what the user and the agents are doing.
//
//   const m = createAdaptiveMusic({ theme: 'bruma', seed: 'orb', volume: 0.6, context });
//   m.start();                 // only from a user gesture (autoplay policy)
//   m.signal('typing');        // one of SIGNALS
//   m.setTheme('neon');        // crossfades
//   m.setIntensity(0.8);       // manual override; null gives control back to the signals
//   m.pause(); m.resume(); m.stop(); m.setVolume(0.4); m.getState(); m.subscribe(fn); m.destroy();
//
// The same seed and the same signals give the same music. A context passed in is the caller's to close.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const mod12 = (n) => ((n % 12) + 12) % 12;
// Lowest pitch at or above `lo` with pitch class `pc`.
const fit = (pc, lo) => lo + mod12(pc - lo);
const pitches = (pcs, lo, hi) => { const out = []; for (let m = lo; m <= hi; m++) if (pcs.includes(mod12(m))) out.push(m); return out; };

// ---- Seeded randomness: the same seed and the same signals give the same music. ----
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(r.range(lo, hi + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.weighted = (w) => {
    let sum = 0; for (const x of w) sum += x;
    let v = r() * sum;
    for (let i = 0; i < w.length; i++) { v -= w[i]; if (v < 0) return i; }
    return w.length - 1;
  };
  return r;
}

// ---- Harmony ----
// Ordered from bright to dark: neighbours differ by one note, so a mode drift is a gentle change.
const MODES = {
  lydian: [0, 2, 4, 6, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
};
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
// Weight of moving the root by n scale steps: fourths and fifths first, then steps, then thirds.
const ROOT_MOVE = [0, 2, 1.2, 3, 2.5, 2.2, 1.5];
const BIAS_MAJOR = [1.5, 1.1, 0.7, 1.3, 1.2, 1.3, 0.8];
const BIAS_MINOR = [1.5, 0.6, 1.1, 1.2, 1.0, 1.3, 1.3];
// The degree that gives each mode its colour.
const MODE_COLOUR = { lydian: 1, mixolydian: 6, dorian: 3, phrygian: 1 };

class Harmony {
  constructor(theme, rng) {
    this.th = theme; this.rng = rng;
    this.tonic = rng.pick(theme.tonics);
    this.mode = theme.modes[theme.mode0];
    this.A = null;
    this.untilDrift = rng.int(5, 9);
  }
  scalePcs() { return MODES[this.mode].map((s) => mod12(this.tonic + s)); }
  usable(deg) { const iv = MODES[this.mode]; return mod12(iv[(deg + 4) % 7] - iv[deg]) === 7; }
  chord(deg) {
    const iv = MODES[this.mode];
    const at = (k) => this.tonic + iv[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
    const root = at(0), i3 = at(2) - root, i7 = at(6) - root, i9 = at(8) - root - 12;
    const rich = this.th.color === 'rich';
    // A minor ninth over the root is a harsh rub, so the ninth is used only when it is a whole tone.
    const ninth = i9 === 2 ? mod12(at(8)) : null;
    let name = NOTE[mod12(root)] + (i3 === 3 ? 'm' : '');
    if (rich) name += i7 === 11 ? 'maj7' : '7';
    else name += ninth !== null ? (i3 === 3 ? '(add9)' : 'add9') : (i7 === 11 ? 'maj7' : '7');
    return { deg, root: mod12(root), third: mod12(at(2)), fifth: mod12(at(4)), seventh: mod12(at(6)), ninth, name };
  }
  // Flat second as a major seventh chord: every voice is a semitone from the tonic chord, so it pulls back home.
  tensionChord() {
    const r = mod12(this.tonic + 1);
    return { deg: -1, root: r, third: mod12(r + 4), fifth: mod12(r + 7), seventh: mod12(r + 11), ninth: null, name: NOTE[r] + 'maj7' };
  }
  // Tonic, second (fourth in phrygian) and fifth: the tones shared by a suspended dominant and its tonic.
  susPcs() {
    const iv = MODES[this.mode];
    return [this.tonic, mod12(this.tonic + (iv[1] === 1 ? iv[3] : iv[1])), mod12(this.tonic + 7)];
  }
  keyName() { return NOTE[this.tonic] + ' ' + this.mode; }
  pickNext(prev, last, avoid) {
    const iv = MODES[this.mode], bias = iv[2] === 3 ? BIAS_MINOR : BIAS_MAJOR, w = [];
    for (let d = 0; d < 7; d++) {
      if (!this.usable(d) || d === prev || d === avoid) { w.push(0); continue; }
      let x = ROOT_MOVE[(d - prev + 7) % 7] * bias[d];
      if (MODE_COLOUR[this.mode] === d) x *= 1.5;
      // A phrase ends on a chord that wants to go home, never on the tonic itself.
      if (last) x *= d === 0 ? 0 : d === 4 ? 2 : (d === 6 && iv[6] === 10) ? 2.2 : d === 3 ? 1.5 : 1;
      w.push(x);
    }
    return this.rng.weighted(w);
  }
  generate() {
    const start = [0, 0, 0, 5, 3].filter((d) => this.usable(d));
    const p = [this.rng.pick(start)];
    for (let i = 1; i < 4; i++) p.push(this.pickNext(p[i - 1], i === 3));
    return p;
  }
  drift() {
    const r = this.rng, modes = this.th.modes, i = modes.indexOf(this.mode);
    if (modes.length > 1 && r.chance(0.5)) {
      const j = clamp(i + (r.chance(0.5) ? 1 : -1), 0, modes.length - 1);
      if (j !== i) { this.mode = modes[j]; return; }
    }
    this.tonic = mod12(this.tonic + r.pick([7, 5]));
  }
  // Four chords. A remembered phrase comes back, sometimes altered, so the music has a shape without looping.
  phrase() {
    const r = this.rng;
    if (--this.untilDrift <= 0) { this.drift(); this.A = null; this.untilDrift = r.int(5, 9); }
    if (this.A && r.chance(0.45)) return this.A.slice();
    if (this.A && r.chance(0.45)) {
      const p = this.A.slice(), i = r.int(1, 3);
      p[i] = this.pickNext(p[i - 1], i === 3, p[i]);
      if (r.chance(0.5)) this.A = p.slice();
      return p;
    }
    const p = this.generate();
    if (!this.A || r.chance(0.5)) this.A = p.slice();
    return p;
  }
}

const nearest = (p, pc) => { const d = mod12(pc - p); return d <= 6 ? p + d : p + d - 12; };
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((x, i) => { for (const rest of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([x].concat(rest)); });
  return out;
}
// Each voice moves to the nearest tone of the new chord; the cheapest assignment that stays open and in range wins.
function leadVoices(prev, pcs, lo, hi) {
  if (!prev) {
    const out = []; let p = lo + 3;
    for (const pc of pcs) { let m = fit(pc, p); if (m > hi) m -= 12; out.push(m); p = m + 1; }
    return out.sort((a, b) => a - b);
  }
  const mid = (lo + hi) / 2;
  let best = null, bestCost = Infinity;
  for (const perm of permutations(pcs)) {
    const v = perm.map((pc, i) => { let m = nearest(prev[i], pc); while (m < lo) m += 12; while (m > hi) m -= 12; return m; });
    let cost = 0, mean = 0;
    for (let i = 0; i < v.length; i++) { cost += Math.abs(v[i] - prev[i]); mean += v[i] / v.length; }
    const s = v.slice().sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) { const d = s[i] - s[i - 1]; cost += d === 0 ? 8 : d === 1 ? 4 : d > 9 ? 2 : 0; }
    const span = s[s.length - 1] - s[0];
    cost += (span > 19 ? 4 : 0) + (span < 7 ? 3 : 0) + 0.15 * Math.abs(mean - mid);
    if (cost < bestCost) { bestCost = cost; best = s; }
  }
  return best;
}

// ---- Themes ----
// mix: [intensity where the layer starts, intensity where it is full, level at calm, level at full].
// sends: [reverb, delay]. filt: layer lowpass at calm and at full intensity.
const LAYERS = ['pad', 'bass', 'arp', 'perc', 'tex'];
const TENSION_DUCK = { pad: 1, bass: 0.85, arp: 0.5, perc: 0.12, tex: 1 };
const THEMES = {
  bruma: {
    tonics: [5, 0, 7, 10], modes: ['lydian', 'ionian', 'mixolydian', 'dorian'], mode0: 1,
    bpm: [66, 76], swing: 0.14, human: 0.008, chordBars: [2, 2, 1], color: 'rich',
    range: { pad: [52, 71], arp: [60, 81], lead: [65, 86], bass: 29 },
    tone: 7000, reverb: { secs: 1.9, damp: 0.1, level: 0.55 }, delay: { beats: 0.75, fb: 0.3, level: 0.5 },
    mix: { pad: [0, 0.3, 0.75, 1], bass: [0.1, 0.3, 0, 1], arp: [0.03, 0.4, 0.3, 1], perc: [0.38, 0.6, 0, 1], tex: [0, 1, 0.8, 1] },
    level: { pad: 1, bass: 1, arp: 1, perc: 1, tex: 1 },
    sends: { pad: [0.35, 0], bass: [0, 0], arp: [0.4, 0.3], perc: [0.12, 0], tex: [0, 0], sig: [0.5, 0.35] },
    filt: { pad: [650, 2000] },
    pad: { wave: 'soft', det: [-7, 7], a: 1.6, r: 2.6, gain: 0.05 },
    keys: { fm: { ratio: 1, index: 1.1, decay: 0.3, sus: 0.15 }, a: 0.006, d: 2.2, s: 0, r: 0.6, lp: 2600, gain: 0.11 },
    bass: { wave: 'soft', det: [0], lp: 340, lpKey: 1, lpEnv: 1.5, lpDecay: 0.15, a: 0.012, d: 0.7, s: 0.6, r: 0.18, gain: 0.34 },
    bassStyle: 'long',
    lead: { style: 'melody', count: [3, 6], maxLen: 6, dens: [0.1, 0.92],
      inst: { wave: 'triangle', det: [0], lp: 1500, lpKey: 2, lpEnv: 1.2, lpDecay: 0.08, a: 0.005, d: 0.7, s: 0, r: 0.5, gain: 0.42 } },
    flourish: { fm: { ratio: 1, index: 1.6, decay: 0.25, sus: 0.1 }, a: 0.005, d: 1.6, s: 0, r: 0.8, lp: 3600, gain: 0.2 },
    perc: 'lofi',
    kit: {
      kick: { f0: 105, f1: 46, drop: 0.09, tc: 0.1, gain: 0.36 },
      snare: { hp: 900, lp: 3800, tc: 0.055, gain: 0.3 }, body: { f0: 185, f1: 150, drop: 0.05, tc: 0.045, gain: 0.12 },
      hat: { hp: 6000, lp: 8500, tc: 0.022, gain: 0.14, pan: 0.25 },
    },
    texture: 'vinyl',
  },
  neon: {
    tonics: [9, 4, 2, 11], modes: ['dorian', 'aeolian', 'phrygian'], mode0: 1,
    bpm: [84, 96], swing: 0, human: 0.002, chordBars: [2, 1, 2], color: 'open',
    range: { pad: [50, 70], arp: [57, 84], lead: [67, 84], bass: 28 },
    tone: 10000, reverb: { secs: 2.8, damp: 0.12, level: 0.5 }, delay: { beats: 0.75, fb: 0.38, level: 0.55 },
    mix: { pad: [0, 0.3, 0.85, 1], bass: [0.1, 0.3, 0, 1], arp: [0.05, 0.42, 0.35, 1], perc: [0.42, 0.62, 0, 1], tex: [0, 1, 0.85, 1] },
    level: { pad: 1, bass: 1, arp: 1, perc: 1, tex: 1 },
    sends: { pad: [0.4, 0], bass: [0, 0], arp: [0.3, 0.4], perc: [0.2, 0], tex: [0.1, 0], sig: [0.5, 0.4] },
    filt: { pad: [420, 2400], arp: [900, 5200] },
    pad: { wave: 'sawtooth', det: [-9, 0, 9], a: 1.2, r: 2.2, gain: 0.065 },
    bass: { wave: 'sawtooth', det: [-4, 4], lp: 190, lpKey: 1.6, lpEnv: 3, lpDecay: 0.1, q: 2, a: 0.006, d: 0.3, s: 0.55, r: 0.08, gain: 0.3 },
    bassStyle: 'pulse',
    arp: { style: 'sixteenth', dens: [0.06, 1],
      inst: { wave: 'sawtooth', det: [-5, 5], lp: 5000, lpKey: 0, a: 0.004, d: 0.24, s: 0, r: 0.2, gain: 0.17 } },
    lead: { style: 'melody', count: [2, 4], maxLen: 12, dens: [-1.3, 0.55],
      inst: { wave: 'glass', det: [-4, 4], lp: 1400, lpKey: 2, a: 0.06, d: 1.2, s: 0.6, r: 0.7, gain: 0.1 } },
    flourish: { wave: 'sawtooth', det: [-6, 6], lp: 1500, lpKey: 2, lpEnv: 2, lpDecay: 0.15, a: 0.005, d: 0.9, s: 0, r: 0.6, gain: 0.16 },
    perc: 'neon',
    kit: {
      kick: { f0: 135, f1: 47, drop: 0.08, tc: 0.11, gain: 0.34 },
      snare: { hp: 700, lp: 5200, tc: 0.1, gain: 0.2 }, body: { f0: 200, f1: 160, drop: 0.05, tc: 0.06, gain: 0.1 },
      hat: { hp: 7000, lp: 10500, tc: 0.02, gain: 0.09, pan: 0.3 },
    },
    texture: 'rumble',
  },
  marfil: {
    tonics: [3, 10, 5, 0], modes: ['lydian', 'ionian', 'mixolydian', 'dorian'], mode0: 1,
    bpm: [58, 70], swing: 0, human: 0.014, chordBars: [1, 2, 2], color: 'open',
    range: { pad: [50, 69], arp: [55, 79], lead: [67, 88], bass: 31 },
    tone: 8500, reverb: { secs: 2.5, damp: 0.09, level: 0.6 }, delay: { beats: 1, fb: 0.2, level: 0.3 },
    mix: { pad: [0, 0.4, 0.7, 1], bass: [0.08, 0.32, 0, 1], arp: [0, 0.4, 0.65, 1], perc: [0.58, 0.82, 0, 0.8], tex: [0, 1, 0.8, 1] },
    level: { pad: 1, bass: 1, arp: 1, perc: 1, tex: 1 },
    sends: { pad: [0.45, 0], bass: [0.15, 0], arp: [0.4, 0.12], perc: [0.2, 0], tex: [0, 0], sig: [0.5, 0.15] },
    filt: { pad: [480, 1300] },
    pad: { wave: 'soft', det: [-5, 5], a: 2.2, r: 3.2, gain: 0.04 },
    bass: { wave: 'piano', det: [-2, 2], lp: 300, lpKey: 3, lpEnv: 2, lpDecay: 0.25, a: 0.008, d: 3.2, s: 0, r: 0.5, gain: 0.3 },
    bassStyle: 'piano',
    arp: { style: 'eighth', dens: [0.2, 0.95],
      inst: { wave: 'piano', det: [-3, 3], lp: 500, lpKey: 3, lpEnv: 2.5, lpDecay: 0.22, a: 0.006, d: 2.2, s: 0, r: 0.45, gain: 0.16 } },
    lead: { style: 'melody', count: [3, 5], maxLen: 8, dens: [0, 0.8],
      inst: { wave: 'piano', det: [-3, 3], lp: 600, lpKey: 3, lpEnv: 2.5, lpDecay: 0.2, a: 0.006, d: 2.4, s: 0, r: 0.5, gain: 0.18 } },
    flourish: { wave: 'piano', det: [-3, 3], lp: 800, lpKey: 3.5, lpEnv: 2.5, lpDecay: 0.2, a: 0.006, d: 2.6, s: 0, r: 0.8, gain: 0.24 },
    perc: 'felt',
    kit: {
      kick: { f0: 90, f1: 50, drop: 0.07, tc: 0.08, gain: 0.35 },
      hat: { hp: 3500, lp: 7000, tc: 0.035, gain: 0.07, pan: -0.2, a: 0.012 },
    },
    texture: 'room',
  },
  orbita: {
    tonics: [4, 9, 2, 6], modes: ['lydian', 'ionian', 'dorian', 'aeolian'], mode0: 0,
    bpm: [50, 58], swing: 0, human: 0.01, chordBars: [2, 2, 4], color: 'rich',
    range: { pad: [55, 76], arp: [67, 91], lead: [72, 91], bass: 28 },
    tone: 9000, reverb: { secs: 5.5, damp: 0.08, level: 0.9 }, delay: { beats: 1.5, fb: 0.45, level: 0.6 },
    mix: { pad: [0, 0.4, 0.75, 1], bass: [0, 0.35, 0.35, 1], arp: [0, 0.45, 0.45, 1], perc: [0.5, 0.78, 0, 0.9], tex: [0, 1, 0.75, 1] },
    level: { pad: 1, bass: 1, arp: 1, perc: 1, tex: 1 },
    sends: { pad: [0.6, 0], bass: [0.1, 0], arp: [0.6, 0.5], perc: [0.35, 0.3], tex: [0.2, 0], sig: [0.6, 0.5] },
    filt: { pad: [700, 2600] },
    pad: { wave: 'soft', det: [-6, 6, 0], oct: [1, 1, 2], lv: [1, 1, 0.25], a: 3.5, r: 5, gain: 0.055 },
    bass: { wave: 'soft', det: [0], lp: 260, lpKey: 0, a: 0.8, d: 1, s: 1, r: 2.5, gain: 0.13 },
    bassStyle: 'sub',
    arp: { style: 'bells', dens: [0.3, 1],
      inst: { fm: { ratio: 3.5, index: 1.4, decay: 0.5, sus: 0.05 }, a: 0.004, d: 3, s: 0, r: 2, lp: 5500, gain: 0.15 } },
    flourish: { fm: { ratio: 2, index: 1.2, decay: 0.4, sus: 0.1 }, a: 0.005, d: 2.6, s: 0, r: 1.5, lp: 5000, gain: 0.16 },
    perc: 'space',
    kit: {
      kick: { f0: 78, f1: 46, drop: 0.12, tc: 0.14, gain: 0.3 },
      tick: { f0: 1900, tc: 0.012, gain: 0.07 },
    },
    texture: 'wind',
  },
};

const ARP_SHAPES = [[0, 1, 2, 3], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3], [3, 2, 1, 0], [0, 1, 2, 1], [0, 2, 4, 2, 1, 3], [0, 1, 2, 3, 4, 3, 2, 1], [0, 0, 2, 1, 3, 2]];
const MAX_VOICES = 26;
const LOOKAHEAD = 0.25;
const TICK_MS = 50;

// ---- One theme playing: its own buses, effects, sequencer and harmony. Two exist only during a crossfade. ----
class Scene {
  constructor(eng, id, t0) {
    this.eng = eng; this.ctx = eng.ctx; this.id = id; this.th = THEMES[id];
    const base = hashSeed(eng.seed + '|' + id + '|' + (eng.sceneSerial++));
    this.rH = makeRng(base); this.rM = makeRng(base ^ 0x9e3779b9); this.rP = makeRng(base ^ 0x51ed270b); this.rS = makeRng(base ^ 0x2545f491);
    this.harm = new Harmony(this.th, this.rH);
    this.bpm = Math.round(this.rH.range(this.th.bpm[0], this.th.bpm[1]));
    this.stepDur = 15 / this.bpm;
    this.phase = [0, 1, 2, 3, 4].map(() => this.rH() * 6.283);
    this.drift = { bright: 1, reg: 0 };
    this.voices = []; this.sources = []; this.levels = {};
    this.step = 0; this.bar = -1; this.queue = []; this.chordBarsLeft = 0; this.chordBar = 0; this.mBar = 1;
    this.voicing = null; this.chord = null; this.pad = null; this.tension = null; this.resolve = null;
    this.fading = false; this.disposeAt = Infinity;
    this.mArp = {}; this.mLead = {}; this.octaves = [];
    this.build(t0);
    this.nextT = t0 + 0.08;
  }

  gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  biquad(type, freq, q) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q == null ? 0.5 : q; return f; }
  panner(p) { const n = this.ctx.createStereoPanner(); n.pan.value = p; return n; }

  build(t0) {
    const c = this.ctx, th = this.th, E = this.eng;
    this.out = this.gain(0); this.out.connect(E.masterIn);
    this.out.gain.setValueAtTime(0, t0); this.out.gain.setTargetAtTime(1, t0, 0.6);
    this.toneLP = this.biquad('lowpass', th.tone); this.toneLP.connect(this.out);
    this.sum = this.gain(1); this.sum.connect(this.toneLP);

    this.revIn = this.gain(1);
    // Lows are kept out of the reverb so the tail does not turn to mud.
    const revHP = this.biquad('highpass', 180);
    this.conv = c.createConvolver(); this.conv.buffer = E.impulse(th.reverb.secs, th.reverb.damp);
    this.revOut = this.gain(th.reverb.level);
    this.revIn.connect(revHP); revHP.connect(this.conv); this.conv.connect(this.revOut); this.revOut.connect(this.sum);

    this.dIn = this.gain(1); this.dL = c.createDelay(2.5); this.dR = c.createDelay(2.5);
    this.dL.delayTime.value = this.dR.delayTime.value = this.delayTime();
    // Each repeat loses highs and lows, like a tape echo, so the echoes sit behind the notes.
    const fLP = this.biquad('lowpass', 2600), fHP = this.biquad('highpass', 300);
    this.dFb = this.gain(th.delay.fb); this.dOut = this.gain(th.delay.level);
    const pL = this.panner(-0.6), pR = this.panner(0.6), toRev = this.gain(0.25);
    this.dIn.connect(this.dL); this.dL.connect(this.dR); this.dR.connect(fLP); fLP.connect(fHP); fHP.connect(this.dFb); this.dFb.connect(this.dL);
    this.dL.connect(pL); this.dR.connect(pR); pL.connect(this.dOut); pR.connect(this.dOut);
    this.dOut.connect(this.sum); this.dOut.connect(toRev); toRev.connect(this.revIn);

    this.layers = {};
    for (const name of LAYERS.concat('sig')) {
      const input = this.gain(1), g = this.gain(name === 'sig' ? 1 : 0);
      let lp = null;
      if (th.filt[name]) { lp = this.biquad('lowpass', th.filt[name][0], 0.6); input.connect(lp); lp.connect(g); } else input.connect(g);
      g.connect(this.sum);
      const s = th.sends[name] || [0, 0];
      if (s[0]) { const r = this.gain(s[0]); g.connect(r); r.connect(this.revIn); }
      if (s[1]) { const d = this.gain(s[1]); g.connect(d); d.connect(this.dIn); }
      this.layers[name] = { in: input, g, lp };
    }
    this.startTexture(t0);
  }

  delayTime() { return clamp(this.th.delay.beats * 60 / this.bpm, 0.05, 2.4); }

  // ---- Texture: continuous filtered noise, the bed that is always there. ----
  loop(buffer, t0, rate) {
    const s = this.ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.playbackRate.value = rate || 1;
    s.start(t0, this.rS() * (buffer.duration - 0.1)); this.sources.push(s); return s;
  }
  lfo(t0, freq, depth, param) {
    const o = this.ctx.createOscillator(), g = this.gain(depth);
    o.frequency.value = freq; o.connect(g); g.connect(param); o.start(t0); this.sources.push(o);
  }
  startTexture(t0) {
    const E = this.eng, dest = this.layers.tex.in;
    const path = (src, nodes) => { let n = src; for (const x of nodes) { n.connect(x); n = x; } n.connect(dest); };
    // Low rumble is summed to mono: uncorrelated bass in the two speakers sounds hollow and wastes headroom.
    const mono = () => { const g = this.gain(0.7); g.channelCount = 1; g.channelCountMode = 'explicit'; return g; };
    switch (this.th.texture) {
      case 'vinyl':
        path(this.loop(E.noise, t0), [this.biquad('highpass', 500), this.biquad('lowpass', 3800), this.gain(0.03)]);
        path(this.loop(E.crackle, t0), [this.biquad('highpass', 900), this.biquad('lowpass', 6000), this.gain(0.5)]);
        break;
      case 'rumble': {
        const g = this.gain(0.3);
        path(this.loop(E.noise, t0, 0.7), [mono(), this.biquad('lowpass', 110, 0.7), this.biquad('lowpass', 220), g]);
        this.lfo(t0, 0.07, 0.2, g.gain);
        const bp = this.biquad('bandpass', 2200, 2), pan = this.panner(0);
        path(this.loop(E.noise, t0, 1.1), [bp, this.gain(0.012), pan]);
        this.lfo(t0, 0.031, 1100, bp.detune); this.lfo(t0, 0.05, 0.7, pan.pan);
        break;
      }
      case 'room':
        path(this.loop(E.noise, t0, 0.8), [this.biquad('highpass', 150), this.biquad('lowpass', 600), this.gain(0.07)]);
        path(this.loop(E.noise, t0), [this.biquad('highpass', 2500), this.biquad('lowpass', 6000), this.gain(0.01)]);
        break;
      case 'wind': {
        const a = this.biquad('bandpass', 480, 1.2), b = this.biquad('bandpass', 820, 1.4);
        path(this.loop(E.noise, t0, 0.9), [a, this.gain(0.06), this.panner(-0.7)]);
        path(this.loop(E.noise, t0, 1.15), [b, this.gain(0.045), this.panner(0.7)]);
        this.lfo(t0, 0.031, 1300, a.detune); this.lfo(t0, 0.043, 1300, b.detune);
        path(this.loop(E.noise, t0, 0.6), [mono(), this.biquad('lowpass', 90, 0.7), this.biquad('lowpass', 160), this.gain(0.14)]);
        break;
      }
    }
  }

  // ---- Voices ----
  budget(t) {
    if (this.voices.length > 8) this.voices = this.voices.filter((e) => e > t);
    return this.voices.length < MAX_VOICES;
  }
  setWave(o, wave) { const w = this.eng.waves[wave]; if (w) o.setPeriodicWave(w); else o.type = wave; }

  note(dest, inst, midi, t, dur, vel, pan, force) {
    if (!force && !this.budget(t)) return;
    const c = this.ctx, f = mtof(midi);
    const hold = Math.max(dur, inst.a + 0.01);
    const end = t + hold + inst.r * 1.6 + 0.05;
    const env = c.createGain(), lp = c.createBiquadFilter(), pn = c.createStereoPanner();
    const nodes = [env, lp, pn]; const srcs = [];
    lp.type = 'lowpass'; lp.Q.value = inst.q || 0.5;
    const cut = clamp((inst.lp + f * (inst.lpKey || 0)) * (0.75 + 0.5 * vel), 80, 14000);
    if (inst.lpEnv) { lp.frequency.setValueAtTime(Math.min(15000, cut * (1 + inst.lpEnv)), t); lp.frequency.setTargetAtTime(cut, t, inst.lpDecay || 0.1); } else lp.frequency.value = cut;
    let peak = inst.gain * vel;
    if (inst.fm) {
      const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain();
      car.frequency.value = f; mod.frequency.value = f * inst.fm.ratio;
      // Less modulation up high: FM sidebands there are what makes a bell turn harsh.
      const dev = inst.fm.index * clamp(500 / f, 0.25, 1.2) * (0.6 + 0.6 * vel) * f;
      mg.gain.setValueAtTime(dev, t); mg.gain.setTargetAtTime(dev * inst.fm.sus, t, inst.fm.decay);
      mod.connect(mg); mg.connect(car.frequency); car.connect(lp);
      srcs.push(car, mod); nodes.push(mg);
    } else {
      const det = inst.det || [0];
      peak /= Math.sqrt(det.length);
      det.forEach((cents, i) => {
        const o = c.createOscillator();
        this.setWave(o, inst.wave); o.frequency.value = f * (inst.oct ? inst.oct[i] : 1);
        o.detune.value = cents + this.rS.range(-1.5, 1.5);
        if (inst.lv) { const g = c.createGain(); g.gain.value = inst.lv[i]; o.connect(g); g.connect(lp); nodes.push(g); } else o.connect(lp);
        srcs.push(o);
      });
    }
    // Every envelope starts and ends at zero through a ramp: that is what keeps notes free of clicks.
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(peak, t + inst.a);
    if (inst.s < 1) env.gain.setTargetAtTime(peak * inst.s, t + inst.a, inst.d / 3);
    env.gain.setTargetAtTime(0, t + hold, inst.r / 5);
    pn.pan.value = pan || 0;
    lp.connect(env); env.connect(pn); pn.connect(dest);
    for (const o of srcs) { o.start(t); o.stop(end); }
    srcs[0].onended = () => { for (const n of srcs.concat(nodes)) n.disconnect(); };
    this.voices.push(end);
  }

  startPad(t, dur, notes, attack) {
    const c = this.ctx, P = this.th.pad, a = attack || P.a;
    const env = c.createGain(), kill = c.createGain();
    const nodes = [env, kill], srcs = [];
    const tail = t + dur + a * 0.4, end = tail + P.r * 1.6;
    // Exponential approach in and out: consecutive chords overlap as a crossfade instead of a retrigger.
    env.gain.setValueAtTime(0, t); env.gain.setTargetAtTime(P.gain, t, a / 3); env.gain.setTargetAtTime(0, tail, P.r / 4);
    const pans = [0, -0.5, 0.25, -0.2, 0.5];
    notes.forEach((midi, i) => {
      const ng = c.createGain(), pn = c.createStereoPanner();
      ng.gain.value = (i === 0 ? 0.8 : i === notes.length - 1 ? 0.85 : 1) / Math.sqrt(P.det.length);
      pn.pan.value = pans[i % pans.length];
      P.det.forEach((cents, k) => {
        const o = c.createOscillator();
        this.setWave(o, P.oct && P.oct[k] !== 1 ? 'sine' : P.wave);
        o.frequency.value = mtof(midi) * (P.oct ? P.oct[k] : 1); o.detune.value = cents + this.rS.range(-2, 2);
        if (P.lv) { const g = c.createGain(); g.gain.value = P.lv[k]; o.connect(g); g.connect(ng); nodes.push(g); } else o.connect(ng);
        o.start(t); o.stop(end); srcs.push(o);
      });
      ng.connect(pn); pn.connect(env); nodes.push(ng, pn);
    });
    env.connect(kill); kill.connect(this.layers.pad.in);
    srcs[0].onended = () => { for (const n of srcs.concat(nodes)) n.disconnect(); };
    this.pad = { kill };
  }

  sineHit(dest, t, p, vel) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), a = p.a || 0.003;
    o.frequency.setValueAtTime(p.f0, t);
    if (p.f1) o.frequency.exponentialRampToValueAtTime(p.f1, t + p.drop);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p.gain * vel, t + a); g.gain.setTargetAtTime(0, t + a, p.tc);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + p.tc * 8);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  noiseHit(dest, t, p, vel) {
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), a = p.a || 0.002;
    const hp = this.biquad('highpass', p.hp), lp = this.biquad('lowpass', p.lp), pn = this.panner(p.pan || 0);
    s.buffer = this.eng.noise;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p.gain * vel, t + a); g.gain.setTargetAtTime(0, t + a, p.tc);
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(pn); pn.connect(dest);
    const len = a + p.tc * 8;
    s.loop = true;
    s.start(t, this.rS() * (this.eng.noise.duration - 0.1), len);
    s.onended = () => { for (const n of [s, hp, lp, g, pn]) n.disconnect(); };
  }

  // ---- Motifs: a two-bar figure per phrase. Each note has a rank; intensity decides how many ranks play, ----
  // ---- so the same figure thins out when calm and fills in when busy instead of changing into another one. ----
  newMotifs() {
    const th = this.th, r = this.rM;
    if (th.arp && (!this.arpShape || r.chance(0.35))) this.arpShape = { pat: r.pick(ARP_SHAPES).slice(), seed: r.int(1, 1e9) };
    else if (th.arp && r.chance(0.4)) { const p = this.arpShape.pat, i = r.int(0, p.length - 1); p[i] = clamp(p[i] + (r.chance(0.5) ? 1 : -1), 0, 5); }
    if (th.arp) this.mArp = this.genArp(th.arp.style, this.arpShape);
    if (th.lead && (!this.leadSeed || r.chance(0.5))) this.leadSeed = r.int(1, 1e9);
    if (th.lead) this.mLead = this.genLead(th.lead, this.leadSeed);
  }
  genArp(style, shape) {
    const r = makeRng(shape.seed), pat = shape.pat, m = {};
    if (style === 'bells') {
      const n = r.int(3, 5), used = new Set(), order = [];
      for (let i = 0; i < n; i++) order.push((i + r()) / n);
      for (let i = 0; i < n; i++) {
        let s; do { s = r.int(0, 15) * 2; } while (used.has(s)); used.add(s);
        const k = r.int(i, n - 1), rank = order[k]; order[k] = order[i];
        m[s] = [{ idx: r.int(0, 6), len: 8, rank, strong: true }];
      }
      return m;
    }
    const stride = style === 'eighth' ? 2 : 1;
    for (let k = 0; k < 32; k += stride) {
      const idx = pat[(k / stride) % pat.length];
      let rank;
      if (style === 'eighth') rank = k % 8 === 0 ? r() * 0.15 : k % 4 === 0 ? 0.1 + r() * 0.3 : 0.3 + r() * 0.65;
      else rank = k % 4 === 0 ? r() * 0.3 : k % 2 === 0 ? 0.25 + r() * 0.25 : 0.5 + r() * 0.5;
      m[k] = [{ idx, len: style === 'eighth' ? 3 : 0.9, rank, strong: k % 4 === 0 }];
    }
    return m;
  }
  genLead(L, seed) {
    const r = makeRng(seed), m = {}, n = r.int(L.count[0], L.count[1]), set = new Set([r.pick([0, 0, 2, 4])]);
    const grid = [0, 4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 26, 28, 3, 11, 19];
    let guard = 0;
    while (set.size < n && guard++ < 60) set.add(r.pick(grid));
    const on = Array.from(set).sort((a, b) => a - b);
    let idx = r.int(-1, 2);
    on.forEach((s, i) => {
      const next = i < on.length - 1 ? on[i + 1] : 32;
      m[s] = [{ idx, len: Math.min(L.maxLen, next - s), rank: i === 0 ? 0.05 : r.range(0.15, 1), strong: s % 4 === 0 || i === on.length - 1 }];
      idx = clamp(idx + r.pick([-2, -1, -1, 1, 1, 2, 0]), -4, 5);
    });
    return m;
  }

  // ---- Sequencer ----
  advance(until, now) {
    // After a stall (a throttled timer) the music carries on from where it was instead of bunching up late notes.
    if (this.nextT < now - 0.02) this.nextT = now + 0.03;
    while (this.nextT < until) { this.doStep(this.nextT); this.nextT += this.stepDur; this.step++; }
  }
  doStep(t) {
    const s = this.step % 16;
    if (this.fading) return;
    if (s === 0) this.onBar(t);
    if (s % 4 === 0) this.onBeat(t, s);
    const I = this.eng.intensity;
    const sw = s % 2 === 1 ? this.th.swing * this.stepDur : 0;
    this.playBass(t, s, I); this.playArp(t + sw, s, I); this.playPerc(t + sw, s, I);
    this.freshDur = 0;
  }

  newPhrase(t) {
    const th = this.th, degs = this.harm.phrase(), bars = this.rM.pick(th.chordBars);
    this.phrases = (this.phrases || 0) + 1;
    if (this.phrases > 1) {
      this.bpm = clamp(this.bpm + this.rH.range(-1.5, 1.5), th.bpm[0], th.bpm[1]);
      this.stepDur = 15 / this.bpm;
      const dt = this.delayTime();
      this.dL.delayTime.setTargetAtTime(dt, t, 1); this.dR.delayTime.setTargetAtTime(dt, t, 1);
    }
    this.newMotifs(); this.mBar = 1;
    this.octaves = Array.from({ length: 8 }, () => this.rM.chance(0.3));
    return degs.map((deg) => ({ deg, bars }));
  }
  updateDrift(t) {
    const b = this.bar, p = this.phase, th = this.th;
    // Two slow, unrelated cycles (about 3 and 7 minutes) so the timbre never sits still nor repeats soon.
    this.drift.bright = Math.pow(2, 0.3 * Math.sin(b / 9.7 + p[0]) + 0.2 * Math.sin(b / 23.3 + p[1]));
    this.drift.reg = Math.round(1.3 * Math.sin(b / 17.1 + p[2]));
    this.revOut.gain.setTargetAtTime(th.reverb.level * (1 + 0.3 * Math.sin(b / 13.9 + p[3])), t, 2);
    this.dFb.gain.setTargetAtTime(clamp(th.delay.fb + 0.1 * Math.sin(b / 11.3 + p[4]), 0, 0.6), t, 2);
  }
  onBar(t) {
    this.bar++;
    let land = null, force = false;
    if (this.tension && this.bar >= this.tension.endBar) { this.tension = null; force = true; this.toneLP.frequency.setTargetAtTime(this.th.tone, t, 0.4); }
    if (this.resolve && this.bar >= this.resolve.bar) { land = this.resolve; this.resolve = null; force = true; }
    this.updateDrift(t);
    if (force) { this.queue = []; this.chordBarsLeft = 0; }
    if (this.chordBarsLeft <= 0) {
      if (!this.queue.length) { this.queue = this.newPhrase(t); if (force) this.queue[0].deg = 0; }
      const it = this.queue.shift();
      this.chordBarsLeft = it.bars; this.chordBar = 0;
      this.applyChord(this.harm.chord(it.deg), t, it.bars * 16 * this.stepDur, land ? 0.6 : 0);
    } else this.chordBar++;
    this.chordBarsLeft--;
    this.mBar = (this.mBar + 1) % 2;
    if (land) this.landing(t, land);
  }
  applyChord(ch, t, dur, attack) {
    const th = this.th, R = th.range, rich = th.color === 'rich';
    this.chord = ch; this.freshDur = dur;
    const pcs = rich ? [ch.third, ch.fifth, ch.seventh, ch.ninth === null ? ch.root : ch.ninth]
      : [ch.root, ch.third, ch.fifth, ch.ninth === null ? ch.seventh : ch.ninth];
    this.voicing = leadVoices(this.voicing, pcs, R.pad[0], R.pad[1]);
    this.arpP = pitches(rich ? [ch.root, ch.third, ch.fifth, ch.seventh] : [ch.root, ch.third, ch.fifth], R.arp[0], R.arp[1]);
    this.chordPcs = [ch.root, ch.third, ch.fifth, ch.seventh];
    this.leadS = pitches(this.harm.scalePcs(), R.lead[0], R.lead[1]);
    this.startPad(t, dur, [fit(ch.root, R.pad[0] - 12)].concat(this.voicing), attack);
    if (th.keys) {
      // A rolled chord, low to high, like a hand on the keys.
      const I = this.eng.intensity;
      this.voicing.forEach((m, i) => this.note(this.layers.pad.in, th.keys, m, t + i * 0.028 + this.rS.range(0, 0.008), this.stepDur * 10, 0.45 + 0.25 * I + this.rS.range(-0.06, 0.06), (i - 1.5) * 0.2));
    }
  }
  onBeat(t, s) {
    const E = this.eng, th = this.th, I = E.intensity;
    for (const name of LAYERS) {
      const m = th.mix[name], L = this.layers[name];
      let v = m[2] + (m[3] - m[2]) * smooth(m[0], m[1], I);
      if (E.solo && E.solo !== name) v = 0;
      this.levels[name] = v;
      if (this.tension) v *= TENSION_DUCK[name];
      L.g.gain.setTargetAtTime(v * th.level[name], t, 0.4);
      if (L.lp) { const f = th.filt[name]; L.lp.frequency.setTargetAtTime(clamp(f[0] * Math.pow(f[1] / f[0], I) * this.drift.bright, 120, 12000), t, 0.6); }
    }
    if (E.pending.error) { E.pending.error = false; this.beginTension(t, s); return; }
    if (E.pending.resolve && this.resolve) {
      // One cadence at a time: a success that arrives during the run for "done" just brightens its landing.
      if (E.pending.resolve === 'success') this.resolve.kind = 'success';
      E.pending.resolve = null;
    } else if (E.pending.resolve && !this.tension) { const kind = E.pending.resolve; E.pending.resolve = null; this.beginResolve(t, s, kind); }
  }

  // Error: the harmony leaves for the flat second for two beats to a bar and a half, darker and without
  // rhythm, then falls back onto the tonic at the bar line.
  beginTension(t, s) {
    const left = 16 - s, sd = this.stepDur;
    const endBar = this.bar + (left >= 8 ? 1 : 2);
    this.tension = { endBar }; this.resolve = null; this.chordBarsLeft = 99;
    if (this.pad) this.pad.kill.gain.setTargetAtTime(0, t, 0.12);
    const ch = this.harm.tensionChord();
    this.applyChord(ch, t, ((endBar - this.bar) * 16 - s) * sd, 0.3);
    this.toneLP.frequency.setTargetAtTime(this.th.tone * 0.25, t, 0.2);
    this.sineHit(this.layers.sig.in, t, { f0: mtof(fit(ch.root, 33)), tc: 0.45, gain: 0.3, a: 0.02 }, 1);
  }
  // Success / agent done: a run of the suspended dominant's tones over the dominant in the bass, timed in
  // eighth notes to land on the tonic at the next bar line. Up and bright for success, down and soft for done.
  beginResolve(t, s, kind) {
    const th = this.th, sd = this.stepDur, up = kind === 'success';
    let n = 16 - s, bar = this.bar + 1;
    if (n < 6) { n += 16; bar++; }
    const sus = this.harm.susPcs();
    const top = fit(this.harm.tonic, up ? 74 : 63);
    const ladder = pitches(sus, top - 24, top + 12), k = ladder.indexOf(top);
    const count = up ? Math.min(4, Math.floor(n / 2) - 1) : 2;
    const dest = this.layers.sig.in;
    for (let i = count; i >= 1; i--) {
      const p = up ? ladder[k - i] : ladder[k + i];
      this.note(dest, th.flourish, p, t + (n - 2 * i) * sd, sd * 3, (up ? 0.55 : 0.45) + 0.07 * (count - i), i % 2 ? -0.25 : 0.25, true);
    }
    this.note(dest, th.bass, fit(sus[2], th.range.bass), t, n * sd * 0.92, up ? 0.55 : 0.45, 0, true);
    this.resolve = { bar, kind, top };
  }
  landing(t, r) {
    const th = this.th, dest = this.layers.sig.in, sd = this.stepDur, up = r.kind === 'success';
    this.note(dest, th.flourish, r.top, t, sd * 8, up ? 0.8 : 0.6, 0, true);
    this.note(dest, th.bass, fit(this.harm.tonic, th.range.bass), t, sd * 12, 0.55, 0, true);
    if (up) {
      this.note(dest, th.flourish, r.top + 7, t + 0.012, sd * 8, 0.55, 0.3, true);
      this.note(dest, th.flourish, r.top + 12, t + sd * 2, sd * 8, 0.4, -0.3, true);
      this.noiseHit(dest, t, { hp: 4500, lp: 8500, tc: 0.7, gain: 0.02, a: 0.25 }, 1);
    }
  }

  playBass(t, s, I) {
    if (!(this.levels.bass > 0.02) || this.resolve) return;
    const th = this.th, sd = this.stepDur, r = this.rP, ch = this.chord, dest = this.layers.bass.in;
    const root = fit(ch.root, th.range.bass), fifth = fit(ch.fifth, th.range.bass);
    const play = (m, steps, vel) => this.note(dest, th.bass, m, t, steps * sd, vel, 0, true);
    switch (th.bassStyle) {
      case 'long':
        if (s === 0) play(root, I < 0.6 ? 10 : 6, 0.9);
        else if (s === 10 && I > 0.5 && r.chance(0.55)) play(r.chance(0.5) ? root + 12 : fifth, 3, 0.65);
        else if (s === 14 && I > 0.65 && r.chance(0.3)) play(fifth, 2, 0.55);
        break;
      case 'pulse':
        if (I < 0.45) { if (s === 0) play(root, 14, 0.85); }
        else if (s % 2 === 0) play(I > 0.7 && this.octaves[s / 2] && s % 4 === 2 ? root + 12 : root, 1.5, s % 4 === 0 ? 0.9 : 0.68);
        else if (s === 15 && I > 0.75 && r.chance(0.35)) play(root + 12, 0.8, 0.55);
        break;
      case 'piano':
        if (s === 0) play(root, 12, 0.75 + this.rS.range(-0.08, 0.08));
        else if (s === 8 && I > 0.3) play(r.chance(0.6) ? fifth : root + 12, 8, 0.55);
        break;
      case 'sub':
        // The drone follows the chord itself, whenever it starts, not the bar line.
        if (this.freshDur) play(root, this.freshDur / sd - 2, 0.9);
        else if (s === 0 && I > 0.6) play(root + 12, 6, 0.4);
        break;
    }
  }
  playArp(t, s, I) {
    const th = this.th, pos = this.mBar * 16 + s, sd = this.stepDur, r = this.rS;
    if (!(this.levels.arp > 0.02)) return;
    // The motifs step back while a flourish is running so it reads clearly.
    const vscale = (this.resolve ? 0.5 : 1) * (0.8 + 0.25 * I);
    const dest = this.layers.arp.in, jitter = () => r.range(0, th.human);
    if (th.arp && this.arpP.length) {
      const thr = lerp(th.arp.dens[0], th.arp.dens[1], I), P = this.arpP, n = P.length;
      for (const ev of this.mArp[pos] || []) {
        if (ev.rank >= thr) continue;
        let i = Math.floor(n * 0.3) + this.drift.reg + ev.idx;
        if (i >= n) i = 2 * (n - 1) - i;
        const vel = (ev.strong ? 0.8 : 0.6) + r.range(-0.1, 0.1);
        this.note(dest, th.arp.inst, P[clamp(i, 0, n - 1)], t + jitter(), ev.len * sd, vel * vscale, ((s % 4) - 1.5) * 0.3);
      }
    }
    if (th.lead && !this.tension && this.leadS.length) {
      const thr = lerp(th.lead.dens[0], th.lead.dens[1], I), S = this.leadS, n = S.length;
      for (const ev of this.mLead[pos] || []) {
        if (ev.rank >= thr) continue;
        let p = S[clamp(Math.floor(n / 2) + this.drift.reg + ev.idx, 0, n - 1)];
        // Notes that carry weight are pulled onto the chord; passing notes stay on the scale.
        if (ev.strong) for (const d of [0, 1, -1, 2, -2]) if (this.chordPcs.includes(mod12(p + d))) { p += d; break; }
        const vel = (ev.strong ? 0.8 : 0.62) + r.range(-0.1, 0.1);
        this.note(dest, th.lead.inst, p, t + jitter(), ev.len * sd, vel * vscale, r.range(-0.2, 0.2));
      }
    }
  }
  playPerc(t, s, I) {
    if (!(this.levels.perc > 0.02) || this.tension) return;
    const th = this.th, r = this.rP, K = th.kit, dest = this.layers.perc.in;
    const tt = t + this.rS.range(0, th.human * 0.5);
    const lastBar = !this.queue.length && this.chordBarsLeft === 0;
    const kick = (v) => this.sineHit(dest, tt, K.kick, v);
    const hat = (v, open) => this.noiseHit(dest, tt, open ? Object.assign({}, K.hat, { tc: K.hat.tc * 4 }) : K.hat, v * r.range(0.8, 1));
    const snare = (v) => { this.noiseHit(dest, tt, K.snare, v); this.sineHit(dest, tt, K.body, v); };
    switch (th.perc) {
      case 'lofi':
        if (I > 0.5 && (s === 0 || (s === 10 && r.chance(0.75)) || (s === 7 && r.chance(0.15)))) kick(s === 0 ? 0.95 : 0.7);
        if (I > 0.56 && (s === 4 || s === 12)) snare(0.75);
        else if (I > 0.6 && (s === 9 || s === 15) && r.chance(lastBar ? 0.35 : 0.1)) snare(0.3);
        if (I > 0.4) { if (s % 2 === 0) hat(s % 4 === 0 ? 0.5 : 0.8, s === 14 && r.chance(0.12)); else if (r.chance(0.2)) hat(0.3); }
        break;
      case 'neon':
        if (I > 0.5 && (s % 8 === 0 || (I > 0.62 && s % 4 === 0))) kick(s % 8 === 0 ? 1 : 0.85);
        if (I > 0.6 && (s === 4 || s === 12)) snare(0.85);
        else if (I > 0.6 && lastBar && s >= 13 && r.chance(0.45)) snare(0.35);
        if (I > 0.42) { if (s % 4 === 2) hat(0.85, s === 14 && r.chance(0.2)); else if (I > 0.75 && s % 4 !== 0) hat(0.4); }
        break;
      case 'felt':
        if (I > 0.6 && s % 2 === 0) hat(s % 8 === 4 ? 0.85 : 0.45);
        if (I > 0.72 && (s === 0 || (s === 10 && r.chance(0.5)))) kick(s === 0 ? 0.9 : 0.6);
        break;
      case 'space':
        if (I > 0.5 && (s === 0 || s === 3)) kick(s === 0 ? 0.95 : 0.55);
        if (I > 0.62 && ((s % 4 === 2 && r.chance(0.6)) || (I > 0.8 && s % 2 === 1 && r.chance(0.15)))) this.sineHit(dest, tt, K.tick, r.range(0.5, 1));
        break;
    }
  }

  fadeOut(t) {
    this.fading = true; this.disposeAt = t + 7;
    this.out.gain.setTargetAtTime(0, t, 0.9);
  }
  dispose() {
    for (const s of this.sources) { try { s.stop(); } catch (e) { /* already stopped */ } s.disconnect(); }
    this.sources = [];
    this.out.disconnect();
  }
}

// ---- Engine: context, master bus, intensity and signals. ----
class Engine {
  constructor(opts) {
    this.opts = opts || {};
    this.seed = String(this.opts.seed == null ? 'orb' : this.opts.seed);
    this.themeId = THEMES[this.opts.theme] ? this.opts.theme : 'bruma';
    this.volume = this.opts.volume == null ? 0.6 : clamp(Number(this.opts.volume) || 0, 0, 1);
    this.solo = this.opts.solo || null;
    this.ctx = null; this.state = 'stopped'; this.scenes = []; this.scene = null; this.sceneSerial = 0;
    this.intensity = 0; this.target = 0; this.activity = 0; this.bump = 0; this.manual = null;
    this.working = false; this.fastDecay = false; this.lastType = -100; this.lastNow = 0;
    this.pending = { error: false, resolve: null };
    this.subs = new Set(); this.lastEmit = 0; this.autoPaused = false; this.irs = {};
    this.onVisibility = () => {
      if (document.hidden) { if (this.state === 'playing') { this.pauseNow(); this.autoPaused = true; } }
      else if (this.autoPaused) { this.autoPaused = false; this.resume(); }
    };
  }

  buildMaster() {
    const c = this.ctx;
    this.offline = typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;
    const rng = makeRng(hashSeed('orb-noise'));
    this.noise = c.createBuffer(2, Math.floor(c.sampleRate * 3), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = this.noise.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1; }
    // Vinyl crackle: sparse, mostly tiny pops; silent at both ends so the loop has no seam.
    this.crackle = c.createBuffer(2, Math.floor(c.sampleRate * 7), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = this.crackle.getChannelData(ch), n = d.length; let i = 0;
      for (;;) {
        i += Math.floor(-Math.log(1 - rng()) * c.sampleRate / 5) + 1;
        if (i >= n - 400) break;
        const amp = Math.pow(rng(), 4) * 0.5 + 0.03, len = 20 + Math.floor(rng() * 90);
        for (let k = 0; k < len; k++) d[i + k] += (rng() * 2 - 1) * amp * Math.exp(-k / (len / 4));
      }
    }
    const wave = (amps) => { const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1); amps.forEach((a, i) => { im[i + 1] = a; }); return c.createPeriodicWave(re, im); };
    this.waves = {
      soft: wave(Array.from({ length: 10 }, (_, i) => 1 / Math.pow(i + 1, 2))),
      piano: wave([1, 0.55, 0.3, 0.2, 0.13, 0.09, 0.06, 0.045, 0.03, 0.02, 0.015, 0.01]),
      glass: wave([1, 0, 0.28, 0, 0.1, 0, 0.04]),
    };

    this.masterIn = c.createGain();
    // Glue compression, then a fast limiter, then a soft clipper as the hard guarantee that nothing reaches full scale.
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 2.5; comp.attack.value = 0.03; comp.release.value = 0.3;
    this.trim = c.createGain(); this.trim.gain.value = 0.62;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    const clip = c.createWaveShaper(), curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / 1024) - 1, a = Math.abs(x);
      curve[i] = a < 0.75 ? x : Math.sign(x) * (0.75 + 0.23 * Math.tanh((a - 0.75) / 0.23));
    }
    clip.curve = curve; clip.oversample = '2x';
    this.fade = c.createGain(); this.fade.gain.value = 0;
    this.vol = c.createGain(); this.vol.gain.value = this.volGain();
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024; this.meter = new Float32Array(1024);
    this.masterIn.connect(comp); comp.connect(this.trim); this.trim.connect(lim); lim.connect(clip); clip.connect(this.fade);
    this.fade.connect(this.vol); this.vol.connect(this.analyser); this.analyser.connect(c.destination);
  }
  // Synthesised impulse response: decaying noise that gets darker as it fades, as a real room does.
  impulse(secs, damp) {
    const key = secs + '|' + damp;
    if (this.irs[key]) return this.irs[key];
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(secs * sr), buf = c.createBuffer(2, n, sr), pre = Math.floor(0.012 * sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch), rng = makeRng(hashSeed('ir' + key + ch)); let y = 0;
      for (let i = pre; i < n; i++) {
        const x = (i - pre) / (n - pre);
        y += lerp(0.5, damp, Math.sqrt(x)) * ((rng() * 2 - 1) - y);
        d[i] = y * Math.pow(10, -3 * x) * Math.min(1, (i - pre) / (0.004 * sr)) * Math.min(1, (n - i) / (0.05 * sr));
      }
    }
    return (this.irs[key] = buf);
  }
  volGain() { return Math.pow(this.volume, 1.5); }

  start() {
    if (this.state === 'playing') return;
    if (this.state === 'paused') { this.resume(); return; }
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx = this.opts.context || new AC({ latencyHint: 'playback' });
      this.buildMaster();
      if (!this.offline && typeof document !== 'undefined' && this.opts.autoPause !== false) document.addEventListener('visibilitychange', this.onVisibility);
    }
    clearTimeout(this.stopTimer); clearTimeout(this.suspendTimer);
    if (!this.offline && this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    this.lastNow = t; this.lastType = -100;
    this.disposeScenes();
    this.scene = new Scene(this, this.themeId, t + 0.05); this.scenes = [this.scene];
    this.fade.gain.cancelScheduledValues(t); this.fade.gain.setTargetAtTime(1, t, 0.05);
    this.state = 'playing'; this.autoPaused = false;
    this.run(); this.emit(true);
  }
  stop() {
    if (this.state === 'stopped' || !this.ctx) return;
    clearTimeout(this.timer); clearTimeout(this.suspendTimer);
    const wasPaused = this.state === 'paused';
    this.state = 'stopped'; this.autoPaused = false;
    this.pending = { error: false, resolve: null }; this.working = false; this.activity = 0; this.bump = 0; this.intensity = 0;
    const finish = () => { this.disposeScenes(); if (!this.offline) this.ctx.suspend(); };
    if (wasPaused || this.offline) finish();
    else { this.fade.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); this.stopTimer = setTimeout(finish, 600); }
    this.emit(true);
  }
  pause() { this.autoPaused = false; this.pauseNow(); }
  pauseNow() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; clearTimeout(this.timer);
    // A short fade before suspending: cutting the context mid-wave would click.
    this.fade.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    this.suspendTimer = setTimeout(() => this.ctx.suspend(), 180);
    this.emit(true);
  }
  resume() {
    if (this.state !== 'paused') return;
    clearTimeout(this.suspendTimer); this.state = 'playing'; this.autoPaused = false;
    Promise.resolve(this.ctx.resume()).then(() => {
      if (this.state !== 'playing') return;
      const t = this.ctx.currentTime;
      this.lastNow = t; this.fade.gain.setTargetAtTime(1, t, 0.08);
      this.run(); this.emit(true);
    });
  }
  run() {
    if (this.offline) return;
    clearTimeout(this.timer);
    const loop = () => {
      if (this.state !== 'playing') return;
      this.tick(this.ctx.currentTime);
      this.timer = setTimeout(loop, TICK_MS);
    };
    loop();
  }
  disposeScenes() { for (const s of this.scenes) s.dispose(); this.scenes = []; this.scene = null; }

  setVolume(v) {
    this.volume = clamp(Number(v) || 0, 0, 1);
    if (this.vol) this.vol.gain.setTargetAtTime(this.volGain(), this.ctx.currentTime, 0.04);
  }
  setTheme(id) {
    if (!THEMES[id] || id === this.themeId) return;
    this.themeId = id;
    if (this.state === 'stopped') { this.emit(true); return; }
    const t = Math.max(this.ctx.currentTime, this.lastNow);
    for (const s of this.scenes) if (!s.fading) s.fadeOut(t);
    this.pending = { error: false, resolve: null };
    this.scene = new Scene(this, id, t + 0.4); this.scenes.push(this.scene);
    this.emit(true);
  }
  setIntensity(v) { this.manual = v == null ? null : clamp(Number(v) || 0, 0, 1); }
  signal(ev) {
    const now = this.lastNow;
    switch (ev) {
      case 'typing': this.activity = Math.max(this.activity, Math.min(0.62, this.activity + 0.045)); this.lastType = now; this.fastDecay = false; break;
      case 'agent-working': this.working = true; this.fastDecay = false; this.activity = Math.max(this.activity, 0.5); break;
      case 'agent-done': this.working = false; this.activity = Math.max(this.activity, 0.45); if (!this.pending.resolve) this.pending.resolve = 'done'; break;
      case 'success': this.working = false; this.activity = Math.max(this.activity, 0.45); this.bump += 0.1; this.pending.resolve = 'success'; break;
      case 'error': this.pending.error = true; this.bump += 0.1; break;
      case 'idle': this.working = false; this.fastDecay = true; break;
      default: return false;
    }
    return true;
  }

  // One scheduler pass. `now` is the audio clock; everything up to now + LOOKAHEAD gets scheduled on it.
  tick(now) {
    const dt = clamp(now - this.lastNow, 0, 0.5); this.lastNow = now;
    if (now - this.lastType > 1.5) this.activity *= Math.exp(-dt / (this.fastDecay ? 6 : 28));
    this.bump *= Math.exp(-dt / 4);
    let target = this.activity;
    if (this.working) target = Math.max(target, 0.78 + 0.06 * Math.sin(now * 0.11));
    target = this.manual == null ? clamp(target + this.bump, 0, 1) : this.manual;
    this.target = target;
    // Fast to rise, slow to settle: activity is felt at once and calm returns gradually.
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt / (target > this.intensity ? 1.2 : 4.5)));
    for (const s of this.scenes) s.advance(now + LOOKAHEAD, now);
    if (this.scenes.length > 1 && !this.offline) this.scenes = this.scenes.filter((s) => { if (now > s.disposeAt) { s.dispose(); return false; } return true; });
    this.emit(false);
  }

  getState() {
    const s = this.scene;
    return {
      state: this.state, playing: this.state === 'playing', theme: this.themeId, seed: this.seed, volume: this.volume,
      intensity: this.intensity, target: this.target, manual: this.manual, working: this.working,
      layers: s ? Object.assign({}, s.levels) : {},
      chord: s && s.chord ? s.chord.name : '', key: s ? s.harm.keyName() : '', bpm: s ? Math.round(s.bpm) : 0, bar: s ? s.bar + 1 : 0,
      tension: Boolean(s && s.tension), resolving: s && s.resolve ? s.resolve.kind : null, voices: s ? s.voices.length : 0,
    };
  }
  // Peak of the last few milliseconds at the output, 0..1, for a level meter.
  getLevel() {
    if (!this.analyser || this.state !== 'playing') return 0;
    this.analyser.getFloatTimeDomainData(this.meter);
    let p = 0; for (let i = 0; i < this.meter.length; i++) { const a = Math.abs(this.meter[i]); if (a > p) p = a; }
    return p;
  }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(force) {
    if (!this.subs.size) return;
    const now = Date.now();
    if (!force && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    const st = this.getState();
    for (const fn of this.subs) fn(st);
  }
  destroy() {
    clearTimeout(this.timer); clearTimeout(this.stopTimer); clearTimeout(this.suspendTimer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.state = 'stopped'; this.subs.clear();
    if (this.ctx) { this.disposeScenes(); if (!this.offline && !this.opts.context) this.ctx.close(); }
    this.ctx = null;
  }
}

export const THEME_IDS = Object.freeze(Object.keys(THEMES));
export const SIGNALS = Object.freeze(['idle', 'typing', 'agent-working', 'agent-done', 'error', 'success']);
export function createAdaptiveMusic(opts) {
  const e = new Engine(opts);
  return {
    start: () => e.start(), stop: () => e.stop(), pause: () => e.pause(), resume: () => e.resume(),
    setVolume: (v) => e.setVolume(v), setTheme: (id) => e.setTheme(id), setIntensity: (v) => e.setIntensity(v),
    signal: (ev) => e.signal(ev), getState: () => e.getState(), getLevel: () => e.getLevel(),
    subscribe: (fn) => e.subscribe(fn), destroy: () => e.destroy(),
    // For offline rendering and tests: drive the scheduler by hand.
    _tick: (now) => e.tick(now), _engine: e,
  };
}
