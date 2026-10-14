// Markdown written by the assistant and the agents. Raw HTML is never rendered; links open outside the app (https only).
// 3.2.1: a link to a picture on this PC (an agent's "Ver imagen editada") opens Orb's image viewer; any other local path
// stays a plain text link (nothing an agent writes is ever opened or run).
// Code blocks that say their language (```js) are coloured with the theme of Ajustes → Apariencia (code.css).
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
// GFM: tables, ~~strikethrough~~, - [ ] task lists and bare links, as the agents write them.
import remarkGfm from 'remark-gfm';
import { bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t } from '@/lib/i18n.js';
import { useHighlight } from '@/lib/use-highlight.js';
import { openImage } from './image-viewer.jsx';
// The whole window's fonts and code colours (Ajustes → Apariencia): loaded here, after app.css, which main.jsx imports first.
import '../fonts.css';
import '../code.css';

// "C:\…\x.png", "C:/…/x.png", "/C:/…/x.png" or "file:///C:/…/x.png" → "C:\…\x.png"; anything else → null.
export function localImagePath(href) {
  let s = String(href ?? '').trim();
  try { s = decodeURI(s); } catch { /* as it is */ }
  s = s.replace(/^file:\/{2,3}/i, '').replace(/^\/(?=[A-Za-z]:[\\/])/, '');
  if (!/^[A-Za-z]:[\\/]/.test(s) || !/\.(png|jpe?g|webp|gif)$/i.test(s)) return null;
  return s.replace(/\//g, '\\');
}
const urlTransform = (url) => (localImagePath(url) ? url : defaultUrlTransform(url));

const components = {
  a: ({ href, children }) => <a onClick={(e) => { e.preventDefault(); const local = localImagePath(href); if (local) openImage(local); else if (/^https:\/\//.test(href ?? '')) bridge.openExternal(href).catch(() => {}); }}>{children}</a>,
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || t('comp.markdown.image')}]</span>,
  // A wide table scrolls on its own instead of widening the chat (narrow window, mobile).
  table: ({ children }) => <div className="prose-table"><table>{children}</table></div>
};

const remarkPlugins = [remarkGfm];

const FENCE_WITH_LANGUAGE = /(^|\n)[ \t]*(```|~~~)[ \t]*[\w#+.-]/;

export function Markdown({ children, className }) {
  const text = String(children ?? '');
  const hl = useHighlight(FENCE_WITH_LANGUAGE.test(text));
  return <div className={cn('prose-chat', className)}><ReactMarkdown skipHtml components={components} remarkPlugins={remarkPlugins} rehypePlugins={hl?.rehypePlugins} urlTransform={urlTransform}>{text}</ReactMarkdown></div>;
}
