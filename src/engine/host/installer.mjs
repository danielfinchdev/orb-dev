// Installs what the assistant needs on Windows with each vendor's official installer: Claude Code, Codex, Cursor, Git,
// GitHub CLI, Node.js (Codex comes from npm) and Tailscale (phone access). Runs in a hidden PowerShell (Windows' own
// prompts, such as UAC, still appear); the script only holds fixed commands (no text from the user or the agents) and goes
// straight to PowerShell on its command line (no script file another program could swap before it runs). It writes its
// progress to a log the engine watches and the app shows as a progress bar.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { spawn } from 'node:child_process';
import { ADAPTERS, quickRun } from '../../agents/index.mjs';
import { IS_WIN, cleanEnv, inPath, killTree } from '../../platform/proc.mjs';
import { checkDevTools, toolVersion } from '../../platform/dev-tools.mjs';
import { EXTRA_ITEMS, PROBES, WINGET_IDS, wingetInstall, wingetUpgrade, playwrightInstalled, vswhere, hasAndroidStudio, parseUpgrades, suggestionsFor } from './tool-catalog.mjs';

// id → what it is, how to check it and the official way to install it.
const ITEMS = [
  { id: 'git', label: 'Git', why: 'deshacer tareas con historial, ramas y GitHub', install: wingetInstall('git'), wingetKey: 'git', needsWinget: true },
  { id: 'node', label: 'Node.js', why: 'lo necesita Codex para instalarse', install: wingetInstall('node'), wingetKey: 'node', needsWinget: true, exe: 'node.exe' },
  { id: 'claude', label: 'Claude Code', why: 'agente del asistente', install: "irm https://claude.ai/install.ps1 | iex" },
  { id: 'codex', label: 'Codex', why: 'agente de OpenAI', install: 'npm install -g @openai/codex', after: ['node'] },
  { id: 'cursor', label: 'Cursor CLI', why: 'agente de Cursor', install: "irm 'https://cursor.com/install?win32=true' | iex" },
  { id: 'gh', label: 'GitHub CLI', why: 'publicar y crear pull requests con tu cuenta', install: wingetInstall('gh'), wingetKey: 'gh', needsWinget: true },
  { id: 'tailscale', label: 'Tailscale', why: 'usar el asistente desde el móvil de forma privada', install: wingetInstall('tailscale'), wingetKey: 'tailscale', needsWinget: true, optional: true, group: 'mobile' },
  // more agents (ACP). Optional: each one with its own account (Google, GitHub…), signed in with its own program.
  { id: 'gemini', label: 'Gemini CLI', why: 'agente de Google: contexto enorme, investigar y revisar', install: 'npm install -g @google/gemini-cli', after: ['node'], optional: true },
  { id: 'copilot', label: 'GitHub Copilot CLI', why: 'agente de GitHub, con tu suscripción de Copilot', install: 'npm install -g @github/copilot', after: ['node'], optional: true },
  { id: 'opencode', label: 'OpenCode', why: 'agente abierto con muchos proveedores y modelos', install: 'npm install -g opencode-ai', after: ['node'], optional: true },
  { id: 'qwen', label: 'Qwen Code', why: 'agente rápido y barato para tareas repetitivas', install: 'npm install -g @qwen-code/qwen-code', after: ['node'], optional: true },
  // Python tool: installed with uv (fetched from Astral when missing), which puts it in ~/.local/bin.
  { id: 'hermes', label: 'Hermes Agent', why: 'agente autónomo con memoria y muchos proveedores', optional: true,
    install: String.raw`$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"; if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { irm https://astral.sh/uv/install.ps1 | iex; $env:Path = "$env:USERPROFILE\.local\bin;$env:Path" }; uv tool install 'hermes-agent[acp]'` }
];
// The tools of the page's other groups (tool-catalog.mjs): optional, never part of the first run, installed with winget or one
// fixed command. `extra` marks them; an installed one is never installed again.
for (const x of EXTRA_ITEMS) ITEMS.push({ ...x, install: x.wingetKey ? wingetInstall(x.wingetKey) : x.install, needsWinget: Boolean(x.wingetKey), optional: true, extra: true });
const AGENT_ITEMS = ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'opencode', 'qwen', 'hermes', 'grok', 'devin', 'droid', 'omp', 'pi', 'antigravity'];

