// 3.8.11 closing fixes of the UI: stable log entry keys, the other logs read on demand, tools after an upgrade,
// the usage charts on an older engine and the duplicated help answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEntries } from '../src/ui/lib/logbook.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const entry = (day, topic) => `### 2026-11-${day} 10:00 — Claude — ${topic}\nbody of ${topic}\n\n`;

test('Log entries keep their id from the short reading to the whole one, with a search active', () => {
  const all = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((d) => entry(d, `topic ${d}`));
  const whole = parseEntries(`intro\n\n${all.join('')}`).entries;
  const short = parseEntries(all.slice(6).join('')).entries;
  // the number counts from the oldest one on screen, so it changes between readings; the id does not
  assert.notEqual(short[0].n, whole[6].n);
  assert.deepEqual(short.map((e) => e.id), whole.slice(6).map((e) => e.id));
  assert.equal(new Set(whole.map((e) => e.id)).size, whole.length);
  // the same text twice still gets two ids
  const twice = parseEntries(entry('01', 'same') + entry('01', 'same')).entries;
  assert.notEqual(twice[0].id, twice[1].id);
  const g = read('src/ui/views/logs.jsx');
  assert.match(g, /<Entry key=\{e\.id\}/);
  assert.match(g, /<MarkedBody key=\{`\$\{query\}\|\$\{e\.id\}`\}/);
  assert.doesNotMatch(g, /key=\{e\.n\}/);
});

test('The other logs are read only for «In all» or when asked in «In this log»', () => {
  const g = read('src/ui/views/logs.jsx');
  assert.match(g, /const searching = shown\.length >= 2 && \(scope === 'all' \|\| othersAsked\)/);
  assert.match(g, /setOthersAsked\(true\)/);
  for (const l of [es, en]) assert.ok(l['logbooks.searchOthers']);
});

test('After an install or an update the tools ask for the newer versions again', () => {
  const a = read('src/ui/views/agents.jsx');
  assert.match(a, /state === 'hecho'\)\.map\(\(x\) => x\.id\)/);
  assert.match(a, /call\('installer\.updates', \{ force: true \}\)/);
});

test('Usage on an older engine says so for the charts', () => {
  const u = read('src/ui/views/usage.jsx');
  assert.match(u, /setOldEngine\(isMissingMethod\(e\)\)/);
  assert.match(u, /t\(oldEngine \? 'usage\.engineOld' : 'usage\.unavailable'\)/);
  assert.match(es['usage.engineOld'], /^Actualiza Orb en el PC/);
  assert.match(en['usage.engineOld'], /^Update Orb on the PC/);
});

test('The robot help answer lives once and points to Appearance', () => {
  for (const [name, l, word] of [['es', es, 'Apariencia'], ['en', en, 'Appearance']]) {
    assert.match(l['help.faq.10.a'], new RegExp(word), name);
    assert.equal(fs.readFileSync(new URL(`../src/shared/locales/${name}/ola1.mjs`, import.meta.url), 'utf8').includes('help.faq.10.a'), false);
  }
});
