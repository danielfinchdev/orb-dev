// 3.8.2 (T3 3.4): an agent asks for a secret (an API token, a password for one command) with orb_request_secret. The
// window of this PC shows a private card in that chat; the user types the value there (or uses one saved in the vault,
// or saves the one typed, both with the master password). The value never goes to the chat, the logs, the bitácora, the
// database or a phone: the agent gets a one-time handle, and Orb's helper (src/mcp/secret-run.mjs) trades it on the
// agents' pipe (agent-auth.mjs, a grant `once`) and hands the value to one command as a variable or its stdin, hiding it
// from that command's output. A handle is bound to that agent process (closed, it goes), expires after a few minutes and
// goes with everything still waiting when Orb locks or its password changes (wipe).
// The card and its answer are this PC's only (permissions.mjs: secrets.* 'pc'; the event is not one a phone gets).
import { tr } from '../core/context.mjs';
import { ENV_NAME } from '../core/connector-secrets.mjs';
import { oneLine } from '../core/safety.mjs';

export const ASK_MS = 5 * 60_000; // how long the agent waits for the user
export const HANDLE_MS = 10 * 60_000; // how long a handle may be traded
export const MAX_VALUE = 8 * 1024;
const PER_SESSION = 3; // requests waiting at once in one chat
export const savedId = (name) => `agent/${name}`; // the vault's id of a saved one
export const handleOf = (pipeId, ticket) => `orbsec1.${pipeId}.${ticket}`; // read back by src/mcp/secret-run.mjs

// Whether a typed value is the master password (checked in the vault, no try counted, nothing kept).
async function isMaster(m, value) {
  if (!m?.isPassword) return false;
  try { return (await m.isPassword(value)) === true; } catch { return false; }
}
const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });

// sessions: the engine's (get, addItem); auth: agent-auth.mjs's instance; master(): the vault (ctx.master).
export function createSecretRequests({ sessions, auth, master, emit = () => {}, log = () => {}, askMs = ASK_MS, handleMs = HANDLE_MS }) {
  let seq = 0;
  const pending = new Map(); // id -> { id, session, agent, name, reason, done(result), timer }
  const issued = new Map(); // ticket -> timer
  const view = (r) => {
    let saved = false;
    try { const m = master(); saved = Boolean(m?.unlocked() && m.get(savedId(r.name)) != null); } catch { saved = false; }
    return { id: r.id, session: r.session, agent: r.agent, name: r.name, reason: r.reason, saved };
  };
  const finish = (r, result) => {
    if (pending.get(r.id) !== r) return;
    pending.delete(r.id); clearTimeout(r.timer);
    emit('secret:done', { id: r.id, session: r.session });
    r.done(result);
  };
  const must = (id) => { const r = pending.get(Number(id)); if (!r) throw userError('msg.secrets.gone'); return r; };

  return {
    // The agent's tool (the engine resolves its session from its signed grant, never from an argument). → text for it
    request(s, args = {}) {
      if (!s) throw userError('msg.secrets.noChat');
      const name = String(args.name ?? '');
      if (!ENV_NAME.test(name) || name.length > 64) throw userError('msg.secrets.badName');
      const reason = oneLine(String(args.reason ?? ''), 300);
      if (!reason) throw userError('msg.secrets.noReason');
      if ([...pending.values()].filter((r) => r.session === String(s.id)).length >= PER_SESSION) throw userError('msg.secrets.tooMany');
      return new Promise((resolve) => {
        const r = { id: ++seq, session: String(s.id), agent: String(s.agent ?? ''), name, reason, done: resolve, timer: null };
        r.timer = setTimeout(() => finish(r, tr('msg.secrets.noAnswer', { name })), askMs); r.timer.unref?.();
        pending.set(r.id, r);
        log(`secreto: pedido ${name} · chat ${r.session}`);
        try { sessions.addItem(r.session, 'system', 'status', tr('msg.secrets.asked', { name })); } catch { /* the chat went */ }
        emit('secret:request', view(r));
      });
    },
    // The window's list (also after a reload).
    pending: () => [...pending.values()].map(view),
    // The user's answer on the card: a value typed now (and saved, if asked), or the one saved in the vault.
    async answer({ id, value, save = false, saved = false }) {
      const r = must(id);
      let secret;
      if (saved) {
        try { secret = master()?.get(savedId(r.name)); } catch { secret = null; }
        if (typeof secret !== 'string' || !secret) throw userError('msg.secrets.noSaved');
      } else {
        secret = typeof value === 'string' ? value : '';
        if (!secret || secret.length > MAX_VALUE) throw userError('msg.secrets.badValue');
        // Orb never asks for its master password on this card: a card that gets it (a tricked user) refuses it.
        if (await isMaster(master(), secret)) throw userError('msg.secrets.isMaster');
        if (pending.get(r.id) !== r) throw userError('msg.secrets.gone');
        if (save) master().set(savedId(r.name), secret);
      }
      const ticket = auth.issue({ session: r.session, reply: { secret }, once: true });
      secret = null;
      const timer = setTimeout(() => { issued.delete(ticket); auth.revoke(ticket); }, handleMs); timer.unref?.();
      issued.set(ticket, timer);
      log(`secreto: entregado ${r.name} · chat ${r.session}${save ? ' · guardado en la bóveda' : saved ? ' · de la bóveda' : ''}`);
      finish(r, { name: r.name, handle: handleOf(auth.pipeId, ticket), minutes: Math.round(handleMs / 60_000) });
      return true;
    },
    decline({ id }) { const r = must(id); log(`secreto: rechazado ${r.name} · chat ${r.session}`); finish(r, tr('msg.secrets.declined', { name: r.name })); return true; },
    // Orb locked or its password changed: nothing typed waits any longer, and no handle given can be traded.
    wipe() {
      for (const r of [...pending.values()]) finish(r, tr('msg.secrets.locked', { name: r.name }));
      for (const [ticket, timer] of issued) { clearTimeout(timer); auth.revoke(ticket); }
      issued.clear();
    }
  };
}
