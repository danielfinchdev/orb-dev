// 3.8.1: the desktop app on Tauri. Defines window.orb (the shape every bridge of Orb has), so
// no component changes: engine calls and events go through Rust (src-tauri/src), which checks them again and relays them
// to the engine over its stdin/stdout. Also what Electron's menu and window did for the page: the keys (zoom, Ctrl+J,
// F11), Ctrl + mouse wheel, and moving the window by its top bars (WebView2 under Tauri ignores CSS app-region).
// Does nothing outside the desktop app (a phone's browser and the Android app, Tauri too, have their own bridge). Must
// be imported first.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

if (import.meta.env.MODE !== 'android' && window.__TAURI_INTERNALS__ && !window.orb) {
  const listeners = new Map();
  const fire = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) { try { fn(payload); } catch (error) { console.error(error); } }
    for (const fn of listeners.get('*') ?? []) { try { fn(event, payload); } catch (error) { console.error(error); } }
  };
  listen('engine:event', ({ payload }) => fire(payload?.event, payload?.payload));
  const engine = (method, params = {}) => invoke('engine_call', { method: String(method), params: params ?? {} });
  const windowAct = (action) => invoke('window_act', { action: String(action) });
  const text = (v) => (typeof v === 'string' ? v : null);
  // The real path of a File the user dropped, pasted or picked in the page: handed to WebView2, which tells Rust its path
  // ('app:file-path'). null for a pasted picture (it has none) or after 3 s.
  const fileWaits = new Map(); let fileId = 0;
  listen('app:file-path', ({ payload }) => { const done = fileWaits.get(payload?.id); if (done) { fileWaits.delete(payload.id); done(text(payload.path)); } });
  const pathForFile = (file) => new Promise((resolve) => {
    const id = ++fileId;
    try { window.chrome.webview.postMessageWithAdditionalObjects(`orb-file:${id}`, [file]); } catch { resolve(null); return; }
    fileWaits.set(id, resolve);
    setTimeout(() => { if (fileWaits.delete(id)) resolve(null); }, 3000);
  });
  // The window's picture for Ajustes › Contribuye: at most 1920 px wide, named as Electron named it (feedback.mjs).
  const capture = async () => {
    const data = await invoke('app_feedback_capture');
    if (!data) return null;
    let png = data;
    const img = new Image(); img.src = `data:image/png;base64,${data}`;
    await img.decode();
    if (img.naturalWidth > 1920) {
      const canvas = document.createElement('canvas');
      canvas.width = 1920; canvas.height = Math.round(img.naturalHeight * 1920 / img.naturalWidth);
      const g = canvas.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, canvas.width, canvas.height);
      png = canvas.toDataURL('image/png').split(',')[1];
    }
    if (png.length > 5 * 1024 * 1024 * 1.37) return null;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return { name: `captura-${stamp}.png`, type: 'image/png', data: png };
  };

  window.orb = {
    call: (method, params) => engine(method, params),
    on: (event, fn) => {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    info: () => invoke('app_info'),
    // After the engine failed to start: «Reintentar», and «Empezar con una clave nueva» when the sealed keys could not be
    // opened (info().startError.code === 'secretUnreadable').
    retryStart: (opts) => invoke('app_retry_start', { newSecret: opts?.newSecret === true }),
    platform: 'win32',
    // The desktop app (review D10 M7): WebView2 here has no speech service and webview.rs denies the microphone, so
    // the interface never offers to dictate (src/ui/views/chat.jsx).
    desktop: true,
    setup: (data) => invoke('app_setup', { data: data ?? {} }),
    switchHome: (folder) => invoke('app_switch_home', { target: String(folder ?? '') }),
    // Windows' own dialogs, opened by Rust (the page has no dialog permission).
    pickFolder: (title) => invoke('app_pick_folder', { title: text(title) }),
    pickAttachments: () => invoke('app_pick_attachments'),
    pickProgram: (title) => invoke('app_pick_program', { title: text(title) }),
    pickFiles: (title) => invoke('app_pick_files', { title: text(title) }),
    // unlock: the master password's token, for core and its secrets (Rust checks it with the engine).
    openPath: (folder, unlock) => invoke('app_open_path', { path: String(folder ?? ''), unlock: text(unlock) }),
    openExternal: (url) => invoke('app_open_external', { url: String(url ?? '') }),
    // «Eliminar proyecto» (src-tauri/src/delete.rs, the same steps as Electron's preload): step 'retry' | 'forever' | 'cancel'.
    deleteProject: (name, unlock, step) => invoke('app_delete_project', { name: String(name ?? ''), unlock: text(unlock), step: ['retry', 'forever', 'cancel'].includes(step) ? step : null }),
    showBrowser: () => invoke('app_show_browser'),
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
    openIn: (which, folder, unlock) => engine('app.openIn', { which, dir: folder, unlock: text(unlock) }),
    runAction: (action) => engine('app.runAction', action ?? {}),
    feedback: { capture, images: () => invoke('app_feedback_images'), send: (data) => engine('app.feedbackSend', data ?? {}) },
    moreApps: () => engine('app.moreApps'),
    // New versions (src-tauri/src/updater.rs); the state also comes as the 'app:update' event.
    update: { get: () => invoke('app_update'), check: () => invoke('app_update_check'), download: () => invoke('app_update_download'), install: () => invoke('app_update_install') },
    // A promise here (Electron's preload answers at once): the callers wait for it either way.
    pathForFile
  };

  // Ctrl and the key, whatever the keyboard: «+» has its own key on a Spanish one, «=» shares it on an English one, and the
  // number pad has its own (the same keys as Orb 3.8.0).
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

