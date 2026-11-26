// Configurable dictation: read-only detection of local engines (fake PATH and folders), the fallback to Windows, and
// the saved choice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { saveConfig } from '../src/platform/config.mjs';
import { loadConfig } from '../src/platform/config-file.mjs';
import { detectEngines } from '../src/engine/host/dictation.mjs';
import { resolveDictation, dictationChoice } from '../src/shared/dictation.mjs';

const t = tempHome();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-dictado-'));
after(() => { t.cleanup(); fs.rmSync(root, { recursive: true, force: true }); });
const touch = (file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); return file; };
const noProbe = async () => null;

test('nothing installed: nothing found', async () => {
  const home = path.join(root, 'empty-home'); const bin = path.join(root, 'empty-bin'); fs.mkdirSync(bin, { recursive: true });
  const r = await detectEngines({ platform: 'linux', env: { PATH: bin }, home, probe: noProbe });
  assert.equal(r.handy.found, false); assert.equal(r.whisper.found, false); assert.equal(r.whisper.model, false);
});

test('whisper CLI on PATH is found, its version read and its model detected, never fetched', async () => {
  const home = path.join(root, 'h1'); const bin = path.join(root, 'bin1');
  const file = touch(path.join(bin, 'whisper-cli'));
  assert.equal(fs.existsSync(path.join(home, '.cache', 'whisper')), false);
  let probed = null;
  const r1 = await detectEngines({ platform: 'linux', env: { PATH: bin }, home, probe: async (f) => { probed = f; return 'whisper 1.7'; } });
  assert.equal(r1.whisper.found, true); assert.equal(r1.whisper.file, file); assert.equal(r1.whisper.version, 'whisper 1.7'); assert.equal(probed, file);
  assert.equal(r1.whisper.model, false);
  assert.equal(fs.existsSync(path.join(home, '.cache', 'whisper')), false, 'detection creates nothing');
  touch(path.join(home, '.cache', 'whisper', 'ggml-base.bin'));
  assert.equal((await detectEngines({ platform: 'linux', env: { PATH: bin }, home, probe: noProbe })).whisper.model, true);
});

test('Handy is found by its install folder on Windows and is never started', async () => {
  const local = path.join(root, 'local');
  const file = touch(path.join(local, 'Handy', 'handy.exe'));
  let probed = false;
  const r = await detectEngines({ platform: 'win32', env: { LOCALAPPDATA: local, PATH: '' }, home: root, probe: async () => { probed = true; return null; } });
  assert.equal(r.handy.found, true); assert.equal(r.handy.file, file);
  assert.equal(probed, false, 'no version probe on a desktop app');
});

test('a version probe that fails or hangs does not hide the engine', async () => {
  const bin = path.join(root, 'bin2'); touch(path.join(bin, 'whisper-ctranslate2'));
  const r = await detectEngines({ platform: 'linux', env: { PATH: bin }, home: root, probe: noProbe });
  assert.equal(r.whisper.found, true); assert.equal(r.whisper.version, null);
});

test('fallback: Windows is the default and a missing or undriveable engine falls back to it', () => {
  assert.equal(dictationChoice({}), 'windows');
  assert.equal(dictationChoice({ ui: { dictation: 'nope' } }), 'windows');
  assert.deepEqual(resolveDictation('windows', {}), { engine: 'windows', wanted: 'windows', fellBack: false, reason: null });
  assert.deepEqual(resolveDictation('handy', { handy: false }), { engine: 'windows', wanted: 'handy', fellBack: true, reason: 'missing' });
  assert.equal(resolveDictation('handy', { handy: true }).engine, 'handy');
  const w = resolveDictation('whisper', { whisper: true });
  assert.equal(w.engine, 'windows'); assert.equal(w.reason, 'unsupported');
  assert.equal(resolveDictation('whisper', {}).reason, 'missing');
});

test('the choice is saved, read back and validated', () => {
  saveConfig({ ui: { dictation: 'handy' } });
  assert.equal(JSON.parse(fs.readFileSync(ctx.paths.config, 'utf8')).ui.dictation, 'handy');
  assert.equal(loadConfig(ctx.home).ui.dictation, 'handy');
  assert.throws(() => saveConfig({ ui: { dictation: 'rm -rf' } }));
  assert.equal(ctx.config.ui.dictation, 'handy');
});
