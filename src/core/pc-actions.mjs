// 3.7: the changes a bot with the «Equipo» tools may propose on this computer (pc_propose → a card → the engine runs
// runPcAction once someone approves it). The same closed list Opti Bot had until 3.6 (src/engine/opti.mjs, gone): an
// antivirus quick scan, updating its signatures, cleaning old temporary files, ending a process and stopping a program
// from starting with Windows. Everything is Windows-only and written here (never by an agent); the ones that need
// administrator rights ask for them with Windows' own prompt (UAC) for that action alone, and nothing else runs elevated.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ctx, tr } from './context.mjs';
import { powershell, programLabel } from './pc-health.mjs';
import { oneLine } from './safety.mjs';
import { protectedHit } from './guard.mjs';

// admin: Windows asks for administrator rights (UAC) when it runs.
export const PC_ACTIONS = { defender_quick_scan: { admin: true }, defender_update: { admin: true }, clean_temp: { admin: false }, end_process: { admin: false }, disable_startup: { admin: false } };
export const PC_ACTION_IDS = Object.keys(PC_ACTIONS);
// Never closed, whatever the reason: Windows itself, its security, and Orb.
const PROTECTED = /^(system|idle|smss|csrss|wininit|winlogon|services|lsass|lsaiso|svchost|fontdrvhost|dwm|explorer|msmpeng|nissrv|securityhealthservice|securityhealthsystray|mpdefendercoreservice|registry|memcompression|audiodg|sihost|ctfmon|taskhostw|orb|electron)$/i;

// A proposal as the bot wrote it, checked: one of the actions, its reason and its target. Throws for the bot.
export function checkPcAction(a) {
  if (!PC_ACTIONS[a?.action]) throw new Error(tr('sys.pc.badAction', { list: PC_ACTION_IDS.join(', ') }));
  const reason = oneLine(String(a.reason ?? ''), 300).trim();
  if (!reason) throw new Error(tr('sys.pc.needsReason'));
  const p = { action: a.action, reason };
  if (a.action === 'end_process') {
    const pid = Number(a.pid); if (!Number.isInteger(pid) || pid <= 4) throw new Error(tr('sys.pc.needsPid'));
    p.pid = pid; p.name = oneLine(String(a.name ?? ''), 80).trim(); p.label = programLabel(p.name);
  }
  if (a.action === 'disable_startup') {
    const name = oneLine(String(a.name ?? ''), 120).trim(); if (!name) throw new Error(tr('sys.pc.needsName'));
    p.name = name; p.label = programLabel(name);
  }
  if (PC_ACTIONS[a.action].admin) p.admin = true;
  { const hit = protectedHit(JSON.stringify({ name: p.name ?? '' })); if (hit) throw new Error(tr('sys.srv.protected', { name: hit })); }
  return p;
}

// The PC's own temporary folder: files and folders not touched for 2 days. Files in use are skipped.
function cleanTemp() {
  const dir = os.tmpdir(); const limit = Date.now() - 2 * 86400000; let freed = 0; let removed = 0; let skipped = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs > limit) continue;
      const size = e.isDirectory() ? dirSize(p) : st.size;
      fs.rmSync(p, { recursive: true, force: false });
      freed += size; removed++;
    } catch { skipped++; }
  }
  return { ok: true, summary: tr('sys.pc.cleaned', { n: removed, mb: Math.round(freed / 1048576), skipped }) };
}
const dirSize = (p) => { let n = 0; try { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size; } } catch { /* in use */ } return n; };

// A script run once with administrator rights: Windows shows its own prompt; if the user says no, nothing runs. The
// script is written here (never by an agent) and leaves its answer in a file next to it.
async function elevated(name, body) {
  const dir = path.join(ctx.paths.internal, 'equipo'); fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now(); const script = path.join(dir, `${name}-${stamp}.ps1`); const out = path.join(dir, `${name}-${stamp}.json`);
  fs.writeFileSync(script, `$ErrorActionPreference = 'Stop'\ntry {\n${body}\n  $r = @{ ok = $true; detail = ($result | Out-String).Trim() }\n} catch { $r = @{ ok = $false; detail = $_.Exception.Message } }\n$r | ConvertTo-Json -Compress | Set-Content -LiteralPath '${out.replace(/'/g, "''")}' -Encoding UTF8\n`, 'utf8');
  const started = await new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','"${script.replace(/'/g, "''")}"')`],
    { windowsHide: true, timeout: 30 * 60_000 }, (error) => resolve(!error)));
  let r = null; try { r = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^﻿/, '')); } catch { /* no answer */ }
  for (const f of [script, out]) fs.rmSync(f, { force: true });
  if (!started && !r) return { ok: false, cancelled: true, summary: tr('sys.pc.uacCancelled') };
  return { ok: Boolean(r?.ok), summary: oneLine(r?.detail || (r?.ok ? tr('sys.pc.done') : tr('sys.pc.failed')), 1500) };
}

