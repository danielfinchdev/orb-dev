// 3.8.3: how an answer is typed on screen (src/ui/lib/typing.js), measured in the window itself (a build with the `e2e`
// cargo feature: the only one with a DevTools port). Throwaway workspace and app-data folder in %TEMP% with the fake agents
// (their STREAM_LARGO answer streams ~2 KB of Markdown for a few seconds); never the real C:\Orb, %APPDATA%\Orb* or the
// installed app. The window is shown (frames are only drawn for a visible window).
//
//   node scripts/medir-escritura.mjs [--exe src-tauri/target-e2e/release/Orb.exe] [--frames <folder>] [--out <results.json>]
//
// Every frame, the length of the answer on screen. Per answer:
//   typedMs      first character → the whole answer on screen
//   perFrame     characters added per frame while it is typed (p50 / p90 / max): small and steady = smooth
//   stillFrames  share of frames with nothing added while it is typed (0 = it never stops)
//   tailMs       the turn ended (the activity line gone) → the whole answer on screen
//   keyP90       while it is typed, keydown → the next frame, 30 keys 60 ms apart (as scripts/medir-fluidez.mjs)
// Then the same answer with prefers-reduced-motion (it must show as it comes, untyped), and the chat opened again (the
// history must show whole at once). --frames saves the window's frames while the first answer is typed (CDP screencast).
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, arg, wait, until, pct, r1 } from './lib/e2e-window.mjs';

const out = arg('out');
const framesDir = arg('frames');
const { exe, launch, quit, configure } = await sandbox({ name: 'medir-escritura' });
const { throughStart } = await import('../test/fixtures/e2e-flows.mjs');

