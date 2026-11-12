// Normas: which password each change of a rule or a rail asks for, and the small pure helpers of the tab. No JSX and
// no alias imports (the tests load it in Node).
//   'rails'    every change to a rail asks every time (src/domain/security/permissions.mjs › FRESH_UNLOCK)
//   'ruleSeed' putting the shipped rules back, and pausing, deleting or saving a shipped one: every time
//   'rules'    your own rules: the usual 5-minute unlock
export const RULE_METHOD = Object.freeze({ create: 'rules.create', save: 'rules.save', pause: 'rules.pause', resume: 'rules.resume', delete: 'rules.delete', restoreDefaults: 'rules.restoreDefaults' });

// op: a key of RULE_METHOD. rule: the rule it is about ({ de_serie }), when there is one.
export function ruleAction(op, rule) {
  if (op === 'restoreDefaults') return 'ruleSeed';
  if (op === 'pause' || op === 'delete' || op === 'save') return rule?.de_serie ? 'ruleSeed' : 'rules';
  return 'rules';
}
// Every rail change (switch, values, removing one, putting it back) asks every time.
export const railAction = () => 'rails';
// Whether the control asks the password every time (the hint «Pide la contraseña cada vez»).
export const asksEveryTime = (action) => action === 'rails' || action === 'ruleSeed';

// The engine's answer as a list of plain objects: anything else is an empty list, so the tab never breaks.
export const asList = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

// A rule belongs to a side when it is for it or for both.
export const ruleSide = (rule, side) => rule.para === 'ambos' || rule.para === side;
// The rails of a group; the fixed ones (the core) first, in the engine's order.
export function railsOf(rails, group) {
  const mine = asList(rails).filter((r) => r.grupo === group);
  return { fixed: mine.filter((r) => r.fijo), switchable: mine.filter((r) => !r.fijo) };
}

// «Raíles quitados»: the engine only knows on/off, so which paused rails the owner removed from view is kept here.
export const REMOVED_KEY = 'orb.rules.removedRails';
export function readRemoved(storage) {
  try { const v = JSON.parse(storage?.getItem(REMOVED_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export function writeRemoved(storage, ids) {
  try { storage?.setItem(REMOVED_KEY, JSON.stringify([...new Set(ids)])); } catch { /* storage may be blocked: the rail stays paused */ }
}
// A removed rail is one that is off AND was removed; a rail the engine turned on again is not removed any more.
export const isRemoved = (rail, removed) => !rail.fijo && rail.activo === false && removed.includes(rail.id);

// Values the controls edit: key → { min, max } (the engine checks the same limits in src/platform/config.mjs).
export const LIMITS = Object.freeze({
  'budget.stopAt': { min: 50, max: 100, percent: true },
  'budget.weeklyStopAt': { min: 50, max: 100, percent: true },
  'budget.maxFixRounds': { min: 0, max: 10 },
  timeoutMinutes: { min: 5, max: 600 },
  maxParallel: { min: 1, max: 10 },
  perAgent: { min: 1, max: 5 },
  approvalWaitMinutes: { min: 1, max: 240 },
  maxTasks: { min: 1, max: 1000 },
  maxHeavy: { min: 1, max: 1000 }
});
// → the patch for rails.set `values` entry, clamped, or undefined for a value that is not a number.
export function clampValue(key, raw) {
  const lim = LIMITS[key];
  const n = Number(raw);
  if (!lim || raw === '' || raw == null || !Number.isFinite(n)) return undefined;
  const v = Math.min(lim.max, Math.max(lim.min, Math.round(n)));
  return lim.percent ? v / 100 : v;
}
export const shownValue = (key, v) => (LIMITS[key]?.percent && typeof v === 'number' ? Math.round(v * 100) : v);

// The values of a rail as flat «dotted key → value» pairs (a list stays a list), to show a change as before → after.
export function flatten(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) { for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out); } else out[prefix] = obj;
  return out;
}
// → [{ key, before, after }] for every setting that differs; a list is compared as a whole and shown joined.
export function diffValues(before, after) {
  const a = flatten(before ?? {}); const b = flatten(after ?? {});
  const show = (key, v) => (Array.isArray(v) ? v.join(', ') : v === undefined ? '' : String(shownValue(key, v)));
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map((key) => ({ key, before: show(key, a[key]), after: show(key, b[key]) }));
}
// The patch of rails.set `values` out of an edited copy: only the keys that changed, whole (a list or the agents' caps).
export function changedValues(before, after, keys) {
  const out = {};
  for (const key of keys) if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]) && after && Object.hasOwn(after, key)) out[key] = after[key];
  return out;
}
