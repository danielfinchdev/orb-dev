// the thumbnail of each visual theme in Ajustes › Apariencia › Tema. A tiny window drawn with CSS and inline SVG
// (skin-preview.css): the sidebar with the theme's wordmark, the «new chat» button and three menu lines, the top bar
// with the window's buttons, the assistant's message, the user's bubble and the message box, over the theme's own
// backdrop and decorations (the sunset, striped sun and grid of vaporwave, the invaders of retro, the blobs of candy,
// the robot's sky of orb, nothing in the default theme; a pale colour field in the glass one). Every colour, font and shape
// comes from the theme being shown, never from the active one, and it follows the light / dark mode of the moment.
// Decorative only: the button's label names the theme.
import './skin-preview.css';

// Pixel art of the retro night: crisp squares.
const PIX = {
  crab: ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
  octopus: ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '...XX..XX...', '..XX.XX.XX..', 'XX........XX'],
  rocket: ['....X....', '...XXX...', '...XXX...', '..XXXXX..', '..XX.XX..', '..XXXXX..', '..XXXXX..', '.XXXXXXX.', 'XXXXXXXXX', 'X.XXXXX.X', 'X..XXX..X', '..F...F..', '...F.F...']
};
const Pixels = ({ rows, color, className }) => (
  <svg viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" className={className} aria-hidden="true">
    {rows.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c === 'F' ? '#ffe14d' : color} />)))}
  </svg>
);

const VaporwaveDay = () => (
  <>
    <i className="skp-vw-glow day" /><i className="skp-vw-sun day" /><i className="skp-vw-floor day" />
  </>
);
const VaporwaveNight = () => (
  <>
    <i className="skp-vw-stars night" /><i className="skp-vw-glow night" /><i className="skp-vw-sun night" /><i className="skp-vw-mount night" /><i className="skp-vw-floor night" />
  </>
);
const Retro = () => (
  <>
    <i className="skp-rt-stars" />
    <Pixels rows={PIX.octopus} color="#39ff14" className="skp-deco skp-rt-inv1" />
    <Pixels rows={PIX.crab} color="#39ff14" className="skp-deco skp-rt-inv2" />
    <Pixels rows={PIX.crab} color="#39ff14" className="skp-deco skp-rt-crab" />
    <Pixels rows={PIX.rocket} color="#39ff14" className="skp-deco skp-rt-rocket" />
    <i className="skp-rt-scan" />
  </>
);
// Candy: three soft pastel blobs.
const Candy = () => (
  <>
    <i className="skp-cd-blob a" /><i className="skp-cd-blob b" /><i className="skp-cd-blob c" />
  </>
);
const SCENE = {
  orb: <><i className="skp-cloud a" /><i className="skp-cloud b" /></>,
  vaporwave: <><VaporwaveDay /><VaporwaveNight /></>,
  retro: <Retro />,
  predeterminado: null, // generic thumbnail: flat colours only (skin-preview.css)
  cristal: null,
  candy: <Candy />
};

export function SkinPreview({ skin }) {
  return (
    <span className="skp" data-skin-preview={skin} aria-hidden="true">
      <span className="skp-scene">{SCENE[skin]}<i className="skp-frost" /></span>
      <span className="skp-side">
        <span className="skp-mark">ORB<i /><em>E</em></span>
        <i className="skp-new" /><i className="skp-nav on" /><i className="skp-nav" /><i className="skp-nav" /><i className="skp-nav" />
      </span>
      <span className="skp-main">
        <span className="skp-bar"><b /><i /><i /><i /></span>
        <span className="skp-bot"><b /><b /></span>
        <i className="skp-me" />
        <span className="skp-box"><b /><i /></span>
      </span>
    </span>
  );
}
