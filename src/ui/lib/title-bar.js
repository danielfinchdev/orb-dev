// 2.6: the window's minimise / maximise / close buttons (Windows' own, drawn inside the app) take the colour of the top
// bar they sit on and follow the theme, light or dark mode and the window width (narrow: the menu bar is the top one).
// Only in the PC app: a browser (the phone) has no such buttons.
let canvas = null;
// Any CSS colour (the themes use oklch) as #rrggbb, which is what Windows takes.
function toHex(css, dim = 0) {
  canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = '#000'; canvas.fillStyle = css;
  canvas.fillRect(0, 0, 1, 1);
  if (dim) { canvas.fillStyle = `rgb(0 0 0 / ${dim})`; canvas.fillRect(0, 0, 1, 1); }
  const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

export function followTitleBar() {
  if (typeof window.orb?.titleBar !== 'function') return () => {};
  const wide = matchMedia('(min-width: 768px)');
  let last = '';
  const send = () => {
    const css = getComputedStyle(document.documentElement);
    // --titlebar-color: a screen with its own backdrop (the welcome sky) says which colour is behind the buttons.
    // A window open over the app (Ajustes, the games…) darkens the page: the buttons darken with it.
    const dim = document.querySelector('[data-slot="dialog-overlay"][data-state="open"]') ? 0.45 : 0;
    const color = toHex(css.getPropertyValue('--titlebar-color').trim() || css.getPropertyValue(wide.matches ? '--background' : '--sidebar').trim() || '#ffffff', dim);
    const symbolColor = toHex(css.getPropertyValue('--foreground').trim() || '#000000');
    if (`${color}${symbolColor}` === last) return;
    last = `${color}${symbolColor}`;
    Promise.resolve(window.orb.titleBar({ color, symbolColor })).catch(() => {});
  };
  // The theme changes the classes and data-* of <html> (dark, data-skin…).
  const watch = new MutationObserver(send);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-skin', 'data-theme', 'style'] });
  wide.addEventListener('change', send);
  // Dialogs are mounted at the end of <body> and open or close by their data-state.
  const dialogs = new MutationObserver(send);
  dialogs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
  send();
  return () => { watch.disconnect(); dialogs.disconnect(); wide.removeEventListener('change', send); };
}
