// «/side»: a question apart about the current chat. It has its own short-lived agent process (same agent, account and model as
// the chat) that is told what the chat has said so far. It never touches the chat: nothing it says or does is written into the
// conversation, it has no Orb tools (no MCP servers), and it runs in «Solo lectura» whatever the chat's permission is, so it can
// never have more than the chat has. Permission requests are denied. It lives in memory only and expires: when the user closes
// it, when its chat goes away, and after a quiet while.
import crypto from 'node:crypto';
import { ctx, tr } from '../platform/context.mjs';
import { adapter, executable } from '../agents/index.mjs';
import { UNGUARDED_AGENTS, requireLevel } from '../agents/unguarded.mjs';
import { AGENT_LABELS } from '../platform/config-file.mjs';
import { account as findAccount, accountEnv } from '../domain/usage/accounts.mjs';
import { pickAccount, recordSpend } from '../domain/usage/budget.mjs';
import { agentKeyEnv } from '../domain/security/agent-keys.mjs';
import { oneLine } from '../shared/text.mjs';

export const SIDE_TTL_MS = 30 * 60_000;      // quiet for this long: it is gone
const SIDE_TURN_MS = 3 * 60_000;      // one answer
const MAX_PER_CHAT = 3;
const LOOKBACK = 40;
// what a side agent may use: look, never change or run (Claude's tool names; the other agents get «leer» from their adapter)
export const SIDE_DENIED = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Skill'];

