// A throwaway Orb for the uninstall tests: a workspace with data in every box, a fake app data folder (the saved location, the
// key and vault copies) and a backups folder. Everything lives in one temporary folder: nothing here touches a real Orb.
import { tempHome } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx } from '../src/platform/context.mjs';
import { paths, homeKey, oldHomeKey } from '../src/platform/paths.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import * as K from '../src/domain/data/backup.mjs';
import { uninstallEnv } from '../src/domain/data/uninstall.mjs';

export const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
export const tree = (dir) => {
  const out = [];
  const go = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); out.push(path.relative(dir, f).split(path.sep).join('/')); if (e.isDirectory()) go(f); } };
  if (fs.existsSync(dir)) go(dir);
  return out.sort();
};

// opts.backups: { folder: 'custom' | null } — a custom folder gets a copy too.
export async function world({ backups = true, customFolder = false, vault = true } = {}) {
  const t = tempHome();
  const userData = path.join(t.base, 'AppData', 'Orb.dev');
  fs.mkdirSync(path.join(userData, 'claves'), { recursive: true });
  const home = t.home;
  const p = paths(home);
  const board = new Board();
  const secret = crypto.randomBytes(32);
  // projects: two made by Orb, one a user's folder inside a category (old: no marks), one outside the workspace
  const mine = createProject(board, { name: 'tienda', category: 'web', template: false }, 'usuario');
  const second = createProject(board, { name: 'blog', category: 'windows', template: false }, 'usuario');
  put(path.join(mine.path, 'index.html'), '<h1>tienda</h1>');
  put(path.join(second.path, 'main.rs'), 'fn main(){}');
  const oldFolder = path.join(home, 'linux', 'scripts-viejos'); fs.mkdirSync(oldFolder, { recursive: true }); put(path.join(oldFolder, 'a.sh'), 'echo');
  board.addProject({ name: 'scripts-viejos', path: oldFolder }, 'usuario', { fromUser: true });
  const outside = path.join(t.base, 'fuera', 'proyecto-externo'); fs.mkdirSync(outside, { recursive: true }); put(path.join(outside, 'k.txt'), 'mio');
  board.addProject({ name: 'externo', path: outside }, 'usuario', { fromUser: true });
  // data of every box
  const conv = board.createConversation({ title: 'Hola' });
  board.run('INSERT INTO chat (role, body, at, conversation_id) VALUES (?, ?, ?, ?)', 'usuario', 'texto del chat', new Date().toISOString(), conv.id);
  board.run("INSERT INTO devices (id, name, token_hash, created_at) VALUES ('d1', 'Movil', 'h1', '2026-01-01')");
  board.setting('pin_probe', 'x'); board.setting('backup_last', '{}'); board.setting('projects_finished', '[]');
  put(path.join(p.runs, '1', 'registro.jsonl'), '{}');
  put(path.join(p.copies, 'fotos', 'a.txt')); put(path.join(p.chatTrees, 'x', 'b.txt'));
  put(path.join(p.logs, 'GENERAL.md'), '# bitacora'); put(path.join(p.projectLogs, 'tienda.md'), 'log');
  put(path.join(p.skills, 'una', 'SKILL.md')); put(path.join(p.rules, 'persona.md')); put(path.join(p.mcp, 'srv', 'a.json'), '{}');
  put(path.join(p.core, 'cuentas', 'claude', 'auth.json'), '{}');
  put(path.join(p.data, 'enlaces.json'), '{}');
  if (vault) { put(path.join(p.secrets, 'maestra.json'), '{}'); put(path.join(p.secrets, 'secretos.json'), '{}'); }
  // this PC's key, in every form, and the copies outside core
  for (const f of ['clave2.enc', 'clave.enc', 'clave.bin', 'clave.lock', 'clave-anterior.json', 'clave-volver.json', 'clave-nueva.json', 'copia-clave.json', 'clave2.20260101.ilegible.enc']) put(path.join(p.data, f));
  const hk = homeKey(home); const old = oldHomeKey(home);
  for (const f of [`${hk}.enc`, `${hk}.v2.enc`, `${hk}.20260101.enc`, `${old}.enc`, `${old}.v2.enc`]) put(path.join(userData, 'claves', f));
  if (vault) { put(path.join(userData, 'claves', `${hk}-secretos`, 'maestra.json')); put(path.join(userData, 'claves', `${old}-secretos`, 'maestra.json')); }
  put(path.join(userData, 'claves', 'otro-orb-1234abcd.v2.enc'), 'ajeno'); // another workspace's key: never touched
  fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
  fs.writeFileSync(path.join(userData, 'interfaz.json'), '{}');
  K.orbIdOf(home);
  const folder = customFolder ? path.join(t.base, 'MisCopias') : null;
  const made = [];
  if (backups) {
    made.push((await K.createBackup({ home, secret, kind: 'manual', version: 'test' })).file);
    if (folder) made.push((await K.createBackup({ home, secret, kind: 'manual', version: 'test', folder })).file);
  }
  const config = { ...ctx.config, ...(folder ? { backup: { folder } } : {}) };
  const signKey = crypto.randomBytes(32); // what signs the journal (this PC's key in the app)
  const env = () => uninstallEnv({ home, userData, config, signKey });
  const rows = () => board.projects();
  return { ...t, signKey, userData, home, p, board, secret, env, rows, mine, second, oldFolder, outside, folder, made, hk, old, close: () => { try { board.db.close(); } catch { /* closed */ } } };
}
