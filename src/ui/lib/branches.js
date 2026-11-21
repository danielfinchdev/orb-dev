// The branches the git menu lists: the current one always first (also when it is one of Orb's own), then the others
// but Orb's own, which belong to its tasks.
export function branchList(branches, current) {
  const all = branches ?? [];
  const here = all.find((b) => b.current) ?? all.find((b) => b.name === current) ?? (current ? { name: current } : null);
  return [...(here ? [{ ...here, current: true }] : []), ...all.filter((b) => b !== here && b.name !== here?.name && !b.orb)].slice(0, 30);
}
