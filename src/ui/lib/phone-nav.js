// 3.8: where the app may go and where it goes back to (pure: no React, no store; test/movil-ui.test.mjs).
// - cleanRoute: a route of a screen that no longer exists (the bots' of 3.7, Orb Server's, a typo) never opens a blank or
//   broken screen: the bots' fall back to the chats (an old notification, a saved route) and the rest to nothing (the
//   caller picks the home screen).
// - restoreRoute: where the app opens. The phone opens on its chat list (like a messaging app) unless it was left in a
//   chat that still exists or on one of its tabs; the PC reopens the last screen if it still exists.
// - backStep: what Android's back button or gesture does (and a phone browser's back): close what is open over the
//   screen, then go up one level (a chat or a detail → its list, another tab → Chats), and only on Chats leave the app.

// Screens of 3.7 that 3.8 removed (bots, groups, Casa, Orb Server, links between Orbs, people, the terminal).
const GONE = /^(bots?|bot-.+|groups?|casa|home|server|server-.+|connections|link|links|profile|persons|people|terminal|vault|admin)$/;
// The phone's tabs: the only screens it reopens without an id.
export const PHONE_TABS = ['chats', 'tasks', 'projects'];

const asRoute = (route) => (typeof route === 'string' ? { view: route } : route && typeof route === 'object' && typeof route.view === 'string' ? route : null);

// → a route that can be shown, or null. views: the names of the screens this build has; phone: the phone's layout.
export function cleanRoute(route, { views, phone = false } = {}) {
  const r = asRoute(route);
  if (!r) return null;
  if (r.view === 'settings') return r; // a window over the screen, not a screen
  if (GONE.test(r.view)) return { view: phone ? 'chats' : 'chat' }; // F2.3 M1: never the old bot's id
  if (views && !views.includes(r.view)) return null;
  return r;
}

// The screen the app opens on. saved: what localStorage kept (anything: it may be broken); known: { sessions,
// conversations } as just loaded.
export function restoreRoute(saved, { views, phone = false, sessions = [], conversations = [] } = {}) {
  const home = { view: phone ? 'chats' : 'chat' };
  const r = cleanRoute(saved, { views, phone });
  if (!r || r.view === 'settings') return home;
  if (r.view === 'session') return r.id != null && sessions.some((s) => s.id === r.id) ? { view: 'session', id: r.id } : home;
  if (r.view === 'chat') {
    if (r.id == null) return phone ? home : { view: 'chat' };
    return conversations.some((c) => c.id === r.id) ? { view: 'chat', id: r.id } : home;
  }
  if (phone) return PHONE_TABS.includes(r.view) ? { view: r.view } : home;
  return { view: r.view };
}

// What one press of «back» does. overlay: a dialog, sheet, menu or the ☰ menu is open. → { close } | { go } | { exit }
// | null (nothing: the PC).
export function backStep({ route, overlay = false, phone = true } = {}) {
  if (overlay) return { close: true };
  if (!phone) return null;
  const r = asRoute(route) ?? { view: 'chats' };
  const v = r.view;
  if (v === 'chat' || v === 'session') return { go: { view: 'chats' } };
  // A task opened from a chat: back to that chat. A task or a project open over its list: back to the list (the same
  // filter of a project's tasks).
  if (v === 'tasks' && r.id != null && (r.from?.view === 'chat' || r.from?.view === 'session')) return { go: r.from };
  if (v === 'tasks' && r.id != null) return { go: r.project ? { view: 'tasks', project: r.project } : { view: 'tasks' } };
  if (v === 'tasks' && r.project) return { go: { view: 'projects', name: r.project } };
  if (v === 'projects' && r.name) return { go: { view: 'projects' } };
  if (v !== 'chats') return { go: { view: 'chats' } };
  return { exit: true };
}

// Whether the on-screen keyboard is up (the floating tab bar hides then): a text field has the focus and the window lost
// a good part of its height (Android pads the page by the keyboard's height). Without a known full height, the focus alone.
export function keyboardOpen({ editing, height, fullHeight }) {
  if (!editing) return false;
  if (!fullHeight || !height) return true;
  return height < fullHeight * 0.8;
}
