// The assistant's face: always the same robot, the one of the artwork (docs/diseno/art work), brought to life by orb.jsx.
// Small sizes show the head; bigger ones the whole robot, in the pose that fits the mood: standing, thinking with a hand
// on its chin, pointing when happy, waving to say hello. Moods: idle, thinking (code on the visor), talking, happy (^ ^),
// worried (sad brows), sleeping (eyes shut, breathing).
// The «profesional» visual theme (Ajustes → Apariencia) has no robot: a plain round «O» mark takes its place.
import { Orb } from './orb.jsx';
import { useStore } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';

const POSE = { hello: 'wave' }; // the rest follows the mood (orb.jsx keeps pose and face coherent)

// head: only the helmet, by default under 56 px. size: the width it takes (the whole robot is a bit narrower than tall).
// live: this one does little things on its own now and then (keep it to the one robot in view).
export function Robot({ size = 48, mood = 'idle', className, title = 'Orb', still = false, head = size < 56, pose, live = false, gesture, onPoke }) {
  const skin = useStore((s) => s.app?.config?.ui?.skin);
  if (skin === 'profesional') return <Mark size={head ? size : Math.round(Math.min(72, Math.max(44, size * 0.5)))} title={title} className={className} />;
  return (
    <Orb pose={head ? 'head' : pose ?? POSE[mood] ?? 'stand'} size={head ? size : Math.round(size * 0.8)} mood={mood === 'hello' ? 'idle' : mood}
      title={title} still={still} live={live} gesture={gesture} onPoke={onPoke} className={className} />
  );
}

// The sober stand-in: a circle with the «O» of Orb in the primary colour, the size of the robot's head.
function Mark({ size, title, className }) {
  return (
    <span role="img" aria-label={title} title={title} style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.46)) }}
      className={cn('bg-card text-primary border-primary/30 inline-grid shrink-0 place-items-center rounded-full border leading-none font-semibold select-none', className)}>
      O
    </span>
  );
}
