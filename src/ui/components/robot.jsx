// The assistant's face: always the same robot, the one of the artwork (docs/diseno/art work), brought to life by orb.jsx.
// Small sizes show the head; bigger ones the whole robot, in the pose that fits the mood: standing, thinking with a hand
// on its chin, pointing when happy, waving to say hello. Moods: idle, thinking (code on the visor), talking, happy (^ ^),
// worried (sad brows), sleeping (eyes shut, breathing).
import { Orb } from './orb.jsx';

const POSE = { hello: 'wave' }; // the rest follows the mood (orb.jsx keeps pose and face coherent)

// head: only the helmet, by default under 56 px. size: the width it takes (the whole robot is a bit narrower than tall).
// live: this one does little things on its own now and then (keep it to the one robot in view).
export function Robot({ size = 48, mood = 'idle', className, title = 'Orb', still = false, head = size < 56, pose, live = false, gesture, onPoke }) {
  return (
    <Orb pose={head ? 'head' : pose ?? POSE[mood] ?? 'stand'} size={head ? size : Math.round(size * 0.8)} mood={mood === 'hello' ? 'idle' : mood}
      title={title} still={still} live={live} gesture={gesture} onPoke={onPoke} className={className} />
  );
}
