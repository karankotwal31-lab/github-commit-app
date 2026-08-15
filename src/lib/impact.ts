/**
 * Impact analysis for the Engineering dock.
 *
 * Static, in-browser: given a target file and the repo's file list, find what
 * the file imports and which other files import it, then classify the change
 * risk. Honest about being static-only — it can't see runtime callers, API
 * consumers, or database queries; those are noted as limitations, never
 * fabricated.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ImpactAnalysis {
  targetPath: string;
  /** Resolved repo-relative module paths this file imports. */
  imports: string[];
  /** Import specifiers that couldn't be resolved to a repo file (external). */
  unresolvedImports: string[];
  /** Repo files (with content available) that import the target. */
  dependents: string[];
  /** Dependents that look like tests (test/spec files or __tests__). */
  testDependents: string[];
  risk: RiskLevel;
  riskReason: string;
  evidence: string[];
  /** Files not scanned for dependents (content unavailable). */
  skippedFiles: number;
}

/** Extract import specifiers from source: ESM, export-from, dynamic, require. */
export function extractImports(source: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (spec: string | undefined) => {
    if (!spec) return;
    const clean = spec.trim().replace(/[?#].*$/, ""); // strip query/hash
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };
  // import x from "y" / import "y" / export ... from "y"
  const esm = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = esm.exec(source)) !== null) push(m[1]);
  // dynamic import("y")
  const dyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dyn.exec(source)) !== null) push(m[1]);
  // require("y")
  const req = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = req.exec(source)) !== null) push(m[1]);
  return out;
}

/** Resolve a relative specifier from `fromPath` into a normalized repo path. */
export function resolveRelative(spec: string, fromPath: string): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const parts = [...(dir ? dir.split("/") : []), ...spec.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  if (out.length === 0) return null;
  return out.join("/");
}

const CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

/** Best repo file match for a specifier, or null when unresolvable. */
export function matchModulePath(
  spec: string,
  fromPath: string,
  allFiles: string[],
): string | null {
  const resolved = resolveRelative(spec, fromPath);
  if (!resolved) return null;
  const set = new Set(allFiles);
  for (const suffix of CANDIDATE_SUFFIXES) {
    if (set.has(resolved + suffix)) return resolved + suffix;
  }
  // Case-insensitive fallback for Windows-style mismatches.
  const lower = resolved.toLowerCase();
  const found = allFiles.find((f) => f.toLowerCase().startsWith(lower));
  if (found) return found;
  return null;
}

const INFRA_PATTERNS = [
  /(^|\/)(auth|convex|db|migrations?|prisma|drizzle)[^/]*\//i,
  /(^|\/)(schema|convex\.config|auth\.config|drizzle\.config|prisma\.schema)[^/]*\.(ts|js|json)$/i,
  /(^|\/)package\.json$/,
  /(^|\/)vite\.config\./,
  /(^|\/)tailwind\.config\./,
  /(^|\/)(deploy|k8s|terraform|docker-compose|\.github\/workflows?)\//i,
  /(^|\/)\.env/i,
];

function isInfraPath(path: string): boolean {
  return INFRA_PATTERNS.some((re) => re.test(path));
}

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec)[^/]*\//i.test(path) ||
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path);
}

export interface AnalyzeImpactOptions {
  targetPath: string;
  /** Optional: the target's own source, to list what it imports. */
  targetContent?: string;
  allFiles: string[];
  /** Bounded map of path → content used for the dependent scan. */
  fileContents?: Record<string, string>;
  /** Cap how many files are scanned for dependents (protects the UI). */
  maxScan?: number;
}

export function analyzeImpact(opts: AnalyzeImpactOptions): ImpactAnalysis {
  const {
    targetPath,
    targetContent,
    allFiles,
    fileContents = {},
    maxScan = 400,
  } = opts;
  const evidence: string[] = [];

  // What the target itself imports.
  const imports: string[] = [];
  const unresolvedImports: string[] = [];
  if (targetContent) {
    for (const spec of extractImports(targetContent)) {
      const matched = matchModulePath(spec, targetPath, allFiles);
      if (matched) imports.push(matched);
      else unresolvedImports.push(spec);
    }
  }

  // Who imports the target.
  const dependents: string[] = [];
  const testDependents: string[] = [];
  const candidates = allFiles
    .filter((f) => f !== targetPath)
    .slice(0, maxScan);
  let scanned = 0;
  for (const path of candidates) {
    const content = fileContents[path];
    if (content === undefined) continue;
    scanned++;
    for (const spec of extractImports(content)) {
      if (matchModulePath(spec, path, allFiles) === targetPath) {
        dependents.push(path);
        if (isTestPath(path)) testDependents.push(path);
        break;
      }
    }
  }

  // Risk classification, with evidence for every claim.
  let risk: RiskLevel = "LOW";
  const infra = isInfraPath(targetPath);
  const nonTest = dependents.filter((d) => !isTestPath(d));
  const skippedFiles = Math.max(0, candidates.length - scanned);

  if (infra) {
    risk = "CRITICAL";
    evidence.push(
      "Target sits in auth/config/schema/deployment territory — a wrong change can break sign-in, the database, or deploys.",
    );
  } else if (dependents.length > 10) {
    risk = "CRITICAL";
    evidence.push(`${dependents.length} files import this module directly.`);
  } else if (dependents.length >= 5) {
    risk = "HIGH";
    evidence.push(`${dependents.length} files import this module directly.`);
  } else if (nonTest.length > 0) {
    risk = "MEDIUM";
    evidence.push(
      `${nonTest.length} non-test file${nonTest.length === 1 ? "" : "s"} import${nonTest.length === 1 ? "s" : ""} this module.`,
    );
  } else if (testDependents.length > 0) {
    risk = "MEDIUM";
    evidence.push(
      `${testDependents.length} test file${testDependents.length === 1 ? "" : "s"} import${testDependents.length === 1 ? "s" : ""} this module — changing it may break tests.`,
    );
  } else if (imports.length === 0 && unresolvedImports.length === 0) {
    risk = "LOW";
    evidence.push("Leaf file: no imports and nothing in this repo imports it.");
  }

  if (testDependents.length > 0 && nonTest.length > 0) {
    evidence.push(
      "Referenced by both tests and production code — a regression here fails CI and runtime.",
    );
  }
  if (unresolvedImports.length > 0) {
    evidence.push(
      `External imports (${unresolvedImports.slice(0, 5).join(", ")})${
        unresolvedImports.length > 5 ? "…" : ""
      } — behavior depends on third-party packages.`,
    );
  }
  if (skippedFiles > 0) {
    evidence.push(
      `${skippedFiles} files were not scanned (content unavailable locally) — dependents may be undercounted.`,
    );
  }

  const riskReason =
    risk === "CRITICAL"
      ? infra
        ? "Infrastructure-critical path"
        : "Very widely imported"
      : risk === "HIGH"
        ? "Widely imported"
        : risk === "MEDIUM"
          ? "Has direct dependents or external deps"
          : "Low blast radius";

  return {
    targetPath,
    imports,
    unresolvedImports,
    dependents,
    testDependents,
    risk,
    riskReason,
    evidence,
    skippedFiles,
  };
}
