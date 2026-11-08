// Electron main process: one window, the first-run setup, the engine process and a narrow, checked bridge between them.
// The window has no Node access (sandbox + context isolation); it can only call the engine's actions and a few
// file dialogs exposed by the preload script.
import { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu, protocol, net, utilityProcess, session, nativeTheme, safeStorage, nativeImage, powerMonitor } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHome, isHome, loadConfig, writeJson, paths, homeKey, oldHomeKey, LEGACY } from '../core/home.mjs';
import { createAgentBrowser } from './browser.mjs';
import { openTerminal } from './terminal.mjs';
import { findEditors, openInEditor, runAction } from './editors.mjs';
import { createUpdater, RELEASES_URL } from './updater.mjs';
import { MAX_IMAGES, captureWindow, readImage, sendFeedback, moreApps } from './feedback.mjs';
import { PRODUCT } from '../core/product.mjs';
import { translate } from '../core/i18n.mjs';
import { keyringWeak } from './linux.mjs';
import { loadApprovalSecret } from './approval-secret.mjs';
import { deletableFolder, folderInUse } from '../core/project-close.mjs';

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
// 2.7.3: the portable .exe is Orb Light: the essentials, like the phone (no mini-games, God mode, PC Status or themes).
// The installer is the whole app. ORB_LIGHT=1 shows it from the code too.
const LIGHT = Boolean(process.env.PORTABLE_EXECUTABLE_FILE) || process.env.ORB_LIGHT === '1';

// ORB_USER_DATA: separate app data (tests, or a portable copy that keeps everything next to it). Otherwise the folder that
// versions up to 2.3.3 used (%APPDATA%\Orb.dev), although the program is now called Orb.
app.setPath('userData', process.env.ORB_USER_DATA || path.join(app.getPath('appData'), PRODUCT.dataDir));
if (!app.requestSingleInstanceLock()) app.quit();
// Windows takes the taskbar icon from the Start menu shortcut with this id: running from the code (electron.exe, tests)
// uses its own id, or Windows may give the installed Orb Electron's icon.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? PRODUCT.appId : `${PRODUCT.appId}.dev`);
// The app's icon (window, notifications), read through Electron so it also works from inside app.asar (Linux notices get
// the picture itself: the notification service cannot open a file inside the package).
const ICON = path.join(SRC, '..', 'build', 'icon.png');
// 3.8.1: the window on Windows takes the .ico, whose 16–32 px images are the short «o•» (Alt+Tab, and the taskbar when no
// shortcut gives the icon: Orb Light, npm start); downscaled, the 512 px PNG would show the whole word unreadable.
const WINDOW_ICON = process.platform === 'win32' ? path.join(SRC, '..', 'build', 'icon.ico') : ICON;

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
// 3.6: a backup of the data before a new version installs (the engine makes it: src/engine/api-data.mjs).
const updater = createUpdater({ send: (state) => { if (win && !win.isDestroyed()) win.webContents.send('engine:event', 'app:update', state); }, log: (line) => console.log(line),
  beforeInstall: async () => { if (engine) await callEngine('backup.now', { kind: 'preupdate' }, 3 * 60_000); } });
// orb.json as the engine last saved it: read once and again after each config:changed (every save goes through the engine).
let cachedConfig = null;
const config = () => { if (!cachedConfig && home) { try { cachedConfig = loadConfig(home); } catch { /* unreadable: defaults */ } } return cachedConfig; };
// Texts in the language of the settings (Spanish before the first run, as in the window).
const langOf = (c) => (c?.language === 'en' ? 'en' : 'es');
const T = (key, vars) => translate(langOf(config()), key, vars);

// 3.8: a saved workspace whose core is gone is still this PC's workspace: the engine puts core back from the newest backup
// or the window says why it cannot (only a workspace folder that is gone altogether brings the welcome back).
function readLocation() {
  try { const h = JSON.parse(fs.readFileSync(LOCATION(), 'utf8')).home; return h && (isHome(h) || fs.existsSync(h)) ? h : null; } catch { return null; }
}
function saveLocation(h) { fs.mkdirSync(path.dirname(LOCATION()), { recursive: true }); writeJson(LOCATION(), { home: h }); }

