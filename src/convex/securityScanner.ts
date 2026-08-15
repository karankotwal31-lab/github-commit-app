"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchWithRetry } from "./net";
import { secretRisk } from "../lib/secrets";
import {
  depStatus,
  hasPermission,
  healthScore,
  ruleMatchesFile,
  type FindingSeverity,
  type PermissionLevel,
} from "../lib/phase3";
import { repoFull } from "./securityCenter";

/**
 * Phase 3 — Security Command Center (network half, "use node").
 *
 * Everything that talks to the outside world lives here: GitHub contents for
 * the secret scan, the npm registry + OSV advisory API for dependency
 * intelligence, GitHub commit data for the docs check, and repo facts for
 * explainable health scoring. The default-runtime half (securityCenter.ts)
 * stores everything and enforces ownership.
 *
 * Honesty rules:
 *  - Evidence records pattern labels + file paths, never secret values.
 *  - OSV findings are real advisory IDs; no curated guesses.
 *  - A category with no evidence gets no score, not a fabricated zero.
 *  - Agents never silently commit/merge/deploy; they prepare proposals the
 *    user reviews and applies.
 */

const GITHUB_API = "https://api.github.com";
const NPM_REGISTRY = "https://registry.npmjs.org";
const OSV_API = "https://api.osv.dev/v1/query";
const USER_AGENT = "aria";

// Scan budgets — keep runs cheap on GitHub rate limits.
const MAX_TREE_ENTRIES = 1200;
const MAX_FILES_SCANNED = 150;
const MAX_DEPS = 40;
const MAX_DOCS_COMMITS = 1;
const MAX_RECENT_COMMITS = 5;

/** Text-ish files worth opening for a content scan. */
const TEXT_EXTENSIONS = new Set([
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".py", ".rb",
  ".go", ".rs", ".java", ".kt", ".sh", ".bash", ".zsh", ".yaml", ".yml",
  ".toml", ".ini", ".cfg", ".conf", ".md", ".txt", ".html", ".css", ".scss",
  ".xml", ".sql", ".env", ".example", ".config", ".lock", ".htm", ".vue",
  ".svelte", ".php", ".cs", ".cpp", ".c", ".h", ".swift", ".proto", ".graphql",
]);
const TEXT_BASENAMES = new Set([
  "dockerfile", "package.json", "package-lock.json", "yarn.lock",
  "pnpm-lock.yaml", "bun.lockb", "composer.json", "requirements.txt",
  "gemfile", "pipfile", "go.mod", "cargo.toml", "makefile", ".gitignore",
  ".npmrc", ".pypirc", ".htaccess", "procfile", "readme", "readme.md",
  "license", "changelog", "changelog.md", "contributing", "contributing.md",
]);

/** Secret-shaped filenames always get scanned regardless of extension. */
const SECRET_PATH =
  /(^|\/)(\.env[a-z0-9._-]*|.*\.pem$|.*\.key$|.*\.p12$|.*\.pfx$|.*\.p8$|id_rsa|id_ed25519|id_dsa|id_ecdsa|secrets?\.(json|ya?ml|toml|ini|env|txt)$|credentials[^/]*\.(json|ya?ml|toml|ini|env|txt)$|service-account[^/]*\.json$|\.npmrc|\.pypirc|\.htpasswd|auth\.config|client_secret|oauth[a-z0-9._-]*\.(json|ya?ml)$)/i;

function isTextCandidate(path: string): boolean {
  if (SECRET_PATH.test(path)) return true;
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  const basename = segments[segments.length - 1] ?? "";
  if (TEXT_BASENAMES.has(basename)) return true;
  const idx = basename.lastIndexOf(".");
  const ext = idx >= 0 ? basename.slice(idx) : "";
  return TEXT_EXTENSIONS.has(ext);
}

async function githubFetch<T>(url: string, token: string): Promise<T> {
  const res = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      (data as { message?: string } | null)?.message ??
      `GitHub request failed (${res.status} ${res.statusText})`;
    throw new Error(message);
  }
  return data as T;
}

interface ScanCtx {
  runQuery: (name: unknown, args: unknown) => Promise<unknown>;
  runMutation: (name: unknown, args: unknown) => Promise<unknown>;
}

/** The connection token for a user, or null when not connected. */
async function tokenFor(
  ctx: ScanCtx,
  userId: string,
): Promise<string | null> {
  const conn = (await ctx.runQuery(internal.github.connectionForUser, {
    userId: userId as never,
  })) as { token: string } | null;
  return conn?.token ?? null;
}

