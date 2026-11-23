// The check that a folder is signed in as the account Orb thinks it is (several accounts of one agent). It runs once per new
// agent process, before the first message goes: the agent itself says who it is (no turn, no plan spent) and Orb compares a
// fingerprint with the one saved when the account signed in. The e-mail never gets here: the adapters hand over { who, hint }
// only, and nothing of it is written to a log or to the chat (the chat names the account by its label).
import { ctx, tr } from '../platform/context.mjs';
import { saveConfig } from '../platform/config.mjs';
import { account, accountsOf } from '../domain/usage/accounts.mjs';

// account id -> { state: 'ok' | 'mismatch' | 'noMail' | 'unchecked', viaKey, at } of the last check (the window shows it).
const states = new Map();
// account id -> the identity a mismatch found, which «Es correcta, recordar esta» may adopt (this PC only).
const found = new Map();
export const identityState = (id) => states.get(id) ?? null;
// The masked hint of the login a mismatch found (for this PC's «recordar esta»), or null.
export const foundHint = (id) => found.get(id)?.hint ?? null;

const label = (id) => account(id)?.label ?? id;

// The other accounts of the same agent that hold the same login (the usage would be counted twice).
export function duplicatesOf(id) {
  const me = account(id); if (!me?.who) return [];
  return accountsOf(me.agent).filter((a) => a.id !== me.id && a.who && a.who === me.who).map((a) => a.id);
}

// Saves who an account is (and the masked hint to recognise it) in the settings. Returns whether anything changed.
export function saveIdentity(id, { who, hint }, emit = () => {}) {
  const acc = account(id); if (!acc || !who) return false;
  if (acc.who === who && (acc.hint ?? null) === (hint ?? null)) return false;
  const c = saveConfig({ accounts: ctx.config.accounts.map((a) => (a.id === id ? { ...a, who, hint: hint ?? null } : a)) });
  emit('config:changed', c);
  return true;
}

// «Es correcta, recordar esta»: takes the identity the last mismatch found as the account's own.
export function rememberIdentity(id, emit = () => {}) {
  const f = found.get(id);
  if (!f) return false;
  found.delete(id);
  saveIdentity(id, f, emit);
  states.set(id, { state: 'ok', viaKey: false, at: Date.now() });
  return true;
}

// What to tell about a mismatch, in the user's words (the label only).
export const identityText = (kind, id) => tr(kind === 'noMail' ? 'msg.acct.identityNoMail' : 'msg.acct.identityMismatch', { account: label(id) });

// live.whoami() of a fresh process → { block, kind, text, notes }.
//   block: the message must not go (the folder holds another login, or no e-mail login where there was one).
//   notes: lines to say in the chat before the turn (it would be paid with an API key; two accounts are the same login).
export async function checkIdentity({ acc, live, fixed = false, emit = () => {} }) {
  const none = { block: false, kind: 'ok', text: '', notes: [] };
  if (!acc || typeof live?.whoami !== 'function') return none;
  const ask = async () => { try { return await live.whoami(); } catch { return null; } };
  const me = account(acc.id) ?? acc;
  let r = await ask();
  // An account that was checked before and now does not answer: one more try; a fixed chat then does not go on, an automatic one says so.
  if (!r && me.who) r = await ask();
  // Never could be checked (an old CLI without the call, no answer in time): the turn goes; the own folder and the clean
  // environment are what keep the accounts apart.
  if (!r) {
    states.set(acc.id, { state: 'unchecked', viaKey: false, at: Date.now() });
    if (!me.who) return none;
    if (fixed) return { block: true, kind: 'unknown', text: tr('msg.acct.identityUnknown', { account: label(acc.id) }), notes: [] };
    return { ...none, notes: [tr('msg.acct.identityUnchecked', { account: label(acc.id) })] };
  }
  const notes = [];
  if (r.viaKey) notes.push(tr('msg.acct.apiKey', { account: label(acc.id) }));
  // The account had an e-mail login before and has none now: an API key, a gateway or a cloud provider answers instead.
  if (!r.who) {
    if (me.who) { states.set(acc.id, { state: 'noMail', viaKey: Boolean(r.viaKey), at: Date.now() }); return { block: true, kind: 'noMail', text: identityText('noMail', acc.id), notes }; }
    states.set(acc.id, { state: 'unchecked', viaKey: Boolean(r.viaKey), at: Date.now() });
    return { ...none, notes };
  }
  if (me.who && me.who !== r.who) {
    found.set(acc.id, { who: r.who, hint: r.hint ?? null });
    states.set(acc.id, { state: 'mismatch', viaKey: Boolean(r.viaKey), at: Date.now() });
    return { block: true, kind: 'mismatch', text: identityText('mismatch', acc.id), notes };
  }
  if (!me.who) saveIdentity(acc.id, r, emit); // first time: remembered for the next checks
  states.set(acc.id, { state: 'ok', viaKey: Boolean(r.viaKey), at: Date.now() });
  const same = duplicatesOf(acc.id);
  if (same.length) notes.push(tr('msg.acct.duplicate', { a: label(acc.id), b: same.map(label).join(', ') }));
  return { block: false, kind: 'ok', text: '', notes };
}

// After a sign-in ends: the agent says who signed in and that is saved as the account's identity (replacing the old one:
// the person signed in on purpose). Never throws.
export async function learnIdentity(id, ask, emit = () => {}) {
  try {
    const r = await ask(id);
    if (!r?.who) return null;
    saveIdentity(id, r, emit);
    found.delete(id);
    states.set(id, { state: 'ok', viaKey: Boolean(r.viaKey), at: Date.now() });
    return duplicatesOf(id);
  } catch { return null; }
}
