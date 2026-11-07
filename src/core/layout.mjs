// 3.8: the names of the workspace (C:\Orb by default) in one place, without Node, so the window shows the same folders
// the engine creates. The workspace holds:
//   core\                                    Orb's own folder, hidden (src/core/home.mjs › paths)
//   windows\ linux\ ios\ android\ web\       one folder per project
//   multi\<project>\{<platform>…, compartido}  a multiplatform project: one folder, one repository
export const CORE_DIR = 'core';
export const PLATFORMS = ['windows', 'linux', 'ios', 'android', 'web'];
export const MULTI = 'multi';
export const CATEGORIES = [...PLATFORMS, MULTI];
export const DEFAULT_CATEGORY = 'web';
// What the platforms of a multiplatform project share (API, design, texts, images).
export const SHARED_DIR = 'compartido';
