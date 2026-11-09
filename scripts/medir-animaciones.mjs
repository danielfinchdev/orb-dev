// 3.8.3: what each visual theme's moving backdrop costs at rest, and how fast a key shows over it, measured in the window
// itself (a build with the `e2e` cargo feature: the only one with a DevTools port). Throwaway workspace and app-data
// folder in %TEMP% (never the real C:\Orb, %APPDATA%\Orb* or the installed app); the window is shown, since frames are
// only drawn for a visible window. One start per theme and mode (the theme is set in the workspace before the start).
//
//   node scripts/medir-animaciones.mjs [--exe src-tauri/target-e2e/release/Orb.exe] [--skins orb,vaporwave] [--modes claro,oscuro]
//                                      [--settle 3] [--idle 6] [--out <results.json>] [--shots <folder>]
//
// Per theme and mode, a new chat on screen, untouched for --idle seconds:
//   layouts / styles     style recalculations and layouts per second on the main thread (an animation the compositor
//                        runs alone needs neither)
//   paints / rasters     Paint and raster tasks per second (a layer moved by transform alone is not painted again)
//   frames               frames drawn and swapped per second (every compositor surface)
//   notComposited        animations Chromium could not run on the compositor (trace «Animation» with compositeFailed)
//   cpu                  CPU of the renderer and of the GPU process, % of one core (SystemInfo.getProcessInfo)
//   mainThread           the running animations of anything but transform / opacity (each one costs the main thread
//                        a restyle, and usually a paint, every frame)
// Then 30 keys typed 60 ms apart in the message box: keydown → the next frame (p50 / p90 / max).
// MEDIR_DEBUG=1 adds what invalidated style, layout and paint (with the JS stack); MEDIR_HIDE=<selector> hides those
// elements first (to tell the backdrop's cost from the robot's).
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, arg, wait, pct, r1 } from './lib/e2e-window.mjs';

const SKINS = arg('skins', 'orb,vaporwave,retro,nube,cristal,profesional').split(',');
const MODES = arg('modes', 'claro,oscuro').split(',');
const IDLE_S = Number(arg('idle', 6));
const SETTLE_S = Number(arg('settle', 3));
const out = arg('out');
const shots = arg('shots'); // a folder: a picture of each theme's backdrop, stopped at the same moment
const { exe, configure, launch, quit } = await sandbox({ name: 'medir-animaciones' });
const { throughStart } = await import('../test/fixtures/e2e-flows.mjs');


