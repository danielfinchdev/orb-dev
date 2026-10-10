// The little pictures of the game cards: one vector per game, painted with the theme's colours (CSS variables).
import { Piece } from './chess-pieces.jsx';

const P = 'var(--primary)'; const FG = 'var(--foreground)'; const WARN = 'var(--warning)'; const DANGER = 'var(--destructive)'; const INFO = 'var(--info)'; const OK = 'var(--success)'; const CARD = 'var(--card)';
const Box = ({ children }) => <svg viewBox="0 0 120 80" className="h-full w-full" aria-hidden="true">{children}</svg>;

export const THUMBS = {
  snake: () => (
    <Box>
      <path d="M18 56c0-14 12-14 22-14s20 0 20-12 14-14 24-12" fill="none" stroke={P} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
      <path d="M18 56c0-14 12-14 22-14s20 0 20-12 14-14 24-12" fill="none" stroke={CARD} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".35" />
      <circle cx="84" cy="18" r="7" fill={P} />
      <circle cx="86.5" cy="15" r="2.2" fill="#fff" /><circle cx="87.3" cy="15" r="1.1" fill="#1a1a2e" />
      <circle cx="86.5" cy="21.5" r="2.2" fill="#fff" /><circle cx="87.3" cy="21.5" r="1.1" fill="#1a1a2e" />
      <circle cx="104" cy="22" r="5.5" fill={WARN} /><path d="M104 16c1-2.5 3-3.5 5-3.5" stroke={OK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </Box>
  ),
  tetris: () => (
    <Box>
      {[[30, 60, INFO], [44, 60, INFO], [58, 60, INFO], [72, 60, INFO], [30, 46, WARN], [44, 46, WARN], [44, 32, WARN], [58, 46, OK], [72, 46, OK], [72, 32, OK], [86, 46, DANGER], [86, 60, DANGER]].map(([x, y, c], i) => (
        <g key={i}><rect x={x} y={y} width="13" height="13" rx="2.5" fill={c} /><rect x={x + 2} y={y + 2} width="9" height="3" rx="1" fill="#fff" opacity=".45" /></g>
      ))}
      {[[58, 10], [58, 24], [72, 24], [44, 24]].map(([x, y], i) => <g key={i}><rect x={x} y={y} width="13" height="13" rx="2.5" fill={P} /><rect x={x + 2} y={y + 2} width="9" height="3" rx="1" fill="#fff" opacity=".45" /></g>)}
    </Box>
  ),
  chess: () => (
    <div className="relative h-full w-full">
      <Box>
        <rect x="32" y="8" width="64" height="64" rx="5" fill="color-mix(in oklab, var(--primary) 14%, #5e4330)" />
        {Array.from({ length: 16 }, (_, i) => <rect key={i} x={36 + (i % 4) * 14} y={12 + Math.floor(i / 4) * 14} width="14" height="14" fill={(i + Math.floor(i / 4)) % 2 ? 'color-mix(in oklab, var(--primary) 15%, #b58b61)' : 'color-mix(in oklab, var(--primary) 6%, #f2e4cb)'} />)}
      </Box>
      <div className="absolute inset-0 flex items-center justify-center gap-[2%]">
        <Piece code="N" size={48} className="drop-shadow-[0_3px_3px_rgb(60_30_10/0.4)]" style={{ width: '40%', height: 'auto' }} />
        <Piece code="q" size={40} className="drop-shadow-[0_3px_3px_rgb(60_30_10/0.4)] -ml-[8%] mt-[10%]" style={{ width: '32%', height: 'auto' }} />
      </div>
    </div>
  ),
  runner: () => (
    <Box>
      <defs>
        <linearGradient id="thumb-jumper-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={`color-mix(in oklab, ${P} 10%, #0d1020)`} /><stop offset="1" stopColor={`color-mix(in oklab, ${P} 55%, #0d1020)`} /></linearGradient>
        <linearGradient id="thumb-jumper-glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P} stopOpacity="0" /><stop offset="1" stopColor={P} stopOpacity=".55" /></linearGradient>
      </defs>
      <rect x="0" y="0" width="120" height="80" fill="url(#thumb-jumper-sky)" />
      <path d="M-10 60l22-26 22 26zM52 60l26-34 26 34zM96 60l18-20 18 20z" fill={`color-mix(in oklab, ${P} 30%, #0d1020)`} opacity=".8" />
      <rect x="0" y="48" width="120" height="12" fill="url(#thumb-jumper-glow)" />
      <rect x="0" y="60" width="120" height="20" fill={`color-mix(in oklab, ${P} 18%, #0d1020)`} />
      {[12, 28, 44, 60, 76, 92, 108].map((x) => <rect key={x} x={x} y="60" width="1" height="20" fill="#fff" opacity=".12" />)}
      <rect x="0" y="59" width="120" height="2" fill={`color-mix(in oklab, ${P} 45%, #fff)`} />
      <path d="M70 60l8-13 8 13zM86 60l8-13 8 13z" fill={`color-mix(in oklab, ${P} 14%, #0d1020)`} stroke={`color-mix(in oklab, ${P} 45%, #fff)`} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="104" y="44" width="18" height="16" rx="2" fill={`color-mix(in oklab, ${P} 26%, #0d1020)`} stroke={`color-mix(in oklab, ${P} 45%, #fff)`} strokeWidth="1.6" />
      {[[8, 46, 2.5], [14, 44, 3.2], [20, 41.5, 4]].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} fill={`color-mix(in oklab, ${P} 55%, #fff)`} opacity={r / 8} />)}
      <g transform="rotate(-18 36 38)">
        <rect x="26" y="28" width="20" height="20" rx="2.5" fill={P} />
        <rect x="29.5" y="31.5" width="13" height="13" rx="1" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.8" />
        <rect x="31" y="34" width="4" height="5" rx="1" fill="#fff" /><rect x="37" y="34" width="4" height="5" rx="1" fill="#fff" />
        <rect x="32.5" y="35.5" width="2" height="2.5" fill="#16162a" /><rect x="38.5" y="35.5" width="2" height="2.5" fill="#16162a" />
        <path d="M33 42.5q3 2 6 0" stroke="#16162a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
    </Box>
  ),
  g2048: () => (
    <Box>
      {[[32, 14, '2', 10], [62, 14, '4', 20], [32, 44, '8', 34], [62, 44, '16', 50]].map(([x, y, n, k]) => (
        <g key={n}><rect x={x} y={y} width="26" height="26" rx="5" fill={`color-mix(in oklab, ${P} ${k}%, ${CARD})`} /><text x={x + 13} y={y + 17.5} textAnchor="middle" fontSize="12" fontWeight="700" fill={k >= 66 ? 'var(--primary-foreground)' : FG} fontFamily="inherit">{n}</text></g>
      ))}
    </Box>
  ),
  breakout: () => (
    <Box>
      {[DANGER, WARN, OK, INFO].map((c, r) => Array.from({ length: 5 }, (_, i) => <rect key={`${r}-${i}`} x={22 + i * 16} y={10 + r * 9} width="14" height="7" rx="1.5" fill={c} />))}
      <rect x="44" y="66" width="32" height="5" rx="2.5" fill={P} />
      <circle cx="64" cy="56" r="4" fill={FG} /><circle cx="60" cy="50" r="2.5" fill={FG} opacity=".25" />
    </Box>
  )
};
