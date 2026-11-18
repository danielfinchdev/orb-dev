// The mini-games' music: each game has a theme of its own for the adaptive engine (lib/adaptive-music.js), so it is made
// as it plays, with no file and no network, and it follows the game. lib/music.js loads this module the first time a
// game with music starts; the games tell what happens through their sound effects' names (games/sfx.js › hearGame).
//
//   GAME_THEMES            a theme per game, by the game's id (games/games.jsx)
//   createGameMood(id)     what the music does with what happens in that game:
//     mood.event('tetris.lines', 4)  → a signal for the engine ('success', 'agent-done', 'error') or null
//     mood.end(record)               → the same, when the game is over
//     mood.level()                   → the intensity the music should have now, 0..1

const NO_TEXTURE = [0, 1, 0, 0];
const LEVEL = { pad: 1, bass: 1, arp: 1, perc: 1, tex: 1 };

// ---- The instruments of the arcade themes: the thin pulse, the square and the triangle of the old consoles. ----
const pulse = (o) => ({ wave: 'pulse', det: [0], lp: 2600, lpKey: 1.5, a: 0.004, d: 0.25, s: 0.5, r: 0.08, gain: 0.1, ...o });
const square = (o) => ({ wave: 'square', det: [0], lp: 2000, lpKey: 1, a: 0.003, d: 0.12, s: 0, r: 0.06, gain: 0.08, ...o });
const triangle = (o) => ({ wave: 'triangle', det: [0], lp: 900, lpKey: 2, a: 0.004, d: 0.2, s: 0.7, r: 0.06, gain: 0.4, ...o });
const chipKit = (o) => ({
  kick: { f0: 150, f1: 50, drop: 0.06, tc: 0.07, gain: 0.3 },
  snare: { hp: 1200, lp: 7000, tc: 0.05, gain: 0.15 }, body: { f0: 220, f1: 170, drop: 0.04, tc: 0.035, gain: 0.07 },
  hat: { hp: 7500, lp: 11000, tc: 0.015, gain: 0.055, pan: 0.2 },
  ...o,
});

