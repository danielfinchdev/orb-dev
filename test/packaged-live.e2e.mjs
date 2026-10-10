// The PACKAGED app with a real agent: the live engine (Claude Agent SDK inside app.asar.unpacked) starts, a conversation
// streams an answer and a second turn continues it. Uses the user's Claude Code login (Haiku, a tiny task).
//   ORB_E2E_EXE=dist/win-unpacked/Orb.exe node test/packaged-live.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHome } from '../src/core/home.mjs';

const exe = process.env.ORB_E2E_EXE;
if (!exe || !fs.existsSync(exe)) { console.error('ORB_E2E_EXE debe apuntar a la app empaquetada'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-empaquetada-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { assistantName: 'Orb', userName: 'Dani' });
const userData = path.join(tmp, 'datos'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
const port = 9300 + Math.floor(Math.random() * 500);
const app = spawn(exe, [`--remote-debugging-port=${port}`], { env: { ...process.env, ORB_USER_DATA: userData }, stdio: 'ignore' });
const until = async (fn, what, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error(`no llegó: ${what}`); };
let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana', 60000);
  const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith('index.html')), 'la página', 60000);
  await page.waitForSelector('text=Soy Orb', { timeout: 60000 });
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
  await browser?.close().catch(() => {});
  try { spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* in use */ } }, 2000);
}
