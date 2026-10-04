// Exploratory pass over the PACKAGED app (no agents needed): the welcome screen, every view in day and night, a narrow
// window and the settings' switches and checks, with screenshots in test-results/explora/ and the page errors collected.
// Not an assertion test: it is for looking at.   ORB_E2E_EXE=dist/win-unpacked/Orb.dev.exe node test/explora.e2e.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/core/home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.ORB_E2E_EXE; // optional: a packaged build instead of the sources
const electronBin = (await import('electron')).default;
const OUT = path.join(ROOT, 'test-results', 'explora'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-explora-'));
const until = async (fn, what, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error(`no llegó: ${what}`); };
const notes = [];
const note = (s) => { notes.push(s); console.log(`  · ${s}`); };

async function open(userData) {
  const app = await electron.launch({ executablePath: exe || electronBin, args: exe ? [] : [ROOT], env: { ...process.env, ORB_USER_DATA: userData } });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  const close = async () => { await app.close().catch(() => {}); };
  return { app, page, errors, close };
}
// The window's own capture (what the user sees, with the interface zoom and the screen scaling).
const shooter = (app, page) => async (name) => {
  await page.waitForTimeout(500);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html')).webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png, 'base64'));
};

try {
  // ---- 1. a brand-new PC: the welcome screen
  {
    const userData = path.join(tmp, 'nuevo'); fs.mkdirSync(userData);
    const { app, page, errors, close } = await open(userData);
    const shot = shooter(app, page);
    await page.waitForSelector('text=Crear y empezar');
    note(`ventana inicial: ${(await page.evaluate(() => [innerWidth, innerHeight])).join('x')}`);
    await shot('00-bienvenida');
    note(`errores en bienvenida: ${errors.join(' | ') || 'ninguno'}`);
    await close();
  }

  // ---- 2. an assistant already created: every view
  const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
  const { home } = createHome(base, { assistantName: 'Orb', userName: 'Dani' });
  fs.mkdirSync(path.join(home, 'webviaproject', 'src'), { recursive: true });
  fs.writeFileSync(path.join(home, 'webviaproject', 'src', 'index.html'), '<h1>hola</h1>\n');
  const userData = path.join(tmp, 'datos'); fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
  const { app, page, errors, close } = await open(userData);
  const shot = shooter(app, page);
  const call = (method, params = {}) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
  await page.waitForSelector('text=Soy Orb', { timeout: 30000 });
  if (await page.isVisible('text=Preparo tu equipo')) { await shot('01-preparo-equipo'); await page.click('text=Continuar'); }
  const dark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
  const views = [['nav-chat', 'chat'], ['nav-tasks', 'tareas'], ['nav-projects', 'proyectos'], ['nav-agents', 'agentes'], ['nav-logs', 'bitacoras'], ['nav-activity', 'actividad'], ['nav-settings', 'ajustes']];
  for (const theme of ['dia', 'noche']) {
    if ((theme === 'noche') !== (await dark())) await page.getByRole('button', { name: 'Cambiar entre día y noche' }).click();
    for (const [nav, name] of views) {
      await page.click(`[data-testid=${nav}]`);
      await shot(`${theme}-${name}`);
      if (theme === 'dia') {
        const wide = await page.evaluate(() => [...document.querySelectorAll('main *, [data-slot=scroll-area-viewport] *')].filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'visible' && e.clientWidth > 0).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 70)} ${e.scrollWidth}>${e.clientWidth}`));
        if (wide.length) note(`${name}: contenido más ancho que su caja → ${wide.join(' | ')}`);
      }
      if (name === 'ajustes') {
        // the whole settings page, scrolled
        for (let i = 1; i <= 6; i++) {
          const moved = await page.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 300); if (!el) return false; const before = el.scrollTop; el.scrollTop += el.clientHeight * 0.85; return el.scrollTop !== before; });
          if (!moved) break;
          await shot(`${theme}-ajustes-${i}`);
        }
      }
    }
    // the dialogs and menus of the chat
    await page.click('[data-testid=nav-chat]');
    await page.click('[data-testid=project-picker]'); await shot(`${theme}-chat-menu-proyecto`); await page.keyboard.press('Escape');
    await page.click('[data-testid=new-conversation]').catch(() => note('sin botón nueva conversación visible'));
    await shot(`${theme}-nueva-conversacion`); await page.keyboard.press('Escape');
  }
  // checks and switches in the night theme: their computed colors
  await page.click('[data-testid=nav-settings]');
  const controls = await page.evaluate(() => [...document.querySelectorAll('button[role=checkbox],button[role=switch]')].slice(0, 12).map((b) => {
    const cs = getComputedStyle(b); const label = (b.closest('label,div')?.innerText ?? '').split('\n')[0].slice(0, 40);
    return `${b.getAttribute('role')} ${b.dataset.state} bg=${cs.backgroundColor} border=${cs.borderColor} color=${cs.color} «${label}»`;
  }));
  note(`controles en noche:\n    ${controls.join('\n    ')}`);

  // ---- 3. narrow window and a small laptop height
  for (const [w, h, name] of [[420, 860, 'estrecha'], [1280, 640, 'portatil-bajo']]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('index.html')).setContentSize(w, h), [w, h]);
    for (const [nav, view] of [['nav-chat', 'chat'], ['nav-settings', 'ajustes']]) {
      if (w < 700) { await page.getByRole('button', { name: 'Menú' }).click(); await page.locator(`[data-testid=${nav}]:visible`).click(); } else await page.click(`[data-testid=${nav}]`);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (sw > iw + 1) note(`${name}/${view}: se sale por los lados (${sw} > ${iw})`);
      await shot(`${name}-${view}`);
    }
  }
  const state = await call('app.state');
  note(`versión ${state.version}, agentes: ${(await call('agents.status')).map((a) => `${a.id}=${a.installed ? 'instalado' : 'no'}/${a.login ?? '?'}`).join(', ')}`);
  note(`errores de la página: ${errors.join(' | ') || 'ninguno'}`);
  await close();
} catch (error) {
  console.error(`✖ ${error.stack}`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'notas.txt'), notes.join('\n'));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
