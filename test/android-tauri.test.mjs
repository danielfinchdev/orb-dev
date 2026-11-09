// 3.8.1: the Android app on Tauri 2 (src-tauri/gen/android, src-tauri/src/mobile.rs, src/ui/lib/app-bridge.js). What can
// be checked without a phone: the phone keeps its link when updated over 3.8.0 (the same Keystore alias, file and format),
// the commands the page calls are the plugin's and allowed only to its window, a notification's buttons work out the
// right call (notes.mjs › backgroundCall), the Rust encryption the buttons use is the page's (phone_crypto.rs vectors,
// opened here with mobile-crypto.mjs), and the release is signed only with the existing key (never a new one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import * as C from '../src/shared/mobile-crypto.mjs';
import { buildNote, backgroundCall, actionRoute } from '../src/shared/notes.mjs';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KT = 'src-tauri/gen/android/app/src/main/java/dev/orb/app';

test('el móvil sigue enlazado al actualizar desde 3.8.0: el mismo almacén del Keystore', () => {
  const store = read(`${KT}/SecureStore.kt`);
  // Orb 3.8.0's OrbNativePlugin.java: KEY_ALIAS = "orb.store", PREFS = "orb.secure", ivLen + ":" + base64(iv ‖ box).
  assert.match(store, /private const val KEY_ALIAS = "orb\.store"/);
  assert.match(store, /private const val PREFS = "orb\.secure"/);
  assert.match(store, /context\.getSharedPreferences\(PREFS, Context\.MODE_PRIVATE\)/);
  assert.match(store, /iv\.size\.toString\(\) \+ ":" \+ Base64\.encodeToString\(iv \+ box, Base64\.NO_WRAP\)/);
  assert.match(store, /Cipher\.getInstance\("AES\/GCM\/NoPadding"\)/);
  assert.match(store, /GCMParameterSpec\(128, all, 0, ivLen\)/);
  assert.match(store, /\.setKeySize\(256\)/);
  // The page keeps the same key name.
  assert.match(read('src/ui/lib/app-bridge.js'), /const KEY = 'orb\.movil';/);
});

