// The proof that Orb itself created a project folder (so «Desinstalar» and «Restablecer» may send it to the Recycle Bin):
// a random token stored twice, in the database (projects.created_by_orb) and in the folder (.orb-creada). Only a folder
// where both agree counts; anything else (a folder the user made, imported, cloned or copied) is never taken for Orb's.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MARK_FILE = '.orb-creada';
const TOKEN = /^[0-9a-f]{32}$/;
export const newToken = () => crypto.randomBytes(16).toString('hex');
export const validToken = (t) => typeof t === 'string' && TOKEN.test(t);

// Writes the mark inside the folder and keeps it out of git (info/exclude: .gitignore stays the user's own file).
export function writeMark(folder, token) {
  fs.writeFileSync(path.join(folder, MARK_FILE), `${token}\n`);
  try {
    const info = path.join(folder, '.git', 'info');
    if (fs.existsSync(path.join(folder, '.git'))) {
      fs.mkdirSync(info, { recursive: true });
      const exclude = path.join(info, 'exclude');
      const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
      if (!text.split(/\r?\n/).includes(MARK_FILE)) fs.appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}${MARK_FILE}\n`);
    }
  } catch { /* the mark still works; it just shows up as an untracked file */ }
}

// The token the folder carries, or null: a plain file (never a link) holding exactly one token.
export function readMark(folder) {
  const file = path.join(folder, MARK_FILE);
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > 100) return null;
    const token = fs.readFileSync(file, 'utf8').trim();
    return validToken(token) ? token : null;
  } catch { return null; }
}

// Both marks, and the same token in them. dbToken: projects.created_by_orb.
export const marked = (folder, dbToken) => validToken(dbToken) && readMark(folder) === dbToken;
