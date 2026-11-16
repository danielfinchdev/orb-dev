// A minimal Pi in RPC mode (`pi --mode rpc`: JSON lines over stdio) to test src/agents/pi.mjs. Keywords in the prompt:
//   HERRAMIENTA  runs a tool (start/end) before answering   ESPERA  works until it gets {type:'abort'}
//   FALLA        answers the command with success:false      FUGA    dies saying XAI_API_KEY on stderr
// FAKE_PI_LOG receives every command; FAKE_PI_ARGV the arguments.
import fs from 'node:fs';
import readline from 'node:readline';
if (process.env.FAKE_PI_ARGV) fs.writeFileSync(process.env.FAKE_PI_ARGV, JSON.stringify(process.argv.slice(2)));
const write = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
let abort = null;
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (process.env.FAKE_PI_LOG) fs.appendFileSync(process.env.FAKE_PI_LOG, `${JSON.stringify(m)}\n`);
  if (m.type === 'abort') { abort?.(); return; }
  if (m.type !== 'prompt') return;
  const said = String(m.message);
  if (/FUGA/.test(said)) { process.stderr.write(`fallo con ${process.env.XAI_API_KEY}\n`); process.exit(5); }
  if (/FALLA/.test(said)) return write({ type: 'response', command: 'prompt', success: false, error: 'sin modelo' });
  write({ type: 'response', command: 'prompt', success: true });
  write({ type: 'agent_start' });
  if (/HERRAMIENTA/.test(said)) {
    write({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: 'a.txt' } });
    write({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', result: 'contenido', isError: false });
  }
  if (/ESPERA/.test(said)) { await new Promise((resolve) => { abort = resolve; setTimeout(resolve, 20000); }); abort = null; return write({ type: 'agent_end', messages: [] }); }
  write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hola desde ' } });
  write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: `Pi: ${said.slice(0, 40)}` } });
  write({ type: 'agent_end', messages: [] });
});
