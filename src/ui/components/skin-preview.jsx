// 2.7: the thumbnail of each visual theme in Ajustes › Apariencia › Tema. A tiny window drawn with CSS and inline SVG
// (skin-preview.css): the sidebar with the theme's wordmark, the «new chat» button and three menu lines, the top bar
// with the window's buttons, the assistant's message, the user's bubble and the message box, over the theme's own
// backdrop and decorations (the stickers and the sunset of vaporwave, the chevrons and the invaders of retro, the sweets
// of candy, the robot's sky of orb, nothing in profesional). Every colour, font and shape comes from the theme being
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

const INK = { stroke: '#1f1838', strokeWidth: 8, strokeLinejoin: 'round', strokeLinecap: 'round' };
const VaporwaveDay = () => (
  <>
    <svg viewBox="0 0 100 100" className="skp-deco skp-vw-floppy day" aria-hidden="true"><path d="M12 8h66l10 10v74H12z" fill="#ff9fd0" {...INK} /><rect x="30" y="8" width="40" height="28" fill="#c9b8ff" {...INK} /><rect x="24" y="56" width="52" height="30" rx="3" fill="#fff" {...INK} /></svg>
    <svg viewBox="0 0 100 100" className="skp-deco skp-vw-sparkle day" aria-hidden="true"><path d="M50 4l10 36 36 10-36 10-10 36-10-36L4 50l36-10z" fill="#fff" {...INK} /></svg>
    <svg viewBox="0 0 100 100" className="skp-deco skp-vw-smiley day" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="#ffe066" {...INK} /><ellipse cx="36" cy="42" rx="6" ry="9" fill="#1f1838" /><ellipse cx="64" cy="42" rx="6" ry="9" fill="#1f1838" /><path d="M28 60c8 14 36 14 44 0z" fill="#fff" {...INK} /></svg>
  </>
);
const VaporwaveNight = () => (
  <>
    <i className="skp-vw-stars night" /><i className="skp-vw-glow night" /><i className="skp-vw-sun night" /><i className="skp-vw-mount night" /><i className="skp-vw-floor night" />
  </>
);
const RetroDay = () => (
  <>
    <svg viewBox="0 0 520 320" fill="none" strokeWidth="30" strokeLinejoin="miter" className="skp-rt-chev day" aria-hidden="true">
      {['#5a0b1e', '#d9424e', '#f08a4b', '#fdd9c4', '#f6b73c'].map((c, i) => <path key={c} d={`M-10 ${180 + i * 34}L260 ${60 + i * 34}L530 ${180 + i * 34}`} stroke={c} />)}
    </svg>
    <svg viewBox="0 0 100 100" className="skp-deco skp-rt-aster day" aria-hidden="true">{[0, 30, 60, 90, 120, 150].map((r) => <ellipse key={r} cx="50" cy="50" rx="48" ry="11" fill="#e5584f" transform={`rotate(${r} 50 50)`} />)}<circle cx="50" cy="50" r="12" fill="#f6b73c" /></svg>
    <svg viewBox="0 0 100 100" className="skp-deco skp-rt-diamond day" aria-hidden="true"><path d="M50 2L98 50 50 98 2 50z" fill="#f08a4b" /></svg>
  </>
);
const RetroNight = () => (
  <>
    <i className="skp-rt-stars night" />
    <Pixels rows={PIX.octopus} color="#ffe14d" className="skp-deco skp-rt-inv1 night" />
    <Pixels rows={PIX.crab} color="#ff2fd2" className="skp-deco skp-rt-inv2 night" />
    <Pixels rows={PIX.crab} color="#39ff14" className="skp-deco skp-rt-crab night" />
    <Pixels rows={PIX.rocket} color="#39ff14" className="skp-deco skp-rt-rocket night" />
    <i className="skp-rt-scan night" />
  </>
);
// Candy: a puffy cloud, a swirl lollipop and a sugared gumdrop, shaded with radial gradients like the real ones.
const Sweet = ({ id, hi, body, lo }) => <radialGradient id={id} cx="35%" cy="28%" r="78%"><stop offset="0" stopColor={hi} /><stop offset="0.5" stopColor={body} /><stop offset="1" stopColor={lo} /></radialGradient>;
const Candy = () => (
  <>
    <i className="skp-cd-blob a" /><i className="skp-cd-blob b" /><i className="skp-cd-blob c" />
    <svg viewBox="0 0 200 110" className="skp-deco skp-cd-cloud" aria-hidden="true">
      <defs><Sweet id="skp-cd-white" hi="#ffffff" body="#fdf3fa" lo="#eccbe0" /></defs>
      <ellipse cx="100" cy="100" rx="70" ry="9" fill="#e9a9cc" opacity="0.35" /><rect x="28" y="62" width="146" height="38" rx="19" fill="url(#skp-cd-white)" />
      <circle cx="58" cy="66" r="32" fill="url(#skp-cd-white)" /><circle cx="104" cy="52" r="42" fill="url(#skp-cd-white)" /><circle cx="150" cy="66" r="32" fill="url(#skp-cd-white)" />
    </svg>
    <svg viewBox="0 0 100 130" className="skp-deco skp-cd-lolli" aria-hidden="true">
      <defs><Sweet id="skp-cd-pink" hi="#ffc9e3" body="#ff7cc0" lo="#d6338e" /></defs>
      <rect x="46" y="62" width="8" height="66" rx="4" fill="#fdf3fa" /><circle cx="50" cy="38" r="34" fill="url(#skp-cd-pink)" />
      <path d="M50 38a4 4 0 0 1 4 4a8 8 0 0 1 -8 8a12 12 0 0 1 -12 -12a16 16 0 0 1 16 -16a20 20 0 0 1 20 20a24 24 0 0 1 -24 24a28 28 0 0 1 -28 -28" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="6" strokeLinecap="round" />
      <ellipse cx="36" cy="20" rx="9" ry="5" fill="#fff" opacity="0.6" transform="rotate(-30 36 20)" />
    </svg>
    <svg viewBox="0 0 100 100" className="skp-deco skp-cd-drop" aria-hidden="true">
      <defs><Sweet id="skp-cd-mint" hi="#d2f5e7" body="#7fd9bd" lo="#3fa98a" /></defs>
      <ellipse cx="50" cy="86" rx="33" ry="8" fill="#3fa98a" opacity="0.5" /><path d="M18 86C14 40 30 18 50 18C70 18 86 40 82 86Z" fill="url(#skp-cd-mint)" />
      {[[32, 40], [60, 30], [70, 58], [40, 66], [52, 50]].map(([x, y]) => <circle key={x + y} cx={x} cy={y} r="3" fill="#fff" opacity="0.75" />)}
    </svg>
    <svg viewBox="0 0 100 60" className="skp-deco skp-cd-bean" aria-hidden="true">
      <defs><Sweet id="skp-cd-lilac" hi="#e6d4ff" body="#b98cff" lo="#7d4fd6" /></defs>
      <path d="M20 15C35 -2 70 2 85 18C98 32 88 55 65 55C45 55 40 45 25 48C8 50 5 30 20 15Z" fill="url(#skp-cd-lilac)" /><ellipse cx="38" cy="16" rx="11" ry="4" fill="#fff" opacity="0.55" transform="rotate(-15 38 16)" />
    </svg>
  </>
);
const SCENE = {
  orb: <><i className="skp-cloud a" /><i className="skp-cloud b" /></>,
  vaporwave: <><VaporwaveDay /><VaporwaveNight /></>,
  retro: <><RetroDay /><RetroNight /></>,
  profesional: null,
  nube: <Candy />
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
