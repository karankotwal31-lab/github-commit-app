"use node";

/**
 * Phase 2 — Engineering Command Center backend.
 *
 * Actions behind the Engineering dock: pull-request detail/editing, per-file
 * history with PR association, branch/tag management, failed-CI evidence, and
 * the grounded CI-failure investigation (AI proposes, never applies).
 *
 * githubFetch/getToken are kept local to this module (same convention as
 * aiActions.ts) so every Phase 2 action shares one retry + rate-limit path.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { cleanMultiline, cleanName, cleanPath } from "../lib/sanitize";
import { fetchWithRetry } from "./net";
import { chatCompletion, hasAnyAiProvider } from "./aiProvider";
import {
  AI_REQUESTS_PER_MINUTE,
  GITHUB_ACTIONS_PER_MINUTE,
} from "./security";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "aria";

function githubHeaders(token: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
    ...extra,
  };
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
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithRetry(url, {
    ...init,
    headers: githubHeaders(
      token,
      init?.headers as Record<string, string> | undefined,
    ),
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

/** Signed-in user's GitHub token + per-user GitHub action rate limit. */
async function getToken(ctx: ActionCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("You are not signed in.");
  }
  const allowed = await ctx.runMutation(internal.security.bumpRateLimit, {
    bucket: `github:${userId}`,
    limit: GITHUB_ACTIONS_PER_MINUTE,
  });
  if (!allowed) {
    throw new Error(
      "You're making GitHub requests too quickly — wait a minute and try again.",
    );
  }
  const connection = await ctx.runQuery(internal.github.connectionForUser, {
    userId,
  });
  if (connection === null) {
    throw new Error("GitHub is not connected.");
  }
  return connection.token;
}

/** Per-user AI rate limit (mirrors aiActions). */
async function assertAiRateLimit(ctx: ActionCtx, userId: string): Promise<void> {
  const allowed = await ctx.runMutation(internal.security.bumpRateLimit, {
    bucket: `ai:${userId}`,
    limit: AI_REQUESTS_PER_MINUTE,
  });
  if (!allowed) {
    throw new Error(
      "You're sending AI requests too quickly — wait a minute and try again.",
    );
  }
}

/** Extract a JSON object from the model's reply, tolerating code fences. */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // fall through to a full parse attempt
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pull-request command center
// ---------------------------------------------------------------------------

/**
 * Full detail for one pull request: body, changed files with patches, CI
 * checks on the head, reviews, and comments. All real GitHub data.
 */