// `--version` runs the file, so it only runs files outside the engine's working directory: Windows looks a bare name up
// there first, and a PATH entry inside it (a project folder) could hold a planted program. Folders the user can write
// (~/.local/bin, ~/.cargo/bin, WinGet/Links…) are detected by the file's existence at load; their version is only asked
// when the user opens the block by hand (check({ versions: true })).
const within = (f, root) => { const rel = path.relative(path.resolve(root).toLowerCase(), path.resolve(f).toLowerCase()); return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)); };
const underCwd = (f) => within(f, process.cwd());
const userWritable = (dir) => [process.env.USERPROFILE, process.env.LOCALAPPDATA].some((r) => r && within(dir, r));
async function versionByName(name, args) {
  if (!IS_WIN) return versionOf(name, args);
  const file = inPath(name).find((f) => !underCwd(f));
  return file ? versionOf(file, args) : null;
}
async function versionOf(cmd, args = ['--version']) { const r = await quickRun(cmd, args, { timeoutMs: 8000 }); return r.ok ? r.out.split(/\r?\n/)[0].slice(0, 60) : null; }
const tailscaleExe = () => (IS_WIN ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe') : 'tailscale');

// One tool of the catalog: its program answers (by name, then in the folders its installer uses) or its marker is there.
async function probeExtra(id, { versions = false } = {}) {
  if (id === 'playwright') return { installed: playwrightInstalled(), version: null };
  if (id === 'buildTools') {
    const r = IS_WIN ? await quickRun(vswhere(), ['-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-latest', '-property', 'installationVersion'], { timeoutMs: 8000 }) : { ok: false, out: '' };
    return { installed: r.ok && Boolean(r.out.trim()), version: r.ok ? r.out.split(/\r?\n/)[0].trim() || null : null };
  }
  if (id === 'java' || id === 'androidSdk') {
    const d = checkDevTools().find((x) => x.id === id);
    const version = d?.path ? toolVersion(id, d.path) : null;
    return { installed: Boolean(d?.path) || (id === 'androidSdk' && hasAndroidStudio()), version };
  }
  const probe = PROBES[id]; if (!probe) return { installed: false, version: null };
  const name = IS_WIN ? `${probe.exe}.exe` : probe.exe;
  let version = await versionByName(probe.exe, probe.args);
  if (!version && IS_WIN) {
    for (const dir of probe.dirs()) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      if (userWritable(dir)) return { installed: true, version: versions ? await versionOf(file, probe.args) : null };
      version = await versionOf(file, probe.args); if (version) break;
    }
  }
  return { installed: Boolean(version), version };
}

// What `winget upgrade` found, kept so opening the block again does not ask the internet again.
let upgrades = null; // { at, found: { toolId: { current, latest } } }
const UPGRADE_TTL = 30 * 60_000;
export function cachedUpgrades() { return upgrades?.found ?? null; }
// Only here (opening «Herramientas» or «Comprobar») does Orb ask winget for newer versions; it installs nothing.
export async function checkUpgrades({ force = false, run = quickRun } = {}) {
  if (!IS_WIN) return { at: null, found: {}, available: false };
  if (!force && upgrades && Date.now() - upgrades.at < UPGRADE_TTL) return { at: upgrades.at, found: upgrades.found, available: true };
  const r = await run('winget', ['upgrade', '--source', 'winget', '--accept-source-agreements', '--disable-interactivity'], { timeoutMs: 60_000, maxOut: 500_000 }); // a long table must not be cut mid-row
  if (!r.out) return { at: upgrades?.at ?? null, found: upgrades?.found ?? {}, available: false };
  upgrades = { at: Date.now(), found: parseUpgrades(r.out) };
  return { at: upgrades.at, found: upgrades.found, available: true };
}
export const forgetUpgrades = () => { upgrades = null; };

// Tools a project's files ask for that are not installed yet: [{ tool, file, label, installable }]. `dir` comes from the
// project the engine already knows (never from the window's text).
export async function suggest(dir) {
  const wanted = suggestionsFor(dir);
  const out = [];
  for (const w of wanted) {
    const item = ITEMS.find((i) => i.id === w.tool);
    if (!item) {
      if (w.tool === 'flutter' && checkDevTools().find((x) => x.id === 'flutter')?.path) continue; // already installed
      out.push({ tool: w.tool, file: w.file, label: w.tool === 'flutter' ? 'Flutter' : w.tool, installable: false }); continue; }
    if ((await probeExtra(item.id)).installed) continue;
    out.push({ tool: item.id, file: w.file, label: item.label, installable: true });
  }
  return out;
}

