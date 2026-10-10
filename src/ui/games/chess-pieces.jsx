// The chess pieces: the «RhosGFX» set (CC0, see public/juegos/LICENCIAS.md), cream white pieces and terracotta black
// ones with a dark outline. One <img> per piece from the app's public folder; the twelve files are fetched once when
// this module loads, so the board never shows a blank square while a piece arrives.
const DIR = '/juegos/ajedrez/rhosgfx';
export const pieceSrc = (code) => `${DIR}/${code === code.toUpperCase() ? 'w' : 'b'}${code.toUpperCase()}.svg`;

const preloaded = [];
if (typeof Image !== 'undefined') for (const c of 'KQRBNPkqrbnp') { const img = new Image(); img.decoding = 'async'; img.src = pieceSrc(c); preloaded.push(img); }

// <Piece code="N" />: upper case white, lower case black.
export function Piece({ code, size = 44, className, style }) {
  return <img src={pieceSrc(code)} width={size} height={size} draggable={false} alt="" aria-hidden="true" className={className} style={{ display: 'block', userSelect: 'none', ...style }} />;
}