// A fresh install (no saved location) on a PC that already has an Orb folder uses it as it is: <drive>:\Orb, Documents\Orb
// or <user>\Orb, the most recently used one if there are several. Nothing is created or overwritten. Not in tests or when
// running from the code (ORB_USER_DATA or not packaged), so they never pick up a real folder.
function findExistingHome() {
  if (!app.isPackaged || process.env.ORB_USER_DATA) return null;
  // Drive letters only exist on Windows; on Linux / macOS, Documents/Orb and ~/Orb.
  const drives = process.platform !== 'win32' ? [] : 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  const candidates = new Set([...drives.map((d) => path.join(d, PRODUCT.folder)), path.join(app.getPath('documents'), PRODUCT.folder), path.join(app.getPath('home'), PRODUCT.folder)]);
  const used = (h) => { for (const f of [paths(h).config, path.join(h, LEGACY.config)]) { try { return fs.statSync(f).mtimeMs; } catch { /* the other one */ } } return 0; };
  return [...candidates].filter((h) => isHome(h)).sort((a, b) => used(b) - used(a))[0] ?? null;
}

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

// 3.7, Linux: true when the desktop has no keyring (safeStorage would only use a fixed key): the window is told once.
let weakKeyring = false;
// The approval secret, encrypted by the system (Windows: DPAPI via safeStorage; Linux: the desktop's keyring) in
// core\datos\clave.enc. The plain clave.bin that the first run writes is converted and removed, so no agent can read the
// secret from disk. 3.8: a copy of clave.enc is kept outside the workspace (this app's data folder, one per workspace):
// the backups are sealed with this secret, so a core deleted by mistake can still be restored from them. A workspace of
// Orb 3.7 still has it in .orb\datos until the engine moves that folder into core (src/core/core-folder.mjs): read there
// and never written into core before the move. Returns the secret as hex, or null when encryption is not available
// (then the engine uses clave.bin).
const SECRET_COPY = (h) => path.join(app.getPath('userData'), 'claves', `${homeKey(h)}.enc`);
// 3.8: and of the master password's files (core\secretos: the data key wrapped, the secrets sealed), kept by the engine.
const SECRETS_COPY = (h) => path.join(app.getPath('userData'), 'claves', `${homeKey(h)}-secretos`);
// The first 3.8 builds named them after the workspace's whole path (home.mjs › oldHomeKey): taken over once.
function adoptOldKeyNames(h) {
  const dir = path.join(app.getPath('userData'), 'claves');
  for (const [from, to] of [[`${oldHomeKey(h)}.enc`, path.basename(SECRET_COPY(h))], [`${oldHomeKey(h)}-secretos`, path.basename(SECRETS_COPY(h))]]) {
    try { if (fs.existsSync(path.join(dir, from)) && !fs.existsSync(path.join(dir, to))) fs.renameSync(path.join(dir, from), path.join(dir, to)); } catch { /* the next start */ }
  }
}
function approvalSecret(h) {
  adoptOldKeyNames(h);
  const available = safeStorage.isEncryptionAvailable();
  let backend = null; try { backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : null; } catch { /* older Electron */ }
  const legacy = path.join(h, LEGACY.internal, 'datos');
  const dir = fs.existsSync(legacy) && !fs.existsSync(paths(h).core) ? legacy : paths(h).data;
  if (keyringWeak(process.platform, available, backend)) {
    weakKeyring = process.platform === 'linux';
    // A key already kept that way (Orb run from the code on Linux) is still read, so links and approvals stay.
    if (available) { try { const hex = safeStorage.decryptString(fs.readFileSync(path.join(dir, 'clave.enc'))); if (/^[0-9a-f]{64}$/.test(hex)) return hex; } catch { /* none */ } }
    return null;
  }
  // The rest (the copy outside, a clave.enc that cannot be read kept aside): src/main/approval-secret.mjs.
  return loadApprovalSecret({ dir, copy: SECRET_COPY(h), seal: (hex) => safeStorage.encryptString(hex), unseal: (buf) => safeStorage.decryptString(buf) });
}

