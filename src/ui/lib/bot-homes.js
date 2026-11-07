// 3.7 (WS3): where bots can run (bots.homes), kept in the store for the badges, «Nuevo bot» and «Pasar al …».
import { useEffect } from 'react';
import { call, setState, useStore, loadBots, loadInboxSoon } from './store.js';

export async function loadHomes() {
  let homes = []; try { homes = await call('bots.homes'); } catch { homes = []; }
  setState({ homes: Array.isArray(homes) ? homes : [] });
  return homes;
}
export function useHomes() {
  const homes = useStore((s) => s.homes);
  useEffect(() => { if (homes === undefined) loadHomes(); }, [homes]);
  return homes ?? [];
}
// After a move, a merge or an unlink: the lists again.
export function homesChanged() { setState({ bots: null }); loadBots(); loadHomes(); loadInboxSoon(0); }
