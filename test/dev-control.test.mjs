// 3.1: the developer's control line of Orb.dev (src/engine/dev-control.mjs + scripts/orb-dev.mjs): only when asked for,
// only with its key, and it reaches the same API as the window (tasks, approvals, chat).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';

const t = tempHome();
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-control-')), 'control.json');
let engine; let off;
after(async () => { await engine?.stop(); await off?.stop(); t.cleanup(); });
const cli = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'orb-dev.mjs'), ...args], { env: { ...process.env, ORB_DEV_CONTROL_FILE: file }, encoding: 'utf8' });

test('sin ORB_DEV_CONTROL=1 no hay línea de control', async () => {
  const other = path.join(path.dirname(file), 'apagado.json');
  off = await startEngine(t.home, { env: { ORB_DEV_CONTROL_FILE: other } });
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(!fs.existsSync(other));
  await off.stop(); off = null;
});

test('con ella: estado, aprobar una tarea y la clave obligatoria', async () => {
  engine = await startEngine(t.home, { env: { ORB_DEV_CONTROL: '1', ORB_DEV_CONTROL_FILE: file } });
  await until(() => fs.existsSync(file), 'archivo de control');
  const pointer = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(!pointer.token && !JSON.stringify(pointer).includes('token'), 'el archivo de la carpeta temporal no lleva la clave');
  assert.match(pointer.keyFile, /[\\/]\.orb[\\/]datos[\\/]/, 'la clave vive en los datos privados de Orb');
  const { decide } = await import('../src/core/guard.mjs');
  assert.equal(decide({ tool: 'Read', paths: [pointer.keyFile], internalDir: path.join(t.home, '.orb') }).decision, 'deny', 'ningún agente puede leerla');
  const info = JSON.parse(fs.readFileSync(pointer.keyFile, 'utf8'));
  assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const odd = await fetch(`${info.url}/snapshot`, { headers: { authorization: `Bearer ${'ñ'.repeat(48)}` } });
  assert.equal(odd.status, 401, 'una clave rara no tumba la petición');
  const bad = await fetch(`${info.url}/snapshot`, { headers: { authorization: 'Bearer otra' } });
  assert.equal(bad.status, 401, 'sin la clave, nada');
  await engine.call('projects.create', { name: 'web' });
  await engine.call('projects.setActive', { name: 'web' });
  await engine.call('control.pause');
  const task = await engine.call('tasks.create', { project: 'web', title: 'Publicar la web', description: 'publica la web', agent: 'claude' });
  assert.equal(task.status, 'awaiting_approval');
  assert.match(cli('estado'), new RegExp(`#${task.id} awaiting_approval`));
  assert.match(cli('aprobar', String(task.id)), /aprobada/);
  assert.equal((await engine.call('tasks.get', { id: task.id })).status, 'queued');
  assert.match(cli('llamar', 'app.state'), /"home"/);
});
