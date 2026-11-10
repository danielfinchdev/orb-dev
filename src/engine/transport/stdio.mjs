// 3.8.1: the engine's transport for an app that starts it as a plain process (Tauri: Rust starts the bundled node.exe
// with ORB_ENGINE_STDIO=1): one JSON message per line, app → engine on stdin and engine → app on stdout. No port and no
// named pipe: no other process can talk to the engine. stdout belongs to the channel, so anything else written there
// (console.log, a library's stray output) goes to stderr, which the app keeps in motor-salida.log.
// On Windows, writes to these pipes are synchronous: while the app does not read stdout or stderr, this whole process
// waits (turns, timers, the phone). The app must drain both pipes all the time, each on its own thread, and write stdin
// from another one (src-tauri/src/pipes.rs); anything sent at a high rate here (frames) must be merged or dropped while
// one is still pending.
import readline from 'node:readline';

// One message, one line: JSON.stringify never leaves a raw line break inside (they are escaped in strings).
// 3.8.1 (review D2 B3): what JSON changes without saying so (a Buffer becomes { type, data }, a Map or a Set {}, a
// BigInt throws) is sent in a form that keeps its meaning (a Buffer as base64, a Map as an object, a Set as a list,
// a BigInt as text) and written once per kind to stderr (the app's motor-salida.log), so a method that returns one can
// be found. A Date is already its ISO text.
const told = new Set();
const tell = (kind) => { if (!told.has(kind)) { told.add(kind); try { process.stderr.write(`motor: un ${kind} viajó como JSON convertido\n`); } catch { /* no stderr */ } } };
function replacer(_key, value) {
  if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) { tell('Buffer'); return Buffer.from(value.data).toString('base64'); }
  if (value instanceof Map) { tell('Map'); return Object.fromEntries(value); }
  if (value instanceof Set) { tell('Set'); return [...value]; }
  if (typeof value === 'bigint') { tell('BigInt'); return value.toString(); }
  return value;
}
export const encode = (message) => `${JSON.stringify(message, replacer)}\n`;
// A line back to a message; anything that is not a JSON object is dropped (null).
export function decode(line) {
  const text = String(line ?? '').trim();
  if (!text) return null;
  try { const m = JSON.parse(text); return m && typeof m === 'object' && !Array.isArray(m) ? m : null; } catch { return null; }
}

// onClose: the app closed stdin (it quit or died): the engine ends as on 'shutdown'.
export function stdioTransport({ input = process.stdin, output = process.stdout, errors = process.stderr, onClose = null } = {}) {
  const write = output.write.bind(output);
  output.write = (chunk, encoding, callback) => errors.write(chunk, encoding, callback);
  const listeners = [];
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const message = decode(line);
    if (!message) { if (line.trim()) errors.write(`motor: línea ignorada en stdin (${line.length} caracteres)\n`); return; }
    for (const fn of listeners) fn(message);
  });
  lines.on('close', () => onClose?.());
  return {
    send: (message) => { write(encode(message)); },
    on: (fn) => { listeners.push(fn); }
  };
}
