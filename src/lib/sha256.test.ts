import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../convex/sha256";

describe("sha256Hex", () => {
  test("matches the empty-string vector", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("matches the 'abc' vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("matches a two-block message (length > 55 bytes)", () => {
    expect(
      sha256Hex(
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      ),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  test("handles multi-byte characters (UTF-8)", () => {
    // "你好" — UTF-8 is 6 bytes (verified against node:crypto).
    expect(sha256Hex("你好")).toBe(
      "670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e",
    );
  });
});
