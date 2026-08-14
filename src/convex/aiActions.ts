"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { anySecretRisk } from "../lib/secrets";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "aria";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

// Pay-per-token by default; swap via OPENROUTER_MODEL (e.g. a paid model once
// subscribers fund it). The ":free" suffix is OpenRouter's free tier.
// Note: free-model availability changes — if this model stops working, set
// OPENROUTER_MODEL in project keys to a current :free model from
// https://openrouter.ai/models (filter by ":free").
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

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
  const res = await fetch(url, {
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
    const instruction = args.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS);
    if (!instruction) {
      throw new Error("Describe what you'd like Aria to change.");
    }
    // Keep the conversation bounded so long sessions stay cheap.
    const history = (args.history ?? []).slice(-8).map((h) => ({
      role: h.role,
      content: h.content.slice(0, 2000),
    }));
    const userId = await getAuthUserId(ctx);
    // Quota gate — enforced at the action layer, never by UI hiding alone.
    // When billing isn't configured the quota is null (app stays unlocked).
    if (userId !== null) {
      const usage = await ctx.runQuery(internal.aiUsage.usageForUser, { userId });
      if (usage.quota !== null && usage.used >= usage.quota) {
        throw new Error(
          "You've used all your Ask Aria requests for this month — upgrade your plan or wait for the next billing cycle.",
        );
      }
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "The AI assistant isn't set up yet — add OPENROUTER_API_KEY to your project keys, then try again.",
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
    const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
    let data: {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    try {
      const res = await fetch(OPENROUTER_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Aria",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            ...history.map((h) => ({ role: h.role, content: h.content })),
            { role: "user", content: userPrompt },
          ],
        }),
      });
      data = (await res.json()) as typeof data;
      if (!res.ok) {
        const detail = data?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(
          `The AI model replied with an error (${detail}). If the model isn't available, set OPENROUTER_MODEL in your project keys to a current free model.`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("The AI model replied")) {
        throw e;
      }
      throw new Error(
        "Couldn't reach the AI provider — check your network and try again.",
      );
    }

    const reply = data?.choices?.[0]?.message?.content ?? "";
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
    for (const raw of parsed.changes.slice(0, MAX_CHANGES)) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as { path?: unknown; action?: unknown; content?: unknown };
      let path = typeof entry.path === "string" ? entry.path.trim() : "";
      if (path.startsWith("/")) path = path.slice(1);
      if (!path || path.includes("..") || path.includes("\\")) continue;
      const action = entry.action === "create" ? "create" : "update";
      if (action === "update" && !existing.has(path)) continue;
      const content = typeof entry.content === "string" ? entry.content : "";
      if (!content.trim() || content.length > 1_000_000) continue;
      // The trust layer: never let the AI smuggle secrets into a proposal.
      const risk = anySecretRisk([{ path, content }]);
      if (risk.risky) continue;
      changes.push({
        path,
        action,
        content,
        originalContent: "",
      });
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
      await ctx.runMutation(internal.aiUsage.logAudit, {
        userId,
        action: "ai.ask",
        repo: `${args.owner}/${args.repo}`,
        detail: instruction.slice(0, 300),
      });
    }

    return {
      explanation:
        typeof parsed.explanation === "string"
          ? parsed.explanation.slice(0, 2000)
          : "",
      changes,
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
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "The AI assistant isn't set up yet — add OPENROUTER_API_KEY to your project keys, then try again.",
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

    const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
    let data: {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    try {
      const res = await fetch(OPENROUTER_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Aria",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      data = (await res.json()) as typeof data;
      if (!res.ok) {
        const detail = data?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(
          `The AI model replied with an error (${detail}). If the model isn't available, set OPENROUTER_MODEL in your project keys to a current free model.`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("The AI model replied")) {
        throw e;
      }
      throw new Error(
        "Couldn't reach the AI provider — check your network and try again.",
      );
    }

    const reply = data?.choices?.[0]?.message?.content ?? "";
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
