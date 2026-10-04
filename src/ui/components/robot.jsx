// The assistant's face: a small white astronaut-like robot (round helmet, glossy blue visor with mint eyes, blue ear
// pods, a button on top, waving hand). Drawn in SVG; the same drawing is the app icon. Moods: idle (floats, blinks, waves
// a little), thinking (looks up, dots), talking (mouth), happy (^ ^, big wave), worried (amber eyes, sweat), sleeping.
import { useId } from 'react';
import { cn } from '@/lib/utils.js';

// head: only the helmet (the same robot's face) — used at small sizes, where the whole body would be a speck, and as the
// app icon. By default under 56 px.
export function Robot({ size = 48, mood = 'idle', className, title = 'Orb', still = false, head = size < 56 }) {
  const id = useId().replace(/[^\w-]/g, '');
  const u = (name) => `url(#${id}-${name})`;
  const d = (name) => `${id}-${name}`;
  return (
    <span className={cn('bot', mood, still && 'still', className)} title={title} role="img" aria-label={title}>
      <svg viewBox={head ? '4 2 112 94' : '0 0 120 140'} width={size} height={head ? (size * 94) / 112 : (size * 140) / 120}>
        <defs>
          <radialGradient id={d('white')} cx="0.38" cy="0.3" r="0.85"><stop offset="0" stopColor="#ffffff" /><stop offset="0.62" stopColor="#f3f6fe" /><stop offset="1" stopColor="#c9d4f4" /></radialGradient>
          <radialGradient id={d('visor')} cx="0.42" cy="0.32" r="0.9"><stop offset="0" stopColor="#3156d8" /><stop offset="0.55" stopColor="#18298a" /><stop offset="1" stopColor="#0b1450" /></radialGradient>
          <radialGradient id={d('ear')} cx="0.4" cy="0.35" r="0.8"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#b9c9f5" /></radialGradient>
          <linearGradient id={d('blue')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6ea1ff" /><stop offset="1" stopColor="#3466e6" /></linearGradient>
          <filter id={d('glow')} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.8" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {head ? null : <ellipse className="b-shadow" cx="60" cy="135" rx="24" ry="3.5" fill="#3a4fb8" />}
        <g className="b-float">
          {head ? null : (<>
          {/* legs */}
          <rect x="44" y="112" width="14" height="20" rx="7" fill={u('white')} />
          <rect x="62" y="112" width="14" height="20" rx="7" fill={u('white')} />
          <path d="M45 128 h12 M63 128 h12" stroke="#9fb4ef" strokeWidth="2" strokeLinecap="round" />
          {/* left arm, stretched out */}
          <g className="b-arm-l">
            <rect x="18" y="96" width="26" height="11" rx="5.5" fill={u('white')} transform="rotate(14 40 101)" />
            <circle cx="20" cy="96" r="6.5" fill={u('white')} />
          </g>
          {/* body */}
          <ellipse cx="60" cy="106" rx="19" ry="16" fill={u('white')} />
          <circle cx="44" cy="100" r="4.2" fill={u('blue')} />
          <circle cx="76" cy="100" r="4.2" fill={u('blue')} />
          <ellipse cx="60" cy="111" rx="6" ry="2.4" fill="#cfdaf7" />
          {/* right arm, waving: the open hand sits beside the helmet */}
          <g className="b-arm-r">
            <path d="M78 99 L96 84" stroke={u('white')} strokeWidth="11" strokeLinecap="round" />
            <path d="M78 99 L96 84" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" opacity=".9" />
            <ellipse cx="94.2" cy="71" rx="2.5" ry="4.6" transform="rotate(-14 94.2 71)" fill={u('white')} stroke="#d3ddf7" strokeWidth=".7" />
            <ellipse cx="99.5" cy="69" rx="2.6" ry="4.9" fill={u('white')} stroke="#d3ddf7" strokeWidth=".7" />
            <ellipse cx="104.6" cy="71" rx="2.5" ry="4.6" transform="rotate(14 104.6 71)" fill={u('white')} stroke="#d3ddf7" strokeWidth=".7" />
            <ellipse cx="91" cy="79" rx="2.4" ry="4" transform="rotate(-50 91 79)" fill={u('white')} stroke="#d3ddf7" strokeWidth=".7" />
            <ellipse cx="99.5" cy="78.5" rx="7.4" ry="7.6" fill={u('white')} />
          </g>
          {/* neck joint */}
          <ellipse cx="60" cy="90" rx="9" ry="3.5" fill={u('blue')} />
          </>)}
          {/* helmet */}
          <circle cx="60" cy="50" r="41" fill={u('white')} />
          {/* top button */}
          <rect x="51" y="5" width="18" height="11" rx="5" fill={u('white')} />
          <circle className="b-glow" cx="60" cy="10.5" r="3.4" fill="#3d82f0" />
          {/* ear pods */}
          <g><ellipse cx="16" cy="54" rx="9" ry="13" fill={u('ear')} /><ellipse cx="14.5" cy="54" rx="3.5" ry="6" fill="none" stroke="#5b8ff5" strokeWidth="2" /></g>
          <g><ellipse cx="104" cy="54" rx="9" ry="13" fill={u('ear')} /><ellipse cx="105.5" cy="54" rx="3.5" ry="6" fill="none" stroke="#5b8ff5" strokeWidth="2" /></g>
          {/* visor */}
          <rect x="25" y="27" width="70" height="50" rx="23" fill="#2c4fd6" />
          <rect x="26.5" y="28.5" width="67" height="47" rx="21.5" fill={u('visor')} />
          <path d="M77 33 l8 2 l-2 7 l-8 -2z" fill="#fff" opacity=".8" />
          <ellipse cx="44" cy="35" rx="11" ry="3" fill="#fff" opacity=".1" />
          {/* eyes */}
          <g className="b-eyes" filter={u('glow')}>
            <rect className="b-eye" x="43" y="43" width="8" height="17" rx="4" fill="var(--bot-eye)" />
            <rect className="b-eye" x="69" y="43" width="8" height="17" rx="4" fill="var(--bot-eye)" />
          </g>
          <g className="b-x b-happy-eyes" filter={u('glow')}>
            <path d="M41 55 q6 -9 12 0 M67 55 q6 -9 12 0" stroke="var(--bot-eye)" strokeWidth="3.6" fill="none" strokeLinecap="round" />
          </g>
          <g className="b-x b-closed"><path d="M41 53 q6 4 12 0 M67 53 q6 4 12 0" stroke="var(--bot-eye)" strokeWidth="3" fill="none" strokeLinecap="round" /></g>
          {/* mouths (only some moods) */}
          <path className="b-x b-smile" d="M55 66 q5 4 10 0" stroke="var(--bot-eye)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <ellipse className="b-x b-talk" cx="60" cy="67" rx="4.2" ry="3" fill="var(--bot-eye)" />
          <path className="b-x b-flat" d="M56 67 h8" stroke="var(--bot-eye)" strokeWidth="2.6" strokeLinecap="round" />
          <path className="b-x b-frown" d="M55 69 q5 -4 10 0" stroke="var(--bot-eye)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          {/* extras */}
          <path className="b-x b-sweat" d="M96 22 q4 7 0 9 q-4 -2 0 -9z" fill="#8fd3ff" />
          <g className="b-x b-dots" fill="#6f8ef5"><circle cx="99" cy="14" r="3" /><circle cx="107" cy="8" r="3.4" /><circle cx="115" cy="2" r="3.8" /></g>
          <g className="b-x b-sparkle" fill="#ffd36e"><path d="M104 26 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" /><path d="M14 22 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4z" /></g>
          <text className="b-x b-zz" x="98" y="20" fontSize="17" fontWeight="600" fill="#6f8ef5" fontFamily="Outfit Variable, sans-serif">z</text>
        </g>
      </svg>
    </span>
  );
}
