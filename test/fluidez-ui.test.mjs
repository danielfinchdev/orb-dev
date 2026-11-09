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
