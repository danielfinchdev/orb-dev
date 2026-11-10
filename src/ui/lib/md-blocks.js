// 3.8.3: an answer that is still streaming, cut into its top-level Markdown blocks, so that only the last one (the one
// still growing) is parsed again with each piece (components/markdown.jsx › StreamingMarkdown; T3 Code does the same).
// A cut is made only at a blank line outside a code fence or a $$ formula, before a line that starts at the margin
// (an indented line continues a list item or is code): every block then renders as it would inside the whole text.
// No React here (test/fluidez-ui.test.mjs).
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function splitBlocks(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let current = []; let fence = null; let math = false; let blank = false;
  for (const line of lines) {
    if (!fence && !math && blank && line.trim() && !/^[ \t]/.test(line) && current.some((l) => l.trim())) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
    const f = line.match(FENCE);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null; }
    else if (f) fence = f[1];
    else if (/^ {0,3}\$\$/.test(line)) { if (!(math === false && /\$\$\s*$/.test(line.trim().slice(2)))) math = !math; }
    blank = !line.trim();
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}
