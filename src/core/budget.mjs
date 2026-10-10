// Usage guard: the assistant must never burn a whole subscription window.
// - Every agent has a maximum of launches per rolling window, and expensive models a smaller one.
// - When an agent answers "usage/session limit", it goes into cooldown until its reset and nothing else is sent to it.
// - Tasks with agent "any" go to the least used agent that still has room, so work is balanced across subscriptions.
// Since 2.0 every count is per account (a subscription): two Codex accounts have two separate windows.
// 2.3, balance: Claude and Codex now report how much of their real window is used and when it resets (live sessions).
// That real figure is the main guard (stop at budget.stopAt, 92% by default); the launch counts are only a safety net
// with roomier limits, so the app no longer stops working long before the subscription would.
import { ctx, tr } from './context.mjs';
import { localeOf } from './i18n.mjs';
import { account as findAccount, accounts } from './accounts.mjs';

export const budgetConfig = () => {
  const b = ctx.config?.budget ?? {};
  return { windowHours: b.windowHours ?? 5, stopAt: b.stopAt ?? 0.92, agents: b.agents ?? {} };
};
// Limits of an account: its own entry in budget.agents, else its agent's, else the defaults.
const agentOf = (id) => findAccount(id)?.agent ?? id;
const rules = (id) => ({ maxTasks: 20, maxHeavy: 6, ...(budgetConfig().agents[agentOf(id)] ?? {}), ...(budgetConfig().agents[id] ?? {}), heavyModels: ctx.config?.agents?.[agentOf(id)]?.heavyModels ?? [] });
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

