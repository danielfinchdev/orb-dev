// 2.6: the illustrated backdrop of each visual theme, behind the screens (themes.css draws and moves it; it sits under a
// veil at the top so it never competes with the text). Nothing in the «profesional» theme.
import { useStore } from '@/lib/store.js';

// A palm silhouette (Vaporwave).
const Palm = ({ className }) => (
  <svg className={className} viewBox="0 0 120 200" fill="currentColor" aria-hidden="true">
    <path d="M60 196c-3 0-5-2-5-5 2-40 6-80 14-118l6 1c-7 38-11 77-11 117 0 3-2 5-4 5z" />
    <path d="M70 70c-18-22-44-28-66-20 22-2 42 6 56 24z" />
    <path d="M72 66c-6-26-26-44-50-48 20 10 34 28 40 50z" />
    <path d="M74 64c8-24 30-40 54-40-22 8-38 24-46 44z" />
    <path d="M74 70c22-14 46-14 62-2-20-6-40-4-58 8z" />
    <path d="M72 72c10 20 10 42 0 60 6-20 4-40-6-58z" />
  </svg>
);

const ORB_CLOUDS = [{ dur: 90, delay: -10 }, { dur: 70, delay: -45 }, { dur: 110, delay: -70 }];
// Candy: the pastel blobs (colour, place, size, how far they drift, how long) and the clay toys floating among them.
const BLOBS = [
  { c: 'pink', left: '-8%', top: '-12%', w: 620, h: 480, dx: 50, dy: 30, dur: 34, delay: -6 },
  { c: 'lilac', left: '58%', top: '-18%', w: 640, h: 520, dx: -40, dy: 40, dur: 40, delay: -18 },
  { c: 'mint', left: '-10%', top: '52%', w: 560, h: 460, dx: 60, dy: -30, dur: 38, delay: -25 },
  { c: 'peach', left: '62%', top: '58%', w: 560, h: 440, dx: -50, dy: -40, dur: 44, delay: -12 },
  { c: 'sky', left: '28%', top: '70%', w: 520, h: 380, dx: 30, dy: -50, dur: 36, delay: -30 }
];
const TOYS = [
  { kind: 'cloud', c: 'sky', left: '4%', top: '16%', w: 190, h: 70, dur: 13, delay: -2 },
  { kind: 'sphere', c: 'pink', left: '86%', top: '18%', w: 84, h: 84, dur: 11, delay: -5 },
  { kind: 'ring', c: 'mint', left: '8%', top: '62%', w: 120, h: 120, r: 12, dur: 15, delay: -8 },
  { kind: 'pill', c: 'peach', left: '80%', top: '64%', w: 150, h: 54, r: -22, dur: 12, delay: -4 },
  { kind: 'cube', c: 'lilac', left: '42%', top: '4%', w: 64, h: 64, r: 14, dur: 14, delay: -9 },
  { kind: 'cloud', c: 'pink', left: '62%', top: '86%', w: 260, h: 90, dur: 16, delay: -11 },
  { kind: 'sphere', c: 'sky', left: '24%', top: '88%', w: 48, h: 48, dur: 10, delay: -1 }
];

export function Scene() {
  const skin = useStore((s) => s.app?.config?.ui?.skin) ?? 'orb';
  if (skin === 'profesional') return null;
  return (
    <div className={`scene scene-${skin}`} aria-hidden="true" data-testid="scene">
      <div className="scene-blur">
        {skin === 'orb' ? ORB_CLOUDS.map((c, i) => <div key={i} className="orb-cloud" style={{ top: `${18 + i * 26}%`, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />) : null}
        {skin === 'vaporwave' ? (<>
          <div className="vw-stars" />
          <div className="vw-glow" /><div className="vw-sun" />
          <div className="vw-mount back" /><div className="vw-mount front" />
          <div className="vw-floor" />
          <Palm className="vw-palm left" /><Palm className="vw-palm right" />
        </>) : null}
        {skin === 'retro' ? (<>
          <div className="rt-stars s1" /><div className="rt-stars s2" /><div className="rt-stars s3" />
          <div className="rt-planet" /><div className="rt-fleet" /><div className="rt-ground" /><div className="rt-ship" /><div className="rt-scan" />
        </>) : null}
        {skin === 'nube' ? (<>
          {BLOBS.map((b, i) => <div key={`b${i}`} className="cd-blob" style={{ left: b.left, top: b.top, width: b.w, height: b.h, '--c': `var(--cd-${b.c})`, '--dx': `${b.dx}px`, '--dy': `${b.dy}px`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }} />)}
          {TOYS.map((t, i) => <div key={`t${i}`} className={`cd-toy ${t.kind}`} style={{ left: t.left, top: t.top, width: t.w, height: t.h, '--c': `var(--cd-${t.c})`, '--r': `${t.r ?? 0}deg`, animationDuration: `${t.dur}s`, animationDelay: `${t.delay}s` }} />)}
        </>) : null}
      </div>
      <div className="scene-veil" />
    </div>
  );
}
