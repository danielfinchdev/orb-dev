// 3.7 (WS5): «Ver navegador del Server», the live view of a page of Orb Server's browser on the person's phone or app.
// The page is streamed with CDP's screencast (JPEG pictures of what changed) and the person's taps, text and special keys
// come back as input. This file is the stream itself, apart from the browser and the transport (the engine sends each
// picture as an event over Magic Link, end-to-end encrypted like every other event, to that one device only):
//   · pictures JPEG at quality 40–60, as wide as the device's screen (× its pixel ratio, 1.5 at most, never past the
//     page's 1280 px);
//   · flow control: one picture on its way at a time; the next is only asked of Chromium when the device acknowledged the
//     last one, so a slow phone gets fewer pictures instead of a queue; and a byte budget (150 KB/s by default) on top,
//     with the quality lowered when pictures are too big for it (and raised again when there is room);
//   · paused while the device's app is in the background; stopped after 10 minutes without any input;
//   · pictures are never stored: each one is handed to the transport and forgotten.
import { VIEW, KEYS } from '../core/browser-protocol.mjs';

export const LIVE = Object.freeze({ budget: 150 * 1024, qualityMin: 40, qualityMax: 60, quality: 50, idleMs: 10 * 60_000, ackTimeoutMs: 5000, lostAfter: 6, maxScale: 1.5, textMax: 2000 });

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
// The width of the pictures for a device: its screen's CSS width × its pixel ratio (1.5 at most), never past the page.
export function frameWidth(width, dpr = 1) {
  const w = clamp(Number(width) || 390, 200, 4000);
  const scale = clamp(Number(dpr) || 1, 1, LIVE.maxScale);
  return Math.min(VIEW.width, Math.round(w * scale));
}

