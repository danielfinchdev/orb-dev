// 3.8.2, phase 4: «Adjuntar» takes any file (types, limits, where the copy goes, what each agent gets: pictures natively,
// a video's frames with ffmpeg mocked, a document's text), the microphone per platform (D3) and «Recargar» in the usage
// panel. Screens are read as source, like retoques-382.test.mjs; the engine's helpers are run.
import { tempHome, ROOT } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ctx } from '../src/core/context.mjs';
import { isOrbData } from '../src/core/guard.mjs';
import { kindOf, placeAttachments, prepareAttachments, extractText, zipEntries, probeInfo, evenTimes, extractFrames, ATTACH_DIR, ATTACH_MAX, FFMPEG } from '../src/engine/attachments.mjs';
import { micMode } from '../src/ui/lib/mic.js';
import { reloadWait, markReloaded, RELOAD_GAP_MS } from '../src/ui/lib/usage-reload.js';
import { Sessions } from '../src/engine/sessions.mjs';

const ui = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
const src = (...p) => fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

// A zip as office programs write them (deflated entries), for the docx test.
function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text); const data = zlib.deflateRawSync(raw); const n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(zlib.crc32(raw), 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(zlib.crc32(raw), 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
// A one-page PDF whose text is in a compressed content stream.
function pdf(text) {
  const content = zlib.deflateSync(Buffer.from(`BT /F1 12 Tf 72 712 Td (${text}) Tj ET`));
  return Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n4 0 obj\n<< /Length ' + content.length + ' /Filter /FlateDecode >>\nstream\n'), content, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')]);
}

test('what an attachment is, by its extension', () => {
  const cases = { 'foto.PNG': 'image', 'clip.mp4': 'video', 'nota.m4a': 'audio', 'informe.pdf': 'pdf', 'acta.docx': 'document', 'datos.xlsx': 'document',
    'app.zip': 'archive', 'main.rs': 'text', 'README.md': 'text', 'C:\\x\\Dockerfile': 'text', 'firmware.bin': 'other', 'sin-extension': 'other' };
  for (const [file, kind] of Object.entries(cases)) assert.equal(kindOf(file), kind, file);
});

test('attachments are copied into the chat folder (never into Orb data), with limits and clear errors', (t) => {
  const { home, base, cleanup } = tempHome(); t.after(cleanup);
  const project = path.join(home, 'web'); fs.mkdirSync(project, { recursive: true });
  const outside = path.join(base, 'fuera'); fs.mkdirSync(outside);
  const files = ['plano.png', 'informe.pdf', 'demo.mp4', 'datos.bin', 'mi archivo (1).txt'].map((n) => { const f = path.join(outside, n); fs.writeFileSync(f, n); return f; });
  const placed = placeAttachments(files, project, { now: 1234 });
  assert.equal(placed.length, 5);
  for (const a of placed) {
    assert.equal(path.dirname(a.path), path.join(project, ATTACH_DIR, '1234'));
    assert.ok(fs.existsSync(a.path));
    assert.equal(isOrbData(a.path, ctx.paths.internal, null), false, 'agents of the chat may read and write it');
  }
  assert.deepEqual(placed.map((a) => a.kind), ['image', 'pdf', 'video', 'other', 'text']);
  assert.equal(placed[4].name, 'mi_archivo_1_.txt');
  // Over the limit (a sparse file: nothing is written), a folder, a missing file.
  const big = path.join(outside, 'enorme.mov'); fs.writeFileSync(big, ''); fs.truncateSync(big, ATTACH_MAX + 1);
  assert.throws(() => placeAttachments([big], project), /enorme\.mov supera el límite de 100 MB/);
  assert.throws(() => placeAttachments([outside], project), /no es un archivo/);
  assert.throws(() => placeAttachments([path.join(outside, 'no-existe.pdf')], project), /no existe el adjunto/);
  // Orb's own files never go out as attachments, and nothing is stored in core\datos.
  assert.throws(() => placeAttachments([ctx.paths.config], project), /archivo interno de Orb/);
  assert.throws(() => placeAttachments([files[0]], ctx.paths.data), /no tiene una carpeta para guardar adjuntos/);
  assert.equal(fs.existsSync(path.join(ctx.paths.data, ATTACH_DIR)), false);
  // At most 10 files per message.
  assert.equal(placeAttachments(Array(12).fill(files[0]), project, { now: 99 }).length, 10);
});

