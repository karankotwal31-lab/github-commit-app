import { describe, expect, test } from "bun:test";
import { anySecretRisk, secretRisk } from "./secrets";

describe("secretRisk — filenames", () => {
  test("flags .env files anywhere in the tree", () => {
    expect(secretRisk(".env", "FOO=bar").risky).toBe(true);
    expect(secretRisk("src/.env.local", "").risky).toBe(true);
    expect(secretRisk("config/.env.production", "").risky).toBe(true);
    expect(secretRisk("packages/app/.env.example", "").risky).toBe(true);
  });

  test("flags private keys and keystores", () => {
    expect(secretRisk("id_rsa", "").risky).toBe(true);
    expect(secretRisk("ssh/id_ed25519", "").risky).toBe(true);
    expect(secretRisk("certs/server.pem", "").risky).toBe(true);
    expect(secretRisk("certs/keystore.p12", "").risky).toBe(true);
    expect(secretRisk("certs/keystore.pfx", "").risky).toBe(true);
    expect(secretRisk("certs/signing.p8", "").risky).toBe(true);
    expect(secretRisk("keys/app.key", "").risky).toBe(true);
    expect(secretRisk("service-account.json", "").risky).toBe(true);
    expect(secretRisk("credentials.yaml", "").risky).toBe(true);
  });

  test("does not flag ordinary files", () => {
    expect(secretRisk("src/App.tsx", "").risky).toBe(false);
    expect(secretRisk("package.json", "").risky).toBe(false);
    expect(secretRisk("README.md", "").risky).toBe(false);
    expect(secretRisk("src/env.ts", "").risky).toBe(false);
  });
});

describe("secretRisk — content", () => {
  test("flags private key blocks", () => {
    const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...";
    expect(secretRisk("file.txt", content).risky).toBe(true);
  });

  test("flags well-known live tokens", () => {
    expect(secretRisk("a.txt", "sk_live_4eC39HqLyjWDarjtT1zdp7dc").risky).toBe(true);
    expect(secretRisk("a.txt", "ghp_0123456789abcdef0123456789abcdef012345").risky).toBe(true);
    expect(secretRisk("a.txt", "AKIAIOSFODNN7EXAMPLE").risky).toBe(true);
    expect(secretRisk("a.txt", "xoxb-123456789012-1234567890123-abc").risky).toBe(true);
    // Google API keys are AIza + exactly 35 chars.
    expect(secretRisk("a.txt", "AIza0123456789abcdefghijklmnopqrstuvwxy").risky).toBe(true);
  });

  test("does not flag normal code", () => {
    const code = `export function sum(a: number, b: number) {
  return a + b;
}`;
    expect(secretRisk("sum.ts", code).risky).toBe(false);
    expect(secretRisk("notes.md", "Nothing sensitive here.").risky).toBe(false);
  });
});

describe("anySecretRisk", () => {
  test("reports which files tripped the guard", () => {
    const result = anySecretRisk([
      { path: "src/app.ts", content: "ok" },
      { path: ".env", content: "" },
      { path: "keys/credentials.json", content: "" },
    ]);
    expect(result.risky).toBe(true);
    expect(result.files).toEqual([".env", "keys/credentials.json"]);
  });

  test("clean input stays clean", () => {
    const result = anySecretRisk([
      { path: "a.ts", content: "x" },
      { path: "b.ts", content: "y" },
    ]);
    expect(result.risky).toBe(false);
    expect(result.files).toEqual([]);
  });
});
