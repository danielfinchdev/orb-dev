// The agents' browser: real Chromium pages that agents drive through the assistant's MCP tools (open, look, click, type…),
// drawn off screen, and a small always-on-top window in the top-right corner that shows live what the agent is doing
// (expand, collapse to a pill, or close until the next activity).
//
// The MCP server of each agent process talks to this module over a local pipe (a named pipe on Windows) with a random
// token handed out by the engine. Every conversation gets its own page; pages share an in-memory session with nothing
// of the user's (no cookies, no logins), downloads and permission requests are refused and only http(s) is loaded.
import { BrowserWindow, screen, session, ipcMain } from 'electron';
import crypto from 'node:crypto';
import { translate } from '../core/i18n.mjs';
// 3.7 (WS5): the limits, keys, page scripts (with the secret fields left out), actions and pipe are shared with Orb
// Server's browser (src/server/browser.mjs): src/core/browser-protocol.mjs. Here only what is Electron's.
import { VIEW, MAX_TABS, dialogsHook, normalizeUrl, allowed, createActions, servePipe } from '../core/browser-protocol.mjs';
import { electronDriver } from './browser-driver.mjs';

export { normalizeUrl };
const FRAME_MS = 250; // the little window gets at most 4 pictures a second (the last one always arrives)
const SIZES = { normal: { width: 400, height: 292 }, grande: { width: 820, height: 560 }, pildora: { width: 290, height: 46 } };

