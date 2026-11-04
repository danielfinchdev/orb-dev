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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { translate } from './i18n.mjs';
import { ctx } from './context.mjs';
import { DEFAULT_PROTECTED } from './home.mjs';

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

// 3.5: «Cosas que nadie toca» (config.protected, Ajustes › Bots): names, paths or containers that are nobody's business,
// whatever the permission. A path, a command, a container or a memory that names one is denied. By default the usual
// password managers and secret stores (DEFAULT_PROTECTED); the user adds or removes entries. Matched without case, with
// \ read as / and a name is a whole word (keepass does not match keepassxc, but both are on the list).
export const protectedList = () => {
  const list = ctx.config?.protected;
  return (Array.isArray(list) ? list : DEFAULT_PROTECTED).map((x) => String(x ?? '').trim()).filter((x) => x.length >= 2);
};
// 3.7 (WS6): Orb Server's own vault folder is always checked, whatever the list says.
const ALWAYS_PROTECTED = ['orb-server/data/vault'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entryRe = (e) => new RegExp(`${/^[a-z0-9]/i.test(e) ? '(?<![a-z0-9])' : ''}${esc(e.replace(/\\/g, '/'))}${/[a-z0-9]$/i.test(e) ? '(?![a-z0-9])' : ''}`, 'i');
// The first protected entry that the text names, or null.
export function protectedHit(text, list = protectedList()) {
  const t = String(text ?? '').replace(/\\/g, '/');
  if (!t) return null;
  return list.find((e) => entryRe(e).test(t)) ?? ALWAYS_PROTECTED.find((e) => entryRe(e).test(t)) ?? null;
}
export const touchesProtected = (text, list) => protectedHit(text, list) !== null;
// 3.5: what a bot never does without the user's click: send (mail, messages), buy, book, pay, submit, share, create or
// delete calendar events. Matched on the tool's own name (connectors: send_message, create_event…).
export const OUTWARD = /(^|[_.:-])(send|reply|forward|share|post|publish|submit|purchase|buy|checkout|order|book|reserve|pay|transfer|create_event|update_event|delete_event|respond_to_event|trash|delete)/i;

// ---- 3.5.1: what a bot may read and where it may go. A bot has no files but its own folder (bots\<id>, where its memory
// is); the secrets of the agents, of Orb and of the browsers are named here too, fixed, whatever the user's list says
// (and checked on the real path, so a link or «..» does not get round it). After it read something from outside in a
// turn (a web, the browser, a mail or any connector, a server log), opening another site or a connector tool that changes
// something asks the user first: what it read could be telling it to send the user's data away.
const SECRET_NAME = /(^|[\\/])(\.claude|\.claude\.json|\.codex|\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.netrc|\.npmrc|\.git-credentials|\.orb-terminal|\.orb|\.password-store|\.mozilla|\.credentials\.json|auth\.json|clave\.bin|enlaces\.json|orb\.db|id_rsa|id_ecdsa|id_ed25519|\.env|login data|cookies|key4\.db|logins\.json|user data)([\\/.]|$)/i;
export function botSecretDirs() {
  const h = os.homedir();
  const under = (...p) => path.join(h, ...p);
  const list = [under('.claude'), under('.codex'), under('.ssh'), under('.gnupg'), under('.aws'), under('.orb-terminal'), under('.config', 'gcloud'), under('.config', 'gh'),
    under('.mozilla'), under('.config', 'google-chrome'), under('.config', 'chromium'), under('.config', 'microsoft-edge'), under('.config', 'BraveSoftware'),
    under('Library', 'Application Support', 'Google', 'Chrome'), under('Library', 'Application Support', 'Firefox'),
    under('AppData', 'Local', 'Google', 'Chrome', 'User Data'), under('AppData', 'Local', 'Microsoft', 'Edge', 'User Data'), under('AppData', 'Roaming', 'Mozilla'),
    under('AppData', 'Local', 'BraveSoftware'), under('AppData', 'Roaming', 'Orb'), under('.config', 'Orb'), under('.config', 'orb-server')];
  for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'ORB_VAULT_KEY_DIR']) if (process.env[k]) list.push(process.env[k]);
  for (const a of ctx.config?.accounts ?? []) if (a?.home) list.push(String(a.home));
  if (ctx.home) list.push(path.join(ctx.home, '.orb'));
  if (ctx.paths?.internal) list.push(ctx.paths.internal);
  return list.map((d) => path.resolve(d));
}
// The rules Claude Code itself applies to the bots (deny wins over everything): the secrets under the home folder.
export const botDenyRules = () => ['.claude', '.codex', '.ssh', '.gnupg', '.aws', '.orb-terminal', '.config/gcloud', '.config/gh', '.mozilla'].map((d) => `Read(~/${d}/**)`).concat('Read(~/.claude.json)');
// The tools whose answer comes from outside (the rest of the turn is careful).
export const taintsBot = (name) => /^(webfetch|websearch|fetch|web_search)$/i.test(String(name ?? '')) || /orb_browser_/.test(String(name ?? '')) || /^mcp__(?!bot__)/.test(String(name ?? '')) || /^mcp__bot__srv_logs$/.test(String(name ?? ''));
const READ_NAME = /^(get|list|search|read|find|fetch|query|view|lookup|count|describe|download|export)([_-]|$)/i;
const lower = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const inside = (p, dir) => { const a = lower(path.resolve(p)); const d = lower(path.resolve(dir)); return a === d || a.startsWith(d.endsWith(path.sep) ? d : d + path.sep); };
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
// The fixed part of a glob pattern («../../**/x» → «../..»), to see where it reaches.
const globBase = (pattern) => { const parts = String(pattern).replace(/\\/g, '/').split('/'); const i = parts.findIndex((x) => /[*?[{]/.test(x)); return (i < 0 ? parts : parts.slice(0, i)).join('/') || '.'; };
const hostOfUrl = (url) => { try { return new URL(/^[a-z][\w+.-]*:\/\//i.test(String(url)) ? String(url) : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
export function botCheck({ tool, paths = [], patterns = [], url = null, bot, lang = 'es' }) {
  if (!bot || typeof bot !== 'object') return null;
  const T = (k) => translate(lang, `msg.guard.${k}`);
  const dir = bot.dir ? path.resolve(bot.dir) : null;
  const secrets = botSecretDirs();
  const at = (p) => (dir && !path.isAbsolute(p) ? path.resolve(dir, p) : path.resolve(p));
  const wanted = [...paths.filter(Boolean).map(String).map((p) => at(p)), ...patterns.filter(Boolean).map(String).map((p) => at(globBase(p)))];
  for (const raw of [...paths, ...patterns].filter(Boolean)) if (SECRET_NAME.test(String(raw).replace(/\\/g, '/'))) return { decision: 'deny', reason: T('botSecret') };
  // 3.6 (S1): the real path counts on its own (a link inside the bot's folder that points outside is outside), also for a
  // file that does not exist yet (its nearest existing folder, resolved).
  const realDir = dir ? realDeep(dir) : null;
  const inDir = (x) => inside(x, dir) || inside(x, realDir);
  for (const p of wanted) {
    const r = realDeep(p);
    if (secrets.some((d) => inside(p, d) || inside(r, d))) return { decision: 'deny', reason: T('botSecret') };
    if (dir && (!inDir(p) || !inDir(r))) return { decision: 'deny', reason: T('botOwnFolder') };
  }
  // 3.6: a shared bot keeps each person's memory of it in personas/<person>.md: in one person's turn the others' files
  // are not its business (on the real path too), nor a search or a pattern that would sweep that folder while it holds
  // someone else's file.
  if (dir) {
    const people = path.join(dir, 'personas');
    const own = bot.person ? path.join(people, `${String(bot.person).replace(/[^\w-]/g, '_')}.md`) : null;
    const isOwn = (p) => own && lower(path.resolve(p)) === lower(own);
    const others = (() => { try { return fs.readdirSync(people).filter((n) => !own || lower(n) !== lower(path.basename(own))).length > 0; } catch { return false; } })();
    for (const p of paths.filter(Boolean).map(String).map(at)) {
      const r = real(p);
      if ((inside(p, people) && !isOwn(p)) || (inside(r, people) && !isOwn(r))) return { decision: 'deny', reason: T('botOtherPerson') };
      if (others && /^(grep|glob|search|find)$/i.test(String(tool ?? '')) && (inside(people, p) || inside(people, r))) return { decision: 'deny', reason: T('botOtherPerson') };
    }
    for (const raw of others ? patterns.filter(Boolean).map(String) : []) {
      const base = at(globBase(raw)); const rb = real(base);
      if (inside(base, people) || inside(rb, people)) return { decision: 'deny', reason: T('botOtherPerson') };
      if (!inside(people, base) && !inside(people, rb)) continue;
      // The pattern starts above personas\: refused when it can go down into it (** or a first part that matches it).
      const rest = String(raw).replace(/\\/g, '/').slice(globBase(raw).replace(/\\/g, '/').length).replace(/^\/+/, '');
      const first = rest.split('/')[0] ?? '';
      let re = null; try { re = new RegExp(`^${first.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^')}$`, 'i'); } catch { re = null; }
      if (!re || rest.includes('**') || (rest.includes('/') && re.test('personas'))) return { decision: 'deny', reason: T('botOtherPerson') };
    }
  }
  const name = String(tool ?? '');
  if (url) {
    const host = hostOfUrl(url);
    if (bot.tainted && !bot.hosts?.has(host)) return { decision: 'ask', reason: T('botOutside') };
    bot.hosts?.add?.(host);
  }
  if (bot.tainted && /^mcp__(?!bot__|orb__)/.test(name) && !READ_NAME.test(name.replace(/^mcp__[^_]+__/, ''))) return { decision: 'ask', reason: T('botOutsideWrite') };
  return null;
}

// ---- 3.6 (A9): a session of someone other than the owner works only inside its project's folder. confine: { roots,
// others, secrets } (confineFor): every path and pattern must fall inside a root, on its real path too (a link or «..»
// does not get round it); never another project's folder, Orb's own folder or a secret. A command that names a folder of
// this PC's user outside its roots is refused too.
export function confineFor({ roots = [], others = [] } = {}) {
  const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const list = roots.filter(Boolean).map((r) => path.resolve(r));
  return { roots: [...new Set([...list, ...list.map(realOf)])], others: others.filter(Boolean).map((r) => path.resolve(r)).filter((o) => !list.some((r) => inside(r, o) || inside(o, r))),
    secrets: [...botSecretDirs(), ...(ctx.home ? [path.join(ctx.home, '.orb')] : []), ...(ctx.paths?.internal ? [ctx.paths.internal] : [])] };
}
const UP_TOKEN = /(?:^|[\s"'=(])((?:[^\s"'|;&<>()]*[\\/])?\.\.(?:[\\/][^\s"'|;&<>()]*)?)(?=$|[\s"'|;&<>()])/g;
const ABS_TOKEN = /(?:^|[\s"'=(])((?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/])[^\s"'|;&<>()]*)/g;
// The real path of a path that may not exist yet: its nearest existing folder resolved (links included), plus the rest.
const realDeep = (p) => {
  let cur = path.resolve(p); const rest = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch { /* not there yet */ }
    const up = path.dirname(cur); if (up === cur) break;
    rest.push(path.basename(cur)); cur = up;
  }
  return path.resolve(p);
};
export function confineCheck({ paths = [], patterns = [], command = '', confine, lang = 'es' }) {
  const real = realDeep;
  if (!confine || typeof confine !== 'object') return null;
  const T = (k) => translate(lang, `msg.guard.${k}`);
  // 3.6: { exclude, cwd } (the owner's assistant): everything stays as it was but other people's folders.
  if (Array.isArray(confine.exclude)) {
    const hit = (p) => confine.exclude.some((d) => inside(p, d) || inside(real(p), d));
    const at = (p) => (path.isAbsolute(p) ? path.resolve(p) : path.resolve(confine.cwd ?? process.cwd(), p));
    for (const raw of [...paths, ...patterns].filter(Boolean).map(String)) if (hit(at(paths.includes(raw) ? raw : globBase(raw)))) return { decision: 'deny', reason: T('confined') };
    for (const m of String(command ?? '').matchAll(ABS_TOKEN)) if (hit(path.resolve(m[1]))) return { decision: 'deny', reason: T('confined') };
    return null;
  }
  const roots = confine.roots ?? []; const base = roots[0] ?? process.cwd();
  const at = (p) => (path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p));
  const within = (p) => roots.some((r) => inside(p, r));
  const blocked = (p) => (confine.secrets ?? []).some((d) => inside(p, d)) || (confine.others ?? []).some((d) => inside(p, d));
  for (const raw of [...paths, ...patterns].filter(Boolean).map(String)) {
    if (SECRET_NAME.test(raw.replace(/\\/g, '/'))) return { decision: 'deny', reason: T('confinedSecret') };
    const p = at(paths.includes(raw) ? raw : globBase(raw)); const r = real(p);
    if (!within(p) || !within(r)) return { decision: 'deny', reason: T('confined') };
  }
  const text = String(command ?? '');
  if (text) {
    if (SECRET_NAME.test(text.replace(/\\/g, '/'))) return { decision: 'deny', reason: T('confinedSecret') };
    const home = os.homedir();
    for (const m of text.matchAll(ABS_TOKEN)) {
      const tok = m[1].replace(/^~(?=[\\/])/, home);
      const p = path.resolve(tok); const r = real(p);
      if (within(p) && within(r)) continue;
      if (blocked(p) || blocked(r)) return { decision: 'deny', reason: T('confined') };
      if (inside(p, home) || (ctx.home && inside(p, ctx.home))) return { decision: 'deny', reason: T('confined') };
    }
    // 3.6: a relative path that climbs out («../otro-proyecto/archivo»), from the working folder.
    for (const m of text.matchAll(UP_TOKEN)) {
      const p = path.resolve(base, m[1]); const r = real(p);
      if (!within(p) || !within(r)) return { decision: 'deny', reason: T('confined') };
    }
  }
  return null;
}

// decide({ permission, tool, kind, command, paths, internalDir, lang, bot }) → (lang: language of the reasons, default 'es')
//  { decision: 'allow' | 'ask' | 'deny', reason }
// bot (3.5): the session is one of the user's bots: its own tools (mcp__bot, the agents' browser) are allowed, and any
// connector tool that sends, buys, books or deletes asks first, even in read-only mode. 3.5.1: bot may be the bot's guard
// ({ dir, tainted, hosts }, src/engine/bots.mjs): its folder only, no secrets, care after reading from outside (botCheck);
// patterns (Glob/Grep) and url (WebFetch, the browser) are checked too.
// 3.7 (Orb Server): no agent and no bot ever raises its privileges, whatever its permission (also «total»): sudo, doas,
// pkexec, su, run0 or the server's admin helper. The only way to root is the engine itself, after an approval card,
// through the root-owned helper (src/core/server-admin.mjs); the agents' processes run with no_new_privs anyway.
const ESCALATE = /\b(sudo|doas|pkexec|run0)\b|(^|[;&|(`]|\$\()\s*su(\s|$)|orb-server-admin|\/etc\/sudoers/i;
export const escalates = (command) => ESCALATE.test(String(command ?? ''));
export function decide({ permission = 'editar', tool, kind, command = '', paths = [], patterns = [], url = null, internalDir, lang = 'es', bot = false, confine = null }) {
  const T = (k) => translate(lang, `msg.guard.${k}`);
  const cls = toolClass(tool, kind);
  const text = [command, ...paths, ...patterns].join(' ');
  if (touchesInternal(text, internalDir)) return { decision: 'deny', reason: T('internal') };
  if (escalates(command)) return { decision: 'deny', reason: T('sudo') };
  const confined = confineCheck({ paths, patterns, command, confine, lang });
  if (confined) return confined;
  const hit = protectedHit(text);
  if (hit) return { decision: 'deny', reason: translate(lang, 'msg.guard.protected', { name: hit }) };
  const botVerdict = botCheck({ tool, paths, patterns, url, bot, lang });
  if (botVerdict) return botVerdict;
  if (bot && (cls === 'mcp' || cls === 'orb')) {
    if (/^mcp__bot__/.test(String(tool))) return { decision: 'allow', reason: T('connector') };
    if (OUTWARD.test(String(tool ?? '').replace(/^mcp__[^_]+__/, ''))) return { decision: 'ask', reason: T('outward') };
    return { decision: 'allow', reason: T('connector') };
  }
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
