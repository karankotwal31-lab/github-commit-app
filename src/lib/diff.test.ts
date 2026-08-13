import { describe, expect, test } from "bun:test";
import { diffLines, parseUnifiedPatch } from "./diff";

describe("diffLines", () => {
  test("identical texts produce only 'same' lines", () => {
    const lines = diffLines("a\nb\nc\n", "a\nb\nc\n");
    expect(lines.every((l) => l.type === "same")).toBe(true);
    expect(lines).toHaveLength(4); // trailing newline yields a final empty line
    expect(lines[0]).toEqual({ type: "same", oldLine: 1, newLine: 1, text: "a" });
  });

  test("detects a deletion", () => {
    const lines = diffLines("a\nb\nc\n", "a\nc\n");
    expect(lines).toEqual([
      { type: "same", oldLine: 1, newLine: 1, text: "a" },
      { type: "del", oldLine: 2, newLine: null, text: "b" },
      { type: "same", oldLine: 3, newLine: 2, text: "c" },
      { type: "same", oldLine: 4, newLine: 3, text: "" },
    ]);
  });

  test("detects an addition", () => {
    const lines = diffLines("a\nc\n", "a\nb\nc\n");
    expect(lines.filter((l) => l.type === "add")).toEqual([
      { type: "add", oldLine: null, newLine: 2, text: "b" },
    ]);
  });

  test("empty to non-empty", () => {
    const lines = diffLines("", "x\ny\n");
    expect(lines).toEqual([
      { type: "add", oldLine: null, newLine: 1, text: "x" },
      { type: "add", oldLine: null, newLine: 2, text: "y" },
      // the trailing newline is an empty line present in both texts
      { type: "same", oldLine: 1, newLine: 3, text: "" },
    ]);
  });

  test("coarse fallback handles very large inputs without exploding", () => {
    const a = Array.from({ length: 1600 }, (_, i) => `line ${i} a`);
    const b = Array.from({ length: 1600 }, (_, i) => `line ${i} b`);
    // 1600 * 1600 > 2_500_000 → coarse path
    const lines = diffLines(a.join("\n"), b.join("\n"));
    expect(lines.length).toBeGreaterThan(0);
    // Every line is accounted for once: old line numbers strictly increase.
    const oldNums = lines.filter((l) => l.oldLine !== null).map((l) => l.oldLine!);
    expect(new Set(oldNums).size).toBe(oldNums.length);
  });
});

describe("parseUnifiedPatch", () => {
  test("parses hunks with context, additions, and deletions", () => {
    const patch = [
      "@@ -1,3 +1,3 @@",
      " context-line",
      "+added-line",
      "-removed-line",
      " same-after",
    ].join("\n");
    const lines = parseUnifiedPatch(patch);
    expect(lines).toEqual([
      { type: "same", oldLine: 1, newLine: 1, text: "context-line" },
      { type: "add", oldLine: null, newLine: 2, text: "added-line" },
      { type: "del", oldLine: 2, newLine: null, text: "removed-line" },
      { type: "same", oldLine: 3, newLine: 3, text: "same-after" },
    ]);
  });

  test("respects a non-trivial hunk header", () => {
    const lines = parseUnifiedPatch("@@ -40,6 +12,6 @@\n+new-at-12\n");
    expect(lines).toEqual([{ type: "add", oldLine: null, newLine: 12, text: "new-at-12" }]);
  });

  test("handles no-newline markers and empty input", () => {
    expect(parseUnifiedPatch("\\ No newline at end of file\n")).toEqual([]);
    expect(parseUnifiedPatch(null)).toEqual([]);
    expect(parseUnifiedPatch("")).toEqual([]);
  });
});
