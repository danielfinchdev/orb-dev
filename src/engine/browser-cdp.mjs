// 3.8.1 (D2, D7): what the agents' browser does with one of its pages over the DevTools protocol, for the shared actions
// of src/core/browser-protocol.mjs: the driver interface browser-protocol.mjs expects. Under Tauri the pages are hidden WebView2 windows driven by Rust (CallDevToolsProtocolMethod, no
// DevTools port: src/engine/host-browser.mjs); in the tests, pages of a headless Edge.
//
// attachPage(page, tab) takes a page ({ id, send, on, close }: src/engine/agent-browser.mjs) and keeps on the tab what the
// actions read: its main frame, address, title, whether it is loading, its console errors and warnings (and what the app
// refused: a download, a sign-in prompt, an address that is not a web page), and the isolated world Orb's scripts run in
// (the page's DOM, none of its JavaScript). Then cdpDriver(T) does the rest.
import { VIEW, allowed, dialogsHook, TAKE_DIALOGS } from '../core/browser-protocol.mjs';

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
export const WORLD_NAME = 'orb-agent';
const LOAD_MS = 25_000;

export async function attachPage(source, tab, { onUpdate = () => {} } = {}) {
  const { send, on } = source;
  const page = { ...source, mainFrame: null, url: '', loading: false, world: null, dialogScript: null, gone: false };
  tab.page = page;
  tab.console ??= [];
  const note = (level, message, source = '', line = 0) => {
    tab.console.push({ level, message: String(message ?? '').slice(0, 500), source: String(source ?? '').slice(0, 200), line: Number(line) || 0 });
    if (tab.console.length > 200) tab.console.shift();
  };
  // What the app refused, told to the agent as console errors (orb_browser_console, and the snapshot's error count).
  const REFUSED = { navigation: 'Orb blocked a page that is not http(s)', external: 'Orb blocked opening another app', download: 'Orb refused a download (this browser never downloads files)', auth: 'Orb cancelled an HTTP sign-in prompt', permission: 'Orb denied a permission request', file: 'Orb blocked a file chooser (this browser never picks local files)', flood: 'Orb stopped this page: it sent too many events (a console or navigation flood) and closed it; the next orb_browser_open starts a fresh page' };
  on('Orb.blocked', ({ kind, url, permission } = {}) => {
    note('error', `${REFUSED[kind] ?? 'Orb blocked'}${permission ? ` (${permission})` : ''}`, url);
    if (kind === 'flood') tab.stopped = REFUSED.flood; // what the agent hears next, once the page is gone
  });
  // A new window the page asked for (window.open, target=_blank): never made; its address opens in this page.
  on('Orb.popup', ({ url } = {}) => {
    if (!url || url === 'about:blank') return;
    if (!allowed(url)) { note('error', REFUSED.navigation, url); return; }
    send('Page.navigate', { url }).catch(() => {});
  });
  on('Orb.title', ({ title } = {}) => { tab.title = String(title ?? ''); onUpdate(); });
  on('Orb.crashed', () => { tab.crashed = true; });
  // The app dropped some of the page's events (a page flooding them): said once a second.
  on('Orb.dropped', ({ count } = {}) => note('warning', `Orb dropped ${Number(count) || 0} events of this page (too many)`));
  on('Page.frameNavigated', ({ frame }) => { if (!frame.parentId) { page.mainFrame = frame.id; page.url = frame.url; page.world = null; tab.url = frame.url; onUpdate(); } });
  on('Page.navigatedWithinDocument', ({ frameId, url }) => { if (frameId === page.mainFrame) { page.url = url; tab.url = url; onUpdate(); } });
  on('Page.frameStartedLoading', ({ frameId }) => { if (frameId === page.mainFrame) { page.loading = true; tab.loading = true; onUpdate(); } });
  on('Page.frameStoppedLoading', ({ frameId }) => { if (frameId === page.mainFrame) { page.loading = false; tab.loading = false; onUpdate(); } });
  on('Runtime.executionContextsCleared', () => { page.world = null; });
  on('Runtime.executionContextDestroyed', ({ executionContextId }) => { if (executionContextId === page.world) page.world = null; });
  // 3.2.1: what the page writes to its console (errors and warnings), for orb_browser_console.
  on('Runtime.consoleAPICalled', ({ type, args = [], stackTrace }) => {
    const level = type === 'error' || type === 'assert' ? 'error' : type === 'warning' ? 'warning' : null;
    if (!level) return;
    const top = stackTrace?.callFrames?.[0];
    note(level, args.map((a) => a.value ?? a.description ?? '').join(' '), top?.url, top ? top.lineNumber + 1 : 0);
  });
  on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => note('error', d?.exception?.description ?? d?.text ?? 'error', d?.url, d ? d.lineNumber + 1 : 0));
  on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error' || entry.level === 'warning') note(entry.level, entry.text, entry.url, entry.lineNumber); });
  // A dialog the replaced alert/confirm/prompt missed (one of a frame, «leave this page?») never blocks the agent.
  on('Page.javascriptDialogOpening', ({ type }) => { send('Page.handleJavaScriptDialog', { accept: type === 'beforeunload' ? true : Boolean(tab.dialogAnswer?.accept), promptText: String(tab.dialogAnswer?.text ?? '') }).catch(() => {}); });
  on('Inspector.targetCrashed', () => { tab.crashed = true; });
  on('Inspector.detached', () => { page.gone = true; });
  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')]);
  // The 1280×800 view at one CSS pixel per pixel whatever the screen's scale (a hidden WebView2 follows the DPI), and the
  // page thinks it has the focus (keys and text go to it without a visible window).
  await send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  // Electron put the page's alert/confirm/prompt in place on every page (dom-ready); here before the page's own scripts.
  await installDialogs(page, tab.dialogAnswer);
  const { frameTree } = await send('Page.getFrameTree');
  page.mainFrame = frameTree.frame.id; page.url = frameTree.frame.url; tab.url = page.url;
  return page;
}

