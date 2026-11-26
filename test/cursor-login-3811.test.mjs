// Cursor's login state: cli-config.json exists after any run of the CLI, so only its recorded account means logged in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loginState } from '../src/agents/cursor.mjs';

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-cursor-login-'));
  const before = process.env.USERPROFILE;
  process.env.USERPROFILE = home;
  try { return fn(home); } finally { process.env.USERPROFILE = before; fs.rmSync(home, { recursive: true, force: true }); }
}
const writeConfig = (home, text) => { fs.mkdirSync(path.join(home, '.cursor'), { recursive: true }); fs.writeFileSync(path.join(home, '.cursor', 'cli-config.json'), text); };

test('no ~/.cursor: not logged in', () => withHome(() => assert.equal(loginState(), 'no')));

test('cli-config.json without an account (CLI ran, never logged in): unknown, not «si»', () => withHome((home) => {
  writeConfig(home, JSON.stringify({ version: 1, permissions: { allow: [] } }));
  assert.equal(loginState(), 'desconocido');
}));

test('cli-config.json with authInfo: logged in', () => withHome((home) => {
  writeConfig(home, JSON.stringify({ version: 1, authInfo: { email: 'alex@example.com' } }));
  assert.equal(loginState(), 'si');
}));

test('unreadable cli-config.json: unknown', () => withHome((home) => {
  writeConfig(home, '{ roto');
  assert.equal(loginState(), 'desconocido');
}));
