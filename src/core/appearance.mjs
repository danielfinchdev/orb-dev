// Appearance options (Ajustes → Apariencia), in one place for the settings screen, the checks of orb.json and the
// interface. Each value is applied to <html> as a data attribute: data-skin, data-font, data-code-font, data-code-theme.
// The first of each list is the default. Labels live in the locales: appearance.skin.<id>, appearance.font.<id>…

// Visual themes. Light / dark (ui.theme) still applies on top of each one.
//   orb: the default (the robot and its sky); vaporwave; retro: arcade, space invaders; profesional: no robot and no
//   animations, plain and sober; nube: soft candy colours and clouds.
export const SKINS = ['orb', 'vaporwave', 'retro', 'profesional', 'nube'];

// Interface font. outfit is the one Orb has always used.
export const FONTS = ['outfit', 'inter', 'geist', 'plex', 'system'];

// Font of code (chat code blocks, files, diffs). geist-mono is the one Orb has always used.
export const CODE_FONTS = ['geist-mono', 'jetbrains-mono', 'fira-code', 'plex-mono', 'cascadia'];

// Colours of code (syntax highlighting).
export const CODE_THEMES = ['orb', 'github', 'one-dark', 'dracula', 'nord', 'solarized'];

export const APPEARANCE_DEFAULTS = { skin: SKINS[0], font: FONTS[0], codeFont: CODE_FONTS[0], codeTheme: CODE_THEMES[0] };
