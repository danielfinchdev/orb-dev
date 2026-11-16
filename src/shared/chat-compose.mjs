// Pure pieces of what goes into a chat's message box: text added from elsewhere (a found file, a selected text), and long
// pasted texts that sit in a folded card instead of filling the box (the card's text is added to the message when it is sent).

// What the box holds plus `text`, on its own paragraph.
export const appendToBox = (prev, text) => (String(prev ?? '').trim() ? `${String(prev).trimEnd()}\n\n${text}` : text);
// A selected text as a Markdown quote.
export const asQuote = (text) => String(text).replace(/\r\n?/g, '\n').trim().split('\n').map((l) => `> ${l}`.trimEnd()).join('\n');
// A file path (and line) as code, the way the chat's Markdown shows it.
export const asPath = (file, line) => `\`${String(file).replace(/`/g, '')}${line ? `:${line}` : ''}\``;

export const LONG_PASTE_CHARS = 1500;
export const LONG_PASTE_LINES = 25;
// The engine refuses a message longer than this (sessions.send), so the text and its cards together stay within it.
export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_PASTE_CHARS = MAX_MESSAGE_CHARS;

export const countLines = (text) => (String(text).length ? String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length : 0);
// A paste that long goes to a card.
export const isLongPaste = (text) => { const s = String(text ?? ''); return s.length >= LONG_PASTE_CHARS || countLines(s) >= LONG_PASTE_LINES; };

// The message: the box's text, then each pasted text in a code block whose fence is longer than any run of backticks inside it
// (so the pasted text can never close it early). blocks: [{ text }].
export function composeMessage(text, blocks = []) {
  const parts = [String(text ?? '').trim()].filter(Boolean);
  for (const b of blocks) {
    const body = String(b.text ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    if (!body) continue;
    const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    parts.push(`${fence}\n${body}\n${fence}`);
  }
  return parts.join('\n\n');
}
