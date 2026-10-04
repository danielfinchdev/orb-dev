// Registry of the agents the assistant can drive, plus detection, version and login checks for the "Agentes" screen.
import { spawn } from 'node:child_process';
import * as claude from './claude.mjs';
import * as codex from './codex.mjs';
import * as cursor from './cursor.mjs';
import { cleanEnv, IS_WIN } from './common.mjs';
import fs from 'node:fs';
import { ctx } from '../core/context.mjs';
import { accountsOf, account, accountDir, accountEnv, loginState, MULTI } from '../core/accounts.mjs';

export const ADAPTERS = { claude, codex, cursor };
export const adapter = (agent) => { const a = ADAPTERS[agent]; if (!a) throw new Error(`agente desconocido: ${agent}`); return a; };

export function executable(agent) {
  const a = adapter(agent);
  const exe = a.detect(ctx.config.agents[agent] ?? {});
  if (!exe) throw new Error(`no encuentro ${a.label} en este equipo. Instálalo o indica su ruta en Agentes.`);
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

const versions = new Map(); // agent -> { exe, version } (asking the CLI takes a second; cached per executable)

export async function status(agent, { refresh = false } = {}) {
  const a = adapter(agent); const cfg = ctx.config.agents[agent] ?? {};
  const exe = a.detect(cfg);
  const accounts = accountsOf(agent).map((acc) => ({ ...acc, login: exe ? loginState(acc) : 'no', dir: accountDir(acc), multi: Boolean(MULTI[agent]) }));
  const base = { id: agent, label: a.label, enabled: Boolean(cfg.enabled), models: cfg.models ?? [], defaultModel: cfg.defaultModel ?? '', path: cfg.path ?? '', accounts, multi: Boolean(MULTI[agent]) };
  if (!exe) return { ...base, installed: false, login: 'no', version: null, where: null };
  let cached = versions.get(agent);
  if (refresh || !cached || cached.exe !== exe.cmd) {
    const r = await quickRun(exe.cmd, [...exe.pre, '--version'], { timeoutMs: 10000 });
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
  const acc = account(accountId); if (!acc) throw new Error('esa cuenta no existe');
  const exe = executable(acc.agent);
  if (acc.home) fs.mkdirSync(acc.home, { recursive: true });
  const { cmd, args } = adapter(acc.agent).loginCommand(exe);
  openConsole(cmd, args, accountEnv(acc));
}

// A program in a console window of its own. Started directly (a detached console program gets its own window on Windows):
// never through cmd.exe, which would re-read & ^ % in paths such as a folder called «I+D&Co».
export function openConsole(cmd, args, env = {}) {
  if (!IS_WIN) throw new Error('abrir una consola solo está disponible en Windows');
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, env: cleanEnv(env) });
  child.on('error', () => {});
  child.unref();
  return child;
}
