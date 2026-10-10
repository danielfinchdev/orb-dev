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
        {Array.from({ length: 16 }, (_, i) => <rect key={i} x={36 + (i % 4) * 12} y={16 + Math.floor(i / 4) * 12} width="12" height="12" fill={P} opacity={(i + Math.floor(i / 4)) % 2 ? 0.45 : 0.12} />)}
      </Box>
      <div className="absolute inset-0 grid place-items-center"><Piece code="N" size={46} className="drop-shadow-[0_3px_3px_rgb(0_0_0/0.35)]" style={{ width: '38%', height: 'auto' }} /></div>
    </div>
  ),
  runner: () => (
    <Box>
      <path d="M0 62h120" stroke={P} strokeWidth="2.5" />
      <path d="M62 62l7-14 7 14zM78 62l7-14 7 14z" fill={DANGER} />
      <rect x="100" y="48" width="16" height="14" rx="2" fill={INFO} />
      <g transform="rotate(-18 36 36)"><rect x="24" y="24" width="24" height="24" rx="5" fill={P} /><rect x="27" y="27" width="18" height="4" rx="2" fill="#fff" opacity=".45" /><rect x="31" y="32" width="10" height="9" rx="2.5" fill="#fff" /><rect x="35" y="34" width="4" height="5" rx="1.5" fill="#1a1a2e" /></g>
      <circle cx="18" cy="44" r="3" fill={P} opacity=".35" /><circle cx="10" cy="50" r="2" fill={P} opacity=".2" />
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
