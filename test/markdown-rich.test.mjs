// 3.8.2: formulas ($$) and Mermaid diagrams in the messages, and the PDF viewer of attachments. A single $ is still a
// dollar, other code blocks render as before, Mermaid runs with securityLevel 'strict' and the window's CSP allows no eval.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { ROOT, tempHome } from './helpers.mjs';
import { remarkPlugins, richKind, isInlineMath, textOf } from '../src/ui/lib/markdown-plugins.js';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';

const tree = (md) => { const p = unified().use(remarkParse); for (const x of remarkPlugins) Array.isArray(x) ? p.use(x[0], x[1]) : p.use(x); return p.use(remarkRehype).runSync(p.parse(md)); };
const codes = (node, out = []) => { if (node.tagName === 'code') out.push(node); for (const c of node.children ?? []) codes(c, out); return out; };

test('one $ is a dollar; $$ makes a formula, inline or as a block', () => {
  assert.deepEqual(codes(tree('It costs $5 and $10 per month.')), [], 'amounts stay text');
  const inline = codes(tree('Energy: $$E = mc^2$$ here'));
  assert.equal(inline.length, 1); assert.ok(isInlineMath(inline[0])); assert.equal(textOf(inline[0]), 'E = mc^2');
  const block = codes(tree('$$\n\int_0^1 x\,dx\n$$'));
  assert.equal(richKind(block[0]), 'math'); assert.ok(!isInlineMath(block[0])); assert.equal(textOf(block[0]), '\int_0^1 x\,dx');
});

test('```mermaid is a diagram; any other code block is untouched; GFM still works', () => {
  assert.equal(richKind(codes(tree('```mermaid\ngraph TD; A-->B\n```'))[0]), 'mermaid');
  const js = codes(tree('```js\nconst a = 1;\n```'))[0];
  assert.equal(richKind(js), null); assert.deepEqual(js.properties.className, ['language-js']);
  assert.equal(richKind(codes(tree('use `npm test`'))[0]), null);
  const html = JSON.stringify(tree('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~'));
  assert.match(html, /"tagName":"table"/); assert.match(html, /"tagName":"del"/);
});

test('mermaid strict, libraries loaded lazily, no eval, also in the CSP', () => {
  const rich = fs.readFileSync(path.join(ROOT, 'src/ui/components/rich-blocks.jsx'), 'utf8');
  assert.match(rich, /securityLevel: 'strict'/); assert.match(rich, /trust: false/);
  assert.match(rich, /import\('mermaid'\)/); assert.match(rich, /import\('katex'\)/);
  assert.doesNotMatch(rich, /^import .*(mermaid|katex)/m, 'not in the main bundle');
  const viewer = fs.readFileSync(path.join(ROOT, 'src/ui/components/file-viewer.jsx'), 'utf8');
  assert.match(viewer, /useWasm: false/); assert.match(viewer, /isEvalSupported: false/); assert.doesNotMatch(viewer, /^import .*pdfjs/m);
  const csp = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
  assert.match(csp, /script-src 'self';/); assert.doesNotMatch(csp, /unsafe-eval|wasm-unsafe-eval/);
});

// 3.8.3: the music (src/ui/lib/music.js) and the audio/video viewer play from blob: URLs. Without media-src the CSP fell
// back to default-src 'self', play() failed and the music never sounded. Only blob: is added, in both CSPs, nothing else.
test('media plays from blob: URLs only, in the app CSP and the page meta', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
  const meta = /Content-Security-Policy" content="([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'src/ui/index.html'), 'utf8'))[1];
  for (const csp of [app, meta]) {
    const media = csp.split(';').map((d) => d.trim()).filter((d) => d.startsWith('media-src'));
    assert.deepEqual(media, ['media-src blob:'], csp);
    assert.match(csp, /default-src 'self';/);
  }
  const music = fs.readFileSync(path.join(ROOT, 'src/ui/lib/music.js'), 'utf8');
  assert.match(music, /URL\.createObjectURL/, 'the music is a blob: URL');
});

let t; let board; let api; let sessions;
before(() => { t = tempHome(); board = new Board(); sessions = new Sessions(board, { emit: () => {} }); api = buildApi({ board, sessions, orchestrator: null, scheduler: null, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } }); });
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('attachments.read: a PDF of that conversation\'s attachments only, and only from this PC', async () => {
  const s = await api.call('sessions.create', { agent: 'claude', permission: 'leer', title: 'PDF' }, DESKTOP);
  const dir = path.join(s.cwd, '.orb-adjuntos'); fs.mkdirSync(dir, { recursive: true });
  const pdf = path.join(dir, 'spec.pdf'); fs.writeFileSync(pdf, '%PDF-1.4 test');
  const r = await api.call('attachments.read', { session: s.id, path: pdf }, DESKTOP);
  assert.equal(Buffer.from(r.base64, 'base64').toString(), '%PDF-1.4 test');
  const txt = path.join(dir, 'notes.txt'); fs.writeFileSync(txt, 'x');
  await assert.rejects(api.call('attachments.read', { session: s.id, path: txt }, DESKTOP), 'not a PDF');
  const outside = path.join(s.cwd, 'other.pdf'); fs.writeFileSync(outside, '%PDF');
  await assert.rejects(api.call('attachments.read', { session: s.id, path: outside }, DESKTOP), 'outside the attachments folder');
  await assert.rejects(api.call('attachments.read', { session: s.id, path: path.join(dir, '..', '..', 'x.pdf') }, DESKTOP));
  // 3.8.2 (security review): an attachments folder that is a junction to another folder reads nothing there.
  const elsewhere = path.join(t.home, 'otra'); fs.mkdirSync(elsewhere, { recursive: true });
  fs.writeFileSync(path.join(elsewhere, 'key.pdf'), '%PDF-1.4 other');
  const aside = `${dir}-aparte`; fs.renameSync(dir, aside);
  fs.symlinkSync(elsewhere, dir, 'junction');
  try { await assert.rejects(api.call('attachments.read', { session: s.id, path: path.join(dir, 'key.pdf') }, DESKTOP), /./, 'not through a junction'); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(aside, dir); }
  assert.ok(fs.existsSync(path.join(elsewhere, 'key.pdf')));
  // 3.8.3: audio and video the window can play, with their type; other media stay a name.
  const clip = path.join(dir, 'demo.mp4'); fs.writeFileSync(clip, 'mp4');
  const v = await api.call('attachments.read', { session: s.id, path: clip }, DESKTOP);
  assert.deepEqual([v.kind, v.mime, Buffer.from(v.base64, 'base64').toString()], ['video', 'video/mp4', 'mp4']);
  const song = path.join(dir, 'voz.ogg'); fs.writeFileSync(song, 'ogg');
  assert.deepEqual(await api.call('attachments.read', { session: s.id, path: song }, DESKTOP).then((r) => [r.kind, r.mime]), ['audio', 'audio/ogg']);
  const avi = path.join(dir, 'old.avi'); fs.writeFileSync(avi, 'avi');
  await assert.rejects(api.call('attachments.read', { session: s.id, path: avi }, DESKTOP), /./, 'not playable in the window');
  const big = path.join(dir, 'big.webm'); fs.writeFileSync(big, ''); fs.truncateSync(big, 25 * 1024 * 1024 + 1);
  await assert.rejects(api.call('attachments.read', { session: s.id, path: big }, DESKTOP), /./, 'over 25 MB');
  const { METHODS } = await import('../src/domain/security/permissions.mjs');
  assert.equal(METHODS['attachments.read'], 'pc', 'never from a linked phone');
});
