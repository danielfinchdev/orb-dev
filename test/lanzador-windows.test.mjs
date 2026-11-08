// 3.8 (F2.6c P2/P12): the connector launcher starts npm shims, .exe files and other batch files on Windows with every
// argument exactly as configured (a folder with a trailing backslash, %VAR%, quotes, & ( ) ^ !), and never runs a
// program from the current folder (the agent's project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { winPlan, resolveWin, cmdArg } from '../src/mcp/win-spawn.mjs';

const WIN = process.platform === 'win32';
const ARGS = ['C:\\some dir\\', 'C:\\x\\', '100%PATH%x', '%USERNAME%', 'a"b', 'say "hi"', 'x & y', '(paren)', '^caret', '!bang!', 'a"&echo HACK&"', '', 'with\\\\"quote', '\\\\server\\share\\', 'tab\there', 'a;b,c=d', 'ñandú ✓'];
const ECHO = "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n";

const run = (plan, cwd) => {
  const r = spawnSync(plan.command, plan.args, { cwd, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: plan.verbatim });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
};

test('lanzador en Windows: shims de npm, cmd-shim y .cmd desconocido conservan los argumentos', { skip: !WIN && 'solo Windows' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-lanzador-'));
  try {
    // npx.cmd of a Node.js install (its script next to it; node from the PATH).
    const npxDir = path.join(dir, 'nodejs'); fs.mkdirSync(path.join(npxDir, 'node_modules', 'npm', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(npxDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'), ECHO);
    fs.writeFileSync(path.join(npxDir, 'npx.cmd'), [
      ':: Created by npm, please don\'t edit manually.', '@ECHO OFF', 'SETLOCAL', 'SET "NODE_EXE=%~dp0\\node.exe"', 'IF NOT EXIST "%NODE_EXE%" (', '  SET "NODE_EXE=node"', ')',
      'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"', '"%NODE_EXE%" "%NPX_CLI_JS%" %*', ''].join('\r\n'));
    // A global package's cmd-shim (%APPDATA%\npm\foo.cmd), in a folder with a space.
    const shimDir = path.join(dir, 'npm global'); fs.mkdirSync(path.join(shimDir, 'node_modules', 'foo', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(shimDir, 'node_modules', 'foo', 'bin', 'cli.js'), ECHO);
    fs.writeFileSync(path.join(shimDir, 'foo.cmd'), ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
      'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', ')',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\foo\\bin\\cli.js" %*', ''].join('\r\n'));
    // Any other batch file: through cmd.exe, escaped.
    fs.writeFileSync(path.join(dir, 'eco.js'), ECHO);
    const other = path.join(dir, 'otro conector.cmd');
    fs.writeFileSync(other, `@"${process.execPath}" "${path.join(dir, 'eco.js')}" %*\r\n`);
    const env = { ...process.env, PATH: [npxDir, shimDir, path.dirname(process.execPath), path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' };

    const npx = winPlan('npx', ARGS, env);
    assert.equal(npx.verbatim, false, 'npx no pasa por cmd.exe'); assert.match(npx.args[0], /npx-cli\.js$/);
    assert.deepEqual(run(npx, dir), ARGS);
    const foo = winPlan('foo', ARGS, env);
    assert.equal(foo.verbatim, false, 'un cmd-shim no pasa por cmd.exe'); assert.match(foo.args[0], /cli\.js$/);
    assert.deepEqual(run(foo, dir), ARGS);
    const cmd = winPlan(other, ARGS, env);
    assert.equal(cmd.verbatim, true, 'un .cmd desconocido va por cmd.exe');
    assert.deepEqual(run(cmd, dir), ARGS);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('lanzador en Windows: nunca ejecuta un programa de la carpeta del proyecto', { skip: !WIN && 'solo Windows' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-lanzador-'));
  const cwd = process.cwd();
  try {
    fs.writeFileSync(path.join(dir, 'uvx.exe'), 'MZ');
    const env = { PATH: `.;;${path.join(dir, 'no-existe')}`, PATHEXT: '.EXE;.CMD' };
    process.chdir(dir);
    assert.equal(resolveWin('uvx', env), null, 'ni «.» ni una entrada vacía del PATH');
    assert.equal(resolveWin('.\\uvx.exe', env), null, 'ni una ruta relativa');
    assert.throws(() => winPlan('uvx', [], env), /No se encuentra «uvx»/);
    process.chdir(cwd);
    assert.equal(resolveWin(path.join(dir, 'uvx'), env)?.toLowerCase(), path.join(dir, 'uvx.exe').toLowerCase(), 'una ruta absoluta sí vale');
  } finally { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('lanzador: escape para cmd.exe (barra final, comillas, %)', () => {
  assert.equal(cmdArg('C:\\a b\\'), '^^^"C:\\a^^^ b\\\\^^^"');
  assert.equal(cmdArg('a"b'), '^^^"a\\^^^"b^^^"');
  assert.equal(cmdArg('%P%'), '^^^"^^^%P^^^%^^^"');
});
