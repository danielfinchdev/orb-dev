// Draws one mermaid diagram or one formula for the chats of the app. The text comes from an assistant, so it is untrusted:
// the markup shown is only what mermaid (strict) or KaTeX (trust off) return, never something assembled here.
//   app -> page: window.orbReceive({type:'render', kind:'mermaid'|'math', source, display, seq})
//   page -> app: OrbHost.post(JSON) with {type:'ready'} | {type:'size', seq, height} | {type:'failed', seq}
const params = new URLSearchParams(location.search);
const dark = params.get('theme') === 'dark';
if (dark) document.documentElement.classList.add('dark');

const MAX_SOURCE = 20000;
const RENDER_TIMEOUT_MS = 10000;
const out = document.getElementById('out');

const post = (obj) => {
  try { if (window.OrbHost && typeof window.OrbHost.post === 'function') window.OrbHost.post(JSON.stringify(obj)); } catch { /* the app is gone */ }
};

let katexLoad = null;
const loadKatex = () => (katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default ?? m));

let mermaidLoad = null;
let mermaidReady = false;
const loadMermaid = () => (mermaidLoad ??= import('mermaid').then((m) => {
  const mermaid = m.default ?? m;
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'sans-serif',
    htmlLabels: false, flowchart: { htmlLabels: false }
  });
  mermaidReady = true;
  return mermaid;
}));

let counter = 0;
async function drawMermaid(source) {
  const mermaid = await loadMermaid();
  const id = `mmd-${++counter}`;
  try {
    const r = await mermaid.render(id, source);
    document.getElementById(`d${id}`)?.remove();
    out.innerHTML = r.svg; // mermaid's own sanitised SVG
    // Its width is 100% of a shrink-to-fit box (zero height): give it the natural size from the viewBox instead.
    const el = out.querySelector('svg');
    const vb = el && el.viewBox && el.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      el.style.maxWidth = 'none';
      el.setAttribute('width', String(Math.ceil(vb.width)));
      el.setAttribute('height', String(Math.ceil(vb.height)));
    }
  } catch (e) {
    // A failed render can leave its scratch element in the body.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
    throw e;
  }
}

async function drawMath(source, display) {
  const katex = await loadKatex();
  out.innerHTML = katex.renderToString(source, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxSize: 50, maxExpand: 1000, output: 'htmlAndMathml' });
}

const withTimeout = (p) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), RENDER_TIMEOUT_MS);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

// One render at a time (mermaid keeps global state); a message older than the newest seq is dropped.
let newest = -1;
let queue = Promise.resolve();

function validate(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type !== 'render') return null;
  if (msg.kind !== 'mermaid' && msg.kind !== 'math') return null;
  if (typeof msg.source !== 'string' || msg.source.length === 0 || msg.source.length > MAX_SOURCE) return null;
  if (!Number.isSafeInteger(msg.seq) || msg.seq < 0) return null;
  return { kind: msg.kind, source: msg.source, display: msg.display !== false, seq: msg.seq };
}

const measure = () => Math.ceil(Math.max(out.getBoundingClientRect().height, out.scrollHeight));

async function run(job) {
  if (job.seq < newest) return;
  try {
    await withTimeout(job.kind === 'mermaid' ? drawMermaid(job.source) : drawMath(job.source, job.display));
    if (job.seq < newest) return;
    // Fonts and layout settle a frame later; a page that is not visible never gets frames, so the wait is capped.
    await new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 120); });
    post({ type: 'size', seq: job.seq, height: measure() });
  } catch {
    if (job.seq >= newest) { out.textContent = ''; post({ type: 'failed', seq: job.seq }); }
  }
}

window.orbReceive = (msg) => {
  const job = validate(msg);
  if (!job) return;
  if (job.seq < newest) return;
  newest = job.seq;
  queue = queue.then(() => run(job), () => run(job));
};

post({ type: 'ready' });
