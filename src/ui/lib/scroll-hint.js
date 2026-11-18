// Marks the area that is scrolling for a moment (data-scrolling) so app.css can draw its scrollbar thumb only then.
// scroll does not bubble: it is heard in the capture phase.
const timers = new WeakMap();
const IDLE_MS = 600;

if (typeof window !== 'undefined') {
  window.addEventListener('scroll', (e) => {
    const el = e.target?.nodeType === 9 ? e.target.documentElement : e.target;
    if (!el?.setAttribute) return;
    el.setAttribute('data-scrolling', '');
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => el.removeAttribute('data-scrolling'), IDLE_MS));
  }, { capture: true, passive: true });
}
