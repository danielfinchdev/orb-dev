// The logs' files (bitácoras) as files: their headers in the settings' language, moving a log folder into another and
// tidying copies left by older versions. What the logs say is src/engine/logs.mjs's business.
import fs from 'node:fs';
import path from 'node:path';
import { translate } from '../shared/i18n.mjs';
import { paths, isReservedName, isCategory } from './paths.mjs';

// A log's entries without its header (the title line and the paragraph under it).
export const logBody = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/^#[^\n]*\n\n(?:[^\n]+\n)*/, '').trim();

// 3.8.2: the copies «name (2).md» earlier builds left in proyectos (a project registered as «name (2)» by 3.7 got a log
// of its own, then took its name back while «name.md» was there): one that holds nothing but its header goes (the log
// of a project with that name is made again when it is needed). One with entries is never touched. → how many went.
export function tidyProjectLogs(dir) {
  let names = []; try { names = fs.readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const f of names) {
    if (!/ \(\d+\)\.md$/i.test(f)) continue;
    const file = path.join(dir, f);
    try { const text = fs.readFileSync(file, 'utf8'); if (/^# /.test(text) && !logBody(text)) { fs.rmSync(file); n++; } } catch { /* in use or not a file: left */ }
  }
  return n;
}

// Moves a log folder into another: a file that exists in both keeps the new one and gets the old entries at its end.
export function moveLogs(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name); const dst = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); moveLogs(src, dst); continue; }
    const text = /\.md$/i.test(e.name) ? fs.readFileSync(src, 'utf8') : null;
    const name = e.name.replace(/\.md$/i, '');
    if (text !== null && path.basename(from) === 'proyectos' && (isReservedName(name) || isCategory(name)) && text.trim() === projectLogHeader(name).trim()) { fs.rmSync(src); continue; }
    if (!fs.existsSync(dst)) { fs.renameSync(src, dst); continue; }
    // Both exist: the old entries go at the end of the new file (a log only grows); the old header is dropped.
    if (text !== null) {
      const body = text.replace(/^#[^\n]*\n\n(?:[^\n]+\n)*/, '').trim();
      if (body) fs.appendFileSync(dst, `\n${body}\n`);
      fs.rmSync(src);
    }
  }
  try { fs.rmdirSync(from); } catch { /* something could not be merged: kept */ }
}

// The headers of the logs, in the language of the settings.
export const generalLogHeader = (config) => translate(config?.language, 'sys.logs.generalHeader', { name: config.assistantName });
export const projectLogHeader = (name, language = 'es') => translate(language, 'sys.logs.projectHeader', { name });

// After a change of language: a log that has nothing but its header gets the header in the new language (logs only
// grow, so one with entries stays as it is).
export function relabelEmptyLogs(home, before, after) {
  const p = paths(home);
  const read = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
  const write = (file, text) => { try { fs.writeFileSync(file, text); } catch { /* busy: left as it is */ } };
  if (read(p.generalLog) === generalLogHeader(before).trim()) write(p.generalLog, generalLogHeader(after));
  // A project's header carries its name as the user wrote it (the file name may be simplified): read it from the header.
  const [pre, post] = projectLogHeader('\u0000', before.language).trim().split('\u0000');
  let files = []; try { files = fs.readdirSync(p.projectLogs).filter((f) => /\.md$/i.test(f)); } catch { /* no project logs yet */ }
  for (const f of files) {
    const file = path.join(p.projectLogs, f); const text = read(file);
    if (!text?.startsWith(pre) || !text.endsWith(post)) continue;
    const name = text.slice(pre.length, text.length - post.length);
    if (name && !name.includes('\n')) write(file, projectLogHeader(name, after.language));
  }
}