let restarts = 0;
function startEngine(h) {
  if (engine) return engineReady;
  home = h;
  engine = utilityProcess.fork(path.join(UNPACKED, 'engine', 'engine.mjs'), [], {
    serviceName: `Motor de ${PRODUCT.name}`, stdio: 'pipe',
    // ORB_DEV_CONTROL (3.1): the developer's control line (engine/dev-control.mjs) exists only in an unpacked Orb.dev
    // started with ORB_DEV_CONTROL=1; an installed Orb never passes it, whatever its environment says.
    env: { ...process.env, ORB_MCP_SCRIPT: path.join(UNPACKED, 'mcp', 'server.mjs'),
      ORB_DEV_CONTROL: isDev && process.env.ORB_DEV_CONTROL === '1' ? '1' : '0' }
  });
  const logFile = path.join(paths(h).runs, 'motor-salida.log');
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
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(T('sys.main.engineStopped', { name: PRODUCT.name }))); }
      pending.clear();
      if (quitting) return;
      reject(new Error(T('sys.main.engineStartStopped', { name: PRODUCT.name })));
      // A crash of the engine is not the end of the app: it is started again (at most 3 times per session).
      if (restarts < 3) { restarts++; setTimeout(() => { startEngine(h).then(() => win?.webContents.send('engine:event', 'engine:restarted', { code })).catch(() => {}); }, 1000); }
      else win?.webContents.send('engine:event', 'engine:stopped', { code });
    });
  });
  let secret = null; try { secret = approvalSecret(h); } catch { /* falls back to the file */ }
  const browser = agentBrowser ? { pipe: agentBrowser.pipe, token: agentBrowser.token } : null;
  engine.postMessage({ type: 'start', home: h, version: VERSION, secret, browser, keep: SECRETS_COPY(h) });
  return engineReady;
}

function callEngine(method, params, timeoutMs = 10 * 60_000) {
  if (!engine) return Promise.reject(new Error(T('sys.main.engineOff', { name: PRODUCT.name })));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(T('sys.main.engineTimeout', { name: PRODUCT.name }))); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    engine.postMessage({ type: 'call', id, method, params });
  });
}

// 2.6: the window has no Windows title bar, so no menu bar either; the menu stays for its keys (zoom, Ctrl+J, F11).
function applyMenuBar() {
  if (!win || win.isDestroyed()) return;
  win.setMenuBarVisibility(false);
}

// The menu in the language of the settings: built at start and again when the language changes (config:changed).
let menuLanguage = null;
function applyMenu(c = config()) {
  const lang = langOf(c);
  if (lang === menuLanguage) return;
  menuLanguage = lang;
  const L = (key) => translate(lang, key);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: L('sys.menu.file'), submenu: [{ role: 'quit', label: L('sys.menu.quit') }] },
    { label: L('sys.menu.edit'), submenu: [{ role: 'undo', label: L('sys.menu.undo') }, { role: 'redo', label: L('sys.menu.redo') }, { type: 'separator' }, { role: 'cut', label: L('sys.menu.cut') }, { role: 'copy', label: L('sys.menu.copy') }, { role: 'paste', label: L('sys.menu.paste') }, { role: 'selectAll', label: L('sys.menu.selectAll') }] },
    // The keys themselves are handled in before-input-event (any keyboard); the menu only shows them.
    { label: L('sys.menu.view'), submenu: [{ label: L('sys.menu.zoomReset'), accelerator: 'CommandOrControl+0', registerAccelerator: false, click: () => zoomBy('reset') }, { label: L('sys.menu.zoomIn'), accelerator: 'CommandOrControl+Plus', registerAccelerator: false, click: () => zoomBy('in') }, { label: L('sys.menu.zoomOut'), accelerator: 'CommandOrControl+-', registerAccelerator: false, click: () => zoomBy('out') }, { type: 'separator' }, { label: L('sys.menu.terminal'), accelerator: 'CommandOrControl+J', registerAccelerator: false, click: () => win?.webContents.send('engine:event', 'ui:terminal', {}) }, { type: 'separator' }, { role: 'togglefullscreen', label: L('sys.menu.fullscreen') }, ...(isDev ? [{ role: 'toggleDevTools' }] : [])] }
  ]));
  applyMenuBar(); // a new menu on Windows comes back visible: hidden again
}

