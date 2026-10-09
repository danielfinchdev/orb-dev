// Electron main process: one window, the first-run setup, the engine process and a narrow, checked bridge between them.
// The window has no Node access (sandbox + context isolation); it can only call the engine's actions and a few
// file dialogs exposed by the preload script.
import { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu, protocol, net, utilityProcess, session, nativeTheme, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHome, isHome, loadConfig, writeJson } from '../core/home.mjs';
import { createAgentBrowser } from './browser.mjs';
import { openTerminal } from './terminal.mjs';
import { createUpdater, RELEASES_URL } from './updater.mjs';
import { PRODUCT } from '../core/product.mjs';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Packaged: the code lives in app.asar.unpacked (agents start the MCP server from there with the app's own executable).
const UNPACKED = SRC.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const RENDERER = path.join(SRC, 'renderer');
const VERSION = app.getVersion();
const LOCATION = () => path.join(app.getPath('userData'), 'ubicacion.json');
// Size of the interface on this PC (Ajustes → Interfaz, Ctrl + / Ctrl - / Ctrl 0, Ctrl + rueda). 1 = «Normal», which is a
// bit bigger than Chromium's 100% (the first version looked too small on Windows). Kept per PC, also before the setup.
const INTERFACE = () => path.join(app.getPath('userData'), 'interfaz.json');
const ZOOM_BASE = 1.15; const ZOOM_MIN = 0.6; const ZOOM_MAX = 1.8; const ZOOM_STEP = 0.1;
const isDev = !app.isPackaged;

// ORB_USER_DATA: separate app data (tests, or a portable copy that keeps everything next to it). Otherwise the folder that
// versions up to 2.3.3 used (%APPDATA%\Orb.dev), although the program is now called Orb.
app.setPath('userData', process.env.ORB_USER_DATA || path.join(app.getPath('appData'), PRODUCT.dataDir));
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId(PRODUCT.appId);

protocol.registerSchemesAsPrivileged([{ scheme: 'orb', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win = null;
let quitting = false;
let engine = null;
let engineReady = null; // promise of the engine start
let home = null;
let nextId = 0;
const pending = new Map();
let agentBrowser = null; // the agents' browser and its little floating window (created when the app is ready)
// New versions from GitHub Releases (src/main/updater.mjs); the window gets the state as the 'app:update' event.
const updater = createUpdater({ send: (state) => { if (win && !win.isDestroyed()) win.webContents.send('engine:event', 'app:update', state); }, log: (line) => console.log(line) });
const config = () => { try { return loadConfig(home); } catch { return null; } };

function readLocation() {
  try { const h = JSON.parse(fs.readFileSync(LOCATION(), 'utf8')).home; return h && isHome(h) ? h : null; } catch { return null; }
}
function saveLocation(h) { fs.mkdirSync(path.dirname(LOCATION()), { recursive: true }); writeJson(LOCATION(), { home: h }); }

let zoom = 1;
function readZoom() { try { const z = Number(JSON.parse(fs.readFileSync(INTERFACE(), 'utf8')).zoom); return Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) : 1; } catch { return 1; } }
function setZoom(next) {
  zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(next) || 1)) * 100) / 100;
  if (win && !win.isDestroyed()) { win.webContents.setZoomFactor(zoom * ZOOM_BASE); win.webContents.send('engine:event', 'ui:zoom', { zoom }); }
  try { fs.mkdirSync(path.dirname(INTERFACE()), { recursive: true }); writeJson(INTERFACE(), { zoom }); } catch { /* only this session */ }
  return zoom;
}
// Ctrl and the key, whatever the keyboard: «+» has its own key on a Spanish one, «=» shares it on an English one, and the
// number pad has its own. Handled here (not with menu accelerators, which miss some of these on Windows).
function zoomKey(input) {
  if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return null;
  if (['+', '=', 'Add'].includes(input.key) || input.code === 'NumpadAdd') return 'in';
  if (['-', '_', 'Subtract'].includes(input.key) || input.code === 'NumpadSubtract') return 'out';
  if (input.key === '0' || input.code === 'Numpad0' || input.code === 'Digit0') return 'reset';
  return null;
}
const zoomBy = (dir) => setZoom(dir === 'reset' ? 1 : zoom + (dir === 'in' ? ZOOM_STEP : -ZOOM_STEP));

