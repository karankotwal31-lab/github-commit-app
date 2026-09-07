import { describe, expect, test } from "bun:test";
import {
  CAPSULE_PREFIX,
  analyzeBlastRadius,
  approvalFirewall,
  buildDecisionGraph,
  buildHealthTimeline,
  buildProofReport,
  buildReleaseReadiness,
  buildRescuePlan,
  decodeCapsule,
  encodeCapsule,
  type WorkCapsule,
} from "./trustContinuity";

describe("approval firewall", () => {
  test("keeps ordinary source edits low risk", () => {
    const result = approvalFirewall({
      files: [{ path: "src/components/Card.tsx", action: "update" }],
      operation: "commit",
      branch: "feature/card",
      defaultBranch: "main",
    });
    expect(result.level).toBe("low");
    expect(result.requiresHumanApproval).toBe(false);
  });

  test("escalates auth, workflow and default-branch changes", () => {
    const result = approvalFirewall({
      files: [
        { path: "src/auth/session.ts", action: "update" },
        { path: ".github/workflows/deploy.yml", action: "update" },
      ],
      operation: "deploy",
      branch: "main",
      defaultBranch: "main",
    });
    expect(result.level).toBe("critical");
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.requiresIndependentApproval).toBe(true);
  });

  test("credential-shaped content is critical", () => {
    const result = approvalFirewall({
      files: [{ path: "src/config.ts", content: "const apiKey = 'abcdefghijklmnop';" }],
      operation: "commit",
    });
    expect(result.level).toBe("critical");
    expect(result.sensitiveAreas).toContain("secrets");
  });
});

describe("blast radius", () => {
  test("adds dependency references and verification steps", () => {
    const result = analyzeBlastRadius({
      files: [{ path: "src/api/auth.ts" }],
      referencePaths: ["src/pages/Login.tsx", "src/hooks/useAuth.ts"],
    });
    expect(result.referencedBy).toHaveLength(2);
    expect(result.affectedAreas).toContain("trust boundary");
    expect(result.recommendedVerification.join(" ")).toMatch(/authentication/i);
  });
});

describe("proof mode", () => {
  test("never calls missing deployment evidence verified", () => {
    const proof = buildProofReport({
      repo: "a/b",
      branch: "main",
      commit: "abc",
      changedFiles: ["src/a.ts"],
      ci: { overall: "success", sha: "abc", names: ["Production Check"] },
      deployment: null,
      offlinePending: 0,
      auditEvidence: ["commit ok"],
    });
    expect(proof.verdict).toBe("partially_verified");
    expect(proof.claims.find((c) => c.id === "deployment")?.state).toBe("unverified");
  });

  test("blocks on failed CI or pending offline work", () => {
    const proof = buildProofReport({
      repo: "a/b",
      branch: "main",
      changedFiles: ["src/a.ts"],
      ci: { overall: "failure" },
      deployment: { state: "success" },
      offlinePending: 2,
    });
    expect(proof.verdict).toBe("blocked");
    expect(proof.confidence).toBe("low");
  });
});

describe("work capsules", () => {
  const capsule: WorkCapsule = {
    version: 1,
    name: "Auth investigation",
    repo: "a/b",
    branch: "fix/auth",
    path: "src/auth",
    openPath: "src/auth/session.ts",
    viewMode: "diff",
    focusMode: true,
    aiContext: ["investigate auth", "found redirect issue"],
    createdAt: 123,
  };

  test("round trips only bounded metadata", () => {
    const body = encodeCapsule(capsule);
    expect(body.length).toBeLessThan(3000);
    expect(decodeCapsule(body)).toEqual(capsule);
    expect(`${CAPSULE_PREFIX}${capsule.name}`).toContain("Work Capsule");
  });

  test("rejects arbitrary JSON as a capsule", () => {
    expect(decodeCapsule('{"repo":"a/b"}')).toBeNull();
  });
});

describe("decision graph and health", () => {
  test("links evidence chronologically", () => {
    const graph = buildDecisionGraph({
      flights: [{ request: "fix auth", planSummary: "inspect redirect", filesModified: ["auth.ts"], tests: ["auth.test"], approvals: ["human"], result: "ok", createdAt: 10 }],
      audit: [{ action: "deploy", result: "success", detail: "prod", createdAt: 20 }],
    });
    expect(graph.nodes.length).toBeGreaterThan(3);
    expect(graph.edges.length).toBe(graph.nodes.length - 1);
    expect(graph.nodes[graph.nodes.length - 1].type).toBe("delivery");
  });

  test("health timeline surfaces failures ahead of older changes", () => {
    const timeline = buildHealthTimeline({
      audit: [{ action: "commit", result: "ok", createdAt: 1 }],
      findings: [{ severity: "high", title: "secret", createdAt: 2 }],
    });
    expect(timeline[0].kind).toBe("failure");
  });
});

describe("release cockpit and rescue", () => {
  test("blocks release when proof has unresolved CI", () => {
    const proof = buildProofReport({
      repo: "a/b",
      branch: "main",
      changedFiles: ["src/a.ts"],
      ci: { overall: "pending" },
      deployment: { state: "success" },
      offlinePending: 0,
    });
    const readiness = buildReleaseReadiness({
      proof,
      risk: approvalFirewall({ files: [{ path: "src/a.ts" }], operation: "deploy" }),
      highSecurityFindings: 0,
      deploymentState: "success",
    });
    expect(readiness.state).toBe("blocked");
  });

  test("rescue mode refuses to invent a cause without evidence", () => {
    const plan = buildRescuePlan({ failedChecks: [], changedFiles: [] });
    expect(plan[0].hypothesis).toMatch(/not enough evidence/i);
  });
});
