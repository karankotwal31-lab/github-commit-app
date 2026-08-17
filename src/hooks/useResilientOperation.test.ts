import { describe, expect, test } from "bun:test";
import { backoffMs, isRetryableError } from "./useResilientOperation";

describe("isRetryableError", () => {
  test("classifies network failures as retryable", () => {
    expect(isRetryableError(new Error("Failed to fetch"))).toBe(true);
    expect(isRetryableError(new Error("network error"))).toBe(true);
    expect(isRetryableError(new Error("Load failed"))).toBe(true);
    expect(isRetryableError(new Error("Request failed with status code 502"))).toBe(true);
    expect(isRetryableError(new Error("timeout of 10000ms exceeded"))).toBe(true);
  });

  test("classifies rate limits and server errors as retryable", () => {
    expect(isRetryableError(new Error("API rate limit exceeded (429)"))).toBe(true);
    expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true);
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryableError(new Error("504 Gateway Timeout"))).toBe(true);
  });

  test("does not classify client errors or validation errors as retryable", () => {
    expect(isRetryableError(new Error("404 Not Found"))).toBe(false);
    expect(isRetryableError(new Error("403 Forbidden"))).toBe(false);
    expect(isRetryableError(new Error("Repository not found"))).toBe(false);
    expect(isRetryableError(new Error("Invalid branch name"))).toBe(false);
    expect(isRetryableError(new Error("401 Unauthorized"))).toBe(false);
  });

  test("treats non-Error values gracefully", () => {
    expect(isRetryableError("Failed to fetch")).toBe(true);
    expect(isRetryableError("400 Bad Request")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("backoffMs", () => {
  test("grows exponentially", () => {
    // Base 500: attempt 1 ≈ 500ms, attempt 2 ≈ 1000ms, attempt 3 ≈ 2000ms
    const a1 = backoffMs(1, 500);
    const a2 = backoffMs(2, 500);
    const a3 = backoffMs(3, 500);
    expect(a1).toBeGreaterThanOrEqual(500);
    expect(a1).toBeLessThan(700);
    expect(a2).toBeGreaterThanOrEqual(1000);
    expect(a2).toBeLessThan(1200);
    expect(a3).toBeGreaterThanOrEqual(2000);
    expect(a3).toBeLessThan(2200);
  });

  test("caps at 8 seconds", () => {
    for (const attempt of [6, 8, 10, 20]) {
      const delay = backoffMs(attempt, 500);
      expect(delay).toBeLessThanOrEqual(8200);
      expect(delay).toBeGreaterThan(0);
    }
  });

  test("respects a custom base delay", () => {
    const delay = backoffMs(1, 250);
    expect(delay).toBeGreaterThanOrEqual(250);
    expect(delay).toBeLessThan(450);
  });
});
