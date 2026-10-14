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
import { account as findAccount, accounts, usableAccounts } from './accounts.mjs';

export const budgetConfig = () => {
  const b = ctx.config?.budget ?? {};
  return { windowHours: b.windowHours ?? 5, stopAt: b.stopAt ?? 0.92, agents: b.agents ?? {} };
};
// Limits of an account: its own entry in budget.agents, else its agent's, else the defaults.
const agentOf = (id) => findAccount(id)?.agent ?? id;
// 3.1: the limits are set for a Pro-like plan and scale with the account's real plan (engine/plans.mjs): a Max 20x or a
// ChatGPT Pro takes much more work before its real usage is known; a free or Go plan, less and no heavy models.
const PLAN_FACTOR = {
  claude: { free: 0.5, pro: 1, max5: 4, max20: 12, team: 2, enterprise: 4 },
  // 3.2: Pro Lite (ChatGPT's smaller Pro), between Plus and Pro.
  codex: { free: 0.5, go: 0.75, plus: 1, edu: 1, team: 1.5, business: 1.5, prolite: 2.5, pro: 5, enterprise: 3 },
  cursor: { free: 0.5, pro: 1, business: 1.5, proplus: 2, ultra: 6 }
};
const NO_HEAVY = new Set(['free', 'go']);
export function planOf(board, id) { const p = board?.settingJson?.(`plan:${id}`); return p?.plan ? p : null; }
const rules = (id, board = null) => {
  const base = { maxTasks: 20, maxHeavy: 6, ...(budgetConfig().agents[agentOf(id)] ?? {}), ...(budgetConfig().agents[id] ?? {}), heavyModels: ctx.config?.agents?.[agentOf(id)]?.heavyModels ?? [] };
  const plan = planOf(board, id)?.plan;
  const f = plan ? PLAN_FACTOR[agentOf(id)]?.[plan] : null;
  if (!f) return base;
  return { ...base, maxTasks: Math.max(1, Math.round(base.maxTasks * f)), maxHeavy: NO_HEAVY.has(plan) ? 0 : Math.round(base.maxHeavy * f), plan };
};
// Models that use the quota faster: the agent's heavyModels and, 2.7, any of a known heavy family (Opus, Fable, Pro…), so
// a model Orb picks by its full name (claude-opus-5-5) counts as heavy too, not only the alias «opus».
export const HEAVY_FAMILY = /opus|fable|(^|[-_.])pro($|[-_.])|ultra|max\b|xhigh|o3\b|o1\b/i;
export const isHeavy = (id, model) => Boolean(model && (rules(id).heavyModels.includes(model) || HEAVY_FAMILY.test(model)));

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

// 3.2.1: a limit of one model only (Cursor's API models: «Switch to a different model … to continue with Gemini») stops that
// model on that account, never the whole account: the other models (Cursor's own, Auto) keep working.
export const MODEL_LIMIT_RE = /switch to a different model|continue with this model|to continue with \w|limit (of|for) this model|model'?s? (usage )?limit/i;
export const isModelLimitText = (text) => MODEL_LIMIT_RE.test(String(text ?? ''));
const modelKey = (id, model) => `model_limit:${id}:${String(model).slice(0, 80)}`;
export function modelLimitUntil(board, id, model) {
  if (!model) return 0;
  const until = Number(board.setting(modelKey(id, model)) ?? 0);
  return until > Date.now() ? until : 0;
}
export function blockModel(board, id, model, text = '', resetAt = null) {
  const until = resetAt ? Math.max(resetAt, Date.now()) : parseReset(text);
  board.setting(modelKey(id, model), String(until));
  board.setting(`model_limit_at:${id}:${String(model).slice(0, 80)}`, String(Date.now()));
  board.setting('models_rev', String(Date.now())); // the brain selector reads the catalog again (the model shows as without usage)
  board.changed?.('models');
  return until;
}
// The models of an account that are without usage now: { model: until }.
export function modelLimits(board, id) {
  const out = {};
  for (const r of board.all("SELECT key, value FROM settings WHERE key LIKE ? AND value <> ''", `model_limit:${id}:%`)) {
    const until = Number(r.value) || 0;
    if (until > Date.now()) out[r.key.slice(`model_limit:${id}:`.length)] = until;
  }
  return out;
}

