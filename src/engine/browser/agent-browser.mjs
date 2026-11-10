// 3.8.1 (D2, D7): the agents' browser, living in the engine: its pages, the control pipe the MCP servers
// of the agents speak (src/engine/browser/browser-protocol.mjs › servePipe, with the key of each conversation) and the DevTools
// driver (src/engine/browser/browser-cdp.mjs).
//
// Where the pages come from is the app's business (windows):
//   open(key) → a page: { id, send(method, params) → result, on(method, fn) → off, close() }
//     Tauri: a hidden WebView2 of the agents' own browser environment, driven by Rust with CallDevToolsProtocolMethod
//     over the engine's stdio channel (src/engine/browser/host-browser.mjs): no DevTools port anywhere. The tests: a page of a
//     headless Edge. Besides the DevTools events, a page sends Orb's own:
//       Orb.popup { url }     the page asked for a new window; none was made (Rust refuses it before it exists): its
//                             address opens in this page, as Electron did
//       Orb.blocked { kind, url }   refused by the app: navigation (not http(s)), external (another app's protocol),
//                             download, auth (an HTTP sign-in prompt), permission, file (a file chooser)
//       Orb.title { title }, Orb.crashed, Orb.dropped { count } (events of a flooding page dropped by the app)
// hooks: onActivity(tab, action) before each action; onUpdate(tab) when its address, title or loading change;
// onRelease(tab) when its turn ends; onClose(tab). The little live window (PiP) uses them (host-browser.mjs).
import crypto from 'node:crypto';
import { translate } from '../../shared/i18n.mjs';
import { MAX_TABS, createActions, servePipe } from './browser-protocol.mjs';
import { attachPage, cdpDriver } from './browser-cdp.mjs';

export const IDLE_MS = 10 * 60_000; // a page no turn uses goes after this

export function createCdpBrowser({ windows, language = () => 'es', log = () => {}, onActivity = () => {}, onUpdate = () => {}, onRelease = () => {}, onClose = () => {}, idleMs = IDLE_MS }) {
  const T = (key, vars) => translate(language() === 'en' ? 'en' : 'es', key, vars);
  const token = crypto.randomBytes(24).toString('hex');
  const tabs = new Map(); // conversation key -> tab
  const quiet = (fn) => (...a) => { try { fn(...a); } catch { /* never in the way */ } };
  const hooks = { activity: quiet(onActivity), update: quiet(onUpdate), release: quiet(onRelease), close: quiet(onClose) };

  async function newTab(key, { agent, task }) {
    if (tabs.size >= MAX_TABS) {
      // Only a page no agent is using makes room; pages in use are never taken away.
      const idle = [...tabs.values()].filter((t) => t.users <= 0).sort((a, b) => a.used - b.used)[0];
      if (!idle) throw new Error(T('sys.browser.full', { n: MAX_TABS }));
      await closeTab(idle);
    }
    const page = await windows.open(key);
    const tab = { key, agent, task, users: 0, timer: null, url: '', title: '', loading: false, used: Date.now(), action: '', console: [], dialogAnswer: { accept: false, text: '' }, page: null };
    try { await attachPage(page, tab, { onUpdate: () => hooks.update(tab) }); } catch (error) { await Promise.resolve(page.close()).catch(() => {}); throw error; }
    tabs.set(key, tab);
    return tab;
  }
  function closeTab(tab) {
    if (!tab) return Promise.resolve();
    if (tabs.get(tab.key) === tab) tabs.delete(tab.key);
    clearTimeout(tab.timer);
    hooks.close(tab);
    return tab.page ? Promise.resolve(tab.page.close()).catch(() => {}) : Promise.resolve();
  }

  const actions = createActions({ driver: cdpDriver(T), T, language });
  // What the agent is doing, for the little window (in the language of the settings).
  const DESCRIBE = { open: (a) => T('sys.browser.do.open', { url: a.url }), click: (a) => (a.ref !== undefined ? T('sys.browser.do.clickRef', { ref: a.ref }) : T('sys.browser.do.clickAt', { x: a.x, y: a.y })), type: (a) => T('sys.browser.do.type', { text: String(a.text ?? '').slice(0, 40) }), press: (a) => T('sys.browser.do.press', { key: a.key }), scroll: (a) => T(a.direction === 'up' ? 'sys.browser.do.scrollUp' : 'sys.browser.do.scrollDown'), back: () => T('sys.browser.do.back'), wait: () => T('sys.browser.do.wait'), snapshot: () => T('sys.browser.do.snapshot'), screenshot: () => T('sys.browser.do.screenshot'), dialog: (a) => T(a.accept === false ? 'sys.browser.do.dialogCancel' : 'sys.browser.do.dialogAccept'), console: () => T('sys.browser.do.console') };

  const served = servePipe({
    token, T, log, actions,
    pages: { get: (key) => tabs.get(key), dead: (tab) => Boolean(tab.crashed || tab.page?.gone), why: (tab) => tab.stopped, create: (key, who) => newTab(key, who), close: (tab) => { closeTab(tab); } },
    grabbed: (tab) => { tab.dismissed = false; }, // a new turn shows the little window again
    before(tab, action, args) { tab.used = Date.now(); tab.action = DESCRIBE[action]?.(args) ?? action; hooks.activity(tab, action); },
    // The agent's turn ended: the page waits for the conversation's next turn and then goes.
    released(tab) { hooks.release(tab); tab.timer = setTimeout(() => { if (tab.users <= 0) closeTab(tab); }, idleMs); tab.timer.unref?.(); }
  });

  return {
    pipe: served.pipe, token, ready: served.ready,
    tabs: () => [...tabs.values()],
    // 3.2.1: when a task ends Orb closes the pages it opened.
    closeTask(task) { const id = String(task ?? ''); if (!id) return; for (const t of [...tabs.values()]) if (String(t.task ?? '') === id) closeTab(t); },
    state: () => ({ tabs: [...tabs.values()].map((t) => ({ agent: t.agent, task: t.task, url: t.url, title: t.title })) }),
    shutdown() {
      served.close();
      for (const t of [...tabs.values()]) closeTab(t);
    }
  };
}