// A theme per game. What each field means: lib/adaptive-music.js › Themes.
export const GAME_THEMES = Object.freeze({
  // Snake: light and playful, a walking bass and plucked notes; it fills in and speeds up a little as the snake grows.
  snake: {
    tonics: [7, 0, 2, 5], modes: ['lydian', 'ionian', 'mixolydian'], mode0: 1,
    bpm: [96, 104], rush: 0.15, swing: 0.08, human: 0.004, chordBars: [1, 2], color: 'open',
    range: { pad: [55, 72], arp: [60, 84], lead: [67, 88], bass: 36 },
    tone: 9000, reverb: { secs: 1.2, damp: 0.15, level: 0.3 }, delay: { beats: 0.75, fb: 0.25, level: 0.35 },
    mix: { pad: [0, 0.3, 0.6, 0.8], bass: [0, 0.2, 0.5, 1], arp: [0.05, 0.4, 0.3, 1], perc: [0.2, 0.5, 0, 1], tex: NO_TEXTURE },
    level: LEVEL,
    sends: { pad: [0.3, 0], bass: [0, 0], arp: [0.2, 0.25], perc: [0.08, 0], tex: [0, 0], sig: [0.3, 0.3] },
    filt: { pad: [900, 2200] },
    pad: { wave: 'triangle', det: [-5, 5], a: 0.5, r: 1, gain: 0.04 },
    bass: triangle(), bassStyle: 'walk',
    arp: { style: 'eighth', dens: [0.25, 1], inst: square({ d: 0.16 }) },
    lead: { style: 'melody', count: [3, 6], maxLen: 4, dens: [0.15, 1], inst: pulse() },
    flourish: pulse({ lp: 3400, d: 0.5, s: 0.3, r: 0.3, gain: 0.14 }),
    perc: 'chip', kit: chipKit(), texture: 'none',
  },
  // Tetris: driving and minor, a bouncing bass under fast arpeggios; faster with every level.
  tetris: {
    tonics: [4, 9, 2, 11], modes: ['dorian', 'aeolian', 'phrygian'], mode0: 1,
    bpm: [112, 122], rush: 0.22, swing: 0, human: 0.002, chordBars: [1, 2], color: 'open',
    range: { pad: [52, 69], arp: [57, 84], lead: [64, 86], bass: 33 },
    tone: 9500, reverb: { secs: 1.4, damp: 0.14, level: 0.3 }, delay: { beats: 0.75, fb: 0.3, level: 0.4 },
    mix: { pad: [0, 0.3, 0.55, 0.75], bass: [0, 0.2, 0.5, 1], arp: [0.1, 0.45, 0.25, 1], perc: [0.25, 0.5, 0, 1], tex: NO_TEXTURE },
    level: LEVEL,
    sends: { pad: [0.3, 0], bass: [0, 0], arp: [0.18, 0.3], perc: [0.1, 0], tex: [0, 0], sig: [0.3, 0.3] },
    filt: { pad: [700, 2000], arp: [1400, 5000] },
    pad: { wave: 'soft', det: [-7, 7], a: 0.6, r: 1.2, gain: 0.05 },
    bass: triangle({ lp: 1000 }), bassStyle: 'octave',
    arp: { style: 'sixteenth', dens: [0.1, 1], inst: square() },
    lead: { style: 'melody', count: [4, 7], maxLen: 4, dens: [0.1, 1], inst: pulse({ gain: 0.11 }) },
    flourish: pulse({ lp: 3400, d: 0.5, s: 0.3, r: 0.3, gain: 0.14 }),
    perc: 'chip', kit: chipKit(), texture: 'none',
  },
  // Chess: slow and thoughtful, a piano in a quiet room; a check darkens it for a moment.
  chess: {
    tonics: [2, 9, 7, 0], modes: ['dorian', 'aeolian'], mode0: 0,
    bpm: [60, 68], swing: 0, human: 0.014, chordBars: [2, 2, 1], color: 'rich',
    range: { pad: [50, 69], arp: [55, 79], lead: [65, 86], bass: 31 },
    tone: 8000, reverb: { secs: 2.6, damp: 0.09, level: 0.6 }, delay: { beats: 1, fb: 0.2, level: 0.3 },
    mix: { pad: [0, 0.4, 0.7, 1], bass: [0.05, 0.3, 0, 1], arp: [0.1, 0.5, 0.3, 1], perc: [0.6, 0.85, 0, 0.7], tex: [0, 1, 0.8, 1] },
    level: LEVEL,
    sends: { pad: [0.45, 0], bass: [0.15, 0], arp: [0.4, 0.12], perc: [0.2, 0], tex: [0, 0], sig: [0.5, 0.15] },
    filt: { pad: [450, 1200] },
    pad: { wave: 'soft', det: [-5, 5], a: 2.2, r: 3.2, gain: 0.04 },
    bass: { wave: 'piano', det: [-2, 2], lp: 300, lpKey: 3, lpEnv: 2, lpDecay: 0.25, a: 0.008, d: 3.2, s: 0, r: 0.5, gain: 0.3 },
    bassStyle: 'piano',
    arp: { style: 'eighth', dens: [0.05, 0.8],
      inst: { wave: 'piano', det: [-3, 3], lp: 500, lpKey: 3, lpEnv: 2.5, lpDecay: 0.22, a: 0.006, d: 2.2, s: 0, r: 0.45, gain: 0.15 } },
    lead: { style: 'melody', count: [2, 4], maxLen: 8, dens: [0.1, 0.8],
      inst: { wave: 'piano', det: [-3, 3], lp: 600, lpKey: 3, lpEnv: 2.5, lpDecay: 0.2, a: 0.006, d: 2.4, s: 0, r: 0.5, gain: 0.18 } },
    flourish: { wave: 'piano', det: [-3, 3], lp: 800, lpKey: 3.5, lpEnv: 2.5, lpDecay: 0.2, a: 0.006, d: 2.6, s: 0, r: 0.8, gain: 0.24 },
    perc: 'felt',
    kit: { kick: { f0: 90, f1: 50, drop: 0.07, tc: 0.08, gain: 0.3 }, hat: { hp: 3500, lp: 7000, tc: 0.035, gain: 0.06, pan: -0.2, a: 0.012 } },
    texture: 'room',
  },
  // Jumper: fast electronic music with the beat always on; it never lets go.
  runner: {
    tonics: [9, 6, 4, 11], modes: ['dorian', 'aeolian'], mode0: 1,
    bpm: [128, 136], swing: 0, human: 0.002, chordBars: [2, 1], color: 'open',
    range: { pad: [50, 70], arp: [57, 84], lead: [67, 86], bass: 30 },
    tone: 10000, reverb: { secs: 1.8, damp: 0.12, level: 0.35 }, delay: { beats: 0.75, fb: 0.35, level: 0.45 },
    mix: { pad: [0, 0.3, 0.6, 0.9], bass: [0, 0.2, 0.5, 1], arp: [0.1, 0.5, 0.3, 1], perc: [0.2, 0.5, 0, 1], tex: NO_TEXTURE },
    level: LEVEL,
    sends: { pad: [0.35, 0], bass: [0, 0], arp: [0.2, 0.35], perc: [0.12, 0], tex: [0, 0], sig: [0.4, 0.35] },
    filt: { pad: [500, 2600], arp: [1100, 5600] },
    pad: { wave: 'sawtooth', det: [-9, 0, 9], a: 0.5, r: 1.2, gain: 0.05 },
    bass: { wave: 'sawtooth', det: [-4, 4], lp: 220, lpKey: 1.6, lpEnv: 3, lpDecay: 0.09, q: 2, a: 0.005, d: 0.25, s: 0.55, r: 0.07, gain: 0.3 },
    bassStyle: 'pulse',
    arp: { style: 'sixteenth', dens: [0.1, 1],
      inst: { wave: 'sawtooth', det: [-5, 5], lp: 4600, lpKey: 0, a: 0.004, d: 0.2, s: 0, r: 0.15, gain: 0.15 } },
    lead: { style: 'melody', count: [3, 5], maxLen: 6, dens: [-0.2, 0.8], inst: pulse({ a: 0.01, d: 0.6, s: 0.6, r: 0.25, gain: 0.09 }) },
    flourish: { wave: 'sawtooth', det: [-6, 6], lp: 1500, lpKey: 2, lpEnv: 2, lpDecay: 0.15, a: 0.005, d: 0.7, s: 0, r: 0.5, gain: 0.15 },
    perc: 'neon',
    kit: {
      kick: { f0: 140, f1: 47, drop: 0.07, tc: 0.1, gain: 0.34 },
      snare: { hp: 800, lp: 5600, tc: 0.08, gain: 0.19 }, body: { f0: 200, f1: 160, drop: 0.05, tc: 0.05, gain: 0.1 },
      hat: { hp: 7000, lp: 10500, tc: 0.018, gain: 0.085, pan: 0.3 },
    },
    texture: 'none',
  },
  // 2048: calm and warm, soft chords and a few bells; it opens up as the tiles grow.
  g2048: {
    tonics: [5, 0, 10, 3], modes: ['lydian', 'ionian', 'mixolydian'], mode0: 0,
    bpm: [72, 80], swing: 0.1, human: 0.01, chordBars: [2, 2, 1], color: 'rich',
    range: { pad: [53, 72], arp: [65, 89], lead: [67, 86], bass: 29 },
    tone: 8000, reverb: { secs: 2.4, damp: 0.1, level: 0.6 }, delay: { beats: 0.75, fb: 0.3, level: 0.45 },
    mix: { pad: [0, 0.3, 0.75, 1], bass: [0.05, 0.3, 0, 1], arp: [0.1, 0.5, 0.3, 1], perc: [0.6, 0.85, 0, 0.8], tex: NO_TEXTURE },
    level: LEVEL,
    sends: { pad: [0.4, 0], bass: [0, 0], arp: [0.5, 0.35], perc: [0.15, 0], tex: [0, 0], sig: [0.5, 0.35] },
    filt: { pad: [650, 2000] },
    pad: { wave: 'soft', det: [-7, 7], a: 1.4, r: 2.4, gain: 0.05 },
    keys: { fm: { ratio: 1, index: 1.1, decay: 0.3, sus: 0.15 }, a: 0.006, d: 2.2, s: 0, r: 0.6, lp: 2600, gain: 0.1 },
    bass: { wave: 'soft', det: [0], lp: 340, lpKey: 1, lpEnv: 1.5, lpDecay: 0.15, a: 0.012, d: 0.7, s: 0.6, r: 0.18, gain: 0.32 },
    bassStyle: 'long',
    arp: { style: 'bells', dens: [0.2, 1],
      inst: { fm: { ratio: 3.5, index: 1.2, decay: 0.4, sus: 0.05 }, a: 0.004, d: 2.2, s: 0, r: 1.4, lp: 5200, gain: 0.13 } },
    lead: { style: 'melody', count: [2, 5], maxLen: 6, dens: [0, 0.8],
      inst: { wave: 'triangle', det: [0], lp: 1500, lpKey: 2, lpEnv: 1.2, lpDecay: 0.08, a: 0.005, d: 0.7, s: 0, r: 0.5, gain: 0.36 } },
    flourish: { fm: { ratio: 1, index: 1.6, decay: 0.25, sus: 0.1 }, a: 0.005, d: 1.6, s: 0, r: 0.8, lp: 3600, gain: 0.2 },
    perc: 'felt',
    kit: { kick: { f0: 95, f1: 48, drop: 0.08, tc: 0.09, gain: 0.32 }, hat: { hp: 4500, lp: 8000, tc: 0.03, gain: 0.07, pan: 0.2, a: 0.008 } },
    texture: 'none',
  },
  // Breakout: bouncy and a little funky, with a swing; the bass jumps like the ball.
  breakout: {
    tonics: [2, 7, 9, 0], modes: ['mixolydian', 'dorian'], mode0: 0,
    bpm: [104, 112], rush: 0.12, swing: 0.14, human: 0.004, chordBars: [1, 2], color: 'open',
    range: { pad: [53, 70], arp: [60, 82], lead: [65, 86], bass: 34 },
    tone: 9000, reverb: { secs: 1.2, damp: 0.15, level: 0.28 }, delay: { beats: 0.5, fb: 0.25, level: 0.35 },
    mix: { pad: [0, 0.3, 0.5, 0.75], bass: [0, 0.2, 0.5, 1], arp: [0.1, 0.45, 0.3, 1], perc: [0.2, 0.5, 0, 1], tex: NO_TEXTURE },
    level: LEVEL,
    sends: { pad: [0.3, 0], bass: [0, 0], arp: [0.15, 0.25], perc: [0.08, 0], tex: [0, 0], sig: [0.3, 0.3] },
    filt: { pad: [800, 2000] },
    pad: { wave: 'soft', det: [-6, 6], a: 0.4, r: 0.9, gain: 0.045 },
    bass: triangle({ lp: 1100, d: 0.15, s: 0.6 }), bassStyle: 'octave',
    arp: { style: 'eighth', dens: [0.15, 0.95], inst: square({ lp: 1800, d: 0.14, gain: 0.085 }) },
    lead: { style: 'melody', count: [3, 5], maxLen: 3, dens: [0.05, 0.9], inst: pulse({ d: 0.18, s: 0.3 }) },
    flourish: pulse({ lp: 3400, d: 0.5, s: 0.3, r: 0.3, gain: 0.14 }),
    perc: 'chip', kit: chipKit({ snare: { hp: 900, lp: 5000, tc: 0.06, gain: 0.17 } }), texture: 'none',
  },
  // Invaders: a dark march, one heavy step per beat; it speeds up as they come down.
  invaders: {
    tonics: [4, 9, 11, 2], modes: ['aeolian', 'phrygian'], mode0: 1,
    bpm: [84, 92], rush: 0.45, swing: 0, human: 0.002, chordBars: [2, 2, 1], color: 'open',
    range: { pad: [48, 67], arp: [69, 91], lead: [64, 81], bass: 28 },
    tone: 8000, reverb: { secs: 3, damp: 0.1, level: 0.5 }, delay: { beats: 0.75, fb: 0.4, level: 0.5 },
    mix: { pad: [0, 0.3, 0.7, 1], bass: [0, 0.15, 0.6, 1], arp: [0.3, 0.7, 0, 0.9], perc: [0.1, 0.4, 0, 1], tex: [0, 1, 0.8, 1] },
    level: LEVEL,
    sends: { pad: [0.4, 0], bass: [0, 0], arp: [0.5, 0.5], perc: [0.2, 0], tex: [0.1, 0], sig: [0.5, 0.4] },
    filt: { pad: [380, 1800] },
    pad: { wave: 'sawtooth', det: [-9, 0, 9], a: 1, r: 2, gain: 0.055 },
    bass: { wave: 'square', det: [0], lp: 260, lpKey: 1.5, lpEnv: 2, lpDecay: 0.08, a: 0.005, d: 0.25, s: 0.5, r: 0.08, gain: 0.26 },
    bassStyle: 'stomp',
    arp: { style: 'bells', dens: [0.2, 1],
      inst: { fm: { ratio: 2, index: 1.6, decay: 0.2, sus: 0.05 }, a: 0.004, d: 1.2, s: 0, r: 0.8, lp: 5000, gain: 0.1 } },
    lead: { style: 'melody', count: [2, 4], maxLen: 8, dens: [-0.4, 0.7], inst: pulse({ a: 0.02, d: 0.8, s: 0.6, r: 0.4, lp: 1800, gain: 0.08 }) },
    flourish: pulse({ lp: 3000, d: 0.6, s: 0.3, r: 0.4, gain: 0.14 }),
    perc: 'march',
    kit: {
      kick: { f0: 120, f1: 44, drop: 0.09, tc: 0.12, gain: 0.34 },
      snare: { hp: 900, lp: 5000, tc: 0.06, gain: 0.16 }, body: { f0: 190, f1: 150, drop: 0.05, tc: 0.045, gain: 0.08 },
      hat: { hp: 6500, lp: 10000, tc: 0.02, gain: 0.06, pan: 0.25 },
    },
    texture: 'rumble',
  },
  // Pac-Man: bright and quick, with a shuffle; the power pill sets everything going.
  pacman: {
    tonics: [0, 5, 7, 10], modes: ['lydian', 'ionian', 'mixolydian'], mode0: 1,
    bpm: [118, 126], rush: 0.2, swing: 0.18, human: 0.003, chordBars: [1, 1, 2], color: 'open',
    range: { pad: [55, 72], arp: [60, 84], lead: [69, 91], bass: 36 },
    tone: 9500, reverb: { secs: 1.1, damp: 0.16, level: 0.25 }, delay: { beats: 0.5, fb: 0.2, level: 0.3 },
    mix: { pad: [0, 0.3, 0.5, 0.7], bass: [0, 0.2, 0.5, 1], arp: [0.2, 0.6, 0.15, 1], perc: [0.2, 0.5, 0, 1], tex: NO_TEXTURE },
    level: LEVEL,
    sends: { pad: [0.25, 0], bass: [0, 0], arp: [0.15, 0.2], perc: [0.08, 0], tex: [0, 0], sig: [0.3, 0.25] },
    filt: { pad: [900, 2200] },
    pad: { wave: 'triangle', det: [-5, 5], a: 0.3, r: 0.8, gain: 0.04 },
    bass: triangle({ d: 0.15, s: 0.6 }), bassStyle: 'walk',
    arp: { style: 'sixteenth', dens: [0, 0.9], inst: square({ lp: 2400, d: 0.1, gain: 0.07 }) },
    lead: { style: 'melody', count: [5, 8], maxLen: 3, dens: [0, 1], inst: pulse({ d: 0.16, s: 0.35, gain: 0.11 }) },
    flourish: pulse({ lp: 3600, d: 0.4, s: 0.3, r: 0.25, gain: 0.14 }),
    perc: 'chip', kit: chipKit(), texture: 'none',
  },
});
export const GAME_THEME_IDS = Object.freeze(Object.keys(GAME_THEMES));

