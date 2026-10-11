// Puente con Open Control Edge (2.7): solo cuentan datos reales y frescos de una OCE abierta; lo viejo, lo roto o lo de un
// proceso cerrado no se muestra (nada inventado).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let dir; let readOce;
before(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-puente-')); process.env.LOCALAPPDATA = dir; ({ readOce } = await import('../src/engine/bridge.mjs')); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (data) => { fs.mkdirSync(path.join(dir, 'OrbPuente'), { recursive: true }); fs.writeFileSync(path.join(dir, 'OrbPuente', 'oce.json'), JSON.stringify(data)); };
const fresh = (extra = {}) => ({ schema: 1, app: 'OpenControlEdge', version: '2.3.0', pid: process.pid, at: new Date().toISOString(), cpu: { loadPct: 12.34, tempC: 61 }, gpu: { name: 'RTX', loadPct: 5, tempC: 48, vramUsedMb: 900, vramTotalMb: 8192 }, ramUsedPct: 70, fps: null, usage: [{ provider: 'claude', usedPct: 31, resetAt: null, plan: 'Max' }], ...extra });

test('Puente: lee lo fresco de una OCE abierta y descarta lo viejo, lo roto o lo de un proceso cerrado', () => {
  assert.equal(readOce(), null, 'sin archivo');
  write(fresh());
  const d = readOce();
  assert.equal(d.cpu.tempC, 61); assert.equal(d.cpu.loadPct, 12.3); assert.equal(d.fps, null, 'lo que no hay sigue siendo null');
  assert.equal(d.usage[0].provider, 'claude');
  write(fresh({ at: new Date(Date.now() - 60_000).toISOString() })); assert.equal(readOce(), null, 'viejo');
  write(fresh({ pid: 999999 })); assert.equal(readOce(), null, 'proceso cerrado');
  write(fresh({ schema: 2 })); assert.equal(readOce(), null, 'otro formato');
  fs.writeFileSync(path.join(dir, 'OrbPuente', 'oce.json'), '{roto'); assert.equal(readOce(), null, 'roto');
});
