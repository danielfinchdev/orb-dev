// 3.8.1: the desktop app on Tauri. Defines window.orb with the same shape as Electron's preload (src/main/preload.cjs), so
// no component changes: engine calls and events go through Rust (src-tauri/src), which checks them again and relays them
// to the engine over its stdin/stdout. Also what Electron's menu and window did for the page: the keys (zoom, Ctrl+J,
// F11), Ctrl + mouse wheel, and moving the window by its top bars (WebView2 under Tauri ignores CSS app-region).
// Does nothing outside Tauri (Electron's preload, a phone's browser and the Android app have their own bridge). Must be
// imported first.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Features of later steps of the move to Tauri: they answer, but say they are not there yet.
const later = () => Promise.reject(new Error('Todavía no disponible en esta versión de prueba'));

if (window.__TAURI_INTERNALS__ && !window.orb) {
  const listeners = new Map();
  const fire = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) { try { fn(payload); } catch (error) { console.error(error); } }
    for (const fn of listeners.get('*') ?? []) { try { fn(event, payload); } catch (error) { console.error(error); } }
  };
  listen('engine:event', ({ payload }) => fire(payload?.event, payload?.payload));
  const engine = (method, params = {}) => invoke('engine_call', { method: String(method), params: params ?? {} });
  const windowAct = (action) => invoke('window_act', { action: String(action) });

  window.orb = {
    call: (method, params) => engine(method, params),
    on: (event, fn) => {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    info: () => invoke('app_info'),
    platform: 'win32',
    light: false,
    setup: (data) => invoke('app_setup', { data: data ?? {} }),
    switchHome: (folder) => invoke('app_switch_home', { target: String(folder ?? '') }),
    pickFolder: later, pickImages: later, pickProgram: later, pickFiles: later,
    openPath: later, openExternal: later,
    showBrowser: () => Promise.resolve(null),
    zoom: (value) => invoke('app_zoom', { value: value ?? null }),
    windowControls: {
      act: windowAct,
      onState: (fn) => {
        if (typeof fn !== 'function') return () => {};
        const off = listen('app:window-state', ({ payload }) => fn(payload));
        return () => { off.then((un) => un()).catch(() => {}); };
      }
    },
    // This PC's tools live in the engine (src/engine/api-app.mjs).
    openTerminal: (folder) => engine('app.openTerminal', { dir: folder ?? null }),
    editors: () => engine('app.editors'),
    openIn: (which, folder) => engine('app.openIn', { which, dir: folder }),
    runAction: (action) => engine('app.runAction', action ?? {}),
    feedback: { capture: later, images: later, send: (data) => engine('app.feedbackSend', data ?? {}) },
    moreApps: () => engine('app.moreApps'),
    update: { get: later, check: later, download: later, install: later },
    pathForFile: () => null
  };

  // Ctrl and the key, whatever the keyboard: «+» has its own key on a Spanish one, «=» shares it on an English one, and the
  // number pad has its own (the same keys as Electron's main.mjs › zoomKey).
  const zoomKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
    if (['+', '=', 'Add'].includes(e.key) || e.code === 'NumpadAdd') return 'in';
    if (['-', '_', 'Subtract'].includes(e.key) || e.code === 'NumpadSubtract') return 'out';
    if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') return 'reset';
    return null;
  };
  const zoomBy = (dir) => invoke('app_zoom_step', { dir }).catch(() => {});
  window.addEventListener('keydown', (e) => {
    const dir = zoomKey(e);
    if (dir) { e.preventDefault(); zoomBy(dir); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') { e.preventDefault(); fire('ui:terminal', {}); return; }
    if (e.key === 'F11' && !e.ctrlKey && !e.altKey) { e.preventDefault(); windowAct('fullscreen').catch(() => {}); }
  }, true);
  window.addEventListener('wheel', (e) => { if (e.ctrlKey && e.deltaY) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 'in' : 'out'); } }, { passive: false, capture: true });

  // The top bars move the window, as `app-region: drag` did in Electron (app.css: .app-titlebar, .drag), except what is
  // pressed in them (the same list as app.css's no-drag). A double click maximises or restores.
  const DRAG = '.app-titlebar, .drag';
  const NO_DRAG = '.no-drag, .win-controls, .sidebar-resize, button, a, input, select, textarea, label, [role=button], [role=combobox], [role=tab], [role=switch], [contenteditable]:not([contenteditable=false]), [data-no-drag], .orb';
  const dragTarget = (el) => {
    for (let n = el instanceof Element ? el : el?.parentElement; n; n = n.parentElement) {
      if (n.matches(NO_DRAG)) return false;
      if (n.matches(DRAG)) return true;
    }
    return false;
  };
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !dragTarget(e.target)) return;
    e.preventDefault();
    if (e.detail === 2) windowAct('maximize').catch(() => {});
    else invoke('window_drag').catch(() => {});
  });
}

