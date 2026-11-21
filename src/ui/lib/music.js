// the music of the Windows app. Background music for studying or coding (the button at the foot of the
// sidebar) and each minigame's own (src/ui/games/games.jsx).
//
// All of it is made by Orb as it plays (lib/adaptive-music.js, loaded the first time any plays): no file and no
// network. The background music follows what happens in the window (lib/music-signals.js): typing, agents working
// and finishing, bad and good news. A game's music has a theme of its own and follows the game (lib/game-music.js).
//
// - Only on the Windows app, in every theme: never on the phone or in a linked browser (available()).
// - Off by default and never starts by itself: it plays after a click. Whether it was on is remembered (ui.music.on);
//   on the next start it comes back with the first click or key in the window, not before.
// - Everything pauses when Orb locks (pauseAll, from main.jsx) and while the window is hidden or minimised (it comes
//   back when the window is shown, only if it was playing). A game's music pauses the background music meanwhile.
// - Nothing runs while it is off: no element, no audio context, no timer, no listener but visibilitychange.
import { bridge, call, getState, setState, fullPc, anyChatBusy } from './store.js';
import { musicAllowed, musicPrefs as prefsOf, gameMusicOn as gameOnOf, nextTheme, previousTheme } from '../../shared/music.mjs';
import { quietAudioContext } from './audio-context.js';
import { createSignals, levelOf, LEVEL_MS } from './music-signals.js';
import { textMood } from './chat-mood.js';
import { quiet } from './quiet.js';

export const available = () => musicAllowed({ mobile: bridge.mobile, desktop: bridge.desktop, platform: bridge.platform }) && fullPc();
function ui() { return getState().app?.config?.ui ?? {}; }
export const musicPrefs = () => prefsOf(ui());
const gameMusicOn = () => gameOnOf(ui());

// Saved in orb.json (config.save merges ui), and in the store at once.
async function saveUi(patch) {
  const app = getState().app;
  if (app?.config) setState({ app: { ...app, config: { ...app.config, ui: { ...app.config.ui, ...patch } } } });
  try { const config = await call('config.save', { patch: { ui: patch } }); if (config) setState({ app: { ...getState().app, config } }); } catch { /* kept for this session */ }
}

// ---- What the button shows, for components (useMusic in the sidebar). ----
// theme: the music's theme, while it plays; intensity: how far it has risen, 0..1 in hundredths (it follows the
// activity, or goes to the intensity chosen), null when it does not play.
let state = { playing: false, loading: false, error: null, theme: null, intensity: null };
const subs = new Set();
const emit = (patch) => { state = { ...state, ...patch }; for (const fn of subs) fn(state); };
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const musicState = () => state;

let source = null; // 'adaptive' while the background music is on, null while it is off
let runs = 0; // a start overtaken while it loaded (stopped, or started again) gives up when it sees another number
let bgHeld = false; // the background paused for a game, to come back after it
let hidden = false; // paused because the window is hidden or minimised
let pending = null; // the first click or key that brings back the music remembered as on

// ---- The adaptive music: one engine with an audio context of its own, made when it plays and let go when it stops. ----
let engine = null; let engineCtx = null;
let letGo = null; // the timer that frees the engine once its stop has faded out
let stopSignals = null; // the listeners that follow the activity, while it reacts to it
let meter = null; // the timer that reads how far the music has risen, while it plays

// The slider's value on the engine's own scale. The engine is mixed to be heard at 0.6: the square root puts the
// slider's default (0.35) there.
const engineVolume = (v) => Math.sqrt(v);
const working = () => { const s = getState(); return anyChatBusy(s) || (s.sessions ?? []).some((x) => x.status === 'running'); };

