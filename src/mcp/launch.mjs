// 3.8: starts one of the user's MCP connectors for an agent. The agent's config names only this script and a ticket
// (src/engine/agent-auth.mjs); the connector's real command and arguments come from the engine here, and its keys from the
// vault (a one-time grant the engine got for it), so they are
// never on a command line, in the agent's environment (its shell) or in a session log. The connector stops when the
// engine takes the ticket back (its agent's process closed) or goes away.
import { spawn } from 'node:child_process';
import { redeem, ticketFromArgs } from './auth-client.mjs';
import { killTree } from '../agents/common.mjs';
import { winPlan } from './win-spawn.mjs';
import { tradeGrant } from './vault-client.mjs';

const auth = await redeem(process.env.ORB_AUTH_PIPE, ticketFromArgs(), { reconnect: false }); // its connection closing is its grant ending
const launch = auth?.reply?.launch;
if (!launch?.command) { process.stderr.write('Orb no ha autorizado este conector\n'); process.exit(1); }

// Its environment: the agent's, without Orb's own variables, plus the connector's keys.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ORB_/i.test(k)));
Object.assign(env, launch.env ?? {});
// 3.8.1: the keys kept in the vault come straight from it (a one-time grant), never through the engine.
Object.assign(env, await tradeGrant(launch.vault));

// Windows: npm shims run as their script with node, an .exe directly, anything else through cmd.exe escaped (win-spawn).
const args = (launch.args ?? []).map(String);
let child;
try {
  if (process.platform === 'win32') {
    const plan = winPlan(String(launch.command), args, env);
    child = spawn(plan.command, plan.args, { env, stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: plan.verbatim });
  } else child = spawn(String(launch.command), args, { env, stdio: 'inherit' });
} catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }

child.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
child.on('exit', (code) => process.exit(code ?? 1));
// The whole tree (a .cmd connector runs under cmd.exe).
auth.onClose(() => { killTree(child); setTimeout(() => process.exit(0), 1500).unref(); });
