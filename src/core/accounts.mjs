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
// 3.0: an account whose own folder is gone (moved, renamed, deleted) gets no work: the agent would fail on every task.
export const usableAccounts = (agent) => accountsOf(agent).filter((a) => a.enabled !== false && ctx.config.agents[agent]?.enabled && (!a.home || fs.existsSync(a.home)));

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

// 2.7: «Buscar en este PC»: folders with a saved login of this agent that are not accounts yet (another CODEX_HOME or
// CLAUDE_CONFIG_DIR made before, an older Orb folder…). Only folder names are walked and only the presence of the login
// file is checked: nothing is opened or read. Typical places: the user's folder, AppData and the roots of the local
// drives, a few levels deep, within a time and size budget.
const MARKER = { codex: 'auth.json', claude: '.credentials.json' };
const NAMED = { codex: /codex/i, claude: /claude/i };
const SKIP = /^(node_modules|\.git|\.cache|\.npm|\.nuget|\.vscode|\.cursor|windows|program files( \(x86\))?|programdata|\$recycle\.bin|system volume information|recovery|perflogs|temp|tmp|cache|caches|packages|site-packages|venv|\.venv)$/i;
export async function findAccountFolders(agent, { budgetMs = 4000, maxDirs = 40000 } = {}) {
  const marker = MARKER[agent]; if (!marker) return [];
  const key = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
  const known = new Set(accountsOf(agent).map((a) => key(accountDir(a))));
  const tmp = key(os.tmpdir());
  const home = userHome();
  const roots = [[home, 3], [process.env.APPDATA, 2], [process.env.LOCALAPPDATA, 2], [path.join(home, '.config'), 2]];
  if (process.platform === 'win32') for (const l of 'CDEFGHIJ') { const r = `${l}:\\`; if (fs.existsSync(r)) roots.push([r, 3]); }
  const end = Date.now() + budgetMs; const seen = new Set(); const found = new Map(); let visited = 0;
  const look = (dir, parentName) => {
    if (!(NAMED[agent].test(path.basename(dir)) || NAMED[agent].test(parentName))) return;
    const file = path.join(dir, marker);
    try { const st = fs.statSync(file); if (st.isFile()) { const k = key(dir); if (!known.has(k) && !found.has(k)) found.set(k, { dir, name: path.basename(dir), savedAt: st.mtime.toISOString() }); } } catch { /* no login here */ }
  };
  const walk = async (dir, depth, parentName = '') => {
    if (Date.now() > end || visited > maxDirs) return;
    const k = key(dir); if (seen.has(k) || k.startsWith(tmp)) return; seen.add(k); visited++;
    look(dir, parentName);
    if (depth <= 0) return;
    let entries; try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !SKIP.test(e.name)) await walk(path.join(dir, e.name), depth - 1, path.basename(dir));
  };
  for (const [root, depth] of roots) if (root) await walk(root, depth);
  return [...found.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
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
