// Pure geometry of the conversation trail (the tick rail at the left edge of a transcript).
// Kept free of the DOM so the maths can be tested on its own.

export const TICK_PITCH = 10; // distance between tick centres, in px
export const TICK_REST = 6; // tick width at rest
export const TICK_MAX = 30; // tick width under the pointer
export const READ_OFFSET = 24; // a message counts as "being read" once its top is within this of the viewport top
export const MIN_GUTTER = 56; // narrowest left gutter that can hold the rail without touching the text
export const COLUMN_MAX = 768; // the chat column (max-w-3xl)
export const PREVIEW_MAX = 280;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Gaussian spread of the magnification, wider for roomy rails and never tighter than 8 px.
export function sigmaFor(spacing = TICK_PITCH) {
  return clamp(spacing * 1.5, Math.min(spacing * 2, 8), 22);
}

// Weight (0..1) of a tick `distance` px away from the pointer.
export function gaussian(distance, sigma = sigmaFor()) {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

export function tickCenter(index, spacing = TICK_PITCH) {
  return index * spacing + spacing / 2;
}

// Index of the tick nearest to a y position measured from the top of the tick list.
export function nearestIndex(y, count, spacing = TICK_PITCH) {
  if (count <= 0) return -1;
  return clamp(Math.floor(y / spacing), 0, count - 1);
}

// Width of every tick while the pointer is at y.
export function magnify(y, count, { spacing = TICK_PITCH, rest = TICK_REST, max = TICK_MAX } = {}) {
  const sigma = sigmaFor(spacing);
  const widths = new Array(count);
  for (let i = 0; i < count; i += 1) widths[i] = rest + (max - rest) * gaussian(y - tickCenter(i, spacing), sigma);
  return widths;
}

// The message being read: the last one whose top is at or above the viewport top plus the offset; the first when above all.
export function readingIndex(tops, offset = READ_OFFSET) {
  let found = 0;
  for (let i = 0; i < tops.length; i += 1) { if (tops[i] <= offset) found = i; else break; }
  return found;
}

// Top of the card so it stays inside the rail: centred on the tick, then clamped.
export function cardTop(center, cardHeight, railHeight) {
  return clamp(center - cardHeight / 2, 0, Math.max(0, railHeight - cardHeight));
}

// True when the space left of the centred column is wide enough for the rail.
export function gutterFits(containerWidth, column = COLUMN_MAX, min = MIN_GUTTER) {
  return (containerWidth - Math.min(containerWidth, column)) / 2 >= min;
}

export function collapse(text, max = PREVIEW_MAX) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
