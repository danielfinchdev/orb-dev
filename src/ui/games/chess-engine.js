// A small, complete chess engine for the mini-game: legal moves (castling, en passant, promotion to a queen), check,
// checkmate and stalemate, and a computer player (alpha-beta search; the depth is the difficulty).
// Board: 64 squares, a8 = 0 … h1 = 63. White pieces in upper case (PNBRQK), black in lower case.

const START = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';
export const newGame = () => ({ board: START.split('').map((c) => (c === '.' ? null : c)), turn: 'w', castle: { K: true, Q: true, k: true, q: true }, ep: null });

const white = (p) => p && p === p.toUpperCase();
const colorOf = (p) => (p ? (white(p) ? 'w' : 'b') : null);
const rc = (i) => [i >> 3, i & 7];
const at = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c);
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

// Is square i attacked by colour `by`?
export function attacked(board, i, by) {
  const [r, c] = rc(i);
  const pawnRow = by === 'w' ? 1 : -1; // a white pawn attacks from the row below
  for (const dc of [-1, 1]) { const j = at(r + pawnRow, c + dc); if (j >= 0 && board[j] === (by === 'w' ? 'P' : 'p')) return true; }
  for (const [dr, dc] of KNIGHT) { const j = at(r + dr, c + dc); if (j >= 0 && board[j] === (by === 'w' ? 'N' : 'n')) return true; }
  for (const [dr, dc] of KING) { const j = at(r + dr, c + dc); if (j >= 0 && board[j] === (by === 'w' ? 'K' : 'k')) return true; }
  const slide = (dirs, kinds) => dirs.some(([dr, dc]) => {
    for (let k = 1; k < 8; k++) {
      const j = at(r + dr * k, c + dc * k); if (j < 0) return false;
      const p = board[j]; if (!p) continue;
      return colorOf(p) === by && kinds.includes(p.toLowerCase());
    }
    return false;
  });
  return slide(ROOK, ['r', 'q']) || slide(BISHOP, ['b', 'q']);
}

const kingSquare = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k');
export const inCheck = (g, color = g.turn) => attacked(g.board, kingSquare(g.board, color), color === 'w' ? 'b' : 'w');

function pseudo(g) {
  const { board, turn } = g; const moves = [];
  const enemy = turn === 'w' ? 'b' : 'w';
  board.forEach((p, i) => {
    if (colorOf(p) !== turn) return;
    const [r, c] = rc(i); const kind = p.toLowerCase();
    const push = (j, extra = {}) => moves.push({ from: i, to: j, piece: p, capture: board[j], ...extra });
    if (kind === 'p') {
      const dir = turn === 'w' ? -1 : 1; const startRow = turn === 'w' ? 6 : 1; const lastRow = turn === 'w' ? 0 : 7;
      const one = at(r + dir, c);
      if (one >= 0 && !board[one]) {
        push(one, r + dir === lastRow ? { promo: true } : {});
        const two = at(r + 2 * dir, c);
        if (r === startRow && !board[two]) push(two, { double: true });
      }
      for (const dc of [-1, 1]) {
        const j = at(r + dir, c + dc); if (j < 0) continue;
        if (board[j] && colorOf(board[j]) === enemy) push(j, r + dir === lastRow ? { promo: true } : {});
        if (j === g.ep) push(j, { enPassant: true, capture: turn === 'w' ? 'p' : 'P' });
      }
      return;
    }
    const steps = (dirs, slide) => { for (const [dr, dc] of dirs) for (let k = 1; k < (slide ? 8 : 2); k++) { const j = at(r + dr * k, c + dc * k); if (j < 0) break; if (board[j]) { if (colorOf(board[j]) === enemy) push(j); break; } push(j); } };
    if (kind === 'n') steps(KNIGHT, false);
    if (kind === 'b') steps(BISHOP, true);
    if (kind === 'r') steps(ROOK, true);
    if (kind === 'q') steps([...ROOK, ...BISHOP], true);
    if (kind === 'k') {
      steps(KING, false);
      // Castling: rights kept, squares between empty, the king not in check nor passing through attacked squares.
      const home = turn === 'w' ? 60 : 4; const [k, q] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
      if (i === home && !attacked(board, home, enemy)) {
        if (g.castle[k] && !board[home + 1] && !board[home + 2] && !attacked(board, home + 1, enemy) && !attacked(board, home + 2, enemy)) push(home + 2, { castle: 'k' });
        if (g.castle[q] && !board[home - 1] && !board[home - 2] && !board[home - 3] && !attacked(board, home - 1, enemy) && !attacked(board, home - 2, enemy)) push(home - 2, { castle: 'q' });
      }
    }
  });
  return moves;
}

