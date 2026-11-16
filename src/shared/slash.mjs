// the chat commands Orb answers itself, typed at the start of a chat's box.
// - Bare ones: «/compact» (the agent's own compaction, the same as the «Compactar» button) and «/clear» (the agent
//   starts a new conversation in the same chat; the history shown in Orb stays).
// - With words after them: «/goal», «/plan», «/review» and «/debug» (src/engine/modes.mjs); typed alone they show or end
//   their mode (or, for «/plan», plan what the chat is about).
// Anything else goes to the agent as typed.
const BARE = ['clear', 'compact'];
const WITH_TEXT = ['goal', 'plan', 'review', 'debug'];

export function slashCommand(text) {
  const m = /^\/([a-z]+)$/i.exec(String(text ?? '').trim());
  const name = m?.[1].toLowerCase();
  return BARE.includes(name) ? name : null;
}

// { name, args } for «/goal …», «/plan …», «/review …» and «/debug …» (args may be empty), else null.
export function modeCommand(text) {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
  const name = m?.[1].toLowerCase();
  return WITH_TEXT.includes(name) ? { name, args: (m[2] ?? '').trim() } : null;
}
