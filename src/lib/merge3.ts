/**
 * Line-based three-way merge (diff3).
 *
 * Given a base version and two divergent versions ("ours" and "theirs"),
 * produces a chunked view of the merged output: unchanged regions, and
 * conflict regions where both sides edited the same lines differently.
 *
 * The engine uses this for local merges, interactive rebase and cherry-pick;
 * the conflict resolver renders the chunks so the user can accept either side
 * per hunk, or hand-edit.
 */

export interface MergeHunk {
  kind: "common" | "conflict";
  /** The base lines this chunk spans. */
  base: string[];
  /** The lines in "ours" replacing the base region (empty = deletion). */
  ours: string[];
  /** The lines in "theirs" replacing the base region (empty = deletion). */
  theirs: string[];
}

export interface Merge3Result {
  chunks: MergeHunk[];
  clean: boolean;
  /** Merged lines for clean results; for conflicts this omits the disputed
   *  regions (callers must resolve each conflict chunk first). */
  result: string[];
}

interface Hunk {
  /** First base line index covered by the change. */
  start: number;
  /** One past the last base line index covered by the change. */
  end: number;
  /** Replacement lines (empty = pure deletion). */
  text: string[];
}

function lcsDiffHunks(a: string[], b: string[]): Hunk[] {
  const n = a.length;
  const m = b.length;

  if (n * m > 2_500_000) {
    // Coarse fallback for very large inputs: keep the common prefix/suffix,
    // collapse everything in between into a single hunk.
    let start = 0;
    while (start < n && start < m && a[start] === b[start]) start++;
    let endA = n;
    let endB = m;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
    }
    return [
      {
        start,
        end: endA,
        text: b.slice(start, endB),
      },
    ];
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const start = i;
    const text: string[] = [];
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) break;
      if (j < m && (i >= n || dp[i + 1][j] < dp[i][j + 1])) {
        text.push(b[j]);
        j++;
      } else if (i < n) {
        i++;
      } else {
        break;
      }
    }
    hunks.push({ start, end: i, text });
  }
  return hunks;
}

function sameLines(x: string[], y: string[]): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

function commonChunk(lines: string[]): MergeHunk {
  return { kind: "common", base: lines, ours: lines, theirs: lines };
}

/**
 * Three-way merge of line-split texts.
 *
 * Conflict classification per disputed base region:
 * - both sides produce the same result  → clean (common)
 * - both sides deleted the region       → clean (deletion)
 * - one side deleted, the other edited  → conflict (delete/modify)
 * - both edited differently             → conflict
 */
export function threeWayMerge(
  baseText: string,
  oursText: string,
  theirsText: string,
): Merge3Result {
  const base = baseText.split("\n");
  const ours = oursText.split("\n");
  const theirs = theirsText.split("\n");

  const oursH = lcsDiffHunks(base, ours);
  const theirsH = lcsDiffHunks(base, theirs);

  const chunks: MergeHunk[] = [];
  let clean = true;
  let i = 0;
  let j = 0;
  let pos = 0;

  const emitCommon = (until: number) => {
    if (until > pos) {
      chunks.push(commonChunk(base.slice(pos, until)));
      pos = until;
    }
  };

  const emitSingle = (h: Hunk) => {
    emitCommon(h.start);
    // Only one side changed these base lines — always clean.
    chunks.push(commonChunk(h.text));
    pos = h.end;
  };

  while (i < oursH.length || j < theirsH.length) {
    const oh = oursH[i];
    const th = theirsH[j];

    if (!oh) {
      emitSingle(th!);
      j++;
      continue;
    }
    if (!th) {
      emitSingle(oh);
      i++;
      continue;
    }

    // Both sides have hunks here. Only base lines that BOTH sides changed can
    // conflict; adjacent-but-disjoint edits (no shared base line) are clean.
    if (oh.start < th.end && th.start < oh.end) {
      // Overlapping base region: absorb every hunk from either side that
      // touches the growing region into one combined chunk.
      const start = Math.min(oh.start, th.start);
      let end = Math.max(oh.end, th.end);
      const oursText = [...oh.text];
      const theirsText = [...th.text];
      i++;
      j++;
      while (i < oursH.length && oursH[i].start < end) {
        oursText.push(...oursH[i].text);
        end = Math.max(end, oursH[i].end);
        i++;
      }
      while (j < theirsH.length && theirsH[j].start < end) {
        theirsText.push(...theirsH[j].text);
        end = Math.max(end, theirsH[j].end);
        j++;
      }
      emitCommon(start);

      const baseSlice = base.slice(start, end);
      if (sameLines(oursText, theirsText)) {
        // Both sides made the same change (including both deleting).
        chunks.push(commonChunk(oursText));
      } else {
        // Different edits, or delete/modify (one side removed the region
        // while the other edited it) — a real conflict either way.
        clean = false;
        chunks.push({
          kind: "conflict",
          base: baseSlice,
          ours: oursText,
          theirs: theirsText,
        });
      }
      pos = end;
    } else if (oh.start <= th.start) {
      emitSingle(oh);
      i++;
    } else {
      emitSingle(th);
      j++;
    }
  }
  emitCommon(base.length);

  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.kind === "common") result.push(...chunk.base);
  }
  return { chunks, clean, result };
}

/**
 * Build the final merged content from a chunk list after the caller decided
 * what to keep for each conflict chunk ("ours" | "theirs" | "base" | custom).
 */
export function applyChoices(
  chunks: MergeHunk[],
  choose: (
    chunk: MergeHunk,
    index: number,
  ) => "ours" | "theirs" | "base" | string[],
): string {
  const lines: string[] = [];
  chunks.forEach((chunk, index) => {
    if (chunk.kind === "common") {
      lines.push(...chunk.base);
      return;
    }
    const choice = choose(chunk, index);
    if (choice === "ours") lines.push(...chunk.ours);
    else if (choice === "theirs") lines.push(...chunk.theirs);
    else if (choice === "base") lines.push(...chunk.base);
    else lines.push(...choice);
  });
  return lines.join("\n");
}
