// the thumbnail of each visual theme in Ajustes › Apariencia › Tema. A tiny window drawn with CSS and inline SVG
// (skin-preview.css): the sidebar with the theme's wordmark, the «new chat» button and three menu lines, the top bar
// with the window's buttons, the assistant's message, the user's bubble and the message box, over the theme's own
// backdrop and decorations (the sunset, striped sun and grid of vaporwave, the invaders of retro, the sweets
// of candy, the robot's sky of orb, nothing in predeterminado or cristal). Every colour, font and shape comes from the theme being
// shown, never from the active one, and it follows the light / dark mode of the moment. Decorative only: the button's
// label names the theme.
import './skin-preview.css';

// Pixel art of the retro night, as in components/scene.jsx: crisp squares.
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
// Candy: a puffy cloud, a swirl lollipop and a sugared gumdrop, shaded with radial gradients like the real ones.
const Sweet = ({ id, hi, body, lo }) => <radialGradient id={id} cx="35%" cy="28%" r="78%"><stop offset="0" stopColor={hi} /><stop offset="0.5" stopColor={body} /><stop offset="1" stopColor={lo} /></radialGradient>;
const Candy = () => (
  <>
    <i className="skp-cd-blob a" /><i className="skp-cd-blob b" /><i className="skp-cd-blob c" />
    <svg viewBox="0 0 100 100" className="skp-deco skp-cd-donut" aria-hidden="true">
      <defs><Sweet id="skp-cd-peach" hi="#ffe4c8" body="#ffb46e" lo="#e07a2e" /></defs>
      <circle cx="50" cy="59" r="42" style={{ fill: 'var(--p-toy-shadow)' }} />
      <circle cx="50" cy="50" r="42" fill="url(#skp-cd-peach)" />
      <path d="M50 14C72 14 86 30 86 50C86 70 72 86 50 86C28 86 14 70 14 50C14 30 28 14 50 14ZM50 36A14 14 0 1 0 50 64A14 14 0 1 0 50 36Z" fill="url(#skp-cd-pink)" fillRule="evenodd" />
      <ellipse cx="34" cy="24" rx="9" ry="4" fill="#fff" opacity="0.6" transform="rotate(-35 34 24)" />
    </svg>
    <svg viewBox="0 0 100 130" className="skp-deco skp-cd-lolli" aria-hidden="true">
      <defs><Sweet id="skp-cd-pink" hi="#ffc9e3" body="#ff7cc0" lo="#d6338e" /></defs>
      <circle cx="50" cy="53" r="34" style={{ fill: 'var(--p-toy-shadow)' }} />
      <rect x="46" y="62" width="8" height="66" rx="4" fill="#fdf3fa" /><circle cx="50" cy="38" r="34" fill="url(#skp-cd-pink)" />
      <path d="M50 38a4 4 0 0 1 4 4a8 8 0 0 1 -8 8a12 12 0 0 1 -12 -12a16 16 0 0 1 16 -16a20 20 0 0 1 20 20a24 24 0 0 1 -24 24a28 28 0 0 1 -28 -28" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="6" strokeLinecap="round" />
      <ellipse cx="36" cy="20" rx="9" ry="5" fill="#fff" opacity="0.6" transform="rotate(-30 36 20)" />
    </svg>
    <svg viewBox="0 0 100 100" className="skp-deco skp-cd-drop" aria-hidden="true">
      <defs><Sweet id="skp-cd-mint" hi="#d2f5e7" body="#7fd9bd" lo="#3fa98a" /></defs>
      <ellipse cx="50" cy="86" rx="33" ry="8" fill="#3fa98a" opacity="0.5" /><path d="M18 86C14 40 30 18 50 18C70 18 86 40 82 86Z" transform="translate(0 17)" style={{ fill: 'var(--p-toy-shadow)' }} /><path d="M18 86C14 40 30 18 50 18C70 18 86 40 82 86Z" fill="url(#skp-cd-mint)" />
      {[[32, 40], [60, 30], [70, 58], [40, 66], [52, 50]].map(([x, y]) => <circle key={x + y} cx={x} cy={y} r="3" fill="#fff" opacity="0.75" />)}
    </svg>
    <svg viewBox="0 0 100 60" className="skp-deco skp-cd-bean" aria-hidden="true">
      <defs><Sweet id="skp-cd-lilac" hi="#e6d4ff" body="#b98cff" lo="#7d4fd6" /></defs>
      <path d="M20 15C35 -2 70 2 85 18C98 32 88 55 65 55C45 55 40 45 25 48C8 50 5 30 20 15Z" transform="translate(0 14)" style={{ fill: 'var(--p-toy-shadow)' }} />
      <path d="M20 15C35 -2 70 2 85 18C98 32 88 55 65 55C45 55 40 45 25 48C8 50 5 30 20 15Z" fill="url(#skp-cd-lilac)" /><ellipse cx="38" cy="16" rx="11" ry="4" fill="#fff" opacity="0.55" transform="rotate(-15 38 16)" />
    </svg>
  </>
);
const SCENE = {
  orb: <><i className="skp-cloud a" /><i className="skp-cloud b" /></>,
  vaporwave: <><VaporwaveDay /><VaporwaveNight /></>,
  retro: <Retro />,
  candy: <Candy />,
  cristal: null, // its still colour field is --p-scene (skin-preview.css)
  predeterminado: null, // flat colours: the palette's accent comes from data-palette
};

// `palette`: the colours of Predeterminado and Cristal follow the palette chosen in Ajustes (the others ignore it).
export function SkinPreview({ skin, palette }) {
  return (
    <span className="skp" data-skin-preview={skin} data-palette={skin === 'predeterminado' || skin === 'cristal' ? palette : undefined} aria-hidden="true">
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
