// 3.8.1: the engine's transport for an app that starts it as a plain process (Tauri: Rust starts the bundled node.exe
// with ORB_ENGINE_STDIO=1): one JSON message per line, app → engine on stdin and engine → app on stdout. No port and no
// named pipe: no other process can talk to the engine. stdout belongs to the channel, so anything else written there
// (console.log, a library's stray output) goes to stderr, which the app keeps in motor-salida.log.
import readline from 'node:readline';

// One message, one line: JSON.stringify never leaves a raw line break inside (they are escaped in strings).
export const encode = (message) => `${JSON.stringify(message)}\n`;
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
