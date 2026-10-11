// Orb Light (2.7.3): the portable .exe shows the essentials only. Opened from the code with ORB_LIGHT=1 (the same flag
// the portable sets), with God mode, PC Status and a theme turned on in its orb.json, none of them shows up: no mini-games,
// no God mode nor PC Status (menu, screens and Ajustes), no theme picker and the default theme; chat, tasks, projects,
// whiteboard, agents and the rest stay. Run: npm run build && node test/light.e2e.mjs
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHome, loadConfig, writeJson, merge } from '../src/core/home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-light-'));
const { home } = createHome(tmp, { assistantName: 'Orb', userName: 'Ana' });
writeJson(path.join(home, 'orb.json'), merge(loadConfig(home), { ui: { tourDone: true, skin: 'vaporwave' }, expert: { enabled: true }, monitor: { enabled: true } }));
const userData = path.join(tmp, 'datos-app'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
const electronBin = (await import('electron')).default;
const app = await electron.launch({ executablePath: electronBin, args: [ROOT, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, ORB_LIGHT: '1', ORB_NO_BRIDGE: '1', ORB_NO_UPDATE: '1', ORB_USER_DATA: userData, ORB_FAKE_AGENTS: path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs') } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.setViewportSize({ width: 1360, height: 860 });
const count = (sel) => win.locator(sel).count();
try {
  await win.locator('[data-testid=nav-chat]').waitFor({ timeout: 30000 });
  assert.equal(await win.evaluate(() => window.orb.light), true, 'la ventana sabe que es Orb Light');
  for (const id of ['nav-chat', 'nav-tasks', 'nav-projects', 'nav-schedules', 'nav-board', 'nav-agents', 'nav-logs', 'nav-activity', 'nav-tutorials', 'nav-settings']) assert.equal(await count(`[data-testid=${id}]`), 1, `${id} sigue`);
  assert.equal(await count('[data-testid=nav-expert]'), 0, 'sin God mode en el menú');
  assert.equal(await count('[data-testid=nav-monitor]'), 0, 'sin Monitoreo en el menú');
  assert.equal(await count('[data-testid=bar-games]'), 0, 'sin minijuegos en la barra del chat');
  assert.equal(await win.evaluate(() => document.documentElement.dataset.skin ?? document.documentElement.getAttribute('data-skin')), 'orb', 'siempre el tema por defecto');
  await win.click('[data-testid=nav-settings]');
  await win.locator('[data-testid=settings-dialog]').waitFor();
  assert.equal(await count('[data-testid=settings-nav-experto]'), 0, 'Ajustes sin God mode');
  assert.equal(await count('[data-testid=settings-nav-monitor]'), 0, 'Ajustes sin Monitoreo');
  await win.click('[data-testid=settings-nav-apariencia]');
  assert.equal(await count('[data-testid=skin-picker]'), 0, 'sin selector de temas');
  await win.screenshot({ path: path.join(OUT, 'light-ajustes.png') });
  await win.keyboard.press('Escape');
  await win.click('[data-testid=nav-tutorials]');
  await win.waitForSelector('text=Preguntas frecuentes');
  assert.equal(await count('text=Minijuegos'), 0, 'Tutoriales sin minijuegos');
  await win.screenshot({ path: path.join(OUT, 'light-tutoriales.png') });
  assert.deepEqual(errors, [], 'sin errores en la ventana');
  console.log('✔ Orb Light: solo lo esencial (sin minijuegos, God mode, Monitoreo ni temas)');
} finally { await app.close().catch(() => {}); fs.rmSync(tmp, { recursive: true, force: true }); }
