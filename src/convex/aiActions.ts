"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { anySecretRisk } from "../lib/secrets";
import { cleanMultiline, cleanPath } from "../lib/sanitize";
import { fetchWithRetry } from "./net";
import { captureEvent } from "./analytics";
import { chatCompletion, hasAnyAiProvider } from "./aiProvider";
import {
  AI_REQUESTS_PER_MINUTE,
  FEATURE_FLAGS,
} from "./security";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "aria";

const MAX_CONTEXT_FILES = 5;
const MAX_FILE_BYTES = 200_000;
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CONTEXT_CHARS = 80_000;
const MAX_LISTED_FILES = 300;
const MAX_CHANGES = 8;
const MAX_INSTRUCTION_CHARS = 2000;

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

interface GitHubFile {
  type: string;
  encoding: string;
  content: string;
  size: number;
}

function encodePath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function githubFetch<T>(url: string, token: string): Promise<T> {
  // Automatic retry (Part D): transient errors, 429s and 5xx retry with
  // backoff; 4xx passes through untouched.
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

async function getToken(ctx: ActionCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("You are not signed in.");
  }
  const connection = await ctx.runQuery(internal.github.connectionForUser, {
    userId,
  });
  if (connection === null) {
    throw new Error("GitHub is not connected.");
  }
  return connection.token;
}

/**
 * Per-user AI rate limit (Part D): bounds how many AI requests one user can
 * fire per minute, enforced at the action layer. Soft — a limiter hiccup
 * never blocks a call.
 */
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

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "make",
  "make", "want", "need", "please", "please", "can", "you", "your", "are",
  "would", "should", "could", "have", "has", "was", "were", "will", "just",
  "about", "there", "them", "they", "their", "what", "when", "where", "which",
  "while", "then", "than", "because", "been", "being", "each", "more", "most",
  "some", "such", "only", "own", "same", "too", "very", "also", "its", "it's",
]);

function significantWords(instruction: string): string[] {
  return instruction
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !w.includes("/"))
    .slice(0, 12);
}

/** Score how relevant a file path is to the instruction's keywords. */
function pathScore(path: string, words: string[]): number {
  if (words.length === 0) return 0;
  const lower = path.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (lower.includes(word)) score += 1;
    if (lower.endsWith(word)) score += 1;
  }
  return score;
}

/**
 * Pull additional context files from the repo: the open file first, then the
 * files whose paths best match the instruction's keywords (falling back to a
 * deterministic subset of small text files). Total context is capped so the
 * request stays small and cheap.
 */
