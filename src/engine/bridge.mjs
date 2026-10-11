// 2.7: the bridge with Open Control Edge (OCE), the same author's Windows widget: both apps share what each one knows of
// the PC through two files in %LOCALAPPDATA%\OrbPuente (user-writable, nothing leaves the PC):
//   orb.json  written here every 5 s: CPU, memory, disk, the real usage of the AI accounts, tasks and the assistant
//   oce.json  written by OCE every 2 s: temperatures, GPU, FPS and its own AI usage readings
// Only real readings: an unknown value is null. The other side counts only while its file is fresh (< 15 s) and its
// process is alive; otherwise nothing of it is shown.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ctx } from '../core/context.mjs';
import { quickStats } from '../core/pc-health.mjs';
import { usageReport } from '../core/budget.mjs';

export const bridgeDir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OrbPuente');
const FRESH_MS = 15_000;
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// What OCE says now, or null (not installed, closed, sharing off, or a stale or broken file).
export function readOce() {
  const file = path.join(bridgeDir(), 'oce.json');
  try {
    const st = fs.statSync(file); if (st.size > 256 * 1024) return null;
    const d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (d?.schema !== 1 || d.app !== 'OpenControlEdge') return null;
    const at = Date.parse(d.at); if (!(Date.now() - at < FRESH_MS) || !alive(d.pid)) return null;
    return {
      version: String(d.version ?? '').slice(0, 20), at: d.at,
      cpu: { loadPct: num(d.cpu?.loadPct), tempC: num(d.cpu?.tempC) },
      gpu: d.gpu ? { name: d.gpu.name ? String(d.gpu.name).slice(0, 80) : null, loadPct: num(d.gpu.loadPct), tempC: num(d.gpu.tempC), vramUsedMb: num(d.gpu.vramUsedMb), vramTotalMb: num(d.gpu.vramTotalMb) } : null,
      ramUsedPct: num(d.ramUsedPct), fps: num(d.fps),
      usage: (Array.isArray(d.usage) ? d.usage : []).slice(0, 12).map((u) => ({ provider: String(u.provider ?? '').slice(0, 20), usedPct: num(u.usedPct), resetAt: u.resetAt ?? null, plan: u.plan ? String(u.plan).slice(0, 30) : null }))
    };
  } catch { return null; }
}

// Writes orb.json every 5 s while sharing is on (Ajustes › Monitoreo del equipo); removes it when off or on closing.
export function startBridge({ board, version, busy: isBusy = () => false, log = () => {} }) {
  const file = path.join(bridgeDir(), 'orb.json');
  const remove = () => { try { fs.rmSync(file, { force: true }); } catch { /* gone */ } };
  let busy = false; let lastError = null;
  const write = async () => {
    if (busy) return; busy = true;
    try {
      if (ctx.config?.monitor?.shareWithOce === false) { remove(); return; }
      // A reading that never answers (a disk that does not respond) must not stop the bridge: 10 s at most, then retry.
      const s = await Promise.race([quickStats(), new Promise((_, reject) => setTimeout(() => reject(new Error('la lectura del PC no responde')), 10_000).unref?.())]);
      const usage = usageReport(board).filter((u) => u.real?.utilization != null).map((u) => ({ agent: u.agent, label: u.label, usedPct: num(u.real.utilization * 100), window: u.real.window ?? null, resetAt: u.real.resetAt ? new Date(u.real.resetAt).toISOString() : null }));
      const count = (st) => board.one('SELECT COUNT(*) AS n FROM tasks WHERE status = ?', st)?.n ?? 0;
      const data = { schema: 1, app: 'Orb', version, pid: process.pid, at: new Date().toISOString(),
        cpu: { loadPct: num(s.cpu) }, ramUsedPct: num(s.memory?.usedPct), disk: s.disk ? { usedPct: num(s.disk.usedPct), freeGb: num(s.disk.freeGb) } : null,
        usage, tasks: { running: count('running'), queued: count('queued'), awaitingApproval: count('awaiting_approval') }, assistant: { busy: Boolean(isBusy()) } };
      fs.mkdirSync(bridgeDir(), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
      fs.renameSync(`${file}.tmp`, file);
      lastError = null;
    } catch (e) { if (e.message !== lastError) log(`puente con Open Control Edge: ${e.message}`); lastError = e.message; } finally { busy = false; }
  };
  write(); const timer = setInterval(write, 5000); timer.unref?.();
  return { stop() { clearInterval(timer); remove(); } };
}
