// the music Orb can play on Windows: background music for studying or coding (the play / pause button at the foot
// of the sidebar) and each minigame's own. Orb makes all of it as it plays, so there is no file to download, pin or
// credit. The games' themes are with the engine's code (src/ui/lib/game-music.js), loaded when a game plays.

// The adaptive music (src/ui/lib/adaptive-music.js): Orb makes it as it plays, so it has no file, pin or licence, and
// it needs no network. Its themes by id, in the order the «next» button goes through them; their names are interface
// texts (music.theme.<id>). The engine's own list must stay the same as this one (test/musica-388.test.mjs).
export const ADAPTIVE_THEMES = Object.freeze(['bruma', 'neon', 'marfil', 'orbita']);

// The volume the background music starts at (0..1): soft, under the voice of a video call or the agents' sounds.
export const DEFAULT_VOLUME = 0.35;
// How lively the adaptive music is when it does not follow the activity (0 calm .. 1 everything playing).
export const DEFAULT_INTENSITY = 0.35;

// Only the Windows app plays music: never a phone, the Android app or a linked browser. b: the window's bridge.
export const musicAllowed = (b) => Boolean(b && !b.mobile && b.desktop === true && b.platform === 'win32');
// ui.music of orb.json: { on (off by default), volume (0..1), theme (ADAPTIVE_THEMES), reactive (the adaptive music
// follows the activity; true unless turned off), intensity (0..1, used when it does not) }. Any other key a profile
// carries (the source and track an earlier version saved) is ignored: it plays the adaptive music, keeping the rest.
const unit = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
export function musicPrefs(ui = {}) {
  const m = ui?.music ?? {};
  return {
    on: m.on === true, volume: unit(m.volume, DEFAULT_VOLUME), theme: ADAPTIVE_THEMES.includes(m.theme) ? m.theme : ADAPTIVE_THEMES[0],
    reactive: m.reactive !== false, intensity: unit(m.intensity, DEFAULT_INTENSITY)
  };
}
// The games' music is on unless muted (ui.gameMusic === false).
export const gameMusicOn = (ui = {}) => ui?.gameMusic !== false;
// An entry of a list a number of steps from this one, starting again at the other end (a loop).
const around = (list, at, step) => list[(Math.max(0, at) + step + list.length) % list.length];
// The adaptive theme after this one and the one before, in a loop.
export const nextTheme = (id) => ADAPTIVE_THEMES[(ADAPTIVE_THEMES.indexOf(id) + 1) % ADAPTIVE_THEMES.length];
export const previousTheme = (id) => around(ADAPTIVE_THEMES, ADAPTIVE_THEMES.indexOf(id), -1);
