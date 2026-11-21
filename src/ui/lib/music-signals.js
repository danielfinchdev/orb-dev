// What the adaptive music follows (lib/adaptive-music.js › signal), worked out from what happens in the window:
//
//   typing         the user writes in a text box
//   agent-working  an agent is in the middle of a turn
//   agent-done     the last agent that was working finished
//   error          bad news in the chat (an agent or a tool failed)
//   success        good news in the chat (a task done, the tests passed)
//   idle           nothing has happened for a while
//
// The music needs the pace of what happens, not every event: each kind is limited, so a held key, a burst of notices
// or twenty agents finishing together are one musical gesture each. Nothing here touches the window or the store
// (lib/music.js feeds it and owns the listeners), so it runs in the tests with a clock of their own.

export const TYPING_MS = 110; // a held key repeats about thirty times a second
export const EVENT_MS = 4000; // an error or a success at most this often
export const IDLE_MS = 90_000; // without a key, a click or an agent working
export const WORKING_MS = 5000; // «still working» is said again this often: a music that was paused meanwhile catches up
export const LEVEL_MS = 250; // how often the music's level is read for the player that shows it

// How far the music has risen, 0..1, in hundredths: what the player shows, so a smaller move draws nothing again.
export const levelOf = (intensity) => Math.round(Math.min(1, Math.max(0, Number(intensity) || 0)) * 100) / 100;

const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number']);
// Whether a key press writes text in a text box: shortcuts, arrows and keys pressed anywhere else are not typing.
// A password box is left out: what is typed there is not the music's business.
export function isTyping(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  if (!(typeof e.key === 'string' && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter'))) return false;
  const el = e.target;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName ?? '').toUpperCase();
  return tag === 'TEXTAREA' || (tag === 'INPUT' && TEXT_INPUTS.has(String(el.type ?? '').toLowerCase()));
}

// send(signal): where the signals go. now(): the clock, in ms.
// → { key(e), active(), mood(mood), tick(busy) }: a key press, any other sign of the user, a chat line's mood
//   ('happy' | 'worried' | anything else) and the regular look at whether an agent is working.
export function createSignals({ send, now = Date.now }) {
  let lastTyping = -Infinity; let lastActive = now(); let idle = false;
  let busy = false; let lastWorking = -Infinity;
  const last = { error: -Infinity, success: -Infinity };
  const awake = () => { lastActive = now(); idle = false; };
  const event = (kind) => { const t = now(); if (t - last[kind] < EVENT_MS) return; last[kind] = t; send(kind); };
  return {
    key(e) {
      awake();
      if (!isTyping(e)) return;
      const t = now();
      if (t - lastTyping < TYPING_MS) return;
      lastTyping = t; send('typing');
    },
    active: awake,
    mood(mood) { if (mood === 'happy') event('success'); else if (mood === 'worried') event('error'); },
    tick(working) {
      const t = now();
      if (working) {
        awake();
        if (!busy || t - lastWorking >= WORKING_MS) { lastWorking = t; send('agent-working'); }
      } else if (busy) {
        awake(); send('agent-done');
      } else if (!idle && t - lastActive >= IDLE_MS) {
        idle = true; send('idle');
      }
      busy = Boolean(working);
    }
  };
}
