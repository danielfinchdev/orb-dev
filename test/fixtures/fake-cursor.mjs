// A minimal Cursor CLI ("-p --output-format stream-json --stream-partial-output") to test src/agents/cursor.mjs. Run as
// `node fake-cursor.mjs …` (as the real one on Windows: node.exe + index.js). The prompt is the last argument.
//   ESPERA   works for 20 s (to be stopped)
//   CUPO     ends with a usage-limit error
// The command line goes to FAKE_LOG when it is set.
import fs from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
const prompt = args.at(-1);
const i = args.indexOf('--resume');
const session = i >= 0 ? args[i + 1] : 'chat-cursor-1';
const out = (o) => process.stdout.write(`${JSON.stringify({ session_id: session, ...o })}\n`);
out({ type: 'system', subtype: 'init', model: 'auto' });
out({ type: 'assistant', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'Miro ' }] } });
out({ type: 'assistant', timestamp_ms: 2, message: { content: [{ type: 'text', text: 'la carpeta.' }] } });
out({ type: 'tool_call', subtype: 'started', call_id: 'k1', tool_call: { readToolCall: { args: { path: 'a.txt' } } } });
out({ type: 'tool_call', subtype: 'completed', call_id: 'k1', tool_call: { readToolCall: { args: { path: 'a.txt' }, result: { success: { content: 'hola' } } } } });
if (/ESPERA/.test(prompt)) await new Promise((r) => setTimeout(r, 20000));
if (/CUPO/.test(prompt)) { out({ type: 'result', subtype: 'error', is_error: true, result: 'You have reached your usage limit' }); process.exit(1); }
out({ type: 'assistant', message: { content: [{ type: 'text', text: `Cursor: ${prompt.split('\n')[0].slice(0, 60)}` }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: `Cursor: ${prompt.split('\n')[0].slice(0, 60)}`, duration_ms: 1234 });