/** Default branch + recursive tree for a repo (best-effort, capped). */
async function repoTree(
  token: string,
  owner: string,
  repo: string,
): Promise<{ defaultBranch: string; paths: string[]; truncated: boolean }> {
  try {
    const meta = await githubFetch<{ default_branch: string }>(
      `${GITHUB_API}/repos/${owner}/${repo}`,
      token,
    );
    const branch = meta.default_branch;
    const tree = await githubFetch<{
      tree: Array<{ path: string; type: string }>;
      truncated?: boolean;
    }>(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
    return {
      defaultBranch: branch,
      paths: (tree.tree ?? [])
        .filter((e) => e.type === "blob")
        .map((e) => e.path)
        .slice(0, MAX_TREE_ENTRIES),
      truncated: !!tree.truncated,
    };
  } catch {
    return { defaultBranch: "main", paths: [], truncated: false };
  }
}

async function fileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<string | null> {
  try {
    const enc = encodeURIComponent;
    const data = await githubFetch<{ content?: string; encoding?: string }>(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${path
        .split("/")
        .map(enc)
        .join("/")}?ref=${encodeURIComponent(branch)}`,
      token,
    );
    if (data.encoding === "base64" && data.content) {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Secret scan
// ---------------------------------------------------------------------------

async function scanSecrets(
  ctx: ScanCtx,
  userId: string,
  owner: string,
  repo: string,
): Promise<{ flagged: string[]; scanned: number }> {
  const token = await tokenFor(ctx, userId);
  if (!token) return { flagged: [], scanned: 0 };
  const fullName = repoFull(owner, repo);
  const { defaultBranch, paths } = await repoTree(token, owner, repo);
  const candidates = paths.filter(isTextCandidate).slice(0, MAX_FILES_SCANNED);
  const keepKeys: string[] = [];
  const flagged: string[] = [];
  let scanned = 0;
  for (const path of candidates) {
    const content = await fileContent(token, owner, repo, path, defaultBranch);
    scanned++;
    if (content === null) continue;
    const risk = secretRisk(path, content);
    if (!risk.risky) continue;
    flagged.push(path);
    const key = `secret:${fullName}:${path}`;
    keepKeys.push(key);
    // Severity: a live-token/private-key hit is high; a filename-only hit is
    // medium (the file may be a placeholder). Content-pattern hits are high.
    const contentHit = risk.reasons.some((r) => r.startsWith("content contains"));
    const severity: FindingSeverity = contentHit ? "high" : "medium";
    await ctx.runMutation(internal.securityCenter.upsertSecurityFinding, {
      userId: userId as never,
      key,
      kind: "secret",
      repo: fullName,
      severity,
      title: `Possible secret in ${path}`,
      detail: contentHit
        ? `${path} contains something that looks like a live credential.`
        : `${path} has a filename that commonly holds secrets.`,
      evidence: `Matched: ${risk.reasons.join("; ")} (values are never stored)`,
      file: path,
      remediation: contentHit
        ? "Remove the credential, rotate it (it must be considered exposed), and add the file to .gitignore."
        : "If this file holds real credentials, move them to a secret manager and gitignore it. If it's a placeholder, rename it (e.g. .env.example).",
    });
    await ctx.runMutation(internal.aiFindingsStore.upsertFinding, {
      userId: userId as never,
      key,
      kind: "security",
      repo: fullName,
      title: `Possible secret in ${path}`,
      detail: `${fullName} · ${risk.reasons.join("; ")}. Remove and rotate — the Security tab has the full remediation.`,
      url: `https://github.com/${fullName}/blob/${encodeURIComponent(defaultBranch)}/${encodeURIComponent(path)}`,
    });
  }
  await ctx.runMutation(internal.securityCenter.pruneSecurityFindings, {
    userId: userId as never,
    repo: fullName,
    keepKeys,
  });
  return { flagged, scanned };
}

// ---------------------------------------------------------------------------
// Dependency scan (npm registry + OSV advisory feed)
// ---------------------------------------------------------------------------

interface OsvVuln {
  id: string;
  summary?: string;
}

async function osvVulns(
  name: string,
  version: string,
): Promise<{ vulns: OsvVuln[]; fixed: string | null }> {
  try {
    const res = await fetchWithRetry(OSV_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: { name, ecosystem: "npm" },
        version,
      }),
    });
    if (!res.ok) return { vulns: [], fixed: null };
    const data = (await res.json()) as { vulns?: OsvVuln[] };
    return { vulns: data.vulns ?? [], fixed: null };
  } catch {
    return { vulns: [], fixed: null };
  }
}

