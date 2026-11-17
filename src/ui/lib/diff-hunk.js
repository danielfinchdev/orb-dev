// First old and new line numbers of a unified-diff hunk header: "@@ -3,5 +7,6 @@" → [3, 7]. The counts are optional
// ("@@ -0,0 +1 @@" is a one-line new file), and a header that does not parse starts at [0, 0].
export const hunkStart = (l) => {
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};
