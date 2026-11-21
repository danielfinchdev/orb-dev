// The backdrop of the themes that have a shader: one canvas per window, behind everything (lib/shaders.js draws on it).
// Predeterminado has none. The canvas is replaced, not reused, when the theme changes: a canvas keeps its first context.
import { useEffect, useRef } from 'react';
import { useSkin } from '@/lib/store.js';
import { hasShader, startShader } from '@/lib/shaders.js';

export function Scene() {
  const skin = useSkin(); // the theme actually worn here: a linked phone wears its own, not the PC's
  const ref = useRef(null);
  const on = hasShader(skin);
  useEffect(() => {
    if (!on || !ref.current) return undefined;
    const shader = startShader(ref.current, skin);
    return () => shader.stop();
  }, [skin, on]);
  if (!on) return null;
  return (
    <>
      <canvas key={skin} ref={ref} className="orb-shader" aria-hidden="true" data-testid="scene" data-shader={skin} />
      {/* Retro's CRT glass (skins.css): scanlines and vignette over the whole window, above everything but the dialogs */}
      {skin === 'retro' ? <div className="crt" aria-hidden="true" data-testid="crt" /> : null}
    </>
  );
}