// In the page: every frame, the length of the newest answer (the last Markdown box holding its «ZORRO»).
const watch = (page) => page.evaluate(() => {
  const w = { frames: [], done: false };
  window.__escritura = w;
  const tick = (t) => {
    if (w.done) return;
    const boxes = [...document.querySelectorAll('[data-testid=chat-lines] .prose-chat')].filter((b) => b.textContent.includes('ZORRO'));
    const box = boxes.at(-1);
    w.frames.push([t, box && box.closest('[data-testid=chat-lines]') && boxes.length >= w.nth ? box.textContent.length : 0, Boolean(document.querySelector('[data-testid=chat-activity]'))]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const answers = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid=chat-lines] .prose-chat')].filter((b) => b.textContent.includes('ZORRO')).length);

async function answer(page, text, { keys = false } = {}) {
  const nth = (await answers(page)) + 1;
  const box = page.locator('[data-testid=chat-input]');
  await box.click(); await box.fill(text);
  await watch(page);
  await page.evaluate((n) => { window.__escritura.nth = n; }, nth);
  await page.keyboard.press('Enter');
  let typed = null;
  if (keys) {
    await until(() => page.evaluate(() => window.__escritura.frames.some((f) => f[1] > 0)), 'el texto', 20000, 20);
    await page.evaluate(() => {
      const out = []; let last = null;
      const box = document.querySelector('[data-testid=chat-input]');
      const down = (e) => { last = e.timeStamp; };
      const input = () => { const at = last; requestAnimationFrame((t) => out.push(t - at)); };
      box.addEventListener('keydown', down); box.addEventListener('input', input);
      window.__teclas = { out, stop: () => { box.removeEventListener('keydown', down); box.removeEventListener('input', input); } };
    });
    for (let i = 0; i < 30; i++) { await page.keyboard.type('a'); await wait(60); }
    typed = await page.evaluate(() => { window.__teclas.stop(); return window.__teclas.out; });
  }
  await until(() => page.evaluate(() => { const f = window.__escritura.frames; return f.length > 30 && f.at(-1)[1] > 0 && !f.at(-1)[2] && f.slice(-30).every((x) => x[1] === f.at(-1)[1]); }), 'la respuesta entera', 60000, 100);
  const frames = await page.evaluate(() => { window.__escritura.done = true; return window.__escritura.frames; });
  if (keys) await box.fill('');
  const shown = frames.filter((f) => f[1] > 0);
  const full = shown.at(-1)[1];
  const first = shown[0]; const whole = shown.find((f) => f[1] === full);
  const during = frames.filter((f) => f[0] >= first[0] && f[0] <= whole[0]);
  const steps = during.slice(1).map((f, i) => f[1] - during[i][1]).filter((d) => d >= 0);
  const ended = frames.find((f, i) => i > 0 && frames[i - 1][2] && !f[2]);
  return {
    chars: full,
    typedMs: r1(whole[0] - first[0]),
    perFrame: { p50: pct(steps, 50), p90: pct(steps, 90), max: Math.max(...steps) },
    stillFrames: r1((steps.filter((d) => d === 0).length / Math.max(1, steps.length)) * 100),
    jumps: during.slice(1).map((f, i) => [r1(f[0] - first[0]), f[1] - during[i][1], f[1]]).filter(([, d]) => d > 40), // [ms, added, length]
    tailMs: ended ? r1(Math.max(0, whole[0] - ended[0])) : null,
    ...(typed ? { keyP50: r1(pct(typed, 50)), keyP90: r1(pct(typed, 90)), keyMax: r1(Math.max(...typed)) } : {})
  };
}

// ---- first start (master password, folders): not measured
{
  const run = await launch();
  await throughStart(run.page, { ready: '[data-testid=sidebar-home]', timeout: 120000 });
  await wait(2000);
  await quit(run);
}
configure({ ui: { autoNoticed: true } }); // the one-time «Modo Auto» notice would cover the answer in the frames
const run = await launch();
const { page } = run;
await throughStart(page, { ready: '[data-testid=sidebar-home]', timeout: 120000 });
await wait(4000);
await page.click('[data-testid=chats-new]'); await page.click('[data-testid=new-conversation]');
await page.locator('[data-testid=chat-input]').waitFor({ timeout: 20000 });

let cdp = null; let n = 0;
if (framesDir) {
  fs.mkdirSync(framesDir, { recursive: true });
  cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
    fs.writeFileSync(path.join(framesDir, `f${String(++n).padStart(4, '0')}-${Math.round(metadata.timestamp * 1000)}.jpg`), Buffer.from(data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
}
const typed = await answer(page, 'STREAM_LARGO hola a');
if (cdp) { await cdp.send('Page.stopScreencast'); }
const again = await answer(page, 'STREAM_LARGO hola b', { keys: true }); // keys: the chat already open (a new one changes its box)
const cdp2 = cdp ?? await page.context().newCDPSession(page);
await cdp2.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const reduced = await answer(page, 'STREAM_LARGO hola c');
await cdp2.send('Emulation.setEmulatedMedia', { features: [] });
// The chat opened again: its answers are history and show whole in the first frame they show.
await page.click('[data-testid=chats-new]'); await page.click('[data-testid=new-conversation]');
await wait(1000);
await page.locator('[data-testid^=item-c]').first().click();
await page.evaluate(() => { window.__h = []; const tick = (t) => { const b = [...document.querySelectorAll('[data-testid=chat-lines] .prose-chat')].filter((x) => x.textContent.includes('ZORRO')); window.__h.push(b.map((x) => x.textContent.length).join(',')); if (window.__h.length < 120) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
await wait(2500);
const history = await page.evaluate(() => window.__h.filter((x) => x));
// Each answer drawn in any frame is already whole: every length seen is one of the lengths of the last frame.
const whole = new Set(history.at(-1)?.split(',') ?? []);
const results = { exe, typed, again, reduced, historyWholeAtOnce: history.length > 0 && history.every((x) => x.split(',').every((n) => whole.has(n))), historyFrames: history.length };
console.log(JSON.stringify(results, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
await quit(run);
process.exit(0);