const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.animations', 'cc', 'benchmark', ...(process.env.MEDIR_DEBUG ? ['disabled-by-default-devtools.timeline.stack', 'disabled-by-default-devtools.timeline.invalidationTracking'] : [])].join(',');
async function idleCost(run) {
  const cdp = await run.page.context().newCDPSession(run.page);
  const top = await run.browser.newBrowserCDPSession();
  const cpu = async () => Object.fromEntries((await top.send('SystemInfo.getProcessInfo')).processInfo.map((p) => [`${p.type}:${p.id}`, p.cpuTime]));
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  const m0 = await metrics(); const c0 = await cpu(); const t0 = Date.now();
  await cdp.send('Tracing.start', { categories: CATEGORIES, transferMode: 'ReportEvents' });
  await wait(IDLE_S * 1000);
  await cdp.send('Tracing.end'); await done;
  const s = (Date.now() - t0) / 1000; const m1 = await metrics(); const c1 = await cpu();
  const per = (k) => r1((m1[k] - m0[k]) / s);
  const count = (name) => r1(events.filter((e) => e.name === name).length / s);
  const failed = events.filter((e) => e.name === 'Animation' && e.args?.data?.compositeFailed);
  if (process.env.MEDIR_DEBUG) { const why = {}; for (const e of events.filter((x) => ['InvalidateLayout', 'ScheduleStyleRecalculation', 'StyleRecalcInvalidationTracking', 'LayoutInvalidationTracking', 'Paint'].includes(x.name))) { const d = e.args?.data ?? {}; const k = `${e.name} ${d.nodeName ?? ''} ${d.reason ?? ''} ${(d.stackTrace ?? []).slice(0, 2).map((f) => `${f.functionName}@${String(f.url).split('/').pop()}:${f.lineNumber}`).join(' < ')}`; why[k] = (why[k] ?? 0) + 1; } console.error(JSON.stringify(Object.entries(why).sort((x, y) => y[1] - x[1]).slice(0, 25), null, 1)); }
  if (process.env.MEDIR_DEBUG) { const anims = events.filter((e) => e.name === 'Animation'); console.error(JSON.stringify(anims.slice(0, 12))); console.error(JSON.stringify(Object.entries(events.reduce((a, e) => { a[e.name] = (a[e.name] ?? 0) + 1; return a; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 40))); }
  const cpuOf = (type) => r1(Object.keys(c1).filter((k) => k.startsWith(`${type}:`)).reduce((a, k) => a + (c1[k] - (c0[k] ?? 0)), 0) / s * 100);
  await cdp.detach().catch(() => {}); await top.detach().catch(() => {});
  return { layouts: per('LayoutCount'), styles: per('RecalcStyleCount'), paints: count('Paint'), rasters: count('RasterTask'), frames: count('Graphics.Pipeline.DrawAndSwap'),
    notComposited: [...new Set(failed.map((e) => `${e.args.data.compositeFailed}:${(e.args.data.unsupportedProperties ?? []).join('+')}`))], cpuRenderer: cpuOf('renderer'), cpuGpu: cpuOf('GPU') };
}
// The running animations that animate anything but transform and opacity (the compositor cannot run those alone: the
// main thread restyles, and usually repaints, every frame they run). Names and targets, counted.
const COMPOSITED = new Set(['transform', 'opacity', 'translate', 'scale', 'rotate', 'offset', 'computedOffset', 'easing', 'composite']);
const mainThreadAnimations = (page) => page.evaluate((ok) => {
  const out = {};
  for (const a of document.getAnimations()) {
    if (a.playState !== 'running') continue;
    const props = [...new Set((a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k)))].filter((k) => !ok.includes(k));
    if (!props.length) continue;
    const el = a.effect?.target; const what = `${a.animationName ?? a.transitionProperty ?? 'js'} on ${el?.tagName?.toLowerCase() ?? '?'}.${String(el?.className?.baseVal ?? el?.className ?? '').split(' ')[0]}: ${props.join('+')}`;
    out[what] = (out[what] ?? 0) + 1;
  }
  return out;
}, [...COMPOSITED]);
async function typing(page) {
  const box = page.locator('[data-testid=chat-input]');
  await box.click();
  await page.evaluate(() => {
    const out = []; let last = null;
    const el = document.querySelector('[data-testid=chat-input]');
    const down = (e) => { last = e.timeStamp; };
    // After the next frame's work (a message posted from requestAnimationFrame runs once that frame is done).
    const input = () => { const at = last; requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => out.push(performance.now() - at); ch.port2.postMessage(0); }); };
    el.addEventListener('keydown', down); el.addEventListener('input', input);
    window.__teclas = { out, stop: () => { el.removeEventListener('keydown', down); el.removeEventListener('input', input); } };
  });
  for (let i = 0; i < 30; i++) { await page.keyboard.type('a'); await wait(60); }
  const keys = await page.evaluate(() => { window.__teclas.stop(); return window.__teclas.out; });
  await box.fill('');
  return { keyP50: r1(pct(keys, 50)), keyP90: r1(pct(keys, 90)), keyMax: r1(Math.max(...keys)) };
}

// ---- first start (master password, folders): not measured
{
  const run = await launch();
  await throughStart(run.page, { ready: '[data-testid=sidebar-home]', timeout: 120000 });
  await wait(2000);
  await quit(run);
}
const results = { exe, idleSeconds: IDLE_S, runs: [] };
for (const skin of SKINS) {
  for (const mode of MODES) {
    configure({ ui: { skin, theme: mode } });
    const run = await launch();
    const { page } = run;
    await throughStart(page, { ready: '[data-testid=chats-new]', timeout: 120000 }); // Profesional has no robot button
    await page.click('[data-testid=chats-new]'); await page.click('[data-testid=new-conversation]');
    await page.locator('[data-testid=chat-input]').waitFor({ timeout: 20000 });
    await page.mouse.move(5, 300); // the pointer away from anything with a hover
    await wait(SETTLE_S * 1000); // the start settles (the robot's hello floats for 8.4 s: --settle 10 measures after it)
    if (process.env.MEDIR_HIDE) await page.evaluate((sel) => { for (const el of document.querySelectorAll(sel)) el.style.display = 'none'; }, process.env.MEDIR_HIDE);
    const row = { skin, mode, ...(await idleCost(run)), mainThread: await mainThreadAnimations(page), ...(await typing(page)) };
    if (shots) {
      // Only the backdrop, every animation of it stopped at the same moment: two builds' pictures can be compared.
      await page.addStyleTag({ content: 'body * { visibility: hidden !important; } .scene, .scene * { visibility: visible !important; }' });
      await page.evaluate(() => { for (const a of document.getAnimations()) { if (a.effect?.target?.closest?.('.scene')) { a.pause(); a.currentTime = 20000; } } });
      await wait(300);
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, `${skin}-${mode}.png`) });
    }
    results.runs.push(row);
    console.error(JSON.stringify(row));
    await quit(run);
  }
}
console.log(JSON.stringify(results.runs.map(({ skin, mode, layouts, styles, paints, rasters, frames, cpuRenderer, cpuGpu, keyP50, keyP90, keyMax, notComposited, mainThread }) => ({ skin, mode, layouts, styles, paints, rasters, frames, cpuRenderer, cpuGpu, keyP50, keyP90, keyMax, notComposited, mainThread })), null, 1));
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
process.exit(0);
