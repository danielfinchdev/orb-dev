// a message box's text, kept outside the view that owns the box. Typing redraws the box alone (Composer reads it
// with useDraftValue); the view reads it only when it sends (draft.get()) and writes it when it fills the box
// (draft.set: a suggestion, a shared text, a failed message coming back). Before, the text lived in the view's state
// and every key redrew the whole conversation around the box.
// Long pasted texts are kept apart as blocks (draft.blocks()): the box shows them as folded cards and the view sends them
// with the text (draft.message()).
import { useState, useSyncExternalStore } from 'react';
import { composeMessage, MAX_PASTE_CHARS } from '../../shared/chat-compose.mjs';

export function createDraft(initial = '') {
  let value = initial;
  let blocks = [];
  let nextId = 1;
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };
  return {
    get: () => value,
    // A value or, like setState, a function of the current one.
    set: (next) => {
      const v = String((typeof next === 'function' ? next(value) : next) ?? '');
      if (v === value) return;
      value = v;
      notify();
    },
    blocks: () => blocks,
    addBlock: (text) => { blocks = [...blocks, { id: nextId++, text: String(text).slice(0, MAX_PASTE_CHARS) }]; notify(); },
    removeBlock: (id) => { blocks = blocks.filter((b) => b.id !== id); notify(); },
    clearBlocks: () => { if (blocks.length) { blocks = []; notify(); } },
    // what is sent: the text and the pasted blocks
    message: () => composeMessage(value, blocks),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
}

// One draft for the life of the component that owns the box.
export const useDraft = () => useState(() => createDraft())[0];
export const useDraftValue = (draft) => useSyncExternalStore(draft.subscribe, draft.get, draft.get);
export const useDraftBlocks = (draft) => useSyncExternalStore(draft.subscribe, draft.blocks, draft.blocks);
