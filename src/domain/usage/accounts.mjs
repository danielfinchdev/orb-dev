// Accounts: several subscriptions of the same agent (e.g. two Codex, three Claude) without mixing them up.
// Each account has its own folder for the CLI's login and settings: Claude Code reads CLAUDE_CONFIG_DIR, Codex reads
// CODEX_HOME. The default account of each agent (id = agent, empty folder) uses the CLI's normal folder (~/.claude,
// ~/.codex). Cursor keeps its login in a fixed place, so it has a single account.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { AGENT_IDS } from '../../platform/config-file.mjs';

export const MULTI = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }; // agents that support several accounts
const userHome = () => process.env.USERPROFILE || os.homedir();

export const accounts = () => (ctx.config.accounts ?? []).filter((a) => AGENT_IDS.includes(a.agent));
export const account = (id) => accounts().find((a) => a.id === id) ?? null;
export const accountsOf = (agent) => accounts().filter((a) => a.agent === agent);
// Accounts that can take work: the account and its agent are enabled.
// an account whose own folder is gone (moved, renamed, deleted) gets no work: the agent would fail on every task.
// An account Orb manages itself (its folder inside Orb's "cuentas") whose login file is gone (after «Cerrar sesión») takes no
// work either; it comes back by itself when the user signs in again. The default account and folders the user chose keep
// their "unknown" state: Orb cannot tell there.
export const usableAccounts = (agent) => accountsOf(agent).filter((a) => a.enabled !== false && ctx.config.agents[agent]?.enabled && (!a.home || fs.existsSync(a.home)) && !signedOut(a));

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
  if (signedOut(acc)) return 'no';
  if (acc.agent === 'claude') return fs.existsSync(path.join(dir, '.credentials.json')) ? 'si' : fs.existsSync(dir) ? 'desconocido' : 'no';
  if (acc.agent === 'codex') return fs.existsSync(path.join(dir, 'auth.json')) ? 'si' : 'no';
  return fs.existsSync(dir) ? 'desconocido' : 'no';
}

// «Buscar en este PC»: folders with a saved login of this agent that are not accounts yet (another CODEX_HOME or
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

// What a chat's brain picker means in columns: 'auto' (or nothing) = the chat follows the agent's accounts
// (account NULL until its first turn, account_fixed 0); an account id = that account only (account_fixed 1). The one place
// that turns a choice into columns, so a chat made by the assistant, a schedule, the phone or the importer reads it the same
// way. An account of another agent (the brain changed agent) is not a choice for this one: automatic.
export function brainAccount(value, agent) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id === 'auto') return { account: null, account_fixed: 0 };
  const known = account(id);
  if (known && known.agent !== agent) return { account: null, account_fixed: 0 };
  return { account: id, account_fixed: 1 };
}

// The account choice new chats start with, from the assistant's settings: 'auto' or an account id. `account` keeps naming an
// account (the main one when automatic) so an older Orb reading the same file still finds a valid one; `accountMode` says
// whether it is a choice. A file without it (made by an older Orb) is automatic when it names the agent's main account.
export function configuredAccount(o, agent) {
  const mode = o?.accountMode;
  if (mode === 'auto' || (mode !== 'fixed' && (!o?.account || o.account === (o.agent || agent)))) return 'auto';
  return o.account;
}
// The settings that say the same choice back (see configuredAccount): the account and its mode.
export const accountSettings = (choice, agent) => (choice && choice !== 'auto' ? { account: choice, accountMode: 'fixed' } : { account: agent, accountMode: 'auto' });

// The same choice, checked for a person's request (the window or a linked phone): the account must exist, be of this
// agent and be signed in. An id the user can no longer pick (a limit is not a reason: that is told when the message goes).
export function requireBrainAccount(value, agent) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id === 'auto') return { account: null, account_fixed: 0 };
  const known = account(id);
  if (!known) throw new Error(tr('msg.api.noAccount'));
  if (known.agent !== agent) throw new Error(tr('msg.acct.badAgent', { agent }));
  if (!usableAccounts(agent).some((a) => a.id === id)) throw new Error(tr('msg.acct.noSession'));
  return { account: id, account_fixed: 1 };
}

