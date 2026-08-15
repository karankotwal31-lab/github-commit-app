import { describe, expect, test } from "bun:test";
import {
  cleanCode,
  cleanLabel,
  cleanMultiline,
  cleanName,
  cleanPath,
  cleanSearchQuery,
  cleanText,
} from "./sanitize";

describe("cleanText", () => {
  test("strips control characters and trims", () => {
    expect(cleanText("  hello\u0000world\u001f  ")).toBe("helloworld");
  });
  test("both keep newlines/tabs (only dangerous control chars are stripped)", () => {
    expect(cleanText("a\nb\tc")).toBe("a\nb\tc");
    expect(cleanMultiline("  hello\nworld  ")).toBe("hello\nworld");
  });
  test("caps length", () => {
    expect(cleanText("abcdef", 3)).toBe("abc");
  });
  test("rejects empty-ish input", () => {
    expect(cleanText("   ")).toBe("");
  });
});

describe("cleanPath", () => {
  test("keeps a normal relative path", () => {
    expect(cleanPath("src/lib/foo.ts")).toBe("src/lib/foo.ts");
  });
  test("normalizes backslashes", () => {
    expect(cleanPath("src\\lib\\foo.ts")).toBe("src/lib/foo.ts");
  });
  test("rejects traversal", () => {
    expect(cleanPath("../etc/passwd")).toBe("");
    expect(cleanPath("src/../../secret")).toBe("");
    expect(cleanPath("..")).toBe("");
    expect(cleanPath(".")).toBe("");
  });
  test("rejects absolute paths", () => {
    expect(cleanPath("/etc/passwd")).toBe("");
  });
  test("strips control bytes", () => {
    expect(cleanPath("src\u0000foo")).toBe("srcfoo");
  });
  test("caps length", () => {
    expect(cleanPath("a/b/c/d", 5)).toBe("a/b/c");
  });
});

describe("cleanName", () => {
  test("keeps owner/repo", () => {
    expect(cleanName("octocat/Hello-World")).toBe("octocat/Hello-World");
  });
  test("collapses whitespace to dashes and strips control chars", () => {
    expect(cleanName("feature\u0001 branch")).toBe("feature-branch");
  });
});

describe("cleanSearchQuery / cleanCode / cleanLabel", () => {
  test("search query is trimmed, control chars stripped, and capped", () => {
    expect(cleanSearchQuery("  fetch \u0000 user  ")).toBe("fetch  user");
    expect(cleanSearchQuery("123456789", 3)).toBe("123");
  });
  test("join code is uppercased", () => {
    expect(cleanCode("aria-k7q2")).toBe("ARIA-K7Q2");
  });
  test("labels are trimmed and capped", () => {
    expect(cleanLabel("  Chrome · Desktop  ", 12)).toBe("Chrome · Des");
  });
});