async function installDialogs(page, answer) {
  if (page.dialogScript) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: page.dialogScript }).catch(() => {});
  page.dialogScript = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source: dialogsHook(answer) })).identifier;
}

// A script in the page's own world (where the replaced dialogs live), its value or null.
const mainWorld = (page, expression) => page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => (r.exceptionDetails ? null : r.result?.value ?? null));

export function cdpDriver(T) {
  return {
    async load(tab, url) {
      const page = tab.page;
      let loaded; const done = new Promise((r) => { loaded = r; });
      const off = page.on('Page.loadEventFired', () => loaded());
      try {
        const r = await page.send('Page.navigate', { url }).catch((error) => { throw new Error(T('sys.browser.openFailed', { url, error: /ERR_\w+/.exec(error.message)?.[0] ?? error.message })); });
        const failure = r.errorText && !/ERR_ABORTED/.test(r.errorText) ? r.errorText : null;
        // An HTTP error status (404, 500…) still renders the server's page: the agent sees it, as it does a page that asked
        // for an HTTP sign-in (the app cancels the prompt and the server's 401 page shows). Anything else never loaded.
        if (failure && !/ERR_HTTP_RESPONSE_CODE_FAILURE|ERR_INVALID_AUTH_CREDENTIALS/.test(failure)) throw new Error(T('sys.browser.openFailed', { url, error: failure.replace(/^.*?(ERR_\w+).*$/s, '$1') }));
        if (r.loaderId) await Promise.race([done, settle(LOAD_MS)]); // a jump inside the same page has no load
      } finally { off(); }
    },
    async world(tab, code) {
      const page = tab.page;
      for (let i = 0; ; i++) {
        try {
          if (!page.world) page.world = (await page.send('Page.createIsolatedWorld', { frameId: page.mainFrame, worldName: WORLD_NAME })).executionContextId;
          const r = await page.send('Runtime.evaluate', { expression: code, contextId: page.world, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw Object.assign(new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'error'), { fromPage: true });
          return r.result?.value ?? null;
        } catch (error) {
          // The page moved on (its document and world are gone): once more in the new one. WebView2 says so with a bare
          // «invalid argument» (0x80070057) after a page that failed to load.
          if (error.fromPage || i >= 2 || !/context|frame|0x80070057/i.test(error.message)) throw error;
          page.world = null; await settle(100);
        }
      }
    },
    loading: (tab) => Boolean(tab.page?.loading),
    async click(tab, x, y) {
      const send = tab.page.send;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    },
    // Keys reach the page through DevTools with its focus emulated (Emulation.setFocusEmulationEnabled): never the
    // system's focus (Page.bringToFront could take the keyboard from what the owner is typing in).
    focusPage: async () => {},
    insertText: (tab, text) => tab.page.send('Input.insertText', { text }),
    async press(tab, def) {
      const send = tab.page.send;
      const k = { key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
      if (def.text) await send('Input.dispatchKeyEvent', { type: 'char', text: def.text, unmodifiedText: def.text, ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    },
    async back(tab) {
      const { currentIndex, entries } = await tab.page.send('Page.getNavigationHistory');
      if (!(currentIndex > 0)) return false;
      await tab.page.send('Page.navigateToHistoryEntry', { entryId: entries[currentIndex - 1].id });
      return true;
    },
    // A JPEG of what the view shows, 1024 px wide (as Electron's), wherever the page is scrolled.
    async capture(tab) {
      const send = tab.page.send;
      const m = await send('Page.getLayoutMetrics').catch(() => null);
      const vp = m?.cssVisualViewport ?? m?.visualViewport ?? { pageX: 0, pageY: 0 };
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, clip: { x: vp.pageX ?? 0, y: vp.pageY ?? 0, width: VIEW.width, height: VIEW.height, scale: 1024 / VIEW.width } });
      return data;
    },
    url: (tab) => tab.page?.url ?? '',
    takeDialogs: async (tab) => (await mainWorld(tab.page, TAKE_DIALOGS).catch(() => null)) ?? [],
    async setDialogAnswer(tab, answer) {
      await installDialogs(tab.page, answer).catch(() => {}); // the next pages of this tab
      await mainWorld(tab.page, dialogsHook(answer)).catch(() => {}); // and this one
    },
    kill: (tab) => { tab.crashed = true; tab.page?.send('Page.crash').catch(() => {}); }
  };
}
