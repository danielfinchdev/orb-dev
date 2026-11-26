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
import { detectEngines, transcribeWav, runCli } from '../src/engine/host/dictation.mjs';
import { encodeWav, checkWav, MAX_WAV_BYTES } from '../src/shared/wav.mjs';
import { appMethods } from '../src/engine/api/app.mjs';
import { METHODS, REMOTE_METHODS } from '../src/domain/security/permissions.mjs';
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

test('fallback: Windows is the default and a missing engine falls back to it', () => {
  assert.equal(dictationChoice({}), 'windows');
  assert.equal(dictationChoice({ ui: { dictation: 'nope' } }), 'windows');
  assert.deepEqual(resolveDictation('windows', {}), { engine: 'windows', wanted: 'windows', fellBack: false, reason: null });
  assert.deepEqual(resolveDictation('handy', { handy: false }), { engine: 'windows', wanted: 'handy', fellBack: true, reason: 'missing' });
  assert.equal(resolveDictation('handy', { handy: true }).engine, 'handy');
  assert.equal(resolveDictation('whisper', { whisper: true }).engine, 'whisper');
  assert.equal(resolveDictation('whisper', {}).reason, 'missing');
});

test('the choice is saved, read back and validated', () => {
  saveConfig({ ui: { dictation: 'handy' } });
  assert.equal(JSON.parse(fs.readFileSync(ctx.paths.config, 'utf8')).ui.dictation, 'handy');
  assert.equal(loadConfig(ctx.home).ui.dictation, 'handy');
  assert.throws(() => saveConfig({ ui: { dictation: 'rm -rf' } }));
  assert.equal(ctx.config.ui.dictation, 'handy');
});

// ---- recording → text ----
const wavBuf = (n = 1600) => Buffer.from(encodeWav(new Float32Array(n).fill(0.1)));
const tmpDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('orb-dictado-') && fs.statSync(path.join(os.tmpdir(), n)).isDirectory() && path.join(os.tmpdir(), n) !== root);
const withWhisper = (extra = {}) => async () => ({ whisper: { found: true, file: path.join(root, 'whisper-cli'), modelFile: path.join(root, 'ggml-base.bin'), ...extra } });

test('the WAV the window makes is the one the engine accepts, and nothing else is', () => {
  assert.ok(checkWav(wavBuf()));
  assert.equal(checkWav(Buffer.from('RIFFxxxx')), false);
  const stereo = wavBuf(); stereo.writeUInt16LE(2, 22); assert.equal(checkWav(stereo), false);
  assert.equal(checkWav(Buffer.alloc(MAX_WAV_BYTES + 1)), false);
});

test('the engine writes the recording to a private folder, runs whisper.cpp without a shell and removes the folder', async () => {
  const before = tmpDirs().length; let call = null;
  const text = await transcribeWav(wavBuf(), { detect: withWhisper(), run: async (file, args) => {
    call = { file, args, existed: fs.existsSync(args[args.indexOf('-f') + 1]) };
    return { stdout: ' [BLANK_AUDIO] Hola   mundo ', stderr: 'log' };
  } });
  assert.equal(text, 'Hola mundo');
  assert.equal(call.existed, true);
  assert.deepEqual(call.args.slice(0, 2), ['-m', path.join(root, 'ggml-base.bin')]);
  assert.ok(call.args.includes('-nt') && call.args.includes('auto'));
  assert.equal(fs.existsSync(path.dirname(call.args[call.args.indexOf('-f') + 1])), false, 'temporary folder removed');
  assert.equal(tmpDirs().length, before);
});

test('a faster-whisper front end gets local files only and its text file is read', async () => {
  let args;
  const text = await transcribeWav(wavBuf(), { detect: withWhisper({ file: path.join(root, 'whisper-ctranslate2.exe'), modelFile: null }), run: async (_f, a) => {
    args = a; fs.writeFileSync(path.join(a[a.indexOf('--output_dir') + 1], 'voz.txt'), 'texto de prueba'); return { stdout: '' };
  } });
  assert.equal(text, 'texto de prueba');
  assert.equal(args[args.indexOf('--local_files_only') + 1], 'True');
});

test('missing engine or model, failure, empty text and timeout give a code and leave no temporary folder', async () => {
  const before = tmpDirs().length;
  const code = async (opts) => { try { await transcribeWav(wavBuf(), opts); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(await code({ detect: async () => ({ whisper: { found: false } }) }), 'noEngine');
  assert.equal(await code({ detect: withWhisper({ modelFile: null }) }), 'noModel');
  assert.equal(await code({ detect: withWhisper(), run: async () => { throw Object.assign(new Error('boom'), { code: 'failed' }); } }), 'failed');
  assert.equal(await code({ detect: withWhisper(), run: async () => { throw Object.assign(new Error('t'), { code: 'timeout' }); } }), 'timeout');
  assert.equal(await code({ detect: withWhisper(), run: async () => ({ stdout: '[BLANK_AUDIO]' }) }), 'empty');
  assert.equal(tmpDirs().length, before);
});

test('the real runner kills a program that takes longer than the maximum time', async () => {
  const started = Date.now();
  await assert.rejects(runCli(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeoutMs: 400 }), (e) => e.code === 'timeout');
  assert.ok(Date.now() - started < 10000);
  const ok = await runCli(process.execPath, ['-e', 'console.log("fijo")'], { timeoutMs: 10000 });
  assert.equal(ok.stdout.trim(), 'fijo');
});

test('dictation.transcribe is for this PC only and refuses bad or oversized audio', async () => {
  assert.equal(METHODS['dictation.transcribe'], 'pc');
  assert.equal(REMOTE_METHODS.has('dictation.transcribe'), false);
  assert.equal(REMOTE_METHODS.has('app.dictationEngines'), false);
  const api = appMethods({ home: root, version: '0.0.0' });
  await assert.rejects(api['dictation.transcribe']({ wav: Buffer.from('not a wav').toString('base64') }), /grabaci|recording/i);
  await assert.rejects(api['dictation.transcribe']({ wav: 'A'.repeat(6_000_001) }), /larga|long/i);
  await assert.rejects(api['dictation.transcribe']({}), /larga|long/i);
});
