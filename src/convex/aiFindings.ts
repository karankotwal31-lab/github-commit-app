"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchWithRetry } from "./net";
import { FEATURE_FLAGS } from "./security";

/**
 * Aria's background checker — runs on a schedule (see crons.ts) and on demand
 * (the "Scan now" button in the inbox). It inspects each repo the user has
 * opened in Aria for:
 *   - outdated / known-vulnerable dependencies (npm registry comparison plus
 *     a small curated CVE map for famous packages),
 *   - pull requests that have been open too long with no activity,
 *   - recent commits that touch config / auth / secret-shaped files,
 *   - CI that keeps failing (combined status on the default branch).
 *
 * Findings are written to the `aiFindings` table, deduped per (user, key), and
 * shown as cards in the inbox with a short plain-language explanation. Nothing
 * is ever fixed automatically — the scans only surface issues for review.
 *
 * The checks are deterministic (facts from GitHub + the npm registry), so the
 * 24×7 cron costs no AI quota and can't hallucinate. Explanations are
 * template-generated from real data.
 */

const GITHUB_API = "https://api.github.com";
const NPM_REGISTRY = "https://registry.npmjs.org";
const USER_AGENT = "aria";

// Scan budget per run — keeps the 6-hourly cron cheap on GitHub rate limits.
const MAX_REPOS_PER_SCAN = 3;
const MAX_DEPS_CHECKED = 12;
const MAX_STALE_PRS = 8;
const MAX_CONFIG_COMMITS = 6;
const MAX_FINDINGS_PER_USER = 25;
const STALE_PR_DAYS = 14;

// Paths that deserve a second look when touched: config, auth, secrets.
const SENSITIVE_PATH =
  /(^|\/)(\.env[a-z0-9.]*|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|credentials|secrets?\.|\.npmrc|\.pypirc|auth\.config|firebase|serviceAccount|oauth\.|client_secret|\.htpasswd)/i;

/**
 * A tiny, curated map of famous packages with well-documented critical/high
 * CVEs below a fixed version. This is a starter list, not an advisory feed —
 * the scan labels these findings as "known-vulnerable versions" only when the
 * installed range clearly predates the fixed version.
 */
const KNOWN_VULNERABLE: Record<string, string> = {
  lodash: "4.17.21", // prototype pollution fixed in 4.17.21 (CVE-2021-23337)
  minimist: "1.2.6", // prototype pollution (CVE-2021-44906)
  axios: "0.21.1", // SSRF (CVE-2020-28168)
  "node-fetch": "2.6.7", // SSRF via URL confusion (CVE-2022-2596)
  tar: "6.1.9", // arbitrary file write (CVE-2021-37713)
  "simple-get": "4.0.1", // SSRF (CVE-2022-0355)
  "follow-redirects": "1.14.9", // credential leak (CVE-2022-0155)
  nanoid: "3.1.31", // crypto randomness (CVE-2021-23566)
  "jsonwebtoken": "9.0.0", // verification bypass (CVE-2022-23529)
  "shell-quote": "1.7.3", // command injection (CVE-2021-42740)
  "ua-parser-js": "0.7.33", // ReDoS (CVE-2022-25927)
  "xmldom": "0.6.0", // prototype pollution (CVE-2021-21366)
};

/** The slice of a Convex action context this scanner uses (shared by the
 *  public action and the internal cron action — structurally identical). */
interface ScanCtx {
  runQuery: (name: unknown, args: unknown) => Promise<unknown>;
  runMutation: (name: unknown, args: unknown) => Promise<unknown>;
}

interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
}

interface FindingInput {
  key: string;
  kind: "dependency" | "stale_pr" | "config_change" | "failing_ci";
  repo: string;
  title: string;
  detail: string;
  url?: string;
}

