import { describe, expect, test } from "bun:test";
import { applyChoices, threeWayMerge } from "./merge3";

describe("threeWayMerge", () => {
  test("identical inputs merge clean with no changes", () => {
    const r = threeWayMerge("a\nb\nc\n", "a\nb\nc\n", "a\nb\nc\n");
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nb\nc\n");
  });

  test("ours-only change applies cleanly", () => {
    const r = threeWayMerge("a\nb\nc\n", "a\nB\nc\n", "a\nb\nc\n");
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nB\nc\n");
  });

  test("theirs-only change applies cleanly", () => {
    const r = threeWayMerge("a\nb\nc\n", "a\nb\nc\n", "a\nX\nc\n");
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nX\nc\n");
  });

  test("both sides change different regions — clean", () => {
    const r = threeWayMerge(
      "a\nb\nc\nd\n",
      "a\nB\nc\nd\n",
      "a\nb\nc\nD\n",
    );
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nB\nc\nD\n");
  });

  test("both sides make the same change — clean", () => {
    const r = threeWayMerge("a\nb\nc\n", "a\nX\nc\n", "a\nX\nc\n");
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nX\nc\n");
  });

  test("both sides delete the same region — clean", () => {
    const r = threeWayMerge("a\nb\nc\n", "a\nc\n", "a\nc\n");
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nc\n");
  });

  test("conflicting edits surface base/ours/theirs per hunk", () => {
    const r = threeWayMerge(
      "a\nkeep\nb\n",
      "a\nOURS\nb\n",
      "a\nTHEIRS\nb\n",
    );
    expect(r.clean).toBe(false);
    expect(r.chunks).toHaveLength(3);
    const conflict = r.chunks.find((c) => c.kind === "conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.base).toEqual(["keep"]);
    expect(conflict!.ours).toEqual(["OURS"]);
    expect(conflict!.theirs).toEqual(["THEIRS"]);
  });

  test("delete/modify is a conflict, not silent data loss", () => {
    const r = threeWayMerge("a\nb\nc\n", "a\nc\n", "a\nB\nc\n");
    expect(r.clean).toBe(false);
    const conflict = r.chunks.find((c) => c.kind === "conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.ours).toEqual([]);
    expect(conflict!.theirs).toEqual(["B"]);
  });

  test("one side deletes, other untouched — clean deletion", () => {
    const r = threeWayMerge("a\nb\nc\n", "a\nc\n", "a\nb\nc\n");
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nc\n");
  });

  test("one side adds, other untouched — clean addition", () => {
    const r = threeWayMerge("a\nc\n", "a\nb\nc\n", "a\nc\n");
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nb\nc\n");
  });

  test("adjacent-but-disjoint edits are clean and both apply", () => {
    // ours replaces base line 2, theirs replaces base line 3 — no shared base
    // line, so the merge is clean and both changes land.
    const r = threeWayMerge(
      "a\nb\nc\nd\n",
      "a\nB1\nB2\nc\nd\n",
      "a\nb\nX\nc\nd\n",
    );
    expect(r.clean).toBe(true);
    // ours replaces b with B1,B2; theirs inserts X before c. Both land, and
    // untouched base lines (a, c, d) survive.
    expect(r.result.join("\n")).toBe("a\nB1\nB2\nX\nc\nd\n");
  });

  test("overlapping edits of the same base region form one conflict hunk", () => {
    const r = threeWayMerge(
      "a\nb\nc\n",
      "a\nB1\nB2\nc\n",
      "a\nX\nc\n",
    );
    expect(r.clean).toBe(false);
    const conflicts = r.chunks.filter((c) => c.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].base).toEqual(["b"]);
    expect(conflicts[0].ours).toEqual(["B1", "B2"]);
    expect(conflicts[0].theirs).toEqual(["X"]);
  });

  test("trailing newline round-trips through applyChoices", () => {
    const r = threeWayMerge(
      "line1\nline2\n",
      "line1\nedited\n",
      "line1\nother\n",
    );
    expect(r.clean).toBe(false);
    const out = applyChoices(r.chunks, (c) =>
      c.kind === "conflict" ? "ours" : "base",
    );
    expect(out).toBe("line1\nedited\n");
  });

  test("file without trailing newline round-trips", () => {
    const r = threeWayMerge("a\nb", "a\nB", "a\nb");
    expect(r.clean).toBe(true);
    expect(r.result.join("\n")).toBe("a\nB");
  });
});