// The real usage an account reported last (live sessions): { utilization 0-1, resetAt, window, status, at }.
export function recordRate(board, id, rate) {
  if (!id || !rate) return;
  const prev = board.settingJson(`rate:${id}`) ?? {};
  // Keep the most worrying window: a weekly window at 95% matters more than a 5-hour one at 10%.
  const next = { utilization: rate.utilization ?? prev.utilization ?? null, resetAt: rate.resetAt ?? prev.resetAt ?? null, window: rate.window ?? prev.window ?? null, status: rate.status ?? prev.status ?? null, at: Date.now() };
  // 2.6: every window is kept too (session, weekly, weekly of one model…), for the usage panel next to the message box.
  if (rate.window && rate.utilization != null) {
    const all = Object.fromEntries(Object.entries(board.settingJson(`rates:${id}`) ?? {}).filter(([, w]) => (!w.resetAt || w.resetAt > Date.now()) && Date.now() - (w.at ?? 0) < 7 * 86_400_000));
    all[String(rate.window).slice(0, 40)] = { utilization: rate.utilization, resetAt: rate.resetAt ?? null, status: rate.status ?? null, at: Date.now() };
    board.settingJson(`rates:${id}`, all);
  }
  if (rate.status === 'rejected' && rate.resetAt) { board.setting(`cooldown:${id}`, String(rate.resetAt)); board.setting(`cooldown_reason:${id}`, ''); }
  // A window of one model only (the weekly one of Opus, Fable…) does not stop the whole account: only the panel shows it.
  if (/^seven_day_/.test(String(rate.window ?? ''))) return;
  if (prev.utilization != null && rate.utilization != null && prev.window !== rate.window && prev.utilization > rate.utilization && prev.resetAt > Date.now()) return;
  board.settingJson(`rate:${id}`, next);
}
// The windows an account reported that are still running, the shortest first (session before weekly).
const windowMinutes = (w) => { const m = String(w).match(/(\d+)\s*min/); if (m) return Number(m[1]); if (/five_hour|5h/i.test(w)) return 300; if (/seven_day|week/i.test(w)) return 10080 + (/opus|sonnet|fable|model/i.test(w) ? 1 : 0); return 100000; };
export function rateWindows(board, id) {
  const all = board.settingJson(`rates:${id}`) ?? {};
  return Object.entries(all).filter(([, w]) => (!w.resetAt || w.resetAt > Date.now()) && Date.now() - (w.at ?? 0) < 7 * 86_400_000)
    .map(([window, w]) => ({ window, utilization: w.utilization, resetAt: w.resetAt, status: w.status }))
    .sort((a, b) => windowMinutes(a.window) - windowMinutes(b.window));
}
export function realRate(board, id) {
  const r = board.settingJson(`rate:${id}`);
  if (!r || (r.resetAt && r.resetAt < Date.now())) return null; // that window is over
  if (Date.now() - (r.at ?? 0) > 12 * 3_600_000) return null; // too old to trust
  return r;
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString(localeOf(ctx.config?.language), { hour: '2-digit', minute: '2-digit' });

const nameOf = (id) => findAccount(id)?.label ?? id;

// Can this task be launched on this account right now? { ok, reason } — reason in plain words, in the user's language.
export function canLaunch(board, id, model) {
  const until = cooldownUntil(board, id);
  const why = board.setting(`cooldown_reason:${id}`); // a pause for another reason than quota (plan, login)
  if (until) return { ok: false, reason: why ? tr('msg.budget.paused', { name: nameOf(id), time: hhmm(until), why }) : tr('msg.budget.noQuota', { name: nameOf(id), time: hhmm(until) }) };
  const real = realRate(board, id);
  if (real?.utilization != null && real.utilization >= budgetConfig().stopAt) return { ok: false, reason: tr('msg.budget.realUsed', { name: nameOf(id), pct: Math.round(real.utilization * 100), reset: real.resetAt ? tr('msg.budget.realUsedReset', { time: hhmm(real.resetAt) }) : '' }) };
  const r = rules(id); const used = windowUsage(board, id); const h = budgetConfig().windowHours;
  if (used.tasks >= r.maxTasks) return { ok: false, reason: tr('msg.budget.maxTasks', { name: nameOf(id), tasks: used.tasks, h, max: r.maxTasks }) };
  if (isHeavy(id, model) && used.heavy >= r.maxHeavy) return { ok: false, reason: tr('msg.budget.maxHeavy', { name: nameOf(id), heavy: used.heavy, h, max: r.maxHeavy }) };
  return { ok: true, reason: '' };
}

// Order candidate accounts ([{ id, agent }]) by how much of their window they have used (least used first).
export function rankAccounts(board, candidates, model) {
  return candidates
    .map((acc, index) => ({ account: acc.id, agent: acc.agent, index, check: canLaunch(board, acc.id, model), used: realRate(board, acc.id)?.utilization ?? windowUsage(board, acc.id).tasks / Math.max(1, rules(acc.id).maxTasks) }))
    .sort((a, b) => a.used - b.used || a.index - b.index);
}

export function usageReport(board) {
  return accounts().map((acc) => {
    const r = rules(acc.id); const used = windowUsage(board, acc.id);
    const real = realRate(board, acc.id);
    return { account: acc.id, agent: acc.agent, label: acc.label, used: used.tasks, max: r.maxTasks, heavy: used.heavy, maxHeavy: r.maxHeavy, cooldownUntil: cooldownUntil(board, acc.id) || null, windowHours: budgetConfig().windowHours, stopAt: budgetConfig().stopAt,
      real: real ? { utilization: real.utilization, resetAt: real.resetAt, window: real.window } : null, windows: rateWindows(board, acc.id) };
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

export function startCooldown(board, agent, text, resetAt = null) {
  // The agent's own reset time wins over reading the text (even if it already passed: then the limit is over).
  const until = resetAt ? Math.max(resetAt, Date.now()) : parseReset(text);
  board.setting(`cooldown:${agent}`, String(until));
  board.setting(`cooldown_reason:${agent}`, '');
  return until;
}

// A pause for another reason (the plan does not allow it, no login): nothing is sent to that account for `ms`.
export function pauseAccount(board, id, ms, reason) {
  const until = Date.now() + ms;
  board.setting(`cooldown:${id}`, String(until));
  board.setting(`cooldown_reason:${id}`, reason);
  return until;
}