function encodePath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function githubFetch<T>(
  url: string,
  token: string,
  init?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  },
): Promise<T> {
  // Automatic retry (Part D): transient errors, 429s and 5xx retry with
  // backoff so a flaky network doesn't fail the whole background scan.
  const res = await fetchWithRetry(url, {
    method: init?.method ?? "GET",
    body: init?.body,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...init?.headers,
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

/** Parse a package.json dependency map into installed-version strings. */
function parseDepVersion(spec: string): string | null {
  const cleaned = spec
    .replace(/^(~|\^|=|>=|<=|>|<|\*|\s)/g, "")
    .replace(/x/g, "0")
    .trim();
  const full = cleaned.match(/^\d+\.\d+\.\d+/);
  if (full) return full[0];
  const partial = cleaned.match(/^\d+\.\d+/);
  return partial ? `${partial[0]}.0` : null;
}

function majorOf(version: string): number {
  const m = version.match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Check one repo. Returns findings (dedup keys are repo-scoped). */
async function scanRepo(
  token: string,
  repo: string,
): Promise<FindingInput[]> {
  const [owner, name] = repo.split("/");
  const repoUrl = `${GITHUB_API}/repos/${owner}/${name}`;
  const findings: FindingInput[] = [];

  let info: RepoInfo;
  try {
    const meta = await githubFetch<{
      default_branch: string;
      html_url: string;
    }>(repoUrl, token);
    info = {
      fullName: repo,
      defaultBranch: meta.default_branch,
      htmlUrl: meta.html_url,
    };
  } catch {
    return findings; // repo deleted / access lost — skip quietly
  }
  const branch = info.defaultBranch;

  // --- 1. Dependencies (npm only for v1) -------------------------------
  try {
    const pkg = await githubFetch<{ content: string; encoding: string }>(
      `${repoUrl}/contents/package.json?ref=${encodeURIComponent(branch)}`,
      token,
    );
    if (pkg.encoding === "base64") {
      const parsed = JSON.parse(Buffer.from(pkg.content, "base64").toString("utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = {
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {}),
      };
      const names = Object.keys(deps).slice(0, MAX_DEPS_CHECKED);
      for (const depName of names) {
        const installed = parseDepVersion(deps[depName]);
        if (!installed) continue;
        // Curated CVE map first — the highest-signal check.
        const fixed = KNOWN_VULNERABLE[depName];
        if (fixed && compareVersions(installed, fixed) < 0) {
          findings.push({
            key: `deps:${repo}:${depName}:cve`,
            kind: "dependency",
            repo,
            title: `${depName} has a known vulnerability`,
            detail: `${repo} uses ${depName} ${installed}, which predates the fixed version ${fixed}. Upgrade when you can — a developer should review the change.`,
            url: `https://www.npmjs.com/package/${depName}`,
          });
          continue;
        }
        // Outdated-major check against the npm registry (best-effort).
        try {
          const res = await fetchWithRetry(
            `${NPM_REGISTRY}/${encodeURIComponent(depName)}/latest`,
            undefined,
            { attempts: 2 },
          );
          if (!res.ok) continue;
          const latestData = (await res.json()) as { version?: string };
          const latest = latestData.version;
          if (!latest) continue;
          if (majorOf(latest) > majorOf(installed)) {
            findings.push({
              key: `deps:${repo}:${depName}:old`,
              kind: "dependency",
              repo,
              title: `${depName} is ${majorOf(latest) - majorOf(installed)} major version${majorOf(latest) - majorOf(installed) > 1 ? "s" : ""} behind`,
              detail: `${repo} pins ${depName} ${installed}, but ${latest} is the latest. Major upgrades can carry breaking changes and security fixes — worth a look.`,
              url: `https://www.npmjs.com/package/${depName}`,
            });
          }
        } catch {
          // registry hiccup — never fail the scan for one package
        }
      }
    }
  } catch {
    // no package.json (or not readable) — skip dependency checks
  }

  // --- 2. Stale pull requests -------------------------------------------
  try {
    const pulls = await githubFetch<
      Array<{
        number: number;
        title: string;
        html_url: string;
        updated_at: string;
      }>
    >(
      `${repoUrl}/pulls?state=open&sort=updated&direction=asc&per_page=${MAX_STALE_PRS}`,
      token,
    );
    const now = Date.now();
    for (const pr of pulls) {
      const updated = new Date(pr.updated_at).getTime();
      const days = Math.floor((now - updated) / 86_400_000);
      if (days >= STALE_PR_DAYS) {
        findings.push({
          key: `stale:${repo}#${pr.number}`,
          kind: "stale_pr",
          repo,
          title: `PR #${pr.number} has had no activity for ${days} days`,
          detail: `${repo} · "${pr.title.slice(0, 80)}" hasn't been touched in ${days} days. Consider closing it, reassigning it, or merging the work.`,
          url: pr.html_url,
        });
      }
    }
  } catch {
    // no access or rate-limited — skip
  }

  // --- 3. Suspicious config / auth changes ------------------------------
  try {
    const commits = await githubFetch<
      Array<{ sha: string; commit: { message: string; html_url: string } }>
    >(
      `${repoUrl}/commits?sha=${encodeURIComponent(branch)}&per_page=15`,
      token,
    );
    let checked = 0;
    for (const entry of commits) {
      if (checked >= MAX_CONFIG_COMMITS) break;
      let files: Array<{ filename: string }>;
      try {
        const detail = await githubFetch<{ files: Array<{ filename: string }> }>(
          `${repoUrl}/commits/${entry.sha}`,
          token,
        );
        files = detail.files ?? [];
      } catch {
        continue;
      }
      const touched = files
        .map((f) => f.filename)
        .filter((filename) => SENSITIVE_PATH.test(filename));
      if (touched.length > 0) {
        const message = entry.commit.message.split("\n")[0].slice(0, 90);
        findings.push({
          key: `config:${repo}:${entry.sha}`,
          kind: "config_change",
          repo,
          title: `Commit ${entry.sha.slice(0, 7)} touched ${touched.length === 1 ? "a sensitive file" : "sensitive files"}`,
          detail: `${repo} · "${message}" changed ${touched.join(", ")}. Review it — secrets or auth config changed unexpectedly.`,
          url: entry.commit.html_url,
        });
      }
      checked++;
    }
  } catch {
    // no access — skip
  }

  // --- 4. Failing CI -----------------------------------------------------
  try {
    const status = await githubFetch<{ state: string }>(
      `${repoUrl}/commits/${encodeURIComponent(branch)}/status`,
      token,
    );
    if (status.state === "failure") {
      findings.push({
        key: `ci:${repo}:${branch}`,
        kind: "failing_ci",
        repo,
        title: `CI is failing on ${branch}`,
        detail: `The combined status of ${repo}'s default branch is failing. Recent pushes are breaking the build or tests.`,
        url: `${info.htmlUrl}/actions`,
      });
    }
  } catch {
    // no CI or no access — skip
  }

  return findings;
}

/** Scan one user's repos. Shared by the on-demand action and the cron. */
async function scanForUser(
  ctx: ScanCtx,
  userId: string,
): Promise<{ scanned: number; findings: number }> {
  const connection = (await ctx.runQuery(internal.github.connectionForUser, {
    userId: userId as never,
  })) as { token: string } | null;
  if (connection === null) return { scanned: 0, findings: 0 };
  const repos = (await ctx.runQuery(internal.github.listConnectedRepos, {
    userId: userId as never,
  })) as string[];
  const targets = repos.slice(0, MAX_REPOS_PER_SCAN);
  let total = 0;
  for (const repo of targets) {
    const found = await scanRepo(connection.token, repo);
    for (const f of found) {
      await ctx.runMutation(internal.aiFindingsStore.upsertFinding, {
        userId: userId as never,
        ...f,
      });
      total++;
    }
    await ctx.runMutation(internal.aiFindingsStore.pruneFindings, {
      userId: userId as never,
    });
  }
  return { scanned: targets.length, findings: total };
}

/**
 * Kill switch (Part D): the background AI checker can be turned off instantly
 * by an admin without a redeploy. Returns false when the scanner is disabled.
 */
async function backgroundCheckerEnabled(ctx: ScanCtx): Promise<boolean> {
  try {
    return (await ctx.runQuery(internal.security.featureFlag, {
      key: FEATURE_FLAGS.AI_BACKGROUND_CHECKER,
    })) as boolean;
  } catch {
    return true; // limiter/flag failure must never break the cron
  }
}

/** On-demand scan from the inbox ("Scan now"). */
export const scanRepos = action({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; findings: number; disabled: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    if (!(await backgroundCheckerEnabled(ctx as unknown as ScanCtx))) {
      return { scanned: 0, findings: 0, disabled: true };
    }
    return { ...(await scanForUser(ctx as unknown as ScanCtx, userId)), disabled: false };
  },
});

/** Cron entry: scan every user who has connected repos (runs 24×7). */
export const scanAllUsers = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; disabled: boolean }> => {
    if (!(await backgroundCheckerEnabled(ctx as unknown as ScanCtx))) {
      return { checked: 0, disabled: true };
    }
    // Users who have connected GitHub at all (cheap table scan).
    const ids = (await ctx.runQuery(
      internal.github.listConnectionUserIds,
      {},
    )) as string[];
    let checked = 0;
    for (const userId of ids) {
      try {
        await scanForUser(ctx as unknown as ScanCtx, userId);
        checked++;
      } catch (e) {
        // One user's failure must not block the rest — but it should leave
        // an error-log entry for a human to review (Part D).
        await ctx
          .runMutation(internal.security.logError, {
            source: "aiFindings",
            message:
              e instanceof Error ? e.message.slice(0, 300) : "scan failed",
            userId: userId as never,
          })
          .catch(() => {});
      }
    }
    return { checked, disabled: false };
  },
});