// 3.2.1: the user lifts a pause by hand (Agentes › Uso de cada cuenta), also the models without usage of that account.
export function clearCooldown(board, id, { models = true } = {}) {
  board.setting(`cooldown:${id}`, ''); board.setting(`cooldown_reason:${id}`, ''); board.setting(`cooldown_at:${id}`, '');
  if (models) for (const r of board.all("SELECT key FROM settings WHERE key LIKE ? AND value <> ''", `model_limit:${id}:%`)) board.setting(r.key, '');
  board.setting('models_rev', String(Date.now()));
  board.changed?.('settings');
}

// 3.2.1: a task of that account that ends well proves the account (and the model it used) works again: a usage pause set
// before that task started is lifted. Not a pause for another reason (plan, login): those have their own way out.
export function liftAfterSuccess(board, id, model, launchedAt) {
  const since = Date.parse(launchedAt ?? '') || 0;
  const lifted = [];
  if (cooldownUntil(board, id) && !board.setting(`cooldown_reason:${id}`) && Number(board.setting(`cooldown_at:${id}`) || 0) <= since) {
    board.setting(`cooldown:${id}`, ''); board.setting(`cooldown_at:${id}`, ''); lifted.push('account');
  }
  if (model && modelLimitUntil(board, id, model) && Number(board.setting(`model_limit_at:${id}:${String(model).slice(0, 80)}`) || 0) <= since) {
    board.setting(modelKey(id, model), ''); board.setting('models_rev', String(Date.now())); lifted.push('model');
  }
  return lifted;
}

// 3.2.1: the earliest moment this account can take a task with this model, when it is paused (0 when it is not).
export function blockedUntil(board, id, model = null) {
  return Math.max(cooldownUntil(board, id), modelLimitUntil(board, id, model));
}