async function selectContextFiles(
  repoUrl: string,
  token: string,
  branch: string,
  treeFiles: string[],
  instruction: string,
  openFile: { path: string; content: string } | undefined,
): Promise<Array<{ path: string; content: string }>> {
  const words = significantWords(instruction);
  const candidates = treeFiles
    .filter((p) => !(openFile && p === openFile.path))
    .map((path) => ({ path, score: pathScore(path, words) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const chosen: string[] = [];
  const seen = new Set<string>();
  if (openFile) {
    chosen.push(openFile.path);
    seen.add(openFile.path);
  }
  for (const c of candidates) {
    if (chosen.length >= MAX_CONTEXT_FILES) break;
    if (seen.has(c.path)) continue;
    chosen.push(c.path);
    seen.add(c.path);
  }

  const result: Array<{ path: string; content: string }> = [];
  let budget = MAX_TOTAL_CONTEXT_CHARS;
  if (openFile) {
    const content = openFile.content.slice(0, MAX_FILE_CHARS);
    budget -= content.length;
    result.push({ path: openFile.path, content });
  }
  for (const path of chosen) {
    if (path === openFile?.path) continue;
    if (budget <= 0) break;
    try {
      const file = await githubFetch<GitHubFile>(
        `${repoUrl}/contents/${encodePath(path)}?ref=${encodeURIComponent(
          branch,
        )}`,
        token,
      );
      if (file.type !== "file" || file.encoding !== "base64") continue;
      const content = Buffer.from(file.content, "base64")
        .toString("utf8")
        .slice(0, Math.min(MAX_FILE_CHARS, budget));
      if (!content.trim()) continue;
      budget -= content.length;
      result.push({ path, content });
    } catch {
      // A file that can't be read isn't worth retrying.
    }
  }
  return result;
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

export const aiSuggest = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    instruction: v.string(),
    openFile: v.optional(
      v.object({ path: v.string(), content: v.string() }),
    ),
    // Multi-turn: the previous exchanges in this conversation, newest last.
    history: v.optional(
      v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          content: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const instruction = cleanMultiline(args.instruction, MAX_INSTRUCTION_CHARS);
    if (!instruction) {
      throw new Error("Describe what you'd like Aria to change.");
    }
    // Keep the conversation bounded so long sessions stay cheap.
    const history = (args.history ?? []).slice(-8).map((h) => ({
      role: h.role,
      content: h.content.slice(0, 2000),
    }));
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    await assertAiRateLimit(ctx, userId);
    // Quota gate — enforced at the action layer, never by UI hiding alone.
    // When billing isn't configured the quota is null (app stays unlocked).
    const usage = await ctx.runQuery(internal.aiUsage.usageForUser, { userId });
    if (usage.quota !== null && usage.used >= usage.quota) {
      throw new Error(
        "You've used all your Ask Aria requests for this month — upgrade your plan or wait for the next billing cycle.",
      );
    }
    if (!hasAnyAiProvider()) {
      throw new Error(
        "The AI assistant isn't set up yet — add OPENROUTER_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) to your project keys, then try again.",
      );
    }
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    // 1. The repository's file list — the AI may only edit files that exist.
    const ref = await githubFetch<{ object: { sha: string } }>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
      token,
    );
    const tree = await githubFetch<{ tree: TreeEntry[] }>(
      `${repoUrl}/git/trees/${ref.object.sha}?recursive=1`,
      token,
    );
    const treeFiles = tree.tree
      .filter(
        (entry) =>
          entry.type === "blob" &&
          (entry.size ?? 0) > 0 &&
          (entry.size ?? 0) <= MAX_FILE_BYTES,
      )
      .map((entry) => entry.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_LISTED_FILES);

    // 2. Ground the model: the open file plus the most relevant repo files.
    const contextFiles = await selectContextFiles(
      repoUrl,
      token,
      args.branch,
      treeFiles,
      instruction,
      args.openFile,
    );

    // 3. The prompt — the model may only reference these files and must reply
    //    with a strict JSON shape we can validate.
    const fileList = treeFiles.join("\n") || "(empty repository)";
    const contextBlock = contextFiles.length
      ? contextFiles
          .map(
            (f) =>
              `--- file: ${f.path} ---\n${f.content}\n--- end of ${f.path} ---`,
          )
          .join("\n\n")
      : "(no file contents read — the repository has no readable text files)";
    const openFileHint = args.openFile
      ? `The file currently open in the editor is ${args.openFile.path} — treat it as the primary target unless the request says otherwise.`
      : "No file is open in the editor; you may need to find or create the relevant files.";

    const systemPrompt = `You are Aria, an expert software engineer embedded in a browser-based GitHub editor. You help one developer make precise, production-quality changes to their repository.

You are given: the full list of files in the repository, the contents of some relevant files, and a request. You must reply with ONLY a JSON object — no markdown, no code fences, no commentary — in exactly this shape:
{
  "explanation": "A short plain-English summary of what you changed and why (2-4 sentences, no markdown).",
  "changes": [
    { "path": "relative/path/to/file", "action": "update", "content": "the COMPLETE new file contents" },
    { "path": "brand/new/file.ts", "action": "create", "content": "the COMPLETE new file contents" }
  ]
}

Rules:
- "update" is ONLY for paths that appear in the provided file list. "create" is ONLY for genuinely new paths that do not appear in the list.
- The "content" for every change must be the ENTIRE file contents after your edit — never a diff, a snippet, or a placeholder.
- Make the smallest set of changes that fully satisfies the request. Never reformat unrelated code, never touch unrelated files.
- Never propose .env files, credentials, private keys, tokens, or anything secret-looking.
- If the request is ambiguous, choose the most sensible interpretation and say so in the explanation.
- If the request is impossible or would require destructive actions (deleting files, rewriting history), reply with an explanation and an empty changes array.

If the conversation history is not empty, this is a follow-up to earlier requests. You are continuing the same editing session: honor earlier context, build on (or fix) the changes you already proposed, and never repeat changes you already made unless the user asks you to change them again. The "changes" array must still contain the complete final contents of every file you touch in this turn.`;

    const userPrompt = `Repository: ${args.owner}/${args.repo} (branch: ${args.branch})
${openFileHint}

Files in the repository:
${fileList}

File contents read so far:
${contextBlock}

${history.length > 0 ? "Earlier in this conversation:\n" + history.map((h) => `${h.role === "user" ? "The developer asked" : "You replied"}: ${h.content}`).join("\n\n") + "\n\n" : ""}The developer's latest request:
${instruction}`;

    // 4. Call the model with the conversation history so follow-ups build on
    //    earlier turns instead of starting from scratch.
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
        ...history.map((h) => ({ role: h.role, content: h.content })),
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
      explanation?: unknown;
      changes?: unknown;
    } | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.changes)
    ) {
      throw new Error(
        "The AI's response couldn't be understood — try again or rephrase your request.",
      );
    }

    // 5. Validate every proposed change against the real repository.
    const existing = new Set(treeFiles);
    const changes: Array<{
      path: string;
      action: "update" | "create";
      content: string;
      originalContent: string;
    }> = [];
    let secretDropped = 0;
    for (const raw of parsed.changes.slice(0, MAX_CHANGES)) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as { path?: unknown; action?: unknown; content?: unknown };
      let path = typeof entry.path === "string" ? cleanPath(entry.path) : "";
      if (!path) continue;
      const action = entry.action === "create" ? "create" : "update";
      if (action === "update" && !existing.has(path)) continue;
      const content = typeof entry.content === "string" ? entry.content : "";
      if (!content.trim() || content.length > 1_000_000) continue;
      // The trust layer (Part D): the same secret scan that guards commits
      // runs here, BEFORE the proposal is shown to the user. Anything that
      // trips it is dropped and counted so the user knows why.
      const risk = anySecretRisk([{ path, content }]);
      if (risk.risky) {
        secretDropped += 1;
        continue;
      }
      changes.push({
        path,
        action,
        content,
        originalContent: "",
      });
    }
    let explanation =
      typeof parsed.explanation === "string"
        ? parsed.explanation.slice(0, 2000)
        : "";
    if (secretDropped > 0) {
      explanation = `${explanation.trim()}\n\n${secretDropped} proposed change${secretDropped > 1 ? "s" : ""} ${secretDropped > 1 ? "were" : "was"} withheld because ${secretDropped > 1 ? "they look" : "it looks"} like ${secretDropped > 1 ? "they contain" : "it contains"} secrets — review the file paths before committing.`.trim();
    }

    // 6. For updates, fetch the current contents so the client can render a
    //    real before/after diff before the user stages anything.
    for (const change of changes) {
      if (change.action !== "update") continue;
      try {
        const file = await githubFetch<GitHubFile>(
          `${repoUrl}/contents/${encodePath(change.path)}?ref=${encodeURIComponent(
            args.branch,
          )}`,
          token,
        );
        if (file.type === "file" && file.encoding === "base64") {
          change.originalContent = Buffer.from(file.content, "base64")
            .toString("utf8")
            .slice(0, 1_000_000);
        }
      } catch {
        // Can't read it — the diff will just show the proposed content.
      }
    }

    if (changes.length === 0) {
      throw new Error(
        "The AI proposed no usable changes — try rephrasing with more specifics, or check that the request is achievable in this repository.",
      );
    }

    // Metering: count this successful call toward the plan's monthly quota,
    // and leave an audit trail (Team/Enterprise) for who asked what, when.
    if (userId !== null) {
      await ctx.runMutation(internal.aiUsage.recordAiUse, { userId });
      await captureEvent(ctx, "ai.ask", userId, {
        repo: `${args.owner}/${args.repo}`,
        branch: args.branch ?? null,
      });
      await ctx.runMutation(internal.aiUsage.logAudit, {
        userId,
        action: "ai.ask",
        repo: `${args.owner}/${args.repo}`,
        detail: instruction.slice(0, 300),
      });
    }

    return {
      explanation,
      changes,
      secretDropped,
    };
  },
});

