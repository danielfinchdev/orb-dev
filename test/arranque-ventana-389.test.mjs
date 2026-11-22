// 3.8.9 (points 9 and 23): the window is born hidden and shown by the page once it has a first screen (with a time
// limit so a broken page never leaves Orb invisible), and the main bundle does not carry the English texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { registerLocale, hasLocale, createT, translate } from '../src/shared/i18n-core.mjs';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('la ventana nace oculta y no se enseña al cargar el HTML', () => {
  const w = read('src-tauri/src/window.rs');
  assert.match(w, /\.visible\(false\)/);
  const onLoad = w.slice(w.indexOf('.on_page_load('), w.indexOf('.build()?'));
  assert.doesNotMatch(onLoad, /\.show\(\)/, 'showing on PageLoadEvent::Finished is what left a black empty window');
});

test('la ventana se enseña una sola vez, con tope de seguridad, y nunca si es la de pruebas oculta', () => {
  const w = read('src-tauri/src/window.rs');
  assert.match(w, /pub const REVEAL_LIMIT: Duration = Duration::from_secs\(5\)/);
  const reveal = w.slice(w.indexOf('pub fn reveal'), w.indexOf('const DARK'));
  assert.match(reveal, /!ui\.hidden && !ui\.shown\.swap\(true, Ordering::SeqCst\)/);
  assert.match(w, /sleep\(REVEAL_LIMIT\)[\s\S]*?reveal\(&w\)/);
  assert.match(w, /if !e2e\.hidden \{[\s\S]*?REVEAL_LIMIT/);
});

test('window_ready es un comando solo de la ventana principal, registrado y permitido', () => {
  const lib = read('src-tauri/src/lib.rs');
  assert.match(lib, /fn window_ready\(window: WebviewWindow\) -> Result<\(\), String> \{\s*only_main\(&window\)\?;\s*window::reveal\(&window\);/);
  assert.match(lib, /window_drag,\s*window_ready,/);
  assert.match(read('src-tauri/build.rs'), /"window_ready"/);
  assert.match(read('src-tauri/capabilities/main.json'), /"allow-window-ready"/);
  assert.doesNotMatch(read('src-tauri/capabilities/pip.json'), /window-ready/);
});

test('la página avisa en cuanto sale de «loading» y el puente lo expone', () => {
  assert.match(read('src/ui/lib/tauri-bridge.js'), /windowReady: \(\) => invoke\('window_ready'\)/);
  assert.match(read('src/ui/main.jsx'), /if \(phase !== 'loading'\) bridge\.windowReady\?\.\(\)\?\.catch\(quiet\)/);
});

test('el inglés no va en el bloque principal: la interfaz lo carga bajo demanda', () => {
  const ui = read('src/ui/lib/i18n.js');
  assert.doesNotMatch(ui, /^import .*locales\/en\.mjs/m);
  assert.match(ui, /import\('\.\.\/\.\.\/shared\/locales\/en\.mjs'\)/);
  assert.doesNotMatch(read('src/shared/i18n-core.mjs'), /locales\//);
  assert.doesNotMatch(read('src/ui/views/settings/general.jsx'), /shared\/i18n\.mjs/);
});

test('un idioma registrado después renueva la función t y mientras tanto sale el español', () => {
  registerLocale('es', { 'a.b': 'hola {n}' });
  assert.equal(hasLocale('xx'), false);
  const before = createT('xx');
  assert.equal(before('a.b', { n: 2 }), 'hola 2');
  registerLocale('xx', { 'a.b': 'hello {n}' });
  const after = createT('xx');
  assert.notEqual(after, before);
  assert.equal(after('a.b', { n: 2 }), 'hello 2');
  assert.equal(translate('xx', 'missing'), 'missing');
});
