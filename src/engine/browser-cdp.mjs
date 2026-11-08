// 3.8.1 (D2): what the agents' browser does with one of its pages over the DevTools protocol (src/engine/cdp.mjs), for
// the shared actions of src/core/browser-protocol.mjs: the same driver interface as Electron's (src/main/browser-driver.mjs,
// kept until Electron goes). Under Tauri the pages are hidden WebView2 windows; in the tests, pages of a headless Edge.
//
// attachPage(cdp, targetId, tab) joins a page with a flat session and keeps on the tab what the actions read: its main
// frame, address, whether it is loading, its console errors and warnings, and the isolated world Orb's scripts run in
// (the page's DOM, none of its JavaScript). Then cdpDriver(T) does the rest.
import { VIEW, dialogsHook, TAKE_DIALOGS } from '../core/browser-protocol.mjs';

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
export const WORLD_NAME = 'orb-agent';
const LOAD_MS = 25_000;

export async function attachPage(cdp, targetId, tab) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  const on = (method, fn) => cdp.on(method, fn, sessionId);
  const page = { targetId, sessionId, send, on, mainFrame: null, url: '', loading: false, world: null, dialogScript: null, gone: false };
  tab.page = page;
  tab.console ??= [];
  const note = (level, message, source = '', line = 0) => {
    tab.console.push({ level, message: String(message ?? '').slice(0, 500), source: String(source ?? '').slice(0, 200), line: Number(line) || 0 });
    if (tab.console.length > 200) tab.console.shift();
  };
  on('Page.frameNavigated', ({ frame }) => { if (!frame.parentId) { page.mainFrame = frame.id; page.url = frame.url; page.world = null; tab.url = frame.url; } });
  on('Page.navigatedWithinDocument', ({ frameId, url }) => { if (frameId === page.mainFrame) { page.url = url; tab.url = url; } });
  on('Page.frameStartedLoading', ({ frameId }) => { if (frameId === page.mainFrame) { page.loading = true; tab.loading = true; } });
  on('Page.frameStoppedLoading', ({ frameId }) => { if (frameId === page.mainFrame) { page.loading = false; tab.loading = false; } });
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
        const r = await page.send('Page.navigate', { url });
        const failure = r.errorText && !/ERR_ABORTED/.test(r.errorText) ? r.errorText : null;
        // An HTTP error status (404, 500…) still renders the server's page: the agent sees it. Anything else never loaded.
        if (failure && !/ERR_HTTP_RESPONSE_CODE_FAILURE/.test(failure)) throw new Error(T('sys.browser.openFailed', { url, error: failure.replace(/^.*?(ERR_\w+).*$/s, '$1') }));
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
          // The page moved on (its document and world are gone): once more in the new one.
          if (error.fromPage || i >= 2 || !/context|frame/i.test(error.message)) throw error;
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
    focusPage: (tab) => tab.page.send('Page.bringToFront').catch(() => {}),
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