export const getPullRequestDetail = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    number: v.number(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const prUrl = `${repoUrl}/pulls/${args.number}`;

    const [pr, filesData, reviews, comments, issueComments] = await Promise.all([
      githubFetch<{
        number: number;
        title: string;
        body?: string | null;
        html_url?: string;
        state?: string;
        draft?: boolean;
        user?: { login?: string } | null;
        created_at?: string | null;
        updated_at?: string | null;
        mergeable?: boolean | null;
        mergeable_state?: string;
        head?: { ref?: string; sha?: string } | null;
        base?: { ref?: string } | null;
      }>(prUrl, token),
      githubFetch<Array<{
        filename?: string;
        status?: string;
        additions?: number;
        deletions?: number;
        patch?: string | null;
      }>>(`${prUrl}/files?per_page=100`, token),
      githubFetch<Array<{
        user?: { login?: string } | null;
        state?: string;
        submitted_at?: string | null;
        body?: string | null;
      }>>(`${prUrl}/reviews?per_page=50`, token).catch(() => []),
      githubFetch<Array<{
        user?: { login?: string } | null;
        path?: string | null;
        line?: number | null;
        body?: string | null;
        created_at?: string | null;
      }>>(`${prUrl}/comments?per_page=50`, token).catch(() => []),
      githubFetch<Array<{
        user?: { login?: string } | null;
        body?: string | null;
        created_at?: string | null;
      }>>(`${repoUrl}/issues/${args.number}/comments?per_page=50`, token).catch(
        () => [],
      ),
    ]);

    // Keep the response small: cap total patch characters.
    let budget = 200_000;
    const files = (filesData ?? [])
      .slice(0, 100)
      .map((f) => {
        const patch = f.patch ?? "";
        const clipped = patch.slice(
          0,
          Math.max(0, Math.min(budget, patch.length)),
        );
        budget -= clipped.length;
        return {
          path: f.filename ?? "",
          status: f.status ?? "",
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          patch: clipped,
        };
      })
      .filter((f) => f.path);

    // CI checks on the head commit.
    let checks: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
    }> = [];
    if (pr.head?.sha) {
      try {
        const run = await githubFetch<{
          check_runs?: Array<{
            name?: string | null;
            status?: string | null;
            conclusion?: string | null;
            details_url?: string | null;
            app?: { name?: string | null } | null;
          }>;
        }>(`${repoUrl}/commits/${pr.head.sha}/check-runs?per_page=50`, token);
        checks = (run.check_runs ?? []).map((c) => ({
          name: c.name ?? c.app?.name ?? "check",
          status: c.status ?? "",
          conclusion: c.conclusion ?? null,
          detailsUrl: c.details_url ?? null,
        }));
      } catch {
        // No checks — that's fine.
      }
    }

    const failed = new Set([
      "failure",
      "timed_out",
      "cancelled",
      "action_required",
    ]);
    const overall: "none" | "pending" | "failure" | "success" =
      checks.length === 0
        ? "none"
        : checks.some(
              (c) => c.conclusion !== null && failed.has(c.conclusion),
            )
          ? "failure"
          : checks.some(
                (c) => c.status === "in_progress" || c.status === "queued",
              )
            ? "pending"
            : "success";

    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      htmlUrl: pr.html_url ?? null,
      state: pr.state ?? "",
      draft: pr.draft ?? false,
      author: pr.user?.login ?? "unknown",
      createdAt: pr.created_at ?? null,
      updatedAt: pr.updated_at ?? null,
      mergeable: pr.mergeable ?? null,
      mergeableState: pr.mergeable_state ?? "",
      head: pr.head?.ref ?? "",
      headSha: pr.head?.sha ?? null,
      base: pr.base?.ref ?? "",
      files,
      checks,
      overall,
      reviews: (reviews ?? []).map((r) => ({
        author: r.user?.login ?? "unknown",
        state: r.state ?? "",
        submittedAt: r.submitted_at ?? null,
        body: r.body ?? "",
      })),
      reviewComments: (comments ?? []).map((c) => ({
        author: c.user?.login ?? "unknown",
        path: c.path ?? "",
        line: c.line ?? null,
        body: c.body ?? "",
        createdAt: c.created_at ?? null,
      })),
      issueComments: (issueComments ?? []).map((c) => ({
        author: c.user?.login ?? "unknown",
        body: c.body ?? "",
        createdAt: c.created_at ?? null,
      })),
    };
  },
});

/** Edit a pull request's title and/or body. */
export const updatePullRequest = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    number: v.number(),
    title: v.string(),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const title = cleanMultiline(args.title, 300);
    if (!title) throw new Error("Title is required.");
    const token = await getToken(ctx);
    const body: Record<string, string> = { title };
    if (args.body !== undefined) {
      body.body = cleanMultiline(args.body, 5000);
    }
    const data = await githubFetch<{ number: number; title: string; html_url?: string }>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls/${args.number}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
    );
    return {
      number: data.number,
      title: data.title,
      htmlUrl: data.html_url ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// Time machine (per-file history)
// ---------------------------------------------------------------------------

/**
 * Commits touching one file path on a branch, with any PR that introduced
 * each commit (when GitHub can associate one).
 */
export const getFileHistory = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    path: v.string(),
    branch: v.string(),
    perPage: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const perPage = Math.min(Math.max(args.perPage ?? 50, 1), 100);
    const path = cleanPath(args.path, 500);
    if (!path) throw new Error("That file path isn't valid.");
    const data = await githubFetch<Array<{
      sha: string;
      html_url: string;
      commit: {
        message: string;
        author: { name: string | null; date: string | null } | null;
      };
    }>>(
      `${repoUrl}/commits?sha=${encodeURIComponent(
        args.branch,
      )}&path=${encodePath(path)}&per_page=${perPage}`,
      token,
    );
    // Best-effort PR association for the most recent commits only (one extra
    // GitHub call each) — older entries just carry no PR.
    const items = data.slice(0, 15);
    const rows = await Promise.all(
      items.map(async (c) => {
        let pr: { number: number; title: string; htmlUrl: string } | null =
          null;
        try {
          const pulls = await githubFetch<
            Array<{ number: number; title: string; html_url: string }>
          >(`${repoUrl}/commits/${c.sha}/pulls`, token);
          const first = pulls?.[0];
          if (first) {
            pr = {
              number: first.number,
              title: first.title,
              htmlUrl: first.html_url,
            };
          }
        } catch {
          // No PR association available — leave it null.
        }
        return {
          sha: c.sha,
          message: c.commit.message,
          author: c.commit.author?.name ?? "unknown",
          date: c.commit.author?.date ?? null,
          htmlUrl: c.html_url,
          pr,
        };
      }),
    );
    return { path, commits: rows };
  },
});