export function play(g, m) {
  const board = [...g.board]; const castle = { ...g.castle };
  board[m.to] = m.promo ? (g.turn === 'w' ? 'Q' : 'q') : m.piece; board[m.from] = null;
  if (m.enPassant) board[m.to + (g.turn === 'w' ? 8 : -8)] = null;
  if (m.castle === 'k') { board[m.to - 1] = board[m.to + 1]; board[m.to + 1] = null; }
  if (m.castle === 'q') { board[m.to + 1] = board[m.to - 2]; board[m.to - 2] = null; }
  if (m.piece === 'K') castle.K = castle.Q = false; if (m.piece === 'k') castle.k = castle.q = false;
  for (const [sq, right] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) castle[right] = false;
  return { board, turn: g.turn === 'w' ? 'b' : 'w', castle, ep: m.double ? (m.from + m.to) / 2 : null };
}

export function legalMoves(g) { return pseudo(g).filter((m) => !inCheck(play(g, m), g.turn)); }

// 'mate' | 'stalemate' | null
export function outcome(g) { if (legalMoves(g).length) return null; return inCheck(g) ? 'mate' : 'stalemate'; }

// ---- the computer player
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// Bonuses by square (from White's side; mirrored for Black): pawns forward, knights and bishops in the centre.
const CENTER = [0, 1, 2, 3, 3, 2, 1, 0];
const bonus = (kind, i, color) => {
  const [r0, c] = rc(i); const r = color === 'w' ? r0 : 7 - r0;
  if (kind === 'p') return (6 - r) * 8 + (c > 1 && c < 6 ? 6 : 0);
  if (kind === 'n' || kind === 'b') return (CENTER[r] + CENTER[c]) * 5;
  if (kind === 'q') return (CENTER[r] + CENTER[c]) * 2;
  if (kind === 'k') return r === 7 ? 12 : -10; // stay home in the middle game
  return 0;
};
function evaluate(g) {
  let score = 0;
  g.board.forEach((p, i) => { if (!p) return; const k = p.toLowerCase(); const v = VALUE[k] + bonus(k, i, colorOf(p)); score += white(p) ? v : -v; });
  return g.turn === 'w' ? score : -score;
}
const order = (moves) => moves.sort((a, b) => (b.capture ? VALUE[b.capture.toLowerCase()] * 10 - VALUE[b.piece.toLowerCase()] : 0) - (a.capture ? VALUE[a.capture.toLowerCase()] * 10 - VALUE[a.piece.toLowerCase()] : 0));

function search(g, depth, alpha, beta) {
  if (depth === 0) return evaluate(g);
  const moves = legalMoves(g);
  if (!moves.length) return inCheck(g) ? -100000 - depth : 0;
  for (const m of order(moves)) {
    const v = -search(play(g, m), depth - 1, -beta, -alpha);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

const DEPTH = { facil: 1, normal: 2, dificil: 3 };
export function bestMove(g, level) {
  const moves = order(legalMoves(g)); if (!moves.length) return null;
  // Easy also blunders now and then.
  if (level === 'facil' && Math.random() < 0.3) return moves[Math.floor(Math.random() * moves.length)];
  let best = moves[0]; let alpha = -Infinity;
  for (const m of moves) {
    const v = -search(play(g, m), DEPTH[level] - 1, -Infinity, -alpha) + Math.random() * 6; // a little variety
    if (v > alpha) { alpha = v; best = m; }
  }
  return best;
}
