import { afterEach, describe, expect, test } from "bun:test";
import {
  AriaApi,
  AriaApiError,
  kindLabel,
  relativeTime,
} from "./api";

describe("AriaApi", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockFetch(status: number, body: unknown) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
  }

  test("hits the right endpoint with a Bearer token", async () => {
    let seen: Request | null = null;
    globalThis.fetch = (async (input: any) => {
      seen = input;
      return new Response(JSON.stringify({ user: null, github: null }), {
        status: 200,
      });
    }) as typeof fetch;

    const api = new AriaApi("https://steady-scorpion-839.convex.site/");
    await api.whoami("aria_abc");

    expect(seen?.url).toBe(
      "https://steady-scorpion-839.convex.site/api/cli/whoami",
    );
    expect(seen?.headers.get("authorization")).toBe("Bearer aria_abc");
  });

  test("parses repos", async () => {
    mockFetch(200, [
      { repo: "ada/notes", private: true },
      { repo: "ada/engine", private: false },
    ]);
    const rows = await new AriaApi("https://x").repos("aria_t");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ repo: "ada/notes", private: true });
  });

  test("parses inbox findings", async () => {
    mockFetch(200, [
      {
        kind: "dependency",
        priority: "high",
        repo: "ada/engine",
        title: "lodash has a known vulnerability",
        detail: "x",
        url: "https://npmjs.com/package/lodash",
        read: false,
        createdAt: 1700000000000,
      },
    ]);
    const rows = await new AriaApi("https://x").inbox("aria_t");
    expect(rows[0]?.title).toContain("lodash");
    expect(rows[0]?.read).toBe(false);
  });

  test("parses PRs", async () => {
    mockFetch(200, [
      {
        repo: "ada/engine",
        number: 42,
        title: "Fix the mill",
        htmlUrl: "https://github.com/ada/engine/pull/42",
        draft: true,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    const rows = await new AriaApi("https://x").prs("aria_t");
    expect(rows[0]?.number).toBe(42);
    expect(rows[0]?.draft).toBe(true);
  });

  test("throws a readable AriaApiError on 401 with a server message", async () => {
    mockFetch(401, { error: "Unauthorized — token revoked." });
    const api = new AriaApi("https://x");
    try {
      await api.whoami("aria_bad");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AriaApiError);
      expect((err as AriaApiError).message).toContain("token revoked");
      expect((err as AriaApiError).status).toBe(401);
    }
  });

  test("throws a readable error when no token is passed", async () => {
    const api = new AriaApi("https://x");
    try {
      await api.whoami("");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("No token");
    }
  });

  test("prDetail hits the per-PR endpoint with the repo in the path", async () => {
    let seen: Request | null = null;
    globalThis.fetch = (async (input: any) => {
      seen = input;
      return new Response(
        JSON.stringify({
          repo: "ada/engine",
          number: 42,
          title: "Fix the mill",
          state: "open",
          draft: false,
          htmlUrl: "https://github.com/ada/engine/pull/42",
          body: null,
          base: { ref: "main", sha: "a" },
          head: { ref: "fix", sha: "b" },
          files: [
            {
              filename: "src/mill.ts",
              status: "modified",
              additions: 2,
              deletions: 1,
              patch: "@@ -1 +1,2 @@\n-old\n+new",
              oldContent: "old\n",
              newContent: "new\n",
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const api = new AriaApi("https://steady-scorpion-839.convex.site");
    const detail = await api.prDetail("ada/engine", 42, "aria_t");

    expect(seen?.url).toBe(
      "https://steady-scorpion-839.convex.site/api/cli/prs/ada/engine/42",
    );
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]?.oldContent).toBe("old\n");
    expect(detail.files[0]?.newContent).toBe("new\n");
    expect(detail.base.ref).toBe("main");
  });

  test("prDetail encodes slashes in repo and filename", async () => {
    let seen: Request | null = null;
    globalThis.fetch = (async (input: any) => {
      seen = input;
      return new Response(
        JSON.stringify({ files: [], repo: "a/b", number: 7, htmlUrl: "", title: "", state: "open", draft: false, body: null, base: { ref: "", sha: "" }, head: { ref: "", sha: "" } }),
        { status: 200 },
      );
    }) as typeof fetch;

    await new AriaApi("https://x").prDetail("ada/engine", 7, "aria_t");
    expect(seen?.url).toBe("https://x/api/cli/prs/ada/engine/7");
  });

  test("trims trailing slashes from the site", () => {
    expect(new AriaApi("https://x.example///").site).toBe("https://x.example");
  });
});

describe("kindLabel", () => {
  test("maps known kinds to friendly labels", () => {
    expect(kindLabel("dependency")).toBe("dependency");
    expect(kindLabel("stale_pr")).toBe("stale PR");
    expect(kindLabel("failing_ci")).toBe("failing CI");
  });

  test("passes unknown kinds through", () => {
    expect(kindLabel("mystery")).toBe("mystery");
  });
});

describe("relativeTime", () => {
  test("formats minutes, hours, and days", () => {
    const now = Date.now();
    expect(relativeTime(now - 30_000)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000)).toBe("2d ago");
  });

  test("handles null", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime(undefined)).toBe("");
  });
});
