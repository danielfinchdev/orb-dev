// The assistant's face: always the same robot, the one of the artwork (docs/diseno/art work), brought to life by orb.jsx.
// Small sizes show the head; bigger ones the whole robot, in the pose that fits the mood: standing, thinking with a hand
// on its chin, pointing when happy, waving to say hello. Moods: idle, thinking (code on the visor), talking, happy (^ ^),
// worried (sad brows), sleeping (eyes shut, breathing).
// Only the «orb» visual theme (Ajustes → Apariencia) has the robot; in the others nothing is drawn, except where `mark` asks for the
// app icon to stand in (the identity spots: sidebar, chat head, greeting), at that size or at the robot's own.
import { Orb } from './orb.jsx';
import { OrbMark } from './orb-mark.jsx';
import { useStore, robotSkin } from '@/lib/store.js';

const POSE = { hello: 'wave' }; // the rest follows the mood (orb.jsx keeps pose and face coherent)

// head: only the helmet, by default under 56 px. size: the width it takes (the whole robot is a bit narrower than tall).
// live: this one does little things on its own now and then (keep it to the one robot in view).
// skin: for windows without the store (the browser's little window gets it from the main process).
// active: something is going on that the mood does not show (agents working): it floats meanwhile.
export function Robot({ size = 48, mood = 'idle', className, title = 'Orb', still = false, head = size < 56, pose, live = false, active = false, gesture, onPoke, skin: given, mark }) {
  const stored = useStore((s) => s.app?.config?.ui?.skin);
  const skin = given ?? stored;
  if (!robotSkin(skin)) return mark ? <OrbMark size={mark === true ? size : mark} className={className} /> : null;
  return (
    <Orb pose={head ? 'head' : pose ?? POSE[mood] ?? 'stand'} size={head ? size : Math.round(size * 0.8)} mood={mood === 'hello' ? 'idle' : mood}
      title={title} still={still} live={live} active={active} greet={mood === 'hello'} gesture={gesture} onPoke={onPoke} className={className} />
  );
}
