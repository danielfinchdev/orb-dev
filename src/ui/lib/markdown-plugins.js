// The Markdown of the messages (components/markdown.jsx): GFM (tables, ~~strikethrough~~, - [ ] task lists and bare
// links, as the agents write them) and, 3.8.2, formulas between $$. One $ stays a dollar, so amounts like «$5 and $10»
// read as before.
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];

// What a code element of the rendered tree is: a formula (remark-math marks it language-math), a ```mermaid diagram or
// other code (null).
const classes = (el) => (Array.isArray(el?.properties?.className) ? el.properties.className : []);
export const richKind = (el) => (el?.tagName !== 'code' ? null : classes(el).includes('language-math') ? 'math' : classes(el).includes('language-mermaid') ? 'mermaid' : null);
export const isInlineMath = (el) => richKind(el) === 'math' && classes(el).includes('math-inline');
export const textOf = (el) => (el?.type === 'text' ? el.value : (el?.children ?? []).map(textOf).join(''));
