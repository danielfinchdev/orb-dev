// «Revisar» on a turn card asks the view to open the Changes panel on that turn. The card does not know the panel, and the
// panel does not know the cards: the view listens here and passes the turn on.
const listeners = new Set();
export const openChanges = (session, turn) => { for (const fn of [...listeners]) fn({ session, turn }); };
export const onOpenChanges = (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
