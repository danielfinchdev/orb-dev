// Markdown written by the assistant and the agents. Raw HTML is never rendered; links open outside the app (https only).
// Code blocks that say their language (```js) are coloured with the theme of Ajustes → Apariencia (code.css).
import ReactMarkdown from 'react-markdown';
import { bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t } from '@/lib/i18n.js';
import { useHighlight } from '@/lib/use-highlight.js';
// The whole window's fonts and code colours (Ajustes → Apariencia): loaded here, after app.css, which main.jsx imports first.
import '../fonts.css';
import '../code.css';

const components = {
  a: ({ href, children }) => <a onClick={(e) => { e.preventDefault(); if (/^https:\/\//.test(href ?? '')) bridge.openExternal(href).catch(() => {}); }}>{children}</a>,
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || t('comp.markdown.image')}]</span>
};

const FENCE_WITH_LANGUAGE = /(^|\n)[ \t]*(```|~~~)[ \t]*[\w#+.-]/;

export function Markdown({ children, className }) {
  const text = String(children ?? '');
  const hl = useHighlight(FENCE_WITH_LANGUAGE.test(text));
  return <div className={cn('prose-chat', className)}><ReactMarkdown skipHtml components={components} rehypePlugins={hl?.rehypePlugins}>{text}</ReactMarkdown></div>;
}