test('PDF and office documents give their text; the original path always goes too', async (t) => {
  const { home, cleanup } = tempHome(); t.after(cleanup);
  const dir = path.join(home, 'docs'); fs.mkdirSync(dir);
  const p = path.join(dir, 'informe.pdf'); fs.writeFileSync(p, pdf('Presupuesto del proyecto Orb para el segundo trimestre'));
  assert.match(extractText(p), /Presupuesto del proyecto Orb para el segundo trimestre/);
  const d = path.join(dir, 'acta.docx');
  fs.writeFileSync(d, zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Acta de la reunión &amp; acuerdos</w:t></w:r></w:p><w:p><w:r><w:t>Segundo punto del orden del día</w:t></w:r></w:p></w:body></w:document>' }));
  assert.equal(zipEntries(fs.readFileSync(d)).size, 1);
  assert.equal(extractText(d), 'Acta de la reunión & acuerdos\nSegundo punto del orden del día');
  // Unreadable (codes of a font, not text): no text rather than garbage.
  const junk = path.join(dir, 'raro.pdf'); fs.writeFileSync(junk, pdf('\\001\\002\\003\\004\\005\\006\\007\\010\\011\\012\\013\\014\\015\\016\\017\\020\\021\\022\\023\\024\\025'));
  assert.equal(extractText(junk), '');

  const placed = placeAttachments([p, d, junk], dir);
  const out = await prepareAttachments(placed, { nativeImages: true });
  assert.deepEqual(out.images, []);
  assert.match(out.text, /^Adjuntos \(copias en tu carpeta/);
  for (const a of placed) assert.ok(out.text.includes(a.path), a.name);
  assert.match(out.text, /Texto extraído \(\d+ caracteres\): .*informe\.pdf\.txt/);
  assert.ok(fs.readFileSync(`${placed[0].path}.txt`, 'utf8').includes('segundo trimestre'));
  assert.match(out.text, /raro\.pdf .*\n {2}No se pudo extraer el texto/);
});

test('a video becomes evenly spaced frames plus scene changes (ffmpeg mocked); no local transcription is said', async (t) => {
  const { home, cleanup } = tempHome(); t.after(cleanup);
  const dir = path.join(home, 'web'); fs.mkdirSync(dir, { recursive: true });
  const video = path.join(dir, 'demo.mp4'); fs.writeFileSync(video, 'v');
  const calls = [];
  const runImpl = async (cmd, args) => {
    calls.push(args);
    if (args.length === 3) return { code: 1, err: 'Duration: 00:01:00.00, start: 0\n  Stream #0:0(und): Video: h264\n  Stream #0:1(und): Audio: aac' };
    const out = args.at(-1).replace('%02d', '01');
    fs.writeFileSync(out, 'jpg');
    return { code: 0, err: '' };
  };
  assert.deepEqual(probeInfo('Duration: 00:00:10.50, x\n Stream #0:0: Video: vp9'), { duration: 10.5, audio: false, video: true });
  assert.deepEqual(evenTimes(60), [5, 15, 25, 35, 45, 55]);
  const placed = placeAttachments([video, video], dir);
  const v = await extractFrames(placed[0].path, 'ffmpeg', { runImpl });
  assert.equal(v.frames.length, 7, 'six evenly spaced and one scene change');
  assert.equal(v.dir, `${placed[0].path}-fotogramas`);
  assert.ok(calls.some((a) => a.join(' ').includes("select='gt(scene,0.4)'")));
  assert.ok(calls.every((a) => !a.includes('-f') || a[a.indexOf('-f') + 1] !== 'lavfi'), 'only the file itself is read');

  // Claude or Codex: the frames go with the message; any agent: the folder and the missing transcript are named.
  const native = await prepareAttachments(placed.slice(0, 1), { nativeImages: true, deps: { ffmpeg: 'ffmpeg', whisper: null, runImpl } });
  assert.equal(native.images.length, 7);
  assert.match(native.text, /Duración: 1:00\.\n {2}7 fotogramas van con este mensaje/);
  assert.match(native.text, /Sin transcripción del audio: este PC no tiene un programa local de voz a texto/);
  const plain = await prepareAttachments(placed.slice(1), { nativeImages: false, deps: { ffmpeg: 'ffmpeg', whisper: null, runImpl } });
  assert.deepEqual(plain.images, []);
  assert.match(plain.text, /Fotogramas \(7\): .*demo-2\.mp4-fotogramas/);
  // No ffmpeg: said, nothing breaks.
  const none = await prepareAttachments(placed.slice(1), { deps: { ffmpeg: null, whisper: null } });
  assert.match(none.text, /Este PC no tiene ffmpeg/);
  // The download, when Orb needs one, is pinned (size and hashes of the archive and of ffmpeg.exe).
  assert.match(FFMPEG.win32.url, /^https:\/\/github\.com\/GyanD\/codexffmpeg\/releases\/download\/7\.1\.1\//);
  assert.ok(FFMPEG.win32.size > 0 && /^[0-9a-f]{64}$/.test(FFMPEG.win32.sha256) && /^[0-9a-f]{64}$/.test(FFMPEG.win32.exeSha256));
});

test('pictures go natively to agents that read them, by path to the others; the rest by path and metadata', async (t) => {
  const { home, cleanup } = tempHome(); t.after(cleanup);
  const dir = path.join(home, 'web'); fs.mkdirSync(dir, { recursive: true });
  const files = ['a.png', 'b.svg', 'c.zip', 'd.bin', 'e.ts'].map((n) => { const f = path.join(dir, n); fs.writeFileSync(f, 'x'); return f; });
  const placed = placeAttachments(files, dir);
  const yes = await prepareAttachments(placed, { nativeImages: true });
  assert.deepEqual(yes.images, [placed[0].path], 'an SVG is not sent as a picture');
  const no = await prepareAttachments(placed, { nativeImages: false });
  assert.deepEqual(no.images, []);
  assert.match(no.text, /a\.png \(imagen, 1 KB\): .*\n {2}Ábrela para verla\./);
  assert.match(no.text, /c\.zip \(archivo comprimido, 1 KB\)/);
  assert.match(no.text, /d\.bin \(archivo, 1 KB\): .*\n {2}Orb no lo convierte/);
  assert.match(no.text, /e\.ts \(texto, 1 KB\)/);
});

test('the turn waits for the attachments, and Orb\'s ffmpeg is read-only for agents', (t) => {
  const { cleanup } = tempHome(); t.after(cleanup);
  const sessions = src('engine', 'sessions.mjs');
  assert.match(sessions, /prepareAttachments\(attached, \{ nativeImages/);
  assert.match(sessions, /entry\.live\.send\(\{ text: p\.text \? `\$\{body\}\\n\\n\$\{p\.text\}` : body, images: p\.images \}\)/);
  assert.doesNotMatch(sessions, /Imágenes de referencia/);
  const ff = path.join(ctx.paths.tools, 'ffmpeg', 'ffmpeg.exe');
  assert.equal(isOrbData(ff, ctx.paths.internal, null), true, 'no agent writes there');
  assert.equal(isOrbData(ff, ctx.paths.internal, null, { read: true }), false, 'a reading tool may look');
  assert.equal(isOrbData(path.join(ctx.paths.tools, 'otra'), ctx.paths.internal, null), false, 'the rest of herramientas stays open');
});

test('«Adjuntar» in the composer: any file, drop and paste too', () => {
  const session = ui('views', 'session.jsx');
  assert.match(session, /<Tip label=\{t\('session\.attach'\)\}><Button [^>]*onClick=\{async \(\) => addImages\(await bridge\.pickAttachments\(\)\)\} data-testid="attach"/);
  assert.match(session, /filter\(\(f\) => !bridge\.mobile \|\| \/\^image\\\/\/\.test\(f\.type\)\)/);
  assert.match(session, /onPaste=\{\(e\) => \{ fromTransfer\(e\.clipboardData\)/);
  assert.match(session, /onDrop=\{\(e\) => \{ fromTransfer\(e\.dataTransfer\)/);
  assert.match(ui('lib', 'tauri-bridge.js'), /pickAttachments: \(\) => invoke\('app_pick_attachments'\)/);
  const rust = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'desktop.rs'), 'utf8');
  assert.match(rust, /pub async fn pick_attachments[\s\S]*?dialog\(window, None, "sys\.dialog\.attach"\)\.blocking_pick_files\(\), 10\)/);
});

test('the microphone per platform (D3): Win+H on Windows, none on a phone', () => {
  assert.equal(micMode({ desktop: true, windowsDictation: true }), 'windows');
  assert.equal(micMode({ desktop: true, windowsDictation: false, webSpeech: true }), null);
  assert.equal(micMode({ androidApp: true, mobile: true, webSpeech: true }), null, 'Android app: the keyboard dictates');
  assert.equal(micMode({ mobile: true, coarse: true, webSpeech: true }), null, 'a phone browser: the keyboard dictates');
  assert.equal(micMode({ mobile: true, coarse: false, webSpeech: true }), 'web', 'a computer browser keeps its speech recognition');
  assert.equal(micMode({ mobile: true, webSpeech: false }), null);
  const chat = ui('views', 'chat.jsx');
  const composer = chat.slice(chat.indexOf('export function Composer'), chat.indexOf('// 2.6: the system'));
  // Between the usage ring (at the end of «bottom») and «enviar», with its label and tooltip.
  const at = (s) => composer.indexOf(s);
  assert.ok(at('{bottom}</div>') < at('data-testid="dictate"') && at('data-testid="dictate"') < at('data-testid="send"'));
  assert.match(composer, /\{mic \? <Tip label=\{t\('chat\.dictate'\)\}><Button [^>]*aria-label=\{t\('chat\.dictate'\)\}/);
  assert.match(composer, /el\.focus\(\);[\s\S]*?await act\(bridge\.dictateWindows\(\)\.catch\(\(\) => \{ throw new Error\(t\('chat\.dictateFailed'\)\); \}\)\)/);
  assert.match(ui('lib', 'tauri-bridge.js'), /dictateWindows: \(\) => invoke\('app_dictate'\)/);
  const rust = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'desktop.rs'), 'utf8');
  assert.match(rust, /let keys = \[key\(VK_LWIN, false\), key\(h, false\), key\(h, true\), key\(VK_LWIN, true\)\];/);
  for (const f of ['build.rs', path.join('capabilities', 'main.json')]) assert.match(fs.readFileSync(path.join(ROOT, 'src-tauri', f), 'utf8'), /app_dictate|allow-app-dictate/, f);
  assert.doesNotMatch(ui('lib', 'app-bridge.js'), /orb\.dictate =/);
});

test('«Recargar» in the usage panel: spinner, 20 s between reloads, the agents asked now', async () => {
  assert.equal(reloadWait(RELOAD_GAP_MS, 0), 0);
  markReloaded(50_000);
  assert.equal(reloadWait(55_000), RELOAD_GAP_MS - 5000);
  assert.equal(reloadWait(50_000 + RELOAD_GAP_MS), 0);
  const session = ui('views', 'session.jsx');
  const panel = session.slice(session.indexOf('function UsagePanel'), session.indexOf('export function ContextMeter'));
  assert.match(panel, /disabled=\{reloading \|\| wait > 0\} aria-label=\{t\('session\.usage\.reload'\)\} aria-busy=\{reloading\} data-testid="usage-reload">\{reloading \? <Spinner/);
  assert.match(panel, /call\('usage\.refresh'\)/);
  const api = src('engine', 'api.mjs');
  assert.match(api, /'usage\.refresh': async \(\) => \{\s*if \(Date\.now\(\) - usageAskedAt >= 20_000\)/);
  assert.match(src('core', 'permissions.mjs'), /'usage\.refresh': 'remote'/);
  // Every open agent process is asked; one without the call (or failing) is skipped.
  const asked = [];
  const lives = new Map([
    ['a', { live: { refreshUsage: async () => { asked.push('a'); return true; } } }],
    ['b', { live: {} }],
    ['c', { live: { refreshUsage: () => { throw new Error('closed'); } } }]
  ]);
  const promises = Sessions.prototype.refreshUsage.call({ lives });
  assert.equal(promises.length, 1);
  await Promise.all(promises);
  assert.deepEqual(asked, ['a']);
});
