// 3.8.2 (D3): which microphone the message box offers. → 'windows' | 'web' | null
// - Orb for Windows: Windows' own voice typing (Win+H, opened by Rust: src-tauri/src/desktop.rs › dictate).
// - A phone (Orb's Android app or a phone's browser): none; the phone's keyboard has its own dictation.
// - A computer's browser linked to Orb: the browser's speech recognition, when it has one.
export function micMode({ desktop = false, windowsDictation = false, androidApp = false, mobile = false, coarse = false, webSpeech = false } = {}) {
  if (desktop) return windowsDictation ? 'windows' : null;
  if (androidApp || (mobile && coarse)) return null;
  return webSpeech ? 'web' : null;
}
