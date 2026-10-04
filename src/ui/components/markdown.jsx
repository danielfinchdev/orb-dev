// Markdown written by the assistant and the agents. Raw HTML is never rendered; links open outside the app (https only).
import ReactMarkdown from 'react-markdown';
import { bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';

const components = {
  a: ({ href, children }) => <a onClick={(e) => { e.preventDefault(); if (/^https:\/\//.test(href ?? '')) bridge.openExternal(href).catch(() => {}); }}>{children}</a>,
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || 'imagen'}]</span>
};

export function Markdown({ children, className }) {
  return <div className={cn('prose-chat', className)}><ReactMarkdown skipHtml components={components}>{String(children ?? '')}</ReactMarkdown></div>;
}
