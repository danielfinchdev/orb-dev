// The adaptive music: background music Orb makes as it plays (src/ui/lib/adaptive-music.js), which follows what
// happens in the window. Its settings, the engine driven with a fake audio context (no sound is checked, only that it
// runs, reacts and lets go), the signals and their limits, and the rules the player keeps, read as source: it never
// starts by itself, it stops with the lock, it pauses when hidden and nothing of it runs while the music is off.
import { ROOT, settingsSource } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateConfig } from '../src/platform/config.mjs';
import { DEFAULT_CONFIG, merge } from '../src/platform/config-file.mjs';
import { ADAPTIVE_THEMES, MUSIC_MODES, DEFAULT_INTENSITY, DEFAULT_VOLUME, BACKGROUND, musicPrefs, nextTheme, previousTheme, nextTrack, previousTrack } from '../src/shared/music.mjs';
import { THEME_IDS, SIGNALS, createAdaptiveMusic } from '../src/ui/lib/adaptive-music.js';
import { createSignals, isTyping, levelOf, TYPING_MS, EVENT_MS, IDLE_MS, WORKING_MS, LEVEL_MS } from '../src/ui/lib/music-signals.js';
import { textMood, chatMood, waitsForUser } from '../src/ui/lib/chat-mood.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

// A stand-in for Web Audio: every node and parameter takes any call, the clock is the test's. Nothing is rendered.
function fakeContext({ sampleRate = 8000 } = {}) {
  const calls = { nodes: 0, suspend: 0, resume: 0, close: 0 };
  const param = () => { const p = { value: 0 }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; return p; };
  const METHODS = new Set(['connect', 'disconnect', 'start', 'stop', 'setPeriodicWave', 'getFloatTimeDomainData', 'addEventListener', 'removeEventListener']);
  const node = () => new Proxy({}, {
    get(t, k) { if (k in t || typeof k === 'symbol' || k === 'then') return t[k]; t[k] = METHODS.has(k) ? () => {} : param(); return t[k]; },
    set(t, k, v) { t[k] = v; return true; }
  });
  const ctx = {
    currentTime: 0, sampleRate, state: 'running', destination: node(),
    createBuffer: (channels, length, rate) => { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { length, sampleRate: rate, duration: length / rate, numberOfChannels: channels, getChannelData: (ch) => data[ch] }; },
    createPeriodicWave: () => ({}),
    resume() { calls.resume++; ctx.state = 'running'; return Promise.resolve(); },
    suspend() { calls.suspend++; ctx.state = 'suspended'; return Promise.resolve(); },
    close() { calls.close++; ctx.state = 'closed'; return Promise.resolve(); }
  };
  return { calls, ctx: new Proxy(ctx, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('create')) return () => { calls.nodes++; return node(); }; return undefined; }, set(t, k, v) { t[k] = v; return true; } }) };
}
// Runs the engine's scheduler for `seconds` of the audio clock, as its own timer does (every 50 ms).
function run(music, ctx, seconds, each = () => {}) {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end) { ctx.currentTime += 0.05; each(ctx.currentTime); music._tick(ctx.currentTime); }
}

test('its settings: adaptive by default, a theme, whether it reacts and an intensity for when it does not', () => {
  assert.deepEqual(MUSIC_MODES, ['adaptive', 'tracks']);
  assert.deepEqual(musicPrefs({}), { on: false, volume: DEFAULT_VOLUME, track: BACKGROUND[0].id, mode: 'adaptive', theme: ADAPTIVE_THEMES[0], reactive: true, intensity: DEFAULT_INTENSITY });
  assert.deepEqual(musicPrefs({ music: { mode: 'tracks', theme: 'orbita', reactive: false, intensity: 0.8 } }), { on: false, volume: DEFAULT_VOLUME, track: BACKGROUND[0].id, mode: 'tracks', theme: 'orbita', reactive: false, intensity: 0.8 });
  // Anything else is read as the default, never passed on to the engine.
  const odd = musicPrefs({ music: { mode: 'radio', theme: '__proto__', reactive: 'no', intensity: 7 } });
  assert.equal(odd.mode, 'adaptive'); assert.equal(odd.theme, 'bruma'); assert.equal(odd.reactive, true); assert.equal(odd.intensity, 1);
  assert.equal(musicPrefs({ music: { intensity: NaN } }).intensity, DEFAULT_INTENSITY);
  assert.ok(DEFAULT_INTENSITY > 0 && DEFAULT_INTENSITY < 0.6, 'calm unless asked otherwise');
  // The «next» button goes through the themes and starts again.
  assert.equal(nextTheme('bruma'), 'neon'); assert.equal(nextTheme(ADAPTIVE_THEMES.at(-1)), ADAPTIVE_THEMES[0]); assert.equal(nextTheme('nope'), ADAPTIVE_THEMES[0]);
  // orb.json takes them and refuses anything else.
  const withUi = (ui) => merge(structuredClone(DEFAULT_CONFIG), { ui });
  validateConfig(withUi({ music: { on: true, mode: 'adaptive', theme: 'marfil', reactive: false, intensity: 0.5 } }));
  validateConfig(withUi({ music: { mode: 'tracks' } }));
  for (const bad of [{ mode: 'radio' }, { theme: 'jazz' }, { reactive: 1 }, { intensity: 2 }, { intensity: '0.5' }]) assert.throws(() => validateConfig(withUi({ music: bad })), /ui\.music/, JSON.stringify(bad));
});

