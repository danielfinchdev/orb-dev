// Usage guard: the assistant must never burn a whole subscription window.
// - Every agent has a maximum of launches per rolling window, and expensive models a smaller one.
// - When an agent answers "usage/session limit", it goes into cooldown until its reset and nothing else is sent to it.
// - Tasks with agent "any" go to the least used agent that still has room, so work is balanced across subscriptions.
// Since 2.0 every count is per account (a subscription): two Codex accounts have two separate windows.
import { ctx } from './context.mjs';
import { account as findAccount, accounts } from './accounts.mjs';

export const budgetConfig = () => {
  const b = ctx.config?.budget ?? {};
  return { windowHours: b.windowHours ?? 5, agents: b.agents ?? {} };
};
// Limits of an account: its own entry in budget.agents, else its agent's, else the defaults.
const agentOf = (id) => findAccount(id)?.agent ?? id;
const rules = (id) => ({ maxTasks: 6, maxHeavy: 2, ...(budgetConfig().agents[agentOf(id)] ?? {}), ...(budgetConfig().agents[id] ?? {}), heavyModels: ctx.config?.agents?.[agentOf(id)]?.heavyModels ?? [] });
export const isHeavy = (id, model) => Boolean(model && rules(id).heavyModels.includes(model));

// Optional per-task spending cap for Claude (--max-budget-usd), only when the user sets one.
export function taskBudgetUsd(agent, model) {
  const cap = rules(agent).maxBudgetUsd;
  if (!cap) return null;
  if (typeof cap === 'number') return cap;
  return isHeavy(agent, model) ? cap.heavy ?? cap.default ?? null : cap.default ?? null;
}

// Launches of each account inside the rolling window, from the event written at every launch (account, agent and model
// really used). Events without an account belong to the agent's default account (id = agent).
export function windowUsage(board, id) {
  const since = new Date(Date.now() - budgetConfig().windowHours * 3_600_000).toISOString();
  const rows = board.all(`SELECT json_extract(detail, '$.model') AS model FROM events
    WHERE kind = 'task.launch_options' AND at >= ? AND json_valid(detail) AND COALESCE(json_extract(detail, '$.account'), json_extract(detail, '$.agent')) = ?`, since, id);
  return { tasks: rows.length, heavy: rows.filter((r) => isHeavy(id, r.model)).length };
}

export function cooldownUntil(board, id) {
  const until = Number(board.setting(`cooldown:${id}`) ?? 0);
  return until > Date.now() ? until : 0;
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

const nameOf = (id) => findAccount(id)?.label ?? id;

// Can this task be launched on this account right now? { ok, reason } — reason in plain Spanish for the user.
export function canLaunch(board, id, model) {
  const until = cooldownUntil(board, id);
  if (until) return { ok: false, reason: `${nameOf(id)} está sin cupo hasta las ${hhmm(until)}` };
  const r = rules(id); const used = windowUsage(board, id); const h = budgetConfig().windowHours;
  if (used.tasks >= r.maxTasks) return { ok: false, reason: `${nameOf(id)} ya lanzó ${used.tasks} tareas en las últimas ${h} h (máximo ${r.maxTasks})` };
  if (isHeavy(id, model) && used.heavy >= r.maxHeavy) return { ok: false, reason: `${nameOf(id)} ya lanzó ${used.heavy} tareas con modelos caros en las últimas ${h} h (máximo ${r.maxHeavy})` };
  return { ok: true, reason: '' };
}

// Order candidate accounts ([{ id, agent }]) by how much of their window they have used (least used first).
export function rankAccounts(board, candidates, model) {
  return candidates
    .map((acc, index) => ({ account: acc.id, agent: acc.agent, index, check: canLaunch(board, acc.id, model), used: windowUsage(board, acc.id).tasks / Math.max(1, rules(acc.id).maxTasks) }))
    .sort((a, b) => a.used - b.used || a.index - b.index);
}

export function usageReport(board) {
  return accounts().map((acc) => {
    const r = rules(acc.id); const used = windowUsage(board, acc.id);
    return { account: acc.id, agent: acc.agent, label: acc.label, used: used.tasks, max: r.maxTasks, heavy: used.heavy, maxHeavy: r.maxHeavy, cooldownUntil: cooldownUntil(board, acc.id) || null, windowHours: budgetConfig().windowHours };
  });
}

const LIMIT_RE = /(usage limit|session limit|hit your limit|rate limit|limit reached|quota|too many requests|\b429\b|exceeded.*budget|budget.*exceeded|out of credits|límite de uso)/i;
export const isLimitText = (text) => LIMIT_RE.test(String(text ?? ''));
export const isBudgetText = (text) => /budget/i.test(String(text ?? '')) && !/session limit|usage limit/i.test(String(text ?? ''));

// "resets 5:10am", "resets at 17:30", "reset in 2 hours" → epoch ms; otherwise a full window from now.
export function parseReset(text, now = new Date()) {
  const s = String(text ?? '');
  const inHours = s.match(/reset[s]?\s+in\s+(\d+)\s*h/i);
  if (inHours) return now.getTime() + Number(inHours[1]) * 3_600_000;
  const at = s.match(/reset[s]?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (at) {
    let hour = Number(at[1]) % 24; const minute = Number(at[2] ?? 0); const ampm = at[3]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const d = new Date(now); d.setHours(hour, minute, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    if (d.getTime() - now.getTime() <= 8 * 86_400_000) return d.getTime();
  }
  return now.getTime() + budgetConfig().windowHours * 3_600_000;
}

export function startCooldown(board, agent, text) {
  const until = parseReset(text);
  board.setting(`cooldown:${agent}`, String(until));
  return until;
}
