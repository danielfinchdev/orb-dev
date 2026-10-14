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

//   probar     (3.1, read-only tasks: reviews, verification) read and run commands (tests, the build, a dev server to
//              open in the browser), but change no file; risky commands ask first
export const PERMISSIONS = ['leer', 'probar', 'editar', 'preguntar', 'total'];
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
  // -EncodedCommand and its short forms hide the command: PowerShell's own option followed by its base64 text. 3.1: not any
  // " -e" later in the line (powershell -Command "node -e '…'" was taken for it in a real run).
  // (-Command / -File end PowerShell's own options: what follows is the script, whatever it says.)
  // Options may start with - / or a dash (– —), and their values may be quoted with spaces.
  [/\b(powershell|pwsh)(\.exe)?["']?(\s+[-/–—](?!e\b|ec\b|en\w*\b|c\b|command\b|f\b|file\b)\w+(\s+(?![-/–—])("[^"]*"|'[^']*'|\S+))?)*\s+[-/–—]e(c|n\w*)?\s+["']?[A-Za-z0-9+/]{4,}={0,2}/i, 'msg.guard.pipeToShell'],
  // …and hidden in the arguments of a new PowerShell process (Start-Process powershell -ArgumentList "-enc …").
  [/\b(powershell|pwsh)(\.exe)?\b[^|;&]*-argumentlist\s+["'][^"']*[-/–—]e(c|n\w*)?\s+[A-Za-z0-9+/]{4,}/i, 'msg.guard.pipeToShell'],
  [/\b(curl|wget)\b[^|;&]*\s(-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s|-F\s|--upload-file|-T\s)/i, 'msg.guard.sendData'],
  [/\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*-method\s+(post|put|delete|patch)/i, 'msg.guard.sendData'],
  [/\brm\s+(?:-{1,2}\S+\s+)*(-[a-z]*r|--recursive)|\b(remove-item|ri|rd|rmdir|del|erase)\b[^|;&]*\s-r(e(c(u(r(se?)?)?)?)?)?\b|\brd\s+\/s\b|\brmdir\s+\/s\b|\bdel\s+\/[sq]/i, 'msg.guard.deleteFolders'],
  [/\b(schtasks|reg\s+(add|delete)|set-executionpolicy|shutdown|restart-computer|stop-computer|format\s+[a-z]:|diskpart|bcdedit|netsh|sc\s+(create|delete|config)|setx|sudo|runas|net\s+(user|localgroup)|new-service|set-service)\b/i, 'msg.guard.system'],
  [/\b(taskkill|stop-process|kill\s+(-9|-kill|-s\s+kill|-sigkill)|pkill|killall)\b/i, 'msg.guard.killProcesses'],
  [/\b(ssh|scp|sftp|rsync)\s/i, 'msg.guard.ssh'],
  [new RegExp(`${GIT}(reset\\s+--(hard|merge)\\b|clean\\s+(?:-\\S+\\s+)*(-[a-z]*f|--force)|checkout\\s+(--\\s|\\.(?=\\s|$))|restore\\b(?![^|;&]*--staged)|stash\\s+(drop|clear)\\b|branch\\s+-D\\b|rebase\\b|filter-branch\\b)`, 'i'), 'msg.guard.gitRewrite'],
  [/\b(docker|podman)\s+(rm|rmi|system\s+prune|volume\s+rm)\b/i, 'msg.guard.docker']
];

// 3.1: data sent only to this PC (an agent testing its own local API: curl -X POST localhost:3000…) never leaves it.
// An allow-list, not a block-list: the WHOLE command must be requests to this PC and nothing else. Every line or step is
// either echo / cd / a pause / a variable set to a local address, or curl / wget / Invoke-WebRequest / Invoke-RestMethod
// whose every address is local (localhost, 127.0.0.1, [::1], with or without http://, or a variable holding one), with no
// proxy or address-rewriting option. A pipe, a sub-command or anything else: not local, it asks as before.
const IS_LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?$/i;
const NET_TOOL = /^(curl|curl\.exe|wget|wget\.exe|iwr|irm|invoke-webrequest|invoke-restmethod)$/i;
// curl's one-letter options are case-sensitive (-x is a proxy, -X the method; -o takes a file, -O does not).
const REROUTE = (a) => /^-x$/.test(a) || /^(--(resolve|connect-to|proxy\S*|preproxy|socks\S*|doh-url|haproxy\S*)|-proxy\S*)(=|$)/i.test(a);
const URL_OPT = /^(-uri|--url)$/i;
const VALUE_OPT = (a) => /^-[HdFXwoTuAbemrzD]$/.test(a)
  || /^(--(header|data\S*|form\S*|request|write-out|output|upload-file|user|user-agent|referer|cookie\S*|max-time|connect-timeout|retry\S*)|-(method|body|contenttype|headers|outfile|infile|timeoutsec|erroraction|maximumredirection))$/i.test(a);
const words = (s) => (s.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^(["'])([\s\S]*)\1$/, '$2'));
const onlyLocal = (c) => {
  if (/[|`]|\$\(|<\(/.test(c.replace(/&&|\|\|/g, ';').replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => q.replace(/\|/g, '')))) return false;
  const vars = new Map();
  const resolve = (w) => w.replace(/^\$\{?(\w+)\}?/, (m, name) => (vars.has(name.toLowerCase()) ? vars.get(name.toLowerCase()) : '\u0000'));
  const local = (w) => IS_LOCAL.test(resolve(w));
  let requests = 0;
  for (const step of c.split(/\r?\n|;|&&|\|\|/).map((s) => s.trim()).filter(Boolean)) {
    const set = step.match(/^\$?(\w+)\s*=\s*(.*)$/);
    if (set) { const v = words(set[2])[0] ?? ''; if (!local(v)) return false; vars.set(set[1].toLowerCase(), resolve(v)); continue; }
    const w = words(step); const cmd = (w[0] ?? '').toLowerCase();
    if (['echo', 'write-host', 'write-output', 'cd', 'set-location', 'sleep', 'start-sleep'].includes(cmd)) continue;
    if (!NET_TOOL.test(cmd)) return false;
    for (let i = 1; i < w.length; i++) {
      const a = w[i];
      if (REROUTE(a)) return false;
      if (URL_OPT.test(a)) { if (!local(w[++i] ?? '')) return false; requests++; continue; }
      if (VALUE_OPT(a)) { i++; continue; }
      if (a.startsWith('-')) continue;
      if (!local(a)) return false;
      requests++;
    }
  }
  return requests > 0;
};
export function riskOf(command, lang = 'es') {
  const c = String(command ?? '');
  for (const [re, why] of RISKY) {
    if (!re.test(c)) continue;
    if (why === 'msg.guard.sendData' && onlyLocal(c)) continue;
    return translate(lang, why);
  }
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

// 3.2.1: whether a shell command writes a file of the project (for the read-only guard). A redirection (`>`, `>>`, not
// `2>`/`>&`), or a cmdlet that writes a file (Out-File, Set-Content, Add-Content, New-Item -ItemType File, tee), to a
// target that is not the null device and not inside a build folder (dist, build, out, coverage, .vite, .next, node_modules).
const BUILD_DIR = /(^|[\\/])(dist|build|out|coverage|\.vite|\.next|\.turbo|\.cache|node_modules|tmp|temp)([\\/]|$)/i;
const NULLISH = /^(\$null|\/dev\/null|nul|con|\/dev\/stdout|\/dev\/stderr|&\d)$/i;
const unq = (w) => String(w ?? '').replace(/^(["'])([\s\S]*)\1$/, '$2');
export function writesProjectFile(command) {
  const c = String(command ?? '');
  const to = [];
  // A redirection `>`/`>>` into a file (not `2>` or `>&`, which redirect a stream, not a file the task means to keep).
  for (const m of c.matchAll(/(?<![0-9&])>>?\s*("[^"]+"|'[^']+'|[^\s|&;<>]+)/g)) to.push(m[1]);
  // A cmdlet that writes a file: its -Path, or the first positional argument that looks like a file name.
  if (/\b(?:Out-File|Set-Content|Add-Content|tee|tee-object)\b/i.test(c) || /\bNew-Item\b[^|;&\n]*-ItemType\s+File\b/i.test(c)) {
    const named = c.match(/-(?:File)?Path\s+("[^"]+"|'[^']+'|[^\s|&;<>]+)/i);
    if (named) to.push(named[1]);
    else { const cand = (c.match(/"[^"]+"|'[^']+'|[^\s|&;<>]+/g) ?? []).map(unq).reverse().find((t) => !t.startsWith('-') && /[.\\/]/.test(t) && !/^(Out-File|Set-Content|Add-Content|tee|tee-object|New-Item)$/i.test(t)); if (cand) to.push(cand); }
  }
  return to.map(unq).some((t) => t && !NULLISH.test(t) && !BUILD_DIR.test(t));
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
  if (permission === 'probar' && cls === 'edit') return { decision: 'deny', reason: T('testOnly') };
  if (cls === 'edit') return { decision: 'allow', reason: T('edits') };
  if (cls === 'exec') {
    const risk = riskOf(command, lang);
    if (risk) return { decision: 'ask', reason: risk };
    // 3.2.1: a read-only task must not write files. Running the tests or the build is fine, but a command that redirects
    // into a project file (echo >> BITACORA.md, Set-Content, Out-File…) outside a build folder asks first: with nobody to
    // answer, a task's permission times out and is denied, so the write never happens.
    if (permission === 'probar' && writesProjectFile(command)) return { decision: 'ask', reason: T('testWrite') };
    if (permission === 'preguntar') return { decision: 'ask', reason: T('runs') };
    return { decision: 'allow', reason: T('normalCommand') };
  }
  if (cls === 'mcp') return { decision: 'allow', reason: T('connector') };
  return { decision: permission === 'preguntar' ? 'ask' : 'allow', reason: T('otherTool') };
}

// The command inside a "powershell -Command '…'" wrapper (how Codex runs every command on Windows), or the command itself.
export function unwrapShell(command) {
  const c = String(command ?? '').trim();
  const m = c.match(/^(?:"[^"]*[\\/]|[^\s"]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:[-/]\w+\s+)*?(?:-command|-c)\s+(['"])([\s\S]*)\1\s*$/i);
  if (!m) return c;
  return m[1] === "'" ? m[2].replace(/''/g, "'") : m[2];
}
// The statements of a command line (split at ; && || and new lines, outside quotes, braces and brackets).
export function statements(command) {
  const s = String(command ?? ''); const out = []; let cur = ''; let quote = null; let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '{' || ch === '(') depth++;
    if ((ch === '}' || ch === ')') && depth > 0) depth--;
    if (!depth && (ch === ';' || ch === '\n' || ch === '\r' || ((ch === '&' || ch === '|') && s[i + 1] === ch))) { if (cur.trim()) out.push(cur.trim()); cur = ''; if (ch !== ';' && ch !== '\n' && ch !== '\r') i++; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// 3.1: a command whose only risky part is stopping processes BY THEIR NUMBER (taskkill /PID n, Stop-Process -Id n,
// kill n): the numbers, so the engine can check they are the task's own (its test server). null when it stops anything
// by name or image, pipes into Stop-Process, or has another risk besides.
// 3.2.1: a number kept in a simple variable (`$p = 11188; Stop-Process -Id $p`, seen with Codex) is resolved first.
export function pidKills(command) {
  let c = String(command ?? '');
  const vars = new Map();
  for (const m of c.matchAll(/\$(\w+)\s*=\s*(\d{1,9})\b/g)) vars.set(m[1].toLowerCase(), m[2]);
  if (vars.size) c = c.replace(/\$\{?(\w+)\}?/g, (whole, name) => vars.get(name.toLowerCase()) ?? whole).replace(/\$(\w+)\s*=\s*\d{1,9}\s*;?/g, ' ');
  if (/\/IM\b|\s-name\b|\bpkill\b|\bkillall\b|\|\s*(stop-process|kill)\b|\$\(|`/i.test(c)) return null;
  const pids = [];
  const rest = c.replace(/\btaskkill(?:\s+(?:\/\/|\/)(?:F|T))*\s+(?:\/\/|\/)PID\s+(\d+)(?:\s+(?:\/\/|\/)(?:F|T))*/gi, (m, pid) => { pids.push(Number(pid)); return ' '; })
    .replace(/\bstop-process\s+(?:-(?:force|confirm:\$false)\s+)*-id\s+(\d+)(?:\s+-(?:force|confirm:\$false|erroraction\s+\w+))*/gi, (m, pid) => { pids.push(Number(pid)); return ' '; })
    .replace(/\bkill\s+(?:-9\s+)?(\d+)\b/gi, (m, pid) => { pids.push(Number(pid)); return ' '; });
  if (!pids.length || /\b(taskkill|stop-process|kill)\b/i.test(rest)) return null;
  return riskOf(rest) ? null : pids;
}

// 3.1: what a command does, in words anyone understands, for the permission notice in the chat (the command itself is
// one click away, never in the sentence). The agent's own description wins (Claude's Bash tool gives one).
const PLAIN = [
  [/^(taskkill|stop-process|kill|pkill|killall)\b/i, 'msg.guard.plain.stop'],
  [/^(rm|remove-item|ri|rd|rmdir|del|erase)\b/i, 'msg.guard.plain.delete'],
  [/^git\s+(?:-\S+\s+)*push\b/i, 'msg.guard.plain.push'],
  [/^git\b/i, 'msg.guard.plain.git'],
  [/^gh\b/i, 'msg.guard.plain.github'],
  [/^(npm|pnpm|yarn)\s+(i|install|add|ci)\b/i, 'msg.guard.plain.install'],
  [/^(npm|pnpm|yarn)\s+publish\b/i, 'msg.guard.plain.publish'],
  [/^(npm|pnpm|yarn|npx)\b/i, 'msg.guard.plain.npm'],
  [/^(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b/i, 'msg.guard.plain.web'],
  [/^(node|python|py|deno|bun)\b/i, 'msg.guard.plain.script'],
  [/^(ssh|scp|sftp|rsync)\b/i, 'msg.guard.plain.remote'],
  [/^(schtasks|reg|setx|netsh|sc|shutdown|restart-computer|stop-computer|set-executionpolicy)\b/i, 'msg.guard.plain.system'],
  [/^(docker|podman)\b/i, 'msg.guard.plain.docker']
];
export function plainAction(command, { description = '', lang = 'es' } = {}) {
  if (String(description ?? '').trim()) return String(description).trim().replace(/\.$/, '').slice(0, 160);
  // The command inside a "powershell -Command '…'" or "cmd /c …" wrapper is the one that counts.
  // (Also a quoted path with spaces: "C:\Program Files\PowerShell\7\pwsh.exe" -Command "…".)
  let c = String(command ?? '').trim().replace(/^(?:"[^"]*[\\/]|[^\s"]*[\\/])?(?:powershell|pwsh|cmd)(?:\.exe)?"?\s+(?:[-/]\w+\s+)*?(?:-command|-c|\/c)\s+["']?/i, '');
  // 3.2.1: a compound command (`$p = 11188; Stop-Process -Id $p`, `cd x && npm run dev`) is read clause by clause: the
  // first clause that names a known action wins, so the sentence is not built from a stray `11188;` or a `cd`.
  const clauses = statements(c).map((s) => s.replace(/^\s*(?:cd\s+[^;&|]+(?:&&|;)\s*)+/i, '').replace(/^\$\w+\s*=\s*\d+\s*$/,'').replace(/^\$\w+\s*=\s*/, '').trim()).filter(Boolean);
  for (const [re, key] of PLAIN) {
    const s = clauses.find((cl) => re.test(cl));
    if (!s) continue;
    // 3.2.1: a deletion names what it deletes («borrar /tmp/tierra-build-check»), so the user can tell a temporary folder
    // of the agent's from their work.
    if (key === 'msg.guard.plain.delete') { const target = deleteTarget(s); if (target) return translate(lang, 'msg.guard.plain.deleteWhat', { target }); }
    return translate(lang, key, { program: progOf(s) });
  }
  const first = clauses.find((cl) => !/^\$\w+\s*=/.test(cl)) ?? c.replace(/^\$\w+\s*=\s*/, '');
  return translate(lang, 'msg.guard.plain.other', { program: progOf(first) });
}
const progOf = (s) => (String(s ?? '').trim().split(/\s+/)[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').replace(/[;,]+$/, '').slice(0, 30);

// The first thing a delete command names (rm -rf X, Remove-Item -Recurse -Path "X", rd /s /q X), shortened from the left
// when it is long; null when it names nothing readable (a variable, a pattern of several files).
export function deleteTarget(command) {
  const words = [...String(command ?? '').split(/[;&|]/)[0].matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]).slice(1);
  const target = words.find((w) => !/^-|^\/[a-z]{1,2}$/i.test(w));
  if (!target || /^\$|[*?]/.test(target)) return null;
  const clean = target.replace(/^["']+|["']+$/g, '').replace(/[\\/]+$/, '');
  if (!clean) return null;
  return clean.length > 60 ? `…${clean.slice(-57)}` : clean;
}

// 3.2.1: whether an agent's own words are in English (Claude describes its commands in English even when the user
// writes in Spanish): then they are not quoted in a Spanish notice.
const EN_WORDS = /\b(the|and|for|with|from|into|start|run|check|install|build|create|remove|delete|kill|stop|test|verify|list|open|read|write|update|server|dev|file|files|folder|directory|temp|temporary|clean|cleanup|port|process|launch)\b/i;
const ES_WORDS = /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|para|que|con|un|una|y|en|por|archivo|archivos|carpeta|servidor)\b/i;
export const looksEnglish = (text) => EN_WORDS.test(String(text ?? '')) && !ES_WORDS.test(String(text ?? ''));

// One line for the approval card: what the agent wants to do, in plain words.
export function describeAction({ tool, command, paths = [], title, lang = 'es' }) {
  if (command) return String(command).slice(0, 400);
  if (paths.length) return `${tool ?? translate(lang, 'msg.guard.tool')}: ${paths.slice(0, 3).join(', ')}`;
  return String(title ?? tool ?? translate(lang, 'msg.guard.action')).slice(0, 400);
}
