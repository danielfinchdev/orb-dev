// 3.6: a bot's avatar (docs/DESIGN-SYSTEM.md › 2.5): one of the family's soft bodies in its colour with Orb's two-stroke
// eyes, drawn as SVG from src/core/avatar.mjs (the same data the engine checks), sharp from 20 to 160 px. state: idle
// (breathes, blinks, looks around), message (bounce), working (wiggle, eyes up), paused (flat eyes, «z»), happy (hop,
// arched eyes). Still with «reducir movimiento», with Ajustes › movimiento mínimo, or with still. chief: a small star.
// GroupAvatar: a group as up to three of its members together.
import { useId } from 'react';
import { Users } from 'lucide-react';
import { avatarParts, avatarOf, hash, SHAPES, COLORS } from '../../core/avatar.mjs';
import { cn } from '@/lib/utils.js';

function Star({ size }) {
  const s = Math.max(12, Math.round(size * 0.34));
  return (
    <span className="bav-chief" style={{ width: s, height: s }} data-testid="avatar-chief" aria-hidden="true">
      <svg viewBox="0 0 24 24" style={{ width: s * 0.68, height: s * 0.68 }}><path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
    </span>
  );
}

export function BotAvatar({ bot, shape, color, size = 40, state = 'idle', still = false, chief = false, label, className, style, ...rest }) {
  const uid = useId().replace(/[^\w-]/g, '');
  const a = shape && color ? { shape: SHAPES[shape] ? shape : 'mochi', color: COLORS[color] != null ? color : 'cielo' } : avatarOf(bot);
  const p = avatarParts(a.shape, a.color, state);
  const r = hash(`${a.shape}${a.color}${bot?.id ?? ''}`);
  const timing = { '--bav-blink': `${-((r % 4000) / 1000)}s`, '--bav-look': `${-(((r >> 8) % 7000) / 1000)}s` };
  return (
    <span className={cn('bav-wrap', size < 28 && 'bav-small', className)} style={{ width: size, height: size, ...style }} data-avatar={`${a.shape}:${a.color}`} data-state={state}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} {...rest}>
      <svg className={cn('bav', still && 'bav-still')} data-state={state} width={size} height={size} viewBox="0 0 100 100" style={{ ...timing, width: size, height: size }} focusable="false">
        <defs><linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={p.top} /><stop offset="1" stopColor={p.bottom} /></linearGradient></defs>
        <ellipse className="bav-shadow" cx="50" cy="94" rx="24" ry="3.2" fill={p.shadow} opacity=".14" />
        <g className="bav-body">
          <path d={p.d} fill={`url(#g${uid})`} />
          <ellipse cx={p.shine.cx} cy={p.shine.cy} rx="6.5" ry="3.6" fill="#fff" opacity=".5" transform={`rotate(-24 ${p.shine.cx} ${p.shine.cy})`} />
          <g className="bav-eyes">
            {p.eyes.map((e, i) => (e.kind === 'open'
              ? <g key={i} className="bav-eye" style={{ transformOrigin: `${e.cx}px ${e.cy}px` }}><path d={e.d} stroke={p.ink} strokeWidth={e.width} strokeLinecap="round" transform={`rotate(${e.tilt} ${e.cx} ${e.cy})`} /></g>
              : <path key={i} d={e.d} fill="none" stroke={p.ink} strokeWidth={e.width} strokeLinecap="round" />))}
          </g>
          {p.z ? <text className="bav-z" x={p.z.x} y={p.z.y} fontSize="13" fontWeight="700" fill={p.ink} opacity=".55" fontFamily="system-ui">z</text> : null}
        </g>
      </svg>
      {chief ? <Star size={size} /> : null}
    </span>
  );
}

// A group: one member fills it, two sit side by side (one higher), three in a small triangle; none: the people icon.
const SPOTS = { 1: [[0, 0, 1]], 2: [[0, 0.04, 0.64], [0.36, 0.32, 0.64]], 3: [[0.21, 0, 0.58], [0, 0.42, 0.58], [0.42, 0.42, 0.58]] };
export function GroupAvatar({ members = [], states = {}, size = 40, label, className, ...rest }) {
  const list = members.filter(Boolean).slice(0, 3);
  const aria = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  if (!list.length) {
    return <span className={cn('bg-primary/10 text-primary grid shrink-0 place-items-center rounded-full', className)} style={{ width: size, height: size }} data-testid="group-avatar" {...aria} {...rest}><Users className="size-auto" style={{ width: size * 0.45, height: size * 0.45 }} /></span>;
  }
  const spots = SPOTS[list.length];
  return (
    <span className={cn('bav-group relative shrink-0', className)} style={{ width: size, height: size }} data-testid="group-avatar" data-members={list.length} {...aria} {...rest}>
      {list.map((b, i) => {
        const [x, y, k] = spots[i];
        const s = states[b.id];
        return <BotAvatar key={b.id ?? i} bot={b} size={Math.round(size * k)} state={b.paused ? 'paused' : s?.busy ? 'working' : 'idle'} still={!s?.busy} style={{ position: 'absolute', left: x * size, top: y * size }} />;
      })}
    </span>
  );
}
