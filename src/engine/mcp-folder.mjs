// The MCP servers' folder (<home>\mcp-servers): Orb's configuration, not a project. Each subfolder is a server; Ajustes
// lists them with the command that starts them, so adding one to the agents is one click.
import fs from 'node:fs';
import path from 'node:path';
import { ctx } from '../core/context.mjs';

const NODE_FILES = ['src/server.js', 'src/index.js', 'server.js', 'index.js', 'dist/index.js', 'build/index.js', 'src/server.mjs', 'server.mjs', 'index.mjs'];
const PY_FILES = ['server.py', 'main.py', 'src/server.py', 'src/main.py'];

// How to start the server in `dir`: { command, args } or null when it cannot be told.
export function startCommand(dir) {
  // A file inside `dir` (package.json may point anywhere: outside the server's folder is not its server).
  const has = (rel) => { const f = path.resolve(dir, rel); const r = path.relative(dir, f); try { return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r) && fs.statSync(f).isFile(); } catch { return false; } };
  let pkg = null; try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* not node */ }
  if (pkg) {
    const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0];
    for (const rel of [bin, pkg.main].filter((x) => typeof x === 'string')) if (has(rel)) return { command: 'node', args: [path.resolve(dir, rel)] };
  }
  for (const rel of NODE_FILES) if (has(rel)) return { command: 'node', args: [path.join(dir, rel)] };
  for (const rel of PY_FILES) if (has(rel)) return { command: process.platform === 'win32' ? 'python' : 'python3', args: [path.join(dir, rel)] };
  return null;
}

export function mcpFolder() {
  const dir = ctx.paths.mcp;
  let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* created at start */ }
  const configured = ctx.config.mcpServers ?? [];
  const norm = (p) => path.resolve(p).toLowerCase();
  const servers = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => {
    const folder = path.join(dir, e.name);
    const start = startCommand(folder);
    const used = configured.find((s) => s.name === e.name || (s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && norm(a).startsWith(norm(folder) + path.sep.toLowerCase())));
    return { name: e.name, dir: folder, command: start?.command ?? null, args: start?.args ?? [], configured: used?.name ?? null };
  });
  return { dir, servers };
}
