// 3.5 «Solo Orb»: the agents' own sign-in without a console window. The official CLI runs hidden with its output piped;
// Orb reads the sign-in link (and the one-time code, when there is one) from it, the app shows them and opens the link in
// the browser, and the CLI saves the login in the account's folder as always (Orb never sees a token).
//   Claude Code: `claude auth login --claudeai`. It prints the link («If the browser didn't open, visit: <url>»), opens
//     the browser itself where there is one (with a localhost return) and reads a pasted «code#state» from stdin when the
//     browser cannot return the sign-in by itself (another device, a server without screen).
//   Codex: `codex app-server` (JSON-RPC, the protocol Codex's own apps use): account/login/start with type «chatgpt»
//     (authUrl, localhost return hosted by the app-server, the client opens the link) or «chatgptDeviceCode»
//     (verificationUrl + userCode, for a phone or a server); account/login/completed says how it ended. A Codex without
//     that method falls back to `codex login --device-auth` (link and code in its output).
// Every login is a record { id, agent, account, state, url, code… } with events through emit('agents:login', …).
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnAgent, JsonRpcPeer, killTree } from './live.mjs';
import { tr } from '../platform/context.mjs';

export const LOGIN_MAX_MS = 15 * 60_000; // the codes and links of both agents expire within 15 minutes
const URL_WAIT_MS = 60_000;
const logins = new Map(); // id -> login (finished ones stay a while so a late look still finds how it ended)

