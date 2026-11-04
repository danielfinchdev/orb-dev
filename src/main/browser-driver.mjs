// 3.7 (WS5): what the app's browser (src/main/browser.mjs) does with one of its pages, for the shared actions of
// src/core/browser-protocol.mjs: tab.win.webContents of an off-screen Electron window. Kept apart from Electron's imports
// so the tests drive the same code with a stand-in webContents (test/navegador-protocolo.test.mjs).
import { WORLD, dialogsHook, TAKE_DIALOGS } from '../core/browser-protocol.mjs';

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const takeDialogs = (wc) => wc.executeJavaScript(TAKE_DIALOGS).catch(() => []);

export function electronDriver(T) {
  return {
    async load(tab, url) {
      const wc = tab.win.webContents;
      let failure = null;
      await Promise.race([
        wc.loadURL(url).catch((e) => { if (!/ERR_ABORTED/.test(e.message)) failure = e.message; }),
        new Promise((r) => setTimeout(r, 25_000))
      ]);
      // An HTTP error status (404, 500…) still renders the server's page: the agent sees it. Anything else never loaded.
      if (failure && !/ERR_HTTP_RESPONSE_CODE_FAILURE/.test(failure)) throw new Error(T('sys.browser.openFailed', { url, error: failure.replace(/^.*?(ERR_\w+).*$/s, '$1') }));
    },
    world: (tab, code) => tab.win.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], true),
    loading: (tab) => tab.win.webContents.isLoading(),
    async click(tab, x, y) {
      const wc = tab.win.webContents;
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    },
    focusPage: (tab) => tab.win.webContents.focus(),
    insertText: (tab, text) => tab.win.webContents.insertText(text),
    press(tab, def) {
      const wc = tab.win.webContents;
      wc.sendInputEvent({ type: 'keyDown', keyCode: def.electron });
      if (def.text) wc.sendInputEvent({ type: 'char', keyCode: def.text });
      wc.sendInputEvent({ type: 'keyUp', keyCode: def.electron });
    },
    back(tab) { const h = tab.win.webContents.navigationHistory; if (!h.canGoBack()) return false; h.goBack(); return true; },
    async capture(tab) {
      const wc = tab.win.webContents;
      if (!tab.painting) { wc.startPainting(); wc.invalidate(); await settle(200); }
      let img; try { img = (await wc.capturePage()).resize({ width: 1024, quality: 'good' }); } finally { if (!tab.painting && !tab.win.isDestroyed()) wc.stopPainting(); }
      return img.toJPEG(70).toString('base64');
    },
    url: (tab) => tab.win.webContents.getURL(),
    takeDialogs: (tab) => takeDialogs(tab.win.webContents),
    setDialogAnswer: (tab, answer) => tab.win.webContents.executeJavaScript(dialogsHook(answer)).catch(() => {}),
    kill: (tab) => tab.win.webContents.forcefullyCrashRenderer()
  };
}
