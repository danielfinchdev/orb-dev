// 3.8.2 (item 13): the music of the Windows app. Background music for studying or coding (the button at the foot of the
// sidebar) and one track per minigame (src/ui/games/games.jsx). The tracks and their licences are src/core/music.mjs;
// the engine downloads each the first time it is played and hands its bytes over ('music.track', src/engine/music.mjs).
//
// - Only on the Windows app: never on the phone or in a linked browser (available()).
// - Off by default and never starts by itself: it plays after a click. Whether it was on is remembered (ui.music.on);
//   on the next start it comes back with the first click or key in the window, not before.
// - Everything pauses when Orb locks (pauseAll, from main.jsx) and while the window is hidden or minimised (it comes
//   back when the window is shown, only if it was playing). A game's music pauses the background music meanwhile.
// - Nothing runs while it is off: no element, no timer, no listener but visibilitychange.
import { bridge, call, getState, setState, fullPc } from './store.js';
import { musicAllowed, musicPrefs as prefsOf, gameMusicOn as gameOnOf, nextTrack, gameTrack } from '../../core/music.mjs';

export const available = () => musicAllowed({ mobile: bridge.mobile, desktop: bridge.desktop, platform: bridge.platform }) && fullPc();
const ui = () => getState().app?.config?.ui ?? {};
export const musicPrefs = () => prefsOf(ui());
const gameMusicOn = () => gameOnOf(ui());

// Saved in orb.json (config.save merges ui), and in the store at once.
async function saveUi(patch) {
  const app = getState().app;
  if (app?.config) setState({ app: { ...app, config: { ...app.config, ui: { ...app.config.ui, ...patch } } } });
  try { const config = await call('config.save', { patch: { ui: patch } }); if (config) setState({ app: { ...getState().app, config } }); } catch { /* kept for this session */ }
}

// ---- What the button shows, for components (useMusic in the sidebar). ----
let state = { playing: false, loading: false, error: null, track: null };
const subs = new Set();
const emit = (patch) => { state = { ...state, ...patch }; for (const fn of subs) fn(state); };
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const musicState = () => state;

// ---- The tracks' bytes, as object URLs (the last few kept). ----
const urls = new Map();
async function urlOf(id, request = call) {
  if (urls.has(id)) return urls.get(id);
  const r = await request('music.track', { id });
  const bin = atob(r.data); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
  urls.set(id, url);
  while (urls.size > 3) { const [old, u] = urls.entries().next().value; URL.revokeObjectURL(u); urls.delete(old); }
  return url;
}

// Two players at most, made when first needed: the background and a game.
let bg = null; let game = null;
let bgHeld = false; // the background paused for a game, to come back after it
let hidden = false; // paused because the window is hidden or minimised
let pending = null; // the first click or key that brings back the music remembered as on
const player = (loop) => { const a = new Audio(); a.preload = 'auto'; a.loop = loop; return a; };

async function playBackground(id) {
  emit({ loading: true, error: null, track: id });
  try {
    const url = await urlOf(id);
    bg ??= player(false);
    if (!bg.onended) bg.onended = () => { const next = nextTrack(state.track); saveUi({ music: { ...musicPrefs(), track: next } }); playBackground(next); };
    bg.volume = musicPrefs().volume;
    if (bg.src !== url) bg.src = url;
    if (game && !game.paused) { bgHeld = true; emit({ loading: false, playing: true }); return; }
    await bg.play();
    emit({ loading: false, playing: true });
  } catch (error) {
    emit({ loading: false, playing: false, error: error?.message || String(error) });
  }
}

// The button: play or pause. The choice is remembered (ui.music.on).
export async function toggleMusic() {
  if (!available()) return;
  disarm();
  const prefs = musicPrefs();
  if (state.playing || state.loading) { bg?.pause(); bgHeld = false; emit({ playing: false, loading: false }); await saveUi({ music: { ...prefs, on: false } }); return; }
  saveUi({ music: { ...prefs, on: true } });
  await playBackground(prefs.track);
}
export function skipTrack() { if (available() && state.playing) { const next = nextTrack(state.track); saveUi({ music: { ...musicPrefs(), track: next } }); playBackground(next); } }
export function setMusicVolume(volume, { save = false } = {}) {
  const v = Math.min(1, Math.max(0, Number(volume) || 0));
  if (bg) bg.volume = v;
  if (save) saveUi({ music: { ...musicPrefs(), volume: v } });
}

// ---- A game's music (games.jsx): started when a game starts, stopped when it ends or the dialog closes. ----
export async function startGameMusic(id) {
  stopGameMusic();
  const t = gameTrack(id);
  if (!available() || !t || !gameMusicOn()) return;
  try {
    const url = await urlOf(t.id);
    game ??= player(true);
    game.volume = Math.min(1, musicPrefs().volume + 0.1);
    game.src = url;
    if (bg && !bg.paused) { bg.pause(); bgHeld = true; }
    if (!hidden) await game.play();
  } catch { /* no music for this game: it plays without */ }
}
export function stopGameMusic() {
  if (game) { game.pause(); game.removeAttribute('src'); game.load(); }
  if (bgHeld && bg && state.playing && !hidden) bg.play().catch(() => {});
  bgHeld = false;
}
export async function setGameMusic(on, current = null) {
  await saveUi({ gameMusic: on });
  if (!on) stopGameMusic(); else if (current) startGameMusic(current);
}

// ---- Locking, hiding and the start. ----
// Orb locked: everything stops and stays stopped (it never starts again by itself).
export function pauseAll() {
  disarm();
  bg?.pause(); game?.pause(); bgHeld = false; hidden = false; resume = null;
  if (state.playing || state.loading) emit({ playing: false, loading: false });
}
let resume = null; // what was playing when the window was hidden
function onVisibility() {
  if (document.hidden) {
    resume = { bg: Boolean(bg && !bg.paused), game: Boolean(game && !game.paused) };
    hidden = resume.bg || resume.game;
    if (hidden) { bg?.pause(); game?.pause(); }
  } else if (hidden) {
    hidden = false;
    if (resume?.game) game?.play().catch(() => {});
    if (resume?.bg && state.playing) bg?.play().catch(() => {});
    resume = null;
  }
}
function disarm() { if (pending) { window.removeEventListener('pointerdown', pending, true); window.removeEventListener('keydown', pending, true); pending = null; } }
// At the start (main.jsx, once the app is on screen): music remembered as on comes back with the first click or key.
export function startMusic() {
  if (!available()) return () => {};
  document.addEventListener('visibilitychange', onVisibility);
  if (musicPrefs().on && !pending) {
    // The music button itself is not that first click: it does its own (toggleMusic).
    pending = (e) => { if (e.target?.closest?.('[data-music-button]')) return; disarm(); if (!state.playing && !state.loading) playBackground(musicPrefs().track); };
    window.addEventListener('pointerdown', pending, true); window.addEventListener('keydown', pending, true);
  }
  return () => { disarm(); document.removeEventListener('visibilitychange', onVisibility); };
}
