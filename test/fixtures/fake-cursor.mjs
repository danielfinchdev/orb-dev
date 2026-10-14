// A minimal Cursor CLI ("-p --output-format stream-json --stream-partial-output") to test src/agents/cursor.mjs. Run as
// `node fake-cursor.mjs …` (as the real one on Windows: node.exe + index.js). The prompt is the last argument.
//   ESPERA   works for 20 s (to be stopped)
//   LIMITE_USO ends with a usage-limit error
//   LIMITE_MODELO the CLI exits with the usage limit of one model (an API model of the plan) on its error output
//   FORMATO_NUEVO the current CLI: the complete text also carries timestamp_ms (and model_call_id), MCP tool look-ups and
//                 calls (getMcpToolsToolCall, mcpToolCall) and the tokens in the result
// The command line goes to FAKE_LOG when it is set.
import fs from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
const prompt = args.at(-1);
const i = args.indexOf('--resume');
const session = i >= 0 ? args[i + 1] : 'chat-cursor-1';
const out = (o) => process.stdout.write(`${JSON.stringify({ session_id: session, ...o })}\n`);
out({ type: 'system', subtype: 'init', model: /FORMATO_NUEVO|LIMITE_MODELO/.test(prompt) ? 'Gemini 3.8 Flash Medium' : 'auto' });
if (/LIMITE_MODELO/.test(prompt)) {
  const end = new Date(Date.now() + 6 * 86_400_000); // the end of the monthly cycle, in US order (M/D/YYYY)
  process.stderr.write(`ActionRequiredError: You've hit your usage limit You've saved $69 on API model usage this month with Pro. Switch to a different model or set a Spend Limit to continue with this model. Your usage limits will reset when your monthly cycle ends on ${end.getMonth() + 1}/${end.getDate()}/${end.getFullYear()}.
`);
  process.exit(1);
}
if (/FORMATO_NUEVO/.test(prompt)) {
  const at = 1791969911680; const call = 'call-1\nfc_1';
  out({ type: 'assistant', timestamp_ms: at, message: { content: [{ type: 'text', text: 'Voy a ' }] } });
  out({ type: 'assistant', timestamp_ms: at, message: { content: [{ type: 'text', text: 'crear saludo.html.' }] } });
  out({ type: 'assistant', timestamp_ms: at + 5, model_call_id: 'm-0', message: { content: [{ type: 'text', text: 'Voy a crear saludo.html.' }] } });
  out({ type: 'tool_call', subtype: 'started', call_id: 'g1', tool_call: { getMcpToolsToolCall: { args: { server: 'orb', toolName: 'orb_update_task', toolCallId: 'g1' } } } });
  out({ type: 'tool_call', subtype: 'completed', call_id: 'g1', tool_call: { getMcpToolsToolCall: { args: { server: 'orb', toolName: 'orb_update_task' }, result: { success: { content: '{"tool":"orb_update_task"}' } } } } });
  const args = { name: 'orb-orb_update_task', args: { id: 22, progress: 20, note: 'Creando saludo.html' }, toolCallId: call, providerIdentifier: 'orb', toolName: 'orb_update_task', smartModeApprovalOnly: false, serverIdentifier: 'orb' };
  out({ type: 'tool_call', subtype: 'started', call_id: call, tool_call: { mcpToolCall: { args, description: 'Marcar progreso' } } });
  out({ type: 'tool_call', subtype: 'completed', call_id: call, tool_call: { mcpToolCall: { args, result: { success: { content: [{ text: { text: '{"ok":true}' } }] } } } } });
  out({ type: 'assistant', timestamp_ms: at + 9, message: { content: [{ type: 'text', text: 'Hecho.' }] } });
  out({ type: 'assistant', timestamp_ms: at + 9, model_call_id: 'm-1', message: { content: [{ type: 'text', text: 'Hecho.' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Voy a crear saludo.html.Hecho.', duration_ms: 35158, usage: { inputTokens: 13038, outputTokens: 841, cacheReadTokens: 50688, cacheWriteTokens: 0 } });
  process.exit(0);
}
out({ type: 'assistant', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'Miro ' }] } });
out({ type: 'assistant', timestamp_ms: 2, message: { content: [{ type: 'text', text: 'la carpeta.' }] } });
out({ type: 'tool_call', subtype: 'started', call_id: 'k1', tool_call: { readToolCall: { args: { path: 'a.txt' } } } });
out({ type: 'tool_call', subtype: 'completed', call_id: 'k1', tool_call: { readToolCall: { args: { path: 'a.txt' }, result: { success: { content: 'hola' } } } } });
if (/ESPERA/.test(prompt)) await new Promise((r) => setTimeout(r, 20000));
if (/LIMITE_USO/.test(prompt)) { out({ type: 'result', subtype: 'error', is_error: true, result: 'You have reached your usage limit' }); process.exit(1); }
out({ type: 'assistant', message: { content: [{ type: 'text', text: `Cursor: ${prompt.split('\n')[0].slice(0, 60)}` }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: `Cursor: ${prompt.split('\n')[0].slice(0, 60)}`, duration_ms: 1234 });
