// The API keys of the agents that take one (Grok Build, Devin, Factory Droid…) live in the master password's vault
// (src/domain/security/master.mjs), under «agentkey/<agent>/<VARIABLE>», never in orb.json, a log or the chat. Only the names
// listed here can be stored or handed over: a name that is not in the table of its agent is refused, so the vault cannot
// be used to hand any other variable (PATH, NODE_OPTIONS…) to an agent's process. The value goes only into the
// environment of that agent's own process (src/engine/sessions.mjs) and is hidden from its session log.
// The names come from each CLI's public documentation (not verified against the installed programs).
import { loginState } from '../usage/accounts.mjs';

export const AGENT_KEY_NAMES = Object.freeze({
  grok: Object.freeze(['XAI_API_KEY']),
  devin: Object.freeze(['WINDSURF_API_KEY']),
  droid: Object.freeze(['FACTORY_API_KEY'])
});
const MAX_KEY = 8000;
export const agentKeyId = (agent, name) => `agentkey/${agent}/${name}`;
export const agentKeyNames = (agent) => (Object.hasOwn(AGENT_KEY_NAMES, agent) ? AGENT_KEY_NAMES[agent] : []);
const isAgentKeyName = (agent, name) => agentKeyNames(agent).includes(name);

// Which keys are saved (booleans only: a value never leaves the vault through here). → { <agent>: { <NAME>: boolean } }
export function agentKeyState(master) {
  const open = Boolean(master?.unlocked?.());
  const out = {};
  for (const [agent, names] of Object.entries(AGENT_KEY_NAMES)) {
    out[agent] = {};
    for (const name of names) {
      let has = false;
      if (open) { try { has = typeof master.get(agentKeyId(agent, name)) === 'string' && Boolean(master.get(agentKeyId(agent, name))); } catch { has = false; } }
      out[agent][name] = has;
    }
  }
  return out;
}

// A key from the vault goes only to an account without a subscription login of its own: with a login in its folder the key
// would cover that login and every account of the agent would end up spending the same way.
export const keyEnvAllowed = (acc) => !acc || loginState(acc) !== 'si';

// What goes into the environment of the agent's process: { NAME: value } for the keys saved (none while the vault is locked,
// and none for an account that has a login of its own: see keyEnvAllowed).
export function agentKeyEnv(master, agent, acc) {
  const env = {};
  if (!master?.unlocked?.() || !keyEnvAllowed(acc)) return env;
  for (const name of agentKeyNames(agent)) {
    let v = null; try { v = master.get(agentKeyId(agent, name)); } catch { v = null; }
    if (typeof v === 'string' && v) env[name] = v;
  }
  return env;
}

// Saves a key (an empty value removes it). Throws a plain Error('agent') / Error('name') / Error('value') for bad input.
export function saveAgentKey(master, agent, name, value) {
  if (!isAgentKeyName(agent, name)) throw new Error('name');
  if (typeof value !== 'string' || value.length > MAX_KEY || /[\r\n\0]/.test(value)) throw new Error('value');
  master.set(agentKeyId(agent, name), value || null);
  return Boolean(value);
}
