// Markdown written by the assistant and the agents. Raw HTML is never rendered; links open outside the app (https only).
// 3.2.1: a link to a picture on this PC (an agent's "Ver imagen editada") opens Orb's image viewer; any other local path
// stays a plain text link (nothing an agent writes is ever opened or run).
// Code blocks that say their language (```js) are coloured with the theme of Ajustes → Apariencia (code.css).
// 3.8.2: formulas between $$ (one $ stays a dollar: amounts like «$5 and $10» read as before) and ```mermaid diagrams
// (rich-blocks.jsx, each library loaded only when needed).
import { memo, useEffect, useMemo, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { remarkPlugins, richKind, isInlineMath, textOf } from '@/lib/markdown-plugins.js';
import { splitBlocks } from '@/lib/md-blocks.js';
import { createReveal, safeMarkdown, wantsStill, onFrame, noteShown, takeShown } from '@/lib/typing.js';
import { MathBlock, MermaidBlock } from './rich-blocks.jsx';
import { bridge, fullPc, getState } from '@/lib/store.js';
import { pasteToTerminal, oneCommand, SHELL_LANGUAGES } from '@/lib/terminal-paste.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { useHighlight } from '@/lib/use-highlight.js';
import { openImage } from './image-viewer.jsx';
import { Tip } from './ui/overlay.jsx';
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

// 3.8.2 (T3 3.2): a block of terminal commands (```bash, powershell…) gets «Pegar en el terminal» on the PC: the command
// goes to the input line of the terminal under the chat (it never runs until the user presses Enter); with no terminal
// there, it is copied.
function PasteToTerminal({ code }) {
  const t = useT();
  const paste = () => {
    const line = oneCommand(code);
    if (pasteToTerminal(line)) return;
    navigator.clipboard?.writeText(line).then(() => toast.success(t('terminal.copied'))).catch(() => {});
  };
  return <Tip label={t('terminal.paste')}><button type="button" className="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 grid size-7 cursor-pointer place-items-center rounded-md opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5" aria-label={t('terminal.paste')} onClick={paste}><SquareTerminal /></button></Tip>;
}
const languageOf = (code) => String([].concat(code?.properties?.className ?? []).find((c) => String(c).startsWith('language-')) ?? '').slice(9).toLowerCase();

// A picture in the text is shown as its description; the word for it follows the language (the Markdown is memoised).
function ImageAlt({ alt }) { const t = useT(); return <span className="text-muted-foreground">[{alt || t('comp.markdown.image')}]</span>; }

const components = {
  a: ({ href, children }) => <a onClick={(e) => { e.preventDefault(); const local = localImagePath(href); if (local) openImage(local); else if (/^https:\/\//.test(href ?? '')) bridge.openExternal(href).catch(() => {}); }}>{children}</a>,
  img: ({ alt }) => <ImageAlt alt={alt} />,
  // A wide table scrolls on its own instead of widening the chat (narrow window, mobile).
  table: ({ children }) => <div className="prose-table"><table>{children}</table></div>,
  // 3.8.2: a formula (remark-math marks it language-math) or a diagram block; any other code as before.
  pre: ({ node, children, ...props }) => {
    const kind = richKind(node?.children?.[0]);
    if (kind === 'math') return <MathBlock tex={textOf(node.children[0])} display />;
    if (kind === 'mermaid') return <MermaidBlock code={textOf(node.children[0]).replace(/\n$/, '')} />;
    const code = node?.children?.[0];
    if (fullPc() && SHELL_LANGUAGES.has(languageOf(code))) return <div className="group relative"><pre {...props}>{children}</pre><PasteToTerminal code={textOf(code)} /></div>;
    return <pre {...props}>{children}</pre>;
  },
  code: ({ node, children, className, ...props }) => (isInlineMath(node) ? <MathBlock tex={textOf(node)} /> : <code className={className} {...props}>{children}</code>)
};

const FENCE_WITH_LANGUAGE = /(^|\n)[ \t]*(```|~~~)[ \t]*[\w#+.-]/;

// The Markdown of one text, without a box of its own (react-markdown draws its elements straight into the parent).
const Parsed = memo(function Parsed({ text }) {
  const hl = useHighlight(FENCE_WITH_LANGUAGE.test(text));
  return <ReactMarkdown skipHtml components={components} remarkPlugins={remarkPlugins} rehypePlugins={hl?.rehypePlugins} urlTransform={urlTransform}>{text}</ReactMarkdown>;
});

// Memoised on its text: a message drawn again (the list refreshed, the view re-rendered) is not parsed again.
export const Markdown = memo(function Markdown({ children, className }) {
  return <div className={cn('prose-chat', className)}><Parsed text={String(children ?? '')} /></div>;
});

// 3.8.3: an answer still streaming: block by block (lib/md-blocks.js), so the finished blocks keep what they drew and only
// the last one is parsed again with each piece. The same elements, in the same box, as Markdown draws for the whole text.
export function StreamingMarkdown({ children, className }) {
  const blocks = splitBlocks(children);
  return <div className={cn('prose-chat', className)}>{blocks.map((text, i) => <Parsed key={i} text={text} />)}</div>;
}

// 3.8.3: an answer being typed (lib/typing.js): the text on screen follows the streamed one at a steady pace, a character
// at a time, block by block like StreamingMarkdown (only the last block is parsed again, never the list of messages).
//   text     everything received so far        done      the turn has ended (what is left shows quickly)
//   tail     the conversation's key: what is on screen is noted, so the saved message goes on from there (TypedMarkdown)
//   start    how much is already on screen (a new answer starts at 0; one already long when it mounts —a chat opened
//            while it streams— shows at once, and only what comes after is typed)
// One frame loop for all (typing.js › onFrame). If drawing the last block gets slow (a long code block), it is drawn every
// few frames instead of every frame, so typing never slows the window. Less motion (system or «Movimiento: mínimo»): the
// text shows at once. Screen readers hear each block once it is whole (announce), not every character.
const FIRST_TYPED = 400;
export function TypingMarkdown({ text, done = false, tail = null, start = null, className, ...props }) {
  const [rev] = useState(() => createReveal({ reduced: wantsStill(getState().app?.config?.ui?.motion), start: start ?? (String(text ?? '').length > FIRST_TYPED ? String(text).length : 0) }));
  const [, draw] = useReducer((x) => x + 1, 0);
  const cost = useRef({ at: 0, ms: 0 });
  rev.setTarget(String(text ?? ''), done);
  const shown = rev.shown;
  const complete = done && shown >= rev.target.length;
  useEffect(() => {
    if (rev.shown >= rev.target.length) return undefined;
    let since = 0;
    const off = onFrame((dt) => {
      since += dt;
      const before = rev.shown;
      rev.advance(document.hidden ? 1e9 : dt);
      const end = rev.shown >= rev.target.length;
      if (rev.shown !== before && (end || since >= (cost.current.ms > 4 ? cost.current.ms * 2 : 0))) { since = 0; cost.current.at = performance.now(); draw(); }
      if (end) off();
    });
    return off;
  }, [text, done]);
  useLayoutEffect(() => {
    if (cost.current.at) { const ms = performance.now() - cost.current.at; cost.current = { at: 0, ms: cost.current.ms * 0.7 + ms * 0.3 }; }
    if (tail != null) noteShown(tail, rev.target.slice(0, rev.shown));
  });
  const blocks = splitBlocks(rev.target.slice(0, shown));
  const all = useMemo(() => (tail == null ? null : splitBlocks(rev.target)), [tail, rev.target]);
  useAnnounce(tail, all, complete);
  return (
    <div className={cn('prose-chat', !complete && 'typing', className)} aria-busy={!complete || undefined} {...props}>
      {blocks.map((b, i) => <Parsed key={i} text={i === blocks.length - 1 ? safeMarkdown(b, complete) : b} />)}
    </div>
  );
}

// The saved answer of the assistant or an agent. Just after its live answer was typed on screen, it goes on typing from
// where that one was (quickly: the turn has ended); otherwise (history, a reload, a chat opened later) drawn whole.
export const TypedMarkdown = memo(function TypedMarkdown({ children, className, tail }) {
  const body = String(children ?? '');
  const [from] = useState(() => takeShown(body, tail));
  if (!from) return <Markdown className={className}>{body}</Markdown>;
  return <TypingMarkdown text={body} done start={from.start} tail={from.tail} className={className} />;
});

// Screen readers: one polite live region for the whole window; each block of an answer is read once, when it is whole
// (the last one when the turn ends), as plain words.
const announced = new Map(); // tail key → blocks already read
const reading = new Map(); // tail key → how many answers on screen use it
let region = null;
function say(text) {
  if (typeof document === 'undefined' || !text) return;
  if (!region) { region = document.createElement('div'); region.className = 'sr-only'; region.setAttribute('aria-live', 'polite'); region.setAttribute('data-testid', 'typing-announcer'); document.body.append(region); }
  const p = document.createElement('p'); p.textContent = text; region.append(p);
  while (region.childNodes.length > 6) region.firstChild.remove();
}
const plainWords = (md) => md.replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_~`#>|]+/g, ' ').replace(/\s+/g, ' ').trim();
function useAnnounce(tail, blocks, complete) {
  // A live answer that never completes (its saved message did not take its place) must not leave its count behind, or
  // the next answer of that chat would skip its first blocks for screen readers. The saved message mounts in the same
  // commit as the live one unmounts, so the count is only dropped once nobody uses the key any more.
  useEffect(() => {
    if (tail == null) return undefined;
    reading.set(tail, (reading.get(tail) ?? 0) + 1);
    return () => { const n = (reading.get(tail) ?? 1) - 1; if (n > 0) reading.set(tail, n); else { reading.delete(tail); setTimeout(() => { if (!reading.has(tail)) announced.delete(tail); }, 1000); } };
  }, [tail]);
  useEffect(() => {
    if (tail == null || !blocks) return;
    const whole = complete ? blocks.length : blocks.length - 1;
    const had = announced.get(tail) ?? 0;
    for (let i = had; i < whole; i++) say(plainWords(blocks[i]));
    if (complete) announced.delete(tail); else if (whole > had) announced.set(tail, whole);
  });
}