// cdp: { send(method, params) → Promise, on(event, fn), off(event, fn) } (a playwright CDPSession of the page).
// send(frame): hands { seq, data (base64 JPEG), w, h } to the transport. onStop(reason): 'stopped' | 'idle' | 'lost' | 'closed'.
export function createScreencast({ cdp, send, width = 390, dpr = 1, quality = LIVE.quality, budget = LIVE.budget, idleMs = LIVE.idleMs, ackTimeoutMs = LIVE.ackTimeoutMs,
  now = Date.now, timers = { setTimeout, clearTimeout }, onStop = () => {}, onInput = () => {} }) {
  const maxWidth = frameWidth(width, dpr);
  const maxHeight = Math.round(maxWidth * VIEW.height / VIEW.width);
  let q = clamp(Math.round(Number(quality) || LIVE.quality), LIVE.qualityMin, LIVE.qualityMax);
  let running = false; let paused = false; let stopped = false;
  let pending = null; // the newest picture from Chromium not sent yet (its CDP ack is held: Chromium waits for it)
  let inflight = null; // the picture on its way to the device
  let seq = 0; let tokens = budget; let refilled = now(); let pumpTimer = null; let ackTimer = null; let idleTimer = null; let lost = 0;
  let meta = { deviceWidth: VIEW.width, deviceHeight: VIEW.height, offsetTop: 0 };
  let lastInput = now();
  const stats = { frames: 0, bytes: 0, rtt: 0, quality: q, startedAt: now(), restarts: 0 };
  let window = []; // the sizes of the last pictures (to adapt the quality)

  const cdpAck = (sessionId) => { cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); };
  const startCast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: q, maxWidth, maxHeight, everyNthFrame: 1 });
  function onFrame(f) {
    if (stopped || !f) return;
    if (f.metadata) meta = { ...meta, ...f.metadata };
    // A newer picture replaces one that never left (the device gets the latest, never a backlog).
    if (pending) cdpAck(pending.sessionId);
    pending = { data: String(f.data ?? ''), sessionId: f.sessionId };
    pump();
  }
  function refill() { const t = now(); tokens = Math.min(budget, tokens + (t - refilled) * budget / 1000); refilled = t; }
  function pump() {
    if (stopped || paused || inflight || !pending) return;
    const bytes = Math.ceil(pending.data.length * 3 / 4);
    refill();
    const need = Math.min(bytes, budget);
    if (tokens < need) {
      if (!pumpTimer) pumpTimer = timers.setTimeout(() => { pumpTimer = null; pump(); }, Math.max(5, Math.ceil((need - tokens) * 1000 / budget)));
      return;
    }
    tokens -= bytes;
    const f = pending; pending = null;
    inflight = { seq: ++seq, sessionId: f.sessionId, at: now(), bytes };
    stats.frames++; stats.bytes += bytes;
    try { send({ seq: inflight.seq, data: f.data, w: Math.round(meta.deviceWidth), h: Math.round(meta.deviceHeight) }); } catch { /* the transport is gone: the ack never comes */ }
    ackTimer = timers.setTimeout(() => { ackTimer = null; if (!inflight) return; lost++; release(); if (lost >= LIVE.lostAfter) stop('lost'); }, ackTimeoutMs);
    adapt(bytes);
  }
  // Pictures too big for the budget at ~4 a second: lower the quality; small ones with room to spare: raise it.
  function adapt(bytes) {
    window.push(bytes);
    if (window.length < 8) return;
    const avg = window.reduce((a, b) => a + b, 0) / window.length; window = [];
    let next = q;
    if (avg * 4 > budget && q > LIVE.qualityMin) next = Math.max(LIVE.qualityMin, q - 10);
    else if (avg * 10 < budget && q < LIVE.qualityMax) next = Math.min(LIVE.qualityMax, q + 10);
    if (next !== q) { q = next; stats.quality = q; stats.restarts++; if (running && !paused) cdp.send('Page.stopScreencast').then(startCast).catch(() => {}); }
  }
  function release() {
    if (ackTimer) { timers.clearTimeout(ackTimer); ackTimer = null; }
    const f = inflight; inflight = null;
    if (f) cdpAck(f.sessionId);
    pump();
  }
  function idleCheck() {
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      if (stopped) return;
      if (now() - lastInput >= idleMs) { stop('idle'); return; }
      idleCheck();
    }, Math.max(50, Math.min(60_000, idleMs - (now() - lastInput))));
  }
  const px = (v, size) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('posición no válida'); return Math.round(n * size); };
  const point = (ev) => ({ x: px(ev.x, meta.deviceWidth), y: px(ev.y, meta.deviceHeight) });
  const mouse = (type, { x, y }, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });

  async function stop(reason = 'stopped') {
    if (stopped) return;
    stopped = true; running = false;
    for (const t of [pumpTimer, ackTimer, idleTimer]) if (t) timers.clearTimeout(t);
    pumpTimer = ackTimer = idleTimer = null;
    cdp.off?.('Page.screencastFrame', onFrame);
    if (pending) cdpAck(pending.sessionId);
    pending = null; inflight = null;
    await cdp.send('Page.stopScreencast').catch(() => {});
    try { onStop(reason); } catch { /* never in the way */ }
  }

  return {
    maxWidth, maxHeight,
    async start() {
      cdp.on('Page.screencastFrame', onFrame);
      await startCast();
      running = true; idleCheck();
      return { width: maxWidth, height: maxHeight, quality: q };
    },
    // The device got picture seq.
    ack(n) {
      if (stopped || !inflight || Number(n) !== inflight.seq) return false;
      stats.rtt = now() - inflight.at; lost = 0;
      release();
      return true;
    },
    // The device's app went to the background (true) or came back (false).
    async pause(on = true) {
      if (stopped || paused === on) return;
      paused = on;
      if (on) { if (ackTimer) { timers.clearTimeout(ackTimer); ackTimer = null; } if (inflight) { cdpAck(inflight.sessionId); inflight = null; } if (pending) { cdpAck(pending.sessionId); pending = null; } await cdp.send('Page.stopScreencast').catch(() => {}); }
      else { lastInput = now(); await startCast().catch(() => {}); }
    },
    // One input from the device: a tap or a mouse event (x, y between 0 and 1 of the picture), the wheel, text typed in
    // the device's own field, or one of the special keys.
    async input(ev) {
      if (stopped) throw new Error('la vista en directo está cerrada');
      if (!ev || typeof ev !== 'object') throw new Error('entrada no válida');
      lastInput = now();
      try { onInput(ev.type); } catch { /* never in the way */ }
      if (ev.type === 'tap') {
        const p = point(ev);
        await mouse('mouseMoved', p);
        await mouse('mousePressed', p, { button: 'left', buttons: 1, clickCount: 1 });
        await mouse('mouseReleased', p, { button: 'left', buttons: 0, clickCount: 1 });
        return true;
      }
      if (ev.type === 'mouse') {
        const type = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved' }[ev.action];
        if (!type) throw new Error('entrada no válida');
        const button = ev.action === 'move' ? 'none' : ev.button === 'right' ? 'right' : 'left';
        await mouse(type, point(ev), { button, buttons: ev.action === 'down' ? (button === 'right' ? 2 : 1) : 0, clickCount: ev.action === 'move' ? 0 : 1 });
        return true;
      }
      if (ev.type === 'wheel') {
        const d = (v) => clamp(Number(v) || 0, -5000, 5000);
        await mouse('mouseWheel', point(ev), { deltaX: d(ev.dx), deltaY: d(ev.dy) });
        return true;
      }
      if (ev.type === 'text') {
        if (typeof ev.text !== 'string' || !ev.text || ev.text.length > LIVE.textMax) throw new Error('texto no válido');
        await cdp.send('Input.insertText', { text: ev.text });
        return true;
      }
      if (ev.type === 'key') {
        const def = Object.hasOwn(KEYS, ev.key) ? KEYS[ev.key] : null;
        if (!def) throw new Error('tecla no permitida');
        const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk };
        await cdp.send('Input.dispatchKeyEvent', { type: def.text ? 'keyDown' : 'rawKeyDown', ...base, ...(def.text ? { text: def.text, unmodifiedText: def.text } : {}) });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        return true;
      }
      throw new Error('entrada no válida');
    },
    stop,
    stats: () => ({ ...stats, quality: q, inflight: Boolean(inflight), paused, stopped, seconds: (now() - stats.startedAt) / 1000 }),
    get stopped() { return stopped; },
    get lastInput() { return lastInput; }
  };
}