// ---- What the music does with what happens in a game ----
// The intensity is `base` at the start of a game and `base + span` when it is at its hardest; on top of it, each lively
// moment adds some heat that fades in a few seconds. lost: the game has no effect of its own for losing, so its end
// without a record is the bad moment (2048: no move left).
const SHAPE = {
  snake: { base: 0.3, span: 0.6 }, tetris: { base: 0.35, span: 0.55 }, chess: { base: 0.15, span: 0.5 }, runner: { base: 0.55, span: 0.4 },
  g2048: { base: 0.2, span: 0.6, lost: true }, breakout: { base: 0.4, span: 0.5 }, invaders: { base: 0.35, span: 0.6 }, pacman: { base: 0.4, span: 0.4 },
};
export const OVER_LEVEL = 0.1; // a game that is over: the music stays, almost bare, until another one starts
export const HEAT_MAX = 0.3;
export const HEAT_S = 3; // the heat's fall, seconds (time constant)
export const CADENCE_S = 6; // between two flourishes, so a good run is not one cadence after another
export const TENSION_S = 3; // between two dark moments
export const POWER_S = 6; // Pac-Man's power pill

// How far a count has come towards «a lot»: 0 at none, 0.63 at `scale`, never quite 1.
const towards = (count, scale) => 1 - Math.exp(-count / scale);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const GOOD = 'success'; const SOFT = 'agent-done'; const BAD = 'error';

