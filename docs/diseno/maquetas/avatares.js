// Orb's bot avatar family (design mockup, original art): soft rounded «blob» bodies in a few pastel colours with Orb's
// own face — round glossy eyes with a highlight, like Orb·e's — and small lively animations. Deterministic SVG (shape +
// colour + seed), no images, no dependencies. States: idle (breathing, blinking, looking around), message (a bounce),
// thinking (wiggle, eyes up), sleepy (paused: closed eyes, slow breathing), happy (approved: hop, smiling eyes).
// prefers-reduced-motion or .bv-still: no motion at all.
(function () {
  // ---- bodies: viewBox 0 0 100 100, resting on y≈90 ----
  const SHAPES = {
    nube: { label: 'Nube', d: 'M24 86c-10 0-17-8-17-18 0-9 6-16 14-17 1-14 12-25 26-25 11 0 20 6 24 15 2-1 4-1 6-1 11 0 19 9 19 20 0 15-10 26-24 26z', face: [52, 60] },
    gota: { label: 'Gota', d: 'M50 10c6 9 34 34 34 52 0 17-15 28-34 28S16 79 16 62c0-18 28-43 34-52z', face: [50, 62] },
    judia: { label: 'Judía', d: 'M30 20c14-6 24 6 36 3 14-3 24 9 22 27-2 24-20 40-42 40-20 0-34-14-34-34 0-16 6-30 18-36z', face: [50, 56] },
    mochi: { label: 'Mochi', d: 'M50 26c26 0 40 14 40 34 0 20-12 28-40 28S10 80 10 60c0-20 14-34 40-34z', face: [50, 60] },
    flor: { label: 'Flor', d: 'M50 12c10 0 16 9 15 18 8-5 19-2 22 7s-3 17-11 20c7 5 9 15 3 22s-17 6-22-1c-1 9-9 14-16 13s-13-6-14-13c-6 7-17 7-22 0s-3-17 4-22c-8-3-13-12-10-20s14-11 22-6c-1-9 5-18 14-18z', face: [50, 54] },
    estrella: { label: 'Estrella', d: 'M50 10c4 0 6 3 8 8l6 13c1 2 3 3 5 3l14 2c6 1 9 3 9 7 0 3-2 5-5 8l-10 10c-2 2-2 4-2 6l3 14c1 6 0 10-4 11-3 1-6 0-10-3l-12-7c-2-1-4-1-6 0l-12 7c-4 3-7 4-10 3-4-1-5-5-4-11l3-14c0-2 0-4-2-6L7 51c-3-3-5-5-5-8 0-4 3-6 9-7l14-2c2 0 4-1 5-3l6-13c2-5 4-8 8-8z', face: [50, 56] },
    canto: { label: 'Canto', d: 'M46 16c22-3 42 10 43 34 1 22-14 38-38 39-22 1-40-12-40-34 0-20 14-36 35-39z', face: [50, 56] },
    gominola: { label: 'Gominola', d: 'M50 14c22 0 34 18 36 40l3 26c1 6-3 10-9 10H20c-6 0-10-4-9-10l3-26c2-22 14-40 36-40z', face: [50, 58] },
    bollo: { label: 'Bollo', d: 'M50 4c7 0 12 5 12 11 0 2 0 3-1 5 17 4 29 17 29 35 0 22-17 35-40 35S10 77 10 55c0-18 12-31 29-35-1-2-1-3-1-5 0-6 5-11 12-11z', face: [50, 60] },
    corazon: { label: 'Corazón', d: 'M50 88C30 76 8 60 8 38 8 24 18 14 31 14c8 0 15 4 19 11 4-7 11-11 19-11 13 0 23 10 23 24 0 22-22 38-42 50z', face: [50, 48] },
    hoja: { label: 'Hoja', d: 'M86 12c4 30-2 54-20 68-14 10-34 12-48 4-6-22 0-46 18-60 14-11 32-14 50-12z', face: [52, 54] },
    capsula: { label: 'Cápsula', d: 'M50 8c16 0 28 12 28 28v28c0 16-12 26-28 26S22 80 22 64V36C22 20 34 8 50 8z', face: [50, 50] }
  };
  // Each body's own face: eye style, spacing (half the distance between the eyes), a small smile, blush.
  const EYES = {
    nube: { kind: 'dot', gap: 8, blush: true }, gota: { kind: 'oval', gap: 7 }, judia: { kind: 'big', gap: 10, smile: true },
    mochi: { kind: 'dot', gap: 13, blush: true }, flor: { kind: 'oval', gap: 8, blush: true }, estrella: { kind: 'dot', gap: 8, smile: true },
    canto: { kind: 'big', gap: 9 }, gominola: { kind: 'oval', gap: 10, smile: true }, bollo: { kind: 'dot', gap: 6.5, blush: true },
    corazon: { kind: 'oval', gap: 9, smile: true }, hoja: { kind: 'bean', gap: 8 }, capsula: { kind: 'oval', gap: 7, blush: true }
  };
  const COLORS = { coral: 25, melocoton: 50, limon: 95, lima: 135, menta: 168, agua: 200, cielo: 238, lavanda: 285, rosa: 335, frambuesa: 5 };
  const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  let n = 0;
  // state: idle | message | thinking | sleepy | happy. still: no motion. delay: seconds into the animation (frame strips).
  function svg(shape = 'mochi', color = 'cielo', { size = 48, state = 'idle', seed = '', still = false, delay = null, blush = true } = {}) {
    const S = SHAPES[shape] ?? SHAPES.mochi; const h = COLORS[color] ?? 238; const id = `bv${n++}`;
    const r = hash(`${shape}${color}${seed}`); const blinkDelay = -((r % 4000) / 1000); const lookDelay = -(((r >> 8) % 7000) / 1000);
    const [fx, fy] = S.face; const warm = h >= 70 && h <= 140; /* yellows and limes need more light to stay bright */ const ink = `oklch(0.24 0.03 ${h})`;
    const E = EYES[shape] ?? EYES.mochi; const g = E.gap;
    const sleepy = state === 'sleepy', happy = state === 'happy', thinking = state === 'thinking';
    // Simple dark eyes, drawn per shape (dots, tall ovals, big glossy ones, wide beans) so the set is Orb's own.
    const open = (x) => E.kind === 'oval' ? `<ellipse cx="${x}" cy="${fy}" rx="3.6" ry="5.8" fill="${ink}"/><ellipse cx="${x + 1.2}" cy="${fy - 2.6}" rx="1.1" ry="1.5" fill="#fff" opacity=".9"/>`
      : E.kind === 'big' ? `<circle cx="${x}" cy="${fy}" r="6.4" fill="${ink}"/><circle cx="${x + 2}" cy="${fy - 2.4}" r="2.2" fill="#fff"/>`
        : E.kind === 'bean' ? `<ellipse cx="${x}" cy="${fy}" rx="5" ry="3.8" fill="${ink}"/>`
          : `<circle cx="${x}" cy="${fy}" r="4.3" fill="${ink}"/>`;
    const eye = (x) => happy
      ? `<path d="M${x - 4.5} ${fy + 1.5}q4.5 -7 9 0" fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>`
      : sleepy
        ? `<path d="M${x - 4.5} ${fy}q4.5 4 9 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`
        : `<g class="bv-eye" style="transform-origin:${x}px ${fy}px">${open(x)}</g>`;
    const my = fy + (E.kind === 'big' ? 11 : 9);
    const mouth = happy ? `<path d="M${fx - 5} ${my - 1}q5 6 10 0" fill="${ink}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`
      : thinking ? `<ellipse cx="${fx + 1}" cy="${my + 1}" rx="2" ry="2.4" fill="${ink}"/>`
        : sleepy ? '' : E.smile ? `<path d="M${fx - 3} ${my - 1}q3 3 6 0" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>` : '';
    const cheeks = blush && (E.blush || happy) ? `<ellipse cx="${fx - g - 7}" cy="${fy + 6}" rx="4.2" ry="2.6" fill="oklch(0.7 0.17 5)" opacity=".42"/><ellipse cx="${fx + g + 7}" cy="${fy + 6}" rx="4.2" ry="2.6" fill="oklch(0.7 0.17 5)" opacity=".42"/>` : '';
    const zz = sleepy ? `<text class="bv-z" x="${fx + 22}" y="${fy - 16}" font-size="13" font-weight="700" fill="${ink}" opacity=".55" font-family="system-ui">z</text>` : '';
    const style = delay == null ? `--blink:${blinkDelay}s;--look:${lookDelay}s` : `--blink:${-delay}s;--look:${-delay}s;--t:${-delay}s`;
    const L1 = warm ? 0.9 : 0.82, L2 = warm ? 0.84 : 0.74;
    return `<svg class="bv${still ? ' bv-still' : ''}${delay != null ? ' bv-frame' : ''}" data-state="${state}" width="${size}" height="${size}" viewBox="0 0 100 100" style="${style}" role="img" aria-label="${S.label}">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="oklch(${L1} 0.16 ${h})"/><stop offset="1" stop-color="oklch(${L2} 0.17 ${h})"/></linearGradient></defs>
<ellipse class="bv-shadow" cx="50" cy="94" rx="24" ry="3.2" fill="oklch(0.3 0.05 ${h})" opacity=".14"/>
<g class="bv-body"><path d="${S.d}" fill="url(#${id})"/>
<ellipse cx="${fx - 17}" cy="${fy - 19}" rx="6.5" ry="3.6" fill="#fff" opacity=".5" transform="rotate(-24 ${fx - 17} ${fy - 19})"/>
<g class="bv-face">${cheeks}<g class="bv-eyes">${eye(fx - g)}${eye(fx + g)}</g>${mouth}</g>${zz}</g></svg>`;
  }
  const css = `
.bv { overflow: visible; flex: none; }
.bv .bv-body { transform-box: view-box; transform-origin: 50px 90px; }
.bv .bv-eyes, .bv .bv-eye, .bv .bv-z { transform-box: view-box; }
@media (prefers-reduced-motion: no-preference) {
  .bv:not(.bv-still) .bv-body { animation: bv-breathe 3.6s ease-in-out infinite var(--t, 0s); }
  .bv:not(.bv-still) .bv-eye { animation: bv-blink 4.2s infinite var(--blink, 0s); }
  .bv:not(.bv-still)[data-state="idle"] .bv-eyes { animation: bv-look 7s ease-in-out infinite var(--look, 0s); }
  .bv:not(.bv-still)[data-state="message"] .bv-body { animation: bv-bounce .9s cubic-bezier(.3,.7,.4,1) infinite var(--t, 0s); }
  .bv:not(.bv-still)[data-state="thinking"] .bv-body { animation: bv-wiggle 1.4s ease-in-out infinite var(--t, 0s); }
  .bv:not(.bv-still)[data-state="thinking"] .bv-eyes { transform: translate(2px, -3px); }
  .bv:not(.bv-still)[data-state="sleepy"] .bv-body { animation: bv-breathe 6s ease-in-out infinite var(--t, 0s); }
  .bv:not(.bv-still)[data-state="sleepy"] .bv-z { animation: bv-z 3s ease-out infinite var(--t, 0s); }
  .bv:not(.bv-still)[data-state="happy"] .bv-body { animation: bv-hop 1s cubic-bezier(.3,.7,.4,1) infinite var(--t, 0s); }
  .bv-frame, .bv-frame * { animation-play-state: paused !important; }
}
@keyframes bv-breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.035, .965); } }
@keyframes bv-blink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(.1); } }
@keyframes bv-look { 0%, 30%, 100% { transform: translate(0, 0); } 40%, 55% { transform: translate(-3px, -1px); } 65%, 80% { transform: translate(3px, 0); } }
@keyframes bv-bounce { 0% { transform: translateY(0) scale(1, 1); } 25% { transform: translateY(0) scale(1.08, .9); } 50% { transform: translateY(-14px) scale(.95, 1.06); } 75% { transform: translateY(0) scale(1.05, .94); } 100% { transform: translateY(0) scale(1, 1); } }
@keyframes bv-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-6deg); } 75% { transform: rotate(6deg); } }
@keyframes bv-hop { 0%, 100% { transform: translateY(0) scale(1, 1); } 30% { transform: translateY(-10px) scale(.96, 1.05); } 55% { transform: translateY(0) scale(1.07, .93); } 75% { transform: translateY(-4px); } }
@keyframes bv-z { 0% { transform: translate(0, 0); opacity: 0; } 30% { opacity: .55; } 100% { transform: translate(6px, -12px); opacity: 0; } }`;
  if (typeof document !== 'undefined' && !document.getElementById('bv-css')) { const st = document.createElement('style'); st.id = 'bv-css'; st.textContent = css; document.head.appendChild(st); }
  globalThis.OrbAvatar = { SHAPES, COLORS, svg };
})();