// options: label(agent) → name shown in the little window; pipEnabled() → whether it may appear; mainWindow() → the app's
// window (to place the little one on the same screen and to bring the app forward); pipUrl / pipPreload.
export function createAgentBrowser({ label = (a) => a, pipEnabled = () => true, language = () => 'es', skin = () => 'orb', mainWindow = () => null, pipUrl, pipPreload, log = () => {} }) {
  const T = (key, vars) => translate(language() === 'en' ? 'en' : 'es', key, vars);
  const token = crypto.randomBytes(24).toString('hex');
  const tabs = new Map(); // conversation (or connection) -> tab
  let pip = null; let pipTab = null; let mode = 'normal';

  // 3.6: one browser profile per person (the owner keeps the 3.5 one): cookies and sign-ins of one person's agents and
  // bots never reach another person's pages. A bot uses its own person's. Kept on disk (persist:), each person's apart:
  // a sign-in made in one person's browser is still there next time, and only for that person.
  const profiles = new Map();
  const sessionFor = (person = '') => {
    const key = String(person || '');
    let ses = profiles.get(key);
    if (ses) return ses;
    ses = session.fromPartition(key ? `persist:orb-web-${key.replace(/[^\w-]/g, '_')}` : 'persist:navegador-agente');
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());
    ses.setUserAgent(ses.getUserAgent().replace(/\s(orb[\w.-]*|Electron)\/\S+/gi, ''));
    profiles.set(key, ses);
    return ses;
  };
  sessionFor('');

  // ---- the little window
  function placePip(size = SIZES[mode]) {
    const ref = mainWindow();
    const display = ref && !ref.isDestroyed() ? screen.getDisplayMatching(ref.getBounds()) : screen.getPrimaryDisplay();
    const wa = display.workArea;
    return { x: Math.round(wa.x + wa.width - size.width - 18), y: Math.round(wa.y + 18), ...size };
  }
  function ensurePip() {
    if (pip && !pip.isDestroyed()) return pip;
    pip = new BrowserWindow({
      ...placePip(), frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: true, minimizable: false, maximizable: false, fullscreenable: false,
      show: false, transparent: false, backgroundColor: '#11131c', title: T('sys.browser.title'), minWidth: 240, minHeight: 46,
      webPreferences: { preload: pipPreload, sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false }
    });
    pip.setAlwaysOnTop(true, 'floating');
    pip.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pip.webContents.on('will-navigate', (e) => e.preventDefault());
    pip.on('closed', () => { pip = null; });
    pip.loadURL(pipUrl);
    pip.webContents.once('did-finish-load', () => { sendState(); if (pipTab && !pipTab.dismissed) { pip?.showInactive(); painting(); } });
    return pip;
  }
  const visible = () => pip && !pip.isDestroyed() && pip.isVisible();
  function sendState() {
    if (!pip || pip.isDestroyed()) return;
    const t = pipTab;
    pip.webContents.send('pip:state', { mode, agent: t ? label(t.agent) : null, task: t?.task || null, url: t?.url ?? '', title: t?.title ?? '', loading: Boolean(t?.loading), tabs: tabs.size, action: t?.action ?? '', language: language(), skin: skin() });
  }
  // Only the page on show is drawn, and only while the little window shows it (drawing costs a full-size picture per frame).
  function painting() {
    const on = visible() && mode !== 'pildora';
    for (const t of tabs.values()) {
      if (t.win.isDestroyed()) continue;
      const want = on && t === pipTab;
      if (want !== t.painting) { t.painting = want; if (want) { t.win.webContents.startPainting(); t.win.webContents.invalidate(); } else t.win.webContents.stopPainting(); }
    }
  }
  function hidePip() { if (pip && !pip.isDestroyed()) pip.hide(); painting(); }
  function showFor(tab, { force = false } = {}) {
    pipTab = tab;
    if (!pipEnabled() || (tab.dismissed && !force)) { sendState(); return painting(); }
    const w = ensurePip();
    sendState();
    if (!w.webContents.isLoading() && !w.isVisible()) w.showInactive(); // never steals the focus
    painting();
  }
  function setMode(next) {
    if (!SIZES[next] || !pip || pip.isDestroyed()) return;
    const old = pip.getBounds(); const size = SIZES[next];
    mode = next;
    pip.setBounds({ x: old.x + old.width - size.width, y: old.y, ...size }); // anchored by its top-right corner
    sendState(); painting(); pipTab?.win.webContents.invalidate();
  }
  // Pictures for the little window: at most one per FRAME_MS, at the size it is shown, and the latest one always arrives.
  let latest = null; let frameTimer = null; let lastSent = 0;
  function sendFrame() {
    frameTimer = null;
    const img = latest; latest = null;
    if (!img || !visible() || mode === 'pildora') return;
    lastSent = Date.now();
    const scale = screen.getDisplayMatching(pip.getBounds()).scaleFactor || 1;
    const width = Math.min(VIEW.width, Math.round(pip.getContentBounds().width * scale));
    try { pip.webContents.send('pip:frame', `data:image/jpeg;base64,${img.resize({ width, quality: 'good' }).toJPEG(72).toString('base64')}`); } catch { /* window going away */ }
  }
  function frame(tab, image) {
    if (tab !== pipTab || !visible() || mode === 'pildora') return;
    latest = image;
    if (!frameTimer) frameTimer = setTimeout(sendFrame, Math.max(0, FRAME_MS - (Date.now() - lastSent)));
  }
  const onPipAction = (event, action) => {
    if (!pip || event.sender !== pip.webContents) return;
    if (action === 'grande' || action === 'normal' || action === 'pildora') setMode(action);
    else if (action === 'cerrar') { if (pipTab) pipTab.dismissed = true; hidePip(); }
    else if (action === 'app') { const w = mainWindow(); if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } }
  };
  ipcMain.on('pip:action', onPipAction);

  // ---- pages
  function newTab(key, { agent, task, person = '' }) {
    if (tabs.size >= MAX_TABS) {
      // Only a page no agent is using makes room; pages in use are never taken away.
      const idle = [...tabs.values()].filter((t) => t.users <= 0).sort((a, b) => a.used - b.used)[0];
      if (!idle) throw new Error(T('sys.browser.full', { n: MAX_TABS }));
      closeTab(idle);
    }
    const win = new BrowserWindow({
      show: false, width: VIEW.width, height: VIEW.height, useContentSize: true, paintWhenInitiallyHidden: true,
      webPreferences: { offscreen: true, session: sessionFor(person), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, devTools: false, spellcheck: false, disableDialogs: true, autoplayPolicy: 'document-user-activation-required' }
    });
    const tab = { key, agent, task, win, users: 0, timer: null, painting: true, url: '', title: '', loading: false, used: Date.now(), dismissed: false, action: '' };
    const wc = win.webContents;
    wc.setAudioMuted(true);
    wc.setFrameRate(8);
    wc.on('did-create-window', (w) => w.destroy()); // belt and braces: no other windows
    wc.setWindowOpenHandler(({ url }) => { if (allowed(url)) setImmediate(() => wc.loadURL(url).catch(() => {})); return { action: 'deny' }; }); // popups open in the same page
    wc.on('will-navigate', (e, url) => { if (!allowed(url)) e.preventDefault(); });
    wc.on('will-redirect', (e, url) => { if (!allowed(url)) e.preventDefault(); });
    wc.on('will-prevent-unload', (e) => e.preventDefault()); // "leave this page?" never blocks the agent
    // No device choosers (the callback is the last argument; its position differs per event).
    for (const ev of ['select-bluetooth-device', 'select-hid-device', 'select-serial-port', 'select-usb-device']) wc.on(ev, (e, ...rest) => { e.preventDefault(); const cb = rest.at(-1); if (typeof cb === 'function') cb(''); });
    wc.on('login', (e, _d, _a, cb) => { e.preventDefault(); cb(); }); // no HTTP auth prompts
    wc.on('paint', (_e, _dirty, image) => frame(tab, image));
    const update = () => { if (win.isDestroyed()) return; tab.url = wc.getURL(); tab.title = wc.getTitle(); tab.loading = wc.isLoading(); if (tab === pipTab) sendState(); };
    for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) wc.on(ev, update);
    wc.on('render-process-gone', () => { tab.crashed = true; });
    // 3.2.1: what the page writes to its console (errors and warnings), for orb_browser_console, and its alert(), confirm()
    // and prompt(), answered as the agent said with orb_browser_dialog (cancel by default, as before) and kept to tell it.
    tab.console = []; tab.dialogAnswer = { accept: false, text: '' };
    const note = (level, message, source = '', line = 0) => { tab.console.push({ level, message: String(message ?? '').slice(0, 500), source: String(source ?? '').slice(0, 200), line: Number(line) || 0 }); if (tab.console.length > 200) tab.console.shift(); };
    wc.on('console-message', (e, lvl, msg, line, source) => {
      const raw = e?.level ?? lvl; const level = typeof raw === 'number' ? ['info', 'info', 'warning', 'error'][raw] ?? 'info' : String(raw ?? 'info');
      if (level === 'error' || level === 'warning') note(level, e?.message ?? msg, e?.sourceId ?? source, e?.lineNumber ?? line);
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (code !== -3) note('error', `${isMain ? 'page' : 'resource'} did not load: ${desc} (${code})`, url); });
    wc.on('dom-ready', () => { wc.executeJavaScript(dialogsHook(tab.dialogAnswer)).catch(() => {}); });
    tabs.set(key, tab);
    painting();
    return tab;
  }
  function closeTab(tab) {
    if (!tab) return;
    if (tabs.get(tab.key) === tab) tabs.delete(tab.key);
    clearTimeout(tab.timer);
    if (!tab.win.isDestroyed()) tab.win.destroy();
    if (pipTab === tab) {
      pipTab = [...tabs.values()].sort((a, b) => b.used - a.used)[0] ?? null;
      if (!pipTab) hidePip(); else { sendState(); painting(); }
    }
  }

  // ---- what this browser does with one of its pages (the shared actions of src/core/browser-protocol.mjs use it)
  const driver = electronDriver(T);
  const actions = createActions({ driver, T, language });
  // What the agent is doing, for the little window (in the language of the settings).
  const DESCRIBE = { open: (a) => T('sys.browser.do.open', { url: a.url }), click: (a) => (a.ref !== undefined ? T('sys.browser.do.clickRef', { ref: a.ref }) : T('sys.browser.do.clickAt', { x: a.x, y: a.y })), type: (a) => T('sys.browser.do.type', { text: String(a.text ?? '').slice(0, 40) }), press: (a) => T('sys.browser.do.press', { key: a.key }), scroll: (a) => T(a.direction === 'up' ? 'sys.browser.do.scrollUp' : 'sys.browser.do.scrollDown'), back: () => T('sys.browser.do.back'), wait: () => T('sys.browser.do.wait'), snapshot: () => T('sys.browser.do.snapshot'), screenshot: () => T('sys.browser.do.screenshot'), dialog: (a) => T(a.accept === false ? 'sys.browser.do.dialogCancel' : 'sys.browser.do.dialogAccept'), console: () => T('sys.browser.do.console') };

  // ---- control pipe (src/core/browser-protocol.mjs): the key of each conversation, one action at a time per page.
  const served = servePipe({
    token, T, log, actions,
    pages: { get: (key) => tabs.get(key), dead: (tab) => tab.win.isDestroyed() || Boolean(tab.crashed), create: (key, who) => newTab(key, who), close: (tab) => closeTab(tab) },
    grabbed: (tab) => { tab.dismissed = false; }, // a new turn shows the window again
    before(tab, action, args) {
      tab.used = Date.now(); tab.action = DESCRIBE[action]?.(args) ?? action;
      if (action === 'open') { tab.dismissed = false; showFor(tab, { force: true }); } else showFor(tab);
    },
    // The agent's turn ended: the little window keeps its last picture for a moment and hides; the page waits 10 minutes
    // for the conversation's next turn and then goes.
    released(tab) {
      tab.timer = setTimeout(() => {
        if (tab.users > 0) return;
        if (tab === pipTab && visible()) hidePip();
        tab.timer = setTimeout(() => { if (tab.users <= 0) closeTab(tab); }, 10 * 60_000);
      }, 20_000);
    }
  });
  const { pipe, ready } = served;

  return {
    pipe, token, ready,
    show() { if (pipTab) showFor(pipTab, { force: true }); },
    // 3.2.1: when a task ends Orb closes the pages it opened (as it already stops the servers it left): the tabs do not
    // pile up and the next agent never looks at a half-built page of a task that is over.
    closeTask(task) { const id = String(task ?? ''); if (!id) return; for (const t of [...tabs.values()]) if (String(t.task ?? '') === id) closeTab(t); },
    state: () => ({ tabs: [...tabs.values()].map((t) => ({ agent: t.agent, task: t.task, url: t.url, title: t.title })), pip: visible() }),
    shutdown() {
      served.close();
      ipcMain.removeListener('pip:action', onPipAction); clearTimeout(frameTimer);
      for (const t of [...tabs.values()]) closeTab(t);
      if (pip && !pip.isDestroyed()) pip.destroy();
    }
  };
}
