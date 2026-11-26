// Tutoriales: every guide the screen lists has its texts in es and en, the guides name Ajustes sections that exist, and the
// word «worktree» appears once, in parentheses, as the guide of the separate copy opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const es = (await import(new URL('src/shared/locales/es/help.mjs', root))).default;
const en = (await import(new URL('src/shared/locales/en/help.mjs', root))).default;
const all = {
  es: (await import(new URL('src/shared/locales/es.mjs', root))).default,
  en: (await import(new URL('src/shared/locales/en.mjs', root))).default
};
const view = read('src/ui/views/tutorials.jsx');

const guides = [...view.matchAll(/^ {2}(\w+): \{ icon: \w+, lines: (\d+)(, go: [^\n]*?)?(, pc: true)? ?\},?$/gm)]
  .map((m) => ({ id: m[1], lines: Number(m[2]), go: Boolean(m[3]) }));

test('the screen lists the guides, each once, in the three columns', () => {
  assert.ok(guides.length >= 24, `guides found: ${guides.length}`);
  const columns = view.match(/const COLUMNS = \[([\s\S]*?)\n\];/)[1];
  const placed = [...columns.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual([...placed].sort(), guides.map((g) => g.id).sort());
  for (const id of ['tabs', 'copy', 'orchestrator', 'reasoning', 'accounts', 'android', 'phone', 'games', 'dictation', 'reset']) assert.ok(placed.includes(id), id);
});

test('every guide has its title, its lines and its button in es and en, and no line more', () => {
  for (const [lang, dict] of [['es', es], ['en', en]]) {
    for (const g of guides) {
      assert.ok(dict[`help.tut.${g.id}.title`], `${lang} ${g.id} title`);
      for (let n = 1; n <= g.lines; n++) assert.ok(dict[`help.tut.${g.id}.l${n}`], `${lang} ${g.id}.l${n}`);
      assert.equal(dict[`help.tut.${g.id}.l${g.lines + 1}`], undefined, `${lang} ${g.id} has a line the screen does not show`);
      if (g.go) assert.ok(dict[`help.tut.${g.id}.go`], `${lang} ${g.id} go`);
    }
    const keys = Number(view.match(/const KEYS = (\d+)/)[1]);
    const faqs = Number(view.match(/const FAQS = (\d+)/)[1]);
    for (let n = 1; n <= keys; n++) assert.ok(dict[`help.key.${n}.k`] && dict[`help.key.${n}.v`], `${lang} key ${n}`);
    assert.equal(dict[`help.key.${keys + 1}.k`], undefined, `${lang} has a shortcut the screen does not show`);
    for (let n = 1; n <= faqs; n++) assert.ok(dict[`help.faq.${n}.q`] && dict[`help.faq.${n}.a`], `${lang} faq ${n}`);
    assert.equal(dict[`help.faq.${faqs + 1}.q`], undefined, `${lang} has a question the screen does not show`);
  }
});

test('the guides only name Ajustes sections that exist', () => {
  const ids = ['general', 'apariencia', 'agentes', 'permisos', 'magiclink', 'extensiones', 'atajos', 'datos', 'avanzado', 'acerca'];
  for (const [lang, dict, word] of [['es', es, 'Ajustes'], ['en', en, 'Settings']]) {
    const names = ids.map((id) => all[lang][`settings.section.${id}`]);
    assert.ok(names.every(Boolean), `${lang} section names`);
    for (const [k, v] of Object.entries(dict)) {
      if (!/^help\.(tut|faq|tour)\./.test(k)) continue;
      for (const m of String(v).matchAll(new RegExp(`${word} › ([^.,:;«»“”]+)`, 'g'))) {
        const named = m[1].trim();
        assert.ok(names.some((n) => named.startsWith(n)), `${lang} ${k}: ${word} › ${named}`);
      }
    }
  }
});

test('worktree appears once, in parentheses, in the guide of the separate copy', () => {
  for (const [lang, dict] of [['es', es], ['en', en]]) {
    const hits = Object.entries(dict).filter(([k, v]) => /^help\.(tut|faq|tour)\./.test(k) && /worktree/i.test(v));
    assert.deepEqual(hits.map(([k]) => k), ['help.tut.copy.l1'], lang);
    assert.match(hits[0][1], /\(worktree\)/, lang);
  }
});

test('the guides do not use words the style guide retires', () => {
  for (const [lang, dict] of [['es', es], ['en', en]]) {
    for (const [k, v] of Object.entries(dict)) {
      if (!/^help\.(tut|faq|tour)\./.test(k)) continue;
      assert.doesNotMatch(String(v), /Magic Link|Agentes y uso|Agents and usage|\bACP\b|raíl|God mode|Memorias/i, `${lang} ${k}`);
    }
  }
});
