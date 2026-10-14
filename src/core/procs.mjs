// 3.2.1: the programs a task started (its test servers, the shells that launched them), found by the process tree and
// not only by their command line. A server started with a relative path (`node server.js`, `python -m http.server 8000`)
// does not name the task's folder, Windows' Python alias relaunches itself as another program (python.exe →
// python3.13.exe), and a shell that ran `Start-Process` ends at once, leaving its child with a parent that no longer exists.
//
// A process belongs to the task when it was created after the task started and:
//   - its parent is the agent's own process, or another process of the task (alive, or seen earlier and gone now);
//   - or its command line names the task's folder (the rule of 3.1);
//   - or its parent is gone and its arguments are part of a command the task ran (the shell that started it has ended).
// Only the process list (number, parent, start time, and the name and command line of the recent ones) is read.
// Windows only: elsewhere nothing is found and nothing is stopped.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// What Orb may stop when a task ends: the usual runtimes and the shells and package runners that start them. Never a
// browser, an editor or anything else a task may have opened for the user.
export const STOPPABLE = /^(node|nodejs|python[\d.]*|pythonw[\d.]*|py|pyw|deno|bun|php|php-cgi|ruby|rubyw|java|javaw|dotnet|bash|sh|cmd|powershell|pwsh|npm|npx|pnpm|yarn|uv|uvx|uvicorn|flask|esbuild)(\.exe)?$/i;
// The 3.1 rule (folder named in the command line) only ever stopped runtimes: shells found that way could be the user's.
const RUNTIME = /^(node|python[\d.]*|pythonw[\d.]*|py|deno|bun|php|ruby|java|dotnet)(\.exe)?$/i;
const SLACK_MS = 1000; // clocks of the engine and of Windows' process list

const norm = (s) => String(s ?? '').replace(/\\/g, '/').toLowerCase();
const unquote = (w) => w.replace(/^(["'])([\s\S]*)\1$/, '$2');
const words = (s) => (String(s ?? '').match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);

// The arguments of a command line, without the program itself (as `"C:\…\node.exe" server.js` → ['server.js']).
export function argsOf(cmd) { return words(cmd).slice(1); }

// Whether a command the task ran started this process: every argument of the process appears in that command, and at
// least one of them says something (not only options or numbers).
export function startedBy(cmd, commands) {
  const args = argsOf(cmd).map(norm).filter(Boolean);
  if (!args.length || !args.some((a) => !a.startsWith('-') && !/^\d+$/.test(a) && a.length >= 3)) return false;
  return commands.some((c) => { const t = norm(c).replace(/["']/g, ' '); return args.every((a) => t.includes(a)); });
}

// list: [{ id, ppid, at (ms), name, cmd }] (name and cmd only for processes created after `since`).
// roots: the agent's process numbers; known: Map pid → start time (ms) of processes seen earlier in the task's tree;
// keys: texts that name the agent's process in its command line (its conversation id); engine: the process that starts
// the agents. Returns the task's processes: [{ id, ppid, at, name, cmd, why: 'tree' | 'folder' | 'orphan' }].
export function taskProcesses(list, { since, roots = [], known = new Map(), keys = [], engine = process.pid, dir = '', commands = [], folderRule = true } = {}) {
  const byId = new Map(list.map((p) => [p.id, p]));
  const rootSet = new Set(roots.filter(Boolean).map(Number));
  for (const p of list) if (p.ppid === engine && keys.some((k) => k && String(p.cmd ?? '').includes(k))) rootSet.add(p.id);
  const d = dir ? norm(path.resolve(dir)) : '';
  const recent = list.filter((p) => p.at >= since - SLACK_MS && !rootSet.has(p.id) && p.id !== engine);
  const out = new Map();
  // A parent counts while it is the same process (a number Windows gave again to a newer one does not).
  const sameParent = (p) => { const parent = byId.get(p.ppid); return parent && parent.at <= p.at + SLACK_MS ? parent : null; };
  for (let grew = true; grew;) {
    grew = false;
    for (const p of recent) {
      if (out.has(p.id)) continue;
      const parent = sameParent(p);
      let why = null;
      if (parent && (rootSet.has(parent.id) || out.has(parent.id))) why = 'tree';
      else if (!parent && (rootSet.has(p.ppid) || (known.has(p.ppid) && p.at >= known.get(p.ppid) - SLACK_MS))) why = 'tree';
      else if (parent && known.has(parent.id) && Math.abs(known.get(parent.id) - parent.at) <= SLACK_MS) why = 'tree';
      else if (folderRule && d && RUNTIME.test(p.name ?? '') && norm(p.cmd).includes(d)) why = 'folder';
      else if (!parent && startedBy(p.cmd, commands)) why = 'orphan';
      if (why) { out.set(p.id, { ...p, why }); grew = true; }
    }
  }
  return [...out.values()];
}

// The processes of this PC now (Windows): every number with its parent and start time; name and command line only for
// those created after `since`. null when the list cannot be read.
export function processList(since) {
  if (process.platform !== 'win32') return null;
  const script = "$since=[datetime]::Parse($env:ORB_PROCS_SINCE).ToUniversalTime(); "
    + 'Get-CimInstance Win32_Process | ForEach-Object { $at = $_.CreationDate; $u = if ($at) { $at.ToUniversalTime() } else { $null }; '
    + '$recent = $u -and $u -ge $since; [pscustomobject]@{ id = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; at = if ($u) { $u.ToString(\'o\') } else { $null }; '
    + 'name = if ($recent) { $_.Name } else { $null }; cmd = if ($recent) { $_.CommandLine } else { $null } } } | ConvertTo-Json -Compress';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ORB_PROCS_SINCE: new Date(since - 60_000).toISOString() } });
  let rows; try { rows = JSON.parse(r.stdout || '[]'); } catch { return null; }
  return (Array.isArray(rows) ? rows : [rows]).map((p) => ({ id: Number(p.id), ppid: Number(p.ppid), at: Date.parse(p.at ?? '') || 0, name: p.name ?? null, cmd: p.cmd ?? null }));
}

// Stops these processes by their number (only those Orb may stop). Returns the numbers stopped.
export function stopProcesses(procs) {
  const ids = procs.filter((p) => STOPPABLE.test(p.name ?? '') && p.id !== process.pid).map((p) => p.id);
  if (!ids.length || process.platform !== 'win32') return [];
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `foreach ($id in @(${ids.join(',')})) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; $id } }`],
  { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  return String(r.stdout ?? '').split(/\s+/).filter((x) => /^\d+$/.test(x)).map(Number);
}

// Whether a process number is in use now.
export function alive(pid) { try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === 'EPERM'; } }
