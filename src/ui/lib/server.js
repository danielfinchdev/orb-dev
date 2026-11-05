// 3.7 (WS4): the interface's side of Orb Server. Where its own methods are reached (server.*, vault.*, browser.live.*):
// straight when this device talks to the Server itself (a phone or a browser linked to it: app.state says product
// 'server'), else through the app's link to it (centro.<method>, src/engine/api-bots.mjs › centroApi). Its state for the
// app (link.server.status / link.server.guide, PC only), the bots' homes (bots.homes) and the live view of its browser.
import { useEffect } from 'react';
import { bridge, call, getState, setState, useStore, loadBots, loadInboxSoon } from './store.js';

export const onServer = () => getState().app?.product === 'server';
export const serverVia = () => (onServer() ? '' : 'centro.');
export const serverCall = (method, params) => call(`${serverVia()}${method}`, params);
// The live view's pictures come as browser:live (on the Server itself) or centro:browser:live (through the app's link).
export const serverListen = (fn) => bridge.on('*', (event, payload) => {
  if (event === 'browser:live' && onServer()) fn('browser:live', payload);
  else if (event === 'centro:browser:live' && !onServer()) fn('browser:live', payload);
});

// The app's Orb Server: { linked, peer: { id, name, online, version, features }, skew, code } (PC only). On the Server
// itself, a stand-in with its name. null: none, or this device cannot know.
export async function loadServer() {
  if (onServer()) { const s = { linked: true, direct: true, peer: { name: getState().app?.config?.mobile?.name || 'Orb Server', online: true, features: [] } }; setState({ server: s }); return s; }
  if (bridge.mobile) { setState({ server: null }); return null; }
  let server = null; try { server = await call('link.server.status'); } catch { server = null; }
  setState({ server });
  return server;
}
export async function loadServerGuide() {
  if (bridge.mobile || !getState().server?.linked) { setState({ serverGuide: null }); return null; }
  let guide = null; try { guide = await call('link.server.guide'); } catch { guide = null; }
  setState({ serverGuide: guide });
  return guide;
}
// Where bots can run (bots.homes); kept in the store for the badges, «Nuevo bot» and «Pasar al …».
export async function loadHomes() {
  let homes = []; try { homes = await call('bots.homes'); } catch { homes = []; }
  setState({ homes: Array.isArray(homes) ? homes : [] });
  return homes;
}
export const serverHome = (homes) => (Array.isArray(homes) ? homes : []).find((h) => h.server && !h.here) ?? null;
export const hasCap = (server, cap) => Boolean(server?.direct || (server?.peer?.features ?? []).includes(cap));

// Loads the Server's state once per screen that needs it, and again when the links change.
export function useServer() {
  const server = useStore((s) => s.server);
  const version = useStore((s) => s.version);
  useEffect(() => { loadServer(); loadHomes(); }, [version]);
  return server;
}
export function useHomes() {
  const homes = useStore((s) => s.homes);
  useEffect(() => { if (homes === undefined) loadHomes(); }, [homes]);
  return homes ?? [];
}

// «Ver navegador del Server»: one live view at a time, over the app (dialog on the PC, the whole screen on the phone).
export const openBrowserLive = (url = null) => setState({ browserLive: { url, at: Date.now() } });
export const closeBrowserLive = () => setState({ browserLive: null });

// After a move, a merge or an unlink: the lists again.
export function homesChanged() { setState({ bots: null }); loadBots(); loadHomes(); loadInboxSoon(0); }