// ---------------------------------------------------------------------------
// One-click dependency-upgrade PRs
//
// Turns a dependency finding into a real, reviewable PR: bump the package to
// the latest version on a fresh branch (aria/upgrade/<dep>) and open a pull
// request against the default branch. Nothing is ever force-pushed and the
// PR is never auto-merged — a human reviews it like any other change.
// ---------------------------------------------------------------------------

interface DependencyKey {
  repo: string;
  depName: string;
  suffix: "cve" | "old";
}

/** Parse a finding key like "deps:owner/repo:lodash:cve" (scoped package
 *  names like "@types/node" are supported — the last colon splits the
 *  suffix). Returns null when the key isn't a dependency finding. */
function parseDependencyKey(key: string): DependencyKey | null {
  const m = key.match(/^deps:(.+):(cve|old)$/);
  if (!m) return null;
  const colon = m[1].indexOf(":");
  if (colon <= 0) return null;
  const repo = m[1].slice(0, colon);
  const depName = m[1].slice(colon + 1);
  if (!repo || !depName || !repo.includes("/")) return null;
  return { repo, depName, suffix: m[2] as "cve" | "old" };
}

/** Read the installed spec from package.json and build the upgraded spec,
 *  preserving the range prefix (^, ~, >=, =, or exact). */