// ---------------------------------------------------------------------------
// Branch & tag operations
// ---------------------------------------------------------------------------

/** Rename a branch: new ref pointing at the old tip, then delete the old ref. */
export const renameBranch = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    oldName: v.string(),
    newName: v.string(),
  },
  handler: async (ctx, args) => {
    const oldName = cleanName(args.oldName, 200).replace(/\s+/g, "-");
    const newName = cleanName(args.newName, 200).replace(/\s+/g, "-");
    if (!oldName || !newName || oldName === newName) {
      throw new Error("That branch rename isn't valid.");
    }
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const ref = await githubFetch<{ object: { sha: string } }>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(oldName)}`,
      token,
    );
    try {
      await githubFetch<{ object: { sha: string } }>(
        `${repoUrl}/git/ref/heads/${encodeURIComponent(newName)}`,
        token,
      );
      throw new Error("A branch with that name already exists.");
    } catch (e) {
      if (e instanceof Error && e.message.includes("already exists")) throw e;
      // 404 — the new name is free.
    }
    await githubFetch<{ object: { sha: string } }>(
      `${repoUrl}/git/refs`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${newName}`,
          sha: ref.object.sha,
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    await githubFetch<{ deleted: boolean }>(
      `${repoUrl}/git/refs/heads/${encodeURIComponent(oldName)}`,
      token,
      { method: "DELETE" },
    );
    return { oldName, newName, sha: ref.object.sha };
  },
});

/** Delete a branch on GitHub. Destructive — the UI must confirm first. */
export const deleteBranch = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const name = cleanName(args.name, 200);
    if (!name) throw new Error("That branch name isn't valid.");
    const token = await getToken(ctx);
    await githubFetch<{ deleted: boolean }>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/git/refs/heads/${encodeURIComponent(
        name,
      )}`,
      token,
      { method: "DELETE" },
    );
    return { name };
  },
});

/** Tags on the repo (name + target sha). */
export const listTags = action({
  args: {
    owner: v.string(),
    repo: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    const data = await githubFetch<
      Array<{ name: string; commit: { sha: string } }>
    >(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/tags?per_page=100`,
      token,
    );
    return data.map((t) => ({ name: t.name, sha: t.commit.sha }));
  },
});

/** Create a lightweight tag pointing at `sha`. */
export const createTag = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    name: v.string(),
    sha: v.string(),
  },
  handler: async (ctx, args) => {
    const name = cleanName(args.name, 200).replace(/\s+/g, "-");
    if (!name) throw new Error("That tag name isn't valid.");
    const token = await getToken(ctx);
    await githubFetch<{ object: { sha: string } }>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/git/refs`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ ref: `refs/tags/${name}`, sha: args.sha }),
        headers: { "Content-Type": "application/json" },
      },
    );
    return { name, sha: args.sha };
  },
});

/** Delete a tag. Destructive — the UI must confirm first. */
export const deleteTag = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const name = cleanName(args.name, 200);
    if (!name) throw new Error("That tag name isn't valid.");
    const token = await getToken(ctx);
    await githubFetch<{ deleted: boolean }>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/git/refs/tags/${encodeURIComponent(
        name,
      )}`,
      token,
      { method: "DELETE" },
    );
    return { name };
  },
});