async function endProcess(pid, name) {
  const p = await powershell(`Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue | Select-Object Name, Id | ConvertTo-Json -Compress`);
  if (!p) return { ok: false, summary: tr('sys.pc.noProcess', { pid }) };
  if (name && String(p.Name).toLowerCase() !== String(name).toLowerCase().replace(/\.exe$/, '')) return { ok: false, summary: tr('sys.pc.processChanged', { pid, name: p.Name }) };
  if (PROTECTED.test(String(p.Name))) return { ok: false, summary: tr('sys.pc.protected', { name: p.Name }) };
  const r = await powershell(`try { Stop-Process -Id ${Number(pid)} -ErrorAction Stop; 'ok' | ConvertTo-Json } catch { $_.Exception.Message | ConvertTo-Json }`);
  if (r === 'ok') return { ok: true, summary: tr('sys.pc.processClosed', { name: p.Name, pid }) };
  // Some processes belong to the system: closing them takes administrator rights (Windows asks).
  return elevated('cerrar', `  $result = Stop-Process -Id ${Number(pid)} -PassThru | Select-Object Name, Id`);
}

// Stops a program from starting with Windows the way the Task Manager does (Explorer\StartupApproved: reversible from the
// Task Manager itself). Only entries of the Run keys; the machine's need administrator rights.
async function disableStartup(name) {
  const found = await powershell('[pscustomobject]@{ Sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; Items = @(Get-CimInstance Win32_StartupCommand | Select-Object Name, Location) } | ConvertTo-Json -Compress -Depth 3');
  const all = (Array.isArray(found?.Items) ? found.Items : found?.Items ? [found.Items] : []).filter((i) => i.Name === name);
  // The same program can be listed for several Windows users: this user's entry first, then the machine's.
  const mine = (loc) => /^HKCU/i.test(loc) || (found?.Sid && String(loc).toUpperCase().startsWith(`HKU\\${found.Sid.toUpperCase()}\\`));
  const entry = all.find((i) => mine(String(i.Location ?? ''))) ?? all.find((i) => /^HKLM/i.test(String(i.Location ?? ''))) ?? all[0];
  if (!entry) return { ok: false, summary: tr('sys.pc.noStartup', { name }) };
  const loc = String(entry.Location ?? '');
  const machine = /^HKLM/i.test(loc); const user = mine(loc);
  if (/^HKU/i.test(loc) && !user) return { ok: false, summary: tr('sys.pc.otherUser', { name }) };
  if (!machine && !user) return { ok: false, summary: tr('sys.pc.startupFolder', { name }) };
  const sub = /wow6432node/i.test(loc) ? 'Run32' : 'Run';
  const hive = machine ? 'HKLM' : 'HKCU';
  const value = name.replace(/'/g, "''");
  const set = `$k = '${hive}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\${sub}'; if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }; $result = Set-ItemProperty -Path $k -Name '${value}' -Type Binary -Value ([byte[]](3,0,0,0,0,0,0,0,0,0,0,0)) -PassThru | Select-Object -ExpandProperty PSPath`;
  if (machine) return elevated('inicio', `  ${set}`);
  const r = await powershell(`try { ${set}; 'ok' | ConvertTo-Json } catch { $_.Exception.Message | ConvertTo-Json }`);
  return r === 'ok' ? { ok: true, summary: tr('sys.pc.startupOff', { name }) } : { ok: false, summary: oneLine(String(r ?? tr('sys.pc.failed')), 500) };
}

// Runs an approved action (engine only). → { ok, summary, cancelled? }
export async function runPcAction(a) {
  const p = checkPcAction(a);
  if (process.platform !== 'win32') return { ok: false, summary: tr('sys.pc.windowsOnly') };
  if (p.action === 'clean_temp') return cleanTemp();
  if (p.action === 'end_process') return endProcess(p.pid, p.name);
  if (p.action === 'disable_startup') return disableStartup(p.name);
  if (p.action === 'defender_quick_scan') return elevated('analisis', '  Start-MpScan -ScanType QuickScan\n  $result = Get-MpComputerStatus | Select-Object QuickScanAge, AntivirusSignatureLastUpdated');
  if (p.action === 'defender_update') return elevated('firmas', '  Update-MpSignature\n  $result = Get-MpComputerStatus | Select-Object AntivirusSignatureVersion, AntivirusSignatureLastUpdated');
  return { ok: false, summary: tr('sys.pc.badAction', { list: PC_ACTION_IDS.join(', ') }) };
}