function onEngineEvent(event, payload) {
  if (event === 'config:changed') { cachedConfig = null; applyMenu(payload); }
  // The agents' browser lives here (main process): a task that ended asks for its pages to be closed. Done whether or not
  // the window exists.
  if (event === 'agentBrowser:closeTask') { try { agentBrowser?.closeTask(payload?.task); } catch { /* going away */ } return; }
  if (!win || win.isDestroyed()) return;
  win.webContents.send('engine:event', event, payload);
  // Notices while the window is in the background: finished tasks, approvals, the assistant's answers.
  if (event === 'chat:new' && !win.isFocused() && Notification.isSupported()) {
    const name = config()?.assistantName ?? PRODUCT.name;
    const n = new Notification({ icon: nativeImage.createFromPath(ICON), title: payload.role === 'orb' ? name : T('sys.main.notice', { name }), body: String(payload.body ?? '').slice(0, 240), silent: false });
    n.on('click', () => { win.show(); win.focus(); win.webContents.send('engine:event', 'ui:navigate', payload.conversation ? { view: 'chat', id: payload.conversation } : { view: 'chat' }); }); // 3.2: its conversation
    n.show();
  }
}

// Only our own page may use the bridge.
const fromApp = (event) => {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith('orb://app/') && event.sender === win?.webContents;
};
const guard = (fn) => async (event, ...args) => { if (!fromApp(event)) throw new Error(T('sys.main.badOrigin')); return fn(...args); };

const ENGINE_METHOD = /^[a-z]+(\.[A-Za-z]+){1,3}$/;
ipcMain.handle('engine:call', guard(async (method, params) => {
  if (typeof method !== 'string' || !ENGINE_METHOD.test(method)) throw new Error(T('sys.main.badAction'));
  await engineReady;
  return callEngine(method, params ?? {});
}));

ipcMain.handle('app:zoom', guard(async (value) => (value === undefined || value === null ? zoom : setZoom(value))));
// Ctrl+J: a terminal (Warp, Windows Terminal, PowerShell…; on Linux the system's one or the chosen one) in the folder the
// window is showing.
ipcMain.handle('app:openTerminal', guard(async (target) => {
  const dir = typeof target === 'string' && path.isAbsolute(target) ? target : home;
  if (!dir) throw new Error(T('sys.main.noFolderYet'));
  const c = config();
  return openTerminal(dir, c?.ui?.terminal ?? 'auto', { openExternal: (url) => shell.openExternal(url), language: langOf(c) });
}));
// 3.2, God mode: the project in Cursor / VS Code (only the installed ones are offered), and an action of the project run
// in a terminal window of its own, with its preview (only a page of this PC) opened in the browser after a moment.
ipcMain.handle('app:editors', guard(async () => { const e = findEditors(); return { cursor: Boolean(e.cursor), vscode: Boolean(e.vscode) }; }));
ipcMain.handle('app:openIn', guard(async (which, target) => {
  if (!['cursor', 'vscode', 'explorer'].includes(which) || typeof target !== 'string' || !path.isAbsolute(target)) throw new Error(T('sys.main.badPath'));
  if (which === 'explorer') { const err = await shell.openPath(target); if (err) throw new Error(err); return true; }
  await openInEditor(which, target, { language: langOf(config()) });
  return true;
}));
ipcMain.handle('app:runAction', guard(async (action) => {
  const { dir, command, preview, openPreview } = action ?? {};
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || typeof command !== 'string' || !command.trim() || command.length > 2000) throw new Error(T('sys.main.badAction'));
  const c = config();
  await runAction(command, dir, { choice: c?.ui?.terminal ?? 'auto', language: langOf(c) });
  if (openPreview && typeof preview === 'string') {
    let u = null; try { u = new URL(preview); } catch { /* not a link */ }
    if (u && /^https?:$/.test(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) setTimeout(() => { shell.openExternal(u.toString()).catch(() => {}); }, 2500);
  }
  return true;
}));
ipcMain.handle('app:showBrowser', guard(async () => { agentBrowser?.show(); return agentBrowser?.state() ?? null; }));
// 3.8: the workspace goes to C:\Orb unless the user picks another place (the welcome shows it already chosen); elsewhere
// ~/Orb.
const defaultBase = () => (process.platform === 'win32' ? path.win32.join(process.env.SystemDrive || 'C:', '\\') : app.getPath('home'));
ipcMain.handle('app:info', guard(async () => ({ version: VERSION, home, needsSetup: !home, platform: process.platform, defaultBase: process.env.ORB_DEFAULT_BASE || defaultBase() })));

