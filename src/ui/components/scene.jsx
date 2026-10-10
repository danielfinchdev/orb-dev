// 2.6: the illustrated backdrop of each visual theme, behind the screens (themes.css draws and moves it; it sits under a
// veil at the top so it never competes with the text). Nothing in the «profesional» theme.
import { useStore } from '@/lib/store.js';

// ---- Vaporwave, day: stickers of old computers (thick ink outline, flat pastel fills; the offset shadow is CSS). ----
const INK = { stroke: 'currentColor', strokeWidth: 4, strokeLinejoin: 'round', strokeLinecap: 'round' };
const Floppy = () => (
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M12 8h66l10 10v74H12z" fill="#ff9fd0" {...INK} /><rect x="30" y="8" width="40" height="28" fill="#c9b8ff" {...INK} /><rect x="56" y="13" width="8" height="17" fill="currentColor" />
    <rect x="24" y="56" width="52" height="30" rx="3" fill="#fff" {...INK} /><path d="M32 66h36M32 76h24" {...INK} strokeWidth="3" />
  </svg>
);
const Cassette = () => (
  <svg viewBox="0 0 120 80" aria-hidden="true">
    <rect x="4" y="8" width="112" height="64" rx="8" fill="#c9b8ff" {...INK} /><rect x="16" y="18" width="88" height="34" rx="4" fill="#ffd4b0" {...INK} /><rect x="16" y="35" width="88" height="17" fill="#ffb6dc" />
    <circle cx="40" cy="35" r="10" fill="#fff" {...INK} /><circle cx="80" cy="35" r="10" fill="#fff" {...INK} /><circle cx="40" cy="35" r="3" fill="currentColor" /><circle cx="80" cy="35" r="3" fill="currentColor" />
    <path d="M34 72l6-12h40l6 12" fill="#e7e4f3" {...INK} />
  </svg>
);
const Monitor = () => (
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <rect x="8" y="6" width="84" height="66" rx="8" fill="#e7e4f3" {...INK} /><rect x="18" y="15" width="64" height="46" rx="4" fill="#ffb6dc" {...INK} /><rect x="18" y="15" width="64" height="23" rx="4" fill="#c9b8ff" /><rect x="18" y="30" width="64" height="8" fill="#dcc6f5" />
    <text x="50" y="45" textAnchor="middle" fontFamily="Space Grotesk Variable, sans-serif" fontWeight="700" fontSize="15" fill="#fff" stroke="currentColor" strokeWidth="3" paintOrder="stroke">Hello!</text>
    <rect x="40" y="72" width="20" height="8" fill="#e7e4f3" {...INK} /><rect x="26" y="80" width="48" height="10" rx="3" fill="#e7e4f3" {...INK} />
  </svg>
);
const Smiley = () => (
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="42" fill="#ffe066" {...INK} /><ellipse cx="36" cy="42" rx="5" ry="8" fill="currentColor" /><ellipse cx="64" cy="42" rx="5" ry="8" fill="currentColor" />
    <path d="M28 60c8 14 36 14 44 0" fill="#fff" {...INK} /><path d="M46 70c6 8 14 6 16-2" fill="#ff9fd0" {...INK} strokeWidth="3" />
  </svg>
);
const Sparkle = () => <svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4l10 36 36 10-36 10-10 36-10-36L4 50l36-10z" fill="#fff" {...INK} /></svg>;
const Planet = () => (
  <svg viewBox="0 0 120 100" aria-hidden="true">
    <ellipse cx="60" cy="52" rx="56" ry="14" fill="none" {...INK} strokeWidth="12" transform="rotate(-18 60 52)" /><ellipse cx="60" cy="52" rx="56" ry="14" fill="none" stroke="#ffb6dc" strokeWidth="6" transform="rotate(-18 60 52)" />
    <circle cx="60" cy="50" r="28" fill="#c9b8ff" {...INK} /><circle cx="50" cy="42" r="6" fill="#e7e4f3" /><circle cx="68" cy="58" r="4" fill="#e7e4f3" />
    <path d="M6 66c18 10 90 10 108-10" fill="none" stroke="#ffb6dc" strokeWidth="6" strokeLinecap="round" /><path d="M6 66c18 10 90 10 108-10" fill="none" {...INK} strokeWidth="2.5" />
  </svg>
);
const Folder = () => (
  <svg viewBox="0 0 110 90" aria-hidden="true">
    <path d="M6 20h34l10 10h54v50H6z" fill="#ffd27a" {...INK} /><path d="M6 36h98v44H6z" fill="#ffe3a6" {...INK} />
  </svg>
);
const Bubble = () => (
  <svg viewBox="0 0 110 90" aria-hidden="true">
    <path d="M14 8h82a8 8 0 0 1 8 8v44a8 8 0 0 1-8 8H48L28 86l4-18H14a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z" fill="#fff" {...INK} />
    <text x="55" y="50" textAnchor="middle" fontFamily="Space Grotesk Variable, sans-serif" fontWeight="800" fontSize="34" fill="#ff5fb4" stroke="currentColor" strokeWidth="2.5" paintOrder="stroke">!!!</text>
  </svg>
);
const STICKERS = [
  { el: <Monitor />, left: '0.5%', top: '13%', w: 90, r: -8, dur: 13, delay: -2 },
  { el: <Sparkle />, left: '12%', top: '8%', w: 34, r: 15, dur: 9, delay: -5 },
  { el: <Cassette />, right: '1%', top: '14%', w: 130, r: 10, dur: 14, delay: -7 },
  { el: <Floppy />, left: '2%', top: '46%', w: 86, r: 12, dur: 12, delay: -4 },
  { el: <Planet />, right: '1%', top: '44%', w: 120, r: -6, dur: 16, delay: -9 },
  { el: <Smiley />, left: '3%', bottom: '8%', w: 80, r: -10, dur: 11, delay: -1 },
  { el: <Sparkle />, right: '11%', top: '36%', w: 28, r: -20, dur: 8, delay: -3 },
  { el: <Bubble />, right: '3%', bottom: '20%', w: 96, r: 6, dur: 12, delay: -6 },
  { el: <Folder />, left: '14%', bottom: '2%', w: 90, r: 8, dur: 13, delay: -8 },
  { el: <Sparkle />, left: '9%', bottom: '28%', w: 22, r: 30, dur: 10, delay: -2 }
];
// ---- Vaporwave, night: fluffy clouds lit from below and a city skyline in front of the sun. ----
const NightCloud = ({ id }) => (
  <svg viewBox="0 0 240 110" aria-hidden="true">
    <defs><linearGradient id={`vwg-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a1468" /><stop offset="0.45" stopColor="#8a2a7a" /><stop offset="0.8" stopColor="#ff7a6a" /><stop offset="1" stopColor="#ffc07a" /></linearGradient></defs>
    <g fill={`url(#vwg-${id})`}>
      <circle cx="52" cy="72" r="30" /><circle cx="88" cy="52" r="34" /><circle cx="126" cy="40" r="38" /><circle cx="166" cy="56" r="32" /><circle cx="196" cy="76" r="26" />
      <rect x="22" y="70" width="200" height="30" rx="15" />
    </g>
    <path d="M30 96c40 8 140 8 190-2" fill="none" stroke="#ffd27a" strokeWidth="4" strokeLinecap="round" opacity="0.7" />
  </svg>
);
const CITY = [[0, 30], [24, 55], [40, 42], [70, 70], [84, 48], [110, 62], [130, 90], [146, 56], [176, 44], [196, 76], [220, 60], [250, 100], [262, 66], [290, 52], [314, 80], [334, 46], [360, 64], [390, 92], [404, 58], [430, 40], [458, 70], [480, 54], [506, 84], [520, 48], [550, 66], [576, 96], [590, 60], [620, 44], [646, 72], [670, 58], [700, 88], [716, 50], [744, 64], [770, 42], [800, 78], [820, 56], [850, 68], [880, 94], [896, 52], [924, 62], [950, 46], [976, 74], [1000, 0]];
const City = () => (
  <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
    {CITY.slice(0, -1).map(([x, h], i) => <rect key={i} x={x} y={100 - h} width={CITY[i + 1][0] - x + 1} height={h} fill="currentColor" />)}
  </svg>
);
const NIGHT_CLOUDS = [{ top: '6%', w: 300, dur: 150, delay: -40 }, { top: '22%', w: 220, dur: 190, delay: -120 }, { top: '34%', w: 260, dur: 170, delay: -20 }];

// ---- Retro: pixel art drawn as crisp squares (the arcade's crab, squid and octopus, a rocket) and the seventies' shapes. ----
const PIX = {
  crab: ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
  squid: ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X'],
  octopus: ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '...XX..XX...', '..XX.XX.XX..', 'XX........XX'],
  rocket: ['....X....', '...XXX...', '...XXX...', '..XXXXX..', '..XX.XX..', '..XXXXX..', '..XXXXX..', '.XXXXXXX.', 'XXXXXXXXX', 'X.XXXXX.X', 'X..XXX..X', '..F...F..', '...F.F...']
};
const Pixels = ({ rows, color = 'currentColor' }) => (
  <svg viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
    {rows.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} className={c === 'F' ? 'flame' : undefined} />)))}
  </svg>
);
const RAINBOW = ['#ff2fd2', '#b14bff', '#4b6bff', '#3ef0ff', '#5dffb3', '#39ff14', '#ffe14d', '#b5c926', '#ff8a3d', '#ff4040'];
const COLUMN = ['crab', 'squid', 'octopus', 'crab', 'squid', 'octopus', 'crab'];
const Asterisk = () => <svg viewBox="0 0 100 100" aria-hidden="true">{[0, 30, 60, 90, 120, 150].map((r) => <ellipse key={r} cx="50" cy="50" rx="48" ry="11" fill="currentColor" transform={`rotate(${r} 50 50)`} />)}<circle cx="50" cy="50" r="12" fill="#f6b73c" /></svg>;
const Diamond = () => <svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 2L98 50 50 98 2 50z" fill="currentColor" /></svg>;
const FourDots = () => <svg viewBox="0 0 100 100" aria-hidden="true">{[[50, 18], [82, 50], [50, 82], [18, 50]].map(([x, y]) => <path key={x + y} d={`M${x} ${y - 16}L${x + 16} ${y} ${x} ${y + 16} ${x - 16} ${y}z`} fill="currentColor" />)}</svg>;
const ThinSparkle = () => <svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0C52 40 60 48 100 50 60 52 52 60 50 100 48 60 40 52 0 50 40 48 48 40 50 0z" fill="currentColor" /></svg>;
const Chevrons = () => (
  <svg viewBox="0 0 520 320" fill="none" strokeWidth="26" strokeLinejoin="miter" aria-hidden="true">
    {['#5a0b1e', '#d9424e', '#f08a4b', '#fdd9c4', '#f6b73c'].map((c, i) => <path key={c} d={`M-10 ${330 + i * 34 - 150}L260 ${60 + i * 34}L530 ${330 + i * 34 - 150}`} stroke={c} />)}
  </svg>
);
const SHAPES = [
  { el: <Asterisk />, c: '#e5584f', left: '2%', top: '14%', w: 64, r: 0, dur: 14, delay: -3 },
  { el: <Diamond />, c: '#f08a4b', right: '3%', top: '16%', w: 34, r: 0, dur: 10, delay: -5 },
  { el: <FourDots />, c: '#2f5a85', left: '5%', top: '48%', w: 44, r: 0, dur: 12, delay: -7 },
  { el: <ThinSparkle />, c: '#5a0b1e', right: '7%', top: '40%', w: 40, r: 0, dur: 9, delay: -2 },
  { el: <Asterisk />, c: '#f6b73c', right: '1%', top: '60%', w: 48, r: 20, dur: 13, delay: -8 },
  { el: <Diamond />, c: '#e5584f', left: '12%', bottom: '6%', w: 26, r: 0, dur: 11, delay: -4 },
  { el: <ThinSparkle />, c: '#f08a4b', left: '3%', bottom: '18%', w: 56, r: 0, dur: 10, delay: -6 }
];

