// The adaptive music in the real Orb on Tauri (its test build, window hidden: test/fixtures/launch-orb.mjs), with
// fake agents and a throwaway workspace:  npm run tauri:build:e2e && node test/musica-388.e2e.mjs
// The volume is set to zero first, so nothing sounds on the PC that runs it; the page's audio contexts are watched instead: the music's own one is made only by the
// click, runs while it plays and is closed when it stops. Checked: off and unloaded at the start, the button, the next
// theme, Ajustes (source, theme, «Música que reacciona», intensity, volume), what is saved, and the lock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { throughStart, sandboxEnv } from './fixtures/e2e-flows.mjs';
import { launchOrb } from './fixtures/launch-orb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-e2e-musica-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
process.on('unhandledRejection', (e) => { if (/No dialog is showing/.test(String(e?.message))) return; console.error(e); process.exitCode = 1; });

const orb = await launchOrb({ userData: path.join(tmp, 'datos-app'), env: { ...sandboxEnv(tmp), ORB_DEFAULT_BASE: base, ORB_FAKE_AGENTS: path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs') } });
const page = orb.page;
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const step = (text) => console.log(`· ${text}`);
// Escape closes an open list first, then the dialog.
const closeSettings = async () => {
  const dialog = page.locator('[data-testid=settings-dialog]');
  for (let i = 0; i < 4 && await dialog.count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await dialog.waitFor({ state: 'detached' });
};
const until = async (fn, what, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`no llegó: ${what}`); await page.waitForTimeout(150); } };

try {
  // The welcome (the folder is already chosen: ORB_DEFAULT_BASE), then the master password and «Preparando tu PC».
  await page.waitForSelector('[data-testid=setup-datos]');
  await page.fill('[data-testid=setup-assistant]', 'Orbe');
  await page.fill('[data-testid=setup-user]', 'Ana');
  await page.click('[data-testid=setup-create]');
  await throughStart(page, { ready: '[data-testid=chat-greeting]' });
  // Every audio context the page makes from now on, with the options it was made with: the music's is the one that
  // asks for playback latency (the robot's voice and the games make theirs without options).
  await page.evaluate(() => {
    const AC = window.AudioContext; window.__ctxs = [];
    window.AudioContext = new Proxy(AC, { construct(target, args) { const ctx = new target(...args); window.__ctxs.push({ ctx, options: args[0] ?? null }); return ctx; } });
  });
  const contexts = () => page.evaluate(() => window.__ctxs.filter((c) => c.options?.latencyHint === 'playback').map((c) => ({ state: c.ctx.state, time: c.ctx.currentTime })));
  const engineLoaded = () => page.evaluate(() => performance.getEntriesByType('resource').some((r) => /adaptive-music/.test(r.name)));
  const music = async () => (await orb.call('app.state')).config?.ui?.music ?? {}; // what orb.json holds
  const button = page.locator('[data-testid=nav-music]');

  step('off at the start: no engine loaded, no audio context of its own');
  await button.waitFor();
  // Silent from the first note (the test runs on someone's PC): the volume to zero in Ajustes, before it ever plays.
  await page.click('[data-testid=nav-settings]');
  await page.locator('[data-testid=music-volume]').focus();
  await page.keyboard.press('Home');
  await until(async () => (await music()).volume === 0, 'the volume at zero');
  await closeSettings();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.equal(await engineLoaded(), false, 'the engine is not part of the start');
  assert.deepEqual(await contexts(), []);
  assert.notEqual((await music()).on, true);

  step('the button starts the adaptive music');
  await button.click();
  await until(async () => (await button.getAttribute('aria-pressed')) === 'true', 'the music playing');
  assert.equal(await engineLoaded(), true, 'loaded by the click');
  const first = await until(async () => { const c = await contexts(); return c.length === 1 && c[0].state === 'running' && c[0].time > 0.3 ? c : null; }, 'its audio context running');
  await page.waitForTimeout(500);
  assert.ok((await contexts())[0].time > first[0].time, 'the audio clock advances');
  assert.equal((await music()).on, true, 'remembered as on');
  assert.equal(await button.getAttribute('aria-label'), 'Pausar música');

  step('typing and a chat line reach it without errors');
  await page.keyboard.press('Control+n').catch(() => {});
  const box = page.locator('textarea').first();
  if (await box.count()) { await box.click(); await page.keyboard.type('hola, esto es una prueba de la música', { delay: 20 }); await box.fill(''); }

  step('«next» goes to the next theme and saves it');
  const next = page.locator('[data-testid=nav-music-next]');
  assert.equal(await next.getAttribute('aria-label'), 'Siguiente estilo');
  await next.click();
  await until(async () => (await music()).theme === 'neon', 'the theme saved');
  assert.equal((await contexts()).length, 1, 'a change of theme is a crossfade in the same context');

  step('Ajustes › Apariencia: theme, «Música que reacciona», intensity and volume');
  await page.click('[data-testid=nav-settings]');
  const settings = page.locator('[data-testid=music-settings]');
  await settings.scrollIntoViewIfNeeded();
  assert.equal(await page.locator('[data-testid=music-intensity]').count(), 0, 'no intensity while it reacts');
  await page.click('[data-testid=music-reactive]');
  await page.locator('[data-testid=music-intensity]').waitFor();
  await until(async () => (await music()).reactive === false, '«Música que reacciona» off saved');
  await page.locator('[data-testid=music-intensity]').focus();
  await page.keyboard.press('ArrowRight');
  await until(async () => Math.abs(((await music()).intensity ?? 0) - 0.4) < 0.001, 'the intensity saved');
  await page.click('[data-testid=music-reactive]');
  await until(async () => (await music()).reactive === true, '«Música que reacciona» on again');
  await page.click('[data-testid=music-theme]');
  await page.getByRole('option', { name: /Órbita/ }).click();
  await until(async () => (await music()).theme === 'orbita', 'the theme chosen in Ajustes');
  assert.equal((await contexts())[0].state, 'running', 'still playing through every change');

  step('the free tracks instead: the engine stops and its context is closed');
  await page.click('[data-testid=music-mode]');
  await page.getByRole('option', { name: 'Pistas libres' }).click();
  await until(async () => (await music()).mode === 'tracks', 'the source saved');
  await until(async () => (await contexts())[0].state === 'closed', 'the adaptive music let go');
  // No downloads in a test (the fake agents turn them off): the track cannot play, and that is all that happens.
  await until(async () => (await button.getAttribute('aria-pressed')) === 'false', 'the track that cannot be downloaded');
  // The volume, moved while nothing can sound, and back to zero.
  await page.locator('[data-testid=music-volume]').focus();
  await page.keyboard.press('ArrowRight');
  await until(async () => Math.abs(((await music()).volume ?? 0) - 0.05) < 0.001, 'the volume saved');
  await page.keyboard.press('ArrowLeft');
  await until(async () => (await music()).volume === 0, 'the volume back to zero');

  step('back to the adaptive music, with a context of its own again');
  await page.click('[data-testid=music-mode]');
  await page.getByRole('option', { name: 'Adaptativa' }).click();
  await until(async () => (await music()).mode === 'adaptive', 'the source saved');
  await closeSettings();
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await until(async () => { const c = await contexts(); return c.length === 2 && c[1].state === 'running'; }, 'a new context running');

  step('pause with the button: closed again, and remembered as off');
  await button.click();
  await until(async () => (await contexts())[1].state === 'closed', 'closed after the pause');
  assert.equal((await music()).on, false);
  assert.equal(await button.getAttribute('aria-pressed'), 'false');

  step('the lock stops it and it does not come back by itself');
  await button.click();
  await until(async () => { const c = await contexts(); return c.length === 3 && c[2].state === 'running'; }, 'playing before the lock');
  await orb.call('master.lock', { reason: 'hand' });
  await until(async () => (await contexts())[2].state === 'closed', 'stopped by the lock');
  await page.waitForTimeout(1500);
  assert.equal((await contexts()).length, 3, 'nothing started again');

  assert.deepEqual(errors, [], 'no errors in the window');
  console.log('OK: la música adaptativa funciona en el Orb real');
} finally {
  await orb.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
