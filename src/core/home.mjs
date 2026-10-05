// The assistant's own folder ("home"): created on first run where the user chooses, holds everything Orb owns.
// Nothing personal is hard-coded: names, models, limits and folders come from <home>/orb.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PRODUCT, folderName } from './product.mjs';
import { translate } from './i18n.mjs';

export const CONFIG_FILE = 'orb.json';
// 2.3: besides Claude Code, Codex and Cursor, the agents that speak ACP (src/agents/acp.mjs). They show up in Agentes and
// take work only when their program is installed on this PC.
export const AGENT_IDS = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot'];
export const AGENT_LABELS = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini', opencode: 'OpenCode', qwen: 'Qwen Code', copilot: 'GitHub Copilot' };

export const DEFAULT_CONFIG = Object.freeze({
  version: 3,
  assistantName: PRODUCT.assistant,
  userName: '',
  language: 'es',
  // The assistant's own model: Sonnet to save (default) or Opus; "orchestrate" = only coordinate (true) or free mode (false).
  // renewAt: share of the context window at which the assistant starts a fresh conversation (the board and logs remember).
  orchestrator: { agent: 'claude', account: 'claude', model: 'claude-sonnet-5-5', reasoning: 'medium', maxTurns: 60, renewAt: 0.6, orchestrate: true,
    models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }] },
  autoRun: true,
  maxParallel: 3,
  perAgent: 1,
  timeoutMinutes: 60,
  agentOrder: ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot'],
  agents: {
    // Claude Code accepts the aliases sonnet/opus/haiku, so the list keeps working when new versions come out.
    claude: { enabled: true, path: '', models: ['sonnet', 'opus', 'haiku'], defaultModel: 'sonnet', heavyModels: ['opus'],
      strengths: 'arquitectura, revisión de código, documentación, redacción, razonar sobre diseño' },
    // Empty model = the one configured in Codex itself. The user can add model ids in Ajustes.
    codex: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'implementación, backend, refactors, tests, scripts, depurar' },
    cursor: { enabled: true, path: '', models: ['auto'], defaultModel: 'auto', heavyModels: [],
      strengths: 'interfaz, frontend, cambios rápidos en varios archivos' },
    gemini: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'contexto enorme: leer proyectos grandes, investigar, documentar y revisar' },
    opencode: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'agente abierto con muchos proveedores y modelos' },
    qwen: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'implementación rápida y barata, tareas repetitivas' },
    copilot: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'cambios con contexto de GitHub: issues y pull requests' }
  },
  // Accounts (subscriptions) per agent. id = agent and home '' = the CLI's own folder; more can be added from the app.
  accounts: AGENT_IDS.map((a) => ({ id: a, agent: a, label: AGENT_LABELS[a], home: '', enabled: true })),
  // 2.3, balance between doing and spending: the agents now report their real usage (Claude and Codex say how much of the
  // 5-hour / weekly window is used and when it resets), so the fixed caps are a safety net, not the brake they were.
  // stopAt: share of the real window (0-1) at which new tasks wait for the reset instead of eating the last of it.
  budget: { windowHours: 5, stopAt: 0.92, agents: Object.fromEntries(AGENT_IDS.map((a) => [a, { maxTasks: 20, maxHeavy: 6 }])) },
  policy: { reasoning: ['low', 'medium', 'high'], highNeedsApproval: true, fast: false, banned: [] },
  sensitive: ['external_write', 'publish', 'financial', 'credential_access', 'destructive', 'razonamiento_alto'],
  // Task Review: another model (another provider when there is one) audits finished work read-only and gives a verdict.
  review: { auto: false },
  // 2.3: interrupted tasks continue when the app opens again; tasks stopped by a usage limit continue at the reset.
  continuity: { resumeAfterRestart: true, resumeAtReset: true },
  // 2.3: agents may hand subtasks to other agents (orb_delegate). trusted: subtasks without risk words go straight to the
  // queue (instead of waiting for approval), up to maxPerTask per task.
  delegation: { enabled: true, trusted: true, maxPerTask: 4 },
  mcpServers: [],
  projectRoots: [],
  ui: { companion: true, theme: 'sistema', pip: true }, // pip: the little window that shows the agent's browser
  // Expert mode (PC only): an IDE-like view with the panels chosen here around the assistant's chat.
  expert: { enabled: false, panels: { explorer: true, git: true, history: true, running: true, usage: true, system: true, activity: true } },
  browser: { enabled: true }, // the agents' browser (pages drawn by the app, driven through the MCP tools)
  // Phone access through Tailscale (off until the user turns it on).
  mobile: { enabled: false, port: 3131 }
});

// Layout of the assistant's folder (e.g. D:\Orb):
//   orb.json            settings
//   bitacoras\           general log and one per project
//   <proyecto>\          every other folder is a project (created by the app or by hand in the Explorer)
//   .orb\             the app's own data, hidden: database, secret, task runs, isolated copies, undo checkpoints
export const INTERNAL_DIR = '.orb';
export const LOGS_DIR = 'bitacoras';
// Folders of the assistant's folder that are never projects.
export const isReservedName = (name) => /^\./.test(name) || ['bitacoras', 'node_modules', '$recycle.bin', 'system volume information'].includes(String(name).toLowerCase());

