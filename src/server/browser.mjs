// 3.7 (WS5): Orb Server's browser. The same agents' browser as the app's (src/main/browser.mjs): the same pipe and the
// same tools (src/core/browser-protocol.mjs), so src/mcp/server.mjs does not know which one it talks to. Here the pages
// are a real Chromium driven by the pinned playwright-core:
//   · headful inside a virtual screen of its own (Xvfb :N, one per launch), which sites take for a person's browser far
//     more than a headless one; headless only where asked (the tests, or a server without Xvfb on purpose);
//   · one persistent profile per person (~/orb-server/browser/<person>/): the sign-ins a person makes in the live view
//     stay, and only for that person;
//   · launched when a bot first needs it and closed after 3 idle minutes; at most one Chromium at a time (orb.json
//     browser.server.instances: 2), the others wait their turn; never launched with less than 1.2 GB of memory free;
//     each Chromium in its own systemd scope (MemoryMax 1.5 GB, OOMScoreAdjust 500): when memory runs out, the kernel
//     kills the browser, not Orb;
//   · «Ver navegador del Server» (src/server/screencast.mjs): the person sees a page live and uses it; while they do,
//     the bots' actions on their pages wait with «el usuario está usando el navegador»;
//   · a CAPTCHA or a sign-in code: no tricks, the person is asked to do it («Necesito que lo hagas tú»).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { translate } from '../core/i18n.mjs';
import { VIEW, MAX_TABS, allowed, normalizeUrl, createActions, servePipe } from '../core/browser-protocol.mjs';
import { ensureChromium } from './browser-engine.mjs';
import { confineArgs } from '../agents/common.mjs';
import { createScreencast } from './screencast.mjs';

export const SERVER_BROWSER = Object.freeze({ minMemMB: 1200, instances: 1, maxInstances: 2, idleMs: 3 * 60_000, pageIdleMs: 10 * 60_000, queueMs: 45_000,
  memoryMax: '1536M', oomScore: 500, userLockMs: 30_000, challengeMs: 10 * 60_000 });
export const FLAGS = Object.freeze(['--renderer-process-limit=2', '--disable-dev-shm-usage', '--disable-gpu']);
// What the bots may not do while the person uses the page (reading it is fine).
const MUTATING = new Set(['open', 'click', 'type', 'press', 'scroll', 'back', 'dialog', 'vault_fill']);

// MemAvailable of /proc/meminfo in MB (null where there is none: not Linux).
export function memAvailableMB(read = () => fs.readFileSync('/proc/meminfo', 'utf8')) {
  try { const m = /MemAvailable:\s+(\d+)\s*kB/.exec(read()); return m ? Math.floor(Number(m[1]) / 1024) : null; } catch { return null; }
}

