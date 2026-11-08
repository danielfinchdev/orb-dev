// 3.8.1 (D7): the little window of the agents' browser on Tauri (src-tauri/src/pip.rs). Defines window.pip with the same
// shape as in Orb 3.8.0: pictures and state from the engine, and its buttons. Keeps the last picture and
// state, so the page gets them even if they arrived before it subscribed. Moves the window by its top bar (.drag), as
// app-region did in Electron. Does nothing outside Tauri. Must be imported first.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

if (window.__TAURI_INTERNALS__ && !window.pip) {
  const last = {}; const subs = { 'pip:frame': new Set(), 'pip:state': new Set() };
  const ready = Object.keys(subs).map((name) => listen(name, ({ payload }) => { last[name] = payload; for (const fn of subs[name]) { try { fn(payload); } catch (error) { console.error(error); } } }));
  const on = (name) => (fn) => {
    if (typeof fn !== 'function') return () => {};
    subs[name].add(fn);
    if (last[name] !== undefined) fn(last[name]);
    return () => subs[name].delete(fn);
  };
  const action = (name) => invoke('pip_action', { action: String(name) }).catch(() => {});
  window.pip = { onFrame: on('pip:frame'), onState: on('pip:state'), action };
  // Listening: the engine sends the state again.
  Promise.all(ready).then(() => action('loaded')).catch(() => {});
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !(e.target instanceof Element) || !e.target.closest('.drag') || e.target.closest('button, .no-drag')) return;
    e.preventDefault();
    action('drag');
  });
}
