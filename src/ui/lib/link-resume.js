// Pure pieces of the phone's live-event stream (src/ui/lib/web-bridge.js), kept apart so they are tested without a window:
// reading numbered events, asking the PC to resume after the last one seen, and resending a call once with its same nonce.
import { retryDelay } from './net.js';

// The events the screens already reload their state on; a `resync` from the PC fires all of them (the Android app's list).
export const RESYNC_EVENTS = ['orb:resync', 'inbox:changed', 'board:changed', 'approval:changed', 'config:changed'];

// One SSE block ("id: …\ndata: …", pings and comments have neither) → { id, data }.
export function parseBlock(block) {
  let id = null; const data = [];
  for (const line of String(block).split('\n')) {
    if (line.startsWith('id: ')) id = line.slice(4).trim();
    else if (line.startsWith('data: ')) data.push(line.slice(6));
  }
  return { id, data: data.join('') };
}

// How to ask for the stream: the `Last-Event-ID` header, or `?since=` where a header would need the PC's CORS answer to
// allow it (the app's page is not served by the PC). Nothing before the first event seen.
export function resumeRequest(lastId, { crossOrigin = false } = {}) {
  if (!lastId) return { headers: {}, query: '' };
  return crossOrigin ? { headers: {}, query: `?since=${encodeURIComponent(lastId)}` } : { headers: { 'Last-Event-ID': lastId }, query: '' };
}

// The wait before the next connection: 1, 2, 5, 10, 30 s, then every 30 s; a stream that delivered something starts over.
export const reconnectWait = (failures) => retryDelay(failures);

// Sends a call and, when it got no answer (the PC could not be reached or took too long), once more with the same sealed
// request, so the same nonce: the PC then answers from what it already did instead of running the call twice. `send` takes
// no arguments, it must resend that same request. An answer of the PC (even an error) is never sent again.
export async function sendOnce(send, { again = true } = {}) {
  try { return await send(); }
  catch (error) {
    if (!again || !error?.offline) throw error;
    return send();
  }
}
