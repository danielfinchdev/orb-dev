// 3.8.1 (H4a): many small updates drawn together. What arrives under the same key before the next frame replaces the
// earlier one (only the newest counts); the batch is handed over on the next frame, or after `wait` ms at the latest:
// a window hidden (minimised, covered, a phone's app in the background) draws no frames, and the batch must not wait
// for it to be seen again. flush() hands it over at once (main.jsx calls it when the window hides or shows).
export function frameBatch(apply, { wait = 100, frame = globalThis.requestAnimationFrame, cancelFrame = globalThis.cancelAnimationFrame, later = setTimeout, cancelLater = clearTimeout, hidden = () => globalThis.document?.hidden ?? false } = {}) {
  let pending = null; let raf = null; let timer = null;
  const flush = () => {
    if (raf != null) { cancelFrame?.(raf); raf = null; }
    if (timer != null) { cancelLater(timer); timer = null; }
    if (!pending) return;
    const batch = pending; pending = null;
    apply(batch);
  };
  const add = (key, value) => {
    if (!pending) {
      pending = new Map();
      if (frame && !hidden()) raf = frame(flush);
      timer = later(flush, wait);
    }
    pending.set(key, value);
  };
  return { add, flush, get pending() { return pending ? pending.size : 0; } };
}
