// 3.8.3: the typing of streamed answers (src/ui/lib/typing.js): pace, catching up, the end of a turn, whole characters,
// less motion, Markdown that never shows half-written, and the hand-over to the saved message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { remarkPlugins } from '../src/ui/lib/markdown-plugins.js';
import { createReveal, boundaryAtOrBefore, safeMarkdown, noteShown, takeShown, LAG_S, MIN_CPS, MAX_BEHIND } from '../src/ui/lib/typing.js';

const FRAME = 1000 / 60;
// A stream: `cps` characters per second in pieces every `every` ms, for `seconds`; the reveal steps once per frame.
function stream(rev, text, { cps = 150, every = 50, seconds = null } = {}) {
  const total = seconds == null ? text.length : Math.min(text.length, Math.round(cps * seconds));
  const out = []; let t = 0; let got = 0; let nextPiece = 0;
  while (got < total || rev.shown < got) {
    if (t >= nextPiece && got < total) { got = Math.min(total, got + Math.round((cps * every) / 1000)); rev.setTarget(text.slice(0, got)); nextPiece += every; }
    out.push({ t, got, shown: rev.advance(FRAME) });
    t += FRAME;
    if (t > 60000) break;
  }
  return out;
}

test('ritmo: sigue al agente a paso constante, poco por detrás y sin saltos', () => {
  const text = 'La respuesta llega en trozos de 50 ms y se escribe letra a letra. '.repeat(20);
  const frames = stream(createReveal(), text, { cps: 150 });
  const steady = frames.filter((f) => f.t > 1500 && f.got < text.length);
  const behind = steady.map((f) => f.got - f.shown);
  assert.ok(Math.max(...behind) < 150 * LAG_S + 20, `nunca muy por detrás (${Math.max(...behind)})`);
  const steps = steady.slice(1).map((f, i) => f.shown - steady[i].shown);
  assert.ok(Math.max(...steps) <= 6, `sin saltos: como mucho 6 letras por fotograma (${Math.max(...steps)})`);
  assert.ok(steps.filter((s) => s === 0).length / steps.length < 0.2, 'casi ningún fotograma parado mientras llega texto');
  assert.equal(frames.at(-1).shown, text.length);
});

test('ritmo: un trozo grande se alcanza rápido y nunca se queda más de MAX_BEHIND atrás', () => {
  const rev = createReveal();
  const big = 'x'.repeat(8000);
  rev.setTarget(big);
  rev.advance(FRAME);
  assert.ok(big.length - rev.shown <= MAX_BEHIND, 'como mucho MAX_BEHIND por escribir');
  let t = 0;
  while (rev.shown < big.length && t < 5000) { rev.advance(FRAME); t += FRAME; }
  assert.ok(t < 2500, `alcanzado en ${Math.round(t)} ms`);
  // A piece of a few letters after the first word: typed at least at MIN_CPS.
  const slow = createReveal(); slow.setTarget('ZORRO: hola');
  assert.equal(slow.advance(FRAME), 'ZORRO:'.length, 'la primera palabra sale en el primer fotograma');
  let n = 0; while (slow.shown < 11) { slow.advance(FRAME); n++; }
  assert.ok(n * FRAME <= (5 / MIN_CPS) * 1000 + FRAME, 'nunca más lento que MIN_CPS');
});

test('fin del turno: lo que queda sale enseguida', () => {
  const rev = createReveal();
  const text = 'a'.repeat(1500);
  rev.setTarget(text.slice(0, 1000)); rev.advance(FRAME);
  rev.setTarget(text, true);
  let t = 0; while (!rev.finished) { rev.advance(FRAME); t += FRAME; }
  assert.ok(t <= 500, `terminado en ${Math.round(t)} ms`);
  // Without frames (a window hidden): one long step finishes it.
  const hidden = createReveal(); hidden.setTarget(text, true); hidden.advance(1e9);
  assert.ok(hidden.finished || hidden.target.length - hidden.shown < 200);
});

test('nunca medio carácter: emojis con modificadores, banderas y acentos combinados', () => {
  const text = 'Hola 👨‍👩‍👧‍👦 familia, 👍🏽 vale, 🇪🇸 España, café y ñ y 한국어, fin.';
  const cuts = new Set(); const segs = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let k = 0; for (const s of segs.segment(text)) { cuts.add(s.index); k = s.index + s.segment.length; } cuts.add(k);
  for (const fallback of [false, true]) {
    for (let i = 0; i <= text.length; i++) {
      const b = boundaryAtOrBefore(text, i, fallback);
      assert.ok(b <= i, 'nunca más allá');
      if (!fallback) assert.ok(cuts.has(b), `corte ${b} en un límite de carácter`);
      else assert.ok(!/[\udc00-\udfff̀-ͯ‍️]/.test(text[b] ?? '') && text.charCodeAt(b - 1) !== 0x200d, `sin Intl.Segmenter: corte ${b} limpio`);
    }
  }
  const frames = stream(createReveal(), text, { cps: 60 });
  for (const f of frames) assert.ok(cuts.has(f.shown) || f.shown === text.length, `lo mostrado (${f.shown}) acaba en un carácter entero`);
});

test('menos movimiento: el texto sale entero al instante', () => {
  const rev = createReveal({ reduced: true });
  assert.equal(rev.setTarget('un texto largo de golpe'), 'un texto largo de golpe'.length);
  rev.setTarget('un texto largo de golpe y más');
  assert.equal(rev.shown, 'un texto largo de golpe y más'.length);
});

