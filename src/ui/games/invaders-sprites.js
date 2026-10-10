// The pixel sprites of Space Invaders, as bitmaps in the code (X = a lit pixel): the three invaders with their two
// frames, the cannon, the mystery ship, a bunker and the little explosion. Shared by the game and its thumbnail.
export const SPRITES = {
  squid: [
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X'],
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '.X.XX.X.', 'X......X', '.X....X.']
  ],
  crab: [
    ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
    ['..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.X.......X.']
  ],
  octopus: [
    ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '...XX..XX...', '..XX.XX.XX..', 'XX........XX'],
    ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '..XXX..XXX..', '.XX..XX..XX.', '..XX....XX..']
  ],
  cannon: [['......X......', '.....XXX.....', '.....XXX.....', '.XXXXXXXXXXX.', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX']],
  ufo: [['.....XXXXXX.....', '...XXXXXXXXXX...', '..XXXXXXXXXXXX..', '.XX.XX.XX.XX.XX.', 'XXXXXXXXXXXXXXXX', '...XXX....XXX...', '....X......X....']],
  boom: [['....X...X....', '.X...X.X...X.', '..X.......X..', '...X.....X...', 'XX.........XX', '...X.....X...', '..X..X.X..X..', '.X..X...X..X.']],
  cannonBoom: [
    ['....X....X...', '.X.......X.X.', '...X..X......', 'X....XXX...X.', '..XXXXXXXX...', '.XXXXXXXXXX.X', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX'],
    ['.X.....X.....', '....X.....X.X', 'X........X...', '..X.XXX......', '....XXXXXX..X', 'X.XXXXXXXXX..', '.XXXXXXXXXXX.', 'XXXXXXXXXXXXX']
  ],
  bunker: [[
    '....XXXXXXXXXXXXXX....', '...XXXXXXXXXXXXXXXX...', '..XXXXXXXXXXXXXXXXXX..', '.XXXXXXXXXXXXXXXXXXXX.',
    'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX',
    'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX',
    'XXXXXXX........XXXXXXX', 'XXXXXX..........XXXXXX', 'XXXXX............XXXXX', 'XXXXX............XXXXX'
  ]],
  // The bombs: a zigzag, a plunger and a rolling one, two frames each.
  zigzag: [['.X.', 'X..', '.X.', '..X', '.X.', 'X..', '.X.'], ['..X', '.X.', 'X..', '.X.', '..X', '.X.', 'X..']],
  plunger: [['.X.', '.X.', '.X.', '.X.', '.X.', 'XXX', '.X.'], ['.X.', '.X.', '.X.', '.X.', 'XXX', '.X.', '.X.']],
  roller: [['X..', '.X.', '..X', '.X.', 'X..', '.X.', '..X'], ['..X', '.X.', 'X..', '.X.', '..X', '.X.', 'X..']]
};

// The lit pixels of a bitmap: [x, y] pairs.
export const pixels = (rows) => { const out = []; rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'X') out.push([x, y]); }); return out; };
export const size = (rows) => ({ w: rows[0].length, h: rows.length });

// A bitmap painted on a little canvas (one canvas pixel per bitmap pixel), kept for reuse.
const cache = new Map();
export function sprite(name, frame, color) {
  const key = `${name}|${frame}|${color}`;
  let c = cache.get(key);
  if (c) return c;
  const rows = SPRITES[name][frame % SPRITES[name].length]; const { w, h } = size(rows);
  c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = color;
  for (const [x, y] of pixels(rows)) ctx.fillRect(x, y, 1, 1);
  if (cache.size > 200) cache.clear();
  cache.set(key, c);
  return c;
}
