/** Minimal line-based diff used by the editor's Diff view. */

export interface DiffLine {
  type: "same" | "add" | "del";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

/**
 * Fallback for very large inputs: match the common prefix and suffix, then
 * collapse everything in between into a single remove + add block. Keeps the
 * diff view responsive for big files where the O(n·m) LCS table would blow up.
 */
function coarseDiff(a: string[], b: string[]): DiffLine[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < start; i++) {
    lines.push({ type: "same", oldLine: oldLine++, newLine: newLine++, text: a[i] });
  }
  for (let i = start; i < endA; i++) {
    lines.push({ type: "del", oldLine: oldLine++, newLine: null, text: a[i] });
  }
  for (let i = start; i < endB; i++) {
    lines.push({ type: "add", oldLine: null, newLine: newLine++, text: b[i] });
  }
  for (let i = endA; i < a.length; i++) {
    lines.push({ type: "same", oldLine: oldLine++, newLine: newLine++, text: a[i] });
  }
  return lines;
}

/**
 * Unified-style, line-based diff between two texts computed with an LCS table.
 * Both texts are split on "\n" (a trailing newline yields a final empty line,
 * which keeps line numbering truthful for files ending with a newline).
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");

  if (a.length * b.length > 2_500_000) return coarseDiff(a, b);

  // LCS length table (bottom-up, reverse order).
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: "same", oldLine: oldLine++, newLine: newLine++, text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: "del", oldLine: oldLine++, newLine: null, text: a[i] });
      i++;
    } else {
      lines.push({ type: "add", oldLine: null, newLine: newLine++, text: b[j] });
      j++;
    }
  }
  while (i < a.length) {
    lines.push({ type: "del", oldLine: oldLine++, newLine: null, text: a[i] });
    i++;
  }
  while (j < b.length) {
    lines.push({ type: "add", oldLine: null, newLine: newLine++, text: b[j] });
    j++;
  }
  return lines;
}
