// The plain Web Audio context: Android's WebView has no setSinkId trick to need.
export function quietAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { return { ctx: new AC(), ready: () => true }; } catch { return null; }
}