test('the engine has the themes the settings offer, and every one has its name in both languages', () => {
  assert.deepEqual([...THEME_IDS], [...ADAPTIVE_THEMES], 'src/shared/music.mjs and the engine list the same themes');
  assert.deepEqual([...SIGNALS], ['idle', 'typing', 'agent-working', 'agent-done', 'error', 'success']);
  for (const dict of [es, en]) {
    for (const id of ADAPTIVE_THEMES) { assert.ok(dict[`nav.musicTheme.${id}`], id); assert.ok(dict[`appearance.musicTheme.${id}`], id); }
    for (const mode of MUSIC_MODES) { assert.ok(dict[`appearance.musicMode.${mode}`], mode); assert.ok(dict[`appearance.musicModeHint.${mode}`], mode); }
  }
  // Its interface texts live in the locales, not in the engine.
  assert.doesNotMatch(read('lib', 'adaptive-music.js'), /[áéíóúñ¿¡]/i);
});

test('the engine makes no sound and no audio context until it is started, and lets everything go', async () => {
  const { ctx, calls } = fakeContext();
  const music = createAdaptiveMusic({ theme: 'bruma', seed: 'test', volume: 0.4, context: ctx, autoPause: false });
  assert.equal(calls.nodes, 0, 'nothing is built before start()');
  assert.equal(music.getState().playing, false);
  music.setVolume(0.2); music.setTheme('neon'); music.setIntensity(0.5); assert.equal(music.signal('typing'), true, 'harmless before it starts');
  assert.equal(calls.nodes, 0);
  music.start();
  assert.ok(calls.nodes > 10, 'the master bus and the first theme');
  assert.deepEqual({ playing: music.getState().playing, theme: music.getState().theme }, { playing: true, theme: 'neon' });
  music.pause(); assert.equal(music.getState().state, 'paused');
  music.start(); await new Promise((r) => setImmediate(r)); // start() resumes a paused engine
  assert.equal(music.getState().state, 'playing');
  music.stop(); assert.equal(music.getState().state, 'stopped');
  music.start(); assert.equal(music.getState().state, 'playing', 'it plays again after a stop');
  music.destroy();
  assert.equal(music.getState().state, 'stopped');
  assert.equal(calls.close, 0, 'a context passed in is the caller\'s to close (lib/music.js closes it)');
  assert.equal(music.signal('nope'), false);
});

test('every theme plays for minutes through every signal without piling up voices', () => {
  for (const theme of ADAPTIVE_THEMES) {
    const { ctx } = fakeContext();
    const music = createAdaptiveMusic({ theme, seed: `seed-${theme}`, volume: 0.5, context: ctx, autoPause: false });
    music.start();
    let most = 0;
    // Four minutes: typing, an agent's turn with an error in it, its end, a success, a change of theme and calm.
    run(music, ctx, 240, (now) => {
      const s = Math.round(now * 20);
      if (now > 10 && now < 40 && s % 3 === 0) music.signal('typing');
      if (s === 60 * 20) music.signal('agent-working');
      if (s === 90 * 20) music.signal('error');
      if (s === 120 * 20) music.signal('agent-done');
      if (s === 150 * 20) music.signal('success');
      if (s === 170 * 20) music.setTheme(nextTheme(theme));
      if (s === 200 * 20) music.signal('idle');
      most = Math.max(most, music.getState().voices);
    });
    const st = music.getState();
    assert.ok(most > 0 && most <= 26, `${theme}: at most 26 voices at once (${most})`);
    assert.equal(st.theme, nextTheme(theme));
    assert.ok(st.bpm >= 40 && st.bpm <= 110 && st.bar > 10, `${theme}: it keeps playing (${st.bpm} bpm, bar ${st.bar})`);
    assert.ok(Number.isFinite(st.intensity) && st.intensity >= 0 && st.intensity <= 1, theme);
    music.destroy();
  }
});

