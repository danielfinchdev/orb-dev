// 2.7: Monitoreo del equipo (Opti Bot). What the PC is like now, read only: load, memory, disks, the processes that use
// the most, the programs that start with Windows, the antivirus' state, and whether the assistant's folder is healthy.
// The PowerShell commands are fixed here (nothing an agent writes is ever run) and answer in JSON. The changes (scan,
// clean, close a process, stop a program from starting) are separate actions the user approves: see engine/opti.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const IS_WIN = process.platform === 'win32';

// A fixed PowerShell script → its JSON answer (null if it fails or is not Windows).
export function powershell(script, { timeoutMs = 30000 } = {}) {
  if (!IS_WIN) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ProgressPreference='SilentlyContinue'; ${script}`],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error && !stdout) return resolve(null);
        try { resolve(JSON.parse(String(stdout).trim() || 'null')); } catch { resolve(null); }
      });
  });
}
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const GB = 1024 ** 3;

// CPU load measured over a short moment (os.cpus times), as a percentage.
async function cpuLoad(ms = 600) {
  const snap = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  const a = snap(); await new Promise((r) => setTimeout(r, ms)); const b = snap();
  const total = b.total - a.total; return total > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / total)) : null;
}

// The quick numbers for the page's cards (cheap: no PowerShell).
export async function quickStats() {
  const mem = { total: os.totalmem(), free: os.freemem() };
  let disk = null;
  try { const s = await fs.promises.statfs(IS_WIN ? `${(process.env.SystemDrive || 'C:')}\\` : '/'); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { /* unknown */ }
  return { cpu: await cpuLoad(), memory: { usedPct: Math.round(100 * (1 - mem.free / mem.total)), totalGb: +(mem.total / GB).toFixed(1) }, disk: disk ? { usedPct: Math.round(100 * (1 - disk.free / disk.total)), freeGb: +(disk.free / GB).toFixed(1), totalGb: +(disk.total / GB).toFixed(1) } : null, uptimeH: +(os.uptime() / 3600).toFixed(1) };
}

// The whole picture for Opti Bot: system, disks, the 15 processes using the most memory and the most CPU time.
export async function health() {
  const quick = await quickStats();
  const disks = await powershell("Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, @{n='FreeGB';e={[math]::Round($_.FreeSpace/1GB,1)}}, @{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}} | ConvertTo-Json -Compress");
  const procs = await powershell("Get-Process | Where-Object { $_.Id -ne 0 } | Sort-Object WorkingSet64 -Descending | Select-Object -First 15 Name, Id, @{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB)}}, @{n='CpuS';e={[math]::Round($_.CPU,1)}}, Company | ConvertTo-Json -Compress");
  const busy = await powershell("Get-Process | Where-Object { $_.CPU } | Sort-Object CPU -Descending | Select-Object -First 10 Name, Id, @{n='CpuS';e={[math]::Round($_.CPU,1)}}, @{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress");
  const sys = await powershell("$o = Get-CimInstance Win32_OperatingSystem; $c = Get-CimInstance Win32_Processor | Select-Object -First 1; [pscustomobject]@{ Windows = $o.Caption; Version = $o.Version; Cpu = $c.Name; Cores = $c.NumberOfLogicalProcessors; LastBoot = $o.LastBootUpTime.ToString('s') } | ConvertTo-Json -Compress");
  return { now: new Date().toISOString(), ...quick, system: sys, disks: list(disks), topMemory: list(procs), topCpu: list(busy) };
}

// Programs that start with Windows: the user's and the machine's Run keys and Startup folders.
export async function startup() {
  return list(await powershell("Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User | ConvertTo-Json -Compress"));
}

// The antivirus (Windows Defender): on or off, signatures, last scans and what it found lately; plus processes running
// from places programs do not usually live (Temp, Downloads), for Opti Bot to look at with the user.
export async function security() {
  const defender = await powershell("Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, BehaviorMonitorEnabled, IsTamperProtected, @{n='SignaturesUpdated';e={$_.AntivirusSignatureLastUpdated.ToString('s')}}, QuickScanAge, FullScanAge | ConvertTo-Json -Compress");
  const threats = await powershell("Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending | Select-Object -First 10 ThreatID, @{n='When';e={$_.InitialDetectionTime.ToString('s')}}, ActionSuccess, Resources | ConvertTo-Json -Compress -Depth 3");
  const odd = await powershell("Get-Process | Where-Object { $_.Path -and ($_.Path -match '\\\\(Temp|Downloads|Descargas)\\\\') } | Select-Object Name, Id, Path, Company | ConvertTo-Json -Compress");
  return { defender, recentThreats: list(threats), unusualPlaces: list(odd) };
}

// The assistant's own folder: it exists, its settings read, its database is sound, and how big each part is.
export function orbCheck(home, db) {
  const size = (p) => { let n = 0; try { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); n += e.isDirectory() ? size(f) : fs.statSync(f).size; } } catch { /* gone */ } return n; };
  const out = { folder: home, exists: fs.existsSync(home), settings: null, database: null, sizesMb: {}, backups: [] };
  try { JSON.parse(fs.readFileSync(path.join(home, 'orb.json'), 'utf8')); out.settings = 'ok'; } catch (e) { out.settings = `no se puede leer: ${e.message}`; }
  try { out.database = db.prepare('PRAGMA integrity_check').get()?.integrity_check ?? 'desconocido'; } catch (e) { out.database = `error: ${e.message}`; }
  for (const part of ['.orb', 'bitacora', 'web', 'windows', 'ios', 'android']) { const p = path.join(home, part); if (fs.existsSync(p)) out.sizesMb[part] = Math.round(size(p) / 1048576); }
  out.backups = backups(home).slice(0, 10);
  return out;
}

// The assistant's copies: <home>/.orb/copias/orb-<stamp>, newest first.
export const backupsDir = (home) => path.join(home, '.orb', 'copias', 'orb');
export function backups(home) {
  const dir = backupsDir(home);
  try { return fs.readdirSync(dir).filter((d) => /^\d{8}-\d{6}$/.test(d)).sort().reverse().map((d) => ({ name: d, mb: Math.round(sizeOf(path.join(dir, d)) / 1048576) })); } catch { return []; }
}
const sizeOf = (p) => { let n = 0; try { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); n += e.isDirectory() ? sizeOf(f) : fs.statSync(f).size; } } catch { /* gone */ } return n; };

// A copy of what makes the assistant itself (not the projects, which have their own git): its settings, its logs and a
// consistent copy of its database (VACUUM INTO). Keeps the last 10.
export function backup(home, db) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dir = path.join(backupsDir(home), stamp);
  fs.mkdirSync(path.join(dir, 'datos'), { recursive: true });
  for (const f of ['orb.json']) if (fs.existsSync(path.join(home, f))) fs.copyFileSync(path.join(home, f), path.join(dir, f));
  if (fs.existsSync(path.join(home, 'bitacora'))) fs.cpSync(path.join(home, 'bitacora'), path.join(dir, 'bitacora'), { recursive: true });
  db.exec(`VACUUM INTO '${path.join(dir, 'datos', 'orb.db').replace(/'/g, "''")}'`);
  const all = backups(home);
  for (const old of all.slice(10)) fs.rmSync(path.join(backupsDir(home), old.name), { recursive: true, force: true });
  return { folder: dir, name: stamp, mb: Math.round(sizeOf(dir) / 1048576), kept: Math.min(all.length, 10) };
}
