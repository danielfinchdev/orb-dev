// Which HTML pages of a chat may be mounted as a live frame. Frames of one window can reach each other
// (parent.frames, postMessage), so a page without internet must never sit beside one that has it: while any page has
// internet, only the first of those is mounted and the rest wait as cards. Otherwise all of them are mounted.
export function mountable(pages) {
  const list = Array.isArray(pages) ? pages : [];
  const net = list.find((p) => p?.internet === true);
  return new Set(net ? [net.id] : list.map((p) => p.id));
}
