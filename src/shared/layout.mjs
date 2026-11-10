// 3.8: the names of the workspace (C:\Orb by default) in one place, without Node, so the window shows the same folders
// the engine creates. The workspace holds:
//   core\                                    Orb's own folder, hidden (src/platform/paths.mjs › paths)
//   windows\ linux\ ios\ android\ web\       one folder per project
//   multi\<project>\{<platform>…, compartido}  a multiplatform project: one folder, one repository
export const CORE_DIR = 'core';
export const PLATFORMS = ['windows', 'linux', 'ios', 'android', 'web'];
export const MULTI = 'multi';
export const CATEGORIES = [...PLATFORMS, MULTI];
export const DEFAULT_CATEGORY = 'web';
// What the platforms of a multiplatform project share (API, design, texts, images).
export const SHARED_DIR = 'compartido';
// 3.5 (Ajustes › Avanzado › «Cosas que nadie toca», src/domain/security/guard.mjs): what nobody touches by default: the usual
// password managers and secret stores (the user edits the list).
// 3.7: and the usual data folders of a Vaultwarden / Bitwarden self-host (vw-data, bwdata).
export const DEFAULT_PROTECTED = Object.freeze(['vaultwarden', 'bitwarden', 'keepass', 'keepassxc', '.kdbx', '1password', 'lastpass', '.password-store', '.gnupg', '.ssh/id_', 'vw-data', 'bwdata']);
