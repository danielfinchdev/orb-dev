// The mini-games' music in the real Orb on Tauri (its test build, window hidden: test/fixtures/launch-orb.mjs), with
// fake agents and a throwaway workspace:  npm run tauri:build:e2e && node test/musica-juegos-388.e2e.mjs
// The volume is set to zero first, so nothing sounds on the PC that runs it; the page's audio contexts are watched
// instead. Checked: a game's music is made by the engine (its own audio context, running while the game is open) and
// nothing is downloaded (no audio element, no request, no file, no API for one); it starts with the game and never
// before; the game's own music button; it stops when the game is left and when the window closes; the background
// music waits for it and comes back; and the lock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { throughStart, sandboxEnv } from './fixtures/e2e-flows.mjs';
import { launchOrb } from './fixtures/launch-orb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-e2e-musica-juegos-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
process.on('unhandledRejection', (e) => { if (/No dialog is showing/.test(String(e?.message))) return; console.error(e); process.exitCode = 1; });

const orb = await launchOrb({ userData: path.join(tmp, 'datos-app'), env: { ...sandboxEnv(tmp), ORB_DEFAULT_BASE: base, ORB_FAKE_AGENTS: path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs') } });
const page = orb.page;
const errors = [];
const requests = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('request', (r) => requests.push(r.url()));
const step = (text) => console.log(`· ${text}`);
const closeSettings = async () => {
  const dialog = page.locator('[data-testid=settings-dialog]');
  for (let i = 0; i < 4 && await dialog.count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await dialog.waitFor({ state: 'detached' });
};
const until = async (fn, what, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`no llegó: ${what}`); await page.waitForTimeout(150); } };
// Every folder under the throwaway profile with that name (the tracks an earlier version downloaded went to …\herramientas\musica).
const foldersNamed = (name, dir = tmp, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (!e.isDirectory()) continue; const p = path.join(dir, e.name); if (e.name === name) out.push(p); foldersNamed(name, p, out); }
  return out;
};

try {
  await page.waitForSelector('[data-testid=setup-datos]');
  await page.fill('[data-testid=setup-assistant]', 'Orbe');
  await page.fill('[data-testid=setup-user]', 'Ana');
  await page.click('[data-testid=setup-create]');
  await throughStart(page, { ready: '[data-testid=chat-greeting]' });
  // The guided tour starts by itself on the first launch: skipped first (it takes Escape and closes Ajustes).
  await page.locator('[data-testid=tour]').waitFor({ timeout: 10000 });
  await page.click('[data-testid=tour-skip]');
  await until(async () => (await page.locator('[data-testid=tour]').count()) === 0, 'the tour closed');
  await until(async () => (await orb.call('app.state')).config?.ui?.tourDone === true, 'the tour remembered as done');
  // Every audio context the page makes from now on: the music's ask for playback latency (the games' sound effects
  // and the robot's voice make theirs without it).
  await page.evaluate(() => {
    const AC = window.AudioContext; window.__ctxs = [];
    window.AudioContext = new Proxy(AC, { construct(target, args) { const ctx = new target(...args); window.__ctxs.push({ ctx, options: args[0] ?? null }); return ctx; } });
  });
  const contexts = () => page.evaluate(() => window.__ctxs.filter((c) => c.options?.latencyHint === 'playback').map((c) => ({ state: c.ctx.state, time: c.ctx.currentTime })));
  const loaded = (what) => page.evaluate((re) => performance.getEntriesByType('resource').some((r) => new RegExp(re).test(r.name)), what);
  const ui = async () => (await orb.call('app.state')).config?.ui ?? {};
  const dialog = page.locator('[data-testid=games-dialog]');
  const musicButton = page.locator('[data-testid=games-music]');
  const openGames = async () => { await page.click('[data-testid=orb-chat-more]'); await page.click('[data-testid=bar-games]'); await dialog.waitFor(); };
  const backToList = async () => { await dialog.getByRole('button', { name: 'Volver a los juegos' }).last().click(); await page.locator('[data-testid=game-snake]').waitFor(); };
  const running = async (n) => until(async () => { const c = await contexts(); return c.length === n && c[n - 1].state === 'running' && c[n - 1].time > 0.3 ? c : null; }, `the audio context number ${n} running`);
  const closed = async (i) => until(async () => (await contexts())[i]?.state === 'closed', `the audio context number ${i + 1} closed`);

  step('silent first: the volume of Ajustes at zero');
  await page.click('[data-testid=nav-settings]');
  await page.locator('[data-testid=music-volume]').focus();
  await page.keyboard.press('Home');
  await until(async () => (await ui()).music?.volume === 0, 'the volume at zero');
  await closeSettings();

  step('the games window alone starts no music and loads nothing of it');
  await openGames();
  await page.waitForTimeout(700);
  assert.deepEqual(await contexts(), []);
  assert.equal(await loaded('adaptive-music'), false, 'the engine is not loaded by opening the window');
  assert.equal(await loaded('game-music'), false, 'nor the games\' themes');
  assert.equal(await musicButton.getAttribute('aria-pressed'), 'true', 'the games\' music is on unless muted');

  step('a game starts its music: made by the engine, in an audio context of its own');
  await page.click('[data-testid=game-snake]');
  const first = await running(1);
  assert.equal(await loaded('adaptive-music'), true, 'the engine, loaded by the click');
  assert.equal(await loaded('game-music'), true, 'and the games\' themes');
  await page.waitForTimeout(500);
  assert.ok((await contexts())[0].time > first[0].time, 'the audio clock advances');
  assert.equal(await page.evaluate(() => document.querySelectorAll('audio').length), 0, 'no audio element: nothing is played from a file');

  step('playing the game moves nothing but the music itself: no error, no new context');
  await page.locator('[data-testid=games-dialog] canvas').first().click().catch(() => {});
  for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) { await page.keyboard.press(key); await page.waitForTimeout(150); }
  assert.equal((await contexts()).length, 1);

  step('«Reiniciar» keeps the same music playing, without a cut');
  await dialog.getByRole('button', { name: /^(Reiniciar|Jugar otra vez)$/ }).click();
  await page.waitForTimeout(700);
  assert.equal((await contexts()).length, 1, 'the same context');
  assert.equal((await contexts())[0].state, 'running');

  step('the game\'s music button mutes it (its context is closed) and it is remembered');
  await musicButton.click();
  await closed(0);
  await until(async () => (await ui()).gameMusic === false, 'the mute saved');
  assert.equal(await musicButton.getAttribute('aria-pressed'), 'false');
  await dialog.getByRole('button', { name: /^(Reiniciar|Jugar otra vez)$/ }).click();
  await page.waitForTimeout(900);
  assert.equal((await contexts()).length, 1, 'muted: a new game starts no music');
  await musicButton.click();
  await running(2);
  await until(async () => (await ui()).gameMusic === true, 'the music on again, saved');

  step('leaving the game stops it; another game has its own');
  await backToList();
  await closed(1);
  await page.waitForTimeout(600);
  assert.equal((await contexts()).length, 2, 'the list of games plays nothing');
  await page.click('[data-testid=game-g2048]');
  await running(3);
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200); await page.keyboard.press('ArrowUp');

  step('closing the window stops it');
  await page.click('[data-testid=games-close]');
  await dialog.waitFor({ state: 'detached' });
  await closed(2);

  step('the background music waits for a game and comes back after it');
  await page.click('[data-testid=nav-music]');
  await page.locator('[data-testid=music-pop]').waitFor();
  await page.click('[data-testid=music-pop-play]');
  await running(4);
  await page.keyboard.press('Escape');
  await page.locator('[data-testid=music-pop]').waitFor({ state: 'detached' });
  await openGames();
  assert.equal((await contexts())[3].state, 'running', 'still playing with the list of games open');
  await page.click('[data-testid=game-tetris]');
  await running(5);
  await until(async () => (await contexts())[3].state === 'suspended', 'the background music paused for the game');
  assert.equal(await page.locator('[data-testid=nav-music]').getAttribute('aria-pressed'), 'true', 'it is still on: it only waits');
  await page.click('[data-testid=games-close]');
  await dialog.waitFor({ state: 'detached' });
  await closed(4);
  await until(async () => (await contexts())[3].state === 'running', 'the background music back');

  step('the lock stops a game\'s music and the background one, and nothing comes back by itself');
  // Asked before the lock (a locked Orb answers nothing): the engine has no method that hands a track over.
  await assert.rejects(orb.call('music.track', { id: 'junkala-level1' }));
  await openGames();
  await page.click('[data-testid=game-invaders]');
  await running(6);
  await orb.call('master.lock', { reason: 'hand' });
  await closed(5);
  await closed(3);
  await page.waitForTimeout(1500);
  assert.equal((await contexts()).length, 6, 'nothing started again');

  step('nothing was downloaded: no request for a track, no file, no API for one');
  const outside = requests.filter((u) => /^https?:/.test(u) && !/^https?:\/\/(tauri\.localhost|localhost|127\.0\.0\.1|ipc\.localhost)([:/]|$)/.test(u));
  assert.deepEqual(outside, [], 'the window asked nothing outside itself');
  assert.deepEqual(requests.filter((u) => /\.(mp3|ogg|wav)(\?|$)/i.test(u)), []);
  assert.deepEqual(foldersNamed('musica'), [], 'no folder of downloaded music in the profile');

  assert.deepEqual(errors, [], 'no errors in the window');
  console.log('OK: la música de los minijuegos la crea Orb, sin descargas');
} finally {
  await orb.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
