// Registry of the agents the assistant can drive, plus detection, version and login checks for the "Agentes" screen.
// 2.3: Claude Code (Agent SDK), Codex (app-server) and Cursor (CLI in streaming) plus every ACP agent of acp.mjs.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as claude from './claude.mjs';
import * as codex from './codex.mjs';
import * as cursor from './cursor.mjs';
import { acpAgent, ACP_SPECS } from './acp.mjs';
import { cleanEnv, IS_WIN } from './common.mjs';
import fs from 'node:fs';
import { ctx, tr } from '../core/context.mjs';
import { accountsOf, account, accountDir, accountEnv, defaultAccount, loginState as accountLogin, MULTI } from '../core/accounts.mjs';

export const ADAPTERS = { claude, codex, cursor, ...Object.fromEntries(Object.entries(ACP_SPECS).map(([id, spec]) => [id, acpAgent(id, spec)])) };
// Tests: ORB_FAKE_AGENTS points to a module whose fakeAdapter(id) replaces every agent (no real program or account).
if (process.env.ORB_FAKE_AGENTS) {
  const fake = await import(pathToFileURL(process.env.ORB_FAKE_AGENTS).href);
  for (const id of Object.keys(ADAPTERS)) ADAPTERS[id] = fake.fakeAdapter(id, ADAPTERS[id]);
}
export const adapter = (agent) => { const a = ADAPTERS[agent]; if (!a) throw new Error(tr('sys.agents.unknown', { agent })); return a; };

// Whether an agent's program is on this PC (asked often by the scheduler: cached for half a minute).
const found = new Map();
export function installed(agent) {
  const hit = found.get(agent);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  let ok = false; try { ok = Boolean(adapter(agent).detect(ctx.config.agents[agent] ?? {})); } catch { ok = false; }
  found.set(agent, { ok, at: Date.now() });
  return ok;
}
export const forgetInstalled = () => found.clear();
const loginState = (acc) => (MULTI[acc.agent] ? accountLogin(acc) : adapter(acc.agent).loginState());

export function executable(agent) {
  const a = adapter(agent);
  const exe = a.detect(ctx.config.agents[agent] ?? {});
  if (!exe) throw new Error(tr('sys.agents.notFound', { name: a.label }));
  return exe;
}

// Runs a short command and returns its output (never throws; resolves with { ok, out }).
export function quickRun(cmd, args, { timeoutMs = 15000, env } = {}) {
  return new Promise((resolve) => {
    let out = ''; let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve({ ok, out: out.trim().slice(0, 2000) }); } };
    let child;
    try { child = spawn(cmd, args, { windowsHide: true, env: env ?? cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { out = error.message; return finish(false); }
    child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish(false); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); out += error.message; finish(false); });
    child.on('exit', (code) => { clearTimeout(timer); finish(code === 0); });
  });
}

// 2.6: the models an installed agent offers, asked to the agent itself (each adapter's discoverModels, with the login of
// its first usable account). Resolves with [{ id, label, default?, resolved? }] or null (not installed, no way to ask, the
// agent did not answer). Never throws.
export async function discoverModels(agent) {
  try {
    const a = adapter(agent); if (typeof a.discoverModels !== 'function') return null;
    const cfg = ctx.config.agents[agent] ?? {};
    const exe = a.detect(cfg); if (!exe) return null;
    const acc = defaultAccount(agent);
    const list = await a.discoverModels(exe, cfg, acc ? accountEnv(acc) : {});
    return Array.isArray(list) && list.length ? list : null;
  } catch { return null; }
}

const versions = new Map(); // agent -> { exe, version } (asking the CLI takes a second; cached per executable)

export async function status(agent, { refresh = false } = {}) {
  const a = adapter(agent); const cfg = ctx.config.agents[agent] ?? {};
  const exe = a.detect(cfg);
  const accounts = accountsOf(agent).map((acc) => ({ ...acc, login: exe ? loginState(acc) : 'no', dir: accountDir(acc), multi: Boolean(MULTI[agent]) }));
  const base = { id: agent, label: a.label, kind: a.kind, caps: a.caps ?? {}, install: a.install ?? null, enabled: Boolean(cfg.enabled), models: cfg.models ?? [], defaultModel: cfg.defaultModel ?? '', path: cfg.path ?? '', accounts, multi: Boolean(MULTI[agent]) };
  if (!exe) return { ...base, installed: false, login: 'no', version: null, where: null };
  let cached = versions.get(agent);
  if (refresh || !cached || cached.exe !== exe.cmd) {
    const r = await quickRun(exe.cmd, [...exe.pre, '--version'], { timeoutMs: 15000 });
    cached = { exe: exe.cmd, version: r.ok ? r.out.split(/\r?\n/)[0].slice(0, 80) : null };
    versions.set(agent, cached);
  }
  const best = accounts.some((x) => x.login === 'si') ? 'si' : accounts.some((x) => x.login === 'desconocido') ? 'desconocido' : 'no';
  return { ...base, installed: true, where: exe.cmd, version: cached.version, login: best };
}

export async function statusAll(options) { return Promise.all(Object.keys(ADAPTERS).map((agent) => status(agent, options))); }

// Opens the agent's own login in a new console window: the user signs in with the official CLI, the app never sees it.
// The login runs with the account's folder (CLAUDE_CONFIG_DIR / CODEX_HOME), so each account signs in separately.
export function openLogin(accountId) {
  const acc = account(accountId); if (!acc) throw new Error(tr('sys.agents.noAccount'));
  const exe = executable(acc.agent);
  if (acc.home) fs.mkdirSync(acc.home, { recursive: true });
  const { cmd, args } = adapter(acc.agent).loginCommand(exe);
  openConsole(cmd, args, accountEnv(acc));
}

// A program in a console window of its own. Started directly (a detached console program gets its own window on Windows):
// never through cmd.exe, which would re-read & ^ % in paths such as a folder called «I+D&Co».
export function openConsole(cmd, args, env = {}) {
  if (!IS_WIN) throw new Error(tr('sys.agents.consoleWindowsOnly'));
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, env: cleanEnv(env) });
  child.on('error', () => {});
  child.unref();
  return child;
}
