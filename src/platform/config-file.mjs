// orb.json: its default values, how a stored file is read (defaults filled in, older versions' settings updated) and the
// deep merge used for settings. No process state: src/platform/context.mjs holds the loaded configuration.
import fs from 'node:fs';
import { PRODUCT } from '../shared/product.mjs';
import { APPEARANCE_DEFAULTS, migrateAppearance } from '../shared/appearance.mjs';
import { DEFAULT_PROTECTED } from '../shared/layout.mjs';
import { CONFIG_FILE, paths } from './paths.mjs';

// besides Claude Code, Codex and Cursor, the agents that speak ACP (src/agents/acp.mjs). They show up in Agentes and
// take work only when their program is installed on this PC.
export const AGENT_IDS = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot', 'hermes', 'grok', 'devin', 'droid', 'omp', 'pi', 'antigravity'];
// Agents that start turned off (Ajustes › Agentes): the user turns them on by hand.
export const OFF_BY_DEFAULT = ['hermes', 'grok', 'devin', 'droid', 'omp', 'pi', 'antigravity'];
export const AGENT_LABELS = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini', opencode: 'OpenCode', qwen: 'Qwen Code', copilot: 'GitHub Copilot', hermes: 'Hermes Agent', grok: 'Grok Build', devin: 'Devin', droid: 'Factory Droid', omp: 'Oh My Pi', pi: 'Pi', antigravity: 'Antigravity' };

export const DEFAULT_CONFIG = Object.freeze({
  version: 5,
  assistantName: PRODUCT.assistant,
  userName: '',
  language: 'es',
  // The assistant's own model: Sonnet to save (default) or Opus; "orchestrate" = only coordinate (true) or free mode (false).
  // renewAt: share of the context window at which the assistant starts a fresh conversation (the board and logs remember).
  orchestrator: { agent: 'claude', account: 'claude', model: 'claude-sonnet-5-5', reasoning: 'medium', maxTurns: 60, renewAt: 0.6, orchestrate: true,
    models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }] },
  autoRun: true,
  // the grey proposal of the next message in a chat's box when a turn ends (src/engine/suggest.mjs). Off: it spends plan.
  suggestNext: false,
  maxParallel: 3,
  perAgent: 1,
  timeoutMinutes: 60,
  // tasks work at the same time by default (each in its own copy when another one is writing in the folder, joined
  // back by Orb when it ends); oneAtATime makes them wait for each other. approvalWaitMinutes: a task's permission that
  // nobody answers in this time is denied and the agent goes on another way (0 = wait for ever).
  oneAtATime: false,
  approvalWaitMinutes: 10,
  // how «Hacer commit…» writes its message (Ajustes › Agentes): 'conventional' (default), 'repo' (follow the repository's own
  // history) or 'custom' (commitInstructions).
  git: { commitStyle: 'conventional', commitInstructions: '' },
  // the agents' permission level for chats and tasks (Ajustes › Agentes; each chat may change its own): 'auto' works
  // without questions inside the project folder (undo instead of asking), 'preguntar' asks before risky commands and
  // before writing outside it (src/domain/security/guard.mjs).
  permissions: { mode: 'auto' },
  // The rails (src/domain/rules/rails.mjs): empty = all on; only the ones paused by the user are stored, as
  // { <id>: { enabled: false } }. The core rails have no switch.
  rails: {},
  agentOrder: ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot', 'hermes', 'grok', 'devin', 'droid', 'omp', 'pi', 'antigravity'],
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
      strengths: 'cambios con contexto de GitHub: issues y pull requests' },
    // Off by default: Hermes only asks permission for what it considers dangerous, so the user turns it on by hand.
    hermes: { enabled: false, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'agente autónomo con memoria y muchos proveedores de modelos' },
    // Also off by default, and not verified against the real programs (none was installed when they were added).
    // Their API keys, when they take one, are in the vault (src/domain/security/agent-keys.mjs), never here.
    grok: { enabled: false, path: '', models: [], defaultModel: '', heavyModels: [], strengths: 'agente de xAI para programar desde la terminal' },
    devin: { enabled: false, path: '', models: [], defaultModel: '', heavyModels: [], strengths: 'agente de Cognition (Devin para terminal) con planes y revisión' },
    droid: { enabled: false, path: '', models: [], defaultModel: '', heavyModels: [], strengths: 'agente de Factory para tareas de ingeniería de principio a fin' },
    omp: { enabled: false, path: '', models: [], defaultModel: '', heavyModels: [], strengths: 'variante de Pi con herramientas extra y muchos proveedores' },
    // Pi and Antigravity cannot ask Orb before acting: they only run with «total» (src/agents/unguarded.mjs).
    pi: { enabled: false, path: '', models: [], defaultModel: '', heavyModels: [], strengths: 'agente minimalista y extensible, con muchos proveedores de modelos' },
    antigravity: { enabled: false, path: '', models: [], defaultModel: '', heavyModels: [], strengths: 'agente de Google con ventanas de contexto muy grandes' }
  },
  // Accounts (subscriptions) per agent. id = agent and home '' = the CLI's own folder; more can be added from the app.
  accounts: AGENT_IDS.map((a) => ({ id: a, agent: a, label: AGENT_LABELS[a], home: '', enabled: true })),
  // Balance between doing and spending: the agents report their real usage (Claude and Codex say how much of the
  // 5-hour / weekly window is used and when it resets), so the fixed caps are a safety net, not the brake they were.
  // stopAt: share of the real window (0-1) at which new tasks wait for the reset instead of eating the last of it.
  // profile: the «ahorro ↔ uso» slider of Ajustes (0 = maximum saving … 4 = maximum use; null = set by hand).
  // weeklyStopAt: the same for the weekly window. maxFixRounds: correction rounds of one request.
  budget: { profile: 2, windowHours: 5, stopAt: 0.92, weeklyStopAt: 0.85, maxFixRounds: 2, agents: Object.fromEntries(AGENT_IDS.map((a) => [a, { maxTasks: 20, maxHeavy: 6 }])) },
  policy: { reasoning: ['low', 'medium', 'high'], highNeedsApproval: true, fast: false, banned: [] },
  sensitive: ['external_write', 'publish', 'financial', 'credential_access', 'destructive', 'razonamiento_alto'],
  // Task Review: another model (another provider when there is one) audits finished work read-only and gives a verdict.
  review: { auto: false },
  // interrupted tasks continue when the app opens again; tasks stopped by a usage limit continue at the reset.
  // switchAccount: at its limit an agent passes its work to its next account (off: the task waits for the first one).
  continuity: { resumeAfterRestart: true, resumeAtReset: true, switchAccount: true },
  // agents may hand subtasks to other agents (orb_delegate). trusted: subtasks without risk words go straight to the
  // queue (instead of waiting for approval), up to maxPerTask per task.
  delegation: { enabled: true, trusted: true, maxPerTask: 4 },
  mcpServers: [],
  // the skills of core\skills that are on ([{ name, enabled, source }]; one without an entry is off).
  skills: [],
  projectRoots: [],
  // pip: the little window that shows the agent's browser; sounds and motion: the robot's. lockMinutes: Orb's lock
  // screen after that long without use (src/ui/lib/idle-lock.js).
  // skin, font, codeFont, codeTheme: Ajustes → Apariencia (src/shared/appearance.mjs). usageLine: the cost and tokens
  // under each reply of an agent's conversation (Ajustes → Apariencia).
  ui: { companion: true, theme: 'sistema', pip: true, sounds: true, volume: 0.5, motion: 'completa', lockMinutes: 15, usageLine: true, ...APPEARANCE_DEFAULTS },
  // Expert mode (PC only): an IDE-like view with the panels chosen here around the assistant's chat.
  expert: { enabled: false, panels: { explorer: true, git: true, history: true, running: true, usage: true, system: true, activity: true } },
  browser: { enabled: true }, // the agents' browser (pages drawn by the app, driven through the MCP tools)
  // Phone access (off until the user turns it on): through the home Wi-Fi and/or Tailscale (https when the tailnet has it).
  mobile: { enabled: false, port: 3131, wifi: true, tailscale: true, screenshot: true },
  // «Cosas que nadie toca» (Ajustes › Avanzado): names, paths or containers that no agent touches, whatever the
  // permission (a command or a path that names one is denied).
  protected: [...DEFAULT_PROTECTED]
});

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
// Deep merge where arrays and scalars of `over` replace those of `base`.
export function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? structuredClone(base) : structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isObject(v) && isObject(out[k]) ? merge(out[k], v) : structuredClone(v);
  return out;
}

