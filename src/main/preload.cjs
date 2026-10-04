// The only bridge between the window and the rest of the app. The page gets these functions and nothing else
// (no Node, no ipcRenderer). Every call is checked again in the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();
ipcRenderer.on('engine:event', (_e, event, payload) => {
  for (const fn of listeners.get(event) ?? []) { try { fn(payload); } catch (error) { console.error(error); } }
  for (const fn of listeners.get('*') ?? []) { try { fn(event, payload); } catch (error) { console.error(error); } }
});

contextBridge.exposeInMainWorld('orb', {
  call: (method, params) => ipcRenderer.invoke('engine:call', String(method), params ?? {}),
  on: (event, fn) => {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  info: () => ipcRenderer.invoke('app:info'),
  setup: (data) => ipcRenderer.invoke('app:setup', data),
  switchHome: (folder) => ipcRenderer.invoke('app:switchHome', folder),
  pickFolder: (title) => ipcRenderer.invoke('app:pickFolder', title),
  pickImages: () => ipcRenderer.invoke('app:pickImages'),
  openPath: (folder) => ipcRenderer.invoke('app:openPath', folder),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  showBrowser: () => ipcRenderer.invoke('app:showBrowser'),
  // Size of the interface on this PC (1 = normal): read with zoom(), change with zoom(value).
  zoom: (value) => ipcRenderer.invoke('app:zoom', value ?? null),
  openTerminal: (folder) => ipcRenderer.invoke('app:openTerminal', folder ?? null),
  // Path of a file dropped or pasted into the window (images for the agents).
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || null; } catch { return null; } }
});