// The real usage an account reported last (live sessions): { utilization 0-1, resetAt, window, status, at }.
export function recordRate(board, id, rate) {
  if (!id || !rate) return;
  // 3.2.1: one model without usage (Cursor's API models): only that model waits; nothing else of the account changes.
  if (rate.model) { if (rate.status === 'rejected') blockModel(board, id, rate.model, rate.text ?? '', rate.resetAt ?? null); return; }
  const prev = board.settingJson(`rate:${id}`) ?? {};
  // Keep the most worrying window: a weekly window at 95% matters more than a 5-hour one at 10%.
  const next = { utilization: rate.utilization ?? prev.utilization ?? null, resetAt: rate.resetAt ?? prev.resetAt ?? null, window: rate.window ?? prev.window ?? null, status: rate.status ?? prev.status ?? null, at: Date.now() };
  // 2.6: every window is kept too (session, weekly, weekly of one model…), for the usage panel next to the message box.
  if (rate.window && rate.utilization != null) {
    const all = Object.fromEntries(Object.entries(board.settingJson(`rates:${id}`) ?? {}).filter(([, w]) => (!w.resetAt || w.resetAt > Date.now()) && Date.now() - (w.at ?? 0) < 7 * 86_400_000));
    all[String(rate.window).slice(0, 40)] = { utilization: rate.utilization, resetAt: rate.resetAt ?? null, status: rate.status ?? null, at: Date.now() };
    board.settingJson(`rates:${id}`, all);
  }
  if (rate.status === 'rejected' && rate.resetAt) { board.setting(`cooldown:${id}`, String(rate.resetAt)); board.setting(`cooldown_reason:${id}`, ''); board.setting(`cooldown_at:${id}`, String(Date.now())); }
  // A window of one model only (the weekly one of Opus, Fable…) does not stop the whole account: only the panel shows it.
  if (/^seven_day_/.test(String(rate.window ?? ''))) return;
  if (prev.utilization != null && rate.utilization != null && prev.window !== rate.window && prev.utilization > rate.utilization && prev.resetAt > Date.now()) return;
  board.settingJson(`rate:${id}`, next);
}
// The windows an account reported that are still running, the shortest first (session before weekly).
export const windowMinutes = (w) => { const m = String(w).match(/(\d+)\s*min/); if (m) return Number(m[1]); if (/five_hour|5h/i.test(w)) return 300; if (/seven_day|week/i.test(w)) return 10080 + (/opus|sonnet|fable|model/i.test(w) ? 1 : 0); return 100000; };
export function rateWindows(board, id) {
  const all = board.settingJson(`rates:${id}`) ?? {};
  return Object.entries(all).filter(([, w]) => (!w.resetAt || w.resetAt > Date.now()) && Date.now() - (w.at ?? 0) < 7 * 86_400_000)
    .map(([window, w]) => ({ window, utilization: w.utilization, resetAt: w.resetAt, status: w.status, at: w.at ?? null }))
    .sort((a, b) => windowMinutes(a.window) - windowMinutes(b.window));
}
export function realRate(board, id) {
  const r = board.settingJson(`rate:${id}`);
  if (!r || (r.resetAt && r.resetAt < Date.now())) return null; // that window is over
  if (Date.now() - (r.at ?? 0) > 12 * 3_600_000) return null; // too old to trust
  return r;
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString(localeOf(ctx.config?.language), { hour: '2-digit', minute: '2-digit' });
// 3.2.1: the hour, and the day too when it is not within the next 20 h (a monthly cycle that ends on the 20th): «16:42» or
// «00:00 del mar, 20 oct», so it reads right after «hasta las» / «a las» (until / at).
export function untilText(ms, now = Date.now()) {
  if (ms - now <= 20 * 3_600_000) return hhmm(ms);
  return tr('msg.budget.timeOnDay', { time: hhmm(ms), day: new Date(ms).toLocaleDateString(localeOf(ctx.config?.language), { weekday: 'short', day: 'numeric', month: 'short' }) });
}

const nameOf = (id) => findAccount(id)?.label ?? id;
// The name the agent gives a model (its list of models), not its id: «Gemini 3.8 Flash», not «gemini-3.8-flash-medium».
export function modelName(board, id, model) {
  if (!model) return '';
  for (const key of [`models:${id}`, `models:${agentOf(id)}`]) {
    const found = (board?.settingJson?.(key) ?? []).find?.((m) => m.id === model);
    if (found?.label) return found.label;
  }
  return model;
}

// Can this task be launched on this account right now? { ok, reason } — reason in plain words, in the user's language.
export function canLaunch(board, id, model) {
  const until = cooldownUntil(board, id);
  const why = board.setting(`cooldown_reason:${id}`); // a pause for another reason than quota (plan, login)
  if (until) return { ok: false, paused: until, reason: why ? tr('msg.budget.paused', { name: nameOf(id), time: untilText(until), why }) : tr('msg.budget.noQuota', { name: nameOf(id), time: untilText(until) }) };
  const modelUntil = modelLimitUntil(board, id, model);
  if (modelUntil) return { ok: false, paused: modelUntil, reason: tr('msg.budget.modelNoQuota', { name: nameOf(id), model: modelName(board, id, model), time: untilText(modelUntil) }) };
  const real = realRate(board, id);
  if (real?.utilization != null && real.utilization >= budgetConfig().stopAt) return { ok: false, reason: tr('msg.budget.realUsed', { name: nameOf(id), pct: Math.round(real.utilization * 100), reset: real.resetAt ? tr('msg.budget.realUsedReset', { time: hhmm(real.resetAt) }) : '' }) };
  const r = rules(id, board); const used = windowUsage(board, id); const h = budgetConfig().windowHours;
  if (used.tasks >= r.maxTasks) return { ok: false, reason: tr('msg.budget.maxTasks', { name: nameOf(id), tasks: used.tasks, h, max: r.maxTasks }) };
  if (isHeavy(id, model) && used.heavy >= r.maxHeavy) return { ok: false, reason: tr('msg.budget.maxHeavy', { name: nameOf(id), heavy: used.heavy, h, max: r.maxHeavy }) };
  return { ok: true, reason: '' };
}

// Order candidate accounts ([{ id, agent }]) by how much of their window they have used (least used first).
export function rankAccounts(board, candidates, model) {
  return candidates
    .map((acc, index) => ({ account: acc.id, agent: acc.agent, index, check: canLaunch(board, acc.id, model), used: realRate(board, acc.id)?.utilization ?? windowUsage(board, acc.id).tasks / Math.max(1, rules(acc.id, board).maxTasks) }))
    .sort((a, b) => a.used - b.used || a.index - b.index);
}

export function usageReport(board) {
  return accounts().map((acc) => {
    const r = rules(acc.id, board); const used = windowUsage(board, acc.id);
    const real = realRate(board, acc.id);
    // 3.2.1: why it is paused (usage, or a reason such as no login) and the models without usage of this account.
    const models = Object.entries(modelLimits(board, acc.id)).map(([model, until]) => ({ model, label: modelName(board, acc.id, model), until }));
    return { account: acc.id, agent: acc.agent, label: acc.label, plan: planOf(board, acc.id)?.label ?? null, used: used.tasks, max: r.maxTasks, heavy: used.heavy, maxHeavy: r.maxHeavy, cooldownUntil: cooldownUntil(board, acc.id) || null, cooldownReason: board.setting(`cooldown_reason:${acc.id}`) || null,
      modelLimits: models, windowHours: budgetConfig().windowHours, stopAt: budgetConfig().stopAt,
      real: real ? { utilization: real.utilization, resetAt: real.resetAt, window: real.window } : null, windows: rateWindows(board, acc.id) };
  });
}

// 3.2.1: why a task for this agent (and account, and model) would wait now, when every account it could use is paused or
// out of usage; '' when one of them can take it. For the assistant, right when it hands the task out.
export function waitReason(board, agent, { account = null, model = null } = {}) {
  if (!agent || agent === 'any') return '';
  const list = usableAccounts(agent).filter((a) => !account || a.id === account);
  if (!list.length) return '';
  const checks = list.map((a) => canLaunch(board, a.id, model));
  return checks.every((c) => !c.ok) ? checks.map((c) => c.reason).join('; ') : '';
}

const LIMIT_RE = /(usage limit|session limit|hit your limit|rate limit|limit reached|quota|too many requests|\b429\b|exceeded.*budget|budget.*exceeded|out of credits|límite de uso)/i;
export const isLimitText = (text) => LIMIT_RE.test(String(text ?? ''));
export const isBudgetText = (text) => /budget/i.test(String(text ?? '')) && !/session limit|usage limit/i.test(String(text ?? ''));

// "resets 5:10am", "resets at 17:30", "reset in 2 hours" → epoch ms; otherwise a full window from now.
// 3.2.1: also a date (Cursor: «will reset when your monthly cycle ends on 10/20/2026», US order; or 2026-10-20): the start of
// that day, local time, if it is still ahead (at most two months).
export function parseReset(text, now = new Date()) {
  const s = String(text ?? '');
  const us = s.match(/\b(?:on|until|by)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/i) ?? s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  const iso = !us && s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const day = us ? new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2])) : iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : null;
  if (day && !Number.isNaN(day.getTime()) && day > now && day.getTime() - now.getTime() <= 62 * 86_400_000) return day.getTime();
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
  board.setting(`cooldown_at:${agent}`, String(Date.now()));
  return until;
}

// A pause for another reason (the plan does not allow it, no login): nothing is sent to that account for `ms`.
export function pauseAccount(board, id, ms, reason) {
  const until = Date.now() + ms;
  board.setting(`cooldown:${id}`, String(until));
  board.setting(`cooldown_reason:${id}`, reason);
  board.setting(`cooldown_at:${id}`, String(Date.now()));
  return until;
}