test('the intensity follows the signals: up with typing and work, back to calm afterwards, or fixed by hand', () => {
  const { ctx } = fakeContext();
  const music = createAdaptiveMusic({ theme: 'marfil', seed: 'signals', context: ctx, autoPause: false });
  music.start();
  run(music, ctx, 5);
  const calm = music.getState().intensity;
  assert.ok(calm < 0.1, `calm at the start (${calm})`);
  run(music, ctx, 10, () => music.signal('typing'));
  const typing = music.getState().intensity;
  assert.ok(typing > 0.4 && typing <= 0.7, `typing lifts it, with a ceiling (${typing})`);
  music.signal('agent-working'); run(music, ctx, 15);
  const working = music.getState().intensity;
  assert.ok(working > 0.7 && music.getState().working, `an agent working holds it high (${working})`);
  music.signal('agent-done'); assert.equal(music.getState().working, false);
  music.signal('idle'); run(music, ctx, 45);
  assert.ok(music.getState().intensity < 0.1, `and it comes back to calm (${music.getState().intensity})`);
  // «Música que reacciona» off: the intensity of Ajustes, whatever happens.
  music.setIntensity(0.35); music.signal('agent-working'); run(music, ctx, 30);
  assert.ok(Math.abs(music.getState().intensity - 0.35) < 0.02, `fixed by hand (${music.getState().intensity})`);
  music.setIntensity(null); run(music, ctx, 15);
  assert.ok(music.getState().intensity > 0.7, 'and the signals lead again');
  music.destroy();
});

test('the same seed gives the same music, another seed another one', () => {
  const play = (seed) => {
    const { ctx } = fakeContext();
    const music = createAdaptiveMusic({ theme: 'bruma', seed, context: ctx, autoPause: false });
    music.start();
    const heard = [];
    run(music, ctx, 60, () => { const s = music.getState(); if (heard.at(-1) !== `${s.key}/${s.chord}`) heard.push(`${s.key}/${s.chord}`); });
    const out = `${music.getState().bpm} ${heard.join(' ')}`;
    music.destroy();
    return out;
  };
  assert.equal(play('a'), play('a'));
  assert.notEqual(play('a'), play('b'));
});

test('typing is a key that writes in a text box, never a shortcut nor a password', () => {
  const box = (tagName, extra = {}) => ({ tagName, ...extra });
  assert.equal(isTyping({ key: 'a', target: box('TEXTAREA') }), true);
  assert.equal(isTyping({ key: 'Backspace', target: box('TEXTAREA') }), true);
  assert.equal(isTyping({ key: 'ñ', target: box('DIV', { isContentEditable: true }) }), true);
  assert.equal(isTyping({ key: 'a', target: box('INPUT', { type: 'search' }) }), true);
  assert.equal(isTyping({ key: 'a', target: box('INPUT', { type: 'password' }) }), false, 'a password is not the music\'s business');
  assert.equal(isTyping({ key: 'a', target: box('INPUT', { type: 'range' }) }), false);
  assert.equal(isTyping({ key: 'a', target: box('BUTTON') }), false);
  assert.equal(isTyping({ key: 'ArrowDown', target: box('TEXTAREA') }), false);
  assert.equal(isTyping({ key: 'k', ctrlKey: true, target: box('TEXTAREA') }), false, 'a shortcut');
  assert.equal(isTyping({ key: 'a', isComposing: true, target: box('TEXTAREA') }), false);
  assert.equal(isTyping({ key: 'a' }), false); assert.equal(isTyping(null), false);
});

