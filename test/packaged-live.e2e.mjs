// The built Orb with a real agent: the live engine (the Claude Agent SDK in Orb's own app\src, run by its bundled node)
// starts, a conversation streams an answer and a second turn continues it. Uses the user's Claude Code login (Haiku, a
// tiny task): only by hand on the owner's PC. On the test build of Orb, hidden (test/fixtures/launch-orb.mjs):
//   npm run tauri:build:e2e && node test/packaged-live.e2e.mjs [--exe <Orb.exe of a test build>]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHome, loadConfig, writeJson, merge } from '../src/core/home.mjs';
import { throughStart, sandboxEnv } from './fixtures/e2e-flows.mjs';
import { launchOrb } from './fixtures/launch-orb.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-empaquetada-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { assistantName: 'Orb', userName: 'Alex' });
writeJson(path.join(home, 'core', 'orb.json'), merge(loadConfig(home), { ui: { tourDone: true } })); // 2.6: no guided tour in the tests
const userData = path.join(tmp, 'datos'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
const until = async (fn, what, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error(`no llegó: ${what}`); };
let orb;
try {
  orb = await launchOrb({ userData, env: sandboxEnv(tmp) });
  const page = orb.page;
  // 3.8: a folder made before the first start has no master password yet: «Crea tu contraseña maestra» once.
  await throughStart(page, { ready: '[data-testid=chat-greeting]', timeout: 90000 });
  const call = (method, params = {}) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
  const project = await call('projects.create', { name: 'empaquetada' });
  const s = await call('sessions.create', { agent: 'claude', project: project.name, model: 'haiku', permission: 'editar', title: 'Empaquetada' });
  const deltas = []; await page.exposeFunction('__delta', (d) => deltas.push(d));
  await page.evaluate(() => window.orb.on('session:delta', (d) => window.__delta(d.text)));
  const t0 = Date.now();
  await call('sessions.send', { id: s.id, text: 'Crea hola.txt con el texto "hola". Responde solo "listo".' });
  await until(async () => (await call('sessions.list')).find((x) => x.id === s.id)?.status === 'idle' && (await call('sessions.items', { id: s.id })).some((i) => i.role === 'assistant'), 'primer turno');
  const t1 = Date.now();
  await call('sessions.send', { id: s.id, text: '¿Qué archivo has creado? Solo el nombre.' });
  await until(async () => (await call('sessions.items', { id: s.id })).filter((i) => i.role === 'assistant' && i.kind === 'text').length >= 2 && (await call('sessions.list')).find((x) => x.id === s.id)?.status === 'idle', 'segundo turno');
  const said = (await call('sessions.items', { id: s.id })).filter((i) => i.role === 'assistant' && i.kind === 'text').map((i) => i.body);
  assert.ok(fs.existsSync(path.join(home, 'web', 'empaquetada', 'hola.txt')), 'creó hola.txt');
  assert.match(said.at(-1), /hola\.txt/i);
  console.log(`✔ empaquetada en vivo: turno 1 ${Math.round((t1 - t0) / 1000)} s, turno 2 ${Math.round((Date.now() - t1) / 1000)} s, ${deltas.length} trozos en streaming, dice ${JSON.stringify(said)}`);
} catch (error) {
  console.error(`✖ ${error.stack}`);
  process.exitCode = 1;
} finally {
  await orb?.close().catch(() => {});
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* in use */ } }, 2000);
}