async function npmLatest(name: string): Promise<string | null> {
  try {
    const res = await fetchWithRetry(
      `${NPM_REGISTRY}/${encodeURIComponent(name)}/latest`,
      undefined,
      { attempts: 2 },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function parseInstalled(spec: string): string | null {
  const cleaned = spec
    .replace(/^(~|\^|=|>=|<=|>|<|\*|\s)/g, "")
    .replace(/x/g, "0")
    .trim();
  const full = cleaned.match(/^\d+\.\d+\.\d+/);
  if (full) return full[0];
  const partial = cleaned.match(/^\d+\.\d+/);
  return partial ? `${partial[0]}.0` : null;
}

async function scanDependencies(
  ctx: ScanCtx,
  userId: string,
  owner: string,
  repo: string,
): Promise<{ checked: number; vulnerable: number; outdated: number }> {
  const token = await tokenFor(ctx, userId);
  if (!token) return { checked: 0, vulnerable: 0, outdated: 0 };
  const fullName = repoFull(owner, repo);
  const { defaultBranch } = await repoTree(token, owner, repo);
  const pkgContent = await fileContent(
    token, owner, repo, "package.json", defaultBranch,
  );
  if (!pkgContent) return { checked: 0, vulnerable: 0, outdated: 0 };
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(pkgContent) as typeof pkg;
  } catch {
    return { checked: 0, vulnerable: 0, outdated: 0 };
  }
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  const names = Object.keys(deps).slice(0, MAX_DEPS);
  const keepKeys: string[] = [];
  let vulnerable = 0;
  let outdated = 0;
  for (const name of names) {
    const installed = parseInstalled(deps[name]);
    if (!installed) continue;
    const key = `dep:${fullName}:${name}`;
    keepKeys.push(key);
    const latest = await npmLatest(name);
    const { vulns } = await osvVulns(name, installed);
    const report = depStatus(installed, latest, vulns.length > 0);
    await ctx.runMutation(internal.securityCenter.upsertDependencyReport, {
      userId: userId as never,
      repo: fullName,
      key,
      package: name,
      installed,
      latest: latest ?? undefined,
      status: report.status,
      majorDiff: report.majorDiff,
    });
    if (report.status === "vulnerable") {
      vulnerable++;
      const ids = vulns.map((vuln) => vuln.id).slice(0, 4).join(", ");
      await ctx.runMutation(internal.securityCenter.upsertSecurityFinding, {
        userId: userId as never,
        key: `vuln:${fullName}:${name}`,
        kind: "dependency",
        repo: fullName,
        severity: "high",
        title: `${name} ${installed} has reported vulnerabilities`,
        detail: `OSV reported ${vulns.length} advisory${vulns.length === 1 ? "" : "s"} for ${name} ${installed}.`,
        evidence: ids || "OSV advisory IDs (real feed data)",
        file: "package.json",
        remediation: `Upgrade ${name} to a version with no reported advisories, run the project's tests, and commit the change for review.`,
      });
      await ctx.runMutation(internal.aiFindingsStore.upsertFinding, {
        userId: userId as never,
        key,
        kind: "dependency",
        repo: fullName,
        title: `${name} has known vulnerabilities`,
        detail: `${fullName} pins ${name} ${installed}. Upgrade and re-test — nothing is auto-changed.`,
        url: `https://www.npmjs.com/package/${name}`,
      });
    } else if (report.status === "outdated_major") {
      outdated++;
      await ctx.runMutation(internal.aiFindingsStore.upsertFinding, {
        userId: userId as never,
        key,
        kind: "dependency_upgrade",
        repo: fullName,
        title: `${name} is ${report.majorDiff} major version${report.majorDiff > 1 ? "s" : ""} behind`,
        detail: `${fullName} pins ${name} ${installed}; latest is ${latest ?? "unknown"}. Major upgrades can carry breaking changes — plan the upgrade.`,
        url: `https://www.npmjs.com/package/${name}`,
      });
    }
  }
  await ctx.runMutation(internal.securityCenter.pruneDependencyReports, {
    userId: userId as never,
    repo: fullName,
    keepKeys,
  });
  return { checked: names.length, vulnerable, outdated };
}

// ---------------------------------------------------------------------------
// Documentation intelligence
// ---------------------------------------------------------------------------

async function scanDocs(
  ctx: ScanCtx,
  userId: string,
  owner: string,
  repo: string,
): Promise<{ findings: number }> {
  const token = await tokenFor(ctx, userId);
  if (!token) return { findings: 0 };
  const fullName = repoFull(owner, repo);
  const { defaultBranch, paths } = await repoTree(token, owner, repo);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  const readmePath = ["README.md", "readme.md", "README", "Readme.md"].find(
    (p) => paths.includes(p),
  );
  const readme = readmePath
    ? await fileContent(token, owner, repo, readmePath, defaultBranch)
    : null;
  const keepKeys: string[] = [];
  let findings = 0;
  const push = async (
    severity: FindingSeverity,
    key: string,
    title: string,
    detail: string,
    remediation: string,
  ) => {
    findings++;
    keepKeys.push(key);
    await ctx.runMutation(internal.securityCenter.upsertSecurityFinding, {
      userId: userId as never,
      key,
      kind: "docs",
      repo: fullName,
      severity,
      title,
      detail,
      evidence: "Documentation coverage check (evidence from repo tree/commits)",
      remediation,
    });
    await ctx.runMutation(internal.aiFindingsStore.upsertFinding, {
      userId: userId as never,
      key,
      kind: "docs",
      repo: fullName,
      title,
      detail,
    });
  };

  if (!readme) {
    await push(
      "medium",
      `docs:${fullName}:readme`,
      "No README found",
      `${fullName} has no README — new contributors and Aria's agents have no starting point.`,
      "Add a README with a one-paragraph description, setup instructions, and env vars.",
    );
  } else {
    const lower = readme.toLowerCase();
    if (!/(getting started|quick start|install|setup|usage)/.test(lower)) {
      await push(
        "low",
        `docs:${fullName}:setup`,
        "README lacks setup/usage instructions",
        "The README doesn't clearly explain how to install and run the project.",
        "Add a Getting Started section covering install, env vars, and how to run.",
      );
    }
    if (!/(architecture|structure|overview)/.test(lower)) {
      await push(
        "low",
        `docs:${fullName}:architecture`,
        "README lacks an architecture overview",
        "No architecture or structure section — hard for a new contributor (or agent) to know where things live.",
        "Add a short architecture section describing the main directories and data flow.",
      );
    }
    // Stale check: README's last commit vs latest code commit.
    try {
      const enc = encodeURIComponent;
      const readmeCommit = await githubFetch<Array<{ commit: { committer?: { date?: string } } }>>(
        `${GITHUB_API}/repos/${owner}/${repo}/commits?path=${enc(
          readmePath ?? "",
        )}&per_page=${MAX_DOCS_COMMITS}`,
        token,
      );
      const latestCommit = await githubFetch<Array<{ commit: { committer?: { date?: string } } }>>(
        `${GITHUB_API}/repos/${owner}/${repo}/commits/${enc(defaultBranch)}?per_page=1`,
        token,
      );
      const readmeDate = readmeCommit[0]?.commit?.committer?.date;
      const latestDate = latestCommit[0]?.commit?.committer?.date;
      if (readmeDate && latestDate) {
        const staleDays = Math.floor(
          (new Date(latestDate).getTime() - new Date(readmeDate).getTime()) /
            86_400_000,
        );
        if (staleDays >= 90) {
          await push(
            "low",
            `docs:${fullName}:stale`,
            "README may be stale",
            `The README was last touched ${staleDays} days before the latest commit — the project moved on without it.`,
            "Review the README against the current codebase and update anything outdated.",
          );
        }
      }
    } catch {
      // commit history unavailable — skip the staleness check
    }
  }
  if (!has(/^changelog/i)) {
    await push(
      "low",
      `docs:${fullName}:changelog`,
      "No changelog",
      "No CHANGELOG file — users and reviewers can't see what changed between releases.",
      "Add a CHANGELOG.md (keep-a-changelog format works well).",
    );
  }
  if (!has(/^docs\//) && !has(/^contributing/i)) {
    await push(
      "low",
      `docs:${fullName}:docsdir`,
      "No docs/ directory or contributing guide",
      "There's no docs/ folder or CONTRIBUTING guide.",
      "Add a docs/ directory (or a CONTRIBUTING.md) covering setup and conventions.",
    );
  }
  await ctx.runMutation(internal.securityCenter.pruneSecurityFindings, {
    userId: userId as never,
    repo: fullName,
    keepKeys,
  });
  return { findings };
}

// ---------------------------------------------------------------------------
// Aria health scoring (explainable)
// ---------------------------------------------------------------------------

async function scoreHealth(
  ctx: ScanCtx,
  userId: string,
  owner: string,
  repo: string,
): Promise<{ categories: number }> {
  const token = await tokenFor(ctx, userId);
  if (!token) return { categories: 0 };
  const fullName = repoFull(owner, repo);
  const { defaultBranch, paths, truncated } = await repoTree(token, owner, repo);
  const pathSet = new Set(paths);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  const openFindings = (await ctx.runQuery(
    internal.securityCenter.listSecurityFindingsInternal,
    { userId: userId as never, repo: fullName },
  )) as Array<{ severity: string }>;
  const deps = (await ctx.runQuery(
    internal.securityCenter.listDependencyReportsInternal,
    { userId: userId as never, repo: fullName },
  )) as Array<{ status: string }>;
  const highOpen = openFindings.filter((f) => f.severity === "high").length;
  const vulnerableDeps = deps.filter((d) => d.status === "vulnerable").length;
  const outdatedMajors = deps.filter((d) => d.status === "outdated_major").length;

  const scores: Record<string, number> = {};
  const evidence: Record<string, string[]> = {};

  const architecture = healthScore([
    {
      label: "Has a structured source layout (src/ or lib/ or app/)",
      weight: 0.6,
      pass: has(/^(src|lib|app|packages)\//),
      evidence: "Structured source layout detected",
    },
    {
      label: "Has a manifest (package.json / go.mod / Cargo.toml / pyproject.toml)",
      weight: 0.4,
      pass: has(/^(package\.json|go\.mod|cargo\.toml|pyproject\.toml)$/),
      evidence: "Project manifest detected",
    },
  ]);
  if (architecture) {
    scores.architecture = architecture.score;
    evidence.architecture = architecture.evidence;
  }

  const security = healthScore([
    {
      label: "No high-severity open security findings",
      weight: 0.6,
      pass: highOpen === 0,
      evidence:
        highOpen === 0
          ? "No high-severity findings from the security scan"
          : `${highOpen} high-severity finding${highOpen === 1 ? "" : "s"} open`,
    },
    {
      label: "Has .gitignore",
      weight: 0.4,
      pass: pathSet.has(".gitignore"),
      evidence: pathSet.has(".gitignore")
        ? ".gitignore present"
        : "No .gitignore — build artifacts and env files can be committed by accident",
    },
  ]);
  if (security) {
    scores.security = security.score;
    evidence.security = security.evidence;
  }

  const testing = healthScore([
    {
      label: "Has test files",
      weight: 1,
      pass: has(/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs|rb)$|(__tests__|_test\.)/i),
      evidence: has(/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs|rb)$|(__tests__|_test\.)/i)
        ? "Test files detected"
        : "No test files found in the tree",
    },
  ]);
  if (testing) {
    scores.testing = testing.score;
    evidence.testing = testing.evidence;
  }

  const dependencies = healthScore([
    {
      label: "No vulnerable dependencies",
      weight: 0.6,
      pass: vulnerableDeps === 0,
      evidence:
        vulnerableDeps === 0
          ? "No known-vulnerable dependencies"
          : `${vulnerableDeps} dependency${vulnerableDeps === 1 ? "" : "s"} with advisories`,
    },
    {
      label: "No major-version lag",
      weight: 0.4,
      pass: outdatedMajors === 0,
      evidence:
        outdatedMajors === 0
          ? "Dependencies are on current majors"
          : `${outdatedMajors} major version${outdatedMajors === 1 ? "" : "s"} behind`,
    },
  ]);
  if (dependencies) {
    scores.dependencies = dependencies.score;
    evidence.dependencies = dependencies.evidence;
  }

  const docs = healthScore([
    {
      label: "Has a README",
      weight: 0.4,
      pass: has(/^readme/i),
      evidence: has(/^readme/i) ? "README present" : "No README",
    },
    {
      label: "Has a changelog",
      weight: 0.3,
      pass: has(/^changelog/i),
      evidence: has(/^changelog/i) ? "CHANGELOG present" : "No CHANGELOG",
    },
    {
      label: "Has docs/ or CONTRIBUTING",
      weight: 0.3,
      pass: has(/^(docs\/|contributing)/i),
      evidence: has(/^(docs\/|contributing)/i)
        ? "docs/ or CONTRIBUTING present"
        : "No docs/ or CONTRIBUTING",
    },
  ]);
  if (docs) {
    scores.documentation = docs.score;
    evidence.documentation = docs.evidence;
  }

  const ci = healthScore([
    {
      label: "Has CI configuration",
      weight: 1,
      pass: has(/^\.github\/workflows\/|^\.gitlab-ci\.yml$|^\.circleci\/|^azure-pipelines\.yml$|^Jenkinsfile$/),
      evidence: has(/^\.github\/workflows\/|^\.gitlab-ci\.yml$|^\.circleci\/|^azure-pipelines\.yml$|^Jenkinsfile$/)
        ? "CI configuration detected"
        : "No CI configuration found",
    },
  ]);
  if (ci) {
    scores["ci/cd"] = ci.score;
    evidence["ci/cd"] = ci.evidence;
  }

  // Maintainability evidence needs a small meta fetch (pushed_at + license).
  let pushedRecent = false;
  let hasLicense = false;
  try {
    const meta = await githubFetch<{ pushed_at: string; license?: unknown }>(
      `${GITHUB_API}/repos/${owner}/${repo}`,
      token,
    );
    pushedRecent =
      Date.now() - new Date(meta.pushed_at).getTime() < 90 * 86_400_000;
    hasLicense = !!meta.license || has(/^license/i);
  } catch {
    // no meta — keep the other maintainability checks
  }
  const maintainability = healthScore([
    {
      label: "Actively maintained (pushed within 90 days)",
      weight: 0.5,
      pass: pushedRecent,
      evidence: pushedRecent
        ? "Recent activity (pushed within 90 days)"
        : "No push activity in the last 90 days",
    },
    {
      label: "Has a license",
      weight: 0.25,
      pass: hasLicense,
      evidence: hasLicense ? "LICENSE present" : "No license file",
    },
    {
      label: "Has .gitignore",
      weight: 0.25,
      pass: pathSet.has(".gitignore"),
      evidence: pathSet.has(".gitignore")
        ? ".gitignore present"
        : "No .gitignore",
    },
  ]);
  if (maintainability) {
    scores.maintainability = maintainability.score;
    evidence.maintainability = maintainability.evidence;
  }
  if (truncated) {
    evidence.maintainability = [
      ...(evidence.maintainability ?? []),
      "Note: repo tree was truncated by GitHub — scores use the first sampled paths only.",
    ];
  }

  await ctx.runMutation(internal.securityCenter.upsertRepoHealth, {
    userId: userId as never,
    repo: fullName,
    scores,
    evidence,
  });
  return { categories: Object.keys(scores).length };
}

// ---------------------------------------------------------------------------
// Public scan entry point
// ---------------------------------------------------------------------------

/** Run the full security scan for one connected repo (secret + deps + docs +
 *  health). Everything is written as findings/reports — nothing is changed. */
export const scanRepo = action({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args): Promise<{
    secrets: number;
    dependenciesChecked: number;
    vulnerable: number;
    outdated: number;
    docsFindings: number;
    healthCategories: number;
    disabled: boolean;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    // Repo access is enforced by the internal writers via connectedRepos on
    // each insert — but fail fast with a clear message here.
    const connection = (await ctx.runQuery(internal.github.connectionForUser, {
      userId,
    })) as { token: string } | null;
    if (connection === null) throw new Error("Connect GitHub first.");
    const fullName = repoFull(args.owner, args.repo);
    const repoRow = (await ctx.runQuery(internal.github.listConnectedRepos, {
      userId,
    })) as string[];
    if (!repoRow.includes(fullName)) {
      throw new Error("This repository isn't connected to your Aria account.");
    }
    const scannerCtx = ctx as unknown as ScanCtx;
    const secrets = await scanSecrets(scannerCtx, userId, args.owner, args.repo);
    const deps = await scanDependencies(scannerCtx, userId, args.owner, args.repo);
    const docs = await scanDocs(scannerCtx, userId, args.owner, args.repo);
    const health = await scoreHealth(scannerCtx, userId, args.owner, args.repo);
    await ctx.runMutation(internal.securityCenter.recordFlight, {
      userId,
      repo: fullName,
      request: "Security scan",
      planSummary: `Scanned ${fullName} for secrets, dependencies, docs, and health.`,
      filesInspected: secrets.flagged,
      filesModified: [],
      commands: [],
      tests: [],
      approvals: [],
      result: `${secrets.flagged.length} secret hit${secrets.flagged.length === 1 ? "" : "s"}, ${deps.vulnerable} vulnerable dep${deps.vulnerable === 1 ? "" : "s"}, ${deps.outdated} outdated major${deps.outdated === 1 ? "" : "s"}, ${docs.findings} docs finding${docs.findings === 1 ? "" : "s"}, ${health.categories} health categories scored.`,
    });
    return {
      secrets: secrets.flagged.length,
      dependenciesChecked: deps.checked,
      vulnerable: deps.vulnerable,
      outdated: deps.outdated,
      docsFindings: docs.findings,
      healthCategories: health.categories,
      disabled: false,
    };
  },
});

// ---------------------------------------------------------------------------
// Mission agent steps (controlled, permission-bound, isolated)
// ---------------------------------------------------------------------------

interface MissionRow {
  _id: string;
  userId: string;
  repo: string;
  branch: string;
  title: string;
  objective: string;
  plan: string;
  status: string;
  tasks: Array<{ id: string; label: string; status: string; detail?: string }>;
  agents: Array<{
    role: string;
    permission: string;
    status: string;
    objective: string;
    files: string[];
    result?: string;
  }>;
  approvals: Array<{ by: string; at: number; kind: string; note?: string }>;
}

async function agentFlight(
  ctx: ScanCtx,
  mission: MissionRow,
  role: string,
  summary: string,
  files: string[],
  result: string,
): Promise<void> {
  await ctx.runMutation(internal.securityCenter.recordFlight, {
    userId: mission.userId as never,
    repo: mission.repo,
    missionId: mission._id as never,
    request: `Mission agent: ${role}`,
    planSummary: summary.slice(0, 300),
    filesInspected: files,
    filesModified: [],
    commands: [],
    tests: [],
    approvals: [],
    result: result.slice(0, 800),
  });
}

async function runAnalyst(
  ctx: ScanCtx,
  mission: MissionRow,
): Promise<{ result: string; files: string[] }> {
  const token = await tokenFor(ctx, mission.userId);
  if (!token) throw new Error("GitHub isn't connected — the analyst can't investigate.");
  const [owner, repo] = mission.repo.split("/");
  const { defaultBranch, paths } = await repoTree(token, owner, repo);
  let commits = "";
  try {
    const list = await githubFetch<
      Array<{ sha: string; commit: { message: string; committer?: { date?: string } } }>
    >(
      `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(
        defaultBranch,
      )}?per_page=${MAX_RECENT_COMMITS}`,
      token,
    );
    commits = list
      .map(
        (c) =>
          `- ${c.sha.slice(0, 7)} ${(c.commit.message ?? "").split("\n")[0].slice(0, 80)}`,
      )
      .join("\n");
  } catch {
    commits = "(commit history unavailable)";
  }
  const sampled = paths.slice(0, 60);
  const result = [
    `Repo: ${mission.repo} (default branch ${defaultBranch})`,
    `Sampled ${sampled.length} of ${paths.length} paths (tree ${paths.length > MAX_TREE_ENTRIES ? "truncated" : "complete"}).`,
    "",
    "Top-level layout:",
    [...new Set(sampled.map((p) => p.split("/")[0]))].slice(0, 20).join(", "),
    "",
    `Recent commits on ${defaultBranch}:`,
    commits || "(none)",
    "",
    "This is factual reconnaissance — no changes were made.",
  ].join("\n");
  return { result, files: sampled };
}

async function runCodingAgent(
  ctx: ScanCtx,
  mission: MissionRow,
): Promise<{ result: string; files: string[] }> {
  const agent = mission.agents.find((a) => a.role === "coding");
  const permission = (agent?.permission ?? "suggest") as PermissionLevel;
  if (!hasPermission(permission, "suggest")) {
    throw new Error(
      "The coding agent's permission is below 'suggest' — it can't prepare changes.",
    );
  }
  // Parallel-safety: the coding agent must not claim files another agent has
  // claimed (K). Compare against every other agent's file list.
  const claimedByOthers = new Set<string>();
  for (const other of mission.agents) {
    if (other.role === "coding") continue;
    for (const f of other.files) claimedByOthers.add(f);
  }
  const conflicts = (agent?.files ?? []).filter((f) => claimedByOthers.has(f));
  if (conflicts.length > 0) {
    await ctx.runMutation(internal.securityCenter.updateMissionAgent, {
      missionId: mission._id as never,
      role: "coding",
      status: "blocked",
      result: `Blocked: files ${conflicts.join(", ")} are already claimed by another agent. Resolve the overlap before continuing.`,
    });
    return {
      result: "Blocked — file overlap with another agent.",
      files: agent?.files ?? [],
    };
  }
  const memory = (await ctx.runQuery(
    internal.securityCenter.listMemoryInternal,
    { userId: mission.userId as never, repo: mission.repo },
  )) as Array<{ title: string; body: string }>;
  const rules = (await ctx.runQuery(
    internal.securityCenter.listRulesInternal,
    { userId: mission.userId as never, repo: mission.repo },
  )) as Array<{ title: string; body: string; paths: string[]; action: string }>;
  const relevantRules = (agent?.files ?? []).filter((f) =>
    rules.some((r) => ruleMatchesFile(r.paths, f)),
  );
  const proposal = [
    `Proposed change for “${mission.title}” — NOT APPLIED`,
    "",
    `Objective: ${mission.objective}`,
    `Plan: ${mission.plan}`,
    "",
    "Affected files (claimed for this mission):",
    (agent?.files ?? []).length > 0
      ? (agent?.files ?? []).map((f) => `- ${f}`).join("\n")
      : "- (none specified — list files in the mission or edit the objective)",
    "",
    "Suggested steps:",
    "1. Open each affected file in the editor.",
    "2. Make the minimal change that satisfies the objective.",
    "3. Run the project's typecheck/tests in the Engineering Dock Terminal.",
    "4. Commit with a clear message — the secret guard and project rules still apply.",
    "",
    "Memory context:",
    memory.length > 0
      ? memory.map((m) => `- ${m.title}: ${m.body.slice(0, 200)}`).join("\n")
      : "- (no project memory recorded)",
    "",
    relevantRules.length > 0
      ? `Constitution rules apply to claimed files: ${relevantRules.join(", ")}.`
      : "No constitution rules match the claimed files.",
    "",
    "No files were modified by this agent — apply the change in the editor, then commit with review.",
  ].join("\n");
  return { result: proposal, files: agent?.files ?? [] };
}

async function runReviewer(
  ctx: ScanCtx,
  mission: MissionRow,
): Promise<{ verdict: boolean; notes: string[] }> {
  const coding = mission.agents.find((a) => a.role === "coding");
  const testAgent = mission.agents.find((a) => a.role === "test");
  const notes: string[] = [];
  // 1. Proposed change must not contain secret-shaped content.
  if (coding?.result) {
    const risk = secretRisk("proposal.md", coding.result);
    if (risk.risky) {
      notes.push(
        `The coding proposal trips the secret guard: ${risk.reasons.join("; ")}.`,
      );
    }
  }
  // 2. Claimed files must not violate block rules.
  const gate = (await ctx.runQuery(internal.securityCenter.ruleGateForFiles, {
    repo: mission.repo,
    files: coding?.files ?? [],
  })) as { blocked: unknown[]; review: unknown[] };
  if (gate.blocked.length > 0) {
    notes.push(
      `Blocked by the project constitution: ${gate.blocked.length} rule hit(s) on claimed files.`,
    );
  }
  // 3. Tests must have a plan (the test agent records an honest plan, since
  //    no sandbox runner exists — fabricated results are never accepted).
  if (testAgent?.status !== "done") {
    notes.push("The test agent hasn't finished identifying the verification steps.");
  } else if (!/Terminal|test/i.test(testAgent.result ?? "")) {
    notes.push("The test agent's plan doesn't mention concrete verification steps.");
  }
  // 4. Every other agent must have finished.
  const unfinished = mission.agents.filter(
    (a) => a.status !== "done" && a.role !== "reviewer",
  );
  if (unfinished.length > 0) {
    notes.push(
      `Not all agents finished: ${unfinished.map((a) => a.role).join(", ")}.`,
    );
  }
  const verdict = notes.length === 0;
  return { verdict, notes };
}

/** Run one agent step for a mission. Owner-only; permission-bound. */
export const runAgentStep = action({
  args: { missionId: v.id("missions"), role: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; role: string; result: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const mission = (await ctx.runQuery(internal.securityCenter.missionForAgent, {
      missionId: args.missionId,
    })) as MissionRow | null;
    if (mission === null || mission.userId !== userId) {
      throw new Error("Mission not found.");
    }
    if (mission.status === "cancelled" || mission.status === "done") {
      throw new Error("This mission is closed.");
    }
    const agent = mission.agents.find((a) => a.role === args.role);
    if (!agent) throw new Error("Unknown agent role.");
    if (agent.status === "running") {
      throw new Error("This agent is already running.");
    }
    const scannerCtx = ctx as unknown as ScanCtx;
    await ctx.runMutation(internal.securityCenter.updateMissionAgent, {
      missionId: args.missionId,
      role: args.role,
      status: "running",
    });
    try {
      let result = "";
      let files: string[] = agent.files;
      if (args.role === "analyst") {
        const r = await runAnalyst(scannerCtx, mission);
        result = r.result;
        files = r.files;
      } else if (args.role === "security") {
        const [owner, repo] = mission.repo.split("/");
        const r = await scanSecrets(scannerCtx, mission.userId, owner, repo);
        result = `Secret scan complete: ${r.flagged.length} flagged file${r.flagged.length === 1 ? "" : "s"} (${r.scanned} scanned). Evidence and remediation are in the Security tab — values are never stored.`;
        files = r.flagged;
      } else if (args.role === "coding") {
        const r = await runCodingAgent(scannerCtx, mission);
        result = r.result;
        files = r.files;
      } else if (args.role === "test") {
        result =
          "No sandbox test runner exists in Aria's hosted environment, so this agent cannot fabricate results. Suggested verification: run `bun tsc -b --noEmit` and `bun test` (or the project's equivalent) in the Engineering Dock Terminal, then mark the mission's test task done. Nothing is marked passing without that human-run evidence.";
      } else if (args.role === "reviewer") {
        const v = await runReviewer(scannerCtx, mission);
        const note =
          v.notes.length > 0
            ? `Reviewer found issues:\n${v.notes.map((n) => `- ${n}`).join("\n")}`
            : "Reviewer found no blocking issues — the proposal is ready for your approval.";
        await ctx.runMutation(internal.securityCenter.appendMissionApproval, {
          missionId: args.missionId,
          by: "reviewer",
          kind: "reviewer",
          note: v.notes.length > 0 ? note.slice(0, 1000) : "Reviewed and approved.",
          setStatus: v.verdict ? "awaiting_review" : "active",
        });
        result = note;
      } else {
        throw new Error(`Unknown agent role: ${args.role}`);
      }
      await ctx.runMutation(internal.securityCenter.updateMissionAgent, {
        missionId: args.missionId,
        role: args.role,
        status: "done",
        result,
        files,
      });
      await agentFlight(scannerCtx, mission, args.role, agent.objective, files, result);
      return { ok: true, role: args.role, result };
    } catch (e) {
      const message = e instanceof Error ? e.message : "agent step failed";
      await ctx.runMutation(internal.securityCenter.updateMissionAgent, {
        missionId: args.missionId,
        role: args.role,
        status: "blocked",
        result: message.slice(0, 300),
      });
      await ctx.runMutation(internal.security.logError, {
        source: "securityAgent",
        message: message.slice(0, 300),
        userId: userId as never,
      }).catch(() => {});
      throw e;
    }
  },
});