test('the signals are limited: a held key, a burst of notices and many agents are one gesture each', () => {
  let t = 0; const sent = [];
  const signals = createSignals({ send: (s) => sent.push(s), now: () => t });
  const key = { key: 'a', target: { tagName: 'TEXTAREA' } };
  // A key held for a second (thirty repeats): about nine signals.
  for (let i = 0; i < 30; i++) { signals.key(key); t += 33; }
  assert.ok(sent.length >= 8 && sent.length <= 10 && sent.every((s) => s === 'typing'), `${sent.length} typing signals`);
  assert.ok(TYPING_MS >= 60 && TYPING_MS <= 200);
  // Bad and good news: each at most once in a while, one never hiding the other.
  sent.length = 0;
  signals.mood('worried'); signals.mood('worried'); signals.mood('happy'); signals.mood('happy'); signals.mood('talking');
  assert.deepEqual(sent, ['error', 'success']);
  t += EVENT_MS; signals.mood('worried');
  assert.deepEqual(sent, ['error', 'success', 'error']);
  // Agents: told when one starts, again now and then while it goes on, and once when the last one ends.
  sent.length = 0;
  for (let i = 0; i < 12; i++) { signals.tick(true); t += 1000; }
  assert.deepEqual(sent, ['agent-working', 'agent-working', 'agent-working'], `again every ${WORKING_MS} ms`);
  signals.tick(false); signals.tick(false);
  assert.deepEqual(sent.slice(3), ['agent-done']);
  // Nothing for a while: idle, once, until something happens again.
  sent.length = 0;
  t += IDLE_MS - 1; signals.tick(false); assert.deepEqual(sent, []);
  t += 1; signals.tick(false); t += IDLE_MS; signals.tick(false);
  assert.deepEqual(sent, ['idle']);
  signals.active(); t += IDLE_MS; signals.tick(false);
  assert.deepEqual(sent, ['idle', 'idle'], 'a click wakes it, and it can go idle again');
  // A key that writes nothing (a shortcut) still counts as the user being there.
  sent.length = 0; t += IDLE_MS - 10; signals.key({ key: 'F5', target: { tagName: 'BODY' } }); t += 20; signals.tick(false);
  assert.deepEqual(sent, []);
});

test('good and bad news are read from the mark the engine starts a chat line with', () => {
  assert.equal(textMood('✅ Tarea terminada'), 'happy'); assert.equal(textMood('👍 Hecho'), 'happy');
  assert.equal(textMood('❌ Falló la tarea'), 'worried'); assert.equal(textMood('⚠️ Sin conexión'), 'worried');
  assert.equal(textMood('Hola'), 'talking'); assert.equal(textMood(null), 'talking');
  // Something that waits for the user worries the robot, but it is not a failure: the music plays no error for it.
  const approval = { body: 'Aprueba el plan', meta: { kind: 'approval' } };
  assert.equal(waitsForUser(approval), true); assert.equal(chatMood(approval), 'worried'); assert.equal(textMood(approval.body), 'talking');
  assert.equal(chatMood({ body: '✅ Listo' }), 'happy');
  assert.match(read('components', 'companion.jsx'), /const mood = chatMood\(payload\);/, 'the robot reads it the same way');
  assert.match(read('lib', 'music.js'), /bridge\.on\?\.\('chat:new', \(payload\) => signals\.mood\(textMood\(payload\?\.body\)\)\)/);
});

