import { describe, expect, test } from "bun:test";
import {
  depStatus,
  hasPermission,
  healthScore,
  ruleMatchesFile,
  severityRank,
  sortFindings,
} from "./phase3";

describe("ruleMatchesFile", () => {
  test("exact path", () => {
    expect(ruleMatchesFile(["src/config.ts"], "src/config.ts")).toBe(true);
    expect(ruleMatchesFile(["src/config.ts"], "src/other.ts")).toBe(false);
  });
  test("directory prefix", () => {
    expect(ruleMatchesFile(["src/"], "src/config.ts")).toBe(true);
    expect(ruleMatchesFile(["src/"], "README.md")).toBe(false);
    expect(ruleMatchesFile(["src/**"], "src/a/b/c.ts")).toBe(true);
  });
  test("wildcard basename", () => {
    expect(ruleMatchesFile(["*.env"], ".env")).toBe(true);
    expect(ruleMatchesFile([".env*"], "config/.env.prod")).toBe(true);
    expect(ruleMatchesFile(["*.env"], "config/.env.prod")).toBe(false);
    expect(ruleMatchesFile(["*.pem"], "keys/id.pem")).toBe(true);
    expect(ruleMatchesFile(["*.pem"], "keys/id.key")).toBe(false);
  });
  test("catch-all", () => {
    expect(ruleMatchesFile(["*"], "anything/at/all")).toBe(true);
  });
  test("multiple specs", () => {
    expect(ruleMatchesFile(["src/", "docs/**"], "src/main.ts")).toBe(true);
    expect(ruleMatchesFile(["src/", "docs/**"], "docs/guide.md")).toBe(true);
    expect(ruleMatchesFile(["src/", "docs/**"], "package.json")).toBe(false);
  });
});

describe("depStatus", () => {
  test("vulnerable wins over everything else", () => {
    const r = depStatus("1.2.3", "9.0.0", true);
    expect(r.status).toBe("vulnerable");
  });
  test("outdated major", () => {
    const r = depStatus("1.2.3", "3.0.0", false);
    expect(r.status).toBe("outdated_major");
    expect(r.majorDiff).toBe(2);
  });
  test("behind on same major", () => {
    expect(depStatus("1.2.3", "1.9.0", false).status).toBe("outdated_minor");
    expect(depStatus("1.2.3", "1.2.9", false).status).toBe("outdated_minor");
  });
  test("current", () => {
    expect(depStatus("1.2.3", "1.2.3", false).status).toBe("current");
  });
  test("unknown when evidence is missing", () => {
    expect(depStatus(null, "1.0.0", false).status).toBe("unknown");
    expect(depStatus("1.0.0", null, false).status).toBe("unknown");
  });
});

describe("healthScore", () => {
  test("weighted math", () => {
    const r = healthScore([
      { label: "tests", weight: 0.5, pass: true, evidence: "tests exist" },
      { label: "ci", weight: 0.5, pass: false, evidence: "no CI config" },
    ]);
    expect(r?.score).toBe(50);
    expect(r?.evidence).toHaveLength(2);
  });
  test("empty input yields null, never a fake zero", () => {
    expect(healthScore([])).toBeNull();
  });
  test("zero-weight checks are ignored", () => {
    const r = healthScore([
      { label: "a", weight: 1, pass: true, evidence: "a" },
      { label: "b", weight: 0, pass: false, evidence: "b" },
    ]);
    expect(r?.score).toBe(100);
  });
});

describe("severity + permissions", () => {
  test("severity ordering", () => {
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
  });
  test("sortFindings most severe first, then newest", () => {
    const rows = [
      { severity: "low" as const, createdAt: 300 },
      { severity: "high" as const, createdAt: 100 },
      { severity: "high" as const, createdAt: 200 },
    ];
    const sorted = sortFindings(rows);
    expect(sorted.map((r) => r.createdAt)).toEqual([200, 100, 300]);
  });
  test("permission ladder", () => {
    expect(hasPermission("read", "read")).toBe(true);
    expect(hasPermission("read", "modify")).toBe(false);
    expect(hasPermission("modify", "read")).toBe(true);
    expect(hasPermission("git", "pr")).toBe(false);
    expect(hasPermission("deploy", "pr")).toBe(true);
    expect(hasPermission(null, "read")).toBe(false);
  });
});