// The account a conversation is fixed to, or null (automatic, or no such conversation). A task of that conversation for the
// same agent runs on it and on no other account of that agent.
export function fixedAccountOf(board, conversationId) {
  const c = conversationId ? board.conversation(conversationId) : null;
  return c?.account_fixed && c.account ? account(c.account) : null;
}

export const accountLabel = (id) => account(id)?.label ?? id;

// A new account id: claude-2, claude-3… never one used before (its usage, pauses and conversations stay with the old one).
export function newAccountId(agent, usedBefore = []) {
  const used = new Set([...accounts().map((a) => a.id), ...usedBefore]);
  let n = 2; while (used.has(`${agent}-${n}`)) n++;
  return `${agent}-${n}`;
}

// ---- «Cerrar sesión» of an account.
// Orb only ever closes the session of an account whose folder it made itself, inside its own «cuentas» folder: there it
// deletes that account's credentials file and nothing else (the account, its settings and its conversations stay). The
// default accounts (the CLI's own ~/.claude, ~/.codex) and any folder the user picked are the CLI's or the user's: Orb never
// removes a login from them, the user does it with the agent's own command.
const CREDENTIALS = { claude: '.credentials.json', codex: 'auth.json' };
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
const accountsRoot = () => path.join(ctx.paths.internal, 'cuentas');

// The resolved folder of an account that lives inside Orb's accounts folder, or null (links are resolved first, so a
// folder that only looks like it is inside, or a link that points out of it, does not count).
function ownedDir(acc) {
  if (!acc?.home || acc.id === acc.agent) return null;
  const root = real(accountsRoot()); const dir = real(acc.home);
  if (!root || !dir) return null;
  const rel = path.relative(root, dir);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? dir : null;
}
// 'orb' = Orb can close it; 'tool' = only the agent's own command can; null = this agent has no session to close here.
export const logoutKind = (acc) => (CREDENTIALS[acc?.agent] ? (ownedDir(acc) ? 'orb' : 'tool') : null);
// The one file that «Cerrar sesión» would delete, or null (not Orb's folder, no login there, or not a plain file).
export function logoutTarget(acc) {
  const dir = ownedDir(acc); const marker = CREDENTIALS[acc?.agent];
  if (!dir || !marker) return null;
  const file = path.join(dir, marker);
  try { return fs.lstatSync(file).isFile() ? file : null; } catch { return null; }
}
// «Cerrar sesión» leaves this empty file in the account's folder: only an account Orb itself signed out counts as
// «sin sesión». One that never had the login file (signed in another way, or not yet) stays as it always was.
const SIGNED_OUT = '.orb-sin-sesion';
// An account of Orb's own folder that «Cerrar sesión» closed and that has not signed in again: it gets no work.
export function signedOut(acc) {
  const dir = ownedDir(acc); const marker = CREDENTIALS[acc?.agent];
  if (!dir || !marker) return false;
  try { if (!fs.lstatSync(path.join(dir, SIGNED_OUT)).isFile()) return false; } catch { return false; }
  try { return !fs.lstatSync(path.join(dir, marker)).isFile(); } catch { return true; }
}
export function closeAccountSession(acc) {
  const file = logoutTarget(acc);
  if (!file) return false;
  // Checked again right before deleting: the folder or the file may have been swapped for a link since the first look.
  const dir = ownedDir(acc);
  if (!dir || logoutTarget(acc) !== file) return false;
  try { if (!fs.lstatSync(file).isFile()) return false; } catch { return false; }
  fs.unlinkSync(file);
  // wx: never over something already there (a link planted under that name is left alone and the mark is simply not set)
  try { fs.closeSync(fs.openSync(path.join(dir, SIGNED_OUT), 'wx')); } catch { /* already marked, or not writable */ }
  return true;
}
