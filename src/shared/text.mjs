// Text helpers with no dependencies: bounded single lines, local timestamps for people, readable sizes, and the limits
// of what an agent or a person may write into a task.

export const MAX_DESCRIPTION = 12000;
export const MAX_DEP_RESULT = 4000; // 3.1: a dependency's whole summary (1500 cut the "how to test it" part)

// One line, bounded: for anything an agent or a creator controls that ends up in BITACORA.md or a notice.
export const oneLine = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// 3.2.1: times written for people (names of backups, PIZARRA.md) in the PC's local time, not UTC.
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
