import { afterEach, describe, expect, test } from "bun:test";
import {
  fetchJson,
  formatInbox,
  formatPrs,
  formatRepos,
  formatWhoami,
  requireSite,
  resolveSettings,
} from "./aria.mjs";

describe("fetchJson", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("sends a Bearer token and parses JSON", async () => {
    let seen: Request | null = null;
    globalThis.fetch = (async (input: any) => {
      seen = input;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const data = await fetchJson(
      "https://example.convex.site",
      "/api/cli/whoami",
      "aria_abc",
    );
    expect(data).toEqual({ ok: true });
    expect(seen?.url).toBe("https://example.convex.site/api/cli/whoami");
    expect(seen?.headers.get("authorization")).toBe("Bearer aria_abc");
  });

  test("throws a readable error when there is no token", async () => {
    await expect(
      fetchJson("https://example.convex.site", "/api/cli/repos", ""),
    ).rejects.toThrow(/No token/);
  });

  test("throws a readable error when there is no configured site", async () => {
    await expect(fetchJson("", "/api/cli/repos", "aria_t")).rejects.toThrow(
      /not configured/i,
    );
  });

  test("surfaces the server error message on non-2xx", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Unauthorized — token revoked." }), {
        status: 401,
      })) as typeof fetch;

    await expect(
      fetchJson("https://example.convex.site", "/api/cli/whoami", "aria_bad"),
    ).rejects.toThrow(/token revoked/);
  });
});

describe("resolveSettings", () => {
  test("does not invent a default site when explicitly unconfigured", () => {
    const s = resolveSettings({ site: "", token: null });
    expect(s.site).toBe("");
  });

  test("flags beat environment variables", () => {
    const saved = process.env.ARIA_TOKEN;
    process.env.ARIA_TOKEN = "env_token";
    try {
      const s = resolveSettings({ site: "https://x.example", token: "flag_token" });
      expect(s.site).toBe("https://x.example");
      expect(s.token).toBe("flag_token");
    } finally {
      if (saved !== undefined) process.env.ARIA_TOKEN = saved;
      else delete process.env.ARIA_TOKEN;
    }
  });

  test("strips trailing slashes from the site", () => {
    const s = resolveSettings({ site: "https://x.example///", token: "t" });
    expect(s.site).toBe("https://x.example");
  });
});

describe("requireSite", () => {
  test("requires an explicit site", () => {
    expect(() => requireSite("")).toThrow(/not configured/i);
  });

  test("rejects non-local HTTP", () => {
    expect(() => requireSite("http://x.example")).toThrow(/must use HTTPS/i);
  });

  test("allows localhost HTTP for development", () => {
    expect(requireSite("http://127.0.0.1:3210///")).toBe(
      "http://127.0.0.1:3210",
    );
  });
});

describe("formatters", () => {
  test("whoami without GitHub", () => {
    const out = formatWhoami({ user: { name: "Ada" }, github: null });
    expect(out).toContain("Ada");
    expect(out).toContain("not connected");
  });

  test("whoami with GitHub identity", () => {
    const out = formatWhoami({
      user: { name: "Ada" },
      github: { login: "ada", name: "Ada Lovelace" },
    });
    expect(out).toContain("ada (Ada Lovelace)");
  });

  test("repos marks private ones", () => {
    const out = formatRepos([
      { repo: "ada/notes", private: true },
      { repo: "ada/analytical-engine", private: false },
    ]);
    expect(out).toContain("ada/notes  (private)");
    expect(out).toContain("ada/analytical-engine");
  });

  test("inbox formats findings with kind and unread marker", () => {
    const out = formatInbox([
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
    expect(out).toContain("[high] dependency");
    expect(out).toContain("[new]");
    expect(out).toContain("lodash has a known vulnerability");
  });

  test("inbox is clear when empty", () => {
    expect(formatInbox([])).toContain("clear");
  });

  test("prs formats number, draft, title, and link", () => {
    const out = formatPrs([
      {
        repo: "ada/engine",
        number: 42,
        title: "Fix the mill",
        htmlUrl: "https://github.com/ada/engine/pull/42",
        draft: true,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(out).toContain("#42 (draft) Fix the mill");
    expect(out).toContain("github.com/ada/engine/pull/42");
  });

  test("prs empty state", () => {
    expect(formatPrs([])).toContain("No open pull requests");
  });
});
