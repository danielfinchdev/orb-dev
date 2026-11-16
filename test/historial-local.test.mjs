// 3.8.7 (paso 12): old Claude Code and Codex chats (read only) and the usage by model, project and hour, from the session
// files that those agents keep on this PC. Every file here is a synthetic fixture in a temp folder; the real home is never read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './helpers.mjs';
import { listChats, readChat, usageOf, listFiles, readJsonl, parseLine, rootsOf, LIMITS } from '../src/engine/history/local-history.mjs';
import { METHODS } from '../src/domain/security/permissions.mjs';

let home; let outside;
const jl = (...rows) => `${rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;
const hash = (dir) => { const out = {}; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out[f] = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } }; walk(dir); return out; };
const NOW = Date.parse('2026-11-16T12:00:00Z');
const ts = (h, day = '2026-11-15') => `${day}T${String(h).padStart(2, '0')}:30:00Z`;

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-hist-home-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-hist-out-'));
  const claude = path.join(home, '.claude', 'projects', 'C--fake-proyecto-uno');
  const codex = path.join(home, '.codex', 'sessions', '2026', '11', '15');
  fs.mkdirSync(claude, { recursive: true }); fs.mkdirSync(codex, { recursive: true });
  fs.writeFileSync(path.join(claude, 'a.jsonl'), jl(
    { type: 'summary', summary: 'unknown record' },
    { type: 'user', cwd: 'C:\\fake\\proyecto-uno', sessionId: 's1', timestamp: ts(9), message: { role: 'user', content: 'Arregla el login, mi clave es sk-ant-abcdefghijklmnop12345678' } },
    { type: 'user', timestamp: ts(9), isMeta: true, message: { role: 'user', content: 'meta that must not show' } },
    { type: 'assistant', uuid: 'u1', timestamp: ts(9), message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Hecho.' }, { type: 'tool_use', name: 'Edit', input: {} }], usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 9999, output_tokens: 20 } } },
    // the same message again (Claude repeats it for each block): counted once
    { type: 'assistant', uuid: 'u2', timestamp: ts(9), message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Bash', input: {} }], usage: { input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 20 } } },
    'this line is not json',
    { type: 'user', timestamp: ts(14), message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } },
    { type: 'assistant', uuid: 'u3', timestamp: ts(14), message: { id: 'm2', role: 'assistant', model: 'claude-sonnet-5-5', content: 'Segundo', usage: { input_tokens: 10, output_tokens: 5 } } }
  ));
  fs.writeFileSync(path.join(codex, 'rollout-1.jsonl'), jl(
    { timestamp: ts(20), type: 'session_meta', payload: { id: 'c1', cwd: 'C:\\fake\\proyecto-dos' } },
    { timestamp: ts(20), type: 'turn_context', payload: { model: 'gpt-6' } },
    { timestamp: ts(20), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { timestamp: ts(20), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Añade tests' }] } },
    { timestamp: ts(20), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Listo' }] } },
    { timestamp: ts(20), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500 }, last_token_usage: { input_tokens: 500, cached_input_tokens: 200, output_tokens: 40 } } } },
    // the same total repeated: not a new turn
    { timestamp: ts(20), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500 }, last_token_usage: { input_tokens: 500, cached_input_tokens: 200, output_tokens: 40 } } } },
    { timestamp: ts(21), type: 'event_msg', payload: { type: 'token_count', info: null } }
  ));
  // a file with only metadata is not a chat; an unknown format gives nothing and breaks nothing
  fs.writeFileSync(path.join(codex, 'rollout-meta.jsonl'), jl({ type: 'session_meta', payload: { id: 'm' } }));
  fs.writeFileSync(path.join(codex, 'weird.jsonl'), jl({ foo: 1 }, [1, 2], 'null', '"text"'));
  fs.writeFileSync(path.join(codex, 'notes.txt'), 'not a jsonl');
});
after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });

test('listChats: chats of both agents, with title, project and model; secrets are not shown; nothing else counts', async () => {
  const rows = await listChats({ home });
  assert.equal(rows.length, 2);
  const c = rows.find((r) => r.agent === 'claude'); const x = rows.find((r) => r.agent === 'codex');
  assert.equal(c.project, 'proyecto-uno');
  assert.match(c.title, /^Arregla el login/);
  assert.ok(!/sk-ant-/.test(c.title));
  assert.equal(c.model, 'claude-sonnet-5-5'); // the last one used
  assert.equal(x.project, 'proyecto-dos');
  assert.equal(x.title, 'Añade tests'); // the environment block is not what the person wrote
  assert.match(c.id, /^claude:[0-9a-f]{20}$/);
  assert.equal((await listChats({ home, agent: 'codex' })).length, 1);
  assert.equal((await listChats({ home, q: 'login' })).length, 1);
});

test('readChat: the messages in order, tool uses as a short mark, redacted, read only; an unknown id is null', async () => {
  const [c] = await listChats({ home, agent: 'claude' });
  const chat = await readChat(c.id, { home });
  assert.equal(chat.readOnly, true);
  assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant', 'assistant', 'assistant']);
  assert.ok(!JSON.stringify(chat).includes('sk-ant-'));
  assert.ok(!JSON.stringify(chat).includes('meta that must not show'));
  assert.ok(chat.messages.some((m) => m.tool && /Bash/.test(m.text)));
  assert.equal(await readChat('claude:' + '0'.repeat(20), { home }), null);
  assert.equal(await readChat('../../etc/passwd', { home }), null);
  assert.equal(await readChat({ toString: () => 'x' }, { home }), null);
});

test('reading never changes the files (same bytes before and after)', async () => {
  const before1 = hash(home);
  await listChats({ home }); await usageOf({ home, now: NOW }); for (const r of await listChats({ home })) await readChat(r.id, { home });
  assert.deepEqual(hash(home), before1);
});

test('usageOf: by model and project, each Claude message once, Codex cached input removed, heat by hour', async () => {
  const u = await usageOf({ home, days: 7, tz: 'UTC', now: NOW });
  assert.equal(u.total.turns, 3); // m1 once, m2, one Codex turn
  const opus = u.models.find((m) => m.model === 'claude-opus-5-5');
  assert.deepEqual([opus.turns, opus.tokensIn, opus.tokensOut], [1, 150, 20]); // cache reads are not counted as input
  const gpt = u.models.find((m) => m.model === 'gpt-6');
  assert.deepEqual([gpt.agent, gpt.tokensIn, gpt.tokensOut], ['codex', 300, 40]);
  assert.deepEqual(u.projects.map((p) => p.project).sort(), ['proyecto-dos', 'proyecto-uno']);
  assert.equal(u.projects.find((p) => p.project === 'proyecto-uno').turns, 2);
  const sunday = 6; // 2026-11-15 is a Sunday; the week starts on Monday
  assert.equal(u.heat[sunday][9], 1); assert.equal(u.heat[sunday][14], 1); assert.equal(u.heat[sunday][20], 1);
  assert.equal(u.heat.flat().reduce((a, b) => a + b, 0), 3);
  // the zone moves the hour
  const madrid = await usageOf({ home, days: 7, tz: 'Asia/Tokyo', now: NOW });
  assert.equal(madrid.heat[sunday][18], 1); // 09:30 UTC = 18:30 in Tokyo
});

test('usageOf: events older than the range are left out', async () => {
  const u = await usageOf({ home, days: 7, tz: 'UTC', now: Date.parse('2026-12-30T00:00:00Z') });
  assert.equal(u.total.turns, 0);
});

test('symbolic links are not followed: a link to a folder or a file outside is skipped', async (t) => {
  const root = path.join(home, '.claude', 'projects');
  fs.writeFileSync(path.join(outside, 'secret.jsonl'), jl({ type: 'user', cwd: '/x', timestamp: ts(1), message: { role: 'user', content: 'FUERA DE LA CARPETA' } }));
  const dirLink = path.join(root, 'link-dir'); const fileLink = path.join(root, 'C--fake-proyecto-uno', 'link-file.jsonl');
  try { fs.symlinkSync(outside, dirLink, 'junction'); fs.symlinkSync(path.join(outside, 'secret.jsonl'), fileLink, 'file'); } catch { t.skip('this system does not allow links'); return; }
  try {
    const files = await listFiles(root);
    assert.ok(files.every((f) => !f.file.includes('link-')), 'links are skipped');
    assert.ok(!JSON.stringify(await listChats({ home })).includes('FUERA'));
    assert.ok(!JSON.stringify(await usageOf({ home, now: NOW })).includes('FUERA'));
  } finally { fs.rmSync(dirLink, { force: true }); fs.rmSync(fileLink, { force: true }); }
});

test('big files and lines are capped: a line over the limit is dropped, bytes beyond the cap are not read', async () => {
  const f = path.join(outside, 'big.jsonl');
  const ok = { type: 'user', timestamp: ts(3), message: { role: 'user', content: 'ok' } };
  fs.writeFileSync(f, `${JSON.stringify(ok)}\n${'x'.repeat(LIMITS.lineBytes + 10)}\n${JSON.stringify(ok)}\n${JSON.stringify(ok)}`);
  let n = 0;
  const r = await readJsonl(f, 1 << 30, () => { n += 1; });
  assert.equal(n, 3); assert.equal(r.truncated, false); // the long line was skipped, the last line without newline counted
  n = 0;
  const cut = await readJsonl(f, 200, () => { n += 1; });
  assert.equal(n, 1); assert.equal(cut.truncated, true);
});

test('parseLine tolerates formats it does not know', () => {
  for (const agent of ['claude', 'codex']) {
    for (const o of [{}, { type: 'user' }, { type: 'user', message: 5 }, { type: 'assistant', message: { content: 7, usage: 'x' } }, { type: 'response_item', payload: 3 }, { type: 'event_msg', payload: { type: 'token_count', info: 'x' } }, { timestamp: 'nope', message: null }]) {
      assert.doesNotThrow(() => parseLine(agent, o, { seen: new Set() }));
    }
  }
});

test('the methods are for this PC only, and the engine API answers them for the given home', async () => {
  for (const m of ['history.list', 'history.read', 'history.usage']) assert.equal(METHODS[m], 'pc');
  const { tempHome } = await import('./helpers.mjs');
  const t = tempHome();
  try {
    const { historyMethods } = await import('../src/engine/api/history.mjs');
    const api = historyMethods({ home });
    assert.equal((await api['history.list']({})).length, 2);
    assert.equal((await api['history.usage']({ days: 90 })).files >= 0, true);
    await assert.rejects(() => api['history.usage']({ days: 5 }));
    await assert.rejects(() => api['history.list']({ agent: 'cursor' }));
    assert.deepEqual(rootsOf(home), { claude: path.join(home, '.claude', 'projects'), codex: path.join(home, '.codex', 'sessions') });
  } finally { t.cleanup(); }
});

test('the usage page has the heat map and the history view is reached from the palette, with texts in both languages', () => {
  const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  assert.match(read('src', 'ui', 'views', 'usage.jsx'), /history\.usage/);
  assert.match(read('src', 'ui', 'views', 'usage.jsx'), /data-testid="usage-heat"/);
  assert.match(read('src', 'ui', 'components', 'command-palette.jsx'), /view: 'history'/);
  assert.match(read('src', 'ui', 'main.jsx'), /history: HistoryView/);
  for (const lang of ['es', 'en']) {
    const s = read('src', 'shared', 'locales', lang, 'session.mjs');
    for (const k of ['usage.heat', 'usage.byProject', 'history.title', 'history.readOnly', 'usage.days6']) assert.ok(s.includes(`'${k}'`), `${lang} ${k}`);
  }
});

test('a hard link to a file outside, and a root that is a link, are not read; the newest files survive the cap', async (t) => {
  const root = path.join(home, '.claude', 'projects'); const hl = path.join(root, 'C--fake-proyecto-uno', 'hard.jsonl');
  fs.writeFileSync(path.join(outside, 'h.jsonl'), jl({ type: 'user', cwd: '/x', timestamp: ts(1), message: { role: 'user', content: 'HARDLINK' } }));
  try { fs.linkSync(path.join(outside, 'h.jsonl'), hl); } catch { t.skip('no hard links'); return; }
  try { assert.ok(!JSON.stringify(await listChats({ home })).includes('HARDLINK')); } finally { fs.rmSync(hl, { force: true }); }
  const capped = await listFiles(path.join(home, '.codex', 'sessions'), { limit: 1 });
  assert.equal(capped.length, 1); assert.equal(capped.capped, true);
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-hist-root-'));
  try { fs.symlinkSync(root, path.join(fake, 'p'), 'junction'); assert.equal((await listFiles(path.join(fake, 'p'))).length, 0); } catch { /* links not allowed */ } finally { fs.rmSync(fake, { recursive: true, force: true }); }
});