// The approval secret, encrypted by Windows (DPAPI via safeStorage) in .orb/datos/clave.enc. The plain clave.bin that the
// first run writes is converted and removed, so no agent can read the secret from disk. Returns the secret as hex, or null
// when encryption is not available (then the engine uses clave.bin).
function approvalSecret(h) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const dir = path.join(h, '.orb', 'datos');
  const enc = path.join(dir, 'clave.enc'); const plain = path.join(dir, 'clave.bin');
  try {
    if (fs.existsSync(enc)) {
      const hex = safeStorage.decryptString(fs.readFileSync(enc));
      if (/^[0-9a-f]{64}$/.test(hex)) { fs.rmSync(plain, { force: true }); return hex; }
    }
  } catch { /* another Windows user or another PC: a new secret (old approvals are asked again) */ }
  let hex; try { const b = fs.readFileSync(plain); hex = b.length >= 32 ? b.subarray(0, 32).toString('hex') : null; } catch { hex = null; }
  hex ??= crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(enc, safeStorage.encryptString(hex));
  fs.rmSync(plain, { force: true });
  return hex;
}

let restarts = 0;
function startEngine(h) {
  if (engine) return engineReady;
  home = h;
  engine = utilityProcess.fork(path.join(UNPACKED, 'engine', 'engine.mjs'), [], {
    serviceName: `Motor de ${PRODUCT.name}`, stdio: 'pipe',
    env: { ...process.env, ORB_MCP_SCRIPT: path.join(UNPACKED, 'mcp', 'server.mjs') }
  });
  const logFile = path.join(h, '.orb', 'ejecuciones', 'motor-salida.log');
  const append = (chunk) => { try { fs.appendFileSync(logFile, chunk); } catch { /* ignore */ } };
  engine.stdout?.on('data', append); engine.stderr?.on('data', append);
  engineReady = new Promise((resolve, reject) => {
    engine.on('message', (msg) => {
      if (msg?.type === 'started') return msg.ok ? resolve(msg.result) : reject(new Error(msg.error));
      if (msg?.type === 'reply') { const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); clearTimeout(p.timer); return msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error)); }
      if (msg?.type === 'event') onEngineEvent(msg.event, msg.payload);
    });
    engine.on('exit', (code) => {
      engine = null; engineReady = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('el motor se ha detenido')); }
      pending.clear();
      if (quitting) return;
      reject(new Error('el motor se detuvo al arrancar'));
      // A crash of the engine is not the end of the app: it is started again (at most 3 times per session).
      if (restarts < 3) { restarts++; setTimeout(() => { startEngine(h).then(() => win?.webContents.send('engine:event', 'engine:restarted', { code })).catch(() => {}); }, 1000); }
      else win?.webContents.send('engine:event', 'engine:stopped', { code });
    });
  });
  let secret = null; try { secret = approvalSecret(h); } catch { /* falls back to the file */ }
  const browser = agentBrowser ? { pipe: agentBrowser.pipe, token: agentBrowser.token } : null;
  engine.postMessage({ type: 'start', home: h, version: VERSION, secret, browser });
  return engineReady;
}

function callEngine(method, params, timeoutMs = 10 * 60_000) {
  if (!engine) return Promise.reject(new Error('el motor no está en marcha'));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('el motor no respondió a tiempo')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    engine.postMessage({ type: 'call', id, method, params });
  });
}

function onEngineEvent(event, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('engine:event', event, payload);
  // Notices while the window is in the background: finished tasks, approvals, the assistant's answers.
  if (event === 'chat:new' && !win.isFocused() && Notification.isSupported()) {
    let name = PRODUCT.name; try { name = loadConfig(home).assistantName; } catch { /* default */ }
    const n = new Notification({ icon: path.join(SRC, '..', 'build', 'icon.png'), title: payload.role === 'orb' ? name : `${name} · aviso`, body: String(payload.body ?? '').slice(0, 240), silent: false });
    n.on('click', () => { win.show(); win.focus(); win.webContents.send('engine:event', 'ui:navigate', { view: 'chat' }); });
    n.show();
  }
}

// Only our own page may use the bridge.
const fromApp = (event) => {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith('orb://app/') && event.sender === win?.webContents;
};
const guard = (fn) => async (event, ...args) => { if (!fromApp(event)) throw new Error('origen no permitido'); return fn(...args); };

