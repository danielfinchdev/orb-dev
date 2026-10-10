// The computer's search runs here, off the interface thread, so the board never freezes while it thinks.
import { bestMove } from './chess-engine.js';

self.onmessage = (e) => {
  const { id, game, level } = e.data;
  self.postMessage({ id, move: bestMove(game, level) });
};
