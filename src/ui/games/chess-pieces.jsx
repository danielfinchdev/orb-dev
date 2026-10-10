// The chess pieces, drawn here as simple clean vectors (45x45 box). White pieces are ivory with a dark outline; black
// pieces are charcoal with light detail lines, so both read well on the light and dark squares of every theme.
const WHITE = { fill: '#f7f3ea', stroke: '#2a2a3a', detail: '#2a2a3a' };
const BLACK = { fill: '#2c2c3a', stroke: '#15151f', detail: '#c9c9d8' };

const Base = ({ c }) => <path d="M11 35.5h23a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5H11A1.5 1.5 0 0 1 9.5 38v-1a1.5 1.5 0 0 1 1.5-1.5z" fill={c.fill} stroke={c.stroke} />;

const SHAPES = {
  p: (c) => (
    <>
      <path d="M22.5 9.5a4.4 4.4 0 0 1 2.4 8.1c2.6 1 4.3 3.3 4.3 6 0 1.6-.6 3.1-1.6 4.3 3.9 1.5 6.4 4.5 6.4 7.6H11c0-3.1 2.5-6.1 6.4-7.6a6.3 6.3 0 0 1-1.6-4.3c0-2.7 1.7-5 4.3-6a4.4 4.4 0 0 1 2.4-8.1z" fill={c.fill} stroke={c.stroke} />
      <Base c={c} />
    </>
  ),
  r: (c) => (
    <>
      <path d="M12 17V9.5h4.5v3h4v-3h4v3h4v-3H33V17l-2 2.5v12L33 34H12l2-2.5v-12z" fill={c.fill} stroke={c.stroke} strokeLinejoin="round" />
      <path d="M14 19.5h17M14 31.5h17M12 17h21" stroke={c.detail} fill="none" />
      <Base c={c} />
    </>
  ),
  n: (c) => (
    <>
      <path d="M13 34.5c-.5-6 1.5-10.5 4.5-13.5-1.5-.5-3-1-4.5-2.2-1 .6-2 .4-2.6-.6.8-1.6 2.3-3.4 3.6-4.7l.6-3.4 2.6 1.9c1.2-.6 2.6-1 4-1l1.4-2.5 1.6 2.8c6.4 1.4 9.6 6.7 9.6 14.5v8.7z" fill={c.fill} stroke={c.stroke} strokeLinejoin="round" />
      <path d="M12.5 19.2l-1.7 1M24 14.5c3.8 1.3 6 4.7 6 10" stroke={c.detail} fill="none" strokeLinecap="round" />
      <circle cx="22.4" cy="15.6" r="1.1" fill={c.detail} />
      <path d="M13.9 16.8c.5.3 1.1.3 1.6 0" stroke={c.detail} fill="none" strokeLinecap="round" />
      <Base c={c} />
    </>
  ),
  b: (c) => (
    <>
      <circle cx="22.5" cy="8.4" r="2.3" fill={c.fill} stroke={c.stroke} />
      <path d="M22.5 11c5.2 3.4 8.3 8 8.3 13.1 0 3.5-2 6.4-5.3 7.4h-6c-3.3-1-5.3-3.9-5.3-7.4 0-5.1 3.1-9.7 8.3-13.1z" fill={c.fill} stroke={c.stroke} />
      <path d="M22.5 16.5v9M18.8 21.5h7.4" stroke={c.detail} fill="none" strokeLinecap="round" />
      <path d="M16 31.5h13l1.2 3H14.8z" fill={c.fill} stroke={c.stroke} strokeLinejoin="round" />
      <Base c={c} />
    </>
  ),
  q: (c) => (
    <>
      <path d="M12 34.5l-2.6-18 5.6 8.3 1.4-13.6 4.9 12.6 1.2-15 1.2 15 4.9-12.6 1.4 13.6 5.6-8.3-2.6 18z" fill={c.fill} stroke={c.stroke} strokeLinejoin="round" />
      {[[9.4, 16.3], [16.4, 11], [22.5, 8.5], [28.6, 11], [35.6, 16.3]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.9" fill={c.fill} stroke={c.stroke} />)}
      <path d="M12.6 29.5h19.8M13.2 32.5h18.6" stroke={c.detail} fill="none" />
      <Base c={c} />
    </>
  ),
  k: (c) => (
    <>
      <path d="M22.5 4.5v7.5M19.3 8h6.4" stroke={c.stroke} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M12.5 34.5l1.2-11c.6-5.5 4.4-9.3 8.8-9.3s8.2 3.8 8.8 9.3l1.2 11z" fill={c.fill} stroke={c.stroke} strokeLinejoin="round" />
      <path d="M22.5 14.2c-3 0-5.4 2.6-5.4 6.2 0 2.1.9 4 2.4 5.1h6c1.5-1.1 2.4-3 2.4-5.1 0-3.6-2.4-6.2-5.4-6.2z" fill="none" stroke={c.detail} />
      <path d="M13.3 29.5h18.4" stroke={c.detail} fill="none" />
      <Base c={c} />
    </>
  )
};

// <Piece code="N" />: upper case white, lower case black.
export function Piece({ code, size = 44, className, style }) {
  const c = code === code.toUpperCase() ? WHITE : BLACK;
  return (
    <svg viewBox="0 0 45 45" width={size} height={size} className={className} style={style} aria-hidden="true" strokeWidth="1.3" strokeLinejoin="round">
      {SHAPES[code.toLowerCase()](c)}
    </svg>
  );
}
