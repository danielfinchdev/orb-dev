// How a new line of the chat feels, read from the mark the engine starts it with: good news, bad news or just talk.
// The corner robot's face and voice (components/companion.jsx) and the adaptive music (lib/music.js) say the same.
// No React and no store here, so it is tested as it is (test/musica-388.test.mjs).
const GOOD = /^(✅|↩️|👍)/;
const BAD = /^(❌|⛔|🛑|⚠️)/;
// → 'happy' | 'worried' | 'talking'
export const textMood = (body) => { const text = String(body ?? ''); return GOOD.test(text) ? 'happy' : BAD.test(text) ? 'worried' : 'talking'; };
// Something that waits for the user (a permission, an approval) is a warning too, whatever its text says.
export const waitsForUser = (payload) => ['task-approval', 'approval', 'attention'].includes(payload?.meta?.kind);
// A chat line's mood ('chat:new' payload).
export const chatMood = (payload) => (waitsForUser(payload) ? 'worried' : textMood(payload?.body));
