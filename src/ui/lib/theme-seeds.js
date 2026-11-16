// Themes from three seed colours. A palette is a surface (the background), an ink (the text) and an accent; this module
// derives every token of the interface from them (the same ~35 the hand-written themes set) and writes them as a CSS
// text for <html data-material="paletas">. Contrast is not hoped for but enforced: every text colour is nudged along
// lightness until it reaches WCAG AA against the surfaces it sits on (test/temas-semillas-387.test.mjs checks all of it).
// No DOM here: the store applies the CSS and the tests import this file as it is. The themes with a scene stay by hand.
import { PALETTES, ACCENTS, CONTRASTS } from '../../shared/appearance.mjs';

// ---- colour maths: OKLab (Björn Ottosson), hex in and out, sRGB-clamped ----
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (x) => { const v = Math.min(1, Math.max(0, x)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255); }
export const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
export function rgbToLab(rgb) {
  const [r, g, b] = rgb.map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function labToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(toGam);
}
const lab = (h) => rgbToLab(hexToRgb(h));
const hex = (l) => rgbToHex(labToRgb(l));
export const oklch = (L, C, H) => hex([L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]);
// a mixed with b: `pct` percent of b, in OKLab (what color-mix(in oklab) does).
export function mix(a, b, pct) { const [x, y] = [lab(a), lab(b)]; return hex(x.map((v, i) => v + (y[i] - v) * (pct / 100))); }
export const luminance = (h) => { const [r, g, b] = hexToRgb(h).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function ratio(a, b) { const [p, q] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (p + 0.05) / (q + 0.05); }

// Moves `fg` along lightness, away from the surfaces it sits on, until it reaches `min` against all of `bgs`.
function ensure(fg, bgs, min) {
  const list = [].concat(bgs);
  const lighten = list.reduce((s, b) => s + luminance(b), 0) / list.length < 0.18; // dark surfaces: text goes lighter
  let [L, a, b] = lab(fg);
  for (let i = 0; i < 100; i += 1) {
    const out = hex([L, a, b]);
    if (list.every((bg) => ratio(out, bg) >= min)) return out;
    L += lighten ? 0.01 : -0.01;
    if (L <= 0 || L >= 1) break;
    [a, b] = [a * 0.985, b * 0.985]; // chroma eases off on the way so the colour stays inside sRGB
  }
  const end = lighten ? '#ffffff' : '#000000';
  return list.every((bg) => ratio(end, bg) >= min) ? end : fg;
}

// ---- presets: id → [hue, tint, accent] ----
// hue / tint tilt the surface and the ink (tint 0 is neutral); the accent is the palette's own colour, which an accent
// chosen in Ajustes replaces. The surfaces and inks of both modes come from these numbers.
const SEEDS = {
  carbon: [0, 0, '#f2612d'], nieve: [0, 0, '#2f7cf6'], tinta: [260, 0.02, '#4f6bed'], pizarra: [250, 0.025, '#139e9e'], niebla: [230, 0.02, '#3b82c4'],
  hielo: [215, 0.03, '#0ea5c6'], oceano: [235, 0.04, '#2f7fd1'], marino: [255, 0.05, '#4d7cf0'], noche: [280, 0.04, '#8b6cf0'], ciruela: [320, 0.04, '#c04fd0'],
  violeta: [295, 0.04, '#8e5cf0'], rosa: [350, 0.03, '#e0457b'], cereza: [15, 0.035, '#d6334f'], coral: [30, 0.03, '#f06a4d'], arena: [80, 0.025, '#c58a2a'],
  trigo: [95, 0.03, '#b89b1f'], oliva: [115, 0.03, '#7a9a2b'], bosque: [150, 0.035, '#2e9d5c'], menta: [165, 0.03, '#1fb08a'], jade: [175, 0.03, '#17a089'],
  cafe: [55, 0.03, '#b26a35'], cobre: [45, 0.035, '#c9602e'], humo: [300, 0.01, '#7a7fa0'], plata: [260, 0.008, '#6b7fa6'], lavanda: [285, 0.025, '#9b7bf0'],
  mora: [335, 0.035, '#b2438f'], sol: [95, 0.035, '#e0a914'], lima: [128, 0.035, '#8cb521']
};
export const ACCENT_COLORS = Object.freeze({ naranja: '#f2612d', azul: '#3b82f6', violeta: '#8b5cf6', verde: '#22a55b', rosa: '#ec4899', turquesa: '#14b8a6' });
// how hard the lines and surfaces read: scales the percentages of ink mixed into the surface.
const STRENGTH = { suave: 0.75, normal: 1, alto: 1.35 };

// The three seeds of a palette in one mode: { surface, ink, accent }.
export function seedsOf(id, mode, accent = 'tema') {
  const [hue, tint, own] = SEEDS[PALETTES.includes(id) ? id : PALETTES[0]];
  const dark = mode === 'dark';
  return {
    surface: dark ? oklch(0.165, tint, hue) : oklch(0.985, tint * 0.35, hue),
    ink: dark ? oklch(0.96, tint * 0.2, hue) : oklch(0.25, tint * 0.8, hue),
    accent: accent !== 'tema' && ACCENT_COLORS[accent] ? ACCENT_COLORS[accent] : own
  };
}

// Status colours: fixed hues, nudged for each background afterwards.
const STATUS = {
  light: { destructive: oklch(0.55, 0.21, 27), success: oklch(0.5, 0.13, 160), warning: oklch(0.5, 0.11, 65), info: oklch(0.53, 0.17, 254) },
  dark: { destructive: oklch(0.72, 0.17, 25), success: oklch(0.76, 0.14, 155), warning: oklch(0.82, 0.13, 80), info: oklch(0.72, 0.14, 250) }
};

// Every token of one palette in one mode, as { '--background': '#rrggbb', … }. Only opaque colours: the contrast test reads them as they are.
export function deriveTokens(id, mode, accent = 'tema', contrast = 'normal') {
  const dark = mode === 'dark';
  const k = STRENGTH[CONTRASTS.includes(contrast) ? contrast : 'normal'];
  const { surface, ink, accent: seed } = seedsOf(id, mode, accent);
  const m = (pct) => mix(surface, ink, pct * k); // the surface tinted with ink
  const background = surface;
  const card = dark ? m(2.5) : mix(surface, '#ffffff', 60);
  const popover = dark ? m(5) : '#ffffff';
  const secondary = m(dark ? 5 : 4);
  const muted = secondary;
  const accentFill = m(dark ? 9 : 7);
  const sidebar = dark ? mix(surface, '#000000', 22) : m(2.5);
  // the accent as a button fill needs readable text on top (white or near-black, whichever passes); otherwise the fill moves.
  let primary = seed;
  const [dk, lt] = ['#161616', '#ffffff'];
  const pick = (c) => (ratio(c, lt) >= ratio(c, dk) ? lt : dk);
  let primaryForeground = pick(primary);
  for (let i = 0; i < 60 && ratio(primary, primaryForeground) < 4.5; i += 1) {
    const [L, a, b] = lab(primary);
    primary = hex([L + (primaryForeground === lt ? -0.01 : 0.01), a, b]);
    primaryForeground = pick(primary);
  }
  const primarySoft = mix(surface, primary, dark ? 22 : 11);
  const primaryText = ensure(seed, [background, card, primarySoft, secondary, accentFill], 4.5);
  const foreground = ensure(ink, [background, card, popover, secondary, accentFill, sidebar], 7);
  const surfaces = [background, card, popover, muted, accentFill, sidebar];
  const mutedForeground = ensure(mix(foreground, surface, dark ? 28 : 34), surfaces, 4.5);
  const faint = ensure(mix(foreground, surface, dark ? 38 : 44), surfaces, 4.5);
  const border = m(dark ? 10 : 8);
  const input = ensure(mix(surface, ink, 45), [background, card, popover], 3);
  const ring = ensure(seed, [background, card, popover], 3);
  const bubble = mix(surface, primary, dark ? 30 : 14);
  const st = STATUS[dark ? 'dark' : 'light'];
  const destructiveSoft = mix(surface, st.destructive, dark ? 20 : 9);
  const successSoft = mix(surface, st.success, dark ? 18 : 9);
  const warningSoft = mix(surface, st.warning, dark ? 20 : 11);
  const status = (name, soft) => ensure(st[name], [background, card, soft], 4.5);
  const warning = status('warning', warningSoft);
  return {
    '--background': background, '--foreground': foreground,
    '--card': card, '--card-foreground': foreground,
    '--popover': popover, '--popover-foreground': foreground,
    '--primary': primary, '--primary-foreground': primaryForeground, '--primary-soft': primarySoft, '--primary-text': primaryText,
    '--secondary': secondary, '--secondary-foreground': foreground,
    '--muted': muted, '--muted-foreground': mutedForeground, '--faint-foreground': faint,
    '--accent': accentFill, '--accent-foreground': foreground,
    '--destructive': status('destructive', destructiveSoft), '--destructive-soft': destructiveSoft,
    '--success': status('success', successSoft), '--success-soft': successSoft,
    '--warning': warning, '--warning-ink': warning, '--warning-soft': warningSoft,
    '--warning-foreground': dark ? '#241d10' : '#ffffff',
    '--info': status('info', background),
    '--border': border, '--input': input, '--ring': ring,
    '--sidebar': sidebar,
    '--bubble': bubble, '--bubble-foreground': ensure(foreground, bubble, 7),
    '--chart-empty': m(dark ? 16 : 11)
  };
}

// The CSS text for both modes. The selectors carry [data-skin] to outrank Profesional's own token rules whatever the load order.
export function seedCss(id, accent = 'tema', contrast = 'normal') {
  const block = (selector, mode) => `${selector} { ${Object.entries(deriveTokens(id, mode, accent, contrast)).map(([k, v]) => `${k}: ${v};`).join(' ')} }`;
  return `${block('html[data-skin][data-material="paletas"]', 'light')}\n${block('html.dark[data-skin][data-material="paletas"]', 'dark')}`;
}

// What the picker's thumbnail needs: the main colours of a palette in a mode.
export function previewColors(id, mode, accent = 'tema', contrast = 'normal') {
  const t = deriveTokens(id, mode, accent, contrast);
  return { '--p-bg': t['--background'], '--p-fg': t['--foreground'], '--p-side': t['--sidebar'], '--p-card': t['--card'], '--p-border': t['--border'], '--p-primary': t['--primary'], '--p-accent': t['--accent'], '--p-accent-fg': t['--foreground'], '--p-bubble': t['--bubble'], '--p-bubble-fg': t['--bubble-foreground'], '--p-bar': t['--background'], '--p-box-line': t['--input'] };
}
export { ACCENTS };
