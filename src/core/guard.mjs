// The guard of the live sessions (2.3): for every action an agent wants to take, allow it, ask the user or deny it.
// Before 2.3 the risky commands were simply forbidden (a deny list on the command line), which stopped useful work too.
// Now the balance is: normal work flows without questions, risky actions wait for a click (Permitir / Denegar) and only
// what can never be right (touching the assistant's own data) is denied.
//
// Permission modes of a conversation or task:
//   leer       look only: reading and searching; anything that changes something is denied
//   editar     (default) edit files and run commands in its folder; risky commands ask first
//   preguntar  edit files; every command asks first (for when you want to watch closely)
//   total      no checks at all (asked once when chosen; never from the phone)
import path from 'node:path';

export const PERMISSIONS = ['leer', 'editar', 'preguntar', 'total'];
export const PERMISSION_LABEL = { leer: 'Solo leer', editar: 'Editar archivos', preguntar: 'Preguntar antes de comandos', total: 'Acceso total' };

// What a tool does, whatever the agent calls it (Claude tool names, Codex items, ACP kinds).
const READ = /^(read|glob|grep|ls|search|find|view|notebookread|webfetch|websearch|fetch|think|todowrite|todoread|task|agent|exitplanmode|skill|toolsearch|listmcpresources|readmcpresource|bashoutput|monitor)$/i;
const EDIT = /^(edit|write|multiedit|notebookedit|filechange|applypatch|edit_file|write_file|replace|move|delete|create)$/i;
const EXEC = /^(bash|shell|execute|commandexecution|command|run_shell_command|powershell|killshell|killbash|terminal)$/i;

export function toolClass(tool, kind) {
  const k = String(kind ?? '').toLowerCase();
  if (k === 'read' || k === 'search' || k === 'think' || k === 'fetch') return 'read';
  if (k === 'edit' || k === 'delete' || k === 'move') return 'edit';
  if (k === 'execute') return 'exec';
  const name = String(tool ?? '').replace(/^mcp__[^_]+__/, '');
  if (/^mcp__orb__|^orb[:_]/.test(String(tool))) return 'orb';
  if (/^mcp__/.test(String(tool))) return 'mcp';
  if (READ.test(name)) return 'read';
  if (EDIT.test(name)) return 'edit';
  if (EXEC.test(name)) return 'exec';
  return 'other';
}

// Commands that may be fine but need a human look: publishing, downloading and running things from the internet, wiping
// files, touching the system. Matched on the whole command line (PowerShell and bash spellings).
const RISKY = [
  [/\bgit\s+(push|remote\s+(add|set-url|remove))\b/i, 'publica en un remoto (git push)'],
  [/\bgh\s+(repo|pr|release|api|gist|secret)\b/i, 'usa tu cuenta de GitHub'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i, 'publica un paquete'],
  [/\b(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*\|\s*(iex|invoke-expression|sh|bash|pwsh|powershell)\b/i, 'descarga y ejecuta algo de internet'],
  [/\b(curl|wget)\b[^|;&]*\s(-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s|-F\s|--upload-file|-T\s)/i, 'envía datos a internet'],
  [/\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*-method\s+(post|put|delete|patch)/i, 'envía datos a internet'],
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b|\bremove-item\b[^|;&]*-recurse\b|\brd\s+\/s\b|\brmdir\s+\/s\b|\bdel\s+\/[sq]/i, 'borra carpetas enteras'],
  [/\b(schtasks|reg\s+(add|delete)|set-executionpolicy|shutdown|restart-computer|stop-computer|format\s+[a-z]:|diskpart|bcdedit|netsh|sc\s+(create|delete|config))\b/i, 'cambia el sistema'],
  [/\b(taskkill|stop-process|kill\s+-9|pkill|killall)\b/i, 'cierra procesos'],
  [/\b(ssh|scp|sftp|rsync)\s/i, 'se conecta a otro equipo'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|branch\s+-D|rebase|filter-branch)\b/i, 'reescribe o descarta cambios de git'],
  [/\b(docker|podman)\s+(rm|rmi|system\s+prune|volume\s+rm)\b/i, 'borra contenedores o datos de Docker']
];

export function riskOf(command) {
  const c = String(command ?? '');
  for (const [re, why] of RISKY) if (re.test(c)) return why;
  return null;
}

// Paths that are never an agent's business: the assistant's own data (database, secret, logs of runs).
function touchesInternal(text, internalDir) {
  if (!internalDir) return false;
  const t = String(text ?? '').replace(/\//g, '\\').toLowerCase();
  const d = path.resolve(internalDir).replace(/\//g, '\\').toLowerCase();
  return t.includes(d) || /(^|[\s"'\\/])\.orb[\\/](datos|copias)/i.test(String(text ?? ''));
}

// decide({ permission, tool, kind, command, paths, internalDir }) → { decision: 'allow' | 'ask' | 'deny', reason }
export function decide({ permission = 'editar', tool, kind, command = '', paths = [], internalDir }) {
  const cls = toolClass(tool, kind);
  const text = [command, ...paths].join(' ');
  if (touchesInternal(text, internalDir)) return { decision: 'deny', reason: 'son los datos internos del asistente' };
  if (permission === 'total') return { decision: 'allow', reason: 'acceso total' };
  if (cls === 'read' || cls === 'orb') return { decision: 'allow', reason: 'solo lee' };
  if (permission === 'leer') return { decision: 'deny', reason: 'esta conversación es de solo lectura' };
  if (cls === 'edit') return { decision: 'allow', reason: 'edita archivos' };
  if (cls === 'exec') {
    const risk = riskOf(command);
    if (risk) return { decision: 'ask', reason: risk };
    if (permission === 'preguntar') return { decision: 'ask', reason: 'ejecuta un comando' };
    return { decision: 'allow', reason: 'comando normal' };
  }
  if (cls === 'mcp') return { decision: 'allow', reason: 'conector añadido por ti' };
  return { decision: permission === 'preguntar' ? 'ask' : 'allow', reason: 'otra herramienta' };
}

// One line for the approval card: what the agent wants to do, in plain words.
export function describeAction({ tool, command, paths = [], title }) {
  if (command) return String(command).slice(0, 400);
  if (paths.length) return `${tool ?? 'herramienta'}: ${paths.slice(0, 3).join(', ')}`;
  return String(title ?? tool ?? 'acción').slice(0, 400);
}