// Each rule: what the event does to the mood `m` (m.n counts, m.far sets how far the game has come, m.heat adds heat)
// and the signal it asks for, if any. `arg` is the sound effect's own argument (games/sfx.js).
const RULES = {
  'snake.eat': (m, eaten) => { const n = Number(eaten) || m.n('eaten'); m.far(towards(n, 18)); m.heat(0.12); return n % 10 === 0 ? GOOD : n % 5 === 0 ? SOFT : null; },
  'snake.crash': () => BAD,

  'tetris.lines': (m, rows) => { const k = Math.min(4, Math.max(1, Number(rows) || 1)); m.far(towards(m.n('lines', k), 40)); m.heat(0.08 * k); return k === 4 ? GOOD : null; },
  'tetris.level': () => GOOD,
  'tetris.drop': (m) => { m.heat(0.03); },
  'tetris.top': () => BAD,

  'chess.move': (m) => { m.far(towards(m.n('moves'), 50)); },
  'chess.capture': (m) => { m.far(towards(m.n('moves', 3), 50)); m.heat(0.15); },
  'chess.castle': (m) => { m.far(towards(m.n('moves'), 50)); return SOFT; },
  'chess.promo': () => GOOD,
  'chess.check': (m) => { m.heat(0.25); return BAD; },
  'chess.win': () => GOOD,
  'chess.lose': () => BAD,
  'chess.draw': () => SOFT,

  'runner.jump': (m) => { m.heat(0.03); },
  'runner.pad': (m) => { m.heat(0.08); },
  'runner.orb': (m) => { m.heat(0.08); },
  'runner.flip': (m) => { m.heat(0.1); },
  'runner.checkpoint': (m) => { m.far(towards(m.n('sections'), 3)); return SOFT; },
  // Back to the start of the level: what had been gained is lost.
  'runner.dead': (m) => { m.reset(); return BAD; },
  'runner.done': () => GOOD,

  'g2048.merge': (m, top) => {
    const v = Number(top) || 0, before = m.count.top || 0;
    m.far(clamp01((Math.log2(Math.max(4, v)) - 2) / 9)); m.heat(0.04);
    if (v <= before) return null;
    m.count.top = v;
    return v >= 512 ? GOOD : v >= 128 ? SOFT : null;
  },
  'g2048.win': () => GOOD,

  'breakout.brick': (m) => { m.far(towards(m.n('bricks'), 60)); m.heat(0.06); },
  'breakout.paddle': (m) => { m.heat(0.02); },
  'breakout.wave': () => GOOD,
  'breakout.lose': (m) => { m.cool(); return BAD; },

  // The invaders' own step: the shorter it is, the closer they are (about 0.8 s between steps at first, 0.1 s at the end).
  'inv.march': (m, step) => { m.far(clamp01((800 - (Number(step?.ms) || 800)) / 700), true); },
  'inv.kill': (m) => { m.heat(0.05); },
  'inv.ufo': (m) => { m.heat(0.02); },
  'inv.ufoHit': (m) => { m.heat(0.2); return SOFT; },
  'inv.wave': () => GOOD,
  'inv.hit': (m) => { m.cool(); return BAD; },

  'pac.waka': (m) => { m.far(towards(m.n('dots'), 150)); },
  'pac.power': (m) => { m.power(); },
  'pac.ghost': (m) => { m.heat(0.15); },
  'pac.fruit': () => SOFT,
  'pac.clear': () => GOOD,
  'pac.death': (m) => { m.cool(); m.power(0); return BAD; },
};