async function playAdaptive() {
  const run = ++runs;
  source = 'adaptive';
  emit({ loading: true, error: null, theme: musicPrefs().theme });
  try {
    const { createAdaptiveMusic } = await import('./adaptive-music.js');
    if (run !== runs) return;
    const prefs = musicPrefs();
    clearTimeout(letGo); letGo = null;
    if (!engine) {
      // Built without its output device, so the window never waits for the audio service (lib/audio-context.js).
      const made = quietAudioContext({ latencyHint: 'playback' });
      if (!made) throw new Error('Web Audio is not available');
      engineCtx = made.ctx;
      // A seed of its own each time: with a fixed one every day would start with the same bars.
      engine = createAdaptiveMusic({ theme: prefs.theme, seed: `orb-${Date.now()}`, volume: engineVolume(prefs.volume), context: engineCtx, autoPause: false });
    } else { engine.setTheme(prefs.theme); engine.setVolume(engineVolume(prefs.volume)); }
    react(); watchLevel();
    emit({ loading: false, playing: true, theme: prefs.theme, intensity: levelOf(engine.getState().intensity) });
    if (gameOn) { bgHeld = true; return; }
    engine.start(); catchUp();
  } catch (error) {
    if (run === runs) { stopAdaptive(); emit({ loading: false, playing: false, error: error?.message || String(error) }); }
  }
}
function stopAdaptive() {
  stopSignals?.(); stopSignals = null; stopLevel();
  if (!engine || letGo) return;
  engine.stop();
  // Its context and buffers go once the stop has faded out (0.6 s in the engine), unless it plays again first.
  letGo = setTimeout(freeAdaptive, 1000);
}
function freeAdaptive() {
  clearTimeout(letGo); letGo = null;
  engine?.destroy(); engine = null;
  engineCtx?.close().catch(quiet); engineCtx = null;
}
// How far it has risen, for the player: read a few times a second and told only when it has moved by a hundredth, so
// nothing is drawn again while it holds still. A music that is paused (hidden, or held for a game) keeps its level.
function watchLevel() {
  clearInterval(meter);
  meter = setInterval(() => {
    if (!engine || hidden || bgHeld) return;
    const intensity = levelOf(engine.getState().intensity);
    if (intensity !== state.intensity) emit({ intensity });
  }, LEVEL_MS);
}
function stopLevel() {
  clearInterval(meter); meter = null;
  if (state.intensity !== null) emit({ intensity: null });
}
// The adaptive music follows the activity, or keeps the intensity chosen in Ajustes (ui.music.reactive, .intensity).
function react() {
  stopSignals?.(); stopSignals = null;
  if (!engine) return;
  const prefs = musicPrefs();
  engine.setIntensity(prefs.reactive ? null : prefs.intensity);
  if (prefs.reactive) stopSignals = follow();
}
function follow() {
  // Only a music that sounds is told: one paused (hidden, or held for a game) catches up when it comes back.
  const signals = createSignals({ send: (signal) => { if (engine && source === 'adaptive' && state.playing && !hidden && !bgHeld) engine.signal(signal); } });
  const onKey = (e) => signals.key(e);
  const onPointer = () => signals.active();
  window.addEventListener('keydown', onKey, { capture: true, passive: true });
  window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
  const offChat = bridge.on?.('chat:new', (payload) => signals.mood(textMood(payload?.body)));
  const timer = setInterval(() => signals.tick(working()), 1000);
  return () => {
    window.removeEventListener('keydown', onKey, { capture: true }); window.removeEventListener('pointerdown', onPointer, { capture: true });
    if (typeof offChat === 'function') offChat();
    clearInterval(timer);
  };
}
// After a start or a pause the music is told where things stand: what happened meanwhile was not heard.
function catchUp() { if (engine && musicPrefs().reactive) engine.signal(working() ? 'agent-working' : 'idle'); }

const playNow = () => playAdaptive();
const bgSounding = () => Boolean(engine?.getState().playing);
const bgPause = () => { engine?.pause(); };
// start() also resumes a paused engine, and starts one that was held for a game before it ever played.
const bgResume = () => { engine?.start(); catchUp(); };
function stopBackground() {
  runs++;
  stopAdaptive(); source = null; bgHeld = false;
  if (state.playing || state.loading) emit({ playing: false, loading: false });
}

// The button: play or pause. The choice is remembered (ui.music.on).
export async function toggleMusic() {
  if (!available()) return;
  disarm();
  const prefs = musicPrefs();
  if (state.playing || state.loading) { stopBackground(); await saveUi({ music: { ...prefs, on: false } }); return; }
  saveUi({ music: { ...prefs, on: true } });
  await playNow();
}
// The «next» and «previous» buttons: another theme of the adaptive music.
function skip(back) {
  if (!available() || !state.playing) return;
  setMusicTheme((back ? previousTheme : nextTheme)(musicPrefs().theme));
}
export const skipTheme = () => skip(false);
export const skipBack = () => skip(true);
const unit = (v) => Math.min(1, Math.max(0, Number(v) || 0));
export function setMusicVolume(volume, { save = false } = {}) {
  const v = unit(volume);
  engine?.setVolume(engineVolume(v)); gameEngine?.setVolume(engineVolume(v));
  if (save) saveUi({ music: { ...musicPrefs(), volume: v } });
}
// ---- Ajustes › Apariencia. Each is saved (ui.music) and heard at once when the music is playing. ----
export function setMusicTheme(theme) {
  saveUi({ music: { ...musicPrefs(), theme } });
  const now = musicPrefs().theme;
  if (source !== 'adaptive') return;
  engine?.setTheme(now); emit({ theme: now });
}
export function setMusicReactive(reactive) {
  saveUi({ music: { ...musicPrefs(), reactive: Boolean(reactive) } });
  if (source === 'adaptive') { react(); catchUp(); }
}
export function setMusicIntensity(intensity, { save = false } = {}) {
  const v = unit(intensity);
  if (source === 'adaptive' && !musicPrefs().reactive) engine?.setIntensity(v);
  if (save) saveUi({ music: { ...musicPrefs(), intensity: v } });
}