export function paths(home) {
  const internal = path.join(home, INTERNAL_DIR);
  const data = path.join(internal, 'datos');
  const logs = path.join(home, LOGS_DIR);
  const copies = path.join(internal, 'copias');
  return {
    home, internal, config: path.join(home, CONFIG_FILE), data, db: path.join(data, 'orb.db'), key: path.join(data, 'clave.bin'),
    logs, generalLog: path.join(logs, 'GENERAL.md'), projectLogs: path.join(logs, 'proyectos'),
    projects: home, runs: path.join(internal, 'ejecuciones'),
    copies, worktrees: path.join(copies, 'aisladas'), checkpoints: path.join(copies, 'fotos')
  };
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
// Deep merge where arrays and scalars of `over` replace those of `base`.
export function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? structuredClone(base) : structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isObject(v) && isObject(out[k]) ? merge(out[k], v) : structuredClone(v);
  return out;
}

export { folderName };

export function isHome(dir) {
  try { return fs.statSync(path.join(dir, CONFIG_FILE)).isFile(); } catch { return false; }
}

// First run: <base>/<assistant name>/ with its folders, config, secret and the general log. An existing home is reused as is.
export function createHome(base, { assistantName = PRODUCT.assistant, userName = '', language = 'es' } = {}) {
  const T = (key, vars) => translate(language, key, vars);
  if (!base || !path.isAbsolute(base)) throw new Error(T('msg.home.absolute'));
  let stat; try { stat = fs.statSync(base); } catch { throw new Error(T('msg.home.noFolder', { base })); }
  if (!stat.isDirectory()) throw new Error(T('msg.home.notFolder', { base }));
  // A drive root is fine as a base: the home is always a subfolder of it.
  const name = folderName(assistantName);
  const home = isHome(base) ? base : path.join(base, name);
  if (isHome(home)) return { home, created: false };
  if (fs.existsSync(home) && fs.readdirSync(home).length) throw new Error(T('msg.home.notEmpty', { home }));
  const p = paths(home);
  for (const dir of [p.data, p.logs, p.projectLogs, p.projects, p.runs, p.worktrees, p.checkpoints]) fs.mkdirSync(dir, { recursive: true });
  const config = merge(DEFAULT_CONFIG, { assistantName: String(assistantName || PRODUCT.assistant).trim().slice(0, 40) || PRODUCT.assistant, userName: String(userName ?? '').trim().slice(0, 40), language: language === 'en' ? 'en' : 'es' });
  writeJson(p.config, config);
  fs.writeFileSync(p.key, crypto.randomBytes(32), { mode: 0o600 });
  hideOnWindows(p.internal);
  if (!fs.existsSync(p.generalLog)) fs.writeFileSync(p.generalLog, generalLogHeader(config));
  return { home, created: true };
}

// The app's internal folder is hidden in the Explorer (only on Windows; elsewhere the leading dot already hides it).
export function hideOnWindows(dir) {
  if (process.platform !== 'win32') return;
  try { spawnSync('attrib', ['+h', dir], { windowsHide: true, timeout: 5000 }); } catch { /* cosmetic */ }
}

export function generalLogHeader(config) {
  return `# Bitácora general de ${config.assistantName}

Memoria de ${config.assistantName}: qué se pidió, qué se hizo y qué queda pendiente en todos los proyectos.
Solo se añade al final; nunca se borra ni se edita lo escrito. Sin contraseñas, tokens ni datos personales.
`;
}

export function projectLogHeader(name) {
  return `# Bitácora — ${name}

Lo decidido y lo hecho en este proyecto. Solo se añade al final. Sin contraseñas, tokens ni datos personales.
`;
}

export function loadConfig(home) {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(paths(home).config, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error(`${CONFIG_FILE} no es válido: ${error.message}`); }
  const config = merge(DEFAULT_CONFIG, stored);
  // 2.3 balance: the old fixed caps (6 tasks, 2 heavy per window; 20 turns) were too tight. Values the user never changed
  // move to the new ones; anything the user set by hand stays.
  if ((stored.version ?? 2) < 3) {
    for (const b of Object.values(config.budget.agents ?? {})) { if (b.maxTasks === 6) b.maxTasks = 20; if (b.maxHeavy === 2) b.maxHeavy = 6; }
    if (config.orchestrator.maxTurns === 20) config.orchestrator.maxTurns = 60;
    config.version = 3;
  }
  // Folders made by older versions: agents added later get their default account and their place in the order.
  for (const a of AGENT_IDS) {
    if (!config.accounts.some((x) => x.agent === a)) config.accounts.push({ id: a, agent: a, label: AGENT_LABELS[a], home: '', enabled: true });
    if (!config.agentOrder.includes(a)) config.agentOrder.push(a);
  }
  return config;
}

// Atomic write: a crash in the middle never leaves a half-written file.
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function readKey(home) {
  const file = paths(home).key;
  try { const key = fs.readFileSync(file); if (key.length >= 32) return key; } catch { /* created below */ }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}