interface CompareFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/**
 * AI review pass (Pro+): diffs the branch against a base and returns a
 * grounded review with risk flags plus a ready-to-use PR title/description.
 * Never auto-applied — the developer decides. Metered against the plan's
 * monthly quota like every other Ask Aria call.
 */
export const aiReviewBranch = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    base: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    await assertAiRateLimit(ctx, userId);
    // Pro+ gate — enforced at the action layer, never by UI hiding. Skipped in
    // dev mode (no Stripe keys) so the app stays fully unlocked until then.
    if (process.env.STRIPE_SECRET_KEY) {
      const billing = await ctx.runQuery(internal.billing.planForUser, {
        userId,
      });
      if (billing.plan === "free" || billing.plan === "pro") {
        throw new Error(
          "AI review is a Pro+ feature — upgrade to review branches before you push.",
        );
      }
    }
    // Same monthly quota metering as Ask Aria.
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
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    // The diff to review: branch vs. base (cap size so the request stays cheap).
    const compare = await githubFetch<{
      ahead_by: number;
      files: CompareFile[];
    }>(
      `${repoUrl}/compare/${encodeURIComponent(
        args.base,
      )}...${encodeURIComponent(args.branch)}`,
      token,
    );
    let diffChars = 0;
    const diffBlock: string[] = [];
    for (const file of compare.files.slice(0, 40)) {
      if (diffChars > 120_000) break;
      const patch = file.patch ?? "(binary or too large to diff — see raw file)";
      const chunk = patch.slice(0, Math.max(0, 120_000 - diffChars));
      diffChars += chunk.length;
      diffBlock.push(
        `--- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions}) ---\n${chunk}`,
      );
    }
    const diffText = diffBlock.join("\n\n") || "(no file changes found)";
    const changedFiles = compare.files.map((f) => f.filename);
    const addedLines = compare.files.reduce((n, f) => n + f.additions, 0);
    const deletedLines = compare.files.reduce((n, f) => n + f.deletions, 0);

    const systemPrompt = `You are Aria, an expert senior engineer reviewing a pull request for a solo developer. You reply with ONLY a JSON object — no markdown, no code fences — in exactly this shape:
{
  "review": "2-5 plain sentences assessing correctness, style, and whether this is safe to merge. No markdown.",
  "risks": ["One line per real risk — e.g. large deletions, config/auth changes, secrets, no tests touched, breaking API changes. Empty array if none."],
  "prTitle": "A concise conventional commit-style title, max 72 chars.",
  "prBody": "A short markdown PR description: what changed, why, and a Risks section listing the flags."
}

Rules:
- Review ONLY what is in the diff. Do not invent issues outside the changes.
- Flag, in order of importance: deleted lines or files that look destructive, changes to auth/config/.env-adjacent files, anything secret-looking, and missing tests when tests would matter.
- Be honest and specific. If the branch is clean, say so and keep risks minimal.`;

    const userPrompt = `Repository: ${args.owner}/${args.repo}\nBase: ${args.base} → Branch: ${args.branch} (${compare.ahead_by} commits ahead, +${addedLines}/-${deletedLines} across ${changedFiles.length} files)\n\nChanged files:\n${changedFiles.join("\n") || "(none)"}\n\nDiff:\n${diffText}`;

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
      review?: unknown;
      risks?: unknown;
      prTitle?: unknown;
      prBody?: unknown;
    } | null;
    if (!parsed || typeof parsed !== "object") {
      throw new Error(
        "The AI's response couldn't be understood — try again or rephrase.",
      );
    }

    // Metering + audit: this counts against the plan's monthly quota.
    await ctx.runMutation(internal.aiUsage.recordAiUse, { userId });
    await captureEvent(ctx, "ai.review", userId, {
      repo: `${args.owner}/${args.repo}`,
      branch: args.branch,
      base: args.base,
    });
    await ctx.runMutation(internal.aiUsage.logAudit, {
      userId,
      action: "ai.review",
      repo: `${args.owner}/${args.repo}`,
      detail: `${args.branch} vs ${args.base}`,
    });

    return {
      review:
        typeof parsed.review === "string" ? parsed.review.slice(0, 2000) : "",
      risks: Array.isArray(parsed.risks)
        ? parsed.risks.filter((r): r is string => typeof r === "string").slice(0, 10)
        : [],
      prTitle:
        typeof parsed.prTitle === "string"
          ? parsed.prTitle.slice(0, 100)
          : "",
      prBody:
        typeof parsed.prBody === "string" ? parsed.prBody.slice(0, 4000) : "",
      stats: {
        aheadBy: compare.ahead_by,
        files: changedFiles.length,
        addedLines,
        deletedLines,
      },
    };
  },
});