// A virtual screen of its own for one Chromium: Xvfb picks a free display and writes its number on fd 3.
export function startXvfb({ T = (k) => k, spawnImpl = spawn, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    try { proc = spawnImpl('Xvfb', ['-displayfd', '3', '-screen', '0', `${VIEW.width}x${VIEW.height}x24`, '-nolisten', 'tcp', '-noreset'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'], windowsHide: true }); }
    catch (error) { reject(error?.code === 'ENOENT' ? Object.assign(new Error(T('sys.browser.noXvfb')), { code: 'NO_XVFB' }) : error); return; }
    let out = ''; let done = false;
    const finish = (err, value) => { if (done) return; done = true; clearTimeout(timer); if (err) { try { proc.kill(); } catch { /* gone */ } reject(err); } else resolve(value); };
    const timer = setTimeout(() => finish(new Error(T('sys.browser.xvfbFailed'))), timeoutMs);
    proc.once('error', (e) => finish(e?.code === 'ENOENT' ? Object.assign(new Error(T('sys.browser.noXvfb')), { code: 'NO_XVFB' }) : e));
    proc.once('exit', () => finish(new Error(T('sys.browser.xvfbFailed'))));
    proc.stdio[3]?.setEncoding?.('utf8');
    proc.stdio[3]?.on('data', (d) => {
      out += d;
      const n = /^(\d+)\s*$/m.exec(out)?.[1];
      if (n) finish(null, { display: `:${n}`, proc, stop() { try { proc.kill(); } catch { /* gone */ } } });
    });
  });
}

// Each Chromium in a systemd scope of the user's (when there is one): its memory limit and «kill me first».
let scopeOk = null;
export function systemdScope(check = () => spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', '-p', 'MemoryMax=64M', 'true'], { stdio: 'ignore', timeout: 8000, windowsHide: true })) {
  if (process.platform !== 'linux') return false;
  if (scopeOk == null) { try { const r = check(); scopeOk = !r.error && r.status === 0; } catch { scopeOk = false; } }
  return scopeOk;
}
// The script Chromium is started through on Linux: its own systemd scope (memory cap) when there is one, and
// no_new_privs (setpriv) when the admin helper is installed, like the agents (src/agents/common.mjs › confineArgs): a
// Chromium bug that escapes its sandbox must not reach `sudo -n orb-server-admin`. confine: { setpriv } | null.
// Residual: under no_new_privs a setuid chrome-sandbox cannot work; Orb's own Chromium (an unpacked zip) never has one
// and uses the user-namespace sandbox, and where the kernel/AppArmor denies that, the launch falls back without it (logged).
export function scopeWrapper(exe, dir, { memoryMax = SERVER_BROWSER.memoryMax, oomScore = SERVER_BROWSER.oomScore, scope = true, confine = null } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'chromium-en-su-scope.sh');
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const nnp = confine?.setpriv ? `${q(confine.setpriv)} --no-new-privs -- ` : '';
  const run = scope ? `systemd-run --user --scope --quiet --collect -p MemoryMax=${memoryMax} -- ${q(exe)}` : q(exe);
  // The OOM score is raised here too (it is inherited, and only lowering it needs privileges).
  fs.writeFileSync(file, `#!/bin/sh\necho ${Number(oomScore)} > /proc/self/oom_score_adj 2>/dev/null\nexec ${nnp}${run} "$@"\n`, { mode: 0o700 });
  return file;
}

// no_new_privs for Chromium: only on Linux with the admin helper installed (then setpriv is required, as for agents).
export function chromiumConfine({ platform = process.platform, helper, setpriv } = {}) {
  if (platform !== 'linux') return null;
  const c = confineArgs('chromium', [], { platform, ...(helper !== undefined ? { helper } : {}), ...(setpriv !== undefined ? { setpriv } : {}) });
  return c.cmd === 'chromium' ? null : { setpriv: c.cmd };
}

const safeName = (s) => String(s || 'owner').replace(/[^\w-]/g, '_').slice(0, 60) || 'owner';

// options: language(); ownerId() (whose profile an empty person is); root: the profiles' folder; config(): orb.json's
// «browser»; display: 'xvfb' | 'headless' | 'auto'; onHuman({ person, kind, url, title }) (a CAPTCHA or a code);
// vaultFill (WS6); for the tests: readMeminfo, launchContext(dir, options), executable, scope (bool), confine ({ setpriv } | null).
export function createServerBrowser({ language = () => 'es', ownerId = () => 'owner', root = path.join(os.homedir(), 'orb-server', 'browser'), enginesRoot = null, config = () => ({}), display = 'auto',
  onHuman = null, vaultFill = null, log = () => {}, readMeminfo, launchContext = null, executable = null, scope = null, confine = undefined, timings = {} } = {}) {
  const T = (key, vars) => translate(language() === 'en' ? 'en' : 'es', key, vars);
  const token = crypto.randomBytes(24).toString('hex');
  const opt = () => { const c = config()?.server ?? {}; return { ...SERVER_BROWSER, ...timings, instances: Math.min(SERVER_BROWSER.maxInstances, Math.max(1, Number(c.instances ?? timings.instances) || SERVER_BROWSER.instances)) }; };
  const tabs = new Map(); // conversation key -> tab
  const instances = new Map(); // person -> { person, context, xvfb, tabs: Set, lastUsed, ready, launching }
  const lives = new Map(); // sid -> { sid, person, device, tab, cast, lastTouch }
  let waiters = [];
  const wake = () => { const w = waiters; waiters = []; for (const fn of w) fn(); };
  const personOf = (p) => String(p || ownerId() || 'owner');
  const liveOf = (person) => [...lives.values()].filter((l) => l.person === person);
  const userActive = (person) => liveOf(person).some((l) => Date.now() - l.lastTouch < opt().userLockMs);
  const busy = (inst) => inst.launching || [...inst.tabs].some((t) => t.users > 0) || liveOf(inst.person).length > 0;

  // ---- one Chromium per person (a persistent profile)
  async function launch(inst) {
    const o = opt();
    const free = memAvailableMB(readMeminfo);
    if (free != null && free < o.minMemMB) throw Object.assign(new Error(T('sys.browser.lowMemory', { free, need: o.minMemMB })), { code: 'LOW_MEMORY' });
    const dir = path.join(root, safeName(inst.person));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const mode = display === 'auto' ? (process.platform === 'linux' ? 'xvfb' : 'headless') : display;
    if (mode === 'xvfb') inst.xvfb = await startXvfb({ T });
    try {
      const cfg = config() ?? {};
      let exe = executable ?? await ensureChromium({ config: cfg, log, ...(enginesRoot ? { dir: enginesRoot } : {}) });
      const scoped = scope ?? systemdScope();
      const confined = confine === undefined ? chromiumConfine() : confine;
      if ((scoped || confined) && exe) exe = scopeWrapper(exe, path.join(root, '.orb'), { scope: Boolean(scoped), confine: confined });
      else if (confined && !exe) throw new Error('Chromium del Server: hace falta su ruta para arrancarlo con no_new_privs');
      // Chromium gets only what it needs of the environment (never Orb's keys or tokens).
      const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'ProgramFiles', 'ProgramFiles(x86)'].filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]));
      if (inst.xvfb) env.DISPLAY = inst.xvfb.display;
      const options = { headless: mode !== 'xvfb', ...(exe ? { executablePath: exe } : {}), ...(cfg.channel && !exe ? { channel: cfg.channel } : {}), args: [...FLAGS], env, viewport: VIEW, acceptDownloads: false,
        locale: language() === 'en' ? 'en-US' : 'es-ES', handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, timeout: 60_000, chromiumSandbox: cfg.sandbox ?? process.platform === 'linux' };
      const go = launchContext ?? (async (d, opts) => (await import('playwright-core')).chromium.launchPersistentContext(d, opts));
      let context;
      try { context = await go(dir, options); }
      catch (error) {
        // A server whose kernel does not let Chromium make its sandbox: once more without it (logged).
        if (!options.chromiumSandbox || !/sandbox|namespace|zygote/i.test(String(error?.message))) throw error;
        log('navegador del Server: Chromium no puede usar su sandbox en este servidor; sigo sin ella');
        context = await go(dir, { ...options, chromiumSandbox: false });
      }
      inst.context = context;
      inst.spare = context.pages()[0] ?? null;
      context.on('close', () => dropInstance(inst));
      log(`navegador del Server: abierto para ${inst.person}${inst.xvfb ? ` en ${inst.xvfb.display}` : ''}`);
      return inst;
    } catch (error) { inst.xvfb?.stop(); inst.xvfb = null; throw error; }
  }
  async function acquire(person) {
    const have = instances.get(person);
    if (have) return have.ready;
    const o = opt();
    const deadline = Date.now() + o.queueMs;
    while (instances.size >= o.instances) {
      if (instances.has(person)) return instances.get(person).ready;
      // Someone's Chromium nobody is using makes room at once; otherwise this one waits its turn.
      const idle = [...instances.values()].find((i) => !busy(i));
      if (idle) { await closeInstance(idle, 'turno'); continue; }
      const left = deadline - Date.now();
      if (left <= 0) throw Object.assign(new Error(T('sys.browser.serverBusy')), { code: 'BUSY' });
      await new Promise((r) => { waiters.push(r); setTimeout(r, Math.min(1000, left)); });
    }
    const inst = { person, context: null, xvfb: null, tabs: new Set(), lastUsed: Date.now(), launching: true, spare: null };
    instances.set(person, inst);
    inst.ready = launch(inst).then((i) => { i.launching = false; i.lastUsed = Date.now(); return i; }, (error) => { if (instances.get(person) === inst) instances.delete(person); wake(); throw error; });
    return inst.ready;
  }
  function dropInstance(inst) {
    if (instances.get(inst.person) === inst) instances.delete(inst.person);
    for (const t of [...inst.tabs]) forget(t);
    inst.xvfb?.stop(); inst.xvfb = null;
    wake();
  }
  async function closeInstance(inst, why = 'inactivo') {
    if (instances.get(inst.person) !== inst) return;
    instances.delete(inst.person);
    for (const l of liveOf(inst.person)) await l.cast.stop('closed').catch(() => {});
    try { await inst.context?.close(); } catch { /* gone */ }
    log(`navegador del Server: cerrado (${why}) para ${inst.person}`);
    dropInstance(inst);
  }
  // The 3 idle minutes: nobody using its pages, no live view, nothing done.
  const sweeper = setInterval(() => {
    const o = opt();
    for (const inst of [...instances.values()]) if (!busy(inst) && Date.now() - inst.lastUsed >= o.idleMs) closeInstance(inst).catch(() => {});
  }, Math.max(50, Math.min(15_000, Math.floor(opt().idleMs / 3))));
  sweeper.unref?.();

  // ---- pages
  function forget(tab) {
    if (tabs.get(tab.key) === tab) tabs.delete(tab.key);
    tab.inst?.tabs.delete(tab);
    clearTimeout(tab.timer);
    tab.closed = true;
  }
  async function closeTab(tab) {
    if (!tab) return;
    forget(tab);
    for (const l of [...lives.values()]) if (l.tab === tab) await l.cast.stop('closed').catch(() => {});
    try { await tab.page.close(); } catch { /* gone */ }
  }
  async function newTab(key, who) {
    const person = personOf(who.person);
    const inst = await acquire(person);
    inst.lastUsed = Date.now();
    if (inst.tabs.size >= MAX_TABS) {
      const idle = [...inst.tabs].filter((t) => t.users <= 0).sort((a, b) => a.used - b.used)[0];
      if (!idle) throw new Error(T('sys.browser.full', { n: MAX_TABS }));
      await closeTab(idle);
    }
    const page = inst.spare ?? await inst.context.newPage(); inst.spare = null;
    const cdp = await inst.context.newCDPSession(page);
    const tab = { key, agent: who.agent, task: who.task, person, inst, page, cdp, users: 0, timer: null, used: Date.now(), console: [], dialogs: [], dialogAnswer: { accept: false, text: '' }, loading: false, ctxId: null, crashed: false, closed: false, challenged: null };
    await cdp.send('Page.enable');
    const main = (await cdp.send('Page.getFrameTree'))?.frameTree?.frame?.id;
    cdp.on('Page.frameNavigated', (e) => { if (!e.frame?.parentId) tab.ctxId = null; });
    cdp.on('Page.frameStartedLoading', (e) => { if (e.frameId === main) tab.loading = true; });
    cdp.on('Page.frameStoppedLoading', (e) => { if (e.frameId === main) tab.loading = false; });
    const note = (level, message, source = '', line = 0) => { tab.console.push({ level, message: String(message ?? '').slice(0, 500), source: String(source ?? '').slice(0, 200), line: Number(line) || 0 }); if (tab.console.length > 200) tab.console.shift(); };
    page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') { const l = m.location?.() ?? {}; note(t, m.text(), l.url, l.lineNumber); } });
    page.on('pageerror', (e) => note('error', e?.message ?? e));
    page.on('requestfailed', (r) => { if (r.resourceType() === 'document' && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) note('error', `page did not load: ${r.failure()?.errorText ?? ''}`, r.url()); });
    page.on('crash', () => { tab.crashed = true; });
    page.on('close', () => { forget(tab); for (const l of [...lives.values()]) if (l.tab === tab) l.cast.stop('closed').catch(() => {}); });
    // alert/confirm/prompt answered as the agent said (cancel by default) and kept to tell it; «leave this page?» never
    // blocks.
    page.on('dialog', async (d) => {
      const type = d.type(); const a = tab.dialogAnswer; let result;
      try {
        if (type === 'beforeunload') { await d.accept(); return; }
        if (type === 'alert') await d.dismiss();
        else if (a.accept) { result = type === 'prompt' ? (a.text || d.defaultValue()) : true; await d.accept(type === 'prompt' ? result : undefined); }
        else { result = type === 'prompt' ? null : false; await d.dismiss(); }
      } catch { /* the page went away */ }
      tab.dialogs.push({ type, message: d.message(), result }); if (tab.dialogs.length > 50) tab.dialogs.shift();
    });
    // Popups open in the same page; no file choosers (the server's files are not the agent's); no downloads.
    page.on('popup', async (p) => {
      try { await p.waitForURL((u) => String(u) !== 'about:blank', { timeout: 3000 }); } catch { /* stays blank */ }
      const u = p.url(); await p.close().catch(() => {});
      if (allowed(u)) page.goto(u).catch(() => {});
    });
    page.on('filechooser', () => {});
    tabs.set(key, tab); inst.tabs.add(tab);
    return tab;
  }

  // ---- what this browser does with one page (the shared actions use it)
  const driver = {
    async world(tab, code) {
      for (let attempt = 0; ; attempt++) {
        try {
          if (!tab.ctxId) {
            const { frameTree } = await tab.cdp.send('Page.getFrameTree');
            tab.ctxId = (await tab.cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'orb' })).executionContextId;
          }
          const r = await tab.cdp.send('Runtime.evaluate', { expression: code, contextId: tab.ctxId, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw Object.assign(new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'error'), { page: true });
          return r.result?.value;
        } catch (error) {
          if (error.page || attempt >= 2 || !/context|target|frame/i.test(String(error?.message))) throw error;
          tab.ctxId = null; // the page navigated: its world went with the document
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    },
    async load(tab, url) {
      try { await tab.page.goto(url, { timeout: 25_000, waitUntil: 'load' }); } catch (error) {
        const m = String(error?.message ?? error);
        if (/Timeout|ERR_ABORTED|frame was detached/i.test(m)) return;
        throw new Error(T('sys.browser.openFailed', { url, error: /net::(ERR_\w+)/.exec(m)?.[1] ?? m.split('\n')[0].slice(0, 120) }));
      }
    },
    loading: (tab) => tab.loading,
    click: (tab, x, y) => tab.page.mouse.click(x, y),
    focusPage: () => {},
    insertText: (tab, text) => tab.page.keyboard.insertText(text),
    press: (tab, def, name) => tab.page.keyboard.press(name),
    async back(tab) {
      const h = await tab.cdp.send('Page.getNavigationHistory').catch(() => null);
      if (!h || h.currentIndex <= 0) return false;
      await tab.page.goBack({ timeout: 8000 }).catch(() => {});
      return true;
    },
    capture: async (tab) => (await tab.page.screenshot({ type: 'jpeg', quality: 70, timeout: 15_000 })).toString('base64'),
    url: (tab) => tab.page.url(),
    takeDialogs: (tab) => tab.dialogs.splice(0),
    setDialogAnswer: () => {},
    kill: (tab) => { tab.page.close().catch(() => {}); }
  };
  // A CAPTCHA or a sign-in code: the person is told once per page (10 min) and the agent is told to wait for them.
  async function onChallenge(tab, kind, snap) {
    const now = Date.now();
    const seen = tab.challenged;
    if (!seen || seen.url !== snap.url || now - seen.at > opt().challengeMs) {
      tab.challenged = { url: snap.url, at: now };
      try { await onHuman?.({ person: tab.person, agent: tab.agent, kind, url: snap.url, title: snap.title }); } catch (error) { log(`navegador del Server: aviso: ${error.message}`); }
    }
    return T(kind === 'captcha' ? 'sys.browser.humanCaptcha' : 'sys.browser.humanCode');
  }
  const actions = createActions({ driver, T, language, onChallenge, vaultFill });

  const served = servePipe({
    token, T, log, actions,
    pages: { get: (key) => tabs.get(key), dead: (tab) => tab.closed || tab.crashed || tab.page.isClosed(), create: (key, who) => newTab(key, who), close: (tab) => { closeTab(tab).catch(() => {}); } },
    before(tab, action) {
      tab.used = Date.now(); if (tab.inst) tab.inst.lastUsed = Date.now();
      if (MUTATING.has(action) && userActive(tab.person)) throw new Error(T('sys.browser.userBusy'));
    },
    released(tab) {
      if (tab.inst) tab.inst.lastUsed = Date.now();
      wake();
      tab.timer = setTimeout(() => { if (tab.users <= 0 && !liveOf(tab.person).some((l) => l.tab === tab)) closeTab(tab).catch(() => {}); }, opt().pageIdleMs);
      tab.timer.unref?.();
    }
  });

  // ---- «Ver navegador del Server»: one live view per person at a time (another device takes it over).
  const live = {
    // → { sid, width, height, url, title }
    async start({ person, device, width, dpr, url = null, quality, send, onStop = () => {} }) {
      const me = personOf(person);
      for (const l of liveOf(me)) await l.cast.stop('replaced').catch(() => {});
      let tab = [...tabs.values()].filter((t) => t.person === me && !t.closed && !t.crashed).sort((a, b) => b.used - a.used)[0];
      if (!tab) tab = await newTab(`live:${me}`, { agent: 'live', task: '', person: me });
      if (url) await driver.load(tab, normalizeUrl(url, language() === 'en' ? 'en' : 'es'));
      const sid = crypto.randomBytes(12).toString('hex');
      tab.users++; clearTimeout(tab.timer);
      const entry = { sid, person: me, device: String(device ?? ''), tab, cast: null, lastTouch: 0 };
      entry.cast = createScreencast({ cdp: tab.cdp, width, dpr, quality, ...(timings.live ?? {}),
        send: (f) => send({ sid, ...f }),
        onInput: () => { entry.lastTouch = Date.now(); if (tab.inst) tab.inst.lastUsed = Date.now(); },
        onStop: (reason) => { if (lives.get(sid) === entry) { lives.delete(sid); tab.users--; if (tab.inst) tab.inst.lastUsed = Date.now(); if (!tab.closed && tab.users <= 0) live.release(tab); } try { onStop(reason, sid); } catch { /* never in the way */ } } });
      lives.set(sid, entry);
      const size = await entry.cast.start();
      return { sid, ...size, url: tab.page.url(), title: await tab.page.title().catch(() => '') };
    },
    release(tab) { tab.timer = setTimeout(() => { if (tab.users <= 0) closeTab(tab).catch(() => {}); }, opt().pageIdleMs); tab.timer.unref?.(); },
    // Only the person (and the device) that opened it.
    mine(sid, { person, device }) {
      const l = lives.get(String(sid ?? ''));
      if (!l) throw Object.assign(new Error(T('sys.browser.liveGone')), { code: 'GONE' });
      if (l.person !== personOf(person) || l.device !== String(device ?? '')) throw Object.assign(new Error(T('sys.browser.liveNotYours')), { code: 'NOT_YOURS' });
      return l;
    },
    // { ack: seq } | { pause: bool } | { release: true } | { events: [...] } | { go: address } | { back: true }
    async input(sid, who, { ack, pause, release, events, go = null, back = false } = {}) {
      const l = live.mine(sid, who);
      if (ack != null) l.cast.ack(ack);
      if (pause != null) await l.cast.pause(pause === true);
      if (release === true) l.lastTouch = 0; // «Devolver al bot»
      if (Array.isArray(events)) { if (events.length > 20) throw new Error(T('sys.browser.liveTooMany')); for (const ev of events) await l.cast.input(ev); }
      // The view's address bar (http and https only, as the bots' browser) and «Atrás»: the person is using it.
      if (go || back) {
        l.lastTouch = Date.now(); if (l.tab.inst) l.tab.inst.lastUsed = Date.now();
        if (go) await driver.load(l.tab, normalizeUrl(go, language() === 'en' ? 'en' : 'es'));
        else await l.tab.page.goBack({ timeout: 15_000 }).catch(() => null);
      }
      return { ok: true, using: Date.now() - l.lastTouch < opt().userLockMs, url: l.tab.closed ? '' : l.tab.page.url() };
    },
    async stop(sid, who) { const l = live.mine(sid, who); await l.cast.stop('stopped'); return { ok: true }; },
    using: (person) => userActive(personOf(person)),
    list: () => [...lives.values()].map((l) => ({ sid: l.sid, person: l.person, device: l.device, url: l.tab.page.url() }))
  };

  return {
    pipe: served.pipe, token, ready: served.ready, live,
    closeTask(task) { const id = String(task ?? ''); if (!id) return; for (const t of [...tabs.values()]) if (String(t.task ?? '') === id) closeTab(t).catch(() => {}); },
    state: () => ({ instances: [...instances.values()].map((i) => ({ person: i.person, tabs: i.tabs.size, launching: i.launching, display: i.xvfb?.display ?? null })), tabs: [...tabs.values()].map((t) => ({ agent: t.agent, task: t.task, person: t.person, url: t.closed ? '' : t.page.url() })), lives: lives.size }),
    async shutdown() {
      clearInterval(sweeper);
      served.close();
      for (const l of [...lives.values()]) await l.cast.stop('closed').catch(() => {});
      for (const inst of [...instances.values()]) { try { await inst.ready; } catch { /* never opened */ } await closeInstance(inst, 'apagado').catch(() => {}); }
    }
  };
}

