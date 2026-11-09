// 3.8.2 (T3 3.11): «Señalar elemento» in the little window of the agents' browser. The user clicks on the page's
// picture; the engine finds what is there (in Orb's isolated world of the page, never the page's own scripts' world)
// and takes a small picture of it, which go to that chat's message box (the user decides whether to send them).
// What the page says is data: a short CSS selector, at most 300 characters of its text.
import { VIEW } from '../core/browser-protocol.mjs';

const PAD = 8;

// The script for (x, y) of the view (CSS pixels). → { selector, tag, text, rect: { x, y, width, height } } | null
export const pointScript = (x, y) => `(() => {
  const el = document.elementFromPoint(${Number(x)}, ${Number(y)});
  if (!el || el === document.documentElement) return null;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\\w-]/g, '\\\\$&'));
  const part = (e) => {
    if (e.id && document.querySelectorAll('#' + esc(e.id)).length === 1) return { s: '#' + esc(e.id), done: true };
    const tag = e.tagName.toLowerCase(); const p = e.parentElement;
    if (!p) return { s: tag, done: true };
    const same = [...p.children].filter((c) => c.tagName === e.tagName);
    return { s: same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(e) + 1) + ')' : tag, done: tag === 'body' };
  };
  const parts = [];
  for (let e = el, n = 0; e && n < 6; e = e.parentElement, n++) { const p = part(e); parts.unshift(p.s); if (p.done) break; }
  const r = el.getBoundingClientRect();
  const text = String(el.innerText || el.value || el.getAttribute('aria-label') || el.alt || el.title || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
  return { selector: parts.join(' > ').slice(0, 300), tag: el.tagName.toLowerCase(), text, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
})()`;

// The part of the page to photograph: the element and a margin, inside the view, at least 16 px. → clip in page pixels
export function clipOf(rect, scroll = { pageX: 0, pageY: 0 }) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const x0 = Math.max(0, n(rect?.x) - PAD); const y0 = Math.max(0, n(rect?.y) - PAD);
  const x1 = Math.min(VIEW.width, Math.max(x0 + 16, n(rect?.x) + n(rect?.width) + PAD));
  const y1 = Math.min(VIEW.height, Math.max(y0 + 16, n(rect?.y) + n(rect?.height) + PAD));
  return { x: Math.round(x0 + n(scroll.pageX)), y: Math.round(y0 + n(scroll.pageY)), width: Math.max(1, Math.round(x1 - x0)), height: Math.max(1, Math.round(y1 - y0)), scale: 1 };
}

// fx, fy: where the user clicked, as fractions of the picture. world(tab, code): the driver's isolated world.
// → { selector, tag, text, url, png: Buffer } | null (nothing there)
export async function pointAt(tab, fx, fy, world) {
  if (![fx, fy].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  const info = await world(tab, pointScript(Math.round(fx * VIEW.width), Math.round(fy * VIEW.height)));
  if (!info || typeof info !== 'object') return null;
  const m = await tab.page.send('Page.getLayoutMetrics').catch(() => null);
  const vp = m?.cssVisualViewport ?? m?.visualViewport ?? { pageX: 0, pageY: 0 };
  const { data } = await tab.page.send('Page.captureScreenshot', { format: 'png', clip: clipOf(info.rect, vp) });
  return { selector: String(info.selector ?? '').slice(0, 300), tag: String(info.tag ?? '').slice(0, 30), text: String(info.text ?? '').slice(0, 300), url: String(tab.url ?? '').slice(0, 2048), png: Buffer.from(String(data ?? ''), 'base64') };
}
