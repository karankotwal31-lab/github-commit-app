import { describe, expect, test } from "bun:test";

import {
  APPROVAL_ACTIONS,
  canRole,
  detectConnection,
  detectDeviceClass,
  evaluateApprovalPolicies,
  grantCapabilities,
  matchesGlob,
  ORG_ROLES,
  pluginCan,
  sortFindings,
} from "./phase4";

describe("Phase 4 RBAC ladder", () => {
  test("role ranks are ordered owner > admin > developer > reviewer > viewer", () => {
    expect(canRole(ORG_ROLES.OWNER, ORG_ROLES.VIEWER)).toBe(true);
    expect(canRole(ORG_ROLES.ADMIN, ORG_ROLES.REVIEWER)).toBe(true);
    expect(canRole(ORG_ROLES.DEVELOPER, ORG_ROLES.DEVELOPER)).toBe(true);
    expect(canRole(ORG_ROLES.REVIEWER, ORG_ROLES.DEVELOPER)).toBe(false);
    expect(canRole(ORG_ROLES.VIEWER, ORG_ROLES.VIEWER)).toBe(true);
    expect(canRole(ORG_ROLES.VIEWER, ORG_ROLES.REVIEWER)).toBe(false);
    expect(canRole(ORG_ROLES.ADMIN, ORG_ROLES.OWNER)).toBe(false);
  });
});

describe("Phase 4 approval policies", () => {
  test("glob matching handles branches and paths", () => {
    expect(matchesGlob("main", "main")).toBe(true);
    expect(matchesGlob("main", "develop")).toBe(false);
    expect(matchesGlob("release/*", "release/1.2")).toBe(true);
    expect(matchesGlob("release/*", "release/1.2/hotfix")).toBe(false);
    expect(matchesGlob("**", "anything/at/all")).toBe(true);
    expect(matchesGlob("src/**", "src/lib/foo.ts")).toBe(true);
    expect(matchesGlob("*.env", ".env")).toBe(true);
    expect(matchesGlob("*.env", ".env.prod")).toBe(false); // basename glob, not full path
    expect(matchesGlob("", "anything")).toBe(true);
  });

  test("returns the most restrictive matching policy", () => {
    const policies = [
      {
        action: APPROVAL_ACTIONS.DEPLOY,
        branchGlob: "**",
        minRole: "reviewer" as const,
        minApprovers: 1,
        pathGlobs: [] as string[],
      },
      {
        action: APPROVAL_ACTIONS.DEPLOY,
        branchGlob: "main",
        minRole: "admin" as const,
        minApprovers: 2,
        pathGlobs: [] as string[],
      },
    ];
    const result = evaluateApprovalPolicies(policies, {
      action: APPROVAL_ACTIONS.DEPLOY,
      branch: "main",
      paths: [],
    });
    expect(result?.minRole).toBe("admin");
    expect(result?.minApprovers).toBe(2);
  });

  test("non-matching action or branch yields no policy", () => {
    const policies = [
      {
        action: APPROVAL_ACTIONS.DEPLOY,
        branchGlob: "main",
        minRole: "owner" as const,
        minApprovers: 1,
        pathGlobs: [] as string[],
      },
    ];
    expect(
      evaluateApprovalPolicies(policies, {
        action: APPROVAL_ACTIONS.DEPLOY,
        branch: "develop",
        paths: [],
      }),
    ).toBeNull();
    expect(
      evaluateApprovalPolicies(policies, {
        action: APPROVAL_ACTIONS.DATABASE_MIGRATION,
        branch: "main",
        paths: [],
      }),
    ).toBeNull();
  });

  test("path-scoped policy only applies to matching files", () => {
    const policies = [
      {
        action: APPROVAL_ACTIONS.PROTECTED_BRANCH,
        branchGlob: "**",
        minRole: "developer" as const,
        minApprovers: 1,
        pathGlobs: ["db/**"] as string[],
      },
    ];
    expect(
      evaluateApprovalPolicies(policies, {
        action: APPROVAL_ACTIONS.PROTECTED_BRANCH,
        branch: "main",
        paths: ["db/migrate.ts"],
      }),
    ).not.toBeNull();
    expect(
      evaluateApprovalPolicies(policies, {
        action: APPROVAL_ACTIONS.PROTECTED_BRANCH,
        branch: "main",
        paths: ["src/foo.ts"],
      }),
    ).toBeNull();
  });
});

describe("Phase 4 inbox priority", () => {
  test("sorts high-priority first, then recency", () => {
    const findings = [
      { kind: "docs", createdAt: 300 },
      { kind: "security", createdAt: 100 },
      { kind: "failing_ci", createdAt: 200 },
    ];
    const sorted = sortFindings(findings);
    expect(sorted.map((f) => f.kind)).toEqual([
      "failing_ci",
      "security",
      "docs",
    ]);
  });
});

describe("Phase 4 plugin capability gating", () => {
  test("granted capabilities are a subset of declared", () => {
    const granted = grantCapabilities(
      ["editor", "network"],
      ["editor", "network", "files"],
    );
    expect(granted).toEqual(["editor", "network"]);
  });

  test("pluginCan never grants capabilities the user did not grant", () => {
    const manifest: Parameters<typeof pluginCan>[0] = {
      declaredCapabilities: ["network"],
      grantedCapabilities: [],
    };
    expect(pluginCan(manifest, "network")).toBe(false);
    expect(
      pluginCan(
        { ...manifest, grantedCapabilities: ["network"] },
        "network",
      ),
    ).toBe(true);
  });
});

describe("Phase 4 runtime center detection", () => {
  test("device class by viewport and input", () => {
    expect(detectDeviceClass(390, true, 1)).toBe("mobile");
    expect(detectDeviceClass(768, true, 5)).toBe("tablet");
    expect(detectDeviceClass(1440, true, 0)).toBe("desktop");
    expect(detectDeviceClass(1440, false, 5)).toBe("tablet");
  });

  test("connection summary is honest about unknown state", () => {
    expect(detectConnection(null)).toBe("Unknown");
    expect(
      detectConnection({ effectiveType: "4g", downlink: 10, rtt: 40, saveData: false }),
    ).toBe("4g · 10 Mbps · 40 ms");
  });
});
