// «Hay una versión nueva» of each agent's program. The only thing in Orb that asks the internet about agents, and only
// when the user presses «Buscar actualizaciones»: one GET per package to npm's public registry with the package's name in the
// address and nothing else (no identifiers, no account, no PC data). The answer is kept, so the window can show it again
// without asking; nothing is ever updated here.

// The public npm package of each agent whose latest version can be asked, and the command Orb itself uses to install it
// (src/engine/host/installer.mjs: Claude Code with its own installer, the rest with npm).
export const PACKAGES = Object.freeze({
  claude: '@anthropic-ai/claude-code', codex: '@openai/codex', gemini: '@google/gemini-cli', copilot: '@github/copilot',
  opencode: 'opencode-ai', qwen: '@qwen-code/qwen-code'
});
const NPM_COMMAND = Object.freeze({
  codex: 'npm install -g @openai/codex@latest', gemini: 'npm install -g @google/gemini-cli',
  copilot: 'npm install -g @github/copilot', opencode: 'npm install -g opencode-ai', qwen: 'npm install -g @qwen-code/qwen-code'
});
// The command that installs the agent on this platform, or null when there is none (then none is shown).
export function updateCommand(agent, platform = process.platform) {
  if (agent === 'claude') return platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : platform === 'darwin' || platform === 'linux' ? 'curl -fsSL https://claude.ai/install.sh | bash' : null;
  return NPM_COMMAND[agent] ?? null;
}
// Claude's own installer takes whatever version it publishes at that moment: it does not promise the one npm showed.
const PINNED_BY_INSTALLER = new Set(Object.keys(NPM_COMMAND));

// The network, behind one door so a test swaps it. With the fake agents of the tests it never goes out.
export const net = {
  fetch: (url, options) => (process.env.ORB_FAKE_AGENTS ? Promise.reject(new Error('offline')) : globalThis.fetch(url, options))
};

export const versionIn = (text) => String(text ?? '').match(/\d+(?:\.\d+){1,3}/)?.[0] ?? null;
// > 0 when a is newer than b; compares the numbers part by part (2.4.10 is newer than 2.4.3).
export function compareVersions(a, b) {
  const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); }
  return 0;
}

const KEY = 'agent_updates';
// What the last check found: { at, latest: { agent: '2.4.3' } }, or null.
export const savedUpdates = (board) => board?.settingJson?.(KEY) ?? null;

// The update info of one agent for the window: { latest, available, command, exact, checkedAt } or null when nothing is known.
// available is null when the installed version is not known (not «up to date»); exact says whether the installer installs
// the version shown or only the latest one it publishes.
export function updateInfo(board, agent, installedVersion) {
  const saved = savedUpdates(board); const latest = saved?.latest?.[agent];
  if (!latest) return null;
  const mine = versionIn(installedVersion);
  return { latest, available: mine ? compareVersions(latest, mine) > 0 : null, command: updateCommand(agent), exact: PINNED_BY_INSTALLER.has(agent), checkedAt: saved.at };
}

// The answer of the registry is a few hundred bytes: anything bigger than this is not read.
const MAX_BODY = 64 * 1024;
async function readJson(res) {
  if (Number(res.headers?.get?.('content-length')) > MAX_BODY) throw new Error('registry answer too big');
  if (!res.body?.getReader) return res.json();
  const reader = res.body.getReader(); const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > MAX_BODY) { try { await reader.cancel(); } catch { /* closed */ } throw new Error('registry answer too big'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function latestOf(pkg, timeoutMs) {
  const res = await net.fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  return versionIn((await readJson(res))?.version);
}

// Asks for the agents given (all the known ones by default); an agent that does not answer keeps its last known version.
// → { at, latest, failed: [agent] }
export async function checkUpdates(board, { agents = Object.keys(PACKAGES), timeoutMs = 6000 } = {}) {
  const saved = savedUpdates(board); const latest = { ...(saved?.latest ?? {}) }; const failed = [];
  await Promise.all(agents.filter((a) => PACKAGES[a]).map(async (a) => {
    try { const v = await latestOf(PACKAGES[a], timeoutMs); if (v) latest[a] = v; else failed.push(a); } catch { failed.push(a); }
  }));
  const out = { at: Date.now(), latest };
  board.settingJson(KEY, out);
  return { ...out, failed };
}
