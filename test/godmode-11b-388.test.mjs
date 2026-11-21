// 3.8.8 paso 11b (tanda 10), interfaz del God mode: «Nuevo archivo», el ⋯ del archivo y la barra de estado con la
// codificación y las líneas reales (se lee el código como texto).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const view = read('src/ui/views/expert.jsx');
const perms = read('src/domain/security/permissions.mjs');

test('«Nuevo archivo»: botón del explorador que abre un diálogo pequeño y crea con expert.createFile', () => {
  assert.match(view, /data-testid="expert-new-file"/);
  assert.match(view, /await form\(t\('expert\.newFileTitle'\)/);
  assert.match(view, /call\('expert\.createFile', \{ project, dir: pickedDir \|\| undefined, name: v\.name\.trim\(\) \}\)/);
  assert.match(view, /data-testid="expert-new-file-name"/);
  assert.match(view, /onPick=\{setPickedDir\}/);
  assert.doesNotMatch(view, /expert\.(delete|rename|remove)/); // only creating: the mock-up draws nothing else
  assert.match(perms, /'expert\.createFile': 'pc'/);
});

test('el ⋯ del archivo copia la ruta y la barra de estado pinta codificación y líneas del motor', () => {
  assert.match(view, /data-testid="expert-file-more"/);
  assert.match(view, /data-testid="expert-copy-path"/);
  assert.match(view, /data-testid=\{p === encoding \? 'expert-encoding' : undefined\}/);
  assert.match(view, /encoding: r\.encoding \?\? null, bom: Boolean\(r\.bom\), lines: r\.lines \?\? null/);
});

test('los textos nuevos están en español e inglés', () => {
  for (const k of ['expert.newFile', 'expert.newFileTitle', 'expert.newFileDesc', 'expert.newFileRoot', 'expert.fileName', 'expert.create', 'expert.fileCreated', 'expert.fileMore', 'expert.copyPath', 'expert.pathCopied', 'expert.encoding.utf8', 'expert.encoding.utf8bom', 'expert.encoding.unknown', 'expert.nLines',
    'msg.expert.badName', 'msg.expert.protectedPath', 'msg.expert.secretName', 'msg.expert.exists', 'msg.expert.cannotCreate', 'msg.expert.createBusy', 'msg.expert.createCore']) {
    for (const l of [es, en]) assert.ok(l[k], k);
  }
});