export async function check({ versions: askVersions = false } = {}) {
  const out = {};
  for (const agent of AGENT_ITEMS) out[agent] = Boolean(ADAPTERS[agent]?.detect(ctx.config.agents[agent] ?? {}));
  // A tool is there when its program answers or, at least, when its executable is in the PATH: on a busy PC a version
  // call can fail for a moment, and «No instalado» (ticked) would make the user install it again.
  const versions = {};
  const present = async (name, args) => { versions[name] = await versionByName(name, args); return Boolean(versions[name]) || inPath(name).length > 0; };
  out.git = await present('git');
  out.node = await present('node');
  out.gh = await present('gh');
  out.tailscale = Boolean(await versionOf(tailscaleExe(), ['version']));
  await Promise.all(EXTRA_ITEMS.map(async (x) => { const r = await probeExtra(x.id, { versions: askVersions }); out[x.id] = r.installed; versions[x.id] = r.version; }));
  const found = upgrades?.found ?? {};
  return ITEMS.map((i) => ({ id: i.id, label: i.label, why: tr(`msg.installer.why.${i.id}`), optional: Boolean(i.optional), installed: out[i.id], version: versions[i.id] ?? null,
    ...(i.group ? { group: i.group } : {}), ...(i.extra ? { extra: true } : {}), ...(i.wingetKey ? { canUpdate: true } : {}), ...(out[i.id] && found[i.id] ? { update: found[i.id] } : {}) }));
}

// The PowerShell script for the chosen items, in a safe order (Node before Codex). Only fixed text from ITEMS goes in.
// Node added here for an npm agent is usually there already (the user cannot tick an installed item): its step checks
// first and counts as done, instead of asking winget to install it again (winget fails when there is nothing to update).
export function plan(ids) {
  const chosen = ITEMS.filter((i) => ids.includes(i.id));
  if (chosen.some((i) => i.after?.includes('node')) && !chosen.some((i) => i.id === 'node')) chosen.unshift({ ...ITEMS.find((i) => i.id === 'node'), ifMissing: true });
  return chosen;
}

