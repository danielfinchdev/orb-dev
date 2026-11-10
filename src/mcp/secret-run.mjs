// 3.8.2 (T3 3.4): runs one command with a secret the user typed on Orb's private card (orb_request_secret), without the
// agent ever seeing it:
//   node secret-run.mjs <handle> --env NAME -- program args…    the secret in the variable NAME of that program only
//   node secret-run.mjs <handle> --stdin -- program args…       the secret on the program's standard input
// The handle (orbsec1.<pipe>.<ticket>) is traded once on the engine's agents' pipe (src/engine/agent-auth.mjs, a grant
// `once`); the program runs without a shell (src/platform/proc-win.mjs on Windows) and every copy of the secret in its output
// is replaced by «[secreto]». Exit code: the program's, or 2 when the handle is no good.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeOf } from '../engine/agent-auth.mjs';
import { winPlan } from '../platform/proc-win.mjs';

const HANDLE = /^orbsec1\.([0-9a-f]{24})\.([0-9a-f]{64})$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MASK = '[secreto]';

// → { handle, env, stdin, command, args } or null when the line is not one of the two shapes above.
export function parseArgs(argv) {
  const cut = argv.indexOf('--');
  if (cut < 0 || cut === argv.length - 1) return null;
  const head = argv.slice(0, cut); const [command, ...args] = argv.slice(cut + 1);
  const handle = head[0];
  if (!HANDLE.test(handle ?? '')) return null;
  if (head.length === 3 && head[1] === '--env' && ENV_NAME.test(head[2])) return { handle, env: head[2], stdin: false, command, args };
  if (head.length === 2 && head[1] === '--stdin') return { handle, env: null, stdin: true, command, args };
  return null;
}

// Trades the handle. → the secret, or null.
export function trade(handle, { timeoutMs = 10_000 } = {}) {
  const [, pipeId, ticket] = HANDLE.exec(handle) ?? [];
  if (!ticket) return Promise.resolve(null);
  return new Promise((resolve) => {
    let buf = ''; let done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(typeof v === 'string' && v ? v : null); };
    const socket = net.connect(pipeOf(pipeId), () => socket.write(`${JSON.stringify({ hello: ticket })}\n`));
    const timer = setTimeout(() => end(null), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk; const nl = buf.indexOf('\n'); if (nl < 0) return;
      let m = null; try { m = JSON.parse(buf.slice(0, nl)); } catch { m = null; }
      end(m?.ok ? m.secret : null);
    });
    socket.on('error', () => end(null));
    socket.on('close', () => end(null));
  });
}

// A stream's text with every copy of the secret hidden, also one split between two chunks (the last few characters wait
// for the next chunk).
export function masker(secret, write) {
  let tail = '';
  const keep = Math.max(0, secret.length - 1);
  return {
    push(chunk) {
      const text = (tail + chunk).split(secret).join(MASK);
      tail = keep ? text.slice(-keep) : ''; write(keep ? text.slice(0, text.length - tail.length) : text);
    },
    end() { if (tail) write(tail.split(secret).join(MASK)); tail = ''; }
  };
}

async function main() {
  const plan = parseArgs(process.argv.slice(2));
  if (!plan) { process.stderr.write('Uso: secret-run.mjs <identificador> (--env NOMBRE | --stdin) -- programa argumentos…\n'); process.exit(2); }
  let secret = await trade(plan.handle);
  if (!secret) { process.stderr.write('Orb: el identificador de la clave no vale (ya usado, caducado o retirado al bloquear Orb). Pídela otra vez con orb_request_secret.\n'); process.exit(2); }
  const env = { ...process.env };
  if (plan.env) env[plan.env] = secret;
  let run = { command: plan.command, args: plan.args, verbatim: false };
  if (process.platform === 'win32') { try { run = winPlan(plan.command, plan.args, env); } catch (error) { process.stderr.write(`${error.message}\n`); process.exit(127); } }
  const child = spawn(run.command, run.args, { env, stdio: [plan.stdin ? 'pipe' : 'inherit', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: run.verbatim });
  const out = masker(secret, (s) => process.stdout.write(s)); const err = masker(secret, (s) => process.stderr.write(s));
  child.stdout.setEncoding('utf8').on('data', (d) => out.push(d));
  child.stderr.setEncoding('utf8').on('data', (d) => err.push(d));
  if (plan.stdin) { child.stdin.on('error', () => {}); child.stdin.end(`${secret}\n`); }
  if (plan.env) delete env[plan.env];
  child.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exit(127); });
  child.on('close', (code) => { out.end(); err.end(); secret = null; process.exitCode = code ?? 1; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