export function loadConfig(home) {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(paths(home).config, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error(`${CONFIG_FILE} no es válido: ${error.message}`); }
  return configFrom(stored);
}
// The configuration a stored orb.json gives: the defaults filled in and the settings of older versions updated.
export function configFrom(stored) {
  // Themes and palettes of older versions are mapped before merging, so the defaults never mask a retired value.
  if (stored?.ui !== undefined) stored = { ...stored, ui: migrateAppearance(stored.ui) };
  const config = merge(DEFAULT_CONFIG, stored);
  // The old fixed caps (6 tasks, 2 heavy per window; 20 turns) were too tight. Values the user never changed
  // move to the new ones; anything the user set by hand stays.
  if ((stored.version ?? 2) < 3) {
    for (const b of Object.values(config.budget.agents ?? {})) { if (b.maxTasks === 6) b.maxTasks = 20; if (b.maxHeavy === 2) b.maxHeavy = 6; }
    if (config.orchestrator.maxTurns === 20) config.orchestrator.maxTurns = 60;
    config.version = 3;
  }
  // the robot is called Orb·e. Who kept the old default name ("Orb") gets the new one; a name chosen by hand stays.
  if ((stored.version ?? 2) < 4) {
    if (config.assistantName.trim() === 'Orb') config.assistantName = PRODUCT.assistant;
    config.version = 4;
  }
  // the default name is written Orbe (Orb·E only as the drawn wordmark). Who kept the 2.4 default gets it.
  if ((stored.version ?? 2) < 5) {
    if (config.assistantName.trim() === 'Orb·e') config.assistantName = PRODUCT.assistant;
    config.version = 5;
  }
  // Orbs no longer link with each other: this Orb's role (todo / centro / taller) and «Orb para programar» go.
  delete config.role; delete config.devTarget;
  // «Monitoreo del equipo» and Opti Bot are gone, and so are the bots, Open Control Edge and the «Orb | Bots» mode too.
  // Their settings go (the file loses them at the next save).
  delete config.monitor; delete config.bots; delete config.oce;
  if (config.ui) { delete config.ui.mode; delete config.ui.menuBar; } // menuBar: Windows' menu bar is always hidden now
  // the phone never types the master password on a page without encryption: «mobile.lanHttp» is gone.
  if (config.mobile) delete config.mobile.lanHttp;
  // Folders made by older versions: agents added later get their default account and their place in the order.
  for (const a of AGENT_IDS) {
    if (!config.accounts.some((x) => x.agent === a)) config.accounts.push({ id: a, agent: a, label: AGENT_LABELS[a], home: '', enabled: true });
    if (!config.agentOrder.includes(a)) config.agentOrder.push(a);
  }
  return config;
}
