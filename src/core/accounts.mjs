// Accounts: several subscriptions of the same agent (e.g. two Codex, three Claude) without mixing them up.
// Each account has its own folder for the CLI's login and settings: Claude Code reads CLAUDE_CONFIG_DIR, Codex reads
// CODEX_HOME. The default account of each agent (id = agent, empty folder) uses the CLI's normal folder (~/.claude,
// ~/.codex). Cursor keeps its login in a fixed place, so it has a single account.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ctx } from './context.mjs';
import { AGENT_IDS } from './home.mjs';

export const MULTI = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }; // agents that support several accounts
const userHome = () => process.env.USERPROFILE || os.homedir();

export const accounts = () => (ctx.config.accounts ?? []).filter((a) => AGENT_IDS.includes(a.agent));
export const account = (id) => accounts().find((a) => a.id === id) ?? null;
export const accountsOf = (agent) => accounts().filter((a) => a.agent === agent);
// Accounts that can take work: the account and its agent are enabled.
export const usableAccounts = (agent) => accountsOf(agent).filter((a) => a.enabled !== false && ctx.config.agents[agent]?.enabled);

// The folder where the CLI keeps this account's login.
export function accountDir(acc) {
  if (acc.home) return acc.home;
  if (acc.agent === 'claude') return process.env.CLAUDE_CONFIG_DIR || path.join(userHome(), '.claude');
  if (acc.agent === 'codex') return process.env.CODEX_HOME || path.join(userHome(), '.codex');
  return path.join(userHome(), '.cursor');
}

// Default accounts (no folder) keep the CLI's own lookup: pointing CLAUDE_CONFIG_DIR at ~/.claude would make Claude look
// for its settings somewhere else than it normally does.
export function accountEnv(acc) {
  const name = MULTI[acc?.agent];
  if (!name) return {};
  if (acc.home) return { [name]: acc.home };
  return process.env[name] ? { [name]: process.env[name] } : {}; // the user's own setting, if they had one

}

export function loginState(acc) {
  const dir = accountDir(acc);
  if (acc.agent === 'claude') return fs.existsSync(path.join(dir, '.credentials.json')) ? 'si' : fs.existsSync(dir) ? 'desconocido' : 'no';
  if (acc.agent === 'codex') return fs.existsSync(path.join(dir, 'auth.json')) ? 'si' : 'no';
  return fs.existsSync(dir) ? 'desconocido' : 'no';
}

// Default account of an agent (for direct conversations when none is chosen, and for the assistant itself).
export const defaultAccount = (agent) => usableAccounts(agent)[0] ?? accountsOf(agent)[0] ?? null;

export const accountLabel = (id) => account(id)?.label ?? id;

// A new account id: claude-2, claude-3… never one used before (its usage, pauses and conversations stay with the old one).
export function newAccountId(agent, usedBefore = []) {
  const used = new Set([...accounts().map((a) => a.id), ...usedBefore]);
  let n = 2; while (used.has(`${agent}-${n}`)) n++;
  return `${agent}-${n}`;
}