test('texto reescrito o recortado por delante: sigue sin volver a empezar', () => {
  const rev = createReveal();
  rev.setTarget('abcdef'); for (let i = 0; i < 30; i++) rev.advance(FRAME);
  assert.equal(rev.shown, 6);
  rev.setTarget('abXYZ'); assert.equal(rev.shown, 2, 'reescrito: desde donde coinciden');
  const long = 'p'.repeat(100) + 'q'.repeat(100);
  const r2 = createReveal(); r2.setTarget(long); for (let i = 0; i < 400 && r2.shown < 150; i++) r2.advance(FRAME);
  const at = r2.shown;
  r2.setTarget(long.slice(50) + 'rrr'); // the session view keeps only the last part
  assert.equal(r2.shown, at - 50, 'recortado: lo ya escrito sigue escrito');
  // A long text when it mounts (a chat opened while it streams): what is there shows at once.
  const r3 = createReveal({ start: 500 }); r3.setTarget('z'.repeat(520));
  assert.equal(r3.shown, 500);
});

const html = (md) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins, skipHtml: true }, md));
test('Markdown a medias: nada de símbolos sueltos que cambian un momento después', () => {
  assert.equal(safeMarkdown('Esto es **impor'), 'Esto es **impor**');
  assert.equal(safeMarkdown('Esto es **'), 'Esto es');
  assert.equal(safeMarkdown('usa `npm te'), 'usa `npm te`');
  assert.equal(safeMarkdown('mira ~~esto'), 'mira ~~esto~~');
  assert.equal(safeMarkdown('ve a [la web](https://ejem'), 've a la web');
  assert.equal(safeMarkdown('ve a [la w'), 've a la w');
  assert.equal(safeMarkdown('foto ![gat'), 'foto ');
  assert.equal(safeMarkdown('- [ ]'), '- [ ]', 'una casilla de tareas no cambia');
  assert.equal(safeMarkdown('tabla:\n\n| a | b |'), 'tabla:\n', 'la cabecera espera a su línea de debajo');
  assert.equal(safeMarkdown('| a | b |\n| -- |'), '', 'la línea de debajo a medias, también');
  assert.equal(safeMarkdown('| a | b |\n|---|---|\n| 1 | 2'), '| a | b |\n|---|---|\n| 1 |', 'una fila sin su celda abierta');
  assert.equal(safeMarkdown('código:\n```py'), 'código:', 'la primera línea del bloque espera');
  assert.equal(safeMarkdown('```py\nprint("**hola'), '```py\nprint("**hola', 'dentro del código no se toca');
  assert.equal(safeMarkdown('Esto es **impor', true), 'Esto es **impor', 'el texto entero no se toca');
  // What it draws is what the whole text draws a moment later (the same elements).
  assert.match(html(safeMarkdown('Esto es **impor')), /<strong>impor<\/strong>/);
  assert.doesNotMatch(html(safeMarkdown('ve a [la web](https://ejem')), /\[|\]\(/);
  assert.doesNotMatch(html(safeMarkdown('Tabla\n\n| a | b |')), /\|/);
});

test('el mensaje guardado sigue escribiendo desde donde iba el texto en vivo, solo una vez', () => {
  noteShown('chat:7', 'Hola, esto es');
  assert.equal(takeShown('Otra cosa'), null, 'otro texto: entero');
  assert.deepEqual(takeShown('Hola, esto es la respuesta entera.'), { start: 13, tail: 'chat:7' });
  assert.equal(takeShown('Hola, esto es la respuesta entera.'), null, 'solo una vez (el historial y una recarga, enteros)');
});

// 3.8.3 (repaso): a diagram or formula is plain code until its fence closes (drawing a half-written one on every frame
// was heavy main-thread work); single-star italics and a lone block marker do not flash; the hand-over is per chat.
test('Markdown a medias (repaso): diagramas y fórmulas como código hasta cerrar; cursiva y marcas de bloque sin parpadeo', () => {
  assert.equal(safeMarkdown('ver:\n```mermaid\ngraph TD; A-->B'), 'ver:\n```\ngraph TD; A-->B', 'un diagrama abierto es código sin lenguaje');
  assert.equal(safeMarkdown('```mermaid\ngraph TD; A-->B\n```\nlisto'), '```mermaid\ngraph TD; A-->B\n```\nlisto', 'cerrado, se dibuja');
  assert.equal(safeMarkdown('```math\nE = mc'), '```\nE = mc');
  assert.equal(safeMarkdown('fórmula:\n$$\nE = mc^2'), 'fórmula:\n```\nE = mc^2', 'un $$ abierto, también');
  assert.equal(safeMarkdown('$$\nE = mc^2\n$$\nvale'), '$$\nE = mc^2\n$$\nvale');
  assert.equal(safeMarkdown('es *importan'), 'es *importan*');
  assert.equal(safeMarkdown('es *'), 'es');
  assert.equal(safeMarkdown('- item con *énfasis*'), '- item con *énfasis*', 'una lista con cursiva cerrada no cambia');
  assert.equal(safeMarkdown('2 * 3 = 6'), '2 * 3 = 6', 'un asterisco con espacios es un asterisco');
  assert.equal(safeMarkdown('Título:\n#'), 'Título:', 'una cabecera vacía no parpadea');
  assert.equal(safeMarkdown('Lista:\n-'), 'Lista:'); assert.equal(safeMarkdown('Lista:\n1.'), 'Lista:'); assert.equal(safeMarkdown('cita:\n>'), 'cita:');
  assert.equal(safeMarkdown('Lista:\n- uno'), 'Lista:\n- uno');
  // The saved message of another chat that starts with the same words does not take this chat's place.
  noteShown('chat:1', 'Perfecto,');
  assert.equal(takeShown('Perfecto, ya está.', 'chat:2'), null);
  assert.deepEqual(takeShown('Perfecto, ya está.', 'chat:1'), { start: 9, tail: 'chat:1' });
});
