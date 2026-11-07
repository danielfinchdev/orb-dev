// The MCP servers' folder (<home>\core\mcp, the servers Orb manages): Orb's configuration, not a project. Each subfolder
// is a server; Ajustes lists them with the command that starts them, so adding one to the agents is one click. 3.8: the
// projects that are MCP servers (one the user writes, e.g. moved from 3.7's mcp-servers) are listed the same way.
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

// A project that is an MCP server (its package.json or pyproject names the MCP SDK, or its name says mcp): it can be
// added to the agents from where it lives (a server the user writes is a project, never a part of core).
export function isMcpProject(dir) {
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  if (/mcp/i.test(path.basename(dir))) return true;
  let pkg = null; try { pkg = JSON.parse(read('package.json')); } catch { /* not node */ }
  if (pkg && Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /modelcontextprotocol|(^|[-/])mcp([-/]|$)/i.test(d))) return true;
  return /(^|["'\s])(mcp|fastmcp)([[<>=~"'\s,]|$)/im.test(read('pyproject.toml') + read('requirements.txt'));
}

// projects: the board's projects ({ name, path }). → { dir, servers, projects } (each: { name, dir, command, args, configured }).
export function mcpFolder(projects = []) {
  const dir = ctx.paths.mcp;
  let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* created at start */ }
  const configured = ctx.config.mcpServers ?? [];
  const norm = (p) => path.resolve(p).toLowerCase();
  const describe = (name, folder) => {
    const start = startCommand(folder);
    const used = configured.find((s) => s.name === name || (s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && norm(a).startsWith(norm(folder) + path.sep.toLowerCase())));
    return { name, dir: folder, command: start?.command ?? null, args: start?.args ?? [], configured: used?.name ?? null };
  };
  const servers = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => describe(e.name, path.join(dir, e.name)));
  const fromProjects = (projects ?? []).filter((pr) => typeof pr?.path === 'string' && fs.existsSync(pr.path) && isMcpProject(pr.path) && startCommand(pr.path)).map((pr) => describe(pr.name, pr.path));
  return { dir, servers, projects: fromProjects };
}
