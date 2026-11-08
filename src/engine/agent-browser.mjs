// 3.8.1 (D2): the agents' browser without Electron, so it can live in the engine: its pages, the control pipe the MCP
// servers of the agents speak (src/core/browser-protocol.mjs › servePipe, with the key of each conversation) and the
// DevTools driver (src/engine/browser-cdp.mjs). Electron's own browser (src/main/browser.mjs) stays until Electron goes.
//
// Where the pages come from is the app's business (windows):
//   endpoint() → the browser's DevTools endpoint (ws://127.0.0.1:<port>/devtools/browser/<id>); may start it
//   open(key) → the targetId of a new, empty page (Tauri: a hidden WebView2 window of the agents' own browser
//               environment, asked with host.browser.open; the tests: a page of a headless Edge)
//   close(targetId)
// The little live window (PiP) and its screencast come with the Tauri windows (step D7): onActivity(tab) tells it what
// the agent is doing.
import crypto from 'node:crypto';
import { translate } from '../core/i18n.mjs';
import { MAX_TABS, allowed, createActions, servePipe } from '../core/browser-protocol.mjs';
import { connectCdp } from './cdp.mjs';
import { attachPage, cdpDriver } from './browser-cdp.mjs';

export const IDLE_MS = 10 * 60_000; // a page no turn uses goes after this

export function createCdpBrowser({ windows, language = () => 'es', log = () => {}, onActivity = () => {}, idleMs = IDLE_MS }) {
  const T = (key, vars) => translate(language() === 'en' ? 'en' : 'es', key, vars);
  const token = crypto.randomBytes(24).toString('hex');
  const tabs = new Map(); // conversation key -> tab
  let cdp = null; let connecting = null;

  // One connection to the browser, made when the first page is needed (and again if it went away).
  async function browser() {
    if (cdp) return cdp;
    connecting ??= (async () => {
      const c = await connectCdp(await windows.endpoint());
      await c.send('Target.setDiscoverTargets', { discover: true });
      // No downloads (as Electron's will-download), whatever the page tries.
      await c.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
      const byTarget = (id) => [...tabs.values()].find((t) => t.page?.targetId === id);
      // A popup (window.open, target=_blank) opens in the same page, as in Electron: never another window. It is born
      // blank and gets its address a moment later: closed then (or after 10 s), and its address opened in its opener.
      const popups = new Map(); // targetId -> { opener, timer }
      const popup = (targetId, url) => {
        const p = popups.get(targetId); if (!p) return;
        if (url !== null && !allowed(url)) return; // still blank
        popups.delete(targetId); clearTimeout(p.timer);
        c.send('Target.closeTarget', { targetId }).catch(() => {});
        if (url && tabs.get(p.opener.key) === p.opener) p.opener.page.send('Page.navigate', { url }).catch(() => {});
      };
      c.on('Target.targetCreated', ({ targetInfo: i }) => {
        const opener = i.openerId ? byTarget(i.openerId) : null;
        if (!opener || i.type !== 'page') return;
        popups.set(i.targetId, { opener, timer: setTimeout(() => popup(i.targetId, null), 10_000) });
        popup(i.targetId, i.url);
      });
      c.on('Target.targetInfoChanged', ({ targetInfo: i }) => {
        if (popups.has(i.targetId)) return popup(i.targetId, i.url);
        const t = byTarget(i.targetId); if (t) { t.title = i.title; t.url = i.url; }
      });
      c.on('Target.targetDestroyed', ({ targetId }) => { const t = byTarget(targetId); if (t) t.crashed = true; });
      c.on('Target.targetCrashed', ({ targetId }) => { const t = byTarget(targetId); if (t) t.crashed = true; });
      c.closed.then(() => { cdp = null; for (const t of tabs.values()) t.crashed = true; });
      cdp = c;
      return c;
    })().finally(() => { connecting = null; });
    return connecting;
  }

  async function newTab(key, { agent, task }) {
    if (tabs.size >= MAX_TABS) {
      // Only a page no agent is using makes room; pages in use are never taken away.
      const idle = [...tabs.values()].filter((t) => t.users <= 0).sort((a, b) => a.used - b.used)[0];
      if (!idle) throw new Error(T('sys.browser.full', { n: MAX_TABS }));
      closeTab(idle);
    }
    const c = await browser();
    const targetId = await windows.open(key);
    const tab = { key, agent, task, users: 0, timer: null, url: '', title: '', loading: false, used: Date.now(), action: '', console: [], dialogAnswer: { accept: false, text: '' }, page: null };
    try { await attachPage(c, targetId, tab); } catch (error) { try { await windows.close(targetId); } catch { /* gone */ } throw error; }
    tabs.set(key, tab);
    return tab;
  }
  function closeTab(tab) {
    if (!tab) return;
    if (tabs.get(tab.key) === tab) tabs.delete(tab.key);
    clearTimeout(tab.timer);
    if (tab.page) Promise.resolve(windows.close(tab.page.targetId)).catch(() => {});
  }

  const actions = createActions({ driver: cdpDriver(T), T, language });
  // What the agent is doing, for the little window (in the language of the settings).
  const DESCRIBE = { open: (a) => T('sys.browser.do.open', { url: a.url }), click: (a) => (a.ref !== undefined ? T('sys.browser.do.clickRef', { ref: a.ref }) : T('sys.browser.do.clickAt', { x: a.x, y: a.y })), type: (a) => T('sys.browser.do.type', { text: String(a.text ?? '').slice(0, 40) }), press: (a) => T('sys.browser.do.press', { key: a.key }), scroll: (a) => T(a.direction === 'up' ? 'sys.browser.do.scrollUp' : 'sys.browser.do.scrollDown'), back: () => T('sys.browser.do.back'), wait: () => T('sys.browser.do.wait'), snapshot: () => T('sys.browser.do.snapshot'), screenshot: () => T('sys.browser.do.screenshot'), dialog: (a) => T(a.accept === false ? 'sys.browser.do.dialogCancel' : 'sys.browser.do.dialogAccept'), console: () => T('sys.browser.do.console') };

  const served = servePipe({
    token, T, log, actions,
    pages: { get: (key) => tabs.get(key), dead: (tab) => Boolean(tab.crashed || tab.page?.gone), create: (key, who) => newTab(key, who), close: (tab) => closeTab(tab) },
    before(tab, action, args) { tab.used = Date.now(); tab.action = DESCRIBE[action]?.(args) ?? action; try { onActivity(tab, action); } catch { /* never in the way */ } },
    // The agent's turn ended: the page waits for the conversation's next turn and then goes.
    released(tab) { tab.timer = setTimeout(() => { if (tab.users <= 0) closeTab(tab); }, idleMs); tab.timer.unref?.(); }
  });

  return {
    pipe: served.pipe, token, ready: served.ready,
    // 3.2.1: when a task ends Orb closes the pages it opened.
    closeTask(task) { const id = String(task ?? ''); if (!id) return; for (const t of [...tabs.values()]) if (String(t.task ?? '') === id) closeTab(t); },
    state: () => ({ tabs: [...tabs.values()].map((t) => ({ agent: t.agent, task: t.task, url: t.url, title: t.title })) }),
    shutdown() {
      served.close();
      for (const t of [...tabs.values()]) closeTab(t);
      try { cdp?.close(); } catch { /* closed */ }
    }
  };
}
