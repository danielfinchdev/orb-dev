// 3.8.10: a short run of the endurance script (scripts/aguante.mjs): the real engine, two simulated phones behind a TCP
// proxy, cuts of every kind and an engine restart; nothing may be lost, duplicated or executed twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

test('aguante corto: cortes y un reinicio del motor sin perder, duplicar ni ejecutar dos veces', { timeout: 420_000 }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-aguante-test-'));
  try {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'aguante.mjs'), '--minutes', '2.5', '--cut-every', '9', '--long-stall-every', '6',
      '--msg-every', '1.5', '--sample-every', '20', '--call-timeout', '6', '--approval-every', '25', '--out', out], { encoding: 'utf8', timeout: 400_000, windowsHide: true });
    const result = JSON.parse(fs.readFileSync(path.join(out, 'resumen.json'), 'utf8'));
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.equal(result.events.lost, 0);
    assert.equal(result.events.duplicates, 0);
    assert.equal(result.calls.doubles, 0);
    assert.equal(result.calls.okNotExecuted, 0);
    assert.equal(result.violations, 0);
    assert.ok(result.engineRestarts >= 1, 'hubo un reinicio');
    assert.ok(result.calls.logical > 20 && result.phones.every((p) => p.reconnects >= 1), 'hubo tráfico y reconexiones');
    assert.ok(result.phones.some((p) => p.calls.resent > 0), 'hubo reenvíos con el mismo nonce');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
