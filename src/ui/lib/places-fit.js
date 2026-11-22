// How many of the sidebar's places fit in a row: each keeps at least `min` px and the gap between them never shrinks, so
// what does not fit goes behind the «…» button (which takes `moreW` px) instead of squeezing or touching its neighbours.
export function placesFit(width, total, { min = 60, gap = 3, moreW = 28, forceMore = false } = {}) {
  const row = (n) => n * min + (n - 1) * gap;
  if (!forceMore && row(total) <= width) return total;
  let k = total - (forceMore ? 0 : 1);
  while (k > 1 && row(k) + gap + moreW > width) k--;
  return Math.max(1, Math.min(k, total));
}