const ORB_CLOUDS = [{ dur: 90, delay: -10 }, { dur: 70, delay: -45 }, { dur: 110, delay: -70 }];
// Candy: the pastel blobs (colour, place, size, how far they drift, how long) and the 3D sweets floating at the edges.
const BLOBS = [
  { c: 'pink', left: '-8%', top: '-12%', w: 620, h: 480, dx: 50, dy: 30, dur: 34, delay: -6 },
  { c: 'mint', left: '-10%', top: '52%', w: 560, h: 460, dx: 60, dy: -30, dur: 38, delay: -25 },
  { c: 'sky', left: '62%', top: '58%', w: 560, h: 440, dx: -50, dy: -40, dur: 44, delay: -12 }
];
// Three tones of each sweet colour (light, body, shade) for the 3D shading.
const SWEET = { pink: ['#ffc9e3', '#ff7cc0', '#d6338e'], lilac: ['#e6d4ff', '#b98cff', '#7d4fd6'], mint: ['#d2f5e7', '#7fd9bd', '#3fa98a'], peach: ['#ffe4c8', '#ffb46e', '#e07a2e'], sky: ['#dbecff', '#8cc4ff', '#4a86d9'], yellow: ['#fff4c4', '#ffd95a', '#e0a800'], white: ['#ffffff', '#fdf3fa', '#eccbe0'] };
const g = (c) => `url(#cdg-${c})`;
const Shine = ({ x, y, rx, ry, a = -30, o = 0.6 }) => <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#fff" opacity={o} transform={`rotate(${a} ${x} ${y})`} />;
// A swirl lollipop: the stick, the disc and a white spiral on it.
const Lollipop = ({ c = 'pink' }) => (
  <svg viewBox="0 0 100 130" aria-hidden="true">
    <rect x="46" y="62" width="8" height="66" rx="4" fill={g('white')} />
    <circle cx="50" cy="38" r="34" fill={g(c)} />
    <path d="M50 38a4 4 0 0 1 4 4a8 8 0 0 1 -8 8a12 12 0 0 1 -12 -12a16 16 0 0 1 16 -16a20 20 0 0 1 20 20a24 24 0 0 1 -24 24a28 28 0 0 1 -28 -28" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="5" strokeLinecap="round" />
    <Shine x={36} y={20} rx={9} ry={5} />
  </svg>
);
// A wrapped candy: the striped body and the two twisted ends of the wrapper.
const Wrapped = ({ c = 'pink', c2 = 'white' }) => (
  <svg viewBox="0 0 140 80" aria-hidden="true">
    <path d="M42 40 L10 20 Q18 40 10 60 Z" fill={g(c)} /><path d="M98 40 L130 20 Q122 40 130 60 Z" fill={g(c)} />
    <ellipse cx="70" cy="40" rx="30" ry="22" fill={g(c)} />
    <path d="M52 20 L40 56 M66 18 L54 62 M80 18 L68 62 M94 20 L82 56" stroke={SWEET[c2][0]} strokeOpacity="0.8" strokeWidth="6" strokeLinecap="round" />
    <ellipse cx="42" cy="40" rx="4" ry="9" fill={SWEET[c][2]} opacity="0.6" /><ellipse cx="98" cy="40" rx="4" ry="9" fill={SWEET[c][2]} opacity="0.6" />
    <Shine x={58} y={27} rx={9} ry={4} a={-20} />
  </svg>
);
// A jelly bean.
const Bean = ({ c = 'lilac' }) => (
  <svg viewBox="0 0 100 60" aria-hidden="true">
    <path d="M20 15C35 -2 70 2 85 18C98 32 88 55 65 55C45 55 40 45 25 48C8 50 5 30 20 15Z" fill={g(c)} />
    <Shine x={38} y={16} rx={11} ry={4} a={-15} o={0.55} />
  </svg>
);
// A sugared gumdrop.
const Gumdrop = ({ c = 'mint' }) => (
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <ellipse cx="50" cy="86" rx="33" ry="8" fill={SWEET[c][2]} opacity="0.5" />
    <path d="M18 86C14 40 30 18 50 18C70 18 86 40 82 86Z" fill={g(c)} />
    {[[32, 40], [60, 30], [70, 58], [40, 66], [52, 50], [28, 70]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.2" fill="#fff" opacity="0.75" />)}
    <Shine x={38} y={32} rx={8} ry={5} a={-35} />
  </svg>
);
// A puffy 3D cloud: three puffs on a rounded base, a pink shade under it.
const Cloud = () => (
  <svg viewBox="0 0 200 110" aria-hidden="true">
    <ellipse cx="100" cy="100" rx="70" ry="9" fill="#e9a9cc" opacity="0.35" />
    <rect x="28" y="62" width="146" height="38" rx="19" fill={g('white')} />
    <circle cx="58" cy="66" r="32" fill={g('white')} /><circle cx="104" cy="52" r="42" fill={g('white')} /><circle cx="150" cy="66" r="32" fill={g('white')} />
    <Shine x={92} y={30} rx={18} ry={7} a={-10} o={0.9} />
  </svg>
);
const SWEETS = [
  { el: <Cloud />, left: '0.5%', top: '9%', w: 200, dur: 14, delay: -3 },
  { el: <Wrapped c="pink" />, right: '2%', top: '13%', w: 140, r: 18, dur: 11, delay: -6 },
  { el: <Gumdrop c="mint" />, left: '4%', top: '44%', w: 70, r: -6, dur: 12, delay: -1 },
  { el: <Cloud />, right: '1%', top: '40%', w: 170, dur: 16, delay: -9 },
  { el: <Lollipop c="pink" />, left: '2%', bottom: '8%', w: 110, r: -14, dur: 13, delay: -5 },
  { el: <Bean c="lilac" />, right: '5%', bottom: '18%', w: 92, r: -25, dur: 10, delay: -2 },
  { el: <Bean c="peach" />, left: '13%', bottom: '3%', w: 60, r: 30, dur: 9, delay: -7 },
  { el: <Wrapped c="sky" c2="white" />, right: '18%', bottom: '4%', w: 110, r: -8, dur: 12, delay: -4 },
  { el: <Gumdrop c="yellow" />, right: '3%', bottom: '2%', w: 56, r: 8, dur: 11, delay: -8 }
];
const SweetDefs = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
    <defs>{Object.entries(SWEET).map(([k, [hi, body, lo]]) => <radialGradient key={k} id={`cdg-${k}`} cx="35%" cy="28%" r="78%"><stop offset="0" stopColor={hi} /><stop offset="0.5" stopColor={body} /><stop offset="1" stopColor={lo} /></radialGradient>)}</defs>
  </svg>
);

export function Scene() {
  const skin = useStore((s) => s.app?.config?.ui?.skin) ?? 'orb';
  if (skin === 'profesional') return null;
  return (
    <div className={`scene scene-${skin}`} aria-hidden="true" data-testid="scene">
      <div className="scene-blur">
        {skin === 'orb' ? ORB_CLOUDS.map((c, i) => <div key={i} className="orb-cloud" style={{ top: `${18 + i * 26}%`, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />) : null}
        {skin === 'vaporwave' ? (<>
          <div className="vw-stars" /><div className="vw-shoot a" /><div className="vw-shoot b" />
          <div className="vw-beam a" /><div className="vw-beam b" /><div className="vw-beam c" /><div className="vw-beam d" />
          <div className="vw-glow" /><div className="vw-sun" />
          {NIGHT_CLOUDS.map((c, i) => <div key={`n${i}`} className="vw-cloud" style={{ top: c.top, width: c.w, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }}><NightCloud id={i} /></div>)}
          <div className="vw-mount back" /><div className="vw-mount front" />
          <div className="vw-city"><City /></div>
          <div className="vw-floor" />
          {STICKERS.map((t, i) => <div key={`k${i}`} className="vw-sticker" style={{ left: t.left, right: t.right, top: t.top, bottom: t.bottom, width: t.w, '--r': `${t.r ?? 0}deg`, animationDuration: `${t.dur}s`, animationDelay: `${t.delay}s` }}>{t.el}</div>)}
        </>) : null}
        {skin === 'retro' ? (<>
          <div className="rt-stars s1" /><div className="rt-stars s2" />
          <div className="rt-column left">{COLUMN.map((k, i) => <div key={i}><Pixels rows={PIX[k]} color={RAINBOW[i % RAINBOW.length]} /></div>)}</div>
          <div className="rt-column right">{COLUMN.map((k, i) => <div key={i}><Pixels rows={PIX[k]} color={RAINBOW[(i + 5) % RAINBOW.length]} /></div>)}</div>
          <div className="rt-crab"><Pixels rows={PIX.crab} /></div>
          <div className="rt-rocket"><Pixels rows={PIX.rocket} /></div>
          <div className="rt-corner"><Chevrons /></div>
          {SHAPES.map((t, i) => <div key={`h${i}`} className="rt-shape" style={{ left: t.left, right: t.right, top: t.top, bottom: t.bottom, width: t.w, color: t.c, '--r': `${t.r ?? 0}deg`, animationDuration: `${t.dur}s`, animationDelay: `${t.delay}s` }}>{t.el}</div>)}
          <div className="rt-scan" />
        </>) : null}
        {skin === 'nube' ? (<>
          {BLOBS.map((b, i) => <div key={`b${i}`} className="cd-blob" style={{ left: b.left, top: b.top, width: b.w, height: b.h, '--c': `var(--cd-${b.c})`, '--dx': `${b.dx}px`, '--dy': `${b.dy}px`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }} />)}
          <SweetDefs />
          {SWEETS.map((t, i) => <div key={`s${i}`} className="cd-candy" style={{ left: t.left, right: t.right, top: t.top, bottom: t.bottom, width: t.w, '--r': `${t.r ?? 0}deg`, animationDuration: `${t.dur}s`, animationDelay: `${t.delay}s` }}>{t.el}</div>)}
        </>) : null}
      </div>
      <div className="scene-veil" />
    </div>
  );
}
