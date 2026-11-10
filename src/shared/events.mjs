// Every event the window and the phone may hear, by who sends it. The engine's are the names its emit() calls use
// (test/superficie.test.mjs checks both ways); the app's (Rust) and the bridges' own come from outside the engine.
// The window listens by name (bridge.on(name) or the engine events hook, src/ui/app/engine-events.js).
export const ENGINE_EVENTS = Object.freeze([
  'agentBrowser:closeTask', 'agents:install', 'agents:login', 'approval:changed', 'backup:done', 'backup:progress',
  'backup:restoreReady', 'board:changed', 'chat:new', 'chat:state', 'config:changed', 'core:lost', 'inbox:changed',
  'installer:progress', 'link:devices', 'master:locked', 'master:unlocked', 'notice', 'secret:done', 'secret:request',
  'session:delta', 'session:item', 'session:queue', 'session:removed', 'session:update', 'terminal:data', 'terminal:exit',
]);
// Sent by the app (src-tauri) or a bridge of the window itself (the phone's link, the browser pointer, the menu).
export const WINDOW_EVENTS = Object.freeze([
  'engine:stopped', 'engine:restarted', 'app:update', 'ui:navigate', 'ui:terminal', 'ui:zoom', 'link:offline', 'link:online',
  'browser:pointed', 'browser:recorded',
]);
export const EVENTS = Object.freeze([...ENGINE_EVENTS, ...WINDOW_EVENTS]);
