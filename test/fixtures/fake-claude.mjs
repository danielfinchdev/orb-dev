#!/usr/bin/env node
// Fake Claude Code for tests: prints the stream-json events of one turn. Behaviour is driven by the prompt text.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

// Calls one tool of the "orb" MCP server listed in --mcp-config, like Claude Code would (${VAR} expanded from our env).
async function mcpCall(configFile, name, args, whole = false) {
  const server = JSON.parse(fs.readFileSync(configFile, 'utf8')).mcpServers.orb;
  const env = { ...process.env };
  for (const [k, v] of Object.entries(server.env ?? {})) env[k] = String(v).replace(/\$\{(\w+)\}/g, (_, n) => process.env[n] ?? '');
  const child = spawn(server.command, server.args, { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: child.stdout });
  const replies = new Map();
  lines.on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (id, method, params) => new Promise((r) => { replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18' });
  const out = await rpc(2, 'tools/call', { name, arguments: args });
  child.stdin.end();
  if (whole) return out.result;
  return out.result?.content?.[0]?.text ?? JSON.stringify(out);
}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9.9.9 (Claude Code falso)'); process.exit(0); }
const pick = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const session = pick('--session-id') ?? pick('--resume') ?? 'sin-sesion';
let input = ''; process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', async () => {
  if (process.env.FAKE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify({ args, cwd: process.cwd(), input, env: Object.keys(process.env) }));
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  out({ type: 'system', subtype: 'init', session_id: session, model: pick('--model') ?? 'falso' });
  if (/DUERME/.test(input)) await new Promise((r) => setTimeout(r, 30_000));
  if (/FALLA/.test(input)) { process.stderr.write('algo salió mal'); process.exit(2); }
  if (/PLAN_GRATIS/.test(input)) { out({ type: 'result', subtype: 'error', is_error: true, result: 'Free plan users cannot run the agent from the CLI. Upgrade to Pro to continue.', session_id: session }); process.exit(1); }
  out({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } });
  out({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt', is_error: false }] } });
  if (/ESCRIBE/.test(input)) fs.writeFileSync('hecho-por-claude.txt', 'hola\n');
  const mcp = pick('--mcp-config');
  const proj = input.match(/CREA_TAREA (\S+)/);
  if (proj && mcp) {
    const text = await mcpCall(mcp, 'orb_create_task', { project: proj[1], title: 'Tarea del asistente', description: 'ESCRIBE un archivo de prueba', agent: 'claude' });
    out({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id: 't2', name: 'mcp__orb__orb_create_task', input: { project: proj[1] } }] } });
    out({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: text.slice(0, 300) }] } });
  }
  // The agents' browser: opens a page, types into its field, presses its button and looks again (each call is a new MCP
  // process, like separate turns: the conversation keeps the same page).
  const nav = input.match(/NAVEGA (\S+)/);
  if (nav && mcp) {
    const log = [];
    const first = await mcpCall(mcp, 'orb_browser_open', { url: nav[1] }); log.push(first);
    const refOf = (text, re) => Number(text.split('\n').find((l) => re.test(l))?.match(/^\[(\d+)\]/)?.[1]);
    log.push(await mcpCall(mcp, 'orb_browser_type', { ref: refOf(first, /input:text/), text: 'Hola, navegador' }));
    log.push(await mcpCall(mcp, 'orb_browser_click', { ref: refOf(first, /input:file/) }));
    log.push(await mcpCall(mcp, 'orb_browser_click', { ref: refOf(first, /button "Enviar"/) }));
    const shot = await mcpCall(mcp, 'orb_browser_screenshot', {}, true);
    log.push(`captura: ${shot?.content?.find((c) => c.type === 'image')?.data?.length ?? 0}`);
    log.push(await mcpCall(mcp, 'orb_browser_press', { key: 'F5' }));
    fs.writeFileSync('navegador.txt', log.join('\n----\n'));
    out({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id: 't3', name: 'mcp__orb__orb_browser_open', input: { url: nav[1] } }] } });
    out({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: first.slice(0, 300) }] } });
  }
  // Reports how far it is (as the prompt asks), then works a little longer so the live view can be read.
  const progress = /PROGRESO/.test(input) && input.match(/Tarea #(\d+)/);
  if (progress && mcp) { await mcpCall(mcp, 'orb_update_task', { id: Number(progress[1]), progress: 40, note: 'probando el formulario' }); await new Promise((r) => setTimeout(r, 2500)); }
  const done = input.match(/TERMINA (\d+)/);
  if (done && mcp) await mcpCall(mcp, 'orb_update_task', { id: Number(done[1]), status: 'done', result: 'hecho por el agente falso' });
  if (/LIMITE/.test(input)) { out({ type: 'result', subtype: 'error', is_error: true, result: "You've hit your usage limit · resets 5pm", session_id: session }); process.exit(1); }
  out({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: `Recibido: ${input.split('\n')[0].slice(0, 80)}` }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: `Recibido: ${input.split('\n')[0].slice(0, 80)}`, session_id: session, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 }, num_turns: 1 });
});
