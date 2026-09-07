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
  clearAllPendingDrafts,
  clearPendingCommit,
  pendingCommitCount,
  pendingCommits,
  pendingDraftCount,
  pendingDrafts,
  queueCommit,
  queueDraft,
  setOfflineAccount,
} from "./offlineBuffer";

describe("offline commit queue", () => {
  beforeEach(() => {
    store.clear();
    setOfflineAccount("test-user");
    clearAllPendingCommits();
    clearAllPendingDrafts();
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
    expect(pendingCommits().map((c) => c.message)).toEqual(["first", "second"]);
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
      files: [{ path: "README.md", action: "update", content: "# Hello\n" }],
    });
    const [c] = pendingCommits();
    expect(c.message).toBe("fix: typo");
    expect(c.allowSecrets).toBe(true);
    expect(c.files[0].content).toBe("# Hello\n");
  });

  test("keeps offline work isolated by signed-in account", () => {
    queueCommit({
      repo: "owner/private-a",
      branch: "main",
      message: "user-a",
      files: [{ path: "a.ts", action: "update", content: "secret-a" }],
    });

    setOfflineAccount("other-user");
    expect(pendingCommits()).toEqual([]);
    queueCommit({
      repo: "owner/private-b",
      branch: "main",
      message: "user-b",
      files: [{ path: "b.ts", action: "update", content: "secret-b" }],
    });

    setOfflineAccount("test-user");
    expect(pendingCommits().map((c) => c.message)).toEqual(["user-a"]);
  });

  test("bounds queued commits per account and keeps the newest 50", () => {
    for (let i = 0; i < 60; i++) {
      queueCommit({
        repo: "owner/repo",
        branch: "main",
        message: `commit-${i}`,
        files: [{ path: `${i}.txt`, action: "create", content: String(i) }],
      });
    }
    const commits = pendingCommits();
    expect(commits).toHaveLength(50);
    expect(commits[0].message).toBe("commit-10");
    expect(commits[commits.length - 1]?.message).toBe("commit-59");
  });
});

describe("offline draft queue", () => {
  beforeEach(() => {
    store.clear();
    setOfflineAccount("draft-user");
    clearAllPendingDrafts();
  });

  test("bounds drafts per account and preserves the newest 200", () => {
    for (let i = 0; i < 210; i++) {
      queueDraft({
        repo: "owner/repo",
        branch: "main",
        path: `${i}.ts`,
        content: String(i),
        cursorLine: null,
        cursorColumn: null,
        updatedAt: i,
      });
    }
    expect(pendingDraftCount()).toBe(200);
    const drafts = pendingDrafts();
    expect(drafts[0].path).toBe("209.ts");
    expect(drafts[drafts.length - 1]?.path).toBe("10.ts");
  });

  test("draft queues are isolated by account", () => {
    queueDraft({
      repo: "owner/repo",
      branch: "main",
      path: "private.ts",
      content: "account-a",
      cursorLine: null,
      cursorColumn: null,
      updatedAt: 1,
    });
    setOfflineAccount("another-user");
    expect(pendingDrafts()).toEqual([]);
  });
});
