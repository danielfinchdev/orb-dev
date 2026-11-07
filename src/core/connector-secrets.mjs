// 3.8: the connectors' keys (the `env` of each MCP server in Ajustes › Conectores) live in the master password's vault
// (src/core/master.mjs), never in orb.json. orb.json keeps a reference in their place («orb-secret:mcp/<connector>/<name>»):
// the engine puts the real value back only when it hands the connector to its launcher (src/engine/sessions.mjs). The
// reference names where the value is, but the value is always looked up by the connector's own name and the variable's,
// so a reference copied into another connector does not take that one's key.
import { connectorKey } from './context.mjs';

export const REF = 'orb-secret:';
export const isRef = (v) => typeof v === 'string' && v.startsWith(REF);
export const secretId = (name, key) => `mcp/${connectorKey(name)}/${key}`;
export const refOf = (name, key) => `${REF}${secretId(name, key)}`;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

// Plain values of `servers` go into the vault. → the list with references in their place, or null when nothing changed.
// Keys of connectors (or variables) that are gone leave the vault too.
export function sealConnectors(master, servers = []) {
  if (!master?.unlocked()) return null;
  let changed = false;
  const keep = new Set();
  const out = (servers ?? []).map((s) => {
    if (!s || typeof s !== 'object' || !s.env || typeof s.env !== 'object') return s;
    const env = {};
    for (const [k, v] of Object.entries(s.env)) {
      const id = secretId(s.name, k); keep.add(id);
      if (isRef(v)) { if (v !== refOf(s.name, k)) changed = true; env[k] = refOf(s.name, k); continue; }
      master.set(id, String(v ?? ''));
      env[k] = refOf(s.name, k); changed = true;
    }
    return { ...s, env };
  });
  for (const id of master.ids('mcp/')) if (!keep.has(id)) master.set(id, null);
  return changed ? out : null;
}

// The connector's env with its real values (what its launcher gets). A key the vault does not have (locked, or lost)
// is left out.
export function resolveEnv(master, server) {
  const out = {};
  for (const [k, v] of Object.entries(server?.env ?? {})) {
    if (!isRef(v)) { out[k] = String(v ?? ''); continue; }
    let value = null; try { value = master?.unlocked() ? master.get(secretId(server.name, k)) : null; } catch { value = null; }
    if (typeof value === 'string') out[k] = value;
  }
  return out;
}

// The window's view of one connector's keys (after the master password): { name: value }.
export function connectorSecrets(master, server) {
  return Object.fromEntries(Object.keys(server?.env ?? {}).map((k) => [k, resolveEnv(master, { name: server.name, env: { [k]: server.env[k] } })[k] ?? '']));
}