// ---------------------------------------------------------------------------
// CI failure investigation
// ---------------------------------------------------------------------------

/**
 * Evidence for failed CI checks on a branch tip: job steps (which step
 * failed), output summaries, and annotations. Full logs stay on GitHub —
 * Aria reports what the API exposes and links out for the complete log.
 */
export const getFailedCheckDetails = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const commit = await githubFetch<{ sha: string }>(
      `${repoUrl}/commits/${encodeURIComponent(args.branch)}`,
      token,
    );
    const sha = commit.sha;
    const failedConcl = new Set([
      "failure",
      "timed_out",
      "cancelled",
      "action_required",
    ]);
    const run = await githubFetch<{
      check_runs?: Array<{
        id?: number;
        name?: string | null;
        conclusion?: string | null;
        status?: string | null;
        html_url?: string | null;
        details_url?: string | null;
        started_at?: string | null;
        completed_at?: string | null;
        app?: { name?: string | null } | null;
      }>;
    }>(`${repoUrl}/commits/${sha}/check-runs?per_page=50`, token);
    const failed = (run.check_runs ?? []).filter(
      (c) =>
        c.conclusion !== null &&
        c.conclusion !== undefined &&
        failedConcl.has(c.conclusion),
    );
    if (failed.length === 0) {
      return { sha, branch: args.branch, failed: [] as never[] };
    }

    const details = await Promise.all(
      failed.slice(0, 5).map(async (c) => {
        interface CheckRunDetailOutput {
          output?: {
            title?: string | null;
            summary?: string | null;
            text?: string | null;
            annotations?: Array<{
              path?: string | null;
              message?: string | null;
              title?: string | null;
            }> | null;
          } | null;
        }
        let detail: CheckRunDetailOutput | null = null;
        let jobs: Array<{
          name?: string | null;
          conclusion?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          steps?: Array<{
            name?: string | null;
            conclusion?: string | null;
          }> | null;
        }> = [];
        try {
          detail = await githubFetch<CheckRunDetailOutput>(
            `${repoUrl}/check-runs/${c.id}`,
            token,
          );
        } catch {
          // Some apps hide run detail — keep the list entry.
        }
        try {
          const jobData = await githubFetch<{
            jobs?: typeof jobs;
          }>(`${repoUrl}/check-runs/${c.id}/jobs`, token);
          jobs = jobData.jobs ?? [];
        } catch {
          // No jobs endpoint for this provider.
        }
        const failedSteps = jobs.flatMap((j) =>
          (j.steps ?? []).filter((s) => s.conclusion === "failure"),
        );
        const annotations =
          detail?.output?.annotations
            ?.slice(0, 20)
            .map((a) => ({
              path: a.path ?? "",
              title: a.title ?? "",
              message: a.message ?? "",
            })) ?? [];
        const outputText = [
          detail?.output?.title ?? "",
          detail?.output?.summary ?? "",
          detail?.output?.text ?? "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 12_000);
        return {
          name: c.name ?? c.app?.name ?? "check",
          app: c.app?.name ?? null,
          conclusion: c.conclusion ?? "failure",
          htmlUrl: c.html_url ?? null,
          detailsUrl: c.details_url ?? null,
          startedAt: c.started_at ?? null,
          completedAt: c.completed_at ?? null,
          outputText,
          annotations,
          failedSteps: failedSteps.map((s) => s.name ?? "step"),
          jobs: jobs.map((j) => ({
            name: j.name ?? "job",
            conclusion: j.conclusion ?? null,
            failedSteps: (j.steps ?? [])
              .filter((s) => s.conclusion === "failure")
              .map((s) => s.name ?? "step"),
          })),
        };
      }),
    );
    return { sha, branch: args.branch, failed: details };
  },
});

/**
 * Grounded CI-failure investigation. The evidence (failed check names, failed
 * steps, output snippets, annotations, recent commits) is passed in from what
 * the GitHub API actually returned — the model analyzes only that. It
 * proposes a fix; it never commits or pushes anything.
 */
