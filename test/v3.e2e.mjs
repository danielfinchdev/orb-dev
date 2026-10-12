// Orb 3.0 in the real window (fake agents): no «Orbe» item, the robot at the top goes back to the conversation, «Nuevo
// chat» starts a clean one and the previous one is still there (3.2: in the menu), «Iniciar test» on the first opening of
// the day, direct conversations with an agent with «Orquestador» off (several at once), Security Review in Proyectos and
// the corner robot out of sight until the pointer comes near. Run: npm run build && node test/v3.e2e.mjs (screenshots in test-results/).
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHome, loadConfig, writeJson, merge } from '../src/core/home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-v3-'));
const { home } = createHome(tmp, { assistantName: 'Orb', userName: 'Ana' });
writeJson(path.join(home, 'orb.json'), merge(loadConfig(home), { ui: { tourDone: true } }));
fs.mkdirSync(path.join(home, 'web', 'tienda'), { recursive: true });
const userData = path.join(tmp, 'datos-app'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
const electronBin = (await import('electron')).default;
const app = await electron.launch({ executablePath: electronBin, args: [ROOT, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, ORB_NO_BRIDGE: '1', ORB_NO_UPDATE: '1', ORB_USER_DATA: userData, ORB_FAKE_AGENTS: path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs') } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.setViewportSize({ width: 1360, height: 860 });
const call = (method, params = {}) => win.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
const count = (sel) => win.locator(sel).count();
const shot = (name) => win.screenshot({ path: path.join(OUT, `v3-${name}.png`) });
const until = async (fn, what, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await win.waitForTimeout(200); } throw new Error(`no llegó: ${what}`); };
let step = 'inicio';
try {
  step = 'menú sin «Orbe»';
  await win.locator('[data-testid=new-conversation]').waitFor({ timeout: 30000 });
  assert.equal(await count('[data-testid=nav-chat]'), 0, 'ya no hay elemento «Orbe» en el menú');
  assert.equal(await count('[data-testid=sidebar-home]'), 1, 'el robot de arriba vuelve a la conversación');
  assert.equal(await count('[data-testid=new-task]'), 0, 'con el Orquestador activado, solo «Nuevo chat»');

  step = 'Iniciar test';
  await win.locator('[data-testid=chat-test]').waitFor({ timeout: 10000 });
  await shot('01-chat-test');

  step = 'conversación y Nuevo chat';
  await win.fill('[data-testid=chat-input]', 'Hola, ¿qué tal?');
  await win.keyboard.press('Enter');
  // 3.2: the first message makes a conversation of its own, and the screen is that conversation.
  const first = await until(async () => (await call('conversations.list'))[0], 'conversación creada');
  await until(async () => (await call('chat.list', { conversation: first.id })).some((m) => m.role === 'orb'), 'respuesta del asistente');
  await win.locator('[data-testid=bar-title]').waitFor();
  assert.equal(await count('[data-testid=chat-test]'), 0, 'tras hablar con Orb, el botón de test se va');
  await win.click('[data-testid=nav-tasks]');
  await win.click('[data-testid=sidebar-home]');
  await until(async () => (await win.locator('text=Hola, ¿qué tal?').count()) > 0, 'el robot de arriba vuelve a la misma conversación');
  await win.click('[data-testid=new-conversation]');
  await win.locator('[data-testid=chat-greeting]').waitFor();
  assert.equal(await win.locator('[data-testid=chat-lines] >> text=Hola, ¿qué tal?').count(), 0, 'Nuevo chat empieza una conversación limpia');
  assert.equal(await count('[data-testid=chat-older]'), 0, 'sin «Ver conversación anterior»: cada una está en el menú');
  await win.click(`[data-testid=item-c${first.id}]`);
  await win.locator('text=Hola, ¿qué tal?').waitFor();
  await shot('02-conversaciones');

  step = 'conversaciones directas';
  // 3.2: with «Orquestador» off the user talks directly to the agent chosen, in as many conversations at once as wanted.
  await win.click('[data-testid=new-conversation]');
  await win.click('[data-testid=orchestrator-check]');
  await win.getByRole('button', { name: 'Hablar directamente' }).click();
  await until(async () => (await call('app.state')).config.orchestrator.orchestrate === false, 'Orquestador desactivado');
  await call('projects.setActive', { name: 'tienda' });
  await until(async () => (await win.locator('[data-testid=project-picker]').innerText()).includes('tienda'), 'la carpeta elegida en el cuadro');
  for (const text of ['Revisa el README', 'Añade una página de contacto']) {
    await win.click('[data-testid=new-conversation]');
    await win.fill('[data-testid=chat-input]', text);
    await win.keyboard.press('Enter');
    await win.locator('[data-testid=session-input]').waitFor({ timeout: 15000 });
  }
  const direct = await until(async () => { const l = (await call('sessions.list')).filter((x) => x.kind === 'chat'); return l.length === 2 && l; }, 'dos conversaciones directas');
  assert.ok(direct.every((x) => x.project === 'tienda' && x.agent === 'claude'), `en el proyecto y con el agente elegidos: ${JSON.stringify(direct.map((x) => [x.project, x.agent, x.permission]))}`);
  assert.equal(await count('[data-testid=new-task]'), 0, 'un solo botón: «Nuevo chat»');
  await win.waitForTimeout(500);
  await shot('03-conversaciones-directas');
  await call('chat.settings', { orchestrate: true });

  step = 'Tareas sin botón Nueva tarea';
  await win.click('[data-testid=nav-tasks]');
  await win.waitForTimeout(300);
  assert.equal(await win.getByRole('button', { name: 'Nueva tarea', exact: true }).count(), 0, 'ya no hay «Nueva tarea»: se habla directamente con el agente');

  step = 'Security Review';
  await win.click('[data-testid=nav-projects]');
  await win.locator('[data-testid=project-security]').first().waitFor();
  await win.hover('[data-testid=project-security]');
  await win.locator('[data-testid=bubble-tip]:not([data-state=closed])').first().waitFor();
  await shot('05-security-review');
  await win.click('[data-testid=project-security]');
  await win.getByRole('button', { name: 'Solicitar Security Review' }).click();
  await until(async () => (await call('tasks.list')).some((x) => /^Security Review/.test(x.title) && x.readonly), 'tarea de Security Review en solo lectura');

  step = 'robot de la esquina';
  await win.click('[data-testid=nav-tasks]');
  await win.mouse.move(400, 300);
  await win.locator('[data-testid=companion]').waitFor({ timeout: 15000 }); // the robot of the notices has gone
  assert.equal(await win.locator('[data-testid=companion]').getAttribute('data-shown'), 'false', 'oculto lejos de la esquina');
  const size = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await win.mouse.move(size.w - 40, size.h - 40, { steps: 4 });
  await until(async () => (await win.locator('[data-testid=companion]').getAttribute('data-shown')) === 'true', 'aparece al acercar el ratón');
  await shot('06-robot-esquina');
  assert.deepEqual(errors, [], 'sin errores en la ventana');
  console.log('✔ Orb 3.0/3.2: conversaciones, conversaciones directas, Iniciar test, Security Review y robot de la esquina');
} catch (e) { await shot('fallo').catch(() => {}); console.error(`✖ ${step}: ${e.message}`); process.exitCode = 1; }
finally { await app.close().catch(() => {}); fs.rmSync(tmp, { recursive: true, force: true }); }