function bumpedSpec(
  spec: string | undefined,
  latest: string,
): string | null {
  if (!spec) return null;
  const m = spec.match(/^(\^|~|>=|<=|=|>|<)?\s*[v]?\d/);
  const prefix = m ? m[1] ?? "" : "";
  return `${prefix}${latest}`;
}

/**
 * Create the upgrade PR. The finding key is parsed server-side (never
 * trust client-supplied repo/dep names), the package's latest version is
 * looked up from the npm registry, package.json is bumped preserving the
 * installed range prefix, and a branch + commit + PR are created via the
 * Git Data API — no force pushes, no auto-merges.
 */
export const createUpgradePr = action({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");

    const parsed = parseDependencyKey(args.key.trim());
    if (!parsed) {
      throw new Error("This finding isn't a dependency upgrade — nothing to bump.");
    }
    const { repo, depName, suffix } = parsed;
    const [owner, name] = repo.split("/");

    // Ownership gate: the finding must actually belong to this user, and the
    // repo must be one they've connected — never operate on another user's
    // repo via a crafted key.
    const finding = (await ctx.runQuery(
      internal.aiFindingsStore.findingByKey,
      { userId, key: args.key.trim() },
    )) as { title: string; detail: string; repo: string } | null;
    if (!finding || finding.repo !== repo) {
      throw new Error("Finding not found — scan again and retry.");
    }
    const connection = (await ctx.runQuery(internal.github.connectionForUser, {
      userId,
    })) as { token: string } | null;
    if (connection === null) {
      throw new Error("GitHub is not connected.");
    }
    const token = connection.token;
    const repoUrl = `${GITHUB_API}/repos/${owner}/${name}`;

    // Default branch + its tree (base for the new commit).
    const meta = await githubFetch<{ default_branch: string }>(repoUrl, token);
    const defaultBranch = meta.default_branch;
    const branchRef = await githubFetch<{ object: { sha: string } }>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
      token,
    );
    const baseSha = branchRef.object.sha;
    const baseCommit = await githubFetch<{ tree: { sha: string } }>(
      `${repoUrl}/git/commits/${baseSha}`,
      token,
    );
    const baseTreeSha = baseCommit.tree.sha;

    // package.json (npm only — the registry check this finding is based on).
    const pkgRes = await githubFetch<{
      content: string;
      encoding: string;
    }>(`${repoUrl}/contents/package.json?ref=${encodeURIComponent(defaultBranch)}`, token);
    if (pkgRes.encoding !== "base64") {
      throw new Error("package.json isn't readable as text.");
    }
    const pkgText = Buffer.from(pkgRes.content, "base64").toString("utf8");
    const pkg = JSON.parse(pkgText) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const inDeps = Object.prototype.hasOwnProperty.call(
      pkg.dependencies ?? {},
      depName,
    );
    const inDevDeps = Object.prototype.hasOwnProperty.call(
      pkg.devDependencies ?? {},
      depName,
    );
    if (!inDeps && !inDevDeps) {
      throw new Error(
        `${depName} isn't in package.json anymore — this finding is stale. Scan again.`,
      );
    }

    // Latest version from the npm registry (same source the scan used).
    const latestRes = await fetchWithRetry(
      `${NPM_REGISTRY}/${encodeURIComponent(depName)}/latest`,
      undefined,
      { attempts: 3 },
    );
    if (!latestRes.ok) {
      throw new Error(`Couldn't reach the npm registry (${latestRes.status}).`);
    }
    const latestData = (await latestRes.json()) as { version?: string };
    const latest = latestData.version;
    if (!latest) throw new Error("The npm registry returned no version.");

    const spec = inDeps ? pkg.dependencies![depName] : pkg.devDependencies![depName];
    const newSpec = bumpedSpec(spec, latest);
    if (!newSpec || newSpec === spec) {
      throw new Error(`${depName} is already at the target version.`);
    }
    if (inDeps) pkg.dependencies![depName] = newSpec;
    if (inDevDeps) pkg.devDependencies![depName] = newSpec;
    const updated = JSON.stringify(pkg, null, 2) + "\n";

    // Create the upgrade branch, commit, and PR.
    const branchName = `aria/upgrade/${depName
      .replace(/^@/, "")
      .replace(/\//g, "-")}`;
    try {
      await githubFetch<unknown>(
        `${repoUrl}/git/refs`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            ref: `refs/heads/${branchName}`,
            sha: baseSha,
          }),
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/already exists/i.test(message)) {
        throw new Error(
          `Branch ${branchName} already exists — a PR may already be open. Check the pull requests tab.`,
        );
      }
      throw e;
    }

    const blob = await githubFetch<{ sha: string }>(
      `${repoUrl}/git/blobs`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ content: updated, encoding: "utf-8" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    const tree = await githubFetch<{ sha: string }>(
      `${repoUrl}/git/trees`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: [
            {
              path: "package.json",
              mode: "100644",
              type: "blob",
              sha: blob.sha,
            },
          ],
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    const reason = suffix === "cve" ? "known-vulnerable version" : "outdated major version";
    const commit = await githubFetch<{ sha: string }>(
      `${repoUrl}/git/commits`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          message: `chore(deps): upgrade ${depName} to ${latest}`,
          tree: tree.sha,
          parents: [baseSha],
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    await githubFetch<unknown>(
      `${repoUrl}/git/refs/heads/${encodeURIComponent(branchName)}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const pr = await githubFetch<{ number: number; html_url: string }>(
      `${repoUrl}/pulls`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          title: `chore(deps): upgrade ${depName} to ${latest}`,
          head: branchName,
          base: defaultBranch,
          body: `Aria found that **${depName}** is on a ${reason}.

- Installed: \`${spec}\`
- Target: \`${latest}\`
- Branch: \`${branchName}\`

Generated from this finding:
> ${finding.title}

> ${finding.detail}

No auto-merge — review and merge when CI is green.`,
        }),
        headers: { "Content-Type": "application/json" },
      },
    );

    await ctx
      .runMutation(internal.securityCenter.audit, {
        userId,
        action: "pr.create",
        repo,
        branch: branchName,
        result: "ok",
        detail: `Upgrade PR #${pr.number} for ${depName}`,
      })
      .catch(() => {});

    return {
      number: pr.number,
      htmlUrl: pr.html_url,
      branch: branchName,
      depName,
      from: spec,
      to: latest,
    };
  },
});


