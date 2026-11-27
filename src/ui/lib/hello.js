// Windows Hello seen from the window, as plain functions (no JSX: the tests load this in Node). The engine's
// master.helloState says {available, enabled, valid?, tpm?, at?, waitUntil?, changed?}; the components in views/hello.jsx draw it.

// → 'off' (can be turned on) | 'on' | 'noChip' (on, without a security chip) | 'changed' (Windows' keys changed: turn it on
// again) | 'none' (this PC has no Windows Hello set up, or it is not Windows) | 'unknown' (the engine did not answer).
export function helloMode(state) {
  if (!state || typeof state !== 'object') return 'unknown';
  if (state.enabled === true) {
    if (state.changed === true || state.valid === false) return 'changed';
    return state.tpm === false ? 'noChip' : 'on';
  }
  return state.available === true ? 'off' : 'none';
}
// Whether the button «Usar Windows Hello» may be offered now.
export const helloUsable = (state) => ['on', 'noChip'].includes(helloMode(state));
// The wait after too many cancelled or failed notices (30 s): whole seconds left, 0 when it is over or there is none.
export function waitSeconds(until, now = Date.now()) {
  const at = typeof until === 'number' ? until : Date.parse(until ?? '');
  return Number.isFinite(at) && at > now ? Math.ceil((at - now) / 1000) : 0;
}
// The actions Windows Hello may approve, with the words that finish «Vas a …»; the others read the generic line.
const DO_KEYS = new Set(['open', 'backupFolder', 'legacy', 'protected', 'unlink', 'deleteProject', 'previousKey', 'removeExtension', 'rails', 'ruleSeed', 'rules', 'linkCode', 'android', 'androidPair', 'androidEmulator', 'lock']);
export const helloDoKey = (action, what = null) => {
  if (action === 'deleteProject' && what) return 'hello.do.deleteProjectNamed';
  return DO_KEYS.has(action) ? `hello.do.${action}` : 'hello.do.other';
};
