import { describe, expect, test } from "bun:test";
import {
  isPushReviewAction,
  parseGithubPullTarget,
  scrubPushActionParams,
} from "./pushActions";

describe("push review actions", () => {
  test("accepts only the supported action names", () => {
    expect(isPushReviewAction("approve")).toBe(true);
    expect(isPushReviewAction("comment")).toBe(true);
    expect(isPushReviewAction("merge")).toBe(true);
    expect(isPushReviewAction("delete")).toBe(false);
  });

  test("parses a canonical GitHub pull request URL", () => {
    expect(parseGithubPullTarget("https://github.com/openai/example/pull/42")).toEqual({
      owner: "openai",
      repo: "example",
      number: 42,
      url: "https://github.com/openai/example/pull/42",
    });
  });

  test("rejects lookalike, insecure, and non-PR URLs", () => {
    expect(parseGithubPullTarget("https://evil.example/github.com/a/b/pull/1")).toBeNull();
    expect(parseGithubPullTarget("http://github.com/a/b/pull/1")).toBeNull();
    expect(parseGithubPullTarget("https://github.com/a/b/issues/1")).toBeNull();
    expect(parseGithubPullTarget("javascript:alert(1)")).toBeNull();
  });

  test("scrubs only one-shot action parameters", () => {
    expect(
      scrubPushActionParams(
        "https://aria.example/dashboard?repo=a%2Fb&ariaAction=approve&ariaUrl=https%3A%2F%2Fgithub.com%2Fa%2Fb%2Fpull%2F1#review",
      ),
    ).toBe("/dashboard?repo=a%2Fb#review");
  });
});