/**
 * AI commit message generator (Ask Aria pool): turns the staged changes into
 * a conventional-commit message. Metered against the plan's monthly quota
 * like every other AI call. Proposes only — the developer edits/commits.
 */
export const aiCommitMessage = action({
  args: {
    repo: v.optional(v.string()),
    changes: v.array(
      v.object({
        path: v.string(),
        action: v.union(v.literal("update"), v.literal("create")),
        originalContent: v.optional(v.string()),
        content: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.changes.length === 0) {
      throw new Error("Stage some changes first — there's nothing to describe yet.");
    }
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    await assertAiRateLimit(ctx, userId);
    // Same monthly quota gate as Ask Aria (enforced at the action layer).
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

    // Compact per-file summary: rough +/- from line counts plus a short
    // excerpt of the new content — keeps the request tiny and effective.
    const files = args.changes.slice(0, 8).map((c) => {
      const oldLines = (c.originalContent ?? "")
        .split("\n")
        .filter((l) => l.trim()).length;
      const newLines = c.content.split("\n").filter((l) => l.trim()).length;
      return {
        path: c.path,
        action: c.action,
        plus: Math.max(0, newLines),
        minus: Math.max(0, oldLines),
        excerpt: c.content.replace(/\s+/g, " ").trim().slice(0, 200),
      };
    });
    const summary = files
      .map(
        (f) =>
          `${f.action} ${f.path} (+${f.plus}/-${f.minus})\n  ${f.excerpt}`,
      )
      .join("\n");

    const systemPrompt = `You are Aria, writing a git commit message for a solo developer. Reply with ONLY a JSON object — no markdown, no code fences — in exactly this shape:
{
  "message": "<the commit message>"
}

Rules:
- Use Conventional Commits: a one-line subject (max 72 chars) prefixed with type (feat, fix, refactor, chore, docs, test, style, perf), followed by an optional blank line and a short body (max 6 lines) explaining what and why.
- Base it ONLY on the staged changes provided. Never invent files or work.
- If multiple changes are unrelated, pick the dominant type and summarize.
- Never mention AI or that this was generated.`;

    const userPrompt = `Repository: ${args.repo ?? "this repository"}\n\nStaged changes:\n${summary}`;

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
    const parsed = extractJson(reply) as { message?: unknown } | null;
    const message =
      parsed && typeof parsed.message === "string"
        ? parsed.message.trim().slice(0, 2000)
        : "";
    if (!message) {
      throw new Error(
        "The AI's response couldn't be understood — try again or rephrase.",
      );
    }

    await ctx.runMutation(internal.aiUsage.recordAiUse, { userId });
    await captureEvent(ctx, "ai.commit_message", userId, {
      repo: args.repo ?? null,
      files: args.changes.length,
    });
    await ctx.runMutation(internal.aiUsage.logAudit, {
      userId,
      action: "ai.commit_message",
      repo: args.repo ?? undefined,
      detail: `${args.changes.length} file(s)`,
    });

    return { message };
  },
});

/**
 * AI conflict-resolution proposal (Ask Aria pool): given the three sides of a
 * single conflicted hunk, propose a merged resolution plus the rationale.
 * Proposes only — the developer reviews and applies it. Metered against the
 * plan's monthly quota like every other AI call.
 */
export const aiResolveConflict = action({
  args: {
    path: v.string(),
    base: v.string(),
    ours: v.string(),
    theirs: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    await assertAiRateLimit(ctx, userId);
    // Same monthly quota gate as Ask Aria (enforced at the action layer).
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

    const cap = (s: string, n: number) =>
      s.split("\n").slice(0, n).join("\n");
    const base = cap(args.base, 250);
    const ours = cap(args.ours, 250);
    const theirs = cap(args.theirs, 250);

    const systemPrompt = `You are Aria, an expert engineer resolving a git merge conflict for a developer. You reply with ONLY a JSON object — no markdown, no code fences — in exactly this shape:
{
  "resolution": "The complete resolved lines for this conflict — exactly what should replace the conflicted region. Preserve indentation. If one side is clearly right, pick it; if both sides matter, combine them.",
  "rationale": "2-4 plain sentences explaining why this resolution is correct, referencing what each side was doing. No markdown."
}

Rules:
- NEVER auto-apply: you only propose. The developer reviews first.
- Never include conflict markers (<<<<<<<, =======, >>>>>>>) in the resolution.
- If the conflict cannot be resolved safely (e.g. both sides delete different critical logic), say so in the rationale and return the ours side as a safe default.
- Match the surrounding style and indentation. Output raw lines only — no language annotations.`;

    const userPrompt = `Conflicted file: ${args.path}

--- BASE (before either change) ---
${base || "(empty)"}

--- OURS (the current branch) ---
${ours || "(empty)"}

--- THEIRS (the incoming branch) ---
${theirs || "(empty)"}`;

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
      resolution?: unknown;
      rationale?: unknown;
    } | null;
    const resolution =
      parsed && typeof parsed.resolution === "string"
        ? parsed.resolution.trim()
        : "";
    const rationale =
      parsed && typeof parsed.rationale === "string"
        ? parsed.rationale.trim().slice(0, 1200)
        : "";
    if (!resolution) {
      throw new Error(
        "The AI's response couldn't be understood — try again or rephrase.",
      );
    }
    // The trust layer (Part D): the AI resolution is code the user will
    // apply — the same secret scan that guards commits runs here, before it
    // is shown.
    const resolutionPath = cleanPath(args.path) || args.path;
    const risk = anySecretRisk([{ path: resolutionPath, content: resolution }]);
    if (risk.risky) {
      throw new Error(
        "Aria withheld the AI resolution — it looks like it contains secrets. Resolve this conflict manually.",
      );
    }

    await ctx.runMutation(internal.aiUsage.recordAiUse, { userId });
    await captureEvent(ctx, "ai.conflict", userId, {
      path: args.path.slice(0, 200),
    });
    await ctx.runMutation(internal.aiUsage.logAudit, {
      userId,
      action: "ai.conflict",
      detail: args.path.slice(0, 300),
    });

    return { resolution, rationale };
  },
});

/**
 * "Why did this change?" — the grounded file-history explainer. Given a file
 * (and optionally a line), this gathers the real commit history for that path
 * plus the pull requests that touched it, and asks the model to explain the
 * change in plain language using ONLY that material. If nothing in the record
 * explains it, the model says so plainly instead of guessing. Metered against
 * the plan's monthly quota like every other AI call.
 */
export const aiWhyChanged = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    path: v.string(),
    branch: v.string(),
    line: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    await assertAiRateLimit(ctx, userId);
    // Same monthly quota gate as Ask Aria (enforced at the action layer).
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
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const repo = `${args.owner}/${args.repo}`;

    // Grounding material #1: the actual commit history of this path.
    const commits = await githubFetch<
      Array<{
        sha: string;
        html_url: string;
        commit: { message: string; author: { date: string | null } };
      }>
    >(
      `${repoUrl}/commits?sha=${encodeURIComponent(
        args.branch,
      )}&path=${encodeURIComponent(args.path)}&per_page=8`,
      token,
    );

    // Grounding material #2: pull requests that touched this file.
    let prs: Array<{
      number: number;
      title: string;
      html_url: string;
      body: string | null;
    }> = [];
    try {
      const search = await githubFetch<{
        items: Array<{
          number: number;
          title: string;
          html_url: string;
          body: string | null;
        }>;
      }>(
        `${GITHUB_API}/search/issues?q=${encodeURIComponent(
          `repo:${repo} type:pr path:${args.path}`,
        )}&per_page=5`,
        token,
      );
      prs = search.items ?? [];
    } catch {
      // Search is rate-limited separately — fall back to commit history only.
    }

    const commitBlock = commits
      .map((c) => {
        const date = c.commit.author.date ? new Date(c.commit.author.date).toISOString().slice(0, 10) : "?";
        return `- ${c.sha.slice(0, 7)} (${date}) ${c.commit.message.split("\n")[0]}`;
      })
      .join("\n") || "(no commits found for this path)";
    const prBlock = prs
      .map((p) => `- PR #${p.number} "${p.title}"${p.body ? `\n  ${p.body.replace(/\s+/g, " ").trim().slice(0, 300)}` : ""}`)
      .join("\n") || "(no pull requests found for this path)";

    const systemPrompt = `You are Aria, explaining why a line of code or file changed, for a developer. You reply with ONLY a JSON object — no markdown, no code fences — in exactly this shape:
{
  "explanation": "2-6 plain sentences, in the developer's voice, explaining WHY this changed: what problem it solved or what the intent was. Base it ONLY on the commit messages and PR text provided. If the record doesn't explain the change (e.g. only an initial commit or unrelated bulk commit), say that plainly — never invent a reason, never guess."
}

Rules:
- Ground every claim in the provided material. If a commit or PR explicitly mentions a bug, feature, or refactor, reference it.
- Do not speculate about motives beyond the text.
- Mention the specific commits/PRs that matter most (by short SHA or #number).`;

    const userPrompt = `Repository: ${repo}\nFile: ${args.path}${args.line ? ` (line ${args.line})` : ""}\nBranch: ${args.branch}\n\n--- COMMIT HISTORY FOR THIS FILE ---\n${commitBlock}\n\n--- PULL REQUESTS TOUCHING THIS FILE ---\n${prBlock}`;

    const acquired = await ctx.runMutation(internal.aiUsage.acquireAiInflight, {
      userId,
    });
    if (!acquired) {
      throw new Error(
        "An AI request is already running for your account — wait for it to finish, then try again.",
      );
    }
    const completion = await chatCompletion({
      temperature: 0.1,
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
    const parsed = extractJson(reply) as { explanation?: unknown } | null;
    const explanation =
      parsed && typeof parsed.explanation === "string"
        ? parsed.explanation.trim().slice(0, 2000)
        : "";
    if (!explanation) {
      throw new Error(
        "The AI's response couldn't be understood — try again or rephrase.",
      );
    }

    await ctx.runMutation(internal.aiUsage.recordAiUse, { userId });
    await captureEvent(ctx, "ai.why_changed", userId, {
      repo,
      path: args.path.slice(0, 200),
    });
    await ctx.runMutation(internal.aiUsage.logAudit, {
      userId,
      action: "ai.why_changed",
      repo,
      detail: args.path.slice(0, 300),
    });

    return {
      explanation,
      // Grounded source list straight from GitHub (not AI-generated).
      commits: commits.map((c) => ({
        sha: c.sha,
        message: c.commit.message.split("\n")[0].slice(0, 200),
        htmlUrl: c.html_url,
      })),
      prs: prs.map((p) => ({
        number: p.number,
        title: p.title.slice(0, 200),
        htmlUrl: p.html_url,
      })),
    };
  },
});