test('the player keeps its rules with the adaptive music: a click starts it, the lock stops it, hidden pauses it', () => {
  const music = read('lib', 'music.js');
  // Loaded only when it first plays: the window's start does not carry the engine.
  assert.match(music, /const \{ createAdaptiveMusic \} = await import\('\.\/adaptive-music\.js'\);/);
  assert.doesNotMatch(music, /^import .*adaptive-music/m);
  // Only where the music is allowed (the Windows app, a theme with music), and only from the button or the first click.
  assert.match(music, /export async function toggleMusic\(\) \{\n\s+if \(!available\(\)\) return;/);
  assert.match(music, /disarm\(\); if \(!state\.playing && !state\.loading\) playNow\(\); \};/);
  assert.equal(music.match(/\bplayAdaptive\(\)/g).length, 2, 'started from one place only (playNow), besides its definition');
  // Its audio context is made without waiting for the output device, and the engine leaves hiding to the player.
  assert.match(music, /quietAudioContext\(\{ latencyHint: 'playback' \}\)/);
  assert.match(music, /context: engineCtx, autoPause: false \}\)/);
  assert.doesNotMatch(music, /new (window\.)?AudioContext/);
  // The lock and the button stop it for good, and its context and listeners go with it.
  assert.match(music, /export function pauseAll\(\) \{\n\s+disarm\(\);\n\s+bg\?\.pause\(\); game\?\.pause\(\); stopBackground\(\);/);
  assert.match(music, /function stopBackground\(\) \{\n\s+runs\+\+;\n\s+bg\?\.pause\(\); stopAdaptive\(\); source = null; bgHeld = false;/);
  assert.match(music, /function stopAdaptive\(\) \{\n\s+stopSignals\?\.\(\); stopSignals = null; stopLevel\(\);\n\s+if \(!engine \|\| letGo\) return;\n\s+engine\.stop\(\);/);
  assert.match(music, /engine\?\.destroy\(\); engine = null;\n\s+engineCtx\?\.close\(\)\.catch\(quiet\); engineCtx = null;/);
  // No theme silences it: it is there in every one and plays only when the user turns it on.
  assert.doesNotMatch(music, /plainSkin|stopIfPlain|onAppearance/);
  // Hidden or minimised: paused, and back when shown. A game holds it meanwhile.
  assert.match(music, /if \(hidden\) \{ bgPause\(\); game\?\.pause\(\); \}/);
  assert.match(music, /const bgPause = \(\) => \{ if \(source === 'adaptive'\) engine\?\.pause\(\); else bg\?\.pause\(\); \};/);
  assert.match(music, /if \(bgSounding\(\)\) \{ bgPause\(\); bgHeld = true; \}/);
  assert.match(music, /if \(game && !game\.paused\) \{ bgHeld = true; return; \}\n\s+engine\.start\(\); catchUp\(\);/, 'never over a game\'s music');
  // It follows the activity only while it plays and reacts: no listener nor timer otherwise.
  assert.match(music, /if \(prefs\.reactive\) stopSignals = follow\(\);/);
  assert.match(music, /if \(engine && source === 'adaptive' && state\.playing && !hidden && !bgHeld\) engine\.signal\(signal\);/);
  assert.equal(music.match(/setInterval\(/g).length, 2, 'the signals and the level'); assert.match(music, /clearInterval\(timer\);/);
  assert.equal(music.match(/addEventListener\('keydown', onKey/g).length, music.match(/removeEventListener\('keydown', onKey/g).length);
  // A start overtaken while it loaded gives up (the button pressed twice, the lock while the engine loads).
  assert.match(music, /const \{ createAdaptiveMusic \} = await import\('\.\/adaptive-music\.js'\);\n\s+if \(run !== runs\) return;/);
});

test('the player is told how far the music has risen, in hundredths and only when it moves', () => {
  // What the player shows: 0..1 in hundredths, so a smaller move draws nothing again.
  assert.equal(levelOf(0), 0); assert.equal(levelOf(1), 1); assert.equal(levelOf(0.4567), 0.46); assert.equal(levelOf(0.004), 0);
  assert.equal(levelOf(-0.2), 0); assert.equal(levelOf(1.7), 1); assert.equal(levelOf(undefined), 0); assert.equal(levelOf(NaN), 0);
  assert.equal(levelOf(0.301), levelOf(0.304), 'a move of less than a hundredth is the same level');
  assert.ok(LEVEL_MS >= 200 && LEVEL_MS <= 500, 'a few times a second, never every bar');
  const music = read('lib', 'music.js');
  // Part of what the button shows (musicState, subscribe); null while the adaptive music is not the one that plays.
  assert.match(music, /let state = \{ playing: false, loading: false, error: null, track: null, theme: null, intensity: null \};/);
  assert.match(music, /emit\(\{ loading: false, playing: true, theme: prefs\.theme, intensity: levelOf\(engine\.getState\(\)\.intensity\) \}\);/);
  // Read on a timer of its own, which lives only while it plays; told only when the level changes; a paused music keeps it.
  assert.match(music, /react\(\); watchLevel\(\);/);
  assert.match(music, /if \(!engine \|\| hidden \|\| bgHeld\) return;\n\s+const intensity = levelOf\(engine\.getState\(\)\.intensity\);\n\s+if \(intensity !== state\.intensity\) emit\(\{ intensity \}\);\n\s+\}, LEVEL_MS\);/);
  assert.match(music, /function stopLevel\(\) \{\n\s+clearInterval\(meter\); meter = null;\n\s+if \(state\.intensity !== null\) emit\(\{ intensity: null \}\);/);
  // Only read: the engine is never told anything from here.
  assert.doesNotMatch(music.slice(music.indexOf('function watchLevel'), music.indexOf('function react')), /engine\.(signal|setIntensity|setTheme|setVolume|start|stop)/);
});

test('Ajustes and the sidebar: the switch, the theme, «Música que reacciona» and the next theme', () => {
  const settings = settingsSource();
  assert.match(settings, /\{musicAvailable\(\) \? <MusicSettings \/> : null\}/);
  for (const id of ['music-on', 'music-mode', 'music-theme', 'music-reactive', 'music-intensity', 'music-volume']) assert.match(settings, new RegExp(`data-testid="${id}"`), id);
  // The switch is the sidebar's button: it shows what plays and goes through the same toggle.
  assert.match(settings, /<Switch checked=\{playing\} onCheckedChange=\{\(\) => toggleMusic\(\)\}/);
  // Only the adaptive music is offered: the source shows when an earlier version left the tracks chosen, to leave them.
  assert.match(settings, /\{prefs\.mode !== 'adaptive' \? \(/);
  assert.match(settings, /MUSIC_MODES\.filter\(\(value\) => value === 'adaptive' \|\| value === prefs\.mode\)/);
  assert.match(settings, /value=\{prefs\.mode\} onValueChange=\{setMusicMode\}/);
  assert.match(settings, /value=\{prefs\.theme\} onValueChange=\{setMusicTheme\}/);
  assert.match(settings, /<Switch checked=\{prefs\.reactive\} onCheckedChange=\{setMusicReactive\}/);
  assert.match(settings, /\{prefs\.reactive \? null : \(/, 'the intensity shows only when it does not react');
  assert.match(settings, /<li data-testid="about-music-adaptive">\{t\('about\.musicAdaptive'\)\}<\/li>/);
  const sidebar = read('components', 'sidebar.jsx');
  assert.match(sidebar, /t\('nav\.musicNowAdaptive', \{ theme: t\(`nav\.musicTheme\.\$\{s\.theme\}`\) \}\)/);
  assert.match(sidebar, /const adaptive = s\.playing \|\| s\.loading \? Boolean\(s\.theme\) : chosen;/, 'what plays; before, what the button would start');
  assert.match(sidebar, /const next = t\(adaptive \? 'nav\.musicNextTheme' : 'nav\.musicNext'\);/);
  const music = read('lib', 'music.js');
  // «Next» and «previous» go through the themes (or the tracks) in both directions.
  assert.match(music, /if \(source === 'adaptive'\) \{ setMusicTheme\(\(back \? previousTheme : nextTheme\)\(musicPrefs\(\)\.theme\)\); return; \}/);
  assert.match(music, /export const skipTrack = \(\) => skip\(false\);\nexport const skipBack = \(\) => skip\(true\);/);
  for (const id of ADAPTIVE_THEMES) assert.equal(previousTheme(nextTheme(id)), id, id);
  assert.equal(previousTheme('bruma'), 'orbita'); assert.equal(previousTheme('nope'), ADAPTIVE_THEMES.at(-1));
  for (const t of BACKGROUND) assert.equal(previousTrack(nextTrack(t.id)), t.id, t.id);
  assert.equal(previousTrack(BACKGROUND[0].id), BACKGROUND.at(-1).id);
  assert.match(music, /if \(was && available\(\)\) \{ stopBackground\(\); playNow\(\); \}/, 'changing the source while it plays goes on with the other');
});

test('the engine is a file of its own in the built window, loaded on demand', { skip: !fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html')) && 'the interface is not built' }, () => {
  const dir = path.join(ROOT, 'src', 'renderer', 'assets');
  const mark = 'orb-noise'; // the seed of the engine's noise buffer: only the engine has it
  const withEngine = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && fs.readFileSync(path.join(dir, f), 'utf8').includes(mark));
  assert.equal(withEngine.length, 1, 'one chunk holds the engine');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(!html.includes(withEngine[0]), 'and the page does not load it at the start');
});