// The engine's side (src/server/engine-server.mjs, and src/engine/engine.mjs headless): the browser started with the
// engine (Chromium itself only when a bot needs it), «Necesito que lo hagas tú» as a notice, a push and an event.
// vaultFill: the vault's hook (src/server/vault/fill.mjs); by default ctx.vaultFill, looked up at each call (none: failed).
// testing: createServerBrowser's test options (launchContext, readMeminfo, executable, scope, display, root).
export async function startServerBrowser({ board, emit, push = () => {}, log = () => {}, vaultFill = null, testing = {} }) {
  const { ctx, tr } = await import('../core/context.mjs');
  const { ownerOfBoard } = await import('../core/authz.mjs');
  const fill = vaultFill ?? ((tab, args, page) => (typeof ctx.vaultFill === 'function' ? ctx.vaultFill(tab, args, page) : { ok: false, reason: 'vault_off' }));
  const sb = createServerBrowser({
    language: () => ctx.config.language, ownerId: () => ownerOfBoard(board), config: () => ctx.config.browser ?? {}, log, vaultFill: fill,
    root: process.env.ORB_SERVER_BROWSER_DIR || ctx.paths.browser || path.join(os.homedir(), 'orb-server', 'browser'),
    enginesRoot: ctx.paths.engines || process.env.ORB_ENGINES || null,
    display: process.env.ORB_SERVER_BROWSER_DISPLAY || ctx.config.browser?.server?.display || 'auto',
    onHuman: ({ person, kind, url }) => {
      const site = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      const whose = person ?? ownerOfBoard(board);
      const body = tr(kind === 'captcha' ? 'msg.browser.human.captcha' : 'msg.browser.human.code', { site });
      board.notice(body, 'warning', { person: whose && !board.isOwnerPerson(whose) ? whose : null });
      emit('browser:human', { person: whose, kind, site, open: 'browser.live' });
      try { push({ title: tr('msg.browser.human.title'), body, person: whose, route: { view: 'browser-live' } }); } catch { /* no phones */ }
    },
    ...testing
  });
  await sb.ready;
  ctx.serverBrowser = sb;
  ctx.browser = { pipe: sb.pipe, token: sb.token, server: true };
  ctx.browserLive = true; // its pages can be watched and driven from the app/phone (cap browser.live.v1, src/core/link.mjs)
  return sb;
}