const ENGINE_METHOD = /^[a-z]+\.[A-Za-z]+$/;
ipcMain.handle('engine:call', guard(async (method, params) => {
  if (typeof method !== 'string' || !ENGINE_METHOD.test(method)) throw new Error('acción no válida');
  await engineReady;
  return callEngine(method, params ?? {});
}));

ipcMain.handle('app:zoom', guard(async (value) => (value === undefined || value === null ? zoom : setZoom(value))));
// Ctrl+J: a terminal (Warp, Windows Terminal, PowerShell…) in the folder the window is showing.
ipcMain.handle('app:openTerminal', guard(async (target) => {
  const dir = typeof target === 'string' && path.isAbsolute(target) ? target : home;
  if (!dir) throw new Error('todavía no hay carpeta');
  return openTerminal(dir, config()?.ui?.terminal ?? 'auto', { openExternal: (url) => shell.openExternal(url) });
}));
ipcMain.handle('app:showBrowser', guard(async () => { agentBrowser?.show(); return agentBrowser?.state() ?? null; }));
ipcMain.handle('app:info', guard(async () => ({ version: VERSION, home, needsSetup: !home, platform: process.platform, defaultBase: app.getPath('documents') })));

ipcMain.handle('app:pickFolder', guard(async (title) => {
  const r = await dialog.showOpenDialog(win, { title: String(title ?? 'Elige una carpeta').slice(0, 100), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}));
ipcMain.handle('app:pickImages', guard(async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Imágenes de referencia', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] });
  return r.canceled ? [] : r.filePaths.slice(0, 10);
}));
ipcMain.handle('app:openPath', guard(async (target) => {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('ruta no válida');
  let st; try { st = fs.statSync(target); } catch { throw new Error('la carpeta no existe'); }
  if (!st.isDirectory()) throw new Error('solo se abren carpetas'); // never run a file
  const err = await shell.openPath(target); if (err) throw new Error(err);
  return true;
}));
ipcMain.handle('app:openExternal', guard(async (url) => {
  let u; try { u = new URL(String(url)); } catch { throw new Error('enlace no válido'); }
  if (u.protocol !== 'https:') throw new Error('solo se abren enlaces https');
  await shell.openExternal(u.toString());
  return true;
}));
// Updates: state, check now, download, and restart into the new version (asking first if tasks are running).
ipcMain.handle('app:update', guard(async () => updater.get()));
ipcMain.handle('app:updateCheck', guard(async () => updater.check()));
ipcMain.handle('app:updateDownload', guard(async () => updater.download()));
ipcMain.handle('app:updateInstall', guard(async () => {
  if (updater.get().portable) { await shell.openExternal(RELEASES_URL); return false; }
  if (updater.get().state !== 'downloaded') return false;
  let running = 0; try { running = engine ? (await callEngine('app.state', {}, 5000)).counts?.running ?? 0 : 0; } catch { /* updating anyway */ }
  if (running) {
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Actualizar igualmente', 'Cancelar'], defaultId: 1, cancelId: 1, title: 'Hay tareas en marcha', message: `Hay ${running} tarea(s) trabajando. Si actualizas ahora, se detienen y quedarán como fallidas (podrás reintentarlas).` });
    if (r.response !== 0) return false;
  }
  quitting = true; agentBrowser?.shutdown(); try { engine?.postMessage({ type: 'shutdown' }); } catch { /* gone */ }
  return updater.install();
}));
// First run: creates <base>/<name> (or reuses an existing assistant folder), remembers it and starts the engine.
ipcMain.handle('app:setup', guard(async ({ base, assistantName, userName } = {}) => {
  if (home) throw new Error('ya está configurado');
  const { home: h } = createHome(String(base ?? ''), { assistantName: String(assistantName ?? PRODUCT.assistant), userName: String(userName ?? '') });
  saveLocation(h);
  await startEngine(h);
  setTitle();
  return { home: h };
}));
// Moves to another assistant folder (restart of the engine with the new one).
ipcMain.handle('app:switchHome', guard(async (target) => {
  if (typeof target !== 'string' || !isHome(target)) throw new Error('esa carpeta no es la de un asistente (falta orb.json)');
  saveLocation(target);
  quitting = true; agentBrowser?.shutdown(); try { engine?.postMessage({ type: 'shutdown' }); } catch { /* gone */ }
  app.relaunch(); app.exit(0);
}));

function setTitle() { try { win?.setTitle(home ? loadConfig(home).assistantName : PRODUCT.name); } catch { /* keep */ } }

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 400, minHeight: 560, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#16151d' : '#fbfbfe', title: PRODUCT.name,
    icon: path.join(SRC, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(SRC, 'main', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true, devTools: isDev || process.env.ORB_DEVTOOLS === '1' }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(zoom * ZOOM_BASE));
  win.webContents.on('before-input-event', (e, input) => { const dir = zoomKey(input); if (dir) { e.preventDefault(); zoomBy(dir); } });
  win.webContents.on('zoom-changed', (_e, dir) => zoomBy(dir)); // Ctrl + mouse wheel
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('orb://app/')) e.preventDefault(); });
  win.on('close', async (e) => {
    if (quitting || !engine) return;
    e.preventDefault();
    let running = 0; try { running = (await callEngine('app.state', {}, 5000)).counts?.running ?? 0; } catch { /* closing anyway */ }
    if (running) {
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cerrar igualmente', 'Cancelar'], defaultId: 1, cancelId: 1, title: 'Hay tareas en marcha', message: `Hay ${running} tarea(s) trabajando. Si cierras, se detienen y quedarán como fallidas (podrás reintentarlas).` });
      if (r.response !== 0) return;
    }
    quitting = true; app.quit();
  });
  // The agents' browser keeps hidden windows: when the app's window goes, the app goes with it.
  win.on('closed', () => { win = null; quitting = true; app.quit(); });
  win.loadURL('orb://app/index.html');
  setTitle();
}

