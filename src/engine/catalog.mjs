// 2.6: the brains the user can pick for a chat (agent + model), for the selector under the message box: the installed and
// enabled agents with an account, each with its models. The models are the configured ones plus those the agent itself
// reports, kept in settings models:<agent>: asked to the agent in the background (discoverModels: at start once every
// 12 h, when «Comprobar» is pressed, and when the selector wants an agent that has none yet) and when a session starts
// (Codex model/list, the ACP agents' model option).
// heavy: models that use the quota faster (heavyModels of each agent, or a known heavy family); usage: how much of its
// window each account has used, as the agent reports it.
import { ctx } from '../core/context.mjs';
import { AGENT_IDS, AGENT_LABELS } from '../core/home.mjs';
import { installed, discoverModels } from '../agents/index.mjs';
import { usableAccounts } from '../core/accounts.mjs';
import { usageReport, HEAVY_FAMILY, canLaunch } from '../core/budget.mjs';
const MODEL_ID = /^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/;
// 2.7: the light models (fast and cheap) by their names; heavy ones by HEAVY_FAMILY; everything else is «balanced».
const LIGHT = /haiku|mini\b|nano|flash|lite\b|small|spark/i;
export const MODELS_EVERY = 12 * 3_600_000; // how often an agent is asked again for its models
const RETRY_AFTER = 3_600_000; // after an agent that did not answer

// Models an agent reported itself (the last list wins): its own names (label), which one it uses by default (default) and,
// for an alias, the model it stands for (resolved). Returns whether the list changed (the window is told so).
export function rememberModels(board, agent, list) {
  if (!AGENT_IDS.includes(agent) || !Array.isArray(list)) return false;
  const seen = new Set(); let marked = false;
  const clean = [];
  for (const raw of list) {
    const m = typeof raw === 'string' ? { id: raw } : raw;
    if (!MODEL_ID.test(m?.id ?? '') || seen.has(m.id)) continue;
    seen.add(m.id);
    // Names only (they reach the assistant's instructions): letters, digits, spaces and a few signs; nothing that reads
    // as a sentence of instructions survives the 40-character cap.
    const label = String(m.label ?? m.id).replace(/[^\p{L}\p{N} ._()+\-/:,]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40) || m.id;
    const item = { id: m.id, label };
    if (m.default && !marked) { item.default = true; marked = true; }
    if (typeof m.resolved === 'string' && m.resolved !== m.id && MODEL_ID.test(m.resolved)) item.resolved = m.resolved;
    clean.push(item);
    if (clean.length >= 40) break;
  }
  if (!clean.length) return false;
  board.setting(`models_at:${agent}`, String(Date.now()));
  const next = JSON.stringify(clean);
  if (board.setting(`models:${agent}`) === next) return false;
  board.setting(`models:${agent}`, next);
  board.setting('models_rev', String(Date.now())); // a new list: the cached catalog is stale
  board.changed('models'); // the selector reads the catalog again
  return true;
}

// Asks an agent for its models in the background (one question at a time per agent). Without force, not when it answered
// in the last 12 h, nor when it was asked in the last hour. Resolves with whether the list changed; never rejects.
const asking = new Map();
let serial = Promise.resolve();
export function refreshModels(board, agent, { force = false, log = () => {} } = {}) {
  if (asking.has(agent)) return asking.get(agent);
  const now = Date.now();
  const answered = Number(board.setting(`models_at:${agent}`) || 0);
  const tried = Number(board.setting(`models_try:${agent}`) || 0);
  if (!force && (now - answered < MODELS_EVERY || now - tried < RETRY_AFTER)) return Promise.resolve(false);
  if (!AGENT_IDS.includes(agent) || !ctx.config.agents?.[agent]?.enabled || !installed(agent)) return Promise.resolve(false);
  board.setting(`models_try:${agent}`, String(now));
  // One agent at a time (each question starts that agent's program): never all of them at once at the first start.
  const job = (serial = serial.catch(() => null).then(() => discoverModels(agent)))
    .then((list) => { if (!list) { log(`modelos de ${agent}: el agente no los ha dicho`); return false; } return rememberModels(board, agent, list); })
    .catch((error) => { log(`modelos de ${agent}: ${error?.message ?? error}`); return false; })
    .finally(() => asking.delete(agent));
  asking.set(agent, job);
  return job;
}

// Every enabled and installed agent with an account, one after another (each one is a short process).
export async function refreshAllModels(board, options = {}) {
  let changed = false;
  for (const agent of AGENT_IDS) {
    if (!ctx.config.agents?.[agent]?.enabled || !usableAccounts(agent).length) continue;
    try { changed = (await refreshModels(board, agent, options)) || changed; } catch { /* the next one */ }
  }
  return changed;
}

