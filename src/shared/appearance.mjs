// Appearance options (Ajustes → Apariencia), in one place for the settings screen, the checks of orb.json and the
// interface. Each value is applied to <html> as a data attribute: data-skin, data-font, data-code-font, data-code-theme.
// The first of each list is the default. Labels live in the locales: appearance.skin.<id>, appearance.font.<id>…

// Visual themes. Light / dark (ui.theme) still applies on top of each one, except where a theme only exists in one of them.
//   predeterminado: sober and neutral, no robot and no decorative motion, painted by one of the palettes;
//   cristal: the same made of frosted glass (light only); orb: the robot and its sky; vaporwave: sun, grid and neon;
//   candy: soft sweets colours; retro: green phosphor terminal (dark only).
// The first one is the default. Ids are stored in orb.json.
export const SKINS = ['predeterminado', 'cristal', 'orb', 'vaporwave', 'candy', 'retro'];

// The themes with no backdrop and no decorative motion.
export const plainSkin = (skin) => skin === 'predeterminado' || skin === 'cristal';
// Only the «orb» theme has the robot; the others wear the plain ORB·E mark.
export const robotSkin = (skin) => skin === 'orb';
// The themes that only exist in dark (the phosphor terminal of «retro»). They ignore ui.theme without overwriting it,
// so going back to another theme restores the saved light / dark / system choice.
const DARK_ONLY = new Set(['retro']);
// Same idea for the glass theme, which only exists in light.
const LIGHT_ONLY = new Set(['cristal']);
export const darkOnlySkin = (skin) => DARK_ONLY.has(skin);
export const lightOnlySkin = (skin) => LIGHT_ONLY.has(skin);
// The themes a phone (or a linked browser) may wear: «orb» and the default. The phone follows the PC's choice
// (ui.skin travels in the settings it receives); anything else shows the default.
export const phoneSkin = (skin) => (skin === 'orb' ? 'orb' : SKINS[0]);

// Interface font. outfit is the one Orb has always used.
export const FONTS = ['outfit', 'inter', 'geist', 'plex', 'system'];

// Font of code (chat code blocks, files, diffs). geist-mono is the one Orb has always used.
export const CODE_FONTS = ['geist-mono', 'jetbrains-mono', 'fira-code', 'plex-mono', 'cascadia'];

// Colours of code (syntax highlighting).
export const CODE_THEMES = ['orb', 'github', 'one-dark', 'dracula', 'nord', 'solarized'];

// Palettes of the «predeterminado» and «cristal» themes. The other themes ignore them.
export const PALETTES = ['grafito', 'oceano', 'bosque', 'uva', 'rubi', 'arena'];
// Legacy keys: an old orb.json may still carry them, so validation accepts them, but the interface no longer offers them.
export const ACCENTS = ['tema', 'naranja', 'azul', 'violeta', 'verde', 'rosa', 'turquesa'];
export const CONTRASTS = ['suave', 'normal', 'alto'];

// Old theme and palette ids of earlier versions, mapped to the current model.
const OLD_SKIN = { profesional: 'predeterminado', grafito: 'predeterminado', paletas: 'predeterminado', nube: 'candy' };
const ACCENT_PALETTE = { naranja: 'grafito', azul: 'oceano', turquesa: 'oceano', violeta: 'uva', verde: 'bosque', rosa: 'rubi' };
const OLD_PALETTE = {};
for (const [pal, ids] of Object.entries({
  grafito: ['carbon', 'nieve', 'tinta', 'pizarra', 'niebla', 'humo', 'plata'],
  oceano: ['hielo', 'oceano', 'marino', 'noche'],
  bosque: ['oliva', 'bosque', 'menta', 'jade', 'lima'],
  uva: ['ciruela', 'violeta', 'lavanda', 'mora'],
  rubi: ['rosa', 'cereza', 'coral'],
  arena: ['arena', 'trigo', 'cafe', 'cobre', 'sol'],
})) for (const id of ids) OLD_PALETTE[id] = pal;

// Brings the stored `ui` object to the current theme and palette lists. Pure and idempotent; touches no other key.
export function migrateAppearance(ui) {
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return ui;
  const out = { ...ui };
  const oldSkin = ui.skin;
  if (oldSkin !== undefined) {
    if (SKINS.includes(oldSkin)) out.skin = oldSkin;
    else out.skin = OLD_SKIN[oldSkin] ?? SKINS[0];
  }
  if (ui.palette !== undefined) {
    if (oldSkin === 'paletas') {
      const byAccent = typeof ui.accent === 'string' && ui.accent !== 'tema' ? ACCENT_PALETTE[ui.accent] : undefined;
      out.palette = byAccent ?? OLD_PALETTE[ui.palette] ?? PALETTES[0];
    } else if (oldSkin === 'profesional' || oldSkin === 'grafito' || oldSkin === 'nube') out.palette = PALETTES[0];
    else if (!PALETTES.includes(ui.palette)) out.palette = PALETTES[0];
  } else if (oldSkin === 'paletas') {
    const byAccent = typeof ui.accent === 'string' && ui.accent !== 'tema' ? ACCENT_PALETTE[ui.accent] : undefined;
    if (byAccent) out.palette = byAccent;
  }
  return out;
}

// Density, width of the chat column and size of the text (Ajustes → Apariencia). They are written on <html> as --app-density,
// --chat-max-width and --font-k / --chat-font (lib/store.js). The first value of each list is NOT the default: the defaults
// («normal», 14.5 px) reproduce the sizes Orb has always had, so nothing moves until the user picks another one.
export const DENSITIES = Object.freeze({ compacta: 0.85, normal: 1, amplia: 1.15 });
export const CHAT_WIDTHS = Object.freeze({ estrecha: '40rem', normal: '48rem', ancha: '72rem', completa: '100%' });
export const FONT_SIZES = [12, 13, 14, 14.5, 15, 16, 17, 18];
export const BASE_FONT = 14.5;

export const APPEARANCE_DEFAULTS = { skin: SKINS[0], font: FONTS[0], codeFont: CODE_FONTS[0], codeTheme: CODE_THEMES[0], palette: PALETTES[0], accent: 'tema', contrast: 'normal', density: 'normal', chatWidth: 'normal', fontSize: BASE_FONT };
