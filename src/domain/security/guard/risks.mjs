// Risky command patterns (git, network, privilege escalation, drive aliases, adb, credential store)
// and the rules that spot process kills by PID.
import { translate } from '../../../shared/i18n.mjs';
import { unquoted, unwrapShell, words } from './shell-text.mjs';

// Commands that may be fine but need a human look: publishing, downloading and running things from the internet, wiping
// files, touching the system. Matched on the whole command line (PowerShell and bash spellings).
// GIT: "git" plus its global options (-C dir, -c key=value, --no-pager…) before the subcommand.
// Also git.exe and "…\git.exe" (the end of a quoted path).
// An option value may be quoted and hold spaces (-C "D:\my web", -c "user.name=a b", --git-dir="x y").
// A lone quote only counts as a plain character when it has no closing partner, so each token has one parse
// (two overlapping branches made this exponential on inputs like -x"""""""…).
const GIT_TOK = String.raw`(?:"[^"]*"|'[^']*'|[^\s"']|"(?![^"]*")|'(?![^']*'))`;
const GIT = String.raw`\bgit(?:\.exe)?["']?(?:\s+-${GIT_TOK}+(?:\s+(?=[^-\s])${GIT_TOK}+)?)*\s+`;
const ORB_REF = /refs[\\/]+orb\b/i;
const RISKY = [
  [new RegExp(`${GIT}(push|remote\\s+(add|set-url|remove)|send-pack|http-push|subtree\\s+push)\\b`, 'i'), 'msg.guard.push'],
  // a push under another name (git -c alias.p=push p, git config alias.up push).
  [/\balias\.[\w.-]+\s*[= ]\s*["']?!?\s*(?:git\s+)?(push|send-pack)\b/i, 'msg.guard.push'],
  // git settings that make git run a program (Orb's own snapshots run git in the project): they ask.
  [new RegExp(`${GIT}config\\b[^|;&]*\\b(filter\\.[\\w.-]+\\.(clean|smudge|process)|core\\.(fsmonitor|hooksPath|sshCommand|pager|editor|askpass|gitProxy)|credential\\.[\\w.-]*helper|diff\\.[\\w.-]+\\.(command|textconv)|merge\\.[\\w.-]+\\.driver|url\\.[^\\s]*\\.insteadOf|include(?:If\\.\\S+)?\\.path|diff\\.external|gpg\\.(?:[\\w-]+\\.)?program|remote\\.[^\\s]*\\.(?:url|pushurl|uploadpack|receivepack|vcs|proxy))\\b`, 'i'), 'msg.guard.gitRuns'],
  [/\bgh(\.exe)?\s+(repo|pr|release|api|gist|secret)\b/i, 'msg.guard.github'],
  [/\b(npm|pnpm|yarn)(\.cmd)?\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i, 'msg.guard.publish'],
  // images, packages and sites published by their own tools.
  [/\b(docker|podman)(\.exe)?\s+push\b|\bnuget(\.exe)?\s+push\b|\bvercel(\.cmd)?(\s+(deploy|--prod)\b|\s*$|\s*[;&|])|\b(netlify|firebase|wrangler|flyctl|fly)(\.cmd)?\s+(deploy|publish)\b|\bgh-pages\b/i, 'msg.guard.publish'],
  [/\b(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*\|\s*(iex|invoke-expression|sh|bash|pwsh|powershell)\b/i, 'msg.guard.pipeToShell'],
  [/\b(iex|invoke-expression)\b[^|;&]*\b(irm|iwr|invoke-webrequest|invoke-restmethod)\b|[$<]\(\s*(curl|wget)\b/i, 'msg.guard.pipeToShell'],
  // a command hidden in base64 and run (iex of FromBase64String, base64 -d | sh).
  [/frombase64string[\s\S]*\b(iex|invoke-expression|scriptblock)\b|\b(iex|invoke-expression|scriptblock)\b[\s\S]*frombase64string|\bbase64(\.exe)?\s+(-d|-D|--decode)\b[^;&]*\|\s*(sh|bash|zsh|dash|pwsh|powershell|iex|invoke-expression)\b/i, 'msg.guard.pipeToShell'],
  // -EncodedCommand and its short forms hide the command: PowerShell's own option followed by its base64 text. Not any
  // " -e" later in the line (powershell -Command "node -e '…'" was taken for it in a real run).
  // (-Command / -File end PowerShell's own options: what follows is the script, whatever it says.)
  // Options may start with - / or a dash (– —), and their values may be quoted with spaces.
  [/\b(powershell|pwsh)(\.exe)?["']?(\s+[-/–—](?!e\b|ec\b|en\w*\b|c\b|command\b|f\b|file\b)\w+(\s+(?![-/–—])("[^"]*"|'[^']*'|\S+))?)*\s+[-/–—]e(c|n\w*)?\s+["']?[A-Za-z0-9+/]{4,}={0,2}/i, 'msg.guard.pipeToShell'],
  // …and hidden in the arguments of a new PowerShell process (Start-Process powershell -ArgumentList "-enc …").
  [/\b(powershell|pwsh)(\.exe)?\b[^|;&]*-argumentlist\s+["'][^"']*[-/–—]e(c|n\w*)?\s+[A-Za-z0-9+/]{4,}/i, 'msg.guard.pipeToShell'],
  // also curl --json/--form/--request, wget's --post-*/--body-*/--method and -Method:Post, -InFile.
  [/\b(curl|wget)\b[^|;&]*\s(-X\s*(POST|PUT|DELETE|PATCH)|--request[\s=]*["']?(POST|PUT|DELETE|PATCH)|--data|--json|--form|-d\s|-F\s|--upload-file|-T\s|--post-(data|file)|--body-(data|file)|--method[\s=]*["']?(POST|PUT|DELETE|PATCH))/i, 'msg.guard.sendData'],
  [/\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*(-method\s*:?\s*["']?(post|put|delete|patch)|\s-infile\b)/i, 'msg.guard.sendData'],
  [/\brm\s+(?:-{1,2}\S+\s+)*(-[a-z]*r|--recursive)|\b(remove-item|ri|rd|rmdir|del|erase)\b[^|;&]*\s-r(e(c(u(r(se?)?)?)?)?)?\b|\brd\s+\/s\b|\brmdir\s+\/s\b|\bdel\s+\/[sq]/i, 'msg.guard.deleteFolders'],
  // wiping a disk or the boot setup: denied in «Auto», asked in every other mode (also «total»).
  [/\bformat(\.com)?\s+\/?[a-z]:(?![\w\\/])|\b(diskpart|bcdedit|clear-disk|initialize-disk|format-volume|remove-partition)\b|\bcipher(\.exe)?\s+\/w\b/i, 'msg.guard.diskWipe'],
  [/\b(schtasks|reg\s+(add|delete|import)|set-executionpolicy|shutdown|restart-computer|stop-computer|netsh|sc\s+(create|delete|config)|setx|sudo|runas|net\s+(user|localgroup)|new-service|set-service|winget\s+(install|uninstall|upgrade)|choco\s+(install|uninstall|upgrade)|scoop\s+(install|uninstall)|msiexec|install-package)\b/i, 'msg.guard.system'],
  [/\b(taskkill|stop-process|kill\s+(-9|-kill|-s\s+kill|-sigkill)|pkill|killall)\b/i, 'msg.guard.killProcesses'],
  [/\b(ssh|scp|sftp|rsync)\s/i, 'msg.guard.ssh'],
  [new RegExp(`${GIT}(reset\\s+--(hard|merge)\\b|clean\\s+(?:-\\S+\\s+)*(-[a-z]*f|--force)|checkout\\s+(--\\s|\\.(?=\\s|$))|restore\\b(?![^|;&]*--staged)|stash\\s+(drop|clear)\\b|branch\\s+-D\\b|rebase\\b|filter-branch\\b)`, 'i'), 'msg.guard.gitRewrite'],
  [/\b(docker|podman)\s+(rm|rmi|system\s+prune|volume\s+rm)\b/i, 'msg.guard.docker'],
  // Orb's snapshots (refs/orb) and what keeps them alive: «Deshacer» rests on them, so they are
  // never dropped without asking (in «Auto» too).
  // naming them asks unless the whole command only reads them (risksOf › readsOrbRefs).
  [ORB_REF, 'msg.guard.checkpoint'],
  [/\breflog\s+(expire|delete)\b|\bgc\b[^|;&]*--prune|\bgit(\.exe)?\s+prune\b/i, 'msg.guard.checkpoint']
];
// one git command that only reads, and nothing else on the line (no ; | & new line, no $(…),
// backtick or PowerShell (…) that could run a second command): `git for-each-ref --format="%(refname)" refs/orb`.
// A look-behind would let `git update-ref -m "status x" -d refs/orb/…` and `for-each-ref … | update-ref --stdin` through.
const ORB_REF_READ = new RegExp(String.raw`^\s*git(?:\.exe)?(?:\s+-C\s+(?:"[^"$(]*"|'[^']*'|[^\s"'$(]+))?\s+(?:status|log|diff|show|rev-parse|ls-files|for-each-ref|describe|blame|cat-file|rev-list|merge-base|name-rev)\b(?:[^|;&\n\r` + '`' + String.raw`$(<>]|%\()*$`, 'i');
const readsOrbRefs = (command) => ORB_REF_READ.test(unwrapShell(command));
// data sent only to this PC (an agent testing its own local API: curl -X POST localhost:3000…) never leaves it.
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
  || /^(--(header|data\S*|form\S*|json|request|write-out|output|upload-file|user|user-agent|referer|cookie\S*|max-time|connect-timeout|retry\S*)|-(method|body|contenttype|headers|outfile|infile|timeoutsec|erroraction|maximumredirection))$/i.test(a);
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
// what kind of risk each rule is (the «Auto» table of the permissions proposal decides by kind).
const CATEGORY = { push: 'publish', github: 'publish', publish: 'publish', pipeToShell: 'pipeToShell', sendData: 'sendData', deleteFolders: 'deleteFolders',
  diskWipe: 'diskWipe', system: 'system', killProcesses: 'killProcesses', ssh: 'ssh', gitRewrite: 'gitRewrite', docker: 'docker', checkpoint: 'checkpoint', gitRuns: 'gitRuns' };
// Every risk a command carries, in the order of RISKY: [{ category, reason }].
export function risksOf(command, lang = 'es') {
  const c = String(command ?? ''); const out = [];
  // also without its quotes and cmd's ^ (git "push", g^it pu^sh run as git push).
  // And with escaped quotes (\" ` ") turned into a plain char: an escaped quote is no opening quote, and stripping
  // quotes alone would break a real pair ("x y") that precedes it.
  const variants = [...new Set([c, unquoted(c), c.replace(/\\["']|`["']/g, '_')])];
  for (const [re, why] of RISKY) {
    const v = variants.find((x) => re.test(x));
    if (v === undefined) continue;
    if (why === 'msg.guard.sendData' && onlyLocal(v)) continue;
    if (re === ORB_REF && readsOrbRefs(c)) continue;
    const category = CATEGORY[why.slice('msg.guard.'.length)];
    if (!out.some((r) => r.category === category)) out.push({ category, reason: translate(lang, why) });
  }
  return out;
}
export function riskOf(command, lang = 'es') { return risksOf(command, lang)[0]?.reason ?? null; }
export const riskCategories = (command) => risksOf(command).map((r) => r.category);
// Windows' credential store and DPAPI by command (cmdkey /list, vaultcmd, PowerShell's CredentialManager, Unprotect).
const CRED_CMD = /\b(cmdkey|vaultcmd)(\.exe)?\b|\bget-storedcredential\b|protecteddata\]::unprotect|\bcredread\w*\b|\bcredenumerate\w*\b/i;
export const readsCredentialStore = (command) => CRED_CMD.test(String(command ?? '')) || CRED_CMD.test(String(command ?? '').replace(/['"`^]/g, ''));
// decide({ permission, tool, kind, command, paths, patterns, internalDir, cwd, lang }) → (cwd: the agent's folder, to
// resolve relative paths; lang: language of the reasons, default 'es') { decision: 'allow' | 'ask' | 'deny', reason }
// Orb's data folder: denied, whatever the permission («total» too).
// no agent ever raises its privileges, whatever its permission (also «total»): sudo, doas, pkexec, su or
// run0.
// and Windows' ways: runas, gsudo, Start-Process (start, saps) -Verb RunAs, a ShellExecute with
// "runas", psexec -s (SYSTEM) and nircmd elevate.
const ESCALATE = /\b(sudo|doas|pkexec|run0|runas|gsudo)(\.exe)?\b|(^|[;&|(`]|\$\()\s*su(\s|$)|\/etc\/sudoers|\b(start-process|saps|start)\b[^|;&\n]*-verb\s*:?\s*["']?runas|["']runas["']|\bpsexec(64)?(\.exe)?\b[^|;&\n]*\s[-/][a-z]*s\b|\bnircmd(c)?(\.exe)?\s+elevate/i;
export const escalates = (command) => ESCALATE.test(String(command ?? '')) || ESCALATE.test(unquoted(command));
// a new name for a drive or a folder (subst, net use, New-PSDrive, a mapped share): another way to
// reach a closed folder. Denied in every mode.
const DRIVE_ALIAS = /\bsubst(\.exe)?\b|\bnet(\.exe)?\s+use\b|\b(new-psdrive|ndr)\b|\bmapnetworkdrive\b|wnetaddconnection/i;
export const aliasesDrive = (command) => DRIVE_ALIAS.test(String(command ?? '')) || DRIVE_ALIAS.test(unquoted(command));
// a command that runs Android's adb (by name, by path, or Orb's copy in core\herramientas\adb), in any shell.
// Hardening only, not a boundary (a script can build the name at run time): the adb server itself is stopped when Orb
// locks (src/engine/host/android.mjs › stopServer).
const RUNS_ADB = /(^|[\s;&|(`"'\\/=])adb(\.exe)?(?=$|[\s;&|)`"'])/i;
export const runsAdb = (command) => RUNS_ADB.test(String(command ?? '')) || RUNS_ADB.test(unquoted(command));
// git clean with -x or -X: it deletes ignored files, which the snapshot never holds (.env, local databases, uploads).
export const cleansIgnored = (command) => new RegExp(`${GIT}clean\\b[^|;&]*\\s-[a-zA-Z]*[xX]`, 'i').test(unquoted(command));
// a command whose only risky part is stopping processes BY THEIR NUMBER (taskkill /PID n, Stop-Process -Id n,
// kill n): the numbers, so the engine can check they are the task's own (its test server). null when it stops anything
// by name or image, pipes into Stop-Process, or has another risk besides.
// a number kept in a simple variable (`$p = 11188; Stop-Process -Id $p`, seen with Codex) is resolved first.
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
