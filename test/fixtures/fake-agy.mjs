// A minimal Antigravity in print mode (`<bin> --print <prompt>` → the answer on stdout) to test src/agents/antigravity.mjs.
// The prompt is the last argument, or stdin when there is none. Keywords: FALLA (exit 2 with a message), FUGA (exit 3 with
// XAI_API_KEY on stderr), LENTO (waits 20 s). FAKE_AGY_ARGV receives the arguments and FAKE_AGY_STDIN the stdin.
import fs from 'node:fs';
const args = process.argv.slice(2);
if (process.env.FAKE_AGY_ARGV) fs.writeFileSync(process.env.FAKE_AGY_ARGV, JSON.stringify(args));
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', async () => {
  if (process.env.FAKE_AGY_STDIN) fs.writeFileSync(process.env.FAKE_AGY_STDIN, input);
  const said = input || args[args.length - 1] || '';
  if (/FUGA/.test(said)) { process.stderr.write(`fallo con ${process.env.XAI_API_KEY}\n`); process.exit(3); }
  if (/FALLA/.test(said)) { process.stderr.write('sin sesión iniciada\n'); process.exit(2); }
  if (/LENTO/.test(said)) await new Promise((resolve) => setTimeout(resolve, 20000));
  process.stdout.write(`Antigravity dice: ${said.slice(0, 40)}\n`);
});
