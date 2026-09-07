import { beforeEach, describe, expect, test } from "bun:test";

// Stub localStorage (headless test environments may not have it).
const store = new Map<string, string>();
try {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    configurable: true,
  });
} catch {
  // Native localStorage exists — state is per-run anyway.
}
import {
  clearAllPendingCommits,
  setOfflineAccount,
  clearPendingCommit,
  pendingCommitCount,
  pendingCommits,
  queueCommit,
} from "./offlineBuffer";

describe("offline commit queue", () => {
  beforeEach(() => {
    setOfflineAccount("test-user");
    clearAllPendingCommits();
  });

  test("queues a commit with full file contents", () => {
    const id = queueCommit({
      repo: "owner/repo",
      branch: "feature/x",
      message: "feat: add validation",
      files: [
        { path: "src/a.ts", action: "update", content: "export const a = 1;" },
        { path: "src/b.ts", action: "create", content: "export const b = 2;" },
      ],
    });
    expect(id.length).toBeGreaterThan(0);
    expect(pendingCommitCount()).toBe(1);
    const [c] = pendingCommits();
    expect(c.repo).toBe("owner/repo");
    expect(c.branch).toBe("feature/x");
    expect(c.message).toBe("feat: add validation");
    expect(c.files).toHaveLength(2);
    expect(c.files[0].content).toContain("a = 1");
  });

  test("replays oldest first", () => {
    queueCommit({
      repo: "r",
      branch: "b",
      message: "first",
      files: [{ path: "a", action: "update", content: "1" }],
    });
    queueCommit({
      repo: "r",
      branch: "b",
      message: "second",
      files: [{ path: "b", action: "update", content: "2" }],
    });
    const commits = pendingCommits();
    expect(commits.map((c) => c.message)).toEqual(["first", "second"]);
  });

  test("clear removes exactly one commit", () => {
    const a = queueCommit({
      repo: "r",
      branch: "b",
      message: "a",
      files: [],
    });
    queueCommit({
      repo: "r",
      branch: "b",
      message: "b",
      files: [],
    });
    clearPendingCommit(a);
    expect(pendingCommitCount()).toBe(1);
    expect(pendingCommits()[0].message).toBe("b");
  });

  test("queue survives localStorage round-trip with full content", () => {
    queueCommit({
      repo: "owner/repo",
      branch: "main",
      message: "fix: typo",
      allowSecrets: true,
      files: [
        { path: "README.md", action: "update", content: "# Hello\n" },
      ],
    });
    const [c] = pendingCommits();
    expect(c.message).toBe("fix: typo");
    expect(c.allowSecrets).toBe(true);
    expect(c.files[0].content).toBe("# Hello\n");
  });
});