ipcMain.handle('app:pickFolder', guard(async (title) => {
  const r = await dialog.showOpenDialog(win, { title: String(title ?? T('sys.dialog.pickFolder')).slice(0, 100), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}));
// 2.7: Agentes › Ruta del programa: the agent's program, chosen in Windows' own dialog instead of typed.
ipcMain.handle('app:pickProgram', guard(async (title) => {
  const exts = process.platform === 'win32' ? ['exe', 'cmd', 'bat', 'ps1', 'js', 'mjs', 'cjs'] : ['*'];
  const r = await dialog.showOpenDialog(win, { title: String(title ?? T('sys.dialog.pickProgram')).slice(0, 100), properties: ['openFile'], filters: [{ name: T('sys.dialog.programs'), extensions: exts }, { name: T('sys.dialog.allFiles'), extensions: ['*'] }] });
  return r.canceled ? null : r.filePaths[0];
}));
// 2.7: the Pizarra's attachments: any files (photos, videos, documents), up to 20 at a time.
ipcMain.handle('app:pickFiles', guard(async (title) => {
  const r = await dialog.showOpenDialog(win, { title: String(title ?? T('sys.dialog.pickFiles')).slice(0, 100), properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths.slice(0, 20);
}));
ipcMain.handle('app:pickImages', guard(async () => {
  const r = await dialog.showOpenDialog(win, { title: T('sys.dialog.refImages'), properties: ['openFile', 'multiSelections'], filters: [{ name: T('sys.dialog.images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] });
  return r.canceled ? [] : r.filePaths.slice(0, 10);
}));
// 3.8: core itself (all of it at once) and its secrets open only with a fresh unlock of the master password, checked by
// the engine. Its tool folders (MCP servers, adb, logs) and the data folder a failed migration points to open as
// before: the window offers them where they are needed, also before there is a password.
// Compared by the real path (a junction, a short 8.3 name or the \\?\ prefix lead to the same folder).
const realLower = (p) => { let r = path.resolve(p); try { r = fs.realpathSync.native(r); } catch { /* not there: as written */ } return r.replace(/^\\\\\?\\/, '').toLowerCase(); };
const guardedCore = (target) => {
  if (!home) return false;
  const t = realLower(target);
  const core = realLower(paths(home).core); const secrets = realLower(paths(home).secrets);
  return t === core || t === secrets || t.startsWith(secrets + path.sep);
};
ipcMain.handle('app:openPath', guard(async (target, unlock) => {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error(T('sys.main.badPath'));
  if (guardedCore(target)) { await engineReady; await callEngine('master.check', { unlock: typeof unlock === 'string' ? unlock : '' }, 10_000); }
  let st; try { st = fs.statSync(target); } catch { throw new Error(T('sys.main.folderMissing')); }
  if (!st.isDirectory()) throw new Error(T('sys.main.foldersOnly')); // never run a file
  const err = await shell.openPath(target); if (err) throw new Error(err);
  return true;
}));
// 3.8.1: «Eliminar proyecto». The engine checks the master password's token, that nothing of it works and what may go
// (projects.deleteCheck: from then on nothing of the project starts, and it returns a one-off ticket); the folder is
// checked here again by its real path and moved to the Recycle Bin; then the engine takes the project out with that
// ticket (projects.delete, trashed). When the Recycle Bin cannot take it:
//   - some program is using the folder → { ok: false, locked: true, path }: the window offers only «Reintentar»;
//   - otherwise → { ok: false, noTrash: true, path }: «Reintentar» or «Borrar para siempre».
// step: undefined (start; unlock: the token) | 'retry' | 'forever' (only after a noTrash for that same project) |
// 'cancel' (the project works again). A delete under way is kept here, by name, with its ticket and folder.
const deletes = new Map(); // name -> { ticket, path, noTrash }
async function trashProject(name, d) {
  const real = deletableFolder(home, d.path);
  let failed = false;
  try { await shell.trashItem(real); } catch { failed = true; }
  if (failed || fs.existsSync(real)) {
    if (folderInUse(real)) { d.noTrash = false; return { ok: false, locked: true, path: real }; }
    d.noTrash = true;
    return { ok: false, noTrash: true, path: real };
  }
  deletes.delete(name);
  return { ok: true, ...(await callEngine('projects.delete', { name, ticket: d.ticket, trashed: true })) };
}
ipcMain.handle('app:deleteProject', guard(async (name, unlock, step) => {
  if (typeof name !== 'string' || !name || name.length > 200) throw new Error(T('sys.main.badAction'));
  await engineReady;
  if (!home) throw new Error(T('sys.main.badPath'));
  const d = deletes.get(name);
  if (step === 'cancel') { deletes.delete(name); if (d) await callEngine('projects.deleteAbort', { name, ticket: d.ticket }).catch(() => {}); return { ok: false, cancelled: true }; }
  if (step === 'retry' || step === 'forever') {
    if (!d || (step === 'forever' && !d.noTrash)) throw new Error(T('sys.main.badAction'));
    if (step === 'retry') return trashProject(name, d);
    const real = deletableFolder(home, d.path);
    if (folderInUse(real)) { d.noTrash = false; return { ok: false, locked: true, path: real }; }
    deletes.delete(name); // one try: a delete that stops half-way says what is left, and the project works again
    return { ok: true, ...(await callEngine('projects.delete', { name, ticket: d.ticket }, 600_000)) };
  }
  if (d) { deletes.delete(name); await callEngine('projects.deleteAbort', { name, ticket: d.ticket }).catch(() => {}); }
  const check = await callEngine('projects.deleteCheck', { name, unlock: typeof unlock === 'string' ? unlock : '' }, 30_000);
  const next = { ticket: check.ticket, path: check.path, noTrash: false };
  deletes.set(name, next);
  try { return await trashProject(name, next); } catch (error) {
    // Not even checked here (the folder is not one Orb may delete): the project works again.
    if (deletes.get(name) === next) { deletes.delete(name); await callEngine('projects.deleteAbort', { name, ticket: next.ticket }).catch(() => {}); }
    throw error;
  }
}));
ipcMain.handle('app:openExternal', guard(async (url) => {
  let u; try { u = new URL(String(url)); } catch { throw new Error(T('sys.main.badLink')); }
  if (u.protocol !== 'https:') throw new Error(T('sys.main.httpsOnly'));
  await shell.openExternal(u.toString());
  return true;
}));
// Ajustes → Contribuye (feedback by mail with screenshots) and Más aplicaciones (src/main/feedback.mjs).
ipcMain.handle('app:feedbackCapture', guard(async () => (win ? captureWindow(win) : null)));
ipcMain.handle('app:feedbackImages', guard(async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG / JPEG', extensions: ['png', 'jpg', 'jpeg'] }] });
  return r.canceled ? [] : r.filePaths.slice(0, MAX_IMAGES).map(readImage).filter(Boolean);
}));
ipcMain.handle('app:feedbackSend', guard(async (data) => sendFeedback(data ?? {}, { version: VERSION, language: config()?.language ?? 'es' })));
ipcMain.handle('app:moreApps', guard(async () => moreApps(VERSION)));
// Updates: state, check now, download, and restart into the new version (asking first if tasks are running).
ipcMain.handle('app:update', guard(async () => updater.get()));
ipcMain.handle('app:updateCheck', guard(async () => updater.check()));
ipcMain.handle('app:updateDownload', guard(async () => updater.download()));
ipcMain.handle('app:updateInstall', guard(async () => {
  if (updater.get().portable) { await shell.openExternal(RELEASES_URL); return false; }
  if (updater.get().state !== 'downloaded') return false;
  let running = 0; try { running = engine ? (await callEngine('app.state', {}, 5000)).counts?.running ?? 0 : 0; } catch { /* updating anyway */ }
  if (running) {
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: [T('sys.dialog.updateAnyway'), T('sys.dialog.cancel')], defaultId: 1, cancelId: 1, title: T('sys.dialog.runningTitle'), message: T(running === 1 ? 'sys.dialog.updateOne' : 'sys.dialog.updateMany', { n: running }) });
    if (r.response !== 0) return false;
  }
  // The engine and the browser close in before-quit, once the installer really starts: if it cannot (installer deleted or
  // held by the antivirus), the app keeps working instead of staying open with its engine stopped.
  return updater.install();
}));
// First run: creates <base>/<name> (or reuses an existing assistant folder), remembers it and starts the engine.
ipcMain.handle('app:setup', guard(async ({ base, assistantName, userName, language } = {}) => {
  if (home) throw new Error(T('sys.main.alreadySetup'));
  const { home: h } = createHome(String(base ?? ''), { assistantName: String(assistantName ?? PRODUCT.assistant), userName: String(userName ?? ''), language: language === 'en' ? 'en' : 'es' });
  saveLocation(h);
  await startEngine(h);
  cachedConfig = null;
  setTitle();
  applyMenu();
  return { home: h };
}));
// Moves to another assistant folder (restart of the engine with the new one).
ipcMain.handle('app:switchHome', guard(async (target) => {
  if (typeof target !== 'string' || !isHome(target)) throw new Error(T('sys.main.notHome'));
  saveLocation(target);
  quitting = true; agentBrowser?.shutdown(); try { engine?.postMessage({ type: 'shutdown' }); } catch { /* gone */ }
  app.relaunch(); app.exit(0);
}));

// 3.7, Linux without a keyring: said once on this PC (a notice under the bell), not at every start.
const KEYRING_TOLD = () => path.join(app.getPath('userData'), 'aviso-llavero.json');
function tellKeyring() {
  if (!win || win.isDestroyed() || fs.existsSync(KEYRING_TOLD())) return;
  win.webContents.send('engine:event', 'notice', { body: T('sys.main.keyringWeak'), tone: 'warning' });
  try { writeJson(KEYRING_TOLD(), { told: new Date().toISOString() }); } catch { /* told again next time */ }
}

function setTitle() { win?.setTitle(config()?.assistantName ?? PRODUCT.name); }

// 2.6: no Windows title bar and no Windows buttons: the app draws its own minimise / maximise / close, in the style of
// each theme (components/window-controls.jsx), and asks the window for them here. The page hears when it is maximised.
ipcMain.handle('app:window', guard(async (action) => {
  if (!win || win.isDestroyed()) return null;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else if (action === 'close') win.close();
  else if (action !== 'state') throw new Error('acción de ventana desconocida');
  return { maximized: win.isMaximized() };
}));
const sendWindowState = () => { if (win && !win.isDestroyed()) win.webContents.send('app:window-state', { maximized: win.isMaximized() }); };

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 400, minHeight: 560, show: false, backgroundColor: dark ? '#16151d' : '#fbfbfe', title: PRODUCT.name, autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    icon: WINDOW_ICON,
    webPreferences: { preload: path.join(SRC, 'main', 'preload.cjs'), additionalArguments: LIGHT ? ['--orb-light'] : [], contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true, devTools: isDev || process.env.ORB_DEVTOOLS === '1' }
  });
  win.once('ready-to-show', () => win.show());
  for (const e of ['maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) win.on(e, sendWindowState);
  win.webContents.on('did-finish-load', () => { win?.webContents.setZoomFactor(zoom * ZOOM_BASE); if (weakKeyring) setTimeout(tellKeyring, 8000).unref?.(); });
  win.webContents.on('before-input-event', (e, input) => { const dir = zoomKey(input); if (dir) { e.preventDefault(); zoomBy(dir); } });
  win.webContents.on('zoom-changed', (_e, dir) => zoomBy(dir)); // Ctrl + mouse wheel
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('orb://app/')) e.preventDefault(); });
  let closing = false; // a second click on the X while the question is open does not ask twice
  win.on('close', async (e) => {
    if (quitting || !engine) return;
    e.preventDefault();
    if (closing) return;
    closing = true;
    let running = 0; try { running = (await callEngine('app.state', {}, 5000)).counts?.running ?? 0; } catch { /* closing anyway */ }
    if (running) {
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: [T('sys.dialog.closeAnyway'), T('sys.dialog.cancel')], defaultId: 1, cancelId: 1, title: T('sys.dialog.runningTitle'), message: T(running === 1 ? 'sys.dialog.closeOne' : 'sys.dialog.closeMany', { n: running }) });
      closing = false;
      if (r.response !== 0) return;
    }
    quitting = true; app.quit();
  });
  // The agents' browser keeps hidden windows: when the app's window goes, the app goes with it.
  win.on('closed', () => { win = null; quitting = true; app.quit(); });
  win.loadURL('orb://app/index.html');
  applyMenuBar();
  setTitle();
}

