// Bridge of the little "what the agent is doing" window: it only receives pictures and state, and can ask to resize,
// hide itself or bring the app forward.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pip', {
  onFrame: (fn) => { const h = (_e, url) => fn(url); ipcRenderer.on('pip:frame', h); return () => ipcRenderer.off('pip:frame', h); },
  onState: (fn) => { const h = (_e, state) => fn(state); ipcRenderer.on('pip:state', h); return () => ipcRenderer.off('pip:state', h); },
  action: (name) => ipcRenderer.send('pip:action', String(name))
});
