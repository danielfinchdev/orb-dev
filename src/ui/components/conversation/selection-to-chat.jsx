// «Añadir al chat»: select text in a message and a small button appears next to the selection; it puts the text, as a quote,
// in the message box. The same with Ctrl+Shift+L (a command of the shortcut table, so it can be changed in Ajustes).
// Nothing is sent: the person reads the quote and sends it. One instance for the whole window.
import { useCallback, useEffect, useRef, useState } from 'react';
import { TextQuote } from 'lucide-react';
import { addToChat, asQuote } from '@/lib/add-to-chat.js';
import { useShortcut } from '@/lib/keys.js';
import { useT } from '@/lib/i18n.js';

const MAX_QUOTE = 4000;
const MIN_QUOTE = 2;

// The selected text when it lies inside one message of a chat: { text, rect } or null.
export function selectedMessageText() {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim();
  if (text.length < MIN_QUOTE) return null;
  const owner = (n) => (n?.nodeType === 1 ? n : n?.parentElement)?.closest?.('article.msg-box');
  const box = owner(sel.anchorNode);
  if (!box || box !== owner(sel.focusNode)) return null;
  return { text: text.slice(0, MAX_QUOTE), rect: sel.getRangeAt(0).getBoundingClientRect() };
}

export function SelectionToChat() {
  const t = useT();
  const [at, setAt] = useState(null); // { x, y, text }
  const timer = useRef(null);
  const look = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const got = selectedMessageText();
      if (!got) { setAt(null); return; }
      const x = Math.min(Math.max(8, got.rect.right - 8), window.innerWidth - 180);
      const y = Math.min(got.rect.bottom + 8, window.innerHeight - 44);
      setAt({ x, y, text: got.text });
    }, 120);
  }, []);
  useEffect(() => {
    document.addEventListener('selectionchange', look);
    window.addEventListener('scroll', look, true);
    return () => { document.removeEventListener('selectionchange', look); window.removeEventListener('scroll', look, true); clearTimeout(timer.current); };
  }, [look]);
  const add = (text) => { addToChat(asQuote(text)); window.getSelection()?.removeAllRanges(); setAt(null); };
  useShortcut('chat.addSelection', (e) => { const got = selectedMessageText(); if (!got) return; e.preventDefault(); add(got.text); });
  if (!at) return null;
  return (
    // mousedown is not allowed to move the focus, or the selection would be lost before the click
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(at.text)} style={{ position: 'fixed', left: at.x, top: at.y }}
      className="bg-popover text-popover-foreground animate-in fade-in z-50 flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-control shadow-lg hover:bg-accent" data-testid="selection-to-chat">
      <TextQuote className="size-3.5" aria-hidden="true" />{t('selection.add')}
    </button>
  );
}
