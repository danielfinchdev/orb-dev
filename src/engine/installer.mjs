// Installs what the assistant needs on Windows with each vendor's official installer: Claude Code, Codex, Cursor, Git,
// GitHub CLI, Node.js (Codex comes from npm) and Tailscale (phone access). Runs in a visible PowerShell window so the user
// sees every step and answers Windows' own prompts; the script only holds fixed commands (no text from the user or the
// agents) and goes straight to PowerShell on its command line (no script file another program could swap before it runs).
// It writes its progress to a log the engine watches.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../core/context.mjs';
import { ADAPTERS, quickRun, openConsole } from '../agents/index.mjs';
import { IS_WIN } from '../agents/common.mjs';

const winget = (id) => `winget install --id ${id} -e --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity`;

// id → what it is, how to check it and the official way to install it.
export const ITEMS = [
  { id: 'git', label: 'Git', why: 'deshacer tareas con historial, ramas y GitHub', install: winget('Git.Git'), needsWinget: true },
  { id: 'node', label: 'Node.js', why: 'lo necesita Codex para instalarse', install: winget('OpenJS.NodeJS.LTS'), needsWinget: true },
  { id: 'claude', label: 'Claude Code', why: 'agente y cerebro del asistente', install: "irm https://claude.ai/install.ps1 | iex" },
  { id: 'codex', label: 'Codex', why: 'agente de OpenAI', install: 'npm install -g @openai/codex', after: ['node'] },
  { id: 'cursor', label: 'Cursor CLI', why: 'agente de Cursor', install: "irm 'https://cursor.com/install?win32=true' | iex" },
  { id: 'gh', label: 'GitHub CLI', why: 'publicar y crear pull requests con tu cuenta', install: winget('GitHub.cli'), needsWinget: true },
  { id: 'tailscale', label: 'Tailscale', why: 'usar el asistente desde el móvil de forma privada', install: winget('Tailscale.Tailscale'), needsWinget: true, optional: true },
  // 2.3: more agents (ACP). Optional: each one with its own account (Google, GitHub…), signed in with its own program.
  { id: 'gemini', label: 'Gemini CLI', why: 'agente de Google: contexto enorme, investigar y revisar', install: 'npm install -g @google/gemini-cli', after: ['node'], optional: true },
  { id: 'copilot', label: 'GitHub Copilot CLI', why: 'agente de GitHub, con tu suscripción de Copilot', install: 'npm install -g @github/copilot', after: ['node'], optional: true },
  { id: 'opencode', label: 'OpenCode', why: 'agente abierto con muchos proveedores y modelos', install: 'npm install -g opencode-ai', after: ['node'], optional: true },
  { id: 'qwen', label: 'Qwen Code', why: 'agente rápido y barato para tareas repetitivas', install: 'npm install -g @qwen-code/qwen-code', after: ['node'], optional: true }
];
const AGENT_ITEMS = ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'opencode', 'qwen'];

async function versionOf(cmd, args = ['--version']) { const r = await quickRun(cmd, args, { timeoutMs: 8000 }); return r.ok ? r.out.split(/\r?\n/)[0].slice(0, 60) : null; }
const tailscaleExe = () => (IS_WIN ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe') : 'tailscale');

export async function check() {
  const out = {};
  for (const agent of AGENT_ITEMS) out[agent] = Boolean(ADAPTERS[agent]?.detect(ctx.config.agents[agent] ?? {}));
  out.git = Boolean(await versionOf('git'));
  out.node = Boolean(await versionOf(IS_WIN ? 'node.exe' : 'node'));
  out.gh = Boolean(await versionOf(IS_WIN ? 'gh.exe' : 'gh'));
  out.tailscale = Boolean(await versionOf(tailscaleExe(), ['version']));
  return ITEMS.map((i) => ({ id: i.id, label: i.label, why: tr(`msg.installer.why.${i.id}`), optional: Boolean(i.optional), installed: out[i.id] }));
}

// The PowerShell script for the chosen items, in a safe order (Node before Codex). Only fixed text from ITEMS goes in.
export function plan(ids) {
  const chosen = ITEMS.filter((i) => ids.includes(i.id));
  if (chosen.some((i) => i.after?.includes('node')) && !chosen.some((i) => i.id === 'node')) chosen.unshift(ITEMS.find((i) => i.id === 'node'));
  return chosen;
}

export function buildScript(ids, logFile) {
  const chosen = plan(ids);
  // PowerShell takes the typographic quotes ‘ ’ ‚ ‛ as quotes too: all are doubled (a folder may be called «Ana’s»).
  const q = (s) => `'${String(s).replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c)}'`;
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    `$Host.UI.RawUI.WindowTitle = ${q(tr('msg.installer.windowTitle'))}`,
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$log = ${q(logFile)}`,
    "function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }",
    'function Step($id, $title, [scriptblock]$do) {',
    "  Add-Content -LiteralPath $log -Value \"INICIO $id\"; Write-Host ''; Write-Host \"== $title\" -ForegroundColor Cyan",
    `  try { $global:LASTEXITCODE = 0; & $do; if ($LASTEXITCODE -ne 0) { throw "${tr('msg.installer.exitCode')} $LASTEXITCODE" }; Add-Content -LiteralPath $log -Value "OK $id"; Write-Host "   ${tr('msg.installer.done')}" -ForegroundColor Green }`,
    `  catch { Add-Content -LiteralPath $log -Value "ERROR $id $_"; Write-Host "   ${tr('msg.installer.failed')} $_" -ForegroundColor Red }`,
    '  Refresh-Path',
    '}',
    "$hasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)",
    `Write-Host ${q(tr('msg.installer.intro'))} -ForegroundColor Yellow`
  ];
  for (const item of chosen) {
    const body = item.needsWinget
      ? `if (-not $hasWinget) { throw ${q(tr('msg.installer.noWinget'))} }; ${item.install}`
      : item.install;
    lines.push(`Step ${q(item.id)} ${q(item.label)} { ${body} }`);
  }
  lines.push("Add-Content -LiteralPath $log -Value 'FIN'", "Write-Host ''", `Write-Host ${q(tr('msg.installer.finished'))} -ForegroundColor Yellow`, `Read-Host ${q(tr('msg.installer.pressEnter'))}`);
  return lines.join('\r\n');
}

let current = null; // { logFile, ids, startedAt, closed }
let timer = null;
const MAX_MS = 45 * 60_000;

export function start(ids, emit) {
  if (!IS_WIN) throw new Error(tr('msg.installer.windowsOnly'));
  if (current && !progress().finished && Date.now() - current.startedAt < MAX_MS) throw new Error(tr('msg.installer.alreadyRunning'));
  const valid = plan(ids.filter((id) => ITEMS.some((i) => i.id === id))).map((i) => i.id);
  if (!valid.length) throw new Error(tr('msg.installer.chooseOne'));
  const dir = path.join(ctx.paths.runs, 'instalacion');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const logFile = path.join(dir, `progreso-${stamp}.log`);
  fs.writeFileSync(logFile, '');
  const encoded = Buffer.from(buildScript(valid, logFile), 'utf16le').toString('base64');
  const run = { logFile, ids: valid, startedAt: stamp, closed: false };
  current = run;
  const child = openConsole('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
  child.on('exit', () => { run.closed = true; }); // its window was closed (finished or not)
  // Progress for the window: the script appends INICIO / OK / ERROR lines and FIN.
  clearInterval(timer);
  timer = setInterval(() => {
    const s = progress();
    emit('installer:progress', s);
    if (s.finished || Date.now() - stamp > MAX_MS) { clearInterval(timer); timer = null; }
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
