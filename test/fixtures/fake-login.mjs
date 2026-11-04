// A fake sign-in of the agents' CLIs, to test src/agents/login.mjs. Run as `node fake-login.mjs <args>`:
//   auth login --claudeai   Claude Code: prints the link (with an OSC 8 hyperlink and colours, as the real one), then
//                           «Login successful.» and writes .credentials.json in CLAUDE_CONFIG_DIR.
//   app-server              Codex: JSON-RPC with initialize, account/login/start (chatgpt / chatgptDeviceCode),
//                           account/login/completed, account/read and account/login/cancel; writes auth.json in CODEX_HOME.
//   login --device-auth     Codex's CLI fallback: link and code in its output, exit 0 once «signed in».
// What happens is chosen by FAKE_LOGIN or by words in the account's folder name: «pegar» (Claude waits for a pasted
// code), «falla» (the sign-in is refused), «sinurl» (the CLI ends before any link), «viejo» (Codex without the login
// methods over app-server), «espera» (nothing happens until cancelled).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const dir = process.env.CLAUDE_CONFIG_DIR || process.env.CODEX_HOME || '';
const how = `${process.env.FAKE_LOGIN ?? ''} ${path.basename(dir)}`;
const has = (w) => how.includes(w);
const save = (file) => { if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, file), '{"falso":true}'); } };
const later = (ms, fn) => setTimeout(fn, ms);

if (args[0] === 'auth' && args[1] === 'login') {
  if (has('sinurl')) { process.stderr.write('Login failed: Unable to reach the sign-in service\n'); process.exit(1); }
  const url = 'https://claude.com/cai/oauth/authorize?code=true&client_id=prueba&state=abc123';
  process.stdout.write('\x1b[1mOpening browser to sign in…\x1b[0m\n');
  process.stdout.write(`If the browser didn't open, visit: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\n`);
  process.stdout.write('Paste code here if prompted > ');
  const done = () => { save('.credentials.json'); process.stdout.write('\nLogin successful.\n'); process.exit(0); };
  if (has('falla')) later(150, () => { process.stderr.write('Login failed: Request failed with status code 403\n'); process.exit(1); });
  else if (has('pegar') || has('espera')) {
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      const [code, state] = line.trim().split('#');
      if (!code || !state) { process.stderr.write('\nInvalid code. Please make sure the full code was copied.\n'); return; }
      done();
    });
  } else later(200, done);
} else if (args[0] === 'login' && args[1] === '--device-auth') {
  process.stdout.write('Follow these steps to sign in with ChatGPT using device code authorization:\n\n');
  process.stdout.write('1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n');
  process.stdout.write('2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94mWXYZ-12345\x1b[0m\n\n');
  if (has('falla')) later(150, () => { process.stderr.write('Error logging in with device code: device code expired\n'); process.exit(1); });
  else later(200, () => { save('auth.json'); process.stdout.write('Successfully logged in\n'); process.exit(0); });
} else if (args[0] === 'app-server') {
  const write = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  let signedIn = false; let pending = null;
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    const { id, method, params = {} } = m;
    if (method === 'initialize') return write({ id, result: { userAgent: 'codex-falso/0.0' } });
    if (method === 'initialized') return;
    if (method === 'account/read') return write({ id, result: { account: signedIn ? { type: 'chatgpt', email: 'ana@example.com', planType: 'plus' } : null, requiresOpenaiAuth: true } });
    if (method === 'account/login/start' && !has('viejo')) {
      const loginId = 'login-1';
      if (params.type === 'chatgptDeviceCode') write({ id, result: { type: 'chatgptDeviceCode', loginId, verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGH' } });
      else write({ id, result: { type: 'chatgpt', loginId, authUrl: 'https://auth.openai.com/oauth/authorize?client_id=prueba&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback' } });
      if (has('espera')) return;
      pending = later(200, () => {
        if (has('falla')) return write({ method: 'account/login/completed', params: { loginId, success: false, error: 'Sign-in was denied' } });
        signedIn = true; save('auth.json');
        write({ method: 'account/login/completed', params: { loginId, success: true, error: null } });
      });
      return;
    }
    if (method === 'account/login/cancel') { clearTimeout(pending); write({ id, result: {} }); return write({ method: 'account/login/completed', params: { loginId: params.loginId, success: false, error: 'cancelled' } }); }
    if (id != null) write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  });
} else if (args[0] === '--version') {
  process.stdout.write('0.0.0 (falso)\n');
} else {
  process.stderr.write(`no entiendo: ${args.join(' ')}\n`); process.exit(2);
}
