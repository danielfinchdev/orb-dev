// 2.6: the illustrated backdrop of each visual theme, behind the screens (themes.css draws and moves it; it is blurred and
// veiled at the top so it never competes with the text). Nothing in the «profesional» theme.
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

// Candy bubbles: where they rise, their size, speed and tint (hue).
const BUBBLES = [
  { left: '6%', size: 70, dur: 26, delay: -4, h: 330 }, { left: '18%', size: 34, dur: 19, delay: -12, h: 270 }, { left: '30%', size: 96, dur: 34, delay: -20, h: 190 },
  { left: '44%', size: 44, dur: 23, delay: -2, h: 20 }, { left: '57%', size: 82, dur: 30, delay: -16, h: 300 }, { left: '70%', size: 38, dur: 21, delay: -9, h: 160 },
  { left: '82%', size: 64, dur: 28, delay: -24, h: 340 }, { left: '92%', size: 30, dur: 17, delay: -6, h: 250 }, { left: '38%', size: 26, dur: 15, delay: -11, h: 45 },
  { left: '64%', size: 20, dur: 14, delay: -3, h: 200 }, { left: '12%', size: 24, dur: 16, delay: -8, h: 290 }, { left: '76%', size: 52, dur: 25, delay: -19, h: 10 }
];
const CLOUDS = [{ width: 520, dur: 90, delay: -10, bottom: -40 }, { width: 380, dur: 70, delay: -45, bottom: -20 }, { width: 600, dur: 110, delay: -70, bottom: -60 }];

export function Scene() {
  const skin = useStore((s) => s.app?.config?.ui?.skin) ?? 'orb';
  if (skin === 'profesional') return null;
  return (
    <div className={`scene scene-${skin}`} aria-hidden="true" data-testid="scene">
      <div className="scene-blur">
        {skin === 'orb' ? CLOUDS.map((c, i) => <div key={i} className="orb-cloud" style={{ top: `${18 + i * 26}%`, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />) : null}
        {skin === 'vaporwave' ? (<>
          <div className="vw-sun" />
          <div className="vw-floor" />
          <Palm className="vw-palm left" /><Palm className="vw-palm right" />
        </>) : null}
        {skin === 'retro' ? (<>
          <div className="rt-stars s1" /><div className="rt-stars s2" /><div className="rt-stars s3" />
          <div className="rt-fleet" /><div className="rt-ground" /><div className="rt-ship" /><div className="rt-scan" />
        </>) : null}
        {skin === 'nube' ? (<>
          {CLOUDS.map((c, i) => <div key={`c${i}`} className="cd-cloud" style={{ width: c.width, bottom: c.bottom, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />)}
          {BUBBLES.map((b, i) => <div key={i} className="cd-bubble" style={{ left: b.left, width: b.size, height: b.size, '--h': b.h, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }} />)}
        </>) : null}
      </div>
      <div className="scene-veil" />
    </div>
  );
}
