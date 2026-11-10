// Orb's own logs (motor.log, a run's asistente.log or registro.jsonl): rotation, one line per call, secrets hidden.
// The logs people read (bitácoras) are another thing: src/engine/logs.mjs.
import fs from 'node:fs';
import { redactSecrets } from '../shared/secrets-scan.mjs';

// Keeps one previous generation (file.1) once a log passes `max` bytes.
export function rotateIfBig(file, max = 10 * 1024 * 1024) {
  try {
    if (fs.statSync(file).size <= max) return false;
    fs.rmSync(`${file}.1`, { force: true });
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch { return false; }
}

// 3.8.3: the writer of a run log (asistente.log, a conversation's registro.jsonl): one line per call, secrets hidden,
// and at most two generations of `max` bytes. The size is checked again every 200 lines, not only when the agent starts
// (the assistant's conversation lives for days).
export function runLog(file, { prefix = '', max } = {}) {
  rotateIfBig(file, max);
  let lines = 0;
  return (line) => {
    try {
      if (++lines % 200 === 0) rotateIfBig(file, max);
      fs.appendFileSync(file, `${prefix}${redactSecrets(String(line)).replace(/\r?\n/g, ' ')}\n`);
    } catch { /* log unavailable */ }
  };
}
// One message of an agent for a run log: always whole JSON (up to 3.8.2 the line was cut at 4 KB and could not be read),
// with each long string (a file read, a tool's output) shortened instead, and the whole kept under `max` characters.
export function logJson(value, { maxString = 4000, max = 64_000 } = {}) {
  const cut = (n) => (_key, v) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n)}… [+${v.length - n}]` : v);
  try {
    for (const n of [maxString, 500, 80]) { const line = JSON.stringify(value, cut(n)); if (line.length <= max) return line; }
  } catch { /* a value JSON cannot hold */ }
  return JSON.stringify({ type: value?.type ?? null, subtype: value?.subtype ?? null, omitted: 'too long for the log' });
}


// A line with its time (ISO) at the end of a log that rotates past 10 MB; never fatal (the engine's motor.log).
export function writeTimed(file, line) {
  try { if (file) { rotateIfBig(file); fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`); } } catch { /* never fatal */ }
}
