// 3.8.2, phase 6 (item 13, decision D4): the music. The manifest (every track CC0 with its page, size and SHA-256), the
// download (mocked: never the network) into core\herramientas\musica, read-only for agents, the gating to the Windows
// app, the settings it keeps (off by default; the games' mute) and the buttons, read as source.
import { tempHome, ROOT } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx } from '../src/platform/context.mjs';
import { validateConfig } from '../src/platform/config.mjs';
import { isOrbData } from '../src/core/guard.mjs';
import { DEFAULT_CONFIG, merge } from '../src/platform/config-file.mjs';
import { METHODS } from '../src/core/permissions.mjs';
import { BACKGROUND, GAMES, TRACKS, trackOf, DEFAULT_VOLUME, musicAllowed, musicPrefs, gameMusicOn, nextTrack, gameTrack } from '../src/shared/music.mjs';
import { trackBytes, musicDir, musicMethods } from '../src/engine/music.mjs';

const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const response = (buf, status = 200) => ({ ok: status === 200, status, headers: { get: (h) => (h === 'content-length' ? String(buf.length) : null) }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });

test('every track is pinned and free: CC0, its page, size and SHA-256', () => {
  assert.ok(BACKGROUND.length >= 3 && BACKGROUND.length <= 5, 'three to five background tracks');
  const games = [...read('games', 'games.jsx').matchAll(/\{ id: '([a-z0-9]+)', load:/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(GAMES).sort(), games.sort(), 'one track per minigame');
  for (const t of Object.values(TRACKS)) {
    assert.equal(t.licence, 'CC0 1.0', t.id);
    assert.match(t.page, /^https:\/\/opengameart\.org\/content\/[a-z0-9-]+$/, t.id);
    assert.match(t.url, /^https:\/\/opengameart\.org\/sites\/default\/files\/[^/]+\.(ogg|mp3)$/, t.id);
    assert.match(t.sha256, /^[0-9a-f]{64}$/, t.id);
    assert.ok(Number.isInteger(t.size) && t.size > 100_000 && t.size < 8_000_000, t.id);
    assert.ok(t.title && t.author, t.id);
    assert.equal(t.mime, t.url.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg');
    assert.ok(Object.isFrozen(t));
  }
  assert.equal(trackOf('constructor'), null);
});

test('the music plays only in the Windows app', () => {
  assert.equal(musicAllowed({ desktop: true, platform: 'win32' }), true);
  assert.equal(musicAllowed({ mobile: true, platform: 'android' }), false, 'the Android app');
  assert.equal(musicAllowed({ mobile: true, platform: 'web' }), false, 'a phone or a linked browser');
  assert.equal(musicAllowed({ desktop: true, platform: 'linux' }), false);
  assert.equal(musicAllowed(undefined), false);
  assert.equal(METHODS['music.track'], 'pc', 'never asked by a linked device');
  const music = read('lib', 'music.js');
  assert.match(music, /export const available = \(\) => musicAllowed\(\{ mobile: bridge\.mobile, desktop: bridge\.desktop, platform: bridge\.platform \}\) && fullPc\(\);/);
  // Every button and setting hangs from it.
  assert.match(read('components', 'sidebar.jsx'), /\{musicAvailable\(\) \? <MusicButtons \/> : null\}/);
  assert.match(read('games', 'games.jsx'), /\{musicAvailable\(\) \? \(\s*<BubbleTip title=\{t\('games\.music'\)\}/);
  const settings = read('views', 'settings.jsx');
  assert.match(settings, /\{musicAvailable\(\) \? <MusicVolume \/> : null\}/);
  assert.match(settings, /\{musicAvailable\(\) \? \(\s*<details data-testid="about-music">/, 'the credits in «Acerca de»');
});

test('off by default, a soft volume, the tracks in turn and the games\' mute remembered', () => {
  assert.deepEqual(musicPrefs({}), { on: false, volume: DEFAULT_VOLUME, track: BACKGROUND[0].id });
  assert.deepEqual(musicPrefs({ music: { on: true, volume: 3, track: 'nope' } }), { on: true, volume: 1, track: BACKGROUND[0].id });
  assert.equal(musicPrefs({ music: { track: BACKGROUND[2].id } }).track, BACKGROUND[2].id);
  assert.ok(DEFAULT_VOLUME > 0 && DEFAULT_VOLUME <= 0.5);
  assert.equal(nextTrack(BACKGROUND.at(-1).id), BACKGROUND[0].id, 'the list starts again');
  assert.equal(nextTrack(BACKGROUND[0].id), BACKGROUND[1].id);
  assert.equal(gameMusicOn({}), true); assert.equal(gameMusicOn({ gameMusic: false }), false);
  assert.equal(gameTrack('tetris'), GAMES.tetris); assert.equal(gameTrack('__proto__'), null);
  // orb.json takes them and refuses anything else.
  const withUi = (ui) => merge(structuredClone(DEFAULT_CONFIG), { ui });
  validateConfig(withUi({ music: { on: true, volume: 0.4, track: 'gathu' }, gameMusic: false }));
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
  // Locked: everything pauses (main.jsx, on 'master:locked').
  const main = read('main.jsx');
  assert.match(main, /if \(!p\?\.screen\) return;\n\s+pauseAll\(\);/);
  assert.match(music, /export function pauseAll\(\) \{\n\s+disarm\(\);\n\s+bg\?\.pause\(\); game\?\.pause\(\);/);
  // Hidden or minimised: paused, and back when shown.
  assert.match(music, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  // A game's music pauses the background music, which comes back after it.
  assert.match(music, /if \(bg && !bg\.paused\) \{ bg\.pause\(\); bgHeld = true; \}/);
});

test('a track is downloaded once, checked and kept read-only for agents (mocked)', async (t) => {
  const { cleanup } = tempHome(); t.after(cleanup);
  const bytes = crypto.randomBytes(4096);
  const pin = Object.freeze({ id: 'prueba', title: 'Prueba', mime: 'audio/mpeg', size: bytes.length, sha256: sha(bytes), url: 'https://example.invalid/prueba.mp3' });
  let calls = 0;
  const fetchImpl = async (url) => { calls++; assert.equal(url, pin.url); return response(bytes); };
  // Two players asking at once: one download.
  const [a, b] = await Promise.all([trackBytes('prueba', { fetchImpl, pin }), trackBytes('prueba', { fetchImpl, pin })]);
  assert.ok(a.equals(bytes) && b.equals(bytes)); assert.equal(calls, 1);
  const file = path.join(musicDir(), 'prueba.mp3');
  assert.ok(fs.readFileSync(file).equals(bytes));
  assert.equal(musicDir(), path.join(ctx.paths.tools, 'musica'));
  // Already there: no download.
  await trackBytes('prueba', { fetchImpl, pin }); assert.equal(calls, 1);
  // Changed by someone else: thrown away and downloaded again.
  fs.writeFileSync(file, Buffer.from('otra cosa'));
  assert.ok((await trackBytes('prueba', { fetchImpl, pin })).equals(bytes)); assert.equal(calls, 2);
  // A wrong file or an HTTP error: refused, nothing kept.
  fs.rmSync(file);
  await assert.rejects(trackBytes('prueba', { fetchImpl: async () => response(crypto.randomBytes(4096)), pin }), /no es el esperado/);
  await assert.rejects(trackBytes('prueba', { fetchImpl: async () => response(Buffer.alloc(0), 404), pin }), /HTTP 404/);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(musicDir()), [], 'no half-written file left');
  // Tests never download without their own fetch; an unknown track is refused.
  await assert.rejects(trackBytes('gathu'), /descargas están desactivadas/);
  await assert.rejects(musicMethods()['music.track']({ id: '../../orb.json' }), /no existe/);
  // Read-only for agents: a reading tool may look, nobody writes there.
  assert.equal(isOrbData(file, ctx.paths.internal, null), true);
  assert.equal(isOrbData(file, ctx.paths.internal, null, { read: true }), false);
});

test('the API hands a track over as base64 (mocked)', async (t) => {
  const { cleanup } = tempHome(); t.after(cleanup);
  // A pinned track written as if downloaded: no fetch needed.
  const pinned = trackOf('gathu');
  fs.mkdirSync(musicDir(), { recursive: true });
  const fake = crypto.randomBytes(64);
  fs.writeFileSync(path.join(musicDir(), 'gathu.mp3'), fake);
  // Not the pinned bytes: refused (and, with downloads off in tests, not fetched).
  await assert.rejects(musicMethods()['music.track']({ id: 'gathu' }), /descargas están desactivadas/);
  assert.equal(fs.existsSync(path.join(musicDir(), 'gathu.mp3')), false);
  const fetchImpl = async () => response(fake);
  await assert.rejects(musicMethods({ fetchImpl })['music.track']({ id: 'gathu' }), /no es el esperado/);
  assert.equal(pinned.mime, 'audio/mpeg');
});
