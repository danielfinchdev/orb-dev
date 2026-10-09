// Syntax highlighting (Ajustes → Apariencia → colores del código): the chat's code blocks (rehype-highlight, used by
// markdown.jsx) and the expert mode's file viewer and diff (highlightLines). Only common languages are bundled, to keep
// the app light; anything else is shown as plain text. The colours are CSS (code.css), chosen with data-code-theme.
// The output is always React elements or hast for react-markdown: never raw HTML. Loaded on demand (use-highlight.js).
import { createLowlight } from 'lowlight';
import rehypeHighlight from 'rehype-highlight';
import bash from 'highlight.js/lib/languages/bash';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

// Each grammar brings its own aliases too (js, jsx, ts, tsx, html, svg, sh, zsh, ps1, py, cs, rs, yml, md, toml…).
export const LANGUAGES = { bash, csharp, css, diff, dockerfile, go, ini, java, javascript, json, markdown, powershell, python, rust, sql, typescript, xml, yaml };
export const ALIASES = { bash: ['console', 'shell', 'shellsession', 'terminal'], css: ['scss', 'less'], json: ['jsonc', 'json5'], xml: ['vue', 'svelte', 'xaml'] };

const lowlight = createLowlight(LANGUAGES);
lowlight.registerAlias(ALIASES);

// For react-markdown. Only blocks that say their language (```js) are coloured: guessing it is slow while a reply is
// being written, and often wrong.
export const rehypePlugins = [[rehypeHighlight, { languages: LANGUAGES, aliases: ALIASES, detect: false }]];

// File name → language of the expert viewer (null: plain text).
const BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json',
  css: 'css', scss: 'css', less: 'css',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', xaml: 'xml', csproj: 'xml', props: 'xml', targets: 'xml', plist: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  py: 'python', pyw: 'python', pyi: 'python',
  cs: 'csharp', csx: 'csharp',
  java: 'java', go: 'go', rs: 'rust', sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  diff: 'diff', patch: 'diff',
  ini: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', editorconfig: 'ini', gitconfig: 'ini', npmrc: 'ini'
};
export function languageFor(file) {
  const name = String(file ?? '').split(/[\\/]/).pop().toLowerCase();
  if (!name) return null;
  if (name === 'dockerfile' || name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) return 'dockerfile';
  const dot = name.lastIndexOf('.');
  return BY_EXT[dot >= 0 ? name.slice(dot + 1) : name] ?? null;
}

// Big files stay plain: highlighting half a megabyte would freeze the window for a moment.
export const MAX_HIGHLIGHT = 200 * 1024;

const plainLines = (text) => text.split('\n').map((line) => (line ? [line] : []));

// The highlighted text cut into lines (one array of React nodes per line), so the viewer can number them. A token that
// spans several lines (a block comment, a template string) keeps its colour on each of them. h: React's createElement,
// passed in by the caller so this chunk, loaded later, does not split React into a chunk of its own.
export function highlightLines(text, lang, h) {
  const source = String(text ?? '');
  if (!lang || source.length > MAX_HIGHLIGHT || !lowlight.registered(lang)) return plainLines(source);
  let tree;
  try { tree = lowlight.highlight(lang, source); } catch { return plainLines(source); }
  const lines = [[]];
  let key = 0;
  const walk = (node, chain) => {
    if (node.type === 'text') {
      node.value.split('\n').forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (!part) return;
        const line = lines[lines.length - 1];
        // The classes of every enclosing token, outermost first (themes may style ".hljs-meta .hljs-string").
        line.push(chain.length ? chain.reduceRight((child, cls, j) => h('span', j === 0 ? { key: key++, className: cls } : { className: cls }, child), part) : part);
      });
      return;
    }
    const cls = node.properties?.className;
    const next = Array.isArray(cls) && cls.length ? [...chain, cls.join(' ')] : chain;
    for (const child of node.children ?? []) walk(child, next);
  };
  walk(tree, []);
  return lines;
}

// One line on its own (the diff: its lines come from different places of the file, so they are coloured one by one).
export function highlightLine(text, lang, h) {
  return highlightLines(text, lang, h)[0] ?? [];
}
