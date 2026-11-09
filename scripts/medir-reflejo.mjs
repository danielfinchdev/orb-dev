// 3.8.3: how long the window takes to show what the user just did (the diagnosis measured 1.5–8 s in Dani's Orb 3.8.2,
// with the engine blocked). Measured in the window of a test build (scripts/lib/e2e-window.mjs: throwaway workspace,
// fake agents), from the click to the first frame that shows the result:
//   pause / resume   «Pausar» → the button turns into «Reanudar», and back
//   theme            Ajustes › Apariencia › Retro → the window wears it (html[data-skin]), and back to Orb
//   delete           ⋯ › Eliminar › confirm → the conversation is gone from the list
//
//   node scripts/medir-reflejo.mjs [--exe src-tauri/target-e2e/release/Orb.exe] [--runs 3] [--out <results.json>]
import fs from 'node:fs';
import { sandbox, arg, wait, until, pct, r1 } from './lib/e2e-window.mjs';

const RUNS = Number(arg('runs', 3));
const out = arg('out');
const { exe, launch, quit } = await sandbox({ name: 'medir-reflejo' });
const { throughStart } = await import('../test/fixtures/e2e-flows.mjs');

// In the page: click `click` (a selector, or a function that clicks), then the time to the first frame where done() holds.
const timed = (page, click, done) => page.evaluate(async ({ click, done }) => {
  const ok = new Function(`return (${done})()`); // eslint-disable-line no-new-func
  const t0 = performance.now();
  if (click.startsWith('() =>')) new Function(`return (${click})()`)(); else document.querySelector(click).click(); // eslint-disable-line no-new-func
  for (;;) {
    const t = await new Promise((r) => requestAnimationFrame(r));
    if (ok()) return t - t0;
    if (t - t0 > 30000) return null;
  }
}, { click: typeof click === 'function' ? click.toString() : click, done: done.toString() });

const { page, ...run } = await launch();
await throughStart(page, { ready: '[data-testid=chats-new]', timeout: 120000 });
await wait(3000);
const results = { exe, runs: [] };
for (let i = 1; i <= RUNS; i++) {
  const row = { run: i };
  // A conversation to delete: one message, answered.
  await page.click('[data-testid=chats-new]'); await page.click('[data-testid=new-conversation]');
  const box = page.locator('[data-testid=chat-input]');
  await box.click(); await box.fill(`reflejo ${i}`); await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => /reflejo/.test(document.querySelector('[data-testid=chat-lines]')?.textContent ?? '') && !document.querySelector('[data-testid=chat-activity]')), 'la respuesta', 30000, 100);
  await wait(1500);

  row.pauseMs = r1(await timed(page, '[data-testid=bar-pause]', () => Boolean(document.querySelector('[data-testid=bar-resume]'))));
  await wait(500);
  row.resumeMs = r1(await timed(page, '[data-testid=bar-resume]', () => Boolean(document.querySelector('[data-testid=bar-pause]'))));
  await wait(500);

  const rows = () => page.evaluate(() => document.querySelectorAll('[data-testid^="orb-row-"]').length);
  const before = await rows();
  await page.click('[data-testid=orb-chat-more]');
  await page.click('[data-testid=more-delete]');
  await page.locator('[role=dialog] button.bg-destructive').first().waitFor({ timeout: 10000 });
  row.deleteMs = r1(await timed(page, () => { document.querySelector('[role=dialog] button.bg-destructive').click(); },
    new Function(`return () => document.querySelectorAll('[data-testid^="orb-row-"]').length < ${before}`)())); // eslint-disable-line no-new-func
  await wait(800);

  await page.click('[data-testid=nav-settings]');
  await page.locator('[data-testid=skin-retro]').waitFor({ timeout: 15000 });
  row.themeMs = r1(await timed(page, '[data-testid=skin-retro]', () => document.documentElement.dataset.skin === 'retro'));
  await wait(800);
  row.themeBackMs = r1(await timed(page, '[data-testid=skin-orb]', () => document.documentElement.dataset.skin === 'orb'));
  await page.keyboard.press('Escape');
  await wait(800);
  results.runs.push(row);
  console.error(JSON.stringify(row));
}
await quit({ page, ...run });
const sum = (k) => { const xs = results.runs.map((r) => r[k]).filter((x) => x != null); return { p50: r1(pct(xs, 50)), max: r1(Math.max(...xs)) }; };
results.summary = Object.fromEntries(['pauseMs', 'resumeMs', 'deleteMs', 'themeMs', 'themeBackMs'].map((k) => [k, sum(k)]));
console.log(JSON.stringify(results.summary, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
process.exit(0);
