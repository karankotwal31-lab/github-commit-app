import { describe, expect, test } from "bun:test";
import {
  detectBrowser,
  detectDeviceType,
  detectOs,
  getRuntimeProfile,
} from "./runtime";

describe("detectOs", () => {
  test("classifies major operating systems", () => {
    expect(detectOs("Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X)")).toBe("iOS");
    expect(detectOs("Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X)")).toBe("iOS");
    expect(detectOs("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android");
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(detectOs("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)")).toBe("ChromeOS");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
  });
});

describe("detectBrowser", () => {
  test("classifies major browsers", () => {
    expect(detectBrowser("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")).toBe("Chrome");
    expect(detectBrowser("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0")).toBe("Edge");
    expect(detectBrowser("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0")).toBe("Firefox");
    expect(detectBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15")).toBe("Safari");
  });
});

describe("detectDeviceType", () => {
  test("classifies phones as mobile", () => {
    expect(detectDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", true)).toBe("mobile");
    expect(detectDeviceType("Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231005.007) AppleWebKit/537.36 Mobile Safari/537.36", true)).toBe("mobile");
  });

  test("classifies iPads and tablets as tablet", () => {
    expect(detectDeviceType("Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15", true)).toBe("tablet");
    expect(detectDeviceType("Mozilla/5.0 (Linux; Android 13; SM-X900 Build/TKQ1.220829.002) AppleWebKit/537.36", true)).toBe("tablet");
  });

  test("classifies desktop environments as desktop", () => {
    expect(detectDeviceType("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", false)).toBe("desktop");
    expect(detectDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", false)).toBe("desktop");
  });
});

describe("getRuntimeProfile", () => {
  test("returns a complete, stable profile with no window (SSR/test env)", () => {
    const p = getRuntimeProfile();
    expect(["desktop", "tablet", "mobile"]).toContain(p.deviceType);
    expect(typeof p.os).toBe("string");
    expect(typeof p.browser).toBe("string");
    expect(typeof p.capabilities.workers).toBe("boolean");
    expect(typeof p.inPreview).toBe("boolean");
    expect(typeof p.standalone).toBe("boolean");
    expect(typeof p.screen.width).toBe("number");
    expect(p).toBe(getRuntimeProfile()); // memoized
  });
});