export const aiInvestigateCiFailure = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    checkName: v.string(),
    failedSteps: v.array(v.string()),
    outputText: v.string(),
    annotations: v.array(
      v.object({ path: v.string(), title: v.string(), message: v.string() }),
    ),
    recentCommits: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    await assertAiRateLimit(ctx, userId);
    const usage = await ctx.runQuery(internal.aiUsage.usageForUser, { userId });
    if (usage.quota !== null && usage.used >= usage.quota) {
      throw new Error(
        "You've used all your AI requests for this month — upgrade your plan or wait for the next billing cycle.",
      );
    }
    if (!hasAnyAiProvider()) {
      throw new Error(
        "The AI assistant isn't set up yet — add OPENROUTER_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) to your project keys, then try again.",
      );
    }

    const systemPrompt = `You are Aria, an expert CI debugger. You reply with ONLY a JSON object — no markdown, no code fences — in exactly this shape:
{
  "summary": "2-3 plain sentences: what failed and why, based strictly on the evidence.",
  "probableCause": "One paragraph, plain language, strictly grounded in the evidence provided.",
  "affectedFiles": ["Paths most likely involved, only when the evidence supports them."],
  "proposedFix": "One paragraph describing the fix you would try, in order. Never invent test results."
}

Rules:
- Analyze ONLY the evidence below. If the evidence is thin (e.g. no log text, no annotations), say exactly that instead of guessing.
- Never claim a test passed or failed beyond what the evidence shows.
- Do not propose rewriting unrelated code. Keep the fix minimal and concrete.`;

    const userPrompt = [
      `Repository: ${args.owner}/${args.repo}`,
      `Branch: ${args.branch}`,
      `Failed check: ${args.checkName}`,
      args.failedSteps.length > 0
        ? `Failed step(s): ${args.failedSteps.join(", ")}`
        : "Failed step(s): (not reported by the provider)",
      `Recent commits on the branch (newest first):\n${
        args.recentCommits.join("\n") || "(none)"
      }`,
      args.outputText.trim()
        ? `Check output:\n${args.outputText.slice(0, 10_000)}`
        : "Check output: (no output text exposed by the provider)",
      args.annotations.length > 0
        ? `Annotations:\n${args.annotations
            .slice(0, 20)
            .map((a) => `${a.path}: ${a.title} — ${a.message}`)
            .join("\n")}`
        : "Annotations: (none)",
    ].join("\n\n");

    const acquired = await ctx.runMutation(internal.aiUsage.acquireAiInflight, {
      userId,
    });
    if (!acquired) {
      throw new Error(
        "An AI request is already running for your account — wait for it to finish, then try again.",
      );
    }
    const completion = await chatCompletion({
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    await ctx.runMutation(internal.aiUsage.releaseAiInflight, { userId });
    if (!completion.ok) {
      throw new Error(
        `The AI model replied with an error (${completion.error}). If no provider is configured, add OPENROUTER_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) to your project keys.`,
      );
    }
    const reply = completion.content;
    if (!reply.trim()) {
      throw new Error("The AI replied with nothing — try again or rephrase.");
    }
    const parsed = extractJson(reply) as {
      summary?: unknown;
      probableCause?: unknown;
      affectedFiles?: unknown;
      proposedFix?: unknown;
    } | null;
    if (!parsed || typeof parsed !== "object") {
      throw new Error(
        "The AI's response couldn't be understood — try again or rephrase.",
      );
    }

    await ctx.runMutation(internal.aiUsage.recordAiUse, { userId });
    await ctx.runMutation(internal.aiUsage.logAudit, {
      userId,
      action: "ai.ci-investigate",
      repo: `${args.owner}/${args.repo}`,
      detail: `${args.branch} · ${args.checkName}`,
    });

    return {
      summary:
        typeof parsed.summary === "string"
          ? parsed.summary.slice(0, 2000)
          : "",
      probableCause:
        typeof parsed.probableCause === "string"
          ? parsed.probableCause.slice(0, 4000)
          : "",
      affectedFiles: Array.isArray(parsed.affectedFiles)
        ? parsed.affectedFiles
            .filter((f): f is string => typeof f === "string")
            .slice(0, 15)
        : [],
      proposedFix:
        typeof parsed.proposedFix === "string"
          ? parsed.proposedFix.slice(0, 4000)
          : "",
    };
  },
});
