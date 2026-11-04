// 3.6: the short moments of a bot's avatar (docs/DESIGN-SYSTEM.md › 2.5): a bounce when it writes a new message and a
// happy hop when one of its cards is approved. Fed by main.jsx from the live bot.message events; any avatar of that bot
// on screen (list, menu, chat) reads it with useAvatarPulse and goes back to its usual state afterwards.
import { useSyncExternalStore } from 'react';

const pulses = new Map(); // bot id → 'message' | 'happy'
const timers = new Map();
const subs = new Set();
const tell = () => { for (const fn of subs) fn(); };
const LENGTH = { message: 950, happy: 2000 };

export function pulseAvatar(id, state) {
  if (id == null || !LENGTH[state]) return;
  const key = Number(id);
  // A happy hop is not cut short by the next message.
  if (pulses.get(key) === 'happy' && state === 'message') return;
  clearTimeout(timers.get(key));
  pulses.set(key, state); tell();
  timers.set(key, setTimeout(() => { pulses.delete(key); timers.delete(key); tell(); }, LENGTH[state]));
}

// A live line of a bot's chat (bot.message): a new message of a bot bounces it; its card approved makes it happy.
export function avatarEvent(msg) {
  const meta = msg?.meta; if (!meta || meta.bot == null) return;
  if (msg.updated) { if (meta.kind === 'bot_card' && ['running', 'done'].includes(meta.status)) pulseAvatar(meta.bot, 'happy'); return; }
  if (msg.role === 'bot' && meta.kind !== 'bot_card' && meta.kind !== 'bot_question') pulseAvatar(meta.bot, 'message');
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const useAvatarPulse = (id) => useSyncExternalStore(subscribe, () => (id == null ? null : pulses.get(Number(id)) ?? null));

// What a bot's avatar does now: a moment (bounce, hop) first, then paused, working (its turn runs) or idle.
export const avatarState = ({ pulse = null, paused = false, busy = false } = {}) => pulse ?? (paused ? 'paused' : busy ? 'working' : 'idle');
