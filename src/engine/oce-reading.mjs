// 3.7: what Open Control Edge says now (its oce.json in %LOCALAPPDATA%\OrbPuente), read-only. Kept apart from bridge.mjs
// (which also writes orb.json and reads the PC's health and the AI accounts) so Orb Server can answer oce.* calls and
// run Optimus without loading the app's bridge (test/server-product.test.mjs checks the import graph).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ctx } from '../core/context.mjs';

export const bridgeDir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OrbPuente');
export const FRESH_MS = 15_000;
export const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// What OCE says now, or null (not installed, closed, sharing off on either side, or a stale or broken file).
export function readOce() {
  if (ctx.config?.oce?.share === false) return null; // off means off both ways, as in OCE (3.7: oce.share; before, monitor.shareWithOce)
  const file = path.join(bridgeDir(), 'oce.json');
  try {
    const st = fs.statSync(file); if (st.size > 256 * 1024) return null;
    const d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (d?.schema !== 1 || d.app !== 'OpenControlEdge') return null;
    // Fresh (and not from the future, 5 s of clock slack as OCE allows), from a real process that is still running.
    const age = Date.now() - Date.parse(d.at);
    if (!(age < FRESH_MS && age > -5000) || !(Number(d.pid) > 0) || !alive(d.pid)) return null;
    return {
      version: String(d.version ?? '').slice(0, 20), at: d.at,
      cpu: { loadPct: num(d.cpu?.loadPct), tempC: num(d.cpu?.tempC) },
      gpu: d.gpu ? { name: d.gpu.name ? String(d.gpu.name).slice(0, 80) : null, loadPct: num(d.gpu.loadPct), tempC: num(d.gpu.tempC), vramUsedMb: num(d.gpu.vramUsedMb), vramTotalMb: num(d.gpu.vramTotalMb) } : null,
      ramUsedPct: num(d.ramUsedPct), fps: num(d.fps),
      usage: (Array.isArray(d.usage) ? d.usage : []).slice(0, 12).map((u) => ({ provider: String(u.provider ?? '').slice(0, 20), usedPct: num(u.usedPct), resetAt: u.resetAt ?? null, plan: u.plan ? String(u.plan).slice(0, 30) : null }))
    };
  } catch { return null; }
}
