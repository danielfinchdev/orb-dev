// Orb's core folder and the master password seen from the window. No JSX here (the tests load it in Node): the
// dialog that asks for the password (components/master-dialogs.jsx) registers itself with setMasterAsker.
//   unlockCore: every guarded action of the window (opening core, restoring a backup, choosing where backups go,
//     deleting the data of Orb 3.7, a connector's keys, unlinking a phone) asks here first. → the unlock token the engine
//     wants with that call (src/engine/api/master.mjs), or null when the user cancelled. One unlock lasts 5 minutes, or
//     until the window locks or closes (the engine says 'master:locked').
//   passwordStrength: the hint under a new password.
//   coreView: what the screen «Falta la carpeta core» shows (views/core-missing.jsx), kept apart so it can be tested
//     without a window. state: app.coreState ({ missing, home, reason, backup, error, folder }).
//   layoutTitle / layoutOptions: the rows of «Ordenar carpetas» (views/layout.jsx; app.layoutPlan's items).
import { CATEGORIES } from '../../shared/layout.mjs';

let held = null; // { unlock, until, strength }
let asker = null; // (action, { fresh, what }) => Promise<{ unlock, until, strength? } | null>
export const setMasterAsker = (fn) => { asker = fn; };
// A token the engine just gave (master.create, master.change, master.forgot, master.unlockHello) is kept the same way.
// strength: 'hello' for a token made with Windows Hello (a proof of presence), anything else is the password's.
export const keepUnlock = (r) => { held = r?.unlock ? { unlock: r.unlock, until: Number(r.until) || 0, strength: r.strength === 'hello' ? 'hello' : 'password' } : held; return r?.unlock ?? null; };
export const dropUnlock = () => { held = null; };
// Still good for a few seconds more (the call that uses it must arrive in time). needsPassword: the caller is an action that
// shows or saves secrets, which a Windows Hello token never opens (src/domain/security/permissions.mjs › SECRET_METHODS).
export const heldUnlock = (now = Date.now(), { needsPassword = false } = {}) => (held && held.until - 5000 > now && !(needsPassword && held.strength === 'hello') ? held.unlock : null);
// When the held unlock ends (ms), or null when there is none: read-only, for «desbloqueado, quedan N min». The token itself is never exposed.
export const heldUntil = (now = Date.now()) => (held && held.until - 5000 > now ? held.until : null);

// action: 'open' | 'restore' | 'backupFolder' | 'recovery' | 'legacy' | 'secrets' | 'connector' | 'protected' | 'unlink' |
// 'deleteProject' | 'removeExtension' | 'previousKey' | 'androidPair' | 'androidEmulator' | 'fullAccess' | 'android' |
// 'secretSave' | 'secretSaved' | 'rails' | 'ruleSeed' | 'rules'.
// FRESH_ACTIONS ask for the password every time (src/domain/security/permissions.mjs › FRESH_UNLOCK): a held unlock does
// not count, and their token (for that action only) is not kept for the next one. They are deleting a project, saving
// a secret an agent asked for in the vault or using the one saved, any change to a rail (rails) and putting back or
// changing a shipped text rule (ruleSeed).
// «Acceso total» and the Android phone take the usual 5-minute unlock, like editing a rule of your own (rules).
export const FRESH_ACTIONS = Object.freeze(['deleteProject', 'secretSave', 'secretSaved', 'rails', 'ruleSeed', 'newKey']);
// The actions only the password (or the phone's approval) opens, never Windows Hello: what shows, saves or hands out a secret,
// restoring a copy (it brings the secrets of another PC), the new key and turning Hello on. Mirrors PASSWORD_ONLY_METHODS and
// SECRET_PURPOSES; the engine refuses a Hello token for them anyway, this only keeps the window from offering it.
export const PASSWORD_ACTIONS = Object.freeze(['restore', 'secrets', 'connector', 'secretSave', 'secretSaved', 'fullAccess', 'mcpExt', 'newKey', 'hello']);
// The «ask every time» actions Windows Hello may approve (permissions.mjs › HELLO_PURPOSES).
const HELLO_FRESH = Object.freeze(['deleteProject', 'rails', 'ruleSeed']);
export const canUseHello = (action) => !PASSWORD_ACTIONS.includes(action) && (!FRESH_ACTIONS.includes(action) || HELLO_FRESH.includes(action));
// what: the thing the action is about (a project's name), said before Windows' own notice.
// request: { method, params } of the call the token is for; with it the dialog may offer the phone's approval (a token for that call only).
// info: an object that gets `mobile: true` when the token is a phone's (it is for that call only, so nothing else may use it first).
export async function unlockCore(action, { what = null, request = null, info = null } = {}) {
  const fresh = FRESH_ACTIONS.includes(action);
  const have = fresh ? null : heldUnlock(Date.now(), { needsPassword: PASSWORD_ACTIONS.includes(action) });
  if (have) return have;
  if (!asker) return null;
  const r = await asker(action, { fresh, what, request });
  // A phone's approval is for one call: it is never kept for the next one.
  if (info && r?.strength === 'mobile') info.mobile = true;
  return fresh || r?.strength === 'mobile' ? r?.unlock ?? null : keepUnlock(r);
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
// What the strength line says about what was typed: words (pieces split by spaces that hold a letter), digits, numbers (groups
// of digits) and characters, counted in NFC like the engine. Counted here only; nothing leaves the window.
export function passwordShape(password) {
  const p = String(password ?? '').normalize('NFC');
  return {
    words: p.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length,
    digits: (p.match(/\d/g) ?? []).length,
    numbers: (p.match(/\d+/g) ?? []).length,
    chars: [...p].length
  };
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
