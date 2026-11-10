// 3.8.3: a message box's text, kept outside the view that owns the box. Typing redraws the box alone (Composer reads it
// with useDraftValue); the view reads it only when it sends (draft.get()) and writes it when it fills the box
// (draft.set: a suggestion, a shared text, a failed message coming back). Before, the text lived in the view's state
// and every key redrew the whole conversation around the box.
import { useState, useSyncExternalStore } from 'react';

export function createDraft(initial = '') {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    // A value or, like setState, a function of the current one.
    set: (next) => {
      const v = String((typeof next === 'function' ? next(value) : next) ?? '');
      if (v === value) return;
      value = v;
      for (const fn of listeners) fn();
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
}

// One draft for the life of the component that owns the box.
export const useDraft = () => useState(() => createDraft())[0];
export const useDraftValue = (draft) => useSyncExternalStore(draft.subscribe, draft.get, draft.get);
