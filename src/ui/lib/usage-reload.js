// 3.8.2: «Recargar» in the usage panel asks the agents for their plan's usage now (usage.refresh), at most every 20 s
// (the engine keeps the same limit). Kept outside the panel, so closing and opening it does not reset the wait.
export const RELOAD_GAP_MS = 20_000;
let last = 0;
// How long until the next reload is allowed (ms; 0 = now).
export const reloadWait = (now = Date.now(), at = last) => Math.max(0, RELOAD_GAP_MS - (now - at));
export const markReloaded = (now = Date.now()) => { last = now; };
