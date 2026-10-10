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
import { translate } from './i18n.mjs';

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
// GIT: "git" plus its global options (-C dir, -c key=value, --no-pager…) before the subcommand.
const GIT = String.raw`\bgit(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+`;
const RISKY = [
  [new RegExp(`${GIT}(push|remote\\s+(add|set-url|remove))\\b`, 'i'), 'msg.guard.push'],
  [/\bgh\s+(repo|pr|release|api|gist|secret)\b/i, 'msg.guard.github'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i, 'msg.guard.publish'],
  [/\b(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*\|\s*(iex|invoke-expression|sh|bash|pwsh|powershell)\b/i, 'msg.guard.pipeToShell'],
  [/\b(iex|invoke-expression)\b[^|;&]*\b(irm|iwr|invoke-webrequest|invoke-restmethod)\b|[$<]\(\s*(curl|wget)\b/i, 'msg.guard.pipeToShell'],
  [/\b(powershell|pwsh)(\.exe)?\b[^|;&]*\s[-/]e(c|n\w*)?\b/i, 'msg.guard.pipeToShell'], // -EncodedCommand and its short forms hide the command
  [/\b(curl|wget)\b[^|;&]*\s(-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s|-F\s|--upload-file|-T\s)/i, 'msg.guard.sendData'],
  [/\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*-method\s+(post|put|delete|patch)/i, 'msg.guard.sendData'],
  [/\brm\s+(?:-{1,2}\S+\s+)*(-[a-z]*r|--recursive)|\b(remove-item|ri|rd|rmdir|del|erase)\b[^|;&]*\s-r(e(c(u(r(se?)?)?)?)?)?\b|\brd\s+\/s\b|\brmdir\s+\/s\b|\bdel\s+\/[sq]/i, 'msg.guard.deleteFolders'],
  [/\b(schtasks|reg\s+(add|delete)|set-executionpolicy|shutdown|restart-computer|stop-computer|format\s+[a-z]:|diskpart|bcdedit|netsh|sc\s+(create|delete|config)|setx|sudo|runas|net\s+(user|localgroup)|new-service|set-service)\b/i, 'msg.guard.system'],
  [/\b(taskkill|stop-process|kill\s+(-9|-kill|-s\s+kill|-sigkill)|pkill|killall)\b/i, 'msg.guard.killProcesses'],
  [/\b(ssh|scp|sftp|rsync)\s/i, 'msg.guard.ssh'],
  [new RegExp(`${GIT}(reset\\s+--(hard|merge)\\b|clean\\s+(?:-\\S+\\s+)*(-[a-z]*f|--force)|checkout\\s+(--\\s|\\.(?=\\s|$))|restore\\b(?![^|;&]*--staged)|stash\\s+(drop|clear)\\b|branch\\s+-D\\b|rebase\\b|filter-branch\\b)`, 'i'), 'msg.guard.gitRewrite'],
  [/\b(docker|podman)\s+(rm|rmi|system\s+prune|volume\s+rm)\b/i, 'msg.guard.docker']
];

export function riskOf(command, lang = 'es') {
  const c = String(command ?? '');
  for (const [re, why] of RISKY) if (re.test(c)) return translate(lang, why);
  return null;
}

// Paths that are never an agent's business: the assistant's own data (database, secret, logs of runs, undo checkpoints).
// The isolated copies (.orb\copias\aisladas) are where isolated tasks work, so those stay open.
const OPEN_INTERNAL = '\\copias\\aisladas\\';
function touchesInternal(text, internalDir) {
  if (!internalDir) return false;
  const t = String(text ?? '').replace(/\//g, '\\').toLowerCase();
  const d = path.resolve(internalDir).replace(/\//g, '\\').toLowerCase();
  for (let i = t.indexOf(d); i >= 0; i = t.indexOf(d, i + 1)) if (!t.startsWith(OPEN_INTERNAL, i + d.length)) return true;
  return /(^|[\s"'\\])\.orb\\+(datos|ejecuciones|copias(?!\\+aisladas\\))/.test(t);
}

// decide({ permission, tool, kind, command, paths, internalDir, lang }) → (lang: language of the reasons, default 'es')
//  { decision: 'allow' | 'ask' | 'deny', reason }
export function decide({ permission = 'editar', tool, kind, command = '', paths = [], internalDir, lang = 'es' }) {
  const T = (k) => translate(lang, `msg.guard.${k}`);
  const cls = toolClass(tool, kind);
  const text = [command, ...paths].join(' ');
  if (touchesInternal(text, internalDir)) return { decision: 'deny', reason: T('internal') };
  if (permission === 'total') return { decision: 'allow', reason: T('full') };
  if (cls === 'read' || cls === 'orb') return { decision: 'allow', reason: T('readOnlyTool') };
  if (permission === 'leer') return { decision: 'deny', reason: T('readOnlyChat') };
  if (cls === 'edit') return { decision: 'allow', reason: T('edits') };
  if (cls === 'exec') {
    const risk = riskOf(command, lang);
    if (risk) return { decision: 'ask', reason: risk };
    if (permission === 'preguntar') return { decision: 'ask', reason: T('runs') };
    return { decision: 'allow', reason: T('normalCommand') };
  }
  if (cls === 'mcp') return { decision: 'allow', reason: T('connector') };
  return { decision: permission === 'preguntar' ? 'ask' : 'allow', reason: T('otherTool') };
}

// One line for the approval card: what the agent wants to do, in plain words.
export function describeAction({ tool, command, paths = [], title, lang = 'es' }) {
  if (command) return String(command).slice(0, 400);
  if (paths.length) return `${tool ?? translate(lang, 'msg.guard.tool')}: ${paths.slice(0, 3).join(', ')}`;
  return String(title ?? tool ?? translate(lang, 'msg.guard.action')).slice(0, 400);
}
