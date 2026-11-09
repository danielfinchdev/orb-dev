// 3.8.3: the pure logic behind a smooth chat: an answer still streaming is parsed block by block (only the last one
// again with each piece) and draws the same as the whole text; the message the user sends shows at once and goes when
// its saved line arrives, never twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { ROOT } from './helpers.mjs';
import { remarkPlugins } from '../src/ui/lib/markdown-plugins.js';
import { splitBlocks } from '../src/ui/lib/md-blocks.js';
import { pendingShown } from '../src/ui/lib/pending.js';

const html = (md) => renderToStaticMarkup(createElement(ReactMarkdown, { skipHtml: true, remarkPlugins }, md));
const squash = (s) => s.replace(/\n+/g, '');

const ANSWER = `Te propongo este plan:

| # | Tarea | Agente |
|---|---|---|
| 1 | Base | codex |

1. Primero la base.
   Con dos líneas.

   \`\`\`js
   const a = 1;

   const b = 2;
   \`\`\`
2. Después las pruebas.

\`\`\`bash
npm test

npm run build
\`\`\`

$$
x = 1

y = 2
$$

- [x] Proyecto creado
- [ ] Lanzar las tareas

> Una nota
> de dos líneas.

Fin.`;

test('splitBlocks: corta solo entre bloques de primer nivel (nunca dentro de código, fórmulas ni listas)', () => {
  const blocks = splitBlocks(ANSWER);
  assert.equal(blocks.join('\n'), ANSWER, 'sin perder ni añadir nada');
  assert.ok(blocks.length >= 7, `varios bloques (${blocks.length})`);
  assert.ok(blocks.some((b) => b.includes('npm test') && b.includes('npm run build')), 'un bloque de código con una línea en blanco va entero');
  assert.ok(blocks.some((b) => b.includes('x = 1') && b.includes('y = 2')), 'una fórmula $$ con una línea en blanco va entera');
  assert.ok(blocks.some((b) => b.includes('Primero la base') && b.includes('const b = 2') && b.includes('Después las pruebas')), 'la lista numerada, con su código sangrado, va entera');
  // Each block draws the same as inside the whole text.
  assert.equal(squash(blocks.map(html).join('')), squash(html(ANSWER)));
});

test('splitBlocks: mientras llega el texto, solo cambia el último bloque', () => {
  let before = [];
  for (let n = 1; n <= ANSWER.length; n += 7) {
    const now = splitBlocks(ANSWER.slice(0, n));
    for (let i = 0; i < Math.min(before.length, now.length) - 1; i++) assert.equal(now[i], before[i], `el bloque ${i} ya terminado no cambia (n=${n})`);
    assert.ok(now.length >= before.length, 'los bloques no desaparecen');
    before = now;
  }
  assert.deepEqual(splitBlocks(''), ['']);
});

test('pendingShown: el mensaje enviado se ve hasta que llega su línea guardada; nunca dos veces', () => {
  const p1 = { id: 'pendiente-1', text: 'hola', after: 10 };
  const p2 = { id: 'pendiente-2', text: 'otra', after: 10 };
  assert.deepEqual(pendingShown([p1, p2], [{ id: 9, text: 'hola' }]), [p1, p2], 'una línea anterior con el mismo texto no cuenta');
  assert.deepEqual(pendingShown([p1, p2], [{ id: 11, text: 'hola' }]), [p2], 'su línea llegó');
  assert.deepEqual(pendingShown([p1, p2], [{ id: 11, text: 'otra' }, { id: 12, text: 'hola' }]), [], 'cada una la suya');
  assert.deepEqual(pendingShown([p1], [{ id: 11, text: 'hola (con contexto)' }]), [], 'el motor la guardó algo distinta: la nueva línea del usuario es la suya');
});

test('el chat pinta el mensaje propio al instante y la respuesta final en el mismo fotograma en que acaba el streaming', () => {
  const chat = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'chat.jsx'), 'utf8');
  const session = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'session.jsx'), 'utf8');
  const orch = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'orchestrator.mjs'), 'utf8');
  assert.match(chat, /addPending\(id == null \? 'new' : `chat:\$\{id\}`/, 'chat: mensaje optimista');
  assert.match(session, /addPending\(`session:\$\{s\.id\}`/, 'conversación directa: mensaje optimista');
  assert.match(orch, /state\.answer = /, 'el estado que cierra el turno lleva la línea escrita');
  assert.match(chat, /answer && answer\.id > lastId \? \[\.\.\.saved, answer\]/, 'la ventana la pinta sin esperar a leer la conversación');
  assert.match(chat, /<StreamingMarkdown>/); assert.match(session, /<StreamingMarkdown>/);
});

// 3.8.3 (fix C): typing redraws the message box alone; the view around it reads the text only when it sends.
test('el texto del cuadro vive en su borrador: la vista no se redibuja con cada tecla', async () => {
  const { createDraft } = await import('../src/ui/lib/draft.js');
  const d = createDraft();
  const seen = []; const off = d.subscribe(() => seen.push(d.get()));
  d.set('h'); d.set('ho'); d.set((v) => `${v}la`); d.set('hola');
  assert.deepEqual(seen, ['h', 'ho', 'hola'], 'one notice per change, none for the same text');
  off(); d.set(''); assert.equal(seen.length, 3);
  assert.equal(d.get(), '');
  const chat = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'chat.jsx'), 'utf8');
  const session = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'session.jsx'), 'utf8');
  for (const [name, src] of [['chat', chat], ['session', session]]) {
    assert.doesNotMatch(src, /\[text, setText\] = useState/, `${name}: no text state in the view`);
    assert.match(src, /<Composer draft=\{/, `${name}: the box gets its draft`);
  }
  assert.match(chat, /const value = useDraftValue\(draft\)/, 'only the Composer follows the text');
});

// 3.8.3 (fix C): the moving backdrop and the robot's blinking run on the compositor (transform / opacity only).
test('las nubes y los ojos del robot se mueven sin repintar: sin filtro por fotograma ni SVG animado', () => {
  const themes = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'themes.css'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'app.css'), 'utf8');
  const orb = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'orb.jsx'), 'utf8');
  const baked = themes.match(/^\.orb-cloud\.baked \{([^}]*)\}/m)?.[1] ?? '';
  assert.match(baked, /filter: none/); assert.match(baked, /var\(--orb-cloud-art\)/);
  assert.match(themes, /^html\.dark \.orb-cloud\.baked \{ background: var\(--orb-cloud-art-dark\) 0 0 \/ 100% 100% no-repeat; \}/m, 'dark: the whole background, not just the image');
  assert.match(themes, /@keyframes cloud-drift \{ from \{ transform: [^}]*\} to \{ transform: [^}]*\} \}/);
  assert.match(orb, /<span className=\{cn\('orb-eye', i === 1 && 'orb-eye-r'\)\}>/, 'each eye is an HTML box');
  assert.doesNotMatch(orb, /<g className=\{cn\('orb-eye'/);
  assert.match(app, /\.orb:not\(\.still\) \.orb-eye \{ will-change: transform; \}/);
  assert.match(app, /@keyframes orb-talk \{ from \{ transform: scaleY\(1\); \} to \{ transform: scaleY\(\.7\); \} \}/, 'talking stays the same');
});
