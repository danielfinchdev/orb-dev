// Text helpers with no dependencies: bounded single lines, local timestamps for people, readable sizes, and the limits
// of what an agent or a person may write into a task.

export const MAX_DESCRIPTION = 12000;
export const MAX_DEP_RESULT = 4000; // a dependency's whole summary (1500 cut the "how to test it" part)

// One line, bounded: for anything an agent or a creator controls that ends up in BITACORA.md or a notice.
export const oneLine = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// times written for people (names of backups, PIZARRA.md) in the PC's local time, not UTC.
const pad = (n) => String(n).padStart(2, '0');
export const localStamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
export const localText = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
// A size people can read: KB below 1 MB (never "0 MB" for 445 KB), MB with one decimal below 10 MB.
export function sizeText(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1048576) return `${Math.max(b ? 1 : 0, Math.round(b / 1024))} KB`;
  const mb = b / 1048576;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// A path on one line, cut in the middle: the start of the disk (drive and first folder) and the last folders stay, so it
// reads «C:\Users\…\Proyectos\tienda-web». A path that already fits is returned as it is.
export function shortPath(path, max = 44) {
  const text = String(path ?? '');
  if (text.length <= max) return text;
  const sep = text.includes('\\') ? '\\' : '/';
  const parts = text.split(sep);
  const headCount = 2; // «C:» + «Users», or «» + «home»
  if (parts.length <= headCount + 1) return text;
  const head = parts.slice(0, headCount).join(sep);
  let tail = [parts[parts.length - 1]];
  for (let i = parts.length - 2; i >= headCount; i -= 1) {
    const next = [parts[i], ...tail];
    if (head.length + sep.length + 1 + sep.length + next.join(sep).length > max) break;
    tail = next;
  }
  if (tail.length + headCount >= parts.length) return text;
  return `${head}${sep}…${sep}${tail.join(sep)}`;
}
