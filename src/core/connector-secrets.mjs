// 3.8: the connectors' keys (the `env` of each MCP server in Ajustes › Conectores) live in the master password's vault
// (src/core/master.mjs), never in orb.json. orb.json keeps a reference in their place («orb-secret:mcp/<connector>/<name>»):
// the engine puts the real value back only when it hands the connector to its launcher (src/engine/sessions.mjs). The
// reference names where the value is, but the value is always looked up by the connector's own name and the variable's,
// so a reference copied into another connector does not take that one's key.
// The keys are also tied to the program they were given to (a hash of the connector's command and arguments, kept in the
// vault): a command changed without the master password (orb.json edited by hand, by an agent) gets no keys.
import crypto from 'node:crypto';
import { connectorKey } from './context.mjs';

export const REF = 'orb-secret:';
export const isRef = (v) => typeof v === 'string' && v.startsWith(REF);
export const secretId = (name, key) => `mcp/${connectorKey(name)}/${key}`;
export const refOf = (name, key) => `${REF}${secretId(name, key)}`;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const bindId = (name) => `mcpbind/${connectorKey(name)}`;
// What a connector's keys are tied to: the program it starts.
export const bindingOf = (server) => crypto.createHash('sha256').update(JSON.stringify([String(server?.command ?? ''), (server?.args ?? []).map(String)])).digest('base64').slice(0, 24);
export const hasRefs = (server) => Object.values(server?.env ?? {}).some(isRef);
const sameArgs = (a, b) => JSON.stringify((a ?? []).map(String)) === JSON.stringify((b ?? []).map(String));

// Plain values of `servers` go into the vault. → the list with references in their place, or null when nothing changed.
// Keys of connectors (or variables) that are gone leave the vault too. trusted: the window unlocked this change (or it
// is the first move of the keys of 3.7), so the connectors' keys are tied to their commands as they are now; otherwise
// only a connector given new plain keys is.
export function sealConnectors(master, servers = [], { trusted = false } = {}) {
  if (!master?.unlocked()) return null;
  let changed = false;
  const keep = new Set();
  const out = (servers ?? []).map((s) => {
    if (!s || typeof s !== 'object' || !s.env || typeof s.env !== 'object') return s;
    const env = {};
    let fresh = false;
    for (const [k, v] of Object.entries(s.env)) {
      const id = secretId(s.name, k); keep.add(id);
      if (isRef(v)) { if (v !== refOf(s.name, k)) changed = true; env[k] = refOf(s.name, k); continue; }
      master.set(id, String(v ?? ''));
      env[k] = refOf(s.name, k); changed = true; fresh = true;
    }
    if (Object.keys(env).length) { keep.add(bindId(s.name)); if (fresh || trusted) master.set(bindId(s.name), bindingOf(s)); }
    return { ...s, env };
  });
  for (const id of [...master.ids('mcp/'), ...master.ids('mcpbind/')]) if (!keep.has(id)) master.set(id, null);
  return changed ? out : null;
}
// The keys stored before they were tied to a command (an earlier build of 3.8): tied to it now. → how many.
export function bindMissing(master, servers = []) {
  if (!master?.unlocked()) return 0;
  let n = 0;
  for (const s of servers ?? []) if (s && hasRefs(s) && !master.get(bindId(s.name))) { master.set(bindId(s.name), bindingOf(s)); n++; }
  return n;
}

// What its launcher gets (src/mcp/launch.mjs): the plain values as they are, and for the keys in the vault a one-time
// grant the launcher trades with the vault itself (3.8.1: the keys never pass through the engine). The vault hands them
// only while they are still tied to the program the connector starts (its binding); a key it does not have is left out.
// → { env, vault: { pipe, grant } | null }
export function connectorLaunch(master, server) {
  const env = {}; const vars = {};
  for (const [k, v] of Object.entries(server?.env ?? {})) {
    if (!isRef(v)) env[k] = String(v ?? '');
    else if (ENV_NAME.test(k)) vars[k] = secretId(server.name, k);
  }
  let vault = null;
  if (Object.keys(vars).length && master?.unlocked()) { try { vault = master.grant(bindId(server.name), bindingOf(server), vars); } catch { vault = null; } }
  return { env, vault };
}

