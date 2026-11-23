// «Sugerir el siguiente mensaje» (Ajustes, off by default: it spends plan). When a chat's turn ends cleanly, one short request to
// the cheapest model of the chat's own agent proposes what the user may want to say next. It goes to the box as grey text; the user
// takes it with Tab and it is never sent by itself. One request per turn, cancelled as soon as the user starts typing or sends.
import { ctx } from '../platform/context.mjs';
import { account as findAccount, defaultAccount, accountEnv } from '../domain/usage/accounts.mjs';
import { checkIdentity } from './identity.mjs';
import { adapter, executable, installed } from '../agents/index.mjs';
import { UNGUARDED_AGENTS } from '../agents/unguarded.mjs';
import { recordSpend } from '../domain/usage/budget.mjs';
import { chooseModel } from './usage/catalog.mjs';
import { agentKeyEnv } from '../domain/security/agent-keys.mjs';
import { oneLine } from '../shared/text.mjs';

const TIMEOUT_MS = 30_000;
const SUGGEST_MAX = 160;

const suggestOn = () => ctx.config?.suggestNext === true;

// what the model said as a message for the box: one line, no quotes, nothing when it had no good idea
export function cleanSuggestion(text) {
  const line = oneLine(String(text ?? '').split('\n').find((l) => l.trim()) ?? '', 400).replace(/^["'«“`\s]+|["'»”`\s]+$/g, '').trim();
  if (!line || /^(ninguno|ninguna|none|n\/a|-)\.?$/i.test(line)) return '';
  return line.length > SUGGEST_MAX ? '' : line;
}

export class Suggester {
  constructor(sessions) {
    this.sessions = sessions;
    this.pending = new Map(); // chat id -> { live, cancelled }
    this.make = (agent, options) => adapter(agent).createLive(options); // replaced by tests
  }

  cancel(id) {
    const p = this.pending.get(id); if (!p) return false;
    p.cancelled = true; this.pending.delete(id);
    try { p.live?.close(); } catch { /* gone */ }
    return true;
  }

  // called when a chat's turn ends. → the request started (or not: off, stopped turn, queue, goal…)
  after(id, { request = '', result, stopped = false }) {
    if (!suggestOn() || stopped || !result || result.isError || result.limit) return false;
    const { sessions } = this; const s = sessions.get(id);
    if (!s || s.kind !== 'chat' || s.archived || s.trashed_at || UNGUARDED_AGENTS.includes(s.agent)) return false;
    if (sessions.queue(id).length || sessions.pendingApprovals(id).length || sessions.board.settingJson(`goal:${id}`)?.status === 'active') return false;
    const answer = String(result.final || result.text || '').trim();
    if (!answer || (process.env.ORB_FAKE_AGENTS && !this.fake)) return false;
    this.cancel(id);
    const p = { live: null, cancelled: false }; this.pending.set(id, p);
    this.run(id, s, p, request, answer).catch(() => {}).finally(() => { if (this.pending.get(id) === p) this.pending.delete(id); });
    return true;
  }

  async run(id, s, p, request, answer) {
    if (!installed(s.agent)) return;
    const chosen = s.account ? findAccount(s.account) : null;
    const acc = (chosen?.agent === s.agent ? chosen : null) ?? defaultAccount(s.agent) ?? { id: s.agent, agent: s.agent };
    const light = s.agent === 'cursor' ? { model: null } : chooseModel(this.sessions.board, s.agent, 'simple', acc.id);
    const lang = ctx.config.language === 'en' ? 'English' : 'español';
    const prompt = `Eres el autocompletado del siguiente mensaje de un usuario a su agente de programación. Escribe SOLO el mensaje corto (como máximo 12 palabras, en ${lang}, sin comillas) que el usuario probablemente enviará ahora, o la palabra NINGUNO si no hay una continuación clara. No lo expliques.\n\nÚltimo mensaje del usuario:\n${oneLine(request, 600)}\n\nRespuesta del agente:\n${answer.slice(-1500)}`;
    try {
      p.live = this.make(s.agent, {
        exe: executable(s.agent), cwd: ctx.paths.runs, model: light.model || (s.agent === 'claude' ? 'haiku' : null), reasoning: 'low', permission: 'leer',
        mcpServers: {}, env: { ...accountEnv(acc), ...agentKeyEnv(ctx.master, s.agent, acc) }, internalDir: ctx.paths.internal, lang: ctx.config.language,
        ...(s.agent === 'claude' ? { tools: { allowed: [], disallowed: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Skill', 'Read', 'Glob', 'Grep'] } } : {}),
        log: () => {}, onEvent: () => {}
      });
      let timer = null;
      if ((await checkIdentity({ acc, live: p.live })).block) return; // another login than the account's: nothing is spent
      const result = await Promise.race([p.live.send({ text: prompt }), new Promise((resolve) => { timer = setTimeout(() => resolve({ isError: true }), TIMEOUT_MS); })]).finally(() => clearTimeout(timer));
      try { recordSpend(this.sessions.board, { account: acc.id, session: id, task: null, usage: result?.usage ?? {} }); } catch { /* only a count */ }
      if (p.cancelled || result?.isError) return;
      const text = cleanSuggestion(result.final || result.text);
      if (text && !this.sessions.running.has(id)) this.sessions.emit('session:suggest', { id, text });
    } finally { try { p.live?.close(); } catch { /* gone */ } }
  }
}
