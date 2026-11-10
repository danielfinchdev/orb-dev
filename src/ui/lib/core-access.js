// 3.8: Orb's core folder and the master password seen from the window. No JSX here (the tests load it in Node): the
// dialog that asks for the password (components/master-dialogs.jsx) registers itself with setMasterAsker.
//   unlockCore: every guarded action of the window (opening core, restoring a backup, choosing where backups go,
//     deleting the data of Orb 3.7, a connector's keys, unlinking a phone) asks here first. → the unlock token the engine
//     wants with that call (src/engine/api-master.mjs), or null when the user cancelled. One unlock lasts 5 minutes, or
//     until the window locks or closes (the engine says 'master:locked').
//   passwordStrength: the hint under a new password.
//   coreView: what the screen «Falta la carpeta core» shows (views/core-missing.jsx), kept apart so it can be tested
//     without a window. state: app.coreState ({ missing, home, reason, backup, error, folder }).
//   layoutTitle / layoutOptions: the rows of «Ordenar carpetas» (views/layout.jsx; app.layoutPlan's items).
import { CATEGORIES } from '../../shared/layout.mjs';

let held = null; // { unlock, until }
let asker = null; // (action) => Promise<{ unlock, until } | null>
export const setMasterAsker = (fn) => { asker = fn; };
// A token the engine just gave (master.create, master.change, master.forgot) is kept the same way.
export const keepUnlock = (r) => { held = r?.unlock ? { unlock: r.unlock, until: Number(r.until) || 0 } : held; return r?.unlock ?? null; };
export const dropUnlock = () => { held = null; };
// Still good for a few seconds more (the call that uses it must arrive in time).
export const heldUnlock = (now = Date.now()) => (held && held.until - 5000 > now ? held.unlock : null);

// action: 'open' | 'restore' | 'backupFolder' | 'recovery' | 'legacy' | 'secrets' | 'connector' | 'protected' | 'unlink' |
// 'deleteProject' | 'removeExtension' | 'previousKey' | 'androidPair' | 'androidEmulator' | 'fullAccess' | 'android' |
// 'secretSave' | 'secretSaved'.
// 3.8.1: FRESH_ACTIONS ask for the password every time (src/domain/security/permissions.mjs › FRESH_UNLOCK): a held unlock does
// not count, and their token (for that action only) is not kept for the next one. 3.8.2: also giving a chat «Acceso
// total al PC» or the Android phone.
// 3.8.2 (security review): saving a secret an agent asked for in the vault, or using the one saved, too.
export const FRESH_ACTIONS = Object.freeze(['deleteProject', 'fullAccess', 'android', 'secretSave', 'secretSaved']);
export async function unlockCore(action) {
  const fresh = FRESH_ACTIONS.includes(action);
  const have = fresh ? null : heldUnlock();
  if (have) return have;
  if (!asker) return null;
  const r = await asker(action, { fresh });
  return fresh ? r?.unlock ?? null : keepUnlock(r);
}

// The master password's shortest length (src/domain/security/master.mjs › MIN_LENGTH; the engine checks it too).
export const MASTER_MIN = 10;
// 0 (too short) … 4 (strong): length first, then kinds of characters, and a few common patterns count less.
export function passwordStrength(password, min = MASTER_MIN) {
  const p = String(password ?? '');
  const n = [...p].length;
  if (n < min) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  let score = n >= 16 ? 3 : n >= 12 ? 2 : 1;
  if (kinds >= 3) score++;
  if (/^(.)\1+$/.test(p) || /^(?:0?123456789|qwerty|password|contrase(?:ñ|n)a)/i.test(p)) score = 1;
  return Math.max(1, Math.min(4, score));
}

// → { body, vars, passphrase, restore, fresh, folder }: the text (key and values), whether the recovery code is asked,
// whether «Restaurar» is offered (a copy that this PC could not open with its own key), how «Seguir sin copia» is
// offered ('yes' when there is no usable copy at all; 'noCode' behind «No tengo el código» when a copy only needs its
// code) and the backups' folder for «Abrir».
export function coreView(state, { when = (iso) => iso ?? '—' } = {}) {
  const s = state ?? {};
  const created = when(s.backup?.created ?? null);
  if (s.reason === 'needsPassphrase') return { body: 'data.core.needsPassphrase', vars: { created }, passphrase: true, restore: true, fresh: 'noCode', folder: s.folder ?? null };
  if (s.reason === 'damaged') return { body: 'data.core.damaged', vars: { created }, passphrase: false, restore: false, fresh: 'yes', folder: s.folder ?? null };
  return { body: 'data.core.noBackup', vars: { home: s.home ?? '' }, passphrase: false, restore: false, fresh: 'yes', folder: s.folder ?? null };
}

// item: { kind: 'logs' | 'adb' | 'mcp', project, choices }. → the key of its name.
export const layoutTitle = (item) => ({ logs: 'layout.logs', adb: 'layout.adb', mcp: 'layout.mcp' })[item?.kind] ?? 'layout.mcp';
// → [{ value, key, vars }] in the order of the item's choices (the categories in their usual order).
export function layoutOptions(item) {
  const choices = item?.choices ?? [];
  const label = (c) => {
    if (c === 'keep') return { key: 'layout.keep' };
    if (c === 'move') return { key: 'layout.move' };
    if (c === 'mcp') return { key: 'layout.moveMcp' };
    return { key: 'layout.asProject', vars: { category: c } };
  };
  const order = (c) => (CATEGORIES.includes(c) ? CATEGORIES.indexOf(c) : c === 'keep' ? 100 : -1);
  return [...choices].sort((a, b) => order(a) - order(b)).map((c) => ({ value: c, ...label(c) }));
}
