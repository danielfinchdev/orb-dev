// «Revisar» on a turn card asks the view to open the Changes panel on that turn. The card does not know the panel, and the
// panel does not know the cards: the view listens here and passes the turn on.
const listeners = new Set();
export const openChanges = (session, turn) => { for (const fn of [...listeners]) fn({ session, turn }); };
export const onOpenChanges = (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

// The same for a tab of the panel (the sidebar's «Información» opens the Ficha). The chat it targets may not be on screen
// yet, so a request waits a moment for the view that mounts and listens.
const panelListeners = new Set();
let pending = null;
export const openPanel = (session, tab) => {
  pending = { session, tab, at: Date.now() };
  for (const fn of [...panelListeners]) fn({ session, tab });
};
export const onOpenPanel = (fn) => {
  panelListeners.add(fn);
  const wait = pending;
  if (wait && Date.now() - wait.at < 2000) {
    pending = null;
    // after the view's own reset of the panel when the chat changes
    setTimeout(() => fn({ session: wait.session, tab: wait.tab }), 0);
  }
  return () => { panelListeners.delete(fn); };
};
