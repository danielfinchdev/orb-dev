// 3.8.2 (item 13, owner's decision D4): the music Orb can play on Windows: background music for studying or coding (the
// play / pause button at the foot of the sidebar) and one track per minigame. None of it is in the installer: each
// track is downloaded the first time it is played (src/engine/music.mjs) into core\herramientas\musica (read-only for
// agents, src/core/guard.mjs) and checked against its size and SHA-256 here before it is kept or played.
//
// Only free music: every track is CC0 1.0 (public domain dedication), checked by hand on its page (the «License(s)»
// field of OpenGameArt.org) on 2026-11-09. CC0 asks for no attribution; Orb credits the authors anyway (Ajustes ›
// Acerca de). A track whose licence cannot be checked is not added. A new or changed track needs a new pin here.
const OGA = 'https://opengameart.org/sites/default/files/';
const CC0 = 'CC0 1.0';
const track = (id, title, author, page, file, size, sha256) => Object.freeze({ id, title, author, page: `https://opengameart.org/content/${page}`, url: OGA + file, size, sha256, licence: CC0, mime: file.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg' });

// Lofi and chill, for the background.
export const BACKGROUND = Object.freeze([
  track('lofi-loop', 'Lofi Hip Hop Loop', 'omfgdude', 'lofi-hip-hop-loop', 'LofiLoop_2.ogg', 1430666, 'e57ba821d4db8d66783ca984a2778ec68d1439e862239ec36407344ef3bd1eab'),
  track('lofi-again', 'Lofi again', 'omfgdude', 'lofi-again', 'lofiagain.ogg', 2419417, 'd3b3410a186d45dadbcf87a8072b5a7f3b3f5a11fe38d9a7e9bdb3f66d5d86fa'),
  track('gathu', 'GATHU', 'cinameng', 'gathu', 'gathu_0.mp3', 1360456, '3c8de6f144948984f7cf9217915481641157e97dc708fbd29b1ee2ec90491096'),
  track('dimly-lit', 'Dimly lit', 'iamoneabe', 'dimly-lit', 'dimlylit_0.mp3', 4312608, 'd89587af23a157d7df204c71888f9ef73f4d5ceef9daf87b89ab4a515e4af618')
]);

// One per minigame (the ids of src/ui/games/games.jsx): chiptune for the arcade ones, calmer for the thinking ones.
export const GAMES = Object.freeze({
  tetris: track('junkala-level1', 'Level 1', 'Juhani Junkala', '5-chiptunes-action', 'level1.mp3', 1608620, '559ad4eb2f936b7a3db0513aabf45926c842253a5721d23b3202a7a56a6b19da'),
  breakout: track('junkala-level2', 'Level 2', 'Juhani Junkala', '5-chiptunes-action', 'level2.mp3', 1609142, 'aa3dc59166e121cecfc2033ffc3a11ea6b74b28c8cdac492e1a6db35c5abe1fd'),
  pacman: track('junkala-level3', 'Level 3', 'Juhani Junkala', '5-chiptunes-action', 'level3.mp3', 1823347, 'd361904fad67d1a238ff9de4b00f3ad9ad549e6bdf0dd2122485a4100a39665b'),
  invaders: track('chip-bit-danger', 'Chip Bit Danger', 'sudocolon', 'chip-bit-danger', 'Chip%20Bit%20Danger_0.mp3', 2364809, '6656f7ee749dfcb060effcd9ce73da6be9d3006cd189463bc7e7429f2ccf600f'),
  runner: track('heroic-loop', 'Heroic Loop', 'Zane Little Music', 'heroic-loop', 'heroic_loop_0.mp3', 2672776, 'b15d4a0fabc9d3be9ceab7969662298e9c1136cd8ccad7794be51aedfdf29b8b'),
  snake: track('concentration', '8 Bit Concentration Loop', 'cosmac', '8-bit-concentration-loop', 'game_3.mp3', 369189, '92b491a2192620b8673bbb3a23af779ec38d5f4e7e5e255c53738009a2a7acc6'),
  g2048: track('arplands', 'The Arplands', 'lordzintick', 'the-arplands', 'the_arplands_0.ogg', 1602666, '54fcd0a72861f143f93ff218e5118691d3629fe0e46714d7d8795e449d60a245'),
  chess: track('forgotten-path', 'Forgotten Path', 'johndekale', 'forgotten-path', 'forgotten_path_2.mp3', 346403, '37373b97a602c606ce4fca979d5e1f9d6623c06681d7c70089779e1aad3fb8c3')
});

// Every track by its id (a track shared by two places counts once).
export const TRACKS = Object.freeze(Object.fromEntries([...BACKGROUND, ...Object.values(GAMES)].map((t) => [t.id, t])));
export const trackOf = (id) => (Object.hasOwn(TRACKS, id) ? TRACKS[id] : null);

// The volume the background music starts at (0..1): soft, under the voice of a video call or the agents' sounds.
export const DEFAULT_VOLUME = 0.35;

// Only the Windows app plays music: never a phone, the Android app or a linked browser. b: the window's bridge.
export const musicAllowed = (b) => Boolean(b && !b.mobile && b.desktop === true && b.platform === 'win32');
// ui.music of orb.json: { on (off by default), volume (0..1), track (a background track's id) }.
export function musicPrefs(ui = {}) {
  const m = ui?.music ?? {};
  return { on: m.on === true, volume: typeof m.volume === 'number' ? Math.min(1, Math.max(0, m.volume)) : DEFAULT_VOLUME, track: BACKGROUND.some((t) => t.id === m.track) ? m.track : BACKGROUND[0].id };
}
// The games' music is on unless muted (ui.gameMusic === false).
export const gameMusicOn = (ui = {}) => ui?.gameMusic !== false;
// The background track after this one: they play in turn and the list starts again (a loop).
export const nextTrack = (id) => BACKGROUND[(BACKGROUND.findIndex((t) => t.id === id) + 1) % BACKGROUND.length].id;
// A game's track, or null.
export const gameTrack = (game) => (Object.hasOwn(GAMES, game) ? GAMES[game] : null);
