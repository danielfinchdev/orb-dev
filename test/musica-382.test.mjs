// The music's rules since 3.8.2 (phase 6, item 13): only in the Windows app, the settings it keeps (off by default; the
// games' mute) and the buttons, read as source. Nothing is downloaded any more (3.8.8: Orb makes all its music as it
// plays; test/musica-388.test.mjs and test/musica-juegos-388.test.mjs); what an earlier version downloaded stays where
// it is, read-only for agents.
import { tempHome, ROOT, settingsSource } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ctx } from '../src/platform/context.mjs';
import { validateConfig } from '../src/platform/config.mjs';
import { isOrbData } from '../src/domain/security/guard.mjs';
import { DEFAULT_CONFIG, merge } from '../src/platform/config-file.mjs';
import { METHODS } from '../src/domain/security/permissions.mjs';
import * as shared from '../src/shared/music.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const { DEFAULT_VOLUME, DEFAULT_INTENSITY, musicAllowed, musicPrefs, gameMusicOn } = shared;
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

test('the music plays only in the Windows app', () => {
  assert.equal(musicAllowed({ desktop: true, platform: 'win32' }), true);
  assert.equal(musicAllowed({ mobile: true, platform: 'android' }), false, 'the Android app');
  assert.equal(musicAllowed({ mobile: true, platform: 'web' }), false, 'a phone or a linked browser');
  assert.equal(musicAllowed({ desktop: true, platform: 'linux' }), false);
  assert.equal(musicAllowed(undefined), false);
  const music = read('lib', 'music.js');
  // In every theme: whether it plays depends on the platform alone, never on the look (test/musica-388.test.mjs).
  assert.match(music, /export const available = \(\) => musicAllowed\(\{ mobile: bridge\.mobile, desktop: bridge\.desktop, platform: bridge\.platform \}\) && fullPc\(\);/);
  // Every button and setting hangs from it.
  assert.match(read('components', 'sidebar.jsx'), /\{musicAvailable\(\) \? <MusicButtons \/> : null\}/);
  assert.match(read('games', 'games.jsx'), /\{musicAvailable\(\) \? \(\s*<BubbleTip title=\{t\('games\.music'\)\}/);
  const settings = settingsSource();
  assert.match(settings, /if \(!musicAvailable\(\)\) return null;[\s\S]*<MusicSettings \/>/);
  assert.match(settings, /\{musicAvailable\(\) \? <Setting label=\{t\('about\.music'\)\}/, 'its line in «Acerca de»');
});

test('off by default, a soft volume and the games\' mute remembered', () => {
  const adaptive = { theme: 'bruma', reactive: true, intensity: DEFAULT_INTENSITY }; // test/musica-388.test.mjs
  assert.deepEqual(musicPrefs({}), { on: false, volume: DEFAULT_VOLUME, ...adaptive });
  assert.deepEqual(musicPrefs({ music: { on: true, volume: 3 } }), { on: true, volume: 1, ...adaptive });
  assert.ok(DEFAULT_VOLUME > 0 && DEFAULT_VOLUME <= 0.5);
  assert.equal(gameMusicOn({}), true); assert.equal(gameMusicOn({ gameMusic: false }), false);
  // orb.json takes them and refuses anything else.
  const withUi = (ui) => merge(structuredClone(DEFAULT_CONFIG), { ui });
  validateConfig(withUi({ music: { on: true, volume: 0.4 }, gameMusic: false }));
  assert.throws(() => validateConfig(withUi({ music: { volume: 2 } })), /ui\.music/);
  assert.throws(() => validateConfig(withUi({ music: 'on' })), /ui\.music/);
  assert.throws(() => validateConfig(withUi({ gameMusic: 'no' })), /ui\.gameMusic/);
  // The mute of the games is saved (ui.gameMusic), not kept only for the window.
  const music = read('lib', 'music.js');
  assert.match(music, /export async function setGameMusic\(on, current = null\) \{\n\s+await saveUi\(\{ gameMusic: on \}\);/);
  assert.match(read('games', 'games.jsx'), /onClick=\{\(\) => setGameMusic\(!music, game\)\}/);
});

test('it never starts by itself and stops when Orb locks or hides', () => {
  const music = read('lib', 'music.js');
  // Remembered as on: back only with the first click or key, never at the start.
  assert.match(music, /if \(musicPrefs\(\)\.on && !pending\) \{/);
  assert.match(music, /window\.addEventListener\('pointerdown', pending, true\); window\.addEventListener\('keydown', pending, true\);/);
  assert.doesNotMatch(music, /autoplay/);
  // Locked: everything stops (main.jsx, on 'master:locked'), a game's music too.
  const main = read('main.jsx');
  assert.match(main, /if \(!p\?\.screen\) return;\n\s+pauseAll\(\);/);
  assert.match(music, /export function pauseAll\(\) \{\n\s+disarm\(\);\n\s+stopBackground\(\); stopGameMusic\(\);/);
  // Hidden or minimised: paused, and back when shown.
  assert.match(music, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  // A game's music pauses the background music, which comes back after it.
  assert.match(music, /if \(bgSounding\(\)\) \{ bgPause\(\); bgHeld = true; \}/);
  assert.match(music, /const held = bgHeld; bgHeld = false;\n\s+if \(held && state\.playing && !hidden\) bgResume\(\);/);
});

test('nothing is downloaded any more, and what an earlier version downloaded stays read-only for agents', (t) => {
  const { cleanup } = tempHome(); t.after(cleanup);
  // No track list, no download module, no API method and no text for them.
  for (const gone of ['GAMES', 'TRACKS', 'trackOf', 'gameTrack']) assert.equal(gone in shared, false, gone);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'music.mjs'), 'utf8'), /https?:|sha256|opengameart/i);
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'engine', 'host', 'music.mjs')), false);
  assert.equal(Object.keys(METHODS).some((m) => m.startsWith('music.')), false, 'the window asks the engine for no music');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src', 'engine', 'api', 'index.mjs'), 'utf8'), /musicMethods|host\/music/);
  for (const [lang, texts] of [['es', es], ['en', en]]) {
    for (const key of Object.keys(texts)) assert.doesNotMatch(key, /^sys\.music\.|^about\.music(Track|Summary)$/, `${lang}: ${key}`);
  }
  // The window plays no file: no audio element and no request for one.
  const music = read('lib', 'music.js');
  assert.doesNotMatch(music, /new Audio\(|music\.track|createObjectURL|fetch\(/);
  assert.doesNotMatch(settingsSource(), /MUSIC_CREDITS|TRACKS|about\.musicTrack/);
  // The folder an earlier version filled is not touched by Orb, and agents still cannot write there.
  const file = path.join(ctx.paths.tools, 'musica', 'junkala-level1.mp3');
  assert.equal(isOrbData(file, ctx.paths.internal, null), true);
  assert.equal(isOrbData(file, ctx.paths.internal, null, { read: true }), false);
});
