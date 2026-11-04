// 3.6: the Android app's «glass» look (docs/DESIGN-SYSTEM.md › Android glass). Loaded only by the Android build
// (`vite build --mode android`, see main.jsx): the PC window and a phone's browser never get it. It turns on the layer
// (html.glass) and, on a modest phone, its light version (html.glass-lite): the same translucent surfaces, but no
// backdrop blur at all, which is what costs frames in an Android WebView. The CSS also drops the blur by itself when the
// system asks for less transparency or more contrast, or when the WebView cannot blur.
import '../glass.css';

// A phone with few cores or little memory, or one that asked to save data: no blur.
export function modestDevice(nav = globalThis.navigator) {
  if (!nav) return false;
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 3 || nav.connection?.saveData === true;
}

export function enableGlass(root = document.documentElement) {
  root.classList.add('glass');
  root.classList.toggle('glass-lite', modestDevice());
}
