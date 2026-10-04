// The assistant's own folder ("home"): created on first run where the user chooses, holds everything Orb owns.
// Nothing personal is hard-coded: names, models, limits and folders come from <home>/orb.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PRODUCT, folderName } from './product.mjs';

export const CONFIG_FILE = 'orb.json';
export const AGENT_IDS = ['claude', 'codex', 'cursor'];

export const DEFAULT_CONFIG = Object.freeze({
  version: 2,
  assistantName: PRODUCT.assistant,
  userName: '',
  language: 'es',
  // The assistant's own model: Sonnet to save (default) or Opus; "orchestrate" = only coordinate (true) or free mode (false).
  orchestrator: { agent: 'claude', account: 'claude', model: 'claude-sonnet-5-5', reasoning: 'medium', maxTurns: 20, orchestrate: true,
    models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }] },
  autoRun: true,
  maxParallel: 3,
  perAgent: 1,
  timeoutMinutes: 60,
  agentOrder: ['claude', 'codex', 'cursor'],
  agents: {
    // Claude Code accepts the aliases sonnet/opus/haiku, so the list keeps working when new versions come out.
    claude: { enabled: true, path: '', models: ['sonnet', 'opus', 'haiku'], defaultModel: 'sonnet', heavyModels: ['opus'],
      strengths: 'arquitectura, revisión de código, documentación, redacción, razonar sobre diseño' },
    // Empty model = the one configured in Codex itself. The user can add model ids in Ajustes.
    codex: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'implementación, backend, refactors, tests, scripts, depurar' },
    cursor: { enabled: true, path: '', models: ['auto'], defaultModel: 'auto', heavyModels: [],
      strengths: 'interfaz, frontend, cambios rápidos en varios archivos' }
  },
  // Accounts (subscriptions) per agent. id = agent and home '' = the CLI's own folder; more can be added from the app.
  accounts: [
    { id: 'claude', agent: 'claude', label: 'Claude', home: '', enabled: true },
    { id: 'codex', agent: 'codex', label: 'Codex', home: '', enabled: true },
    { id: 'cursor', agent: 'cursor', label: 'Cursor', home: '', enabled: true }
  ],
  budget: { windowHours: 5, agents: { claude: { maxTasks: 6, maxHeavy: 2 }, codex: { maxTasks: 6, maxHeavy: 2 }, cursor: { maxTasks: 6, maxHeavy: 2 } } },
  policy: { reasoning: ['low', 'medium', 'high'], highNeedsApproval: true, fast: false, banned: [] },
  sensitive: ['external_write', 'publish', 'financial', 'credential_access', 'destructive', 'razonamiento_alto'],
  review: { auto: false },
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
  if (!base || !path.isAbsolute(base)) throw new Error('la carpeta debe ser una ruta absoluta');
  let stat; try { stat = fs.statSync(base); } catch { throw new Error(`la carpeta no existe: ${base}`); }
  if (!stat.isDirectory()) throw new Error(`no es una carpeta: ${base}`);
  // A drive root is fine as a base: the home is always a subfolder of it.
  const name = folderName(assistantName);
  const home = isHome(base) ? base : path.join(base, name);
  if (isHome(home)) return { home, created: false };
  if (fs.existsSync(home) && fs.readdirSync(home).length) throw new Error(`la carpeta ${home} ya existe y no está vacía: elige otra ubicación u otro nombre`);
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
  return merge(DEFAULT_CONFIG, stored);
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
