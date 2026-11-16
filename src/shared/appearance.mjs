// Appearance options (Ajustes → Apariencia), in one place for the settings screen, the checks of orb.json and the
// interface. Each value is applied to <html> as a data attribute: data-skin, data-font, data-code-font, data-code-theme.
// The first of each list is the default. Labels live in the locales: appearance.skin.<id>, appearance.font.<id>…

// Visual themes. Light / dark (ui.theme) still applies on top of each one.
//   orb: the default (the robot and its sky); vaporwave; retro: arcade, space invaders; profesional: no robot and no
//   animations, plain and sober; nube: soft candy colours and clouds; cristal: Profesional made of frosted glass;
//   grafito: Profesional in near-monochrome graphite with one orange accent, the system font and softer corners;
//   paletas: Profesional painted from three seed colours (ui/lib/theme-seeds.js), with a preset and an accent to choose.
// New ids go at the end: they are stored in orb.json.
export const SKINS = ['orb', 'vaporwave', 'retro', 'profesional', 'nube', 'cristal', 'grafito', 'paletas'];

// a theme built on top of another one («grafito» the same way over Profesional). «cristal» is Profesional (no robot, no sounds, no backdrop, no animation)
// plus its own glass material: <html> wears data-skin="profesional" and data-material="cristal" (lib/store.js), so every
// rule of Profesional applies and themes.css adds the glass under html[data-material="cristal"].
export const SKIN_BASE = Object.freeze({ cristal: 'profesional', grafito: 'profesional', paletas: 'profesional' });
export const baseSkin = (skin) => SKIN_BASE[skin] ?? skin;
// The themes with no robot, no backdrop and no decorative motion.
export const plainSkin = (skin) => baseSkin(skin) === 'profesional';
// The themes that only exist in dark (the phosphor terminal of «retro»). They ignore ui.theme without overwriting it,
// so going back to another theme restores the saved light / dark / system choice.
const DARK_ONLY = new Set(['retro']);
// The themes a phone (or a linked browser) may wear: the default and Grafito, which is plain (no robot, no backdrop, no motion).
// The phone follows the PC's choice (ui.skin travels in the settings it receives); anything else shows the default.
const PHONE_SKINS = new Set([SKINS[0], 'grafito']);
export const phoneSkin = (skin) => (PHONE_SKINS.has(skin) ? skin : SKINS[0]);
export const darkOnlySkin = (skin) => DARK_ONLY.has(baseSkin(skin));

// Interface font. outfit is the one Orb has always used.
export const FONTS = ['outfit', 'inter', 'geist', 'plex', 'system'];

// Font of code (chat code blocks, files, diffs). geist-mono is the one Orb has always used.
export const CODE_FONTS = ['geist-mono', 'jetbrains-mono', 'fira-code', 'plex-mono', 'cascadia'];

// Colours of code (syntax highlighting).
export const CODE_THEMES = ['orb', 'github', 'one-dark', 'dracula', 'nord', 'solarized'];

// Palettes of the «paletas» theme (ui/lib/theme-seeds.js holds the seeds of each id; a test keeps both lists equal), the accents
// that can replace a palette's own, and how strong its lines and surfaces are.
export const PALETTES = ['carbon', 'nieve', 'tinta', 'pizarra', 'niebla', 'hielo', 'oceano', 'marino', 'noche', 'ciruela', 'violeta', 'rosa', 'cereza', 'coral', 'arena', 'trigo', 'oliva', 'bosque', 'menta', 'jade', 'cafe', 'cobre', 'humo', 'plata', 'lavanda', 'mora', 'sol', 'lima'];
export const ACCENTS = ['tema', 'naranja', 'azul', 'violeta', 'verde', 'rosa', 'turquesa'];
export const CONTRASTS = ['suave', 'normal', 'alto'];

// Density, width of the chat column and size of the text (Ajustes → Apariencia). They are written on <html> as --app-density,
// --chat-max-width and --font-k / --chat-font (lib/store.js). The first value of each list is NOT the default: the defaults
// («normal», 14.5 px) reproduce the sizes Orb has always had, so nothing moves until the user picks another one.
export const DENSITIES = Object.freeze({ compacta: 0.85, normal: 1, amplia: 1.15 });
export const CHAT_WIDTHS = Object.freeze({ estrecha: '40rem', normal: '48rem', ancha: '72rem', completa: '100%' });
export const FONT_SIZES = [12, 13, 14, 14.5, 15, 16, 17, 18];
export const BASE_FONT = 14.5;

export const APPEARANCE_DEFAULTS = { skin: SKINS[0], font: FONTS[0], codeFont: CODE_FONTS[0], codeTheme: CODE_THEMES[0], palette: 'carbon', accent: 'tema', contrast: 'normal', density: 'normal', chatWidth: 'normal', fontSize: BASE_FONT };
