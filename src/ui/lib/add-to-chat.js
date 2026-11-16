// «Añadir al chat»: text that another part of the window wants in the message box (a file found with Ctrl+P, a line found
// with Ctrl+Shift+F, a text selected in a message). The chat on screen takes it; with no chat open, a new one opens and
// takes it when it appears. Nothing is sent: the person reads it and sends it.
import { useEffect, useRef } from 'react';
import { getState, go } from './store.js';

const handlers = []; // chat views on screen; the last one to appear takes the text
const waiting = [];

// What the box holds plus `text`, on its own paragraph.
export const appendToBox = (prev, text) => (String(prev ?? '').trim() ? `${String(prev).trimEnd()}\n\n${text}` : text);
// A selected text as a Markdown quote.
export const asQuote = (text) => String(text).replace(/\r\n?/g, '\n').trim().split('\n').map((l) => `> ${l}`.trimEnd()).join('\n');
// A file path (and line) as code, the way the chat's Markdown shows it.
export const asPath = (file, line) => `\`${String(file).replace(/`/g, '')}${line ? `:${line}` : ''}\``;

export function addToChat(text) {
  const t = String(text ?? '');
  if (!t.trim()) return;
  const take = handlers.at(-1);
  if (take) { take(t); return; }
  waiting.push(t);
  const { route } = getState();
  if (route?.view !== 'chat') go({ view: 'chat' });
}

// The chat view's side: `put(text)` writes into its box.
export function useAddToChat(put) {
  const ref = useRef(put); ref.current = put;
  useEffect(() => {
    const handle = (text) => ref.current(text);
    handlers.push(handle);
    while (waiting.length) handle(waiting.shift());
    return () => { const i = handlers.indexOf(handle); if (i >= 0) handlers.splice(i, 1); };
  }, []);
}
