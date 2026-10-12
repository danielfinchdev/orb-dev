// 3.1: the subscription plan of every account, read from each agent itself, so Orb spends according to what the user pays
// for. The plan only sets how much work Orb sends an account before it reports its real usage (budget.mjs: planFactor);
// once the agent says how much of its window is used, that real figure is what counts.
// - Claude: the plan Claude Code keeps next to its login (claudeAiOauth.subscriptionType / rateLimitTier). Only those two
//   fields are read: the tokens of the file never leave this function.
// - Codex: account/read of its app-server (planType), as «Buscar y añadir» already did.
// - Cursor: `cursor-agent about --format json` (subscriptionTier).
// Kept in the board as plan:<account> = { agent, plan, label, at }, asked again at most every 12 hours.
import fs from 'node:fs';
import path from 'node:path';
import { usableAccounts, accountDir } from '../core/accounts.mjs';
import { enabledAgents } from '../core/context.mjs';
import { installed, executable } from '../agents/index.mjs';
import { accountInfo as codexAccountInfo } from '../agents/codex.mjs';
import { readOutput } from '../agents/common.mjs';

const REFRESH_MS = 12 * 3_600_000;

// Normalised plan ids: free, pro, max5, max20, go, plus, prolite, team, business, enterprise, edu, proplus, ultra.
export function claudePlan(dir) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8'))?.claudeAiOauth ?? {};
    const sub = String(o.subscriptionType ?? '').toLowerCase(); const tier = String(o.rateLimitTier ?? '').toLowerCase();
    if (!sub) return null;
    if (sub === 'max') return /20x/.test(tier) ? 'max20' : 'max5';
    return { pro: 'pro', free: 'free', team: 'team', enterprise: 'enterprise' }[sub] ?? sub.replace(/[^a-z0-9]/g, '').slice(0, 20);
  } catch { return null; }
}
export function codexPlan(planType) {
  const p = String(planType ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return p ? ({ free: 'free', go: 'go', plus: 'plus', prolite: 'prolite', pro: 'pro', team: 'team', business: 'business', enterprise: 'enterprise', edu: 'edu' }[p] ?? p.slice(0, 20)) : null;
}
export function cursorPlan(tier) {
  const p = String(tier ?? '').toLowerCase().replace(/\s+/g, '');
  if (!p) return null;
  if (/ultra/.test(p)) return 'ultra';
  if (/pro\+|proplus/.test(p)) return 'proplus';
  if (/pro/.test(p)) return 'pro';
  if (/business|team/.test(p)) return 'business';
  if (/free|hobby/.test(p)) return 'free';
  return p.replace(/[^a-z0-9]/g, '').slice(0, 20);
}
export const PLAN_LABELS = { free: 'Free', pro: 'Pro', max5: 'Max 5x', max20: 'Max 20x', go: 'Go', plus: 'Plus', prolite: 'Pro Lite', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu', proplus: 'Pro+', ultra: 'Ultra' };

async function askPlan(acc) {
  if (acc.agent === 'claude') return claudePlan(accountDir(acc));
  if (acc.agent === 'codex') { const info = await codexAccountInfo(executable('codex'), accountDir(acc)); return codexPlan(info?.plan); }
  if (acc.agent === 'cursor') {
    const exe = executable('cursor');
    const out = await readOutput(exe.cmd, [...exe.pre, 'about', '--format', 'json'], { timeoutMs: 30000 });
    try { return cursorPlan(JSON.parse(String(out ?? '').slice(String(out ?? '').indexOf('{')))?.subscriptionTier); } catch { return null; }
  }
  return null;
}

// Asks every usable account of the installed agents (in the background; never throws).
export async function refreshPlans(board, { force = false, log = () => {} } = {}) {
  for (const agent of enabledAgents().filter((a) => ['claude', 'codex', 'cursor'].includes(a) && installed(a))) {
    for (const acc of usableAccounts(agent)) {
      const prev = board.settingJson(`plan:${acc.id}`);
      if (!force && prev?.at && Date.now() - Date.parse(prev.at) < REFRESH_MS) continue;
      try {
        const plan = await askPlan(acc);
        if (plan) board.settingJson(`plan:${acc.id}`, { agent: acc.agent, plan, label: PLAN_LABELS[plan] ?? plan, at: new Date().toISOString() });
        log(`plan de ${acc.id}: ${plan ?? 'no se pudo leer'}`);
      } catch (error) { log(`plan de ${acc.id}: ${error.message}`); }
    }
  }
}
