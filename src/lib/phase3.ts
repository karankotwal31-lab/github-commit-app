/**
 * Phase 3 — pure helper logic for the security command center, project
 * constitution, dependency intelligence, and Aria health scoring.
 *
 * Everything here is deterministic and unit-testable; the Convex actions in
 * securityCenter.ts gather the *evidence* (GitHub + npm + OSV facts, stored
 * findings) and these functions turn it into scores, statuses, and verdicts
 * that never overstate precision.
 */

// ---------------------------------------------------------------------------
// Project constitution (rules)
// ---------------------------------------------------------------------------

/**
 * Match one rule path spec against a file path. Supports:
 *   - exact path            "src/config.ts"
 *   - directory prefix      "src/" or "src/**"   (matches everything under it)
 *   - wildcard file         "*.env"              (matches any path with that basename)
 *   - "*"                   (matches everything)
 */
export function ruleMatchesFile(rulePaths: string[], file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  for (const raw of rulePaths) {
    const spec = raw.trim().replace(/\\/g, "/");
    if (!spec) continue;
    if (spec === "*") return true;
    if (spec.endsWith("/**")) {
      const dir = spec.slice(0, -3);
      if (normalized === dir.slice(0, -1) || normalized.startsWith(dir)) return true;
      continue;
    }
    if (spec.endsWith("/")) {
      if (normalized.startsWith(spec)) return true;
      continue;
    }    if (spec.includes("*")) {
      // Wildcards: a spec without "/" matches against the basename
      // ("*.env" matches "config/.env"), a spec with "/" matches the full
      // path ("config/*.json" matches "config/app.json").
      const escaped = spec
        .split("/")
        .map((segment) =>
          segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"),
        )
        .join("/");
      const re = new RegExp(`^${escaped}$`);
      const target = spec.includes("/") ? normalized : normalized.split("/").pop() ?? "";
      if (re.test(target)) return true;
      continue;
    }
    if (normalized === spec) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dependency intelligence
// ---------------------------------------------------------------------------

export type DepStatus =
  | "vulnerable"
  | "outdated_major"
  | "outdated_minor"
  | "current"
  | "unknown";

export interface DepReport {
  status: DepStatus;
  /** Whole-number difference in the major version (0 when same major). */
  majorDiff: number;
  /** The fixed version from an advisory, when one was reported. */
  fixedVersion: string | null;
}

function parseVersion(version: string | null | undefined): number[] | null {
  if (!version) return null;
  const m = version.match(/\d+(?:\.\d+){0,2}/);
  if (!m) return null;
  return m[0].split(".").map(Number);
}

function majorOf(version: string | null | undefined): number | null {
  const parts = parseVersion(version);
  return parts ? (parts[0] ?? 0) : null;
}

/**
 * Classify a dependency from evidence: an installed version, the latest
 * version on the npm registry, and whether the OSV advisory feed reported any
 * vulnerability for the installed version. Honest about missing data:
 * anything we can't compare becomes "unknown" rather than a guess.
 */
export function depStatus(
  installed: string | null,
  latest: string | null,
  hasOsvVuln: boolean,
): DepReport {
  if (hasOsvVuln) {
    const instMajor = majorOf(installed);
    const latestMajor = majorOf(latest);
    return {
      status: "vulnerable",
      majorDiff:
        instMajor === null || latestMajor === null
          ? 0
          : latestMajor - instMajor,
      fixedVersion: null, // filled in by the scanner from the advisory
    };
  }
  const inst = parseVersion(installed);
  const lat = parseVersion(latest);
  if (inst === null || lat === null) {
    return { status: "unknown", majorDiff: 0, fixedVersion: null };
  }
  const majorDiff = lat[0] - inst[0];
  if (majorDiff > 0) {
    return { status: "outdated_major", majorDiff, fixedVersion: null };
  }
  // Same major: compare minor/patch for a "behind on latest" signal.
  if (lat[1] > (inst[1] ?? 0) || lat[2] > (inst[2] ?? 0)) {
    return { status: "outdated_minor", majorDiff: 0, fixedVersion: null };
  }
  return { status: "current", majorDiff: 0, fixedVersion: null };
}

// ---------------------------------------------------------------------------
// Aria health scoring (explainable, no manufactured precision)
// ---------------------------------------------------------------------------

export interface HealthPart {
  label: string;
  /** 0..1 weight — how much this check counts toward the category score. */
  weight: number;
  pass: boolean;
  evidence: string;
}

/**
 * Weighted category score. A category with no checks yields null (no score,
 * not a fabricated zero). Every score carries the evidence that produced it.
 */
export function healthScore(
  parts: HealthPart[],
): { score: number; evidence: string[] } | null {
  const weighted = parts.filter((p) => p.weight > 0);
  if (weighted.length === 0) return null;
  const totalWeight = weighted.reduce((sum, p) => sum + p.weight, 0);
  const earned = weighted.reduce((sum, p) => sum + (p.pass ? p.weight : 0), 0);
  return {
    score: Math.round((earned / totalWeight) * 100),
    evidence: weighted.map((p) =>
      p.pass ? p.evidence : `✗ ${p.evidence}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Severity / verdict helpers
// ---------------------------------------------------------------------------

export type FindingSeverity = "high" | "medium" | "low";

export function severityRank(s: FindingSeverity): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

/** Sort findings most-severe first, then newest first. */
export function sortFindings<T extends { severity: FindingSeverity; createdAt: number }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.createdAt - a.createdAt,
  );
}

/** Agent permission ladder — higher levels include everything below them. */
export const PERMISSION_LEVELS = [
  "read",
  "suggest",
  "modify",
  "test",
  "git",
  "pr",
  "deploy",
] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export function hasPermission(
  granted: PermissionLevel | null | undefined,
  required: PermissionLevel,
): boolean {
  if (!granted) return false;
  const gi = PERMISSION_LEVELS.indexOf(granted);
  const ri = PERMISSION_LEVELS.indexOf(required);
  return gi >= ri;
}
