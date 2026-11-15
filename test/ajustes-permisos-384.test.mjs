// Ajustes: the «Permisos» section and the chat trash card (static checks on the sources).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const index = read('src/ui/views/settings/index.jsx');
const general = read('src/ui/views/settings/general.jsx');
const ids = [...index.slice(index.indexOf('const SECTIONS')).matchAll(/\{ id: '(\w+)', icon:/g)].map((m) => m[1]);

test('settings has eight sections in order', () => {
  assert.deepEqual(ids, ['general', 'magiclink', 'agentes', 'permisos', 'extensiones', 'datos', 'avanzado', 'acerca']);
});

test('permisos holds the three permission cards and the others no longer do', () => {
  const line = (id) => index.split('\n').find((l) => l.includes(`id: '${id}'`));
  for (const card of ['PermissionsCard', 'ProtectedCard', 'ApprovalWaitCard']) assert.match(line('permisos'), new RegExp(card));
  assert.doesNotMatch(line('agentes'), /PermissionsCard/);
  assert.doesNotMatch(index.slice(index.indexOf("id: 'avanzado'")), /ProtectedCard/);
});

test('permission test ids stay and approval-wait appears once', () => {
  for (const id of ['settings-autonomy', 'protected-card', 'protected-input', 'protected-item']) assert.ok(general.includes(id), id);
  assert.equal(general.split('data-testid="approval-wait"').length - 1, 1);
  assert.doesNotMatch(general, /v\.approvalWait/);
});

test('new i18n keys exist in es and en', () => {
  const keys = ['settings.section.permisos', 'settings.sectionDesc.permisos', 'settings.approvalWaitTitle', 'trash.title', 'trash.desc', 'trash.empty', 'trash.restore'];
  for (const lang of ['es', 'en']) {
    const text = ['ola1', 'settings', 'ws6'].map((f) => read(`src/shared/locales/${lang}/${f}.mjs`)).join('\n');
    for (const k of keys) assert.ok(text.includes(`'${k}'`), `${lang}:${k}`);
  }
});

test('trash card degrades and keeps its test ids', () => {
  const src = read('src/ui/views/settings/trash.jsx');
  for (const id of ['trash-card', 'trash-restore', 'trash-empty']) assert.ok(src.includes(id), id);
  assert.match(src, /trash\.list/);
  assert.match(read('src/ui/views/data.jsx'), /<TrashCard \/>/);
});
