// 3.8.8 paso 11b (G3), interfaz del panel Git del God mode (se lee el código como texto).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const view = read('src/ui/views/expert.jsx');
const git = read('src/ui/components/expert-git.jsx');

test('el panel usa las mismas llamadas y flujos que la página del proyecto', () => {
  assert.match(git, /call\('projects\.commit', \{ name: project, message, files: ticked\.map/);
  assert.match(git, /push: false/); // nunca sube sin pasar por pushFlow
  assert.match(git, /pushFlow\(p, \{ branch: r\.branch/);
  assert.match(git, /call\('projects\.commitSuggest', \{ name: project \}\)/);
  assert.match(git, /syncFlow\(p, t, reload\)/);
  assert.match(git, /expert\.switchBranch/); assert.match(git, /expert\.createBranch/); assert.match(git, /expert\.undoCommit/);
  assert.doesNotMatch(git, /--hard|--force|stash/);
});

test('deshacer manda el hash que se leyó y se explica cuando no se puede', () => {
  assert.match(git, /hash: last\.hash/);
  for (const r of ['pushed', 'merge', 'first', 'none']) assert.ok(es[`expert.git.undoWhy.${r}`] && en[`expert.git.undoWhy.${r}`]);
});

test('testids del recorrido y los que ya había', () => {
  for (const id of ['expert-git-save', 'expert-git-message', 'expert-git-suggest', 'expert-git-savemore', 'expert-git-saveandpush', 'expert-git-undo', 'expert-git-pull', 'expert-git-newbranch', 'expert-git-branches', 'expert-git-all', 'expert-branch']) assert.match(git, new RegExp(`data-testid="${id}"`));
  assert.match(git, /data-testid="panel-git"/); assert.match(git, /data-testid="expert-git"/);
});

test('el panel se monta desde expert.jsx y el botón de rama de la barra es el menú de ramas', () => {
  assert.match(view, /<GitPanel project=\{project\}/); assert.match(view, /<BranchMenu project=\{project\}/);
});

test('el fondo del visor de archivos es el del panel (--background), en claro y en oscuro', () => {
  assert.match(view, /\[&_\.code-surface\]:bg-background!/);
});

test('los textos existen en español e inglés', () => {
  const keys = Object.keys(es).filter((k) => k.startsWith('expert.git.'));
  assert.ok(keys.length >= 30);
  for (const k of keys) assert.ok(en[k], k);
});

test('la lista de guardar sale de projects.commitFiles, Guardar espera al mensaje y deshacer avisa del remoto', () => {
  assert.match(git, /call\('projects\.commitFiles', \{ name: project \}\)/);
  assert.doesNotMatch(git, /st\.files \?\? \[\]/);
  assert.match(git, /!busy && !writing/);
  assert.match(git, /ticket\.current \+= 1; setWriting\(false\)/);
  assert.match(git, /expert\.git\.undoNote/);
  assert.match(git, /expert\.git\.savedLess/);
  assert.match(git, /b\.orb/);
  for (const k of ['undoNote', 'savedLess', 'savedFewer', 'orbBranch']) assert.ok(es[`expert.git.${k}`] && en[`expert.git.${k}`], k);
});
