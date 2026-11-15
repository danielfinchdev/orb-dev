// The app icon (the one of the .exe) that stands where the robot would be in the themes without one (Profesional and
// Cristal). Still on purpose: no animation. Decorative by default; pass `label` where it is the only name of the control.
// The 32 px picture is sharp up to 32 CSS px; bigger sizes (or a dense screen) take the 128 px one.
export function OrbMark({ size = 32, label, className }) {
  return (
    <img src={size > 32 ? './orb-exe-128.png' : './orb-exe-32.png'} srcSet={size > 32 ? undefined : './orb-exe-32.png 1x, ./orb-exe-128.png 4x'}
      width={size} height={size} alt={label ?? ''} aria-hidden={label ? undefined : true} draggable={false} className={className} style={{ flex: 'none' }} />
  );
}