app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { quitting = true; agentBrowser?.shutdown(); try { engine?.postMessage({ type: 'shutdown' }); } catch { /* gone */ } });
app.on('window-all-closed', () => app.quit());

// 3.8: the window's unlock of the master password ends when Windows locks, the PC sleeps or shuts down.
const lockMaster = () => { if (engine) callEngine('master.lock', {}, 5000).catch(() => {}); };

app.whenReady().then(async () => {
  for (const e of ['lock-screen', 'suspend', 'shutdown', 'user-did-resign-active']) powerMonitor.on(e, lockMaster);
  // Our pages come from orb://app/ (only files inside src/renderer); nothing else is served.
  protocol.handle('orb', (request) => {
    const url = new URL(request.url);
    let file; try { file = path.normalize(path.join(RENDERER, decodeURIComponent(url.pathname))); } catch { file = ''; }
    // orb://pip/ is the same files for the little window: another host, so Chromium keeps its zoom apart from the app's.
    if (!['app', 'pip'].includes(url.host) || !file.startsWith(RENDERER + path.sep)) return new Response('no encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // The window never needs the camera, the microphone, notifications from the page, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"] } });
  });
  let h = readLocation();
  if (!h) { h = findExistingHome(); if (h) saveLocation(h); }
  home = h;
  applyMenu(); // in the language of the settings; built again when it changes (onEngineEvent)
  // The agents' browser: pages drawn off screen and the little window in the top-right corner (ui.pip turns it off).
  try {
    agentBrowser = createAgentBrowser({
      pipUrl: 'orb://pip/pip.html', pipPreload: path.join(SRC, 'main', 'pip-preload.cjs'), mainWindow: () => win, language: () => config()?.language ?? 'es', skin: () => config()?.ui?.skin ?? 'orb',
      pipEnabled: () => config()?.ui?.pip !== false && config()?.browser?.enabled !== false,
      label: (agent) => (agent === 'orb' ? config()?.assistantName ?? PRODUCT.assistant : { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' }[agent] ?? agent)
    });
    await agentBrowser.ready;
  } catch (error) { agentBrowser = null; console.error(`navegador del agente: ${error.message}`); }
  zoom = readZoom();
  if (h) startEngine(h).catch((error) => dialog.showErrorBox(T('sys.main.startFailed', { name: PRODUCT.name }), error.message));
  createWindow();
  updater.start();
});