/**
 * Cross-repo AI edits (Team/Enterprise): describe one change in plain
 * English; Aria proposes concrete edits for each affected repo, all shown
 * together on one review screen. Proposals are never auto-committed — the
 * user reviews and approves each repo's changes before anything is pushed.
 * Gated server-side to Team/Enterprise when billing is configured, and
 * metered against the plan's AI quota like every other AI call.
 */
export const aiPlanCrossRepo = action({
  args: {
    instruction: v.string(),
    repos: v.array(
      v.object({
        owner: v.string(),
        repo: v.string(),
        branch: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    await assertAiRateLimit(ctx, userId);

    // Kill switch (Part D): an admin can disable cross-repo edits instantly
    // without a redeploy. Server-side enforcement, immediate effect.
    const crossRepoEnabled = await ctx.runQuery(internal.security.featureFlag, {
      key: FEATURE_FLAGS.CROSS_REPO_EDITS,
    });
    if (!crossRepoEnabled) {
      throw new Error(
        "Cross-repo AI edits are temporarily disabled — check back in a bit.",
      );
    }

    // Team gate (server-side, never UI-hidden). Billing being unconfigured
    // (no Stripe keys yet) keeps development fully unlocked, mirroring the
    // rest of the app.
    const configured = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
    if (configured) {
      const billing = await ctx.runQuery(internal.billing.planForUser, { userId });
      const plan = billing?.plan ?? "free";
      if (plan !== "team" && plan !== "enterprise") {
        throw new Error(
          "Cross-repo AI edits are a Team feature — upgrade to plan changes across multiple repositories.",
        );
      }
    }

    // Same monthly quota gate as Ask Aria (enforced at the action layer).
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
    const token = await getToken(ctx);

    const instruction = cleanMultiline(args.instruction, MAX_INSTRUCTION_CHARS);
    if (!instruction) throw new Error("Describe the change you want first.");
    const targets = args.repos.slice(0, 4);
    if (targets.length === 0) throw new Error("Pick at least one repository.");

    const words = significantWords(instruction);
    const results: Array<{
      owner: string;
      repo: string;
      branch: string;
      summary: string;
      changes: Array<{
        path: string;
        action: "update" | "create" | "delete";
        content: string;
        reason: string;
      }>;
      error?: string;
    }> = [];

    for (const target of targets) {
      const repoFull = `${target.owner}/${target.repo}`;
      const repoUrl = `${GITHUB_API}/repos/${target.owner}/${target.repo}`;
      try {
        // File list via the git tree (recursive, blob entries only).
        const ref = await githubFetch<{ object: { sha: string } }>(
          `${repoUrl}/git/ref/heads/${encodeURIComponent(target.branch)}`,
          token,
        );
        const tree = await githubFetch<{
          tree: Array<{ path: string; type: string; size?: number }>;
        }>(`${repoUrl}/git/trees/${ref.object.sha}?recursive=1`, token);
        const files = (tree.tree ?? [])
          .filter((e) => e.type === "blob")
          .map((e) => ({ path: e.path, size: e.size ?? 0 }))
          .filter((f) => f.size < MAX_FILE_BYTES)
          .sort((a, b) => a.path.localeCompare(b.path));

        // Pick the files most relevant to the instruction (keyword scoring,
        // same heuristic as Ask Aria) and read them.
        const scored = files
          .map((f) => ({ ...f, score: pathScore(f.path, words) }))
          .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
        const picked = scored.slice(0, MAX_CONTEXT_FILES);
        const context: Array<{ path: string; content: string }> = [];
        let budget = MAX_TOTAL_CONTEXT_CHARS;
        for (const f of picked) {
          if (budget <= 0) break;
          try {
            const file = await githubFetch<GitHubFile>(
              `${repoUrl}/contents/${encodePath(f.path)}?ref=${encodeURIComponent(
                target.branch,
              )}`,
              token,
            );
            if (file.type !== "file" || file.encoding !== "base64") continue;
            const content = Buffer.from(file.content, "base64")
              .toString("utf8")
              .slice(0, Math.min(MAX_FILE_CHARS, budget));
            if (!content.trim()) continue;
            budget -= content.length;
            context.push({ path: f.path, content });
          } catch {
            // unreadable file — skip
          }
        }

        const filesBlock = context
          .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 12000)}`)
          .join("\n\n");

        const systemPrompt = `You are Aria, planning an engineering change across a repository for a developer. You reply with ONLY a JSON object — no markdown, no code fences — in exactly this shape:
{
  "summary": "2-4 plain sentences: what will change in THIS repository and why, for a non-technical reviewer.",
  "changes": [
    {
      "path": "full file path",
      "action": "update" | "create" | "delete",
      "content": "the COMPLETE new file content for update/create (omit for delete)",
      "reason": "one sentence: what this edit does and why"
    }
  ]
}

Rules:
- Base edits ONLY on the provided instruction and file contents. Never invent files that don't exist in the tree listing unless the change clearly requires a new file.
- Prefer the smallest set of edits that accomplishes the change. Only include files the change actually touches.
- Preserve existing code exactly except where the change requires editing it.
- For "update", output the COMPLETE file, not a diff or fragment.
- Never mention AI or that this was generated.
- If the instruction does not apply to this repository, return {"summary": "This change doesn't apply to this repository.", "changes": []}.`;

        const userPrompt = `Requested change: ${instruction}\n\nRepository: ${repoFull} (branch ${target.branch})\n\nRelevant files:\n${filesBlock || "(no readable text files)"}`;

        const completion = await chatCompletion({
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });
        if (!completion.ok) {
          results.push({
            ...target,
            summary: "",
            changes: [],
            error: completion.error.slice(0, 200),
          });
          continue;
        }

        const reply = completion.content;
        const parsed = extractJson(reply) as {
          summary?: unknown;
          changes?: unknown;
        } | null;
        const summary =
          parsed && typeof parsed.summary === "string"
            ? parsed.summary.trim().slice(0, 1200)
            : "";
        const rawChanges = Array.isArray(parsed?.changes) ? parsed.changes : [];
        const changes = rawChanges
          .filter(
            (c): c is Record<string, unknown> =>
              typeof c === "object" && c !== null,
          )
          .map((c) => {
            const action: "update" | "create" | "delete" =
              c.action === "create" || c.action === "delete" ? c.action : "update";
            return {
              path: typeof c.path === "string" ? c.path.slice(0, 300) : "",
              action,
              content:
                typeof c.content === "string" ? c.content.slice(0, 200_000) : "",
              reason:
                typeof c.reason === "string" ? c.reason.slice(0, 300) : "",
            };
          })
          .filter((c) => c.path && !(c.action === "delete" && !c.reason));
        // The trust layer (Part D): scan every proposed change with the same
        // secret scanner that guards commits, before it reaches the review
        // screen. Risky changes are dropped and counted.
        let secretDropped = 0;
        const safeChanges = changes
          .map((c) => {
            const path = cleanPath(c.path);
            if (!path) return null;
            const risk =
              c.action === "delete"
                ? null
                : anySecretRisk([{ path, content: c.content }]);
            if (risk?.risky) {
              secretDropped += 1;
              return null;
            }
            return { ...c, path };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
        results.push({
          ...target,
          summary:
            secretDropped > 0
              ? `${summary}\n\n${secretDropped} proposed change${secretDropped > 1 ? "s" : ""} ${secretDropped > 1 ? "were" : "was"} withheld because ${secretDropped > 1 ? "they look" : "it looks"} like ${secretDropped > 1 ? "they contain" : "it contains"} secrets.`.trim()
              : summary,
          changes: safeChanges.slice(0, 12),
        });
      } catch (e) {
        results.push({
          ...target,
          summary: "",
          changes: [],
          error:
            e instanceof Error
              ? e.message.slice(0, 200)
              : "Couldn't read this repository.",
        });
      }
    }

    const withChanges = results.filter((r) => r.changes.length > 0).length;
    await ctx.runMutation(internal.aiUsage.recordAiUse, { userId });
    await captureEvent(ctx, "ai.cross_repo", userId, {
      repos: targets.length,
      withChanges,
    });
    await ctx.runMutation(internal.aiUsage.logAudit, {
      userId,
      action: "ai.cross_repo",
      detail: `${targets.length} repo(s) · ${withChanges} with proposed edits`,
    });

    return { repos: results };
  },
});

/**
 * Semantic repo Q&A — "Ask about this repo."
 *
 * Unlike aiSuggest (which proposes edits), this is a read-only question
 * answer mode: it retrieves the repository's file list, scores and reads the
 * files most relevant to the question, and grounds the model's answer in
 * those files with clickable file references. The model may NOT propose
 * changes — it explains how the repo works, where things live, and how they
 * fit together. Metered against the plan's monthly quota like every other
 * Ask Aria call.
 */
export const aiAskRepo = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    question: v.string(),
  },
  handler: async (ctx, args) => {
    const question = cleanMultiline(args.question, MAX_INSTRUCTION_CHARS);
    if (!question) {
      throw new Error("Ask a question about the repository first.");
    }
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    await assertAiRateLimit(ctx, userId);
    // Same monthly quota gate as Ask Aria (enforced at the action layer).
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
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    // 1. The repository's file list.
    const ref = await githubFetch<{ object: { sha: string } }>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
      token,
    );
    const tree = await githubFetch<{ tree: TreeEntry[] }>(
      `${repoUrl}/git/trees/${ref.object.sha}?recursive=1`,
      token,
    );
    const treeFiles = tree.tree
      .filter(
        (entry) =>
          entry.type === "blob" &&
          (entry.size ?? 0) > 0 &&
          (entry.size ?? 0) <= MAX_FILE_BYTES,
      )
      .map((entry) => entry.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_LISTED_FILES);

    // 2. Score + read the files most relevant to the question.
    const contextFiles = await selectContextFiles(
      repoUrl,
      token,
      args.branch,
      treeFiles,
      question,
      undefined,
    );
    const contextBlock = contextFiles.length
      ? contextFiles
          .map(
            (f) =>
              `--- file: ${f.path} ---\n${f.content}\n--- end of ${f.path} ---`,
          )
          .join("\n\n")
      : "(no readable file contents)";

    const systemPrompt = `You are Aria, an expert engineer who knows this repository inside out. A developer asked a question about how the code works. You reply with ONLY a JSON object — no markdown, no code fences — in exactly this shape:
{
  "answer": "A direct plain-English answer (3-8 sentences). Reference the specific files that matter by their exact path, in backticks, e.g. \`src/lib/auth.ts\`. If the material provided doesn't answer the question, say so plainly and point at the files that would.",
  "files": ["every file path you referenced in the answer, exactly as written in the file list"]
}

Rules:
- Ground EVERY claim in the provided file contents. Never guess about files you weren't given.
- Do not propose changes, diffs, or edits. This is a question-answer mode — explain, don't modify.
- Keep the answer tight and specific: where the logic lives, how the pieces fit, what each referenced file does.
- The "files" array must only contain paths from the provided file list.`;

    const userPrompt = `Repository: ${args.owner}/${args.repo} (branch: ${args.branch})\n\nFiles in the repository:\n${treeFiles.join("\n") || "(empty repository)"}\n\nFile contents read so far:\n${contextBlock}\n\nQuestion:\n${question}`;

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
      answer?: unknown;
      files?: unknown;
    } | null;
    if (!parsed || typeof parsed !== "object") {
      throw new Error(
        "The AI's response couldn't be understood — try again or rephrase.",
      );
    }
    const answer =
      typeof parsed.answer === "string"
        ? parsed.answer.trim().slice(0, 4000)
        : "";
    if (!answer) {
      throw new Error(
        "The AI's response couldn't be understood — try again or rephrase.",
      );
    }
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter(
          (f): f is string =>
            typeof f === "string" && treeFiles.includes(f),
        )
      : [];

    await ctx.runMutation(internal.aiUsage.recordAiUse, { userId });
    await captureEvent(ctx, "ai.ask_repo", userId, {
      repo: `${args.owner}/${args.repo}`,
      branch: args.branch,
    });
    await ctx.runMutation(internal.aiUsage.logAudit, {
      userId,
      action: "ai.ask_repo",
      repo: `${args.owner}/${args.repo}`,
      detail: question.slice(0, 300),
    });

    return { answer, files };
  },
});