// Whether a connector's keys are held back (its command changed without the master password).
export function keysHeld(master, server) {
  if (!hasRefs(server) || !master?.unlocked()) return false;
  try { return master.get(bindId(server.name)) !== bindingOf(server); } catch { return false; }
}

// The window's view of one connector's keys (after the master password): { name: value }. Read by name, whatever the
// command (the owner unlocked to see them).
export function connectorSecrets(master, server) {
  return Object.fromEntries(Object.entries(server?.env ?? {}).map(([k, v]) => {
    if (!isRef(v)) return [k, String(v ?? '')];
    let value = null; try { value = master.get(secretId(server.name, k)); } catch { value = null; }
    return [k, typeof value === 'string' ? value : ''];
  }));
}

// 3.8: a change of the settings that touches what the keys protect (src/core/permissions.mjs › needsUnlock): a connector
// with keys removed or renamed, its command or arguments changed, or one of its keys dropped.
export function touchesKeys(current = [], next = []) {
  for (const c of current ?? []) {
    if (!c || !hasRefs(c)) continue;
    const n = (next ?? []).find((x) => x?.name === c.name);
    if (!n || String(n.command ?? '') !== String(c.command ?? '') || !sameArgs(n.args, c.args)) return true;
    if (Object.entries(c.env ?? {}).some(([k, v]) => isRef(v) && !Object.hasOwn(n.env ?? {}, k))) return true;
  }
  return false;
}

// 3.8.1: a connector whose folder Orb itself moved (into core\mcp, or a new version of it with «Aplicar cambios»): its
// keys go on with the new command when they were tied to the old one (a command changed by someone else stays held).
// before / after: the connectors before and after the move. → how many were tied again.
export function rebindMoved(master, before = [], after = []) {
  if (!master?.unlocked()) return 0;
  let n = 0;
  for (const s of after ?? []) {
    if (!s || !hasRefs(s)) continue;
    const old = (before ?? []).find((x) => x?.name === s.name);
    if (!old || bindingOf(old) === bindingOf(s)) continue;
    let held = null; try { held = master.get(bindId(s.name)); } catch { held = null; }
    if (held !== bindingOf(old)) continue;
    master.set(bindId(s.name), bindingOf(s)); n++;
  }
  return n;
}

// 3.8.1: the same when the vault is locked (no master password typed yet): what has to be tied again waits in `store`
// (the connectors' names and the two bindings, never a key) until it opens (settleRebinds). → the names that wait
export const REBINDS = 'connector_rebinds'; // board setting
export function rebindOrWait(master, before = [], after = [], store) {
  if (master?.unlocked()) { rebindMoved(master, before, after); return []; }
  const wait = [];
  for (const s of after ?? []) {
    if (!s || !hasRefs(s)) continue;
    const old = (before ?? []).find((x) => x?.name === s.name);
    if (!old || bindingOf(old) === bindingOf(s)) continue;
    wait.push({ name: s.name, from: bindingOf(old), to: bindingOf(s) });
  }
  if (!wait.length || !store) return [];
  const list = Array.isArray(store.get()) ? store.get() : [];
  // Moved twice while locked: it waits to go from the first binding to the last.
  const merged = wait.map((w) => { const prev = list.find((x) => x.name === w.name && x.to === w.from); return prev ? { ...w, from: prev.from } : w; });
  store.set([...list.filter((x) => !merged.some((w) => w.name === x.name)), ...merged].slice(-100));
  return merged.map((w) => w.name);
}
// The vault opened: the connectors that waited get their keys tied to where they are now (if still held by the old
// program). → the names tied again
export function settleRebinds(master, store) {
  if (!master?.unlocked() || !store) return [];
  const list = Array.isArray(store.get()) ? store.get() : [];
  if (!list.length) return [];
  const done = [];
  for (const w of list) {
    let held = null; try { held = master.get(bindId(w.name)); } catch { held = null; }
    if (held === w.from) { master.set(bindId(w.name), w.to); done.push(w.name); }
  }
  store.set([]);
  return done;
}
