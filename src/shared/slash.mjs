// 3.8.2: the chat commands Orb answers itself, typed alone in a chat's box: «/compact» (the agent's own compaction, the
// same as the «Compactar» button) and «/clear» (the agent starts a new conversation in the same chat; the history shown
// in Orb stays). Anything else, «/compact» with more words included, goes to the agent as typed.
const COMMANDS = ['clear', 'compact'];
export function slashCommand(text) {
  const m = /^\/([a-z]+)$/i.exec(String(text ?? '').trim());
  const name = m?.[1].toLowerCase();
  return COMMANDS.includes(name) ? name : null;
}