// ---- reading the CLI's output
// Hyperlinks (OSC 8: ESC ] 8 ;; url BEL text ESC ] 8 ;; BEL), colours and cursor moves are taken out.
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const plainText = (s) => String(s ?? '').replace(OSC, '').replace(CSI, '').replace(/\x1b./g, '').replace(/\r/g, '');
const URL_RE = /https:\/\/[^\s"'<>\x07\x1b`]+/g;
const tidyUrl = (u) => u.replace(/[).,;:]+$/, '');
// The sign-in link: the one after «visit:» / «Sign in at:» / «navigate to…» when the CLI says so, else the first https
// link that is not documentation; links inside OSC 8 count too (the visible text may be shortened).
export function findUrl(raw) {
  const text = plainText(raw);
  const said = text.match(/(?:visit|sign in at|navigate to this url[^:]*|open this link[^\n]*)[:\s]+\s*(https:\/\/[^\s"'<>]+)/i);
  if (said) return tidyUrl(said[1]);
  const osc = [...String(raw ?? '').matchAll(/\x1b\]8;[^;]*;(https:\/\/[^\x07\x1b]+)(?:\x07|\x1b\\)/g)].map((m) => m[1]);
  const all = [...osc, ...(text.match(URL_RE) ?? [])].map(tidyUrl).filter((u) => !/\/docs?\b|\/help\b/i.test(u));
  return all[0] ?? null;
}
// A one-time device code as the CLIs print it (ABCD-EFGH, ABCD-12345).
export function findCode(raw) {
  const m = plainText(raw).match(/\b([A-Z0-9]{4,5}-[A-Z0-9]{4,6})\b/);
  return m ? m[1] : null;
}
// Why a sign-in failed, in the user's words: what the CLI said after «Login failed:» / «Error:», shortened.
export function failureOf(raw) {
  const text = plainText(raw);
  const m = text.match(/(?:login failed|error|failed)[:\s]+([^\n]{3,200})/i);
  return m ? m[1].trim() : null;
}

// ---- the records
const publicOf = (l) => ({ id: l.id, agent: l.agent, account: l.account, state: l.state, url: l.url ?? null, code: l.code ?? null, opened: Boolean(l.opened), needsCode: Boolean(l.needsCode), mode: l.mode, message: l.message ?? null, startedAt: l.startedAt });
export const loginInfo = (id) => { const l = logins.get(id); return l ? publicOf(l) : null; };
export const activeLogin = (account) => { for (const l of logins.values()) if (l.account === account && l.state === 'esperando') return publicOf(l); return null; };
export const allLogins = () => [...logins.values()].map(publicOf);

function finish(l, state, message = null) {
  if (l.state !== 'esperando') return;
  l.state = state; l.message = message;
  clearTimeout(l.timer);
  try { l.peer?.close(); } catch { /* gone */ }
  try { killTree(l.child); } catch { /* gone */ }
  l.emit('agents:login', publicOf(l));
  try { l.onEnd?.(publicOf(l)); } catch { /* the caller's own work */ }
  setTimeout(() => logins.delete(l.id), 10 * 60_000).unref?.();
  for (const fn of l.waiters.splice(0)) fn();
}

// A pasted code (Claude: «code#state», the one the sign-in page shows when it cannot come back by itself).
export function sendCode(id, code) {
  const l = logins.get(id);
  if (!l || l.state !== 'esperando') throw new Error(tr('msg.login.notWaiting'));
  if (!l.needsCode && l.agent !== 'claude') throw new Error(tr('msg.login.noCodeHere'));
  const text = String(code ?? '').trim();
  if (!/^[\w.~-]{8,}#[\w.~-]{8,}$/.test(text)) throw new Error(tr('msg.login.badCode'));
  try { l.child.stdin.write(`${text}\n`); } catch { throw new Error(tr('msg.login.closed')); }
  return publicOf(l);
}

export function cancelLogin(id) {
  const l = logins.get(id); if (!l) return false;
  if (l.loginId && l.peer) { try { l.peer.request('account/login/cancel', { loginId: l.loginId }, { timeoutMs: 2000 }).catch(() => {}); } catch { /* gone */ } }
  finish(l, 'cancelado', tr('msg.login.cancelled'));
  return true;
}

// Waits until a login ends (tests).
export const waitLogin = (id) => new Promise((resolve) => { const l = logins.get(id); if (!l || l.state !== 'esperando') return resolve(loginInfo(id)); l.waiters.push(() => resolve(loginInfo(id))); });

// Starts a sign-in. agent: 'claude' | 'codex'; exe: { cmd, pre }; env: the account's (CLAUDE_CONFIG_DIR / CODEX_HOME);
// mode: 'web' (link with a return to this PC) or 'device' (link + code, for a phone or a server); verify(): whether the
// account's folder holds a login now. Resolves with the login once the link is known; rejects with words when the CLI
// could not even start the sign-in.
export function startLogin({ agent, account, exe, env = {}, mode = 'web', emit = () => {}, verify = () => true, onEnd = null, timeoutMs = LOGIN_MAX_MS, log = () => {} }) {
  const prev = activeLogin(account); if (prev) cancelLogin(prev.id); // signing in again replaces the one left open
  const l = { id: crypto.randomUUID(), agent, account, mode, state: 'esperando', startedAt: Date.now(), emit, onEnd, verify, log, waiters: [], out: '' };
  logins.set(l.id, l);
  l.timer = setTimeout(() => finish(l, 'error', tr('msg.login.timeout')), timeoutMs);
  l.timer.unref?.();
  const run = agent === 'claude' ? claudeLogin : agent === 'codex' ? codexLogin : null;
  if (!run) { logins.delete(l.id); clearTimeout(l.timer); return Promise.reject(new Error(tr('msg.login.unsupported'))); }
  return run(l, exe, env);
}

// Resolves the start once the link is there (or rejects with the failure, if the login ended before showing one).
function linkReady(l) {
  return new Promise((resolve, reject) => {
    const wait = setTimeout(() => { if (!l.url) finish(l, 'error', tr('msg.login.noLink')); }, URL_WAIT_MS);
    wait.unref?.();
    l.ready = () => { clearTimeout(wait); resolve(publicOf(l)); };
    l.waiters.push(() => { clearTimeout(wait); if (!l.url) { const e = new Error(l.message ?? tr('msg.login.noLink')); e.userFacing = true; reject(e); } });
  });
}

const startFailed = (error) => (error?.code === 'ENOENT' ? tr('msg.login.noProgram') : tr('msg.login.failed', { why: String(error?.message ?? error).slice(0, 200) }));

function claudeLogin(l, exe, env) {
  const ready = linkReady(l);
  let child;
  try { child = spawnAgent(exe.cmd, [...exe.pre, 'auth', 'login', '--claudeai'], { cwd: os.tmpdir(), env, log: () => {} }); } catch (error) { finish(l, 'error', startFailed(error)); return ready; }
  l.child = child; l.needsCode = true;
  // Claude opens the browser itself where there is a desktop (it is not given a display on Linux servers).
  l.opened = process.platform === 'win32' || process.platform === 'darwin';
  let success = false;
  const read = (chunk) => {
    l.out = (l.out + chunk).slice(-20_000);
    if (!l.url) { const url = findUrl(l.out); if (url) { l.url = url; l.emit('agents:login', publicOf(l)); l.ready?.(); } }
    if (/Login successful/i.test(l.out)) success = true;
    // A pasted code that was cut short: the CLI keeps waiting for a good one.
    if (/Invalid code/i.test(chunk)) l.emit('agents:login', { ...publicOf(l), message: tr('msg.login.badCode') });
  };
  child.stdout.setEncoding('utf8'); child.stdout.on('data', read);
  child.stderr.on('data', read);
  child.on('error', (error) => finish(l, 'error', startFailed(error)));
  child.on('close', (code) => {
    if (l.state !== 'esperando') return;
    if (code === 0 && (success || l.verify())) return finish(l, 'hecho', tr('msg.login.done'));
    const why = failureOf(l.out);
    finish(l, 'error', why ? tr('msg.login.failed', { why }) : tr('msg.login.closed'));
  });
  return ready;
}

async function codexLogin(l, exe, env) {
  const ready = linkReady(l);
  let child;
  try { child = spawnAgent(exe.cmd, [...exe.pre, 'app-server'], { cwd: os.tmpdir(), env, log: () => {} }); } catch (error) { finish(l, 'error', startFailed(error)); return ready; }
  l.child = child;
  const peer = new JsonRpcPeer(child, {
    onRequest: async () => ({}),
    log: () => {},
    onNotification: async (method, params) => {
      if (method !== 'account/login/completed' || (l.loginId && params.loginId && params.loginId !== l.loginId)) return;
      if (!params.success) return finish(l, 'error', tr('msg.login.failed', { why: String(params.error ?? tr('msg.login.refused')).slice(0, 200) }));
      // Codex says who is signed in now: the proof the folder holds a login (the token itself is never read).
      const acc = await peer.request('account/read', { refreshToken: false }, { timeoutMs: 15_000 }).catch(() => null);
      if (acc && !acc.account && !l.verify()) return finish(l, 'error', tr('msg.login.notSaved'));
      finish(l, 'hecho', tr('msg.login.done'));
    }
  });
  l.peer = peer;
  child.on('error', (error) => finish(l, 'error', startFailed(error)));
  child.on('close', () => { if (l.state === 'esperando' && !l.fallback && l.child === child) finish(l, 'error', tr('msg.login.closed')); });
  try {
    await peer.request('initialize', { clientInfo: { name: 'orb_dev', title: 'Orb', version: '3.5.0' }, capabilities: { experimentalApi: true, requestAttestation: false } }, { timeoutMs: 30_000 });
    peer.notify('initialized', {});
    let r;
    try { r = await peer.request('account/login/start', { type: l.mode === 'device' ? 'chatgptDeviceCode' : 'chatgpt' }, { timeoutMs: 30_000 }); } catch (error) {
      // An older Codex: no device code over app-server → the browser link; no login method at all → the CLI's own.
      if (l.mode === 'device' && error.code !== -32601) r = await peer.request('account/login/start', { type: 'chatgpt' }, { timeoutMs: 30_000 });
      else throw error;
    }
    l.loginId = r?.loginId ?? null;
    if (r?.type === 'chatgptDeviceCode' || r?.verificationUrl) { l.url = r.verificationUrl; l.code = r.userCode ?? null; l.mode = 'device'; } else { l.url = r?.authUrl ?? null; l.mode = 'web'; }
    if (!l.url) throw new Error(tr('msg.login.noLink'));
    l.emit('agents:login', publicOf(l)); l.ready?.();
  } catch (error) {
    if (l.state !== 'esperando') return ready;
    if (error.code === -32601 || /method not found|unknown variant|not supported/i.test(error.message ?? '')) { codexCliLogin(l, exe, env); return ready; }
    finish(l, 'error', tr('msg.login.failed', { why: String(error.message ?? error).slice(0, 200) }));
  }
  return ready;
}

// `codex login --device-auth`: the link and the code are in its output; it ends (exit 0) once the user has signed in.
function codexCliLogin(l, exe, env) {
  l.fallback = true;
  try { l.peer?.close(); } catch { /* gone */ }
  try { killTree(l.child); } catch { /* gone */ }
  l.peer = null;
  let child;
  try { child = spawnAgent(exe.cmd, [...exe.pre, 'login', '--device-auth'], { cwd: os.tmpdir(), env, log: () => {} }); } catch (error) { finish(l, 'error', startFailed(error)); return; }
  l.child = child; l.mode = 'device'; l.out = '';
  const read = (chunk) => {
    l.out = (l.out + chunk).slice(-20_000);
    if (!l.url) { const url = findUrl(l.out); const code = findCode(l.out); if (url && code) { l.url = url; l.code = code; l.emit('agents:login', publicOf(l)); l.ready?.(); } }
  };
  child.stdout.setEncoding('utf8'); child.stdout.on('data', read);
  child.stderr.on('data', read);
  child.on('error', (error) => finish(l, 'error', startFailed(error)));
  child.on('close', (code) => {
    if (l.state !== 'esperando') return;
    if (code === 0 && l.verify()) return finish(l, 'hecho', tr('msg.login.done'));
    const why = failureOf(l.out);
    finish(l, 'error', why ? tr('msg.login.failed', { why }) : tr('msg.login.closed'));
  });
}
