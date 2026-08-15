/**
 * Phase 4 — production platform & scale. Pure, testable helpers used by the
 * Convex backend (organizations, approvals, plugins) and the UI. No secrets
 * ever pass through here; no side effects.
 */

/** Org-scoped roles, strongest → weakest. Viewer = read-only. */
export const ORG_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  DEVELOPER: "developer",
  REVIEWER: "reviewer",
  VIEWER: "viewer",
} as const;

export type OrgRole = (typeof ORG_ROLES)[keyof typeof ORG_ROLES];

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  developer: 2,
  reviewer: 1,
  viewer: 0,
};

export function isOrgRole(value: unknown): value is OrgRole {
  return (
    typeof value === "string" && value in ORG_ROLE_RANK
  );
}

/** True when `role` is at least as powerful as `required`. */
export function canRole(role: OrgRole, required: OrgRole): boolean {
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[required];
}

/**
 * Sensitive actions an org can require approval for. Each maps to a minimum
 * role that may act and a minimum number of independent approvals.
 */
export const APPROVAL_ACTIONS = {
  DEPLOY: "deploy",
  PROTECTED_BRANCH: "protected_branch",
  DEPENDENCY_UPGRADE: "dependency_upgrade",
  DATABASE_MIGRATION: "database_migration",
  HIGH_RISK_AI: "high_risk_ai",
} as const;

export type ApprovalAction =
  (typeof APPROVAL_ACTIONS)[keyof typeof APPROVAL_ACTIONS];

export const APPROVAL_ACTION_LABELS: Record<ApprovalAction, string> = {
  deploy: "Production deploy",
  protected_branch: "Protected branch change",
  dependency_upgrade: "Dependency upgrade",
  database_migration: "Database migration",
  high_risk_ai: "High-risk AI operation",
};

export interface ApprovalPolicy {
  action: ApprovalAction;
  /** Branch pattern the policy applies to ("" = all branches). */
  branchGlob: string;
  /** Minimum role allowed to perform the action. */
  minRole: OrgRole;
  /** Minimum number of approvals required (server-authoritative). */
  minApprovers: number;
  /** Optional path patterns the policy applies to ("" = all files). */
  pathGlobs: string[];
}

export interface ApprovalContext {
  action: ApprovalAction;
  branch: string;
  /** File paths touched by the operation ("" or [] = all files). */
  paths: string[];
}

/**
 * Match a glob pattern against a string (used for branches and file paths).
 * Supports `*` (within a segment), `**` (across segments), and exact match.
 */
export function matchesGlob(pattern: string, value: string): boolean {
  if (!pattern) return true; // empty pattern = applies to everything
  if (pattern === "*" || pattern === "**") return true;
  if (!pattern.includes("*")) return pattern === value;
  // Escape regex specials first, then translate globs: `**` spans segments
  // (`.*`), single `*` stays inside a segment (`[^/]*`).
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${regex}$`).test(value);
}

/**
 * Evaluate a list of policies against a concrete action. Returns the single
 * most restrictive matching policy (highest minRole rank, then most
 * approvers), or null when nothing applies.
 */
export function evaluateApprovalPolicies(
  policies: ApprovalPolicy[],
  context: ApprovalContext,
): ApprovalPolicy | null {
  const matching = policies.filter((p) => {
    if (p.action !== context.action) return false;
    if (!matchesGlob(p.branchGlob, context.branch)) return false;
    if (p.pathGlobs.length === 0) return true;
    return context.paths.some((path) =>
      p.pathGlobs.some((glob) => matchesGlob(glob, path)),
    );
  });
  if (matching.length === 0) return null;
  return matching.sort((a, b) => {
    const rankDiff =
      ORG_ROLE_RANK[b.minRole] - ORG_ROLE_RANK[a.minRole];
    if (rankDiff !== 0) return rankDiff;
    return b.minApprovers - a.minApprovers;
  })[0]!;
}

/** Whether a role + approval count satisfies a matched policy. */
export function approvalSatisfied(
  policy: ApprovalPolicy,
  actorRole: OrgRole,
  approvals: number,
): boolean {
  return canRole(actorRole, policy.minRole) && approvals >= policy.minApprovers;
}

/** Inbox priority for a finding, so the inbox can rank actionable items. */
export type FindingPriority = "high" | "medium" | "low";

const KIND_PRIORITY: Record<string, FindingPriority> = {
  security: "high",
  failing_ci: "high",
  mission: "medium",
  dependency_upgrade: "medium",
  stale_pr: "medium",
  dependency: "medium",
  config_change: "low",
  docs: "low",
};

export function findingPriority(kind: string): FindingPriority {
  return KIND_PRIORITY[kind] ?? "low";
}

export const PRIORITY_RANK: Record<FindingPriority, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

export function sortFindings<T extends { kind: string; createdAt: number }>(
  findings: T[],
): T[] {
  return [...findings].sort(
    (a, b) =>
      PRIORITY_RANK[findingPriority(b.kind)] -
        PRIORITY_RANK[findingPriority(a.kind)] ||
      b.createdAt - a.createdAt,
  );
}

/** Plugin capability names the runtime understands. */
export const PLUGIN_CAPABILITIES = [
  "editor",
  "terminal",
  "preview",
  "github.read",
  "ai",
  "notifications",
  "network",
  "files",
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

/** Capabilities a plugin may never hold implicitly — always opt-in. */
export const SENSITIVE_CAPABILITIES: PluginCapability[] = [
  "github.read",
  "network",
  "files",
];

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  /** Declared capabilities (the plugin asks for these). */
  declaredCapabilities: PluginCapability[];
  /** Capabilities the user has actually granted. */
  grantedCapabilities: PluginCapability[];
  /** Human-readable privacy statement shown before install. */
  privacyStatement: string;
  /** "installed" | "disabled" | "uninstalled" */
  status: string;
}

/**
 * A plugin may only exercise capabilities the user granted, and grants are
 * always a subset of what the plugin declared. Sending tokens, credentials,
 * or private-repo data is never a capability — it requires explicit
 * authorization outside the plugin system, so this function can't grant it.
 */
export function pluginCan(
  manifest: Pick<PluginManifest, "declaredCapabilities" | "grantedCapabilities">,
  capability: PluginCapability,
): boolean {
  return (
    manifest.grantedCapabilities.includes(capability) &&
    manifest.declaredCapabilities.includes(capability)
  );
}

/** Grant list for install: intersection of declared + requested. */
export function grantCapabilities(
  declared: PluginCapability[],
  requested: PluginCapability[],
): PluginCapability[] {
  return declared.filter((c) => requested.includes(c));
}

/** Device-class helpers for the runtime center (pure, for tests). */
export function detectDeviceClass(
  width: number,
  hasPointer: boolean,
  touchPoints: number,
): "mobile" | "tablet" | "desktop" {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  if (width >= 1024 && !hasPointer && touchPoints > 0) return "tablet";
  return "desktop";
}

export function detectConnection(entry: {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
} | null): string {
  if (!entry) return "Unknown";
  const parts = [entry.effectiveType ?? "unknown"];
  if (typeof entry.downlink === "number") parts.push(`${entry.downlink} Mbps`);
  if (typeof entry.rtt === "number") parts.push(`${entry.rtt} ms`);
  if (entry.saveData) parts.push("data saver");
  return parts.join(" · ");
}
