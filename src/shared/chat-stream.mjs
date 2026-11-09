// 3.8.3: the assistant's streamed answer as deltas. Up to 3.8.2 every live state of a conversation (chat:state, every
// 80 ms while it writes) carried the whole partial answer, so the bytes sent grew with the square of its length. Now each
// receiver that understands deltas gets only what was added since the state it last got:
//
//   { ...state, partial }            the whole text (the first state of a turn, or a text that does not continue the last)
//   { ...state, append, base }       the text from position `base` on (what the receiver holds is kept up to `base`)
//
// The PC's window always takes deltas (engine.mjs). A linked phone or browser asks for them when it opens its event stream
// (remote.mjs, `d: 1` in its sealed header); one that does not (3.8.1–3.8.2) gets the whole text, as before.
// Shared by the engine and the interface, so it imports nothing.

// One per receiver: → (state) => the state to send it.
export function streamFeed() {
  const held = new Map(); // conversation → the partial text the receiver holds
  return (state) => {
    const key = state?.conversation;
    if (key == null) return state;
    const text = typeof state.partial === 'string' ? state.partial : '';
    const had = held.get(key);
    if (!state.busy) held.delete(key); else held.set(key, text);
    if (!state.busy || had == null || had.length === 0 || !text.startsWith(had)) return state;
    const { partial: _whole, ...rest } = state;
    return { ...rest, append: text.slice(had.length), base: had.length };
  };
}

// The receiver's side: the whole partial text of a state, from the one it holds. → string, or null when the state does not
// follow it (the receiver lost its place, e.g. the window reloaded): it must read the conversation's state again.
export function streamText(holding, state) {
  if (state?.append == null) return typeof state?.partial === 'string' ? state.partial : '';
  const base = Number(state.base);
  if (typeof holding !== 'string' || !Number.isInteger(base) || base < 0 || base > holding.length) return null;
  return holding.slice(0, base) + String(state.append);
}