// ---- A game's music (games.jsx): started when a game starts, stopped when the game is left or the dialog closes. ----
// An engine and an audio context of its own, with the game's theme (lib/game-music.js): made when a game starts, let
// go when it stops. The background music waits meanwhile and comes back afterwards.
let gameEngine = null; let gameCtx = null;
let gameOn = false; // a game's music is the one that plays (or would, with the window shown)
let gameMood = null; // what the music does with what happens in the game on screen
let gameRuns = 0; // as `runs`, for a start overtaken while it loaded
let gameLetGo = null; // the timer that frees the engine once its stop has faded out
let gameMeter = null; // the timer that hands the game's intensity to the engine, while it plays

export async function startGameMusic(id) {
  const run = ++gameRuns;
  if (!available() || !gameMusicOn()) { stopGameMusic(); return; }
  try {
    const [{ createAdaptiveMusic }, { GAME_THEMES, createGameMood }] = await Promise.all([import('./adaptive-music.js'), import('./game-music.js')]);
    if (run !== gameRuns) return;
    if (!Object.hasOwn(GAME_THEMES, id)) { stopGameMusic(); return; }
    clearTimeout(gameLetGo); gameLetGo = null;
    const volume = engineVolume(musicPrefs().volume);
    if (!gameEngine) {
      const made = quietAudioContext({ latencyHint: 'playback' });
      if (!made) return;
      gameCtx = made.ctx;
      gameEngine = createAdaptiveMusic({ theme: id, themes: GAME_THEMES, seed: `orb-${id}-${Date.now()}`, volume, context: gameCtx, autoPause: false });
    } else { gameEngine.setTheme(id); gameEngine.setVolume(volume); }
    // A new game: the music starts from its calm again. The same game started again keeps playing, without a cut.
    gameMood = createGameMood(id);
    gameEngine.setIntensity(gameMood.level());
    if (bgSounding()) { bgPause(); bgHeld = true; }
    gameOn = true;
    if (!hidden) gameEngine.start();
    clearInterval(gameMeter);
    gameMeter = setInterval(() => { if (gameEngine && gameMood && !hidden) gameEngine.setIntensity(gameMood.level()); }, LEVEL_MS);
  } catch { /* no music for this game: it plays without */ }
}
export function stopGameMusic() {
  gameRuns++;
  clearInterval(gameMeter); gameMeter = null; gameMood = null; gameOn = false;
  if (gameEngine && !gameLetGo) {
    gameEngine.stop();
    // Its context and buffers go once the stop has faded out, unless another game starts first.
    gameLetGo = setTimeout(freeGame, 1000);
  }
  const held = bgHeld; bgHeld = false;
  if (held && state.playing && !hidden) bgResume();
}
function freeGame() {
  clearTimeout(gameLetGo); gameLetGo = null;
  gameEngine?.destroy(); gameEngine = null;
  gameCtx?.close().catch(quiet); gameCtx = null;
}
// What happens in the game (games/sfx.js › hearGame): the music rises with it, marks the good moments and darkens
// with the bad ones. A music that is paused (hidden) is not told.
function tell(signal) { if (signal && gameEngine && gameOn && !hidden) gameEngine.signal(signal); }
export function gameMusicEvent(name, arg) { if (gameMood) tell(gameMood.event(name, arg)); }
// The game is over (a record or not): the music stays, almost bare, until another game starts or the game is left.
export function endGameMusic(record = false) { if (gameMood) tell(gameMood.end(record)); }
export async function setGameMusic(on, current = null) {
  await saveUi({ gameMusic: on });
  if (!on) stopGameMusic(); else if (current) startGameMusic(current);
}

// ---- Locking, hiding and the start. ----
// Orb locked: everything stops and stays stopped (it never starts again by itself).
export function pauseAll() {
  disarm();
  stopBackground(); stopGameMusic(); hidden = false; resume = null;
}
let resume = null; // what was playing when the window was hidden
function onVisibility() {
  if (document.hidden) {
    resume = { bg: bgSounding(), game: Boolean(gameOn && gameEngine?.getState().playing) };
    hidden = resume.bg || resume.game;
    if (hidden) { bgPause(); gameEngine?.pause(); }
  } else if (hidden) {
    hidden = false;
    if (resume?.game && gameOn) gameEngine?.start();
    if (resume?.bg && state.playing) bgResume();
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
    pending = (e) => { if (e.target?.closest?.('[data-music-button]')) return; disarm(); if (!state.playing && !state.loading) playNow(); };
    window.addEventListener('pointerdown', pending, true); window.addEventListener('keydown', pending, true);
  }
  return () => { disarm(); document.removeEventListener('visibilitychange', onVisibility); };
}
