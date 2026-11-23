// Prints the recovery code on paper. The page itself is printed with everything but one sheet hidden (a hidden frame would
// need the app's frame rules loosened), and the sheet is removed as soon as printing ends. The code lives in the sheet's text only.
const SHEET = 'orb-print-code';
// The CSS that leaves only the sheet in the printout (and keeps it off the screen).
export const printCss = () => `@media screen{#${SHEET}{display:none!important}}@media print{body>*:not(#${SHEET}){display:none!important}#${SHEET}{display:block!important;padding:24mm 18mm;color:#000;background:#fff;font-family:system-ui,sans-serif}}`;

export function printCode(code, { title = '', note = '' } = {}) {
  if (typeof document === 'undefined' || typeof window?.print !== 'function') return false;
  const style = document.createElement('style');
  style.textContent = printCss();
  const sheet = document.createElement('div');
  sheet.id = SHEET;
  const h = document.createElement('h1'); h.textContent = title; h.style.cssText = 'font-size:20pt;margin:0 0 8mm';
  const c = document.createElement('p'); c.textContent = code; c.style.cssText = 'font-family:ui-monospace,Consolas,monospace;font-size:18pt;font-weight:600;letter-spacing:.06em;word-break:break-all;margin:0 0 8mm';
  const n = document.createElement('p'); n.textContent = note; n.style.cssText = 'font-size:11pt;margin:0';
  sheet.append(h, c, n);
  const clean = () => { style.remove(); sheet.remove(); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean);
  document.head.append(style); document.body.append(sheet);
  try { window.print(); } catch { clean(); return false; }
  // Some webviews never send «afterprint»: the sheet cannot stay in the page for long.
  setTimeout(clean, 120_000);
  return true;
}
