// 3.8.2 (fase 10, T3 3.17): Android emulators besides the phone. Only an emulator of the SDK already on this PC (never
// downloaded), listed and started by its exact AVD name, with the same grant as the phone; the real emulator and adb
// never run here (fixtures/fake-emulator.mjs, fake-adb.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempHome, fake, until } from './helpers.mjs';
import { useHome } from '../src/platform/context.mjs';
import { createAndroid, sdkEmulator, parseAvds, emulatorEnv, AVD } from '../src/engine/android.mjs';
import { allowed, needsUnlock, principalOf, METHODS } from '../src/core/permissions.mjs';

test('emuladores: solo el emulador del SDK ya instalado, por su nombre exacto y con el permiso del móvil', async () => {
  const t = tempHome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-emu-'));
  const logFile = path.join(work, 'emulador.jsonl');
  const before = { FAKE_EMULATOR_LOG: process.env.FAKE_EMULATOR_LOG, ORB_PRUEBA_SECRETO: process.env.ORB_PRUEBA_SECRETO };
  Object.assign(process.env, { FAKE_EMULATOR_LOG: logFile, ORB_PRUEBA_SECRETO: 'no-debe-llegar' });
  const runs = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  try {
    useHome(t.home);
    // Where the SDK is: ANDROID_SDK_ROOT, ANDROID_HOME or Android Studio's folder; nothing when it is not installed.
    const sdk = path.join(work, 'Sdk'); fs.mkdirSync(path.join(sdk, 'emulator'), { recursive: true });
    const bin = path.join(sdk, 'emulator', 'emulator.exe'); fs.writeFileSync(bin, '');
    assert.equal(sdkEmulator({ ANDROID_SDK_ROOT: sdk }, 'win32'), bin);
    assert.equal(sdkEmulator({ LOCALAPPDATA: work.replace(/Sdk$/, '') }, 'win32'), null);
    fs.mkdirSync(path.join(work, 'Android'), { recursive: true }); fs.renameSync(sdk, path.join(work, 'Android', 'Sdk'));
    assert.equal(sdkEmulator({ LOCALAPPDATA: work }, 'win32'), path.join(work, 'Android', 'Sdk', 'emulator', 'emulator.exe'));
    assert.equal(sdkEmulator({ ANDROID_SDK_ROOT: 'relativa' }, 'win32'), null, 'nunca una carpeta relativa');
    assert.deepEqual(parseAvds('INFO    | algo\nPixel_8\n\nPixel_8\nmal nombre\n-avd\n'), ['Pixel_8']);
    for (const bad of ['', '-wipe-data', 'a b', 'x;calc', '../x', 'a'.repeat(101)]) assert.ok(!AVD.test(bad), bad);
    assert.deepEqual(Object.keys(emulatorEnv({ PATH: 'p', ORB_AUTH_PIPE: 'x', orb_ticket_orb: 'y', ANDROID_USER_HOME: 'z' })), ['PATH']);

    const settings = new Map();
    const board = { settingJson: (k, val) => { if (val !== undefined) { settings.set(k, val); return val; } return settings.get(k) ?? null; } };
    // Not installed: said so, and nothing starts.
    const none = createAndroid({ board, exe: () => fake('fake-adb.mjs'), emulator: () => null, ensure: async () => ({}) });
    assert.deepEqual(await none.emulators(), { sdk: false, avds: [] });
    await assert.rejects(none.emulatorStart({ avd: 'Pixel_8_API_35' }), /Android Studio/);
    const android = createAndroid({ board, exe: () => fake('fake-adb.mjs'), emulator: () => fake('fake-emulator.mjs'), ensure: async () => ({}) });
    assert.deepEqual(await android.emulators(), { sdk: true, avds: ['Pixel_8_API_35', 'Medium_Phone'] });
    // Only an existing AVD, by a plain name: never an emulator option or another program.
    await assert.rejects(android.emulatorStart({ avd: '-wipe-data' }), /no válido/);
    await assert.rejects(android.emulatorStart({ avd: 'Otro' }), /No existe/);
    assert.match(await android.emulatorStart({ avd: 'Pixel_8_API_35' }), /Arrancando Pixel_8_API_35/);
    await until(() => runs().some((r) => r.args[0] === '-avd'), 'el emulador arrancado', 5000);
    const start = runs().find((r) => r.args[0] === '-avd');
    assert.deepEqual(start.args, ['-avd', 'Pixel_8_API_35']);
    assert.deepEqual(start.leaked, [], 'las variables del motor no llegan al emulador');
    // The agents' tools: the same grant as the phone, and never from a chat without it.
    const s = { id: 'c1', kind: 'chat', project: 'web', permission: 'editar', android: 0, cwd: t.home };
    await assert.rejects(android.tool(s, 'emulators'), /Usar mi móvil Android/);
    await assert.rejects(android.tool(s, 'emulator', { avd: 'Medium_Phone' }), /Usar mi móvil Android/);
    await assert.rejects(android.tool({ ...s, kind: 'task', android: 1 }, 'emulator', { avd: 'Medium_Phone' }), /Usar mi móvil Android/, 'una tarea, nunca');
    s.android = 1;
    assert.match((await android.tool(s, 'emulators')).text, /Pixel_8_API_35, Medium_Phone/);
    assert.match((await android.tool(s, 'emulator', { avd: 'Medium_Phone' })).text, /Arrancando Medium_Phone/);
    // The settings: this PC only, and starting one asks for the master password.
    for (const m of ['android.emulators', 'android.emulatorStart']) {
      assert.equal(METHODS[m], 'pc');
      assert.ok(!allowed(principalOf({ device: { id: 1, kind: 'phone' } }), m), `${m}: el móvil no`);
    }
    assert.ok(needsUnlock('android.emulatorStart', {}));
    assert.ok(!needsUnlock('android.emulators', {}));
  } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(work, { recursive: true, force: true }); t.cleanup?.();
  }
});
