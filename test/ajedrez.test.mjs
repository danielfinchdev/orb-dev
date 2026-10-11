// Ajedrez (2.7): el ordenador contesta dentro de su tiempo aunque el nivel sea difícil, y sigue jugando bien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, legalMoves, play, outcome, bestMove } from '../src/ui/games/chess-engine.js';

const sq = (s) => (8 - Number(s[1])) * 8 + 'abcdefgh'.indexOf(s[0]);
const move = (g, from, to) => play(g, legalMoves(g).find((m) => m.from === sq(from) && m.to === sq(to)));
// Una posición de medio juego con muchas jugadas posibles (italiana con las piezas desarrolladas).
const middlegame = () => [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['f8', 'c5'], ['d2', 'd3'], ['g8', 'f6'], ['c2', 'c3'], ['d7', 'd6'], ['b1', 'd2']]
  .reduce((g, [a, b]) => move(g, a, b), newGame());

test('Ajedrez: con poco tiempo contesta a tiempo y con una jugada legal', () => {
  const g = middlegame();
  const t0 = performance.now();
  const m = bestMove(g, 'dificil', { budget: 30 });
  const took = performance.now() - t0;
  assert.ok(legalMoves(g).some((x) => x.from === m.from && x.to === m.to));
  assert.ok(took < 400, `tardó ${Math.round(took)} ms`);
});

test('Ajedrez: ve el mate en una aunque se le acabe el tiempo', () => {
  // Mate del pastor: la dama blanca da mate en f7.
  let g = [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6']].reduce((x, [a, b]) => move(x, a, b), newGame());
  const m = bestMove(g, 'normal', { budget: 1 });
  g = play(g, m);
  assert.equal(outcome(g), 'mate');
});
