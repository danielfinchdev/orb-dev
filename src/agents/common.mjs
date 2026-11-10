// Shared pieces of the agent adapters: the MCP config that connects every agent to the assistant's board, and how
// a tool call is described. (Where the CLIs live and how processes start and stop: src/platform/proc.mjs.)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeRuntime } from '../platform/proc.mjs';
// How an agent process starts the assistant's MCP server (server.mjs) or one of the user's connectors (launch.mjs, which
// gets the connector's real command and keys from the engine): nodeRuntime() and the script. Nothing secret goes in here.
// (ORB_MCP_SCRIPT: another copy of the server, when the app names one; launch.mjs sits next to it.)
const mcpDir = () => (process.env.ORB_MCP_SCRIPT ? path.dirname(process.env.ORB_MCP_SCRIPT) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp'));
export function orbMcpServer(env = {}) {
  const script = process.env.ORB_MCP_SCRIPT || path.join(mcpDir(), 'server.mjs');
  return { command: nodeRuntime(), args: [script], env };
}
export const connectorLauncher = (env = {}) => ({ command: nodeRuntime(), args: [path.join(mcpDir(), 'launch.mjs')], env });

// 3.8: the MCP servers' environment (Orb's signatures, a connector's keys) never goes on a command line, which any
// process of the user can read: each value moves to the agent's own environment under a name of its own, and the
// server's config keeps only a reference the agent expands when it starts the server (ref(name): "${NAME}" for Claude
// Code, "${env:NAME}" for Cursor). → { servers, env }
export function mcpEnvByRef(servers, ref) {
  const out = {}; const env = {};
  for (const [name, s] of Object.entries(servers ?? {})) {
    const { env: own, ...rest } = s ?? {};
    const refs = {};
    for (const [k, v] of Object.entries(own ?? {})) {
      const key = `ORB_MCP_${name}_${k}`.replace(/[^A-Za-z0-9_]/g, '_');
      env[key] = String(v); refs[k] = ref(key);
    }
    out[name] = Object.keys(refs).length ? { ...rest, env: refs } : rest;
  }
  return { servers: out, env };
}

// Bounded text for the UI (tool inputs and outputs can be huge).
export const clip = (value, max = 4000) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return s.length > max ? `${s.slice(0, max)}… (${s.length - max} caracteres más)` : s;
};

// Tool inputs shown as one line: the most telling field first.
export function describeInput(input) {
  if (!input || typeof input !== 'object') return clip(input, 300);
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) if (input[key]) return clip(String(input[key]), 300);
  return clip(input, 300);
}