app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { quitting = true; agentBrowser?.shutdown(); try { engine?.postMessage({ type: 'shutdown' }); } catch { /* gone */ } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  // Our pages come from orb://app/ (only files inside src/renderer); nothing else is served.
  protocol.handle('orb', (request) => {
    const url = new URL(request.url);
    const file = path.normalize(path.join(RENDERER, decodeURIComponent(url.pathname)));
    // orb://pip/ is the same files for the little window: another host, so Chromium keeps its zoom apart from the app's.
    if (!['app', 'pip'].includes(url.host) || !file.startsWith(RENDERER + path.sep)) return new Response('no encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // The window never needs the camera, the microphone, notifications from the page, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"] } });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Archivo', submenu: [{ role: 'quit', label: 'Salir' }] },
    { label: 'Edición', submenu: [{ role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' }, { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' }] },
    // The keys themselves are handled in before-input-event (any keyboard); the menu only shows them.
    { label: 'Ver', submenu: [{ label: 'Tamaño normal', accelerator: 'CommandOrControl+0', registerAccelerator: false, click: () => zoomBy('reset') }, { label: 'Aumentar', accelerator: 'CommandOrControl+Plus', registerAccelerator: false, click: () => zoomBy('in') }, { label: 'Reducir', accelerator: 'CommandOrControl+-', registerAccelerator: false, click: () => zoomBy('out') }, { type: 'separator' }, { label: 'Abrir terminal', accelerator: 'CommandOrControl+J', registerAccelerator: false, click: () => win?.webContents.send('engine:event', 'ui:terminal', {}) }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Pantalla completa' }, ...(isDev ? [{ role: 'toggleDevTools' }] : [])] }
  ]));
  // The agents' browser: pages drawn off screen and the little window in the top-right corner (ui.pip turns it off).
  try {
    agentBrowser = createAgentBrowser({
      pipUrl: 'orb://pip/pip.html', pipPreload: path.join(SRC, 'main', 'pip-preload.cjs'), mainWindow: () => win, language: () => config()?.language ?? 'es',
      pipEnabled: () => config()?.ui?.pip !== false && config()?.browser?.enabled !== false,
      label: (agent) => (agent === 'orb' ? config()?.assistantName ?? PRODUCT.assistant : { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' }[agent] ?? agent)
    });
    await agentBrowser.ready;
  } catch (error) { agentBrowser = null; console.error(`navegador del agente: ${error.message}`); }
  zoom = readZoom();
  const h = readLocation();
  if (h) startEngine(h).catch((error) => dialog.showErrorBox(`${PRODUCT.name} no pudo arrancar`, error.message));
  createWindow();
  updater.start();
});
