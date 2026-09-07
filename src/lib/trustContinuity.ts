export type RiskLevel = "low" | "medium" | "high" | "critical";
export type EvidenceState = "proven" | "unverified" | "blocked" | "not_applicable";

export interface ChangeLike {
  path: string;
  action?: "update" | "create" | "delete";
  content?: string;
}

export interface ApprovalDecision {
  level: RiskLevel;
  score: number;
  requiresHumanApproval: boolean;
  requiresIndependentApproval: boolean;
  reasons: string[];
  sensitiveAreas: string[];
}

const SENSITIVE_RULES: Array<{
  pattern: RegExp;
  score: number;
  area: string;
  reason: string;
}> = [
  { pattern: /(^|\/)\.github\/workflows\//i, score: 5, area: "CI/CD", reason: "changes executable CI/CD workflow configuration" },
  { pattern: /(^|\/)(auth|oauth|session|permissions?|rbac|security)(\/|\.|$)/i, score: 5, area: "authentication", reason: "touches authentication, authorization, or security-sensitive code" },
  { pattern: /(^|\/)(billing|stripe|payments?)(\/|\.|$)/i, score: 5, area: "billing", reason: "touches billing or payment behavior" },
  { pattern: /(^|\/)(schema|migrations?)(\.|\/|$)/i, score: 4, area: "data model", reason: "changes a schema or migration path" },
  { pattern: /(^|\/)(Dockerfile|docker-compose|vercel\.json|netlify\.toml|wrangler\.toml|convex\.json)$/i, score: 4, area: "deployment", reason: "changes deployment/runtime infrastructure" },
  { pattern: /(^|\/)(package(-lock)?\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock)$/i, score: 3, area: "dependencies", reason: "changes dependency resolution or lock state" },
  { pattern: /(^|\/)(\.env|secrets?|credentials?)(\.|\/|$)/i, score: 8, area: "secrets", reason: "touches a secret- or credential-shaped path" },
  { pattern: /(^|\/)(public\/sw\.js|service-worker|serviceWorker)/i, score: 3, area: "service worker", reason: "changes code that can persist across browser sessions" },
];

const SECRET_TEXT = /(api[_-]?key|secret|private[_-]?key|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function approvalFirewall(input: {
  files: ChangeLike[];
  operation: "edit" | "commit" | "push" | "merge" | "rebase" | "deploy" | "rollback";
  branch?: string | null;
  defaultBranch?: string | null;
  force?: boolean;
}): ApprovalDecision {
  let score = 0;
  const reasons = new Set<string>();
  const areas = new Set<string>();

  for (const file of input.files) {
    for (const rule of SENSITIVE_RULES) {
      if (!rule.pattern.test(file.path)) continue;
      score += rule.score;
      areas.add(rule.area);
      reasons.add(rule.reason);
    }
    if (file.content && SECRET_TEXT.test(file.content)) {
      score += 10;
      areas.add("secrets");
      reasons.add("content contains credential-shaped material");
    }
    if (file.action === "delete") {
      score += 1;
      reasons.add("includes file deletion");
    }
  }

  if (["merge", "rebase", "deploy", "rollback"].includes(input.operation)) {
    score += input.operation === "deploy" || input.operation === "rollback" ? 5 : 3;
    reasons.add(`${input.operation} can affect shared or production state`);
  }
  if (input.force) {
    score += 8;
    reasons.add("history rewrite / force behavior requested");
  }
  if (
    input.branch &&
    input.defaultBranch &&
    input.branch === input.defaultBranch &&
    input.operation !== "edit"
  ) {
    score += 4;
    reasons.add("operation targets the default branch");
  }
  if (input.files.length > 20) {
    score += 2;
    reasons.add("large change set increases review surface");
  }

  const level: RiskLevel = score >= 12 ? "critical" : score >= 7 ? "high" : score >= 3 ? "medium" : "low";
  return {
    level,
    score,
    requiresHumanApproval: level === "high" || level === "critical",
    requiresIndependentApproval: level === "critical",
    reasons: [...reasons],
    sensitiveAreas: [...areas],
  };
}

export interface BlastRadius {
  level: RiskLevel;
  score: number;
  changedFiles: string[];
  referencedBy: string[];
  affectedAreas: string[];
  recommendedVerification: string[];
  reasons: string[];
}

export function analyzeBlastRadius(input: {
  files: ChangeLike[];
  referencePaths?: string[];
}): BlastRadius {
  const firewall = approvalFirewall({ files: input.files, operation: "commit" });
  const refs = [...new Set(input.referencePaths ?? [])].filter(
    (path) => !input.files.some((file) => file.path === path),
  );
  let score = firewall.score + Math.min(5, Math.floor(refs.length / 3));
  const areas = new Set(firewall.sensitiveAreas);
  const verify = new Set<string>(["run the repository production/typecheck gate", "review the exact staged diff"]);
  const reasons = [...firewall.reasons];

  for (const f of input.files) {
    if (/package|lock|dependencies/i.test(f.path)) {
      areas.add("dependency graph");
      verify.add("run dependency/security checks");
    }
    if (/schema|migration/i.test(f.path)) {
      areas.add("data compatibility");
      verify.add("verify migrations against a disposable environment");
    }
    if (/auth|oauth|session|permission|security/i.test(f.path)) {
      areas.add("trust boundary");
      verify.add("run authentication/authorization regression tests");
    }
    if (/api|http|route/i.test(f.path)) {
      areas.add("API contract");
      verify.add("exercise affected API routes and error paths");
    }
    if (/\.github\/workflows|deploy|vercel|convex\.json/i.test(f.path)) {
      areas.add("delivery pipeline");
      verify.add("verify CI and a non-production deployment before release");
    }
  }
  if (refs.length > 0) reasons.push(`${refs.length} additional repository path${refs.length === 1 ? "" : "s"} reference the changed surface`);
  if (refs.length > 20) score += 2;

  const level: RiskLevel = score >= 14 ? "critical" : score >= 8 ? "high" : score >= 4 ? "medium" : "low";
  return {
    level,
    score,
    changedFiles: input.files.map((f) => f.path),
    referencedBy: refs,
    affectedAreas: [...areas],
    recommendedVerification: [...verify],
    reasons,
  };
}

export interface ProofClaim {
  id: string;
  label: string;
  state: EvidenceState;
  evidence: string[];
}

export interface ProofReport {
  generatedAt: number;
  repo: string;
  branch: string;
  commit: string | null;
  confidence: "high" | "medium" | "low";
  verdict: "verified" | "partially_verified" | "blocked";
  claims: ProofClaim[];
  unresolved: string[];
}

export function buildProofReport(input: {
  repo: string;
  branch: string;
  commit?: string | null;
  changedFiles: string[];
  ci?: { overall: "none" | "pending" | "failure" | "success"; sha?: string | null; names?: string[] } | null;
  deployment?: { state: string; environment?: string | null; targetUrl?: string | null } | null;
  offlinePending: number;
  auditEvidence?: string[];
  flightEvidence?: string[];
}): ProofReport {
  const claims: ProofClaim[] = [];
  const unresolved: string[] = [];
  claims.push({
    id: "changes",
    label: "change set identified",
    state: input.changedFiles.length > 0 ? "proven" : "unverified",
    evidence: input.changedFiles.length > 0 ? input.changedFiles.slice(0, 30) : ["no changed files supplied"],
  });

  const ciState: EvidenceState = !input.ci || input.ci.overall === "none"
    ? "unverified"
    : input.ci.overall === "success"
      ? "proven"
      : input.ci.overall === "failure"
        ? "blocked"
        : "unverified";
  claims.push({
    id: "ci",
    label: "CI / automated verification",
    state: ciState,
    evidence: input.ci
      ? [`overall: ${input.ci.overall}`, ...(input.ci.sha ? [`sha: ${input.ci.sha}`] : []), ...(input.ci.names ?? []).slice(0, 10)]
      : ["CI evidence has not been loaded"],
  });
  if (ciState !== "proven") unresolved.push("CI is not proven green for the current evidence set");

  const deployState = input.deployment?.state;
  const deploymentClaim: EvidenceState = !deployState
    ? "unverified"
    : deployState === "success"
      ? "proven"
      : deployState === "failure" || deployState === "error"
        ? "blocked"
        : "unverified";
  claims.push({
    id: "deployment",
    label: "deployment health",
    state: deploymentClaim,
    evidence: input.deployment
      ? [`state: ${input.deployment.state}`, ...(input.deployment.environment ? [`environment: ${input.deployment.environment}`] : []), ...(input.deployment.targetUrl ? [`target: ${input.deployment.targetUrl}`] : [])]
      : ["no deployment evidence loaded"],
  });
  if (deploymentClaim !== "proven") unresolved.push("live deployment has not been proven healthy");

  claims.push({
    id: "offline",
    label: "offline work reconciled",
    state: input.offlinePending === 0 ? "proven" : "blocked",
    evidence: [input.offlinePending === 0 ? "no pending offline operations" : `${input.offlinePending} operation(s) still pending reconciliation`],
  });
  if (input.offlinePending > 0) unresolved.push("offline work remains queued");

  const trace = [...(input.flightEvidence ?? []), ...(input.auditEvidence ?? [])].slice(0, 20);
  claims.push({
    id: "trace",
    label: "engineering traceability",
    state: trace.length > 0 ? "proven" : "unverified",
    evidence: trace.length > 0 ? trace : ["no flight/audit evidence loaded"],
  });

  const blocked = claims.some((c) => c.state === "blocked");
  const unverified = claims.some((c) => c.state === "unverified");
  return {
    generatedAt: Date.now(),
    repo: input.repo,
    branch: input.branch,
    commit: input.commit ?? null,
    confidence: blocked || unverified ? (blocked ? "low" : "medium") : "high",
    verdict: blocked ? "blocked" : unverified ? "partially_verified" : "verified",
    claims,
    unresolved,
  };
}

export interface WorkCapsule {
  version: 1;
  name: string;
  repo: string;
  branch: string;
  path: string;
  openPath: string | null;
  viewMode: "edit" | "diff" | "preview";
  focusMode: boolean;
  aiContext: string[];
  createdAt: number;
}

export const CAPSULE_PREFIX = "Work Capsule · ";
const CAPSULE_KIND = "aria.work-capsule/v1";

export function encodeCapsule(capsule: WorkCapsule): string {
  const compact = {
    kind: CAPSULE_KIND,
    ...capsule,
    name: capsule.name.slice(0, 80),
    repo: capsule.repo.slice(0, 200),
    branch: capsule.branch.slice(0, 200),
    path: capsule.path.slice(0, 300),
    openPath: capsule.openPath?.slice(0, 300) ?? null,
    aiContext: capsule.aiContext.slice(-4).map((x) => x.slice(0, 240)),
  };
  const encoded = JSON.stringify(compact);
  if (encoded.length > 2800) throw new Error("Work Capsule metadata is too large.");
  return encoded;
}

export function decodeCapsule(body: string): WorkCapsule | null {
  try {
    const value = JSON.parse(body) as Partial<WorkCapsule> & { kind?: string };
    if (
      value.kind !== CAPSULE_KIND || value.version !== 1 || typeof value.name !== "string" ||
      typeof value.repo !== "string" || typeof value.branch !== "string" || typeof value.path !== "string" ||
      !["edit", "diff", "preview"].includes(String(value.viewMode)) || typeof value.focusMode !== "boolean" ||
      !Array.isArray(value.aiContext) || typeof value.createdAt !== "number"
    ) return null;
    return {
      version: 1,
      name: value.name,
      repo: value.repo,
      branch: value.branch,
      path: value.path,
      openPath: typeof value.openPath === "string" ? value.openPath : null,
      viewMode: value.viewMode as WorkCapsule["viewMode"],
      focusMode: value.focusMode,
      aiContext: value.aiContext.filter((x): x is string => typeof x === "string").slice(-4),
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

export interface DecisionNode {
  id: string;
  type: "request" | "analysis" | "change" | "approval" | "verification" | "delivery";
  label: string;
  at: number;
}
export interface DecisionEdge { from: string; to: string }

export function buildDecisionGraph(input: {
  audit: Array<{ action: string; result?: string | null; detail?: string | null; createdAt: number }>;
  flights: Array<{ request: string; planSummary: string; filesModified: string[]; tests: string[]; approvals: string[]; result: string; createdAt: number }>;
}): { nodes: DecisionNode[]; edges: DecisionEdge[] } {
  const nodes: DecisionNode[] = [];
  for (const [i, f] of input.flights.slice(0, 12).entries()) {
    const base = `flight-${i}`;
    nodes.push({ id: `${base}-request`, type: "request", label: f.request, at: f.createdAt });
    nodes.push({ id: `${base}-analysis`, type: "analysis", label: f.planSummary || f.result, at: f.createdAt });
    if (f.filesModified.length) nodes.push({ id: `${base}-change`, type: "change", label: `${f.filesModified.length} file(s): ${f.filesModified.slice(0, 3).join(", ")}`, at: f.createdAt });
    if (f.approvals.length) nodes.push({ id: `${base}-approval`, type: "approval", label: f.approvals.join(" · "), at: f.createdAt });
    if (f.tests.length) nodes.push({ id: `${base}-verify`, type: "verification", label: f.tests.join(" · "), at: f.createdAt });
  }
  for (const [i, a] of input.audit.slice(0, 20).entries()) {
    const type: DecisionNode["type"] = /deploy|release/i.test(a.action) ? "delivery" : /approve|review/i.test(a.action) ? "approval" : /test|check|scan/i.test(a.action) ? "verification" : "change";
    nodes.push({ id: `audit-${i}`, type, label: `${a.action}${a.result ? ` · ${a.result}` : ""}${a.detail ? ` · ${a.detail}` : ""}`, at: a.createdAt });
  }
  nodes.sort((a, b) => a.at - b.at);
  const edges: DecisionEdge[] = [];
  for (let i = 1; i < nodes.length; i++) edges.push({ from: nodes[i - 1].id, to: nodes[i].id });
  return { nodes, edges };
}

export interface ReleaseReadiness {
  state: "ready" | "needs_review" | "blocked";
  score: number;
  blockers: string[];
  warnings: string[];
}

export function buildReleaseReadiness(input: {
  proof: ProofReport;
  risk: ApprovalDecision;
  highSecurityFindings: number;
  deploymentState?: string | null;
}): ReleaseReadiness {
  const blockers = [...input.proof.unresolved.filter((x) => /CI|offline/i.test(x))];
  const warnings: string[] = [];
  const deploymentProof = input.proof.claims.find((claim) => claim.id === "deployment");

  if (input.highSecurityFindings > 0) {
    blockers.push(`${input.highSecurityFindings} high-severity security finding(s) remain`);
  }
  if (deploymentProof?.state === "blocked") {
    blockers.push("deployment evidence reports a failed or blocked deployment");
  } else if (!deploymentProof || deploymentProof.state !== "proven") {
    warnings.push("deployment health is not proven");
  }

  if (input.risk.requiresIndependentApproval) {
    warnings.push("critical-risk change must satisfy the applicable server-authoritative independent approval policy");
  } else if (input.risk.requiresHumanApproval) {
    warnings.push("high-risk change needs explicit human approval");
  }
  if (input.deploymentState && input.deploymentState !== "success" && deploymentProof?.state !== "blocked") {
    warnings.push(`deployment state is ${input.deploymentState}`);
  }
  const score = Math.max(0, 100 - blockers.length * 30 - warnings.length * 12 - Math.min(25, input.risk.score));
  return { state: blockers.length ? "blocked" : warnings.length ? "needs_review" : "ready", score, blockers, warnings };
}

export interface RescueStep { rank: number; hypothesis: string; evidence: string[]; reversibleAction: string }
export function buildRescuePlan(input: {
  failedChecks: string[];
  deploymentError?: string | null;
  changedFiles: string[];
  lastKnownGood?: string | null;
}): RescueStep[] {
  const steps: RescueStep[] = [];
  if (input.failedChecks.length) {
    steps.push({ rank: 1, hypothesis: "the current change broke a validation or CI contract", evidence: input.failedChecks.slice(0, 8), reversibleAction: "inspect the failed logs and prepare a source-controlled fix; do not bypass the gate" });
  }
  if (input.deploymentError) {
    steps.push({ rank: steps.length + 1, hypothesis: "the deployment environment or runtime rejected the build", evidence: [input.deploymentError], reversibleAction: "compare environment/runtime assumptions against a separately verified successful release before changing production" });
  }
  const infrastructure = input.changedFiles.filter((p) => /workflow|deploy|docker|vercel|convex|package|lock|env|config/i.test(p));
  if (infrastructure.length) {
    steps.push({ rank: steps.length + 1, hypothesis: "delivery/configuration changes may explain the failure", evidence: infrastructure.slice(0, 10), reversibleAction: "simulate or revert only the implicated configuration change on a branch, then rerun verification" });
  }
  if (input.lastKnownGood) {
    steps.push({ rank: steps.length + 1, hypothesis: "a candidate rollback SHA was supplied", evidence: [`candidate rollback SHA: ${input.lastKnownGood}`], reversibleAction: "verify this SHA was actually healthy in the target environment before using it as a rollback point; prefer a Git revert/fix over manual production edits" });
  }
  if (!steps.length) {
    steps.push({ rank: 1, hypothesis: "there is not enough evidence to name a root cause", evidence: ["no failed checks or deployment error supplied"], reversibleAction: "collect CI/runtime evidence before proposing a fix" });
  }
  return steps;
}

export interface HealthEvent { at: number; kind: "positive" | "warning" | "failure" | "change"; label: string }
export function buildHealthTimeline(input: {
  audit: Array<{ action: string; result?: string | null; detail?: string | null; createdAt: number }>;
  findings: Array<{ severity: string; title: string; createdAt: number }>;
}): HealthEvent[] {
  const events: HealthEvent[] = [];
  for (const a of input.audit.slice(0, 50)) {
    const failure = /fail|blocked|error|denied/i.test(a.result ?? "");
    const positive = /ok|success|approved|verified/i.test(a.result ?? "");
    events.push({ at: a.createdAt, kind: failure ? "failure" : positive ? "positive" : "change", label: `${a.action}${a.result ? ` · ${a.result}` : ""}${a.detail ? ` · ${a.detail}` : ""}` });
  }
  for (const f of input.findings.slice(0, 30)) {
    events.push({ at: f.createdAt, kind: f.severity === "high" ? "failure" : "warning", label: `${f.severity} finding · ${f.title}` });
  }
  return events.sort((a, b) => b.at - a.at).slice(0, 60);
}
