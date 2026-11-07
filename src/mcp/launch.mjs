// 3.8: starts one of the user's MCP connectors for an agent. The agent's config names only this script and a ticket
// (src/engine/agent-auth.mjs); the connector's real command, arguments and keys come from the engine here, so they are
// never on a command line, in the agent's environment (its shell) or in a session log. The connector stops when the
// engine takes the ticket back (its agent's process closed) or goes away.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { redeem, ticketFromArgs } from './auth-client.mjs';
import { killTree } from '../agents/common.mjs';

const auth = await redeem(process.env.ORB_AUTH_PIPE, ticketFromArgs());
const launch = auth?.reply?.launch;
if (!launch?.command) { process.stderr.write('Orb no ha autorizado este conector\n'); process.exit(1); }

// Its environment: the agent's, without Orb's own variables, plus the connector's keys.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ORB_|ELECTRON_RUN_AS_NODE$)/i.test(k)));
Object.assign(env, launch.env ?? {});

// Windows: a bare name (npx, uvx) is found in the PATH with its extensions; a .cmd/.bat runs through cmd.exe.
function resolveWin(command) {
  if (/[\\/]/.test(command) && fs.existsSync(command)) return command;
  const exts = path.extname(command) ? [''] : (env.PATHEXT ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';');
  for (const dir of (env.PATH ?? env.Path ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) { const file = path.join(dir, command + ext); if (fs.existsSync(file)) return file; }
  }
  return command;
}
const quote = (a) => (/[\s"&|<>^()%!]/.test(a) || !a ? `"${String(a).replace(/"/g, '""')}"` : a);
const args = (launch.args ?? []).map(String);
let child;
if (process.platform === 'win32') {
  const file = resolveWin(String(launch.command));
  child = /\.(cmd|bat)$/i.test(file)
    ? spawn(env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${[file, ...args].map(quote).join(' ')}"`], { env, stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true })
    : spawn(file, args, { env, stdio: 'inherit', windowsHide: true });
} else child = spawn(String(launch.command), args, { env, stdio: 'inherit' });

child.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
child.on('exit', (code) => process.exit(code ?? 1));
// The whole tree (a .cmd connector runs under cmd.exe).
auth.onClose(() => { killTree(child); setTimeout(() => process.exit(0), 1500).unref(); });