// discover: the agents with no models known yet are asked in the background (the window hears when they answer).
export function modelCatalog(board, { discover = false, log } = {}) {
  const c = ctx.config;
  const usage = Object.fromEntries(usageReport(board).map((u) => [u.account, u.real?.utilization ?? null]));
  const out = [];
  for (const agent of [...new Set([...(c.agentOrder ?? []), ...AGENT_IDS])]) {
    const cfg = c.agents?.[agent];
    if (!cfg?.enabled || !usableAccounts(agent).length || !installed(agent)) continue;
    const known = board.settingJson(`models:${agent}`) ?? [];
    if (discover && !known.length) refreshModels(board, agent, { log });
    // Claude: the labelled ids of the assistant's models first (Sonnet 5.5, Opus 5.5…), then the ones Claude Code offers
    // and its aliases. The others: first their own default (named after the model the agent says it uses).
    const labelled = agent === 'claude' ? (c.orchestrator?.models ?? []) : [];
    const usual = known.find((m) => m.default);
    const seen = new Set(); const stands = new Set();
    const models = agent === 'claude' ? [] : [{ id: '', label: usual?.label ?? '', defaultOf: usual?.label ?? null, heavy: false }];
    for (const m of [...labelled, ...known, ...(cfg.models ?? []).map((id) => ({ id }))]) {
      // An alias (sonnet, opus…) already offered by its full id is not listed twice.
      if (!m?.id || seen.has(m.id) || (/^(sonnet|opus|haiku)$/.test(m.id) && labelled.some((l) => l.id.includes(m.id)))) continue;
      if (m.resolved && (seen.has(m.resolved) || stands.has(m.resolved))) continue;
      seen.add(m.id); if (m.resolved) stands.add(m.resolved);
      const heavy = (cfg.heavyModels ?? []).some((h) => m.id === h || m.id.includes(h)) || HEAVY_FAMILY.test(m.id);
      // 2.6: «Recomendados» at the top of the selector: the assistant's own Claude models and the model Codex uses by default.
      const recommended = agent === 'claude' ? labelled.some((l) => l.id === m.id) : agent === 'codex' && Boolean(usual) && m.id === usual.id;
      const name = m.label ?? (/^[a-z]+$/.test(m.id) ? m.id[0].toUpperCase() + m.id.slice(1) : m.id);
      models.push({ id: m.id, label: name, heavy, tier: heavy ? 'heavy' : LIGHT.test(`${m.id} ${name}`) ? 'light' : 'balanced', ...(recommended ? { recommended: true } : {}) });
    }
    out.push({
      id: agent, label: AGENT_LABELS[agent] ?? agent, defaultModel: cfg.defaultModel || '', strengths: cfg.strengths ?? '',
      models, accounts: usableAccounts(agent).map((a) => ({ id: a.id, label: a.label, usage: usage[a.id] ?? null }))
    });
  }
  return out;
}

// 2.7: «Orb elige el modelo»: the model and reasoning for a task, from how hard it is (level, set by the assistant:
// simple / normal / complejo) and the «ahorro ↔ uso» slider (budget.profile). Light models for the simple, balanced for
// the everyday, the most capable for the hard ones, always the newest of each kind the agent offers. A heavy model only
// while the account has room for one; Fable last (it may need extra credits); Cursor keeps its own «Auto».
export const LEVELS = ['simple', 'normal', 'complejo'];
const TARGET = [['light', 'light', 'balanced'], ['light', 'balanced', 'balanced'], ['light', 'balanced', 'heavy'], ['balanced', 'balanced', 'heavy'], ['balanced', 'heavy', 'heavy']];
const REASONING = [['low', 'low', 'medium'], ['low', 'medium', 'medium'], ['low', 'medium', 'high'], ['medium', 'medium', 'high'], ['medium', 'high', 'high']];
const FALLBACK = { light: ['light', 'balanced', 'heavy'], balanced: ['balanced', 'heavy', 'light'], heavy: ['heavy', 'balanced', 'light'] };
const version = (m) => { const n = String(m.label ?? m.id).match(/(\d+(?:\.\d+)?)/); return n ? parseFloat(n[1]) : 0; };
export function chooseModel(board, agent, level = 'normal', accountId = agent) {
  const li = LEVELS.includes(level) ? LEVELS.indexOf(level) : 1;
  const profile = [0, 1, 2, 3, 4].includes(ctx.config.budget?.profile) ? ctx.config.budget.profile : 2;
  let reasoning = REASONING[profile][li];
  // «high» waits for the user's approval when the policy says so: Orb never makes a task wait by choosing it itself.
  if (reasoning === 'high' && ctx.config.policy?.highNeedsApproval !== false) reasoning = 'medium';
  if (!(ctx.config.policy?.reasoning ?? ['low', 'medium', 'high']).includes(reasoning)) reasoning = 'medium';
  const base = { model: null, label: null, tier: null, reasoning, level: LEVELS[li], profile };
  if (agent === 'cursor') return base; // Cursor's «Auto» already chooses for each request
  const entry = modelCatalog(board).find((a) => a.id === agent);
  const models = (entry?.models ?? []).filter((m) => m.id);
  if (!models.length) return base;
  const rank = (a, b) => Number(/fable/i.test(a.id)) - Number(/fable/i.test(b.id)) || Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)) || version(b) - version(a);
  let wanted = TARGET[profile][li];
  for (const tier of FALLBACK[wanted]) {
    const list = models.filter((m) => m.tier === tier).sort(rank);
    if (!list.length) continue;
    // The heavy one only if the account still has room for heavy work in this window; otherwise the next kind.
    if (tier === 'heavy' && wanted === 'heavy' && !canLaunch(board, accountId, list[0].id).ok) { wanted = 'balanced'; continue; }
    return { ...base, model: list[0].id, label: list[0].label, tier };
  }
  return base;
}
