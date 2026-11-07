// 3.8: starts one of the user's MCP connectors for an agent. The agent's config names only this script and a ticket
// (src/engine/agent-auth.mjs); the connector's real command, arguments and keys come from the engine here, so they are
// never on a command line, in the agent's environment (its shell) or in a session log. The connector stops when the
// engine takes the ticket back (its agent's process closed) or goes away.
import { spawn } from 'node:child_process';
import { redeem, ticketFromArgs } from './auth-client.mjs';
import { killTree } from '../agents/common.mjs';
import { winPlan } from './win-spawn.mjs';

const auth = await redeem(process.env.ORB_AUTH_PIPE, ticketFromArgs(), { reconnect: false }); // its connection closing is its grant ending
const launch = auth?.reply?.launch;
if (!launch?.command) { process.stderr.write('Orb no ha autorizado este conector\n'); process.exit(1); }

// Its environment: the agent's, without Orb's own variables, plus the connector's keys.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ORB_|ELECTRON_RUN_AS_NODE$)/i.test(k)));
Object.assign(env, launch.env ?? {});

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
