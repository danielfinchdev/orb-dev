// 2.6: the brains the user can pick for a chat (agent + model), for the selector under the message box: the installed and
// enabled agents with an account, each with its models. The models are the configured ones plus those the agent itself
// reported when a session started (Codex model/list, the ACP agents' model option), kept in settings models:<agent>.
// heavy: models that use the quota faster (heavyModels of each agent, or a known heavy family); usage: how much of its
// window each account has used, as the agent reports it.
import { ctx } from '../core/context.mjs';
import { AGENT_IDS, AGENT_LABELS } from '../core/home.mjs';
import { installed } from '../agents/index.mjs';
import { usableAccounts } from '../core/accounts.mjs';
import { usageReport } from '../core/budget.mjs';

const HEAVY_FAMILY = /opus|(^|[-_.])pro($|[-_.])|ultra|max\b|xhigh|o3\b|o1\b/i;
const MODEL_ID = /^[\w.:\-/[\]=,@]{1,80}$/;

// Models an agent reported itself (several sessions may report them; the last list wins).
export function rememberModels(board, agent, list) {
  if (!AGENT_IDS.includes(agent) || !Array.isArray(list)) return;
  const clean = list.map((m) => (typeof m === 'string' ? { id: m } : m)).filter((m) => MODEL_ID.test(m?.id ?? ''))
    .map((m) => ({ id: m.id, label: String(m.label ?? m.id).slice(0, 60) })).slice(0, 40);
  if (clean.length) board.settingJson(`models:${agent}`, clean);
}

export function modelCatalog(board) {
  const c = ctx.config;
  const usage = Object.fromEntries(usageReport(board).map((u) => [u.account, u.real?.utilization ?? null]));
  const out = [];
  for (const agent of [...new Set([...(c.agentOrder ?? []), ...AGENT_IDS])]) {
    const cfg = c.agents?.[agent];
    if (!cfg?.enabled || !usableAccounts(agent).length || !installed(agent)) continue;
    // Claude: the labelled ids of the assistant's models first (Sonnet 5.5, Opus 5.5…), then its own aliases.
    const labelled = agent === 'claude' ? (c.orchestrator?.models ?? []) : [];
    const seen = new Set();
    const models = [];
    for (const m of [...labelled, ...(board.settingJson(`models:${agent}`) ?? []), ...(cfg.models ?? []).map((id) => ({ id }))]) {
      // An alias (sonnet, opus…) already offered by its full labelled id is not listed twice.
      if (!m?.id || seen.has(m.id) || (/^(sonnet|opus|haiku)$/.test(m.id) && labelled.some((l) => l.id.includes(m.id)))) continue;
      seen.add(m.id);
      const heavy = (cfg.heavyModels ?? []).some((h) => m.id === h || m.id.includes(h)) || HEAVY_FAMILY.test(m.id);
      models.push({ id: m.id, label: m.label ?? (/^[a-z]+$/.test(m.id) ? m.id[0].toUpperCase() + m.id.slice(1) : m.id), heavy });
    }
    out.push({
      id: agent, label: AGENT_LABELS[agent] ?? agent, defaultModel: cfg.defaultModel || '',
      models, accounts: usableAccounts(agent).map((a) => ({ id: a.id, label: a.label, usage: usage[a.id] ?? null }))
    });
  }
  return out;
}