// now: the clock, in seconds (the tests bring their own).
export function createGameMood(game, { now = () => performance.now() / 1000 } = {}) {
  const shape = SHAPE[game] || { base: 0.3, span: 0.5 };
  let far = 0, heat = 0, heatAt = now(), over = false, powerUntil = -Infinity;
  let lastCadence = -Infinity, lastTension = -Infinity;
  const count = {};
  const cooled = () => { const t = now(); heat *= Math.exp(-Math.max(0, t - heatAt) / HEAT_S); heatAt = t; return heat; };
  const m = {
    count,
    n: (key, by = 1) => (count[key] = (count[key] || 0) + by),
    // How far the game has come, 0..1: it only grows, unless the game itself says where it stands (`exact`).
    far: (v, exact = false) => { far = exact ? clamp01(v) : Math.max(far, clamp01(v)); },
    heat: (v) => { heat = Math.min(HEAT_MAX, cooled() + v); },
    cool: () => { cooled(); heat = 0; },
    power: (seconds = POWER_S) => { powerUntil = now() + seconds; },
    reset: () => { far = 0; heat = 0; heatAt = now(); for (const k of Object.keys(count)) delete count[k]; },
  };
  // One flourish or one dark moment at a time: a dark one always passes, and a good one waits its turn.
  const limited = (signal) => {
    const t = now();
    if (signal === BAD) { if (t - lastTension < TENSION_S) return null; lastTension = t; return BAD; }
    if (signal !== GOOD && signal !== SOFT) return null;
    if (t - lastCadence < CADENCE_S) return null;
    lastCadence = t; return signal;
  };
  return {
    game,
    event(name, arg) {
      if (over || !Object.hasOwn(RULES, name) || !String(name).startsWith(`${game === 'invaders' ? 'inv' : game === 'pacman' ? 'pac' : game}.`)) return null;
      return limited(RULES[name](m, arg) ?? null);
    },
    // The game is over: a record is celebrated; then the music stays almost bare.
    end(record = false) {
      if (over) return null;
      over = true; heat = 0; powerUntil = -Infinity; lastCadence = -Infinity;
      return limited(record ? GOOD : shape.lost ? BAD : null);
    },
    level() {
      if (over) return OVER_LEVEL;
      if (now() < powerUntil) return 1;
      return clamp01(shape.base + shape.span * far + cooled());
    },
    state: () => ({ far, heat: cooled(), over, power: now() < powerUntil }),
  };
}