const textOf = (body) => (typeof body === 'string' ? body : body?.text ?? '');
const parse = (row) => { let body = row.body; if (/^[[{]/.test(body)) { try { body = JSON.parse(body); } catch { /* plain text */ } } return { ...row, body }; };

export class SideChats {
  constructor(sessions) {
    this.sessions = sessions;
    this.make = (agent, options) => adapter(agent).createLive(options); // replaced by tests
    this.map = new Map();        // side id -> { id, parent, live, status, turns: [{ q, a }], expiresAt, error }
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  view(e) { return { id: e.id, parent: e.parent, status: e.status, turns: e.turns, error: e.error ?? null, expiresAt: e.expiresAt }; }
  list(parent) { return [...this.map.values()].filter((e) => e.parent === parent).map((e) => this.view(e)); }
  push(e) { this.sessions.emit('session:side', { id: e.parent, side: e.status === 'closed' ? { id: e.id, closed: true } : this.view(e) }); }

  // what the chat has said (its last texts, as data): the side agent knows the conversation without resuming it
  context(parent) {
    const rows = this.sessions.board.all("SELECT role, kind, body, at FROM session_items WHERE session_id = ? AND kind = 'text' AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT ?", parent, LOOKBACK).reverse().map(parse);
    return rows.map((it) => `${it.role === 'user' ? 'Usuario' : 'Agente'}: ${oneLine(textOf(it.body), 500)}`).join('\n');
  }

  // a new question (or, with `side`, the next one of an open side chat). → the side chat, answering
  ask(parent, question, side = null) {
    const s = this.sessions.must(parent);
    if (s.kind !== 'chat') throw new Error(tr('msg.modes.onlyChats'));
    const text = oneLine(String(question ?? ''), 4000);
    if (!text) throw new Error(tr('msg.side.empty'));
    // an agent Orb cannot guard has no «Solo lectura» to promise: no side chat with it
    if (UNGUARDED_AGENTS.includes(s.agent)) requireLevel('leer', AGENT_LABELS[s.agent] ?? s.agent);
    // Cursor prepares the project's own folder (.cursor rules, one turn at a time) and may write its prompt there: it would share them with the chat
    if (s.agent === 'cursor') throw new Error(tr('msg.side.noCursor'));
    if (s.archived || s.trashed_at) throw new Error(tr('msg.side.gone'));
    let e = side ? this.map.get(side) : null;
    if (side && (!e || e.parent !== parent)) throw new Error(tr('msg.side.gone'));
    if (e?.status === 'running') throw new Error(tr('msg.side.busy'));
    if (!e) {
      if (this.list(parent).length >= MAX_PER_CHAT) throw new Error(tr('msg.side.tooMany', { max: MAX_PER_CHAT }));
      e = { id: crypto.randomUUID(), parent, live: null, status: 'running', turns: [], expiresAt: 0, error: null, first: true };
      this.map.set(e.id, e);
    }
    const turn = { q: text, a: '' };
    e.turns.push(turn); e.status = 'running'; e.error = null; e.expiresAt = Date.now() + SIDE_TTL_MS;
    this.push(e);
    this.run(e, s, turn).catch((error) => { e.status = 'error'; e.error = error.message; this.push(e); });
    return this.view(e);
  }

  async run(e, s, turn) {
    let timer = null;
    try {
      if (!e.live || e.live.isClosed?.()) {
        const acc = s.account ? findAccount(s.account) : pickAccount(this.sessions.board, { agent: s.agent });
        if (!acc) throw new Error(tr('msg.sessions.accountGone', { account: s.account }));
        e.account = acc.id;
        e.live = this.make(s.agent, {
          exe: executable(s.agent), cwd: s.cwd, model: s.model, reasoning: 'low', permission: 'leer', // never above the chat's, whatever it is
          mcpServers: {}, env: { ...accountEnv(acc), ...agentKeyEnv(ctx.master, s.agent), ORB_AGENT: s.agent }, internalDir: ctx.paths.internal, lang: ctx.config.language,
          cfg: ctx.config.agents[s.agent] ?? {}, projectDir: s.project ? s.cwd : null, userAsked: () => [], android: () => false,
          ...(s.agent === 'claude' ? { tools: { allowed: [], disallowed: SIDE_DENIED } } : {}),
          log: () => {},
          onEvent: (ev) => {
            if (ev.type === 'approval') { try { e.live?.respond(ev.request.id, 'deny'); } catch { /* closed */ } }
            if (ev.type === 'item' && ev.role === 'assistant' && ev.kind === 'text') { e.partial = `${e.partial ?? ''}${ev.body}`; }
          }
        });
        e.first = true;
      }
      const lead = e.first ? `${tr('sys.side.prompt')}\n\n<chat>\n${this.context(e.parent)}\n</chat>\n\n` : '';
      e.first = false;
      const result = await Promise.race([e.live.send({ text: `${lead}${tr('sys.side.question', { text: turn.q })}` }), new Promise((resolve) => { timer = setTimeout(() => resolve({ isError: true, timedOut: true, final: tr('msg.side.timeout') }), SIDE_TURN_MS); })]);
      if (result.timedOut || (result.isError && !result.final)) { try { e.live?.close(); } catch { /* gone */ } e.live = null; } // a stuck process does not go on reading
      if (!this.map.has(e.id)) return; // closed meanwhile
      turn.a = String(result.final || result.text || e.partial || '').slice(0, 20000);
      e.partial = '';
      if (result.isError) { e.status = 'error'; e.error = oneLine(turn.a, 300) || tr('msg.side.failed'); if (!result.final) turn.a = ''; }
      else e.status = 'done';
      try { recordSpend(this.sessions.board, { account: e.account, session: e.parent, task: null, usage: result.usage ?? {} }); } catch { /* the spend is only a count */ }
    } finally {
      clearTimeout(timer);
      if (this.map.has(e.id)) { e.expiresAt = Date.now() + SIDE_TTL_MS; this.push(e); }
    }
  }

  close(id) {
    const e = this.map.get(id); if (!e) return { ok: true };
    this.map.delete(id); e.status = 'closed';
    try { e.live?.close(); } catch { /* gone */ }
    this.push(e);
    return { ok: true };
  }
  closeFor(parent) { for (const e of [...this.map.values()]) if (e.parent === parent) this.close(e.id); }
  closeAll() { clearInterval(this.sweeper); for (const id of [...this.map.keys()]) this.close(id); }
  sweep() { for (const e of [...this.map.values()]) if (e.status !== 'running' && Date.now() > e.expiresAt) this.close(e.id); }
}