// update: true builds `winget upgrade` for the winget tools among the ids (and nothing else); otherwise the install commands.
export function buildScript(ids, logFile, { update = false } = {}) {
  const chosen = update ? ITEMS.filter((i) => i.wingetKey && ids.includes(i.id)) : plan(ids);
  // PowerShell takes the typographic quotes ‘ ’ ‚ ‛ as quotes too: all are doubled (a folder may be called «Ana’s»).
  const q = (s) => `'${String(s).replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c)}'`;
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$log = ${q(logFile)}`,
    "function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }",
    'function Step($id, $title, [scriptblock]$do) {',
    "  Add-Content -LiteralPath $log -Value \"INICIO $id\"; Write-Host ''; Write-Host \"== $title\" -ForegroundColor Cyan",
    `  try { $global:LASTEXITCODE = 0; & $do; if ($LASTEXITCODE -ne 0) { throw (${q(tr('msg.installer.exitCode'))} + " $LASTEXITCODE") }; Add-Content -LiteralPath $log -Value "OK $id"; Write-Host ('   ' + ${q(tr('msg.installer.done'))}) -ForegroundColor Green }`,
    `  catch { Add-Content -LiteralPath $log -Value "ERROR $id $_"; Write-Host ('   ' + ${q(tr('msg.installer.failed'))} + " $_") -ForegroundColor Red }`,
    '  Refresh-Path',
    '}',
    "$hasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)",
    `Write-Host ${q(tr('msg.installer.intro'))} -ForegroundColor Yellow`
  ];
  for (const item of chosen) {
    const command = update ? wingetUpgrade(item.wingetKey) : item.install;
    const install = item.needsWinget
      ? `if (-not $hasWinget) { throw ${q(tr('msg.installer.noWinget'))} }; ${command}`
      : command;
    const body = item.ifMissing && item.exe
      ? `if (Get-Command ${q(item.exe)} -ErrorAction SilentlyContinue) { Write-Host ('   ' + ${q(tr('msg.installer.present'))}) } else { ${install} }`
      : install;
    lines.push(`Step ${q(item.id)} ${q(item.label)} { ${body} }`);
  }
  lines.push("Add-Content -LiteralPath $log -Value 'FIN'");
  return lines.join('\r\n');
}

let current = null; // { logFile, ids, startedAt, closed }
let timer = null;
const MAX_MS = 45 * 60_000;

// spawnFn: how the hidden PowerShell is started (the tests give one that installs nothing).
// have: ids already installed (a tool of the catalog that is there is never installed again); onEvent({ id, label, state,
// update, detail }) tells each step's start, end and failure (the engine writes them to Activity).
export function start(ids, emit, { update = false, have = null, onEvent = null, spawnFn = spawn, maxMs = MAX_MS } = {}) {
  if (!IS_WIN) throw new Error(tr('msg.installer.windowsOnly'));
  if (current && !progress().finished && Date.now() - current.startedAt < MAX_MS) throw new Error(tr('msg.installer.alreadyRunning'));
  const known = ids.filter((id) => ITEMS.some((i) => i.id === id && (!update || i.wingetKey)));
  const wanted = update || !have ? known : known.filter((id) => { const i = ITEMS.find((x) => x.id === id); return !(i.extra || i.wingetKey) || !have.has(id); });
  const valid = (update ? ITEMS.filter((i) => wanted.includes(i.id)) : plan(wanted)).map((i) => i.id);
  if (!valid.length) throw new Error(tr('msg.installer.chooseOne'));
  const dir = path.join(ctx.paths.runs, 'instalacion');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const logFile = path.join(dir, `progreso-${stamp}.log`);
  fs.writeFileSync(logFile, '');
  const encoded = Buffer.from(buildScript(valid, logFile, { update }), 'utf16le').toString('base64');
  const run = { logFile, ids: valid, startedAt: stamp, closed: false };
  current = run;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); // full path: nothing in PATH can stand in
  // Hidden, with its output in a file next to the progress log: a separate console window is not reliable (on some
  // Windows 11 PCs a detached PowerShell closes at once without running anything). The app shows the progress.
  const output = fs.createWriteStream(logFile.replace(/\.log$/, '-salida.txt'));
  // stderr only repeats the same text as PowerShell's CLIXML; failures are already in the progress log (ERROR lines).
  const child = spawnFn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: cleanEnv() });
  child.stdout.pipe(output, { end: false });
  child.on('error', (error) => { output.write(`${error.message}\n`); run.closed = true; });
  child.on('exit', () => { run.closed = true; output.end(); }); // finished or stopped
  // Progress for the window: the script appends INICIO / OK / ERROR lines and FIN.
  clearInterval(timer);
  const told = new Map();
  const tell = (s) => {
    if (!onEvent) return;
    for (const step of s.steps) {
      const before = told.get(step.id) ?? 'pendiente';
      if (step.state === before || step.state === 'pendiente') continue;
      const send = (state) => { try { onEvent({ id: step.id, label: step.label, state, update, detail: step.detail }); } catch { /* the log never stops an install */ } };
      if (before === 'pendiente' && step.state !== 'instalando') send('instalando');
      send(step.state);
      if (update && step.state === 'hecho' && upgrades) delete upgrades.found[step.id]; // no longer newer
      told.set(step.id, step.state);
    }
    // closed before a step ended (the window or the process went away): its start has no end, so it is written as failed
    if (s.finished) for (const step of s.steps) if (told.get(step.id) === 'instalando') { try { onEvent({ id: step.id, label: step.label, state: 'error', update, detail: tr('install.interrupted') }); } catch { /* idem */ } told.set(step.id, 'error'); }
  };
  timer = setInterval(() => {
    const s = progress();
    tell(s);
    emit('installer:progress', s);
    if (!s.finished && Date.now() - stamp > maxMs) tell({ ...s, finished: true }); // a step still open is written as failed
    if (s.finished || Date.now() - stamp > maxMs) { clearInterval(timer); timer = null; }
  }, 1500);
  return progress();
}

export function progress() {
  if (!current) return { running: false, steps: [], finished: false };
  let text = ''; try { text = fs.readFileSync(current.logFile, 'utf8'); } catch { /* not yet */ }
  const steps = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(INICIO|OK|ERROR) (\S+)\s*(.*)$/);
    if (m) steps[m[2]] = { state: m[1] === 'INICIO' ? 'instalando' : m[1] === 'OK' ? 'hecho' : 'error', detail: m[3]?.slice(0, 300) ?? '' };
  }
  const finished = /^FIN$/m.test(text) || current.closed; // closing its window early also ends it
  return { running: !finished, finished, ...(current.closed && !/^FIN$/m.test(text) ? { interrupted: true } : {}), steps: current.ids.map((id) => ({ id, label: ITEMS.find((i) => i.id === id)?.label ?? id, ...(steps[id] ?? { state: 'pendiente', detail: '' }) })) };
}

// ---- 3.5 «Solo Orb»: install or update Claude Code and Codex from Ajustes › Agentes, with one button and no window.
// Each one with its official method, for this user only (no administrator): Claude Code with its native installer
// (install.ps1 / install.sh, into ~/.local/bin), Codex with npm (on Windows the user's own global folder, %APPDATA%\npm;
// on Linux and macOS --prefix ~/.local, where codex.mjs looks for it). Hidden, its output piped; progress comes as
// 'agents:install' events { agent, state: 'instalando' | 'hecho' | 'error', line, version, message }.
export const AGENT_INSTALL = ['claude', 'codex'];
const agentJobs = new Map(); // agent -> job
const AGENT_MAX_MS = 15 * 60_000;
const lastLine = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 200) ?? '';
const userHomeDir = () => process.env.USERPROFILE || process.env.HOME || '';

// The command for an agent on this system: { cmd, args } (fixed text only), or an error in words.
export function agentInstallCommand(agent, { platform = process.platform, npm = null } = {}) {
  const win = platform === 'win32';
  const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const ps = (script) => ({ cmd: powershell, args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`] });
  if (agent === 'claude') return win ? ps('irm https://claude.ai/install.ps1 | iex') : { cmd: 'bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] };
  if (agent === 'codex') {
    if (win) return ps('npm install -g @openai/codex@latest');
    const npmCmd = npm ?? (inPath('npm')[0] || null);
    if (!npmCmd) return { error: tr('msg.installer.agentNoNpm') };
    return { cmd: npmCmd, args: ['install', '-g', '--prefix', path.join(userHomeDir(), '.local'), '@openai/codex@latest'] };
  }
  return { error: tr('msg.installer.agentUnsupported') };
}

