// 3.8.1 (D7): the agents' browser under Tauri. Its pages are hidden WebView2 windows that Rust makes in a browser
// environment of their own (another data folder, so another browser process: Orb's window is never in it) and drives
// with CallDevToolsProtocolMethod. Nothing listens on a port: the engine reaches a page only through its own stdio
// channel with the app (src-tauri/src/browser.rs):
//   engine → app  host.browser.open → { page }, host.browser.cdp { page, method, params } → result, host.browser.close
//   app → engine  { type: 'browserEvent', page, method, params }   the page's DevTools events and Orb.* (agent-browser.mjs)
// Rust itself enforces the limits a page cannot get past whatever the engine asks: only http(s) addresses, no other app's
// protocol, no new windows (refused before they exist), no permissions, no downloads, no HTTP sign-in prompts, sound off,
// and only the DevTools methods the driver uses (src-tauri/src/browser_rules.rs).
//
// And the little live window (PiP) in the top-right corner: what the agent is doing on its page, as Electron's. Its
// pictures come from Page.startScreencast while it is shown (not as a pill), at most 4 a second. A page keeps at most two
// frames unacknowledged, and the engine acknowledges them only once the app has taken a picture (the newest): one frame
// at a time towards the window, at most two from the page, so a slow app slows the pictures down instead of
// piling them up in the pipes (src/engine/stdio.mjs).
import { hostCall } from './host.mjs';
import { createCdpBrowser } from './agent-browser.mjs';

const FRAME_MS = 250;
const MODES = ['normal', 'grande', 'pildora'];
const HIDE_AFTER_MS = 20_000; // after a turn ends the little window keeps its last picture this long

// call: hostCall (the tests pass their own). pipEnabled(), label(agent), language(), skin(): from the settings.
export function createHostBrowser({ call = hostCall, language = () => 'es', skin = () => 'orb', label = (a) => a, pipEnabled = () => true, log = () => {}, idleMs } = {}) {
  const pages = new Map(); // page id -> listeners (method -> Set)
  const windows = {
    async open() {
      const { page: id } = await call('host.browser.open', {}, 30_000);
      const listeners = new Map();
      pages.set(id, listeners);
      return {
        id,
        send: (method, params = {}) => call('host.browser.cdp', { page: id, method, params }, 45_000),
        on(method, fn) {
          if (!listeners.has(method)) listeners.set(method, new Set());
          listeners.get(method).add(fn);
          return () => listeners.get(method)?.delete(fn);
        },
        close: () => { pages.delete(id); return call('host.browser.close', { page: id }, 10_000).catch(() => {}); }
      };
    }
  };

  // ---- the little window
  let mode = 'normal'; let pipTab = null; let shown = false; let castTab = null;
  const state = () => {
    const t = pipTab;
    return { mode, agent: t ? label(t.agent) : null, task: t?.task || null, url: t?.url ?? '', title: t?.title ?? '', loading: Boolean(t?.loading), tabs: browser.tabs().length, action: t?.action ?? '', language: language(), skin: skin() };
  };
  const sendState = () => { call('host.pip.state', { state: state() }).catch(() => {}); };
  // Pictures only of the page on show, only while the little window shows it.
  let latest = null; let busy = false; let lastSent = 0; let frameTimer = null;
  function pump() {
    if (busy || !latest) return;
    const wait = FRAME_MS - (Date.now() - lastSent);
    if (wait > 0) { if (!frameTimer) { frameTimer = setTimeout(() => { frameTimer = null; pump(); }, wait); frameTimer.unref?.(); } return; }
    const f = latest; latest = null; busy = true;
    call('host.pip.frame', { data: f.data }, 10_000).catch(() => {}).finally(() => {
      lastSent = Date.now(); busy = false;
      for (const sessionId of f.acks) f.tab.page?.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      pump();
    });
  }
  function casting() {
    const want = shown && mode !== 'pildora' && pipTab && !pipTab.crashed ? pipTab : null;
    if (want === castTab) return;
    if (castTab) { castTab.page?.send('Page.stopScreencast').catch(() => {}); castTab.offFrame?.(); castTab.offFrame = null; }
    castTab = want; latest = null;
    if (!want) return;
    want.offFrame = want.page.on('Page.screencastFrame', ({ data, sessionId }) => {
      if (castTab !== want) return;
      // A newer frame while the last one still waits for its turn: the old picture is dropped, and both are acknowledged
      // together once the newer one reaches the app.
      latest = { tab: want, data, acks: [...(latest?.acks ?? []), sessionId] }; pump();
    });
    const big = mode === 'grande';
    want.page.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: big ? 1280 : 820, maxHeight: big ? 800 : 560, everyNthFrame: 1 }).catch((error) => log(`navegador del agente: screencast: ${error.message}`));
  }
  function show(tab, { force = false } = {}) {
    pipTab = tab;
    if (!pipEnabled() || (tab.dismissed && !force)) { sendState(); casting(); return; }
    sendState();
    if (!shown) { shown = true; call('host.pip.show', { mode }).catch(() => {}); }
    casting();
  }
  function hide() { if (shown) { shown = false; call('host.pip.hide').catch(() => {}); } casting(); }
  function setMode(next) {
    if (!MODES.includes(next)) return;
    mode = next;
    if (shown) call('host.pip.show', { mode }).catch(() => {});
    sendState();
    if (castTab) { const t = castTab; castTab = null; t.page?.send('Page.stopScreencast').catch(() => {}); t.offFrame?.(); t.offFrame = null; }
    casting();
  }

  const browser = createCdpBrowser({
    windows, language, log, idleMs,
    onActivity(tab, action) { if (action === 'open') { tab.dismissed = false; show(tab, { force: true }); } else show(tab); },
    onUpdate(tab) { if (tab === pipTab) sendState(); },
    // The agent's turn ended: the little window keeps its last picture for a moment and hides.
    onRelease(tab) { clearTimeout(tab.hideTimer); tab.hideTimer = setTimeout(() => { if (tab.users <= 0 && tab === pipTab) hide(); }, HIDE_AFTER_MS); tab.hideTimer.unref?.(); },
    onClose(tab) {
      clearTimeout(tab.hideTimer);
      if (tab === castTab) { castTab = null; tab.offFrame?.(); latest = null; }
      if (tab !== pipTab) return;
      pipTab = browser.tabs().filter((t) => t !== tab).sort((a, b) => b.used - a.used)[0] ?? null;
      if (!pipTab) hide(); else { sendState(); casting(); }
    }
  });

  return {
    pipe: browser.pipe, token: browser.token, ready: browser.ready,
    closeTask: (task) => browser.closeTask(task),
    state: () => ({ ...browser.state(), pip: shown }),
    // An event of one of the pages (from the app).
    event(msg) {
      const listeners = pages.get(msg?.page); if (!listeners) return;
      for (const fn of listeners.get(String(msg.method ?? '')) ?? []) { try { fn(msg.params ?? {}); } catch (error) { log(`navegador del agente: ${msg.method}: ${error.message}`); } }
    },
    // The little window's buttons, and Ajustes › «Ver el navegador» (show): answers with the state.
    pip(action) {
      if (MODES.includes(action)) setMode(action);
      else if (action === 'cerrar') { if (pipTab) pipTab.dismissed = true; hide(); }
      else if (action === 'show' && pipTab) show(pipTab, { force: true });
      else if (action === 'loaded') sendState();
      return { ...browser.state(), pip: shown };
    },
    shutdown() { clearTimeout(frameTimer); browser.shutdown(); hide(); }
  };
}