test('los comandos del plugin: los que llama la página existen en Kotlin y solo los permite su ventana', () => {
  const build = read('src-tauri/build.rs');
  const listed = [...build.slice(build.indexOf('InlinedPlugin::new()'), build.indexOf('.default_permission')).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const kt = read(`${KT}/OrbNativePlugin.kt`);
  const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  for (const c of listed.filter((x) => !/_listener$/.test(x))) assert.match(kt, new RegExp(`@Command\\s+fun ${camel(c)}\\(invoke: Invoke\\)`), c);
  const bridge = read('src/ui/lib/app-bridge.js');
  const called = [...bridge.matchAll(/nat\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(called.length >= 10);
  for (const c of called) assert.ok(listed.includes(c), `${c} is allowed`);
  const mobile = JSON.parse(read('src-tauri/capabilities/mobile.json'));
  assert.deepEqual(mobile.platforms, ['android']);
  assert.deepEqual(mobile.windows, ['main']);
  assert.ok(mobile.permissions.includes('orb-native:default'));
  for (const f of ['main.json', 'pip.json']) assert.deepEqual(JSON.parse(read(`src-tauri/capabilities/${f}`)).platforms, ['windows'], f);
  // The Rust side registers the Kotlin class of the app's own module.
  assert.match(read('src-tauri/src/mobile.rs'), /register_android_plugin\("dev\.orb\.app", "OrbNativePlugin"\)/);
  // Only the Android build gets the app's bridge; the desktop's bridge never runs there.
  assert.match(bridge, /import\.meta\.env\.MODE === 'android' && Boolean\(window\.__TAURI_INTERNALS__\)/);
  assert.match(read('src/ui/lib/tauri-bridge.js'), /if \(import\.meta\.env\.MODE !== 'android' && window\.__TAURI_INTERNALS__/);
});

test('los botones de un aviso: qué llamada hacen sin abrir la app y cuáles la abren', () => {
  const words = { reply: 'Responder', allow: 'Aprobar', deny: 'Rechazar' };
  const chat = { kind: 'conversation', id: 7, name: 'Web' };
  const msg = buildNote({ chat, line: { id: 1, role: 'assistant', body: 'Hecho' }, words });
  assert.deepEqual(backgroundCall(msg, 'reply'), { method: 'chat.send', params: { conversation: 7 }, text: 'text' });
  // What the app adds (the typed text) gives exactly the page's own call.
  const c = backgroundCall(msg, 'reply');
  assert.deepEqual([c.method, { ...c.params, [c.text]: 'vale' }], actionRoute(msg, 'reply', { text: 'vale' }).call);
  const orb = buildNote({ chat: { kind: 'orb', name: 'Orb' }, line: { id: 2, role: 'assistant', body: 'Hola' }, words });
  assert.deepEqual(backgroundCall(orb, 'reply'), { method: 'chat.send', params: {}, text: 'text' });
  const approval = buildNote({ chat, line: { id: 3, role: 'system', body: '¿Puedo?', meta: { kind: 'approval', session: 's1', request: 'r1' } }, words });
  assert.deepEqual(backgroundCall(approval, 'allow'), { method: 'sessions.approve', params: { id: 's1', request: 'r1', decision: 'allow' } });
  assert.deepEqual(backgroundCall(approval, 'deny'), { method: 'sessions.approve', params: { id: 's1', request: 'r1', decision: 'deny' } });
  // Text hidden on the lock screen: «Aprobar» opens the app (it asks there).
  const hidden = buildNote({ chat, line: { id: 4, role: 'system', body: '¿Puedo?', meta: { kind: 'approval', session: 's1', request: 'r1' } }, preview: 'none', words });
  assert.equal(backgroundCall(hidden, 'allow'), null);
  // A task is approved in the app (its exact version, with its confirmation).
  const task = buildNote({ chat, line: { id: 5, role: 'system', body: 'Tarea', meta: { kind: 'attention', task: 9 } }, words });
  assert.equal(backgroundCall(task, 'allow'), null);
  assert.equal(backgroundCall(msg, 'allow'), null, 'a button the notification does not have');
  assert.equal(backgroundCall(null, 'reply'), null);
});

test('el cifrado de los botones (Rust, phone_crypto.rs) es el de la página (mobile-crypto.mjs)', () => {
  const rs = read('src-tauri/src/phone_crypto.rs');
  const v = Object.fromEntries([...rs.matchAll(/const ([A-Z_]+): &str = r?#?"(.*?)"#?;/g)].map((m) => [m[1], m[2]]));
  const phone = C.b64.dec(v.PHONE_PRIV); const pc = C.b64.dec(v.PC_PRIV);
  assert.equal(C.b64.enc(C.publicKeyOf(phone)), v.PHONE_PUB);
  assert.equal(C.b64.enc(C.publicKeyOf(pc)), v.PC_PUB);
  const key = C.sessionKey(phone, C.publicKeyOf(pc));
  assert.equal(C.b64.enc(key), v.SESSION_KEY);
  assert.equal(JSON.stringify(C.open(key, { n: v.JS_BOX_N, c: v.JS_BOX_C }, v.JS_BOX_AAD)), v.JS_BOX_PLAIN);
  assert.equal(v.JS_BOX_AAD, C.AAD.response('dev1'));
  // The receiver seals and opens as web-bridge.js › post does.
  const call = read(`${KT}/PcCall.kt`);
  assert.match(call, /"orb:peticion:\$\{link\.id\}"/);
  assert.match(call, /"orb:respuesta:\$\{link\.id\}"/);
  assert.equal(C.AAD.request('X'), 'orb:peticion:X');
  assert.equal(C.AAD.response('X'), 'orb:respuesta:X');
  assert.match(call, /put\("m", "call"\)/);
  assert.match(call, /setRequestProperty\("X-Orb-Device", device\)/);
  assert.match(call, /msg\.optString\("r"\) != nonce/, 'the answer echoes the request');
  assert.match(rs, /fn Java_dev_orb_app_PhoneCrypto_seal/);
  assert.match(rs, /fn Java_dev_orb_app_PhoneCrypto_open/);
});

test('la firma: solo con la clave de siempre; nunca se crea otra', () => {
  const gradle = read('src-tauri/gen/android/app/build.gradle.kts');
  assert.match(gradle, /System\.getenv\("ORB_KEYSTORE"\)/);
  assert.match(gradle, /applicationId = "dev\.orb\.app"/);
  assert.match(gradle, /minSdk = 24/);
  const script = read('scripts/android-build.mjs');
  assert.doesNotMatch(script, /genkeypair|keytool/, 'no key is ever generated');
  assert.match(script, /orb-release\.jks/);
  assert.match(script, /apksigner/);
  assert.match(script, /--print-certs/);
  // The certificate of every Orb for Android so far (3.5–3.8.0): the APK must carry it.
  assert.match(script, /RELEASE_CERT_SHA256 = '[0-9a-f]{64}'/);
  // versionCode: Tauri's major·1 000 000 + minor·1000 + patch, above Capacitor's 30800 for 3.8.0.
  assert.match(script, /maj \* 1_000_000 \+ min \* 1000 \+ pat/);
});

test('el APK: permisos, compartir, avisos sin abrir la app y sin copias de seguridad', () => {
  const m = read('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
  const perms = [...m.matchAll(/uses-permission android:name="([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(perms, ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS']);
  assert.doesNotMatch(m, /CAMERA|RECORD_AUDIO|leanback/);
  assert.match(m, /<receiver android:name="\.NoteReceiver" android:exported="false" \/>/);
  assert.equal(m.match(/android\.intent\.action\.SEND"/g).length, 2);
  assert.match(m, /android\.intent\.action\.SEND_MULTIPLE/);
  assert.match(m, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(m, /android:launchMode="singleTask"/);
  assert.match(m, /com\.google\.mlkit\.vision\.DEPENDENCIES" android:value="barcode_ui"/);
  const res = path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');
  for (const d of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-xxxhdpi/ic_launcher_foreground.png', 'mipmap-xxxhdpi/ic_launcher_background.png', 'values/themes.xml', 'xml/network_security_config.xml']) assert.ok(fs.existsSync(path.join(res, d)), d);
  assert.match(fs.readFileSync(path.join(res, 'values', 'strings.xml'), 'utf8'), /Compartir con Orb/);
  assert.match(fs.readFileSync(path.join(res, 'xml', 'network_security_config.xml'), 'utf8'), /cleartextTrafficPermitted="true"/);
});

// Review Android A1/A2/M1/M2/M3/B1/B2: what keeps a phone in someone else's hand, another app or a passing error from
// acting for the person.
test('seguridad de los avisos y de la WebView: desbloquear, tokens, enlaces fuera y el Keystore', () => {
  const notes = read(`${KT}/Notes.kt`);
  // A1: the buttons that act ask to unlock (Android 12+), and the receiver refuses with the phone locked (before 12).
  assert.match(notes, /Action\.Builder\(0, label, pending\)\.setAuthenticationRequired\(true\)/);
  assert.match(notes, /isDeviceLocked == true\) \{\s+say\(context, id, title, words\.optString\("locked"/);
  // M1: opening the app from a notification needs a token of a job kept for opening; no action or note in the intent.
  assert.doesNotMatch(notes, /putExtra\(EXTRA_(ACTION|NOTE)/);
  assert.match(notes, /fun fromIntent\(context: Context, intent: Intent\?\): JSONObject\? \{\s+val token = intent\?\.getStringExtra\(EXTRA_TOKEN\) \?: return null/);
  assert.match(notes, /if \(!job\.optBoolean\("open"\)\) return null/);
  // M3: one used → its notification's others go; a day old → refused; cleared with the notifications and on unlinking.
  assert.match(notes, /other\.optInt\("id", -2\) == id\) edit\.remove\(k\)/);
  assert.match(notes, /MAX_AGE_MS = 24L \* 60 \* 60 \* 1000/);
  assert.match(notes, /nm\.cancel\(s\.id\)\n\s+forget\(context\)/);
  assert.match(read(`${KT}/OrbNativePlugin.kt`), /if \(it == "orb\.movil"\) Notes\.forget\(activity\)/);
  // B2: Capacitor's old channel goes.
  assert.match(notes, /deleteNotificationChannel\("default"\)/);
  // A2: only Orb's page in the WebView; links out to the phone's browser, https only.
  assert.match(read('src-tauri/src/mobile.rs'), /\.on_navigation\(\|_webview, url\| own_page\(url\)\)/);
  const kt = read(`${KT}/OrbNativePlugin.kt`);
  assert.match(kt, /fun openUrl\(invoke: Invoke\)[\s\S]+uri\.scheme != "https"[\s\S]+Intent\.ACTION_VIEW/);
  const bridge = read('src/ui/lib/app-bridge.js');
  assert.match(bridge, /orb\.openExternal = async \(url\) => \{ if \(\/\^https:/);
  // B1: only a key that is gone for good removes the link; anything else is «busy» and the page tries again.
  const store = read(`${KT}/SecureStore.kt`);
  assert.match(store, /AEADBadTagException \|\| e is java\.security\.UnrecoverableKeyException \|\| e is android\.security\.keystore\.KeyPermanentlyInvalidatedException/);
  assert.match(store, /throw Busy\(e\)/);
  assert.match(bridge, /if \(!said\(e\)\.includes\('busy'\) \|\| i >= 4\) return null/);
  // M2: updated from 3.8.0 (no choice saved): back on when Android allows them, else offered; never asks by itself.
  assert.match(bridge, /nat\('notify_permission', \{ ask: false \}\)/);
  assert.match(kt, /getBoolean\("ask", true\)\) return invoke\.resolve\(JSObject\(\)\.put\("granted", false\)\)/);
});
