// 3.8.1: Orb locks itself after a while without use (decision 20 of the owner): the PC's window shows the lock screen
// (views/master.jsx › MasterLocked) until the master password is typed; the agents keep working. The minutes come from
// Ajustes › Datos (config.ui.lockMinutes, 15 by default). No JSX here: the tests load it in Node.
//   watchIdle({ minutes, onIdle, target, now, every }) → stop(). Any key, click, touch, wheel or pointer move on target
//   counts as use; every `every` ms (and when the window shows again) the time since the last use is checked.
export const LOCK_MINUTES = Object.freeze([5, 10, 15, 30, 60]);
export const DEFAULT_LOCK_MINUTES = 15;
export const lockMinutesOf = (config) => {
  const n = Number(config?.ui?.lockMinutes);
  return Number.isInteger(n) && n >= 1 && n <= 240 ? n : DEFAULT_LOCK_MINUTES;
};
const USE = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'];

export function watchIdle({ minutes, onIdle, target = globalThis.window, doc = globalThis.document, now = () => Date.now(), every = 30_000 }) {
  let last = now(); let fired = false;
  const used = () => { last = now(); fired = false; };
  const check = () => {
    if (fired) return;
    if (now() - last >= Math.max(1, Number(minutes()) || DEFAULT_LOCK_MINUTES) * 60_000) { fired = true; onIdle(); }
  };
  const shown = () => { if (doc?.visibilityState !== 'hidden') check(); };
  for (const e of USE) target?.addEventListener?.(e, used, { passive: true, capture: true });
  doc?.addEventListener?.('visibilitychange', shown);
  const id = setInterval(check, every);
  return () => {
    clearInterval(id);
    for (const e of USE) target?.removeEventListener?.(e, used, { capture: true });
    doc?.removeEventListener?.('visibilitychange', shown);
  };
}