export const agentInstallState = (agent) => { const j = agentJobs.get(agent); return j ? { agent, state: j.state, line: j.line, version: j.version ?? null, message: j.message ?? null, startedAt: j.startedAt } : { agent, state: 'nada' }; };

// Starts it; resolves at once with the first state. onDone(state) runs after it ends (the engine refreshes the agents).
export function installAgent(agent, emit, { onDone = null, command = null, version = null } = {}) {
  if (!AGENT_INSTALL.includes(agent)) throw new Error(tr('msg.installer.agentUnsupported'));
  if (agentJobs.get(agent)?.state === 'instalando') throw new Error(tr('msg.installer.alreadyRunning'));
  if (IS_WIN && agent === 'codex' && !command && !inPath('npm').length && !inPath('node').length) throw new Error(tr('msg.installer.agentNoNpm'));
  const how = command ?? agentInstallCommand(agent);
  if (how.error) throw new Error(how.error);
  const job = { state: 'instalando', line: '', startedAt: Date.now(), out: '' };
  agentJobs.set(agent, job);
  const send = () => emit('agents:install', agentInstallState(agent));
  const end = async (state, message) => {
    if (job.state !== 'instalando') return;
    clearTimeout(job.timer);
    if (state === 'hecho') { try { job.version = await (version ?? (() => null))(); } catch { job.version = null; } }
    job.state = state; job.message = message; send();
    try { onDone?.(agentInstallState(agent)); } catch { /* the caller's own work */ }
  };
  let child;
  try { child = spawn(how.cmd, how.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv(), cwd: userHomeDir() || undefined }); } catch (error) { end('error', tr('msg.installer.agentFailed', { why: error.message })); return agentInstallState(agent); }
  job.child = child;
  const read = (c) => { job.out = (job.out + c).slice(-20_000); const l = lastLine(c); if (l) { job.line = l; send(); } };
  child.stdout.setEncoding('utf8'); child.stdout.on('data', read);
  child.stderr.setEncoding('utf8'); child.stderr.on('data', read);
  child.on('error', (error) => end('error', error.code === 'ENOENT' ? tr('msg.installer.agentNoTool') : tr('msg.installer.agentFailed', { why: error.message })));
  child.on('close', (code) => (code === 0 ? end('hecho', tr('msg.installer.agentDone')) : end('error', tr('msg.installer.agentFailed', { why: lastLine(job.out) || `${tr('msg.installer.exitCode')} ${code}` }))));
  job.timer = setTimeout(() => { killTree(child); end('error', tr('msg.installer.agentTimeout')); }, AGENT_MAX_MS);
  job.timer.unref?.();
  send();
  return agentInstallState(agent);
}
