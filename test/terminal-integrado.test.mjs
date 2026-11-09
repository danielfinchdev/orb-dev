// 3.8.2 (fase 10, T3 3.2): the user's terminal docked under a chat. It is the user's (no guard), so this PC only, never
// in core, Orb's data or a protected folder, and without the engine's own variables; Ctrl+J (app.openTerminal) is as it
// was. The tests drive a small Node «shell» instead of PowerShell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, until } from './helpers.mjs';
import { useHome, ctx } from '../src/core/context.mjs';
import { terminalDir, shellPlan, createTerminals, MAX_TERMINALS, MAX_LINE } from '../src/engine/user-terminal.mjs';
import { allowed, principalOf, METHODS } from '../src/core/permissions.mjs';
import { oneCommand, stripAnsi, pasteToTerminal, onTerminalPaste, SHELL_LANGUAGES } from '../src/ui/lib/terminal-paste.js';

// Echoes each line and says whether a variable of Orb's engine reached it.
const FAKE_SHELL = "process.stdout.write('listo ' + Object.keys(process.env).filter((k) => /^ORB_/i.test(k)).length + '\\n'); require('readline').createInterface({ input: process.stdin }).on('line', (l) => process.stdout.write('eco: ' + l + '\\n'))";

test('terminal integrado: carpeta del chat, nunca core ni lo protegido, sin las variables del motor', async () => {
  const t = tempHome();
  const before = process.env.ORB_PRUEBA_TERMINAL;
  process.env.ORB_PRUEBA_TERMINAL = 'no-debe-llegar';
  try {
    useHome(t.home);
    const project = path.join(t.home, 'web', 'tienda'); fs.mkdirSync(project, { recursive: true });
    const vault = path.join(t.home, 'web', 'Vaultwarden'); fs.mkdirSync(vault, { recursive: true });
    fs.mkdirSync(path.join(ctx.paths.core, 'datos'), { recursive: true });
    assert.equal(terminalDir(project).toLowerCase(), fs.realpathSync.native(project).toLowerCase());
    for (const bad of [ctx.paths.core, path.join(ctx.paths.core, 'datos'), ctx.paths.skills]) assert.throws(() => terminalDir(bad), /datos de Orb/, bad);
    assert.throws(() => terminalDir(vault, { protectedList: ['Vaultwarden'] }), /protegidas/);
    assert.throws(() => terminalDir('relativa'), /no existe/);
    assert.throws(() => terminalDir(path.join(project, 'nada')), /no existe/);
    // The shell: Windows' own PowerShell by its full path, never with Orb's variables.
    const plan = shellPlan('win32', { SystemRoot: 'C:\\Windows', PATH: 'x', ORB_AUTH_PIPE: 'p', orb_vault_pipe: 'v' });
    assert.equal(plan.cmd, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(Object.keys(plan.env), ['SystemRoot', 'PATH']);
    // PowerShell reads stdin in the old code page: a line with ñ goes as UTF-8 in base64, ASCII as it is.
    assert.equal(plan.line('git status'), 'git status');
    const b64 = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(plan.line("echo 'año'"))?.[1];
    assert.equal(Buffer.from(b64, 'base64').toString('utf8'), "echo 'año'");

    const events = [];
    const terms = createTerminals({ emit: (e, p) => events.push([e, p]), plan: () => ({ ...shellPlan(), cmd: process.execPath, args: ['-e', FAKE_SHELL], init: '' }) });
    assert.throws(() => terms.open({ dir: ctx.paths.core }), /datos de Orb/);
    const one = terms.open({ dir: project });
    const output = () => events.filter(([e, p]) => e === 'terminal:data' && p.id === one.id).map(([, p]) => p.data).join('');
    await until(() => /listo 0/.test(output()), 'el terminal arranca sin variables ORB_', 10_000);
    assert.equal(terms.write({ id: one.id, text: 'npm test' }), true);
    await until(() => /eco: npm test/.test(output()), 'la línea escrita', 10_000);
    assert.throws(() => terms.write({ id: one.id, text: 'a\nb' }), /no válido/, 'una línea, nunca varias de golpe');
    assert.throws(() => terms.write({ id: one.id, text: 'x'.repeat(MAX_LINE + 1) }), /no válido/);
    assert.match(terms.list()[0].out, /eco: npm test/, 'lo escrito se conserva para la ventana que vuelve');
    const more = [];
    for (let i = 1; i < MAX_TERMINALS; i++) more.push(terms.open({ dir: project }));
    assert.throws(() => terms.open({ dir: project }), /demasiados/);
    assert.equal(terms.close({ id: one.id }), true);
    assert.throws(() => terms.write({ id: one.id, text: 'ls' }), /cerrado/);
    terms.closeAll();
    assert.deepEqual(terms.list(), []);
    // This PC only; Ctrl+J's terminal is still the same method.
    for (const m of ['terminal.list', 'terminal.open', 'terminal.write', 'terminal.close']) {
      assert.equal(METHODS[m], 'pc');
      assert.ok(!allowed(principalOf({ device: { id: 1, kind: 'phone' } }), m), `${m}: el móvil no`);
    }
    assert.equal(METHODS['app.openTerminal'], 'pc');
  } finally {
    if (before === undefined) delete process.env.ORB_PRUEBA_TERMINAL; else process.env.ORB_PRUEBA_TERMINAL = before;
  }
});

test('terminal integrado: un comando del chat se pega, no se ejecuta', () => {
  assert.equal(pasteToTerminal('ls'), false, 'sin terminal abierto no lo toma nadie');
  const got = [];
  const off = onTerminalPaste((l) => got.push(l));
  assert.equal(pasteToTerminal('npm run dev\n'), true);
  off();
  assert.deepEqual(got, ['npm run dev']);
  assert.equal(oneCommand('# instala\n$ npm install\nPS C:\\x> npm test\n\nREM nada'), 'npm install; npm test');
  assert.equal(stripAnsi('\x1b[32mok\x1b[0m\r\nfin\rX'), 'ok\r\nfinX');
  assert.ok(SHELL_LANGUAGES.has('powershell') && !SHELL_LANGUAGES.has('js'));
});
