import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { secretRisk } from "../lib/secrets";
import { cleanName, cleanPath, cleanText } from "../lib/sanitize";
import {
  PERMISSION_LEVELS,
  ruleMatchesFile,
  type PermissionLevel,
} from "../lib/phase3";

/**
 * Phase 3 — Security Command Center (default runtime half).
 *
 * Everything that stores, reads, or enforces lives here (queries/mutations);
 * the network-heavy scans (GitHub contents, npm registry, OSV advisories) run
 * in the "use node" sibling securityScanner.ts so Buffer decoding is safe.
 *
 * Ownership model: rules, memory, findings, health, and missions are all
 * scoped to (userId, repo) — a user only ever sees their own connected repos,
 * and write paths verify the repo is in `connectedRepos` server-side (never
 * UI hiding alone). Secrets are never stored: evidence records are pattern
 * labels + paths, not values.
 */

// ---------------------------------------------------------------------------
// Shared auth / access helpers (imported by the scanner half too)
// ---------------------------------------------------------------------------

export async function currentUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("You are not signed in.");
  return userId;
}

/** "owner/name" from the two action args. */
export function repoFull(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

/**
 * A repo is accessible to a user only when they have opened it in Aria
 * (connectedRepos row). Server-side gate for every Phase 3 write path.
 */
export async function requireRepoAccess(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  repo: string,
): Promise<void> {
  const row = await ctx.db
    .query("connectedRepos")
    .withIndex("by_userRepo", (q) =>
      q.eq("userId", userId as never).eq("repo", repo),
    )
    .unique();
  if (row === null) {
    throw new Error("This repository isn't connected to your Aria account.");
  }
}

// ---------------------------------------------------------------------------
// Project constitution (rules)
// ---------------------------------------------------------------------------

/** List the signed-in user's rules (optionally scoped to one repo). */
export const listRules = query({
  args: { repo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("projectRules")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .filter((r) => (args.repo ? r.repo === args.repo : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((r) => ({
        _id: r._id,
        repo: r.repo,
        title: r.title,
        body: r.body,
        paths: r.paths,
        action: r.action,
        updatedAt: r.updatedAt,
      }));
  },
});

/** Create a constitution rule. Validates repo access + path specs. */
export const createRule = mutation({
  args: {
    repo: v.string(),
    title: v.string(),
    body: v.string(),
    paths: v.array(v.string()),
    action: v.union(v.literal("block"), v.literal("require_review")),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const repo = cleanName(args.repo, 200);
    if (!repo.includes("/")) throw new Error("Invalid repository name.");
    await requireRepoAccess(ctx, userId, repo);
    const title = cleanText(args.title, 120);
    const body = cleanText(args.body, 2000);
    if (!title.trim()) throw new Error("A rule needs a title.");
    if (args.paths.length === 0) {
      throw new Error("A rule needs at least one file path spec.");
    }
    const paths = args.paths.map((p) => cleanPath(p, 300)).filter(Boolean);
    await ctx.db.insert("projectRules", {
      userId,
      repo,
      title,
      body,
      paths,
      action: args.action,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Update a rule (owner only). */
export const updateRule = mutation({
  args: {
    id: v.id("projectRules"),
    title: v.string(),
    body: v.string(),
    paths: v.array(v.string()),
    action: v.union(v.literal("block"), v.literal("require_review")),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const existing = await ctx.db.get(args.id);
    if (existing === null || existing.userId !== userId) {
      throw new Error("Rule not found.");
    }
    const title = cleanText(args.title, 120);
    const body = cleanText(args.body, 2000);
    if (!title.trim()) throw new Error("A rule needs a title.");
    await ctx.db.patch(args.id, {
      title,
      body,
      paths: args.paths.map((p) => cleanPath(p, 300)).filter(Boolean),
      action: args.action,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Delete a rule (owner only). */
export const deleteRule = mutation({
  args: { id: v.id("projectRules") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const existing = await ctx.db.get(args.id);
    if (existing === null || existing.userId !== userId) {
      throw new Error("Rule not found.");
    }
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

/**
 * Internal gate used by the commit and PR paths: which active rules apply to
 * the given files? "block" rules refuse the operation; "require_review" rules
 * only flag it (the caller records an audit entry and continues).
 */
export const ruleGateForFiles = internalQuery({
  args: {
    repo: v.string(),
    files: v.array(v.string()),
    // Background mission scans have no interactive auth identity; callers
    // provide the owning user explicitly. Interactive actions still resolve
    // the identity from the request when this is omitted.
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<
    {
      blocked: Array<{ file: string; title: string; body: string }>;
      review: Array<{ file: string; title: string; body: string }>;
    }
  > => {
    // Rules are few per user; scan + filter is fine and avoids needing a
    // userId in this internal gate (the caller already enforced ownership).
    const userId = args.userId ?? (await currentUserId(ctx));
    const rows = await ctx.db.query("projectRules")
      .withIndex("by_userRepo", q => q.eq("userId", userId).eq("repo", args.repo)).collect();
    const blocked: Array<{ file: string; title: string; body: string }> = [];
    const review: Array<{ file: string; title: string; body: string }> = [];
    for (const rule of rows) {
      for (const file of args.files) {
        if (!ruleMatchesFile(rule.paths, file)) continue;
        const entry = { file, title: rule.title, body: rule.body };
        if (rule.action === "block") blocked.push(entry);
        else review.push(entry);
      }
    }
    return { blocked, review };
  },
});

// ---------------------------------------------------------------------------
// Project memory
// ---------------------------------------------------------------------------

/** List the user's memory entries (optionally scoped to one repo). */
export const listMemory = query({
  args: { repo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("projectMemory")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .filter((m) => (args.repo ? m.repo === args.repo : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((m) => ({
        _id: m._id,
        repo: m.repo,
        title: m.title,
        body: m.body,
        updatedAt: m.updatedAt,
      }));
  },
});

/** Create a memory entry. Repo-scoped; secrets are rejected at write time. */
export const createMemory = mutation({
  args: {
    repo: v.string(),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const repo = cleanName(args.repo, 200);
    if (!repo.includes("/")) throw new Error("Invalid repository name.");
    await requireRepoAccess(ctx, userId, repo);
    const title = cleanText(args.title, 120);
    const body = cleanText(args.body, 3000);
    if (!title.trim()) throw new Error("Memory needs a title.");
    const risk = secretRisk(title, body);
    if (risk.risky) {
      throw new Error(
        "Memory can't store secrets — remove the credential and try again.",
      );
    }
    await ctx.db.insert("projectMemory", {
      userId,
      repo,
      title,
      body,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const updateMemory = mutation({
  args: { id: v.id("projectMemory"), title: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const existing = await ctx.db.get(args.id);
    if (existing === null || existing.userId !== userId) {
      throw new Error("Memory entry not found.");
    }
    const title = cleanText(args.title, 120);
    const body = cleanText(args.body, 3000);
    const risk = secretRisk(title, body);
    if (risk.risky) {
      throw new Error(
        "Memory can't store secrets — remove the credential and try again.",
      );
    }
    await ctx.db.patch(args.id, { title, body, updatedAt: Date.now() });
    return { ok: true };
  },
});

export const deleteMemory = mutation({
  args: { id: v.id("projectMemory") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const existing = await ctx.db.get(args.id);
    if (existing === null || existing.userId !== userId) {
      throw new Error("Memory entry not found.");
    }
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Findings + dependency reports + health (read side; written by the scanner)
// ---------------------------------------------------------------------------

export const listSecurityFindings = query({
  args: { repo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("securityFindings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .filter((f) => (args.repo ? f.repo === args.repo : true))
      .sort(
        (a, b) =>
          (b.severity === "high" ? 3 : b.severity === "medium" ? 2 : 1) -
            (a.severity === "high" ? 3 : a.severity === "medium" ? 2 : 1) ||
          b.createdAt - a.createdAt,
      )
      .map((f) => ({
        _id: f._id,
        kind: f.kind,
        repo: f.repo,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        evidence: f.evidence,
        file: f.file ?? null,
        remediation: f.remediation,
        createdAt: f.createdAt,
      }));
  },
});

export const dismissSecurityFinding = mutation({
  args: { id: v.id("securityFindings") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (row === null || row.userId !== userId) {
      throw new Error("Finding not found.");
    }
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

export const listDependencyReports = query({
  args: { repo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("dependencyReports")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .filter((d) => (args.repo ? d.repo === args.repo : true))
      .sort((a, b) => a.package.localeCompare(b.package))
      .map((d) => ({
        _id: d._id,
        repo: d.repo,
        package: d.package,
        installed: d.installed ?? null,
        latest: d.latest ?? null,
        status: d.status,
        majorDiff: d.majorDiff,
        fixedVersion: d.fixedVersion ?? null,
        createdAt: d.createdAt,
      }));
  },
});

export const getRepoHealth = query({
  args: { repo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    if (!args.repo) return null;
    const row = await ctx.db
      .query("repoHealth")
      .withIndex("by_userRepo", (q) =>
        q.eq("userId", userId as never).eq("repo", args.repo as string),
      )
      .unique();
    if (row === null) return null;
    return {
      repo: row.repo,
      scores: row.scores,
      evidence: row.evidence,
      updatedAt: row.updatedAt,
    };
  },
});

// ---------------------------------------------------------------------------
// Flight recorder + audit (internal writers, called from actions/crons)
// ---------------------------------------------------------------------------

/** Internal: record one significant AI operation; prunes to a per-user cap. */
export const recordFlight = internalMutation({
  args: {
    userId: v.id("users"),
    repo: v.optional(v.string()),
    missionId: v.optional(v.id("missions")),
    request: v.string(),
    planSummary: v.string(),
    filesInspected: v.array(v.string()),
    filesModified: v.array(v.string()),
    commands: v.array(v.string()),
    tests: v.array(v.string()),
    approvals: v.array(v.string()),
    result: v.string(),
  },
  handler: async (ctx, args) => {
    const MAX = 200;
    await ctx.db.insert("flightRecords", {
      userId: args.userId,
      repo: args.repo ? cleanName(args.repo, 200) : undefined,
      missionId: args.missionId,
      request: cleanText(args.request, 500),
      planSummary: cleanText(args.planSummary, 1000),
      filesInspected: args.filesInspected.slice(0, 60).map((p) => cleanPath(p, 300)),
      filesModified: args.filesModified.slice(0, 60).map((p) => cleanPath(p, 300)),
      commands: args.commands.slice(0, 30).map((c) => cleanText(c, 300)),
      tests: args.tests.slice(0, 30).map((t) => cleanText(t, 300)),
      approvals: args.approvals.slice(0, 20).map((a) => cleanText(a, 300)),
      result: cleanText(args.result, 1000),
      createdAt: Date.now(),
    });
    const rows = await ctx.db
      .query("flightRecords")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    if (rows.length > MAX) {
      const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      for (const old of sorted.slice(MAX)) await ctx.db.delete(old._id);
    }
  },
});

/** The signed-in user's flight records (newest first). */
export const listFlightRecords = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("flightRecords")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((r) => ({
        _id: r._id,
        repo: r.repo ?? null,
        missionId: r.missionId ?? null,
        request: r.request,
        planSummary: r.planSummary,
        filesInspected: r.filesInspected,
        filesModified: r.filesModified,
        commands: r.commands,
        tests: r.tests,
        approvals: r.approvals,
        result: r.result,
        createdAt: r.createdAt,
      }));
  },
});

/** Internal: append an audit entry (branch, result, approval, mission). */
export const audit = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    action: v.string(),
    repo: v.optional(v.string()),
    branch: v.optional(v.string()),
    result: v.optional(v.string()),
    approval: v.optional(v.boolean()),
    missionId: v.optional(v.id("missions")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      userId: args.userId ?? (await currentUserId(ctx)),
      action: cleanText(args.action, 80),
      repo: args.repo ? cleanName(args.repo, 200) : undefined,
      branch: args.branch ? cleanText(args.branch, 200) : undefined,
      result: args.result ? cleanText(args.result, 40) : undefined,
      approval: args.approval,
      missionId: args.missionId,
      detail: args.detail ? cleanText(args.detail, 1000) : undefined,
      createdAt: Date.now(),
    });
  },
});

/** The signed-in user's audit trail (own records; admins see theirs too). */
export const listAuditLogs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("auditLogs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((r) => ({
        _id: r._id,
        action: r.action,
        repo: r.repo ?? null,
        branch: r.branch ?? null,
        result: r.result ?? null,
        approval: r.approval ?? null,
        missionId: r.missionId ?? null,
        detail: r.detail ?? null,
        createdAt: r.createdAt,
      }));
  },
});

// ---------------------------------------------------------------------------
// Missions (resumable multi-step engineering missions + agents)
// ---------------------------------------------------------------------------

const AGENT_DEFAULTS: Array<{
  role: string;
  permission: PermissionLevel;
  objective: string;
}> = [
  {
    role: "analyst",
    permission: "read",
    objective: "Investigate the repository and gather evidence about the objective.",
  },
  {
    role: "security",
    permission: "read",
    objective: "Check the affected files for secrets and risky configuration.",
  },
  {
    role: "coding",
    permission: "suggest",
    objective: "Prepare a concrete proposed change for the objective (no silent edits).",
  },
  {
    role: "test",
    permission: "test",
    objective: "Identify the commands/tests needed to verify the change (run by the user).",
  },
  {
    role: "reviewer",
    permission: "read",
    objective: "Independently review the proposed change, tests, and security before finalizing.",
  },
];

/** Create a resumable mission with tasks + default agents. */
export const createMission = mutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    title: v.string(),
    objective: v.string(),
    plan: v.string(),
    affectedFiles: v.optional(v.array(v.string())),
    agentPermissions: v.optional(
      v.array(
        v.object({ role: v.string(), permission: v.string() }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const repo = cleanName(args.repo, 200);
    if (!repo.includes("/")) throw new Error("Invalid repository name.");
    await requireRepoAccess(ctx, userId, repo);
    const branch = cleanText(args.branch, 200);
    const title = cleanText(args.title, 140);
    const objective = cleanText(args.objective, 2000);
    if (!title.trim() || !objective.trim()) {
      throw new Error("A mission needs a title and an objective.");
    }
    const planLines = args.plan
      .split("\n")
      .map((l) => l.trim().replace(/^[-*•\d.)\s]+/, ""))
      .filter(Boolean)
      .slice(0, 12);
    const tasks =
      planLines.length > 0
        ? planLines.map((label, i) => ({
            id: `t${i + 1}`,
            label: label.slice(0, 120),
            status: "pending" as const,
          }))
        : [
            { id: "t1", label: "Investigate", status: "pending" as const },
            { id: "t2", label: "Plan", status: "pending" as const },
            { id: "t3", label: "Modify", status: "pending" as const },
            { id: "t4", label: "Test", status: "pending" as const },
            { id: "t5", label: "Review", status: "pending" as const },
          ];
    // Permission levels are validated server-side — an agent never gets a
    // level above the ladder just because a client asked for it.
    const requested = new Map(
      (args.agentPermissions ?? []).map((a) => [a.role, a.permission]),
    );
    const agents = AGENT_DEFAULTS.map((a) => ({
      role: a.role,
      permission: (PERMISSION_LEVELS as readonly string[]).includes(
        requested.get(a.role) ?? "",
      )
        ? (requested.get(a.role) as string)
        : a.permission,
      status: "idle" as const,
      objective: a.objective,
      files:
        a.role === "coding"
          ? (args.affectedFiles ?? []).slice(0, 30).map((p) => cleanPath(p, 300))
          : [],
      result: undefined as string | undefined,
    }));
    const id = await ctx.db.insert("missions", {
      userId,
      repo,
      branch,
      title,
      objective,
      plan: cleanText(args.plan, 3000),
      status: "active",
      tasks,
      agents,
      approvals: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.runMutation(internal.securityCenter.recordFlight, {
      userId,
      repo,
      missionId: id,
      request: `Mission: ${title}`,
      planSummary: objective.slice(0, 300),
      filesInspected: [],
      filesModified: (args.affectedFiles ?? []).slice(0, 30),
      commands: [],
      tests: [],
      approvals: [],
      result: "Mission created — awaiting agent steps.",
    });
    return { id };
  },
});

/** List the user's missions, newest first. */
export const listMissions = query({
  args: { repo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("missions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .filter((m) => (args.repo ? m.repo === args.repo : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((m) => ({
        _id: m._id,
        repo: m.repo,
        branch: m.branch,
        title: m.title,
        objective: m.objective,
        status: m.status,
        tasks: m.tasks,
        agents: m.agents,
        approvals: m.approvals,
        updatedAt: m.updatedAt,
        createdAt: m.createdAt,
      }));
  },
});

/** One mission (owner only). */
export const getMission = query({
  args: { id: v.id("missions") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (row === null || row.userId !== userId) {
      throw new Error("Mission not found.");
    }
    return {
      _id: row._id,
      repo: row.repo,
      branch: row.branch,
      title: row.title,
      objective: row.objective,
      plan: row.plan,
      status: row.status,
      tasks: row.tasks,
      agents: row.agents,
      approvals: row.approvals,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});

/** Mark one mission task done/blocked (owner only). */
export const updateMissionTask = mutation({
  args: {
    id: v.id("missions"),
    taskId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("blocked"),
    ),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (row === null || row.userId !== userId) {
      throw new Error("Mission not found.");
    }
    const tasks = row.tasks.map((t) =>
      t.id === args.taskId
        ? {
            id: t.id,
            label: t.label,
            status: args.status,
            detail: args.detail ? cleanText(args.detail, 500) : t.detail,
          }
        : t,
    );
    await ctx.db.patch(args.id, { tasks, updatedAt: Date.now() });
    return { ok: true };
  },
});

/** Internal: update one agent's status/result/files after a step runs. */
export const updateMissionAgent = internalMutation({
  args: {
    missionId: v.id("missions"),
    role: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("done"),
      v.literal("blocked"),
    ),
    result: v.optional(v.string()),
    files: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.missionId);
    if (row === null) throw new Error("Mission not found.");
    const agents = row.agents.map((a) =>
      a.role === args.role
        ? {
            role: a.role,
            permission: a.permission,
            status: args.status,
            objective: a.objective,
            files: args.files ?? a.files,
            result: args.result ? cleanText(args.result, 3000) : a.result,
          }
        : a,
    );
    await ctx.db.patch(args.missionId, { agents, updatedAt: Date.now() });
  },
});

/** Internal: append an approval + optionally move mission status. */
export const appendMissionApproval = internalMutation({
  args: {
    missionId: v.id("missions"),
    by: v.string(),
    kind: v.union(v.literal("user"), v.literal("reviewer")),
    note: v.optional(v.string()),
    setStatus: v.optional(
      v.union(
        v.literal("active"),
        v.literal("awaiting_review"),
        v.literal("done"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.missionId);
    if (row === null) throw new Error("Mission not found.");
    const approvals = [
      ...row.approvals,
      {
        by: cleanText(args.by, 120),
        at: Date.now(),
        kind: args.kind,
        note: args.note ? cleanText(args.note, 500) : undefined,
      },
    ];
    await ctx.db.patch(args.missionId, {
      approvals,
      status: args.setStatus ?? row.status,
      updatedAt: Date.now(),
    });
  },
});

/** User approval — the human stays in control of finalizing. */
export const approveMission = mutation({
  args: { id: v.id("missions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (row === null || row.userId !== userId) {
      throw new Error("Mission not found.");
    }
    if (row.status === "done" || row.status === "cancelled") {
      throw new Error("This mission is already closed.");
    }
    const user = await ctx.db.get(userId);
    const by =
      (user as { name?: string } | null)?.name?.trim() ||
      (user as { email?: string } | null)?.email?.split("@")[0] ||
      "user";
    await ctx.runMutation(internal.securityCenter.appendMissionApproval, {
      missionId: args.id,
      by,
      kind: "user",
      note: args.note,
    });
    await ctx.runMutation(internal.securityCenter.audit, {
      userId,
      action: "mission.approve",
      repo: row.repo,
      branch: row.branch,
      result: "approved",
      approval: true,
      missionId: args.id,
      detail: `User approved mission “${row.title}”.`,
    });
    // Reviewer + user approvals both present → done.
    const updated = await ctx.db.get(args.id);
    const hasReviewer = updated?.approvals.some((a) => a.kind === "reviewer");
    const hasUser = updated?.approvals.some((a) => a.kind === "user");
    if (hasReviewer && hasUser) {
      await ctx.db.patch(args.id, { status: "done", updatedAt: Date.now() });
      await ctx.runMutation(internal.securityCenter.recordFlight, {
        userId,
        repo: row.repo,
        missionId: args.id,
        request: `Mission completed: ${row.title}`,
        planSummary: row.objective.slice(0, 300),
        filesInspected: row.agents.flatMap((a) => a.files),
        filesModified: [],
        commands: [],
        tests: [],
        approvals: ["user", "reviewer"],
        result: "Mission approved and closed — no automatic push happened.",
      });
      // Surface in the unified inbox as a completed mission.
      await ctx.runMutation(internal.aiFindingsStore.upsertFinding, {
        userId,
        key: `mission:${args.id}`,
        kind: "mission",
        repo: row.repo,
        title: `Mission “${row.title}” completed`,
        detail: `Mission ${args.id.slice(0, 8)} was approved by you and the reviewer. Review the proposal in the mission detail before applying anything.`,
      });
    }
    return { ok: true };
  },
});

/** Cancel a mission (owner only). Nothing was modified by this alone. */
export const cancelMission = mutation({
  args: { id: v.id("missions") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (row === null || row.userId !== userId) {
      throw new Error("Mission not found.");
    }
    await ctx.db.patch(args.id, { status: "cancelled", updatedAt: Date.now() });
    await ctx.runMutation(internal.securityCenter.recordFlight, {
      userId,
      repo: row.repo,
      missionId: args.id,
      request: `Mission cancelled: ${row.title}`,
      planSummary: "Cancelled by the user.",
      filesInspected: [],
      filesModified: [],
      commands: [],
      tests: [],
      approvals: [],
      result: "Mission cancelled — no changes were applied.",
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Internal write helpers for the "use node" scanner half
// ---------------------------------------------------------------------------

/** Internal: upsert one security finding by (userId, key). */
export const upsertSecurityFinding = internalMutation({
  args: {
    userId: v.id("users"),
    key: v.string(),
    kind: v.union(
      v.literal("secret"),
      v.literal("dependency"),
      v.literal("config"),
      v.literal("ci"),
      v.literal("docs"),
    ),
    repo: v.string(),
    severity: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    title: v.string(),
    detail: v.string(),
    evidence: v.string(),
    file: v.optional(v.string()),
    remediation: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("securityFindings")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", args.userId as never).eq("key", args.key),
      )
      .unique();
    const doc = {
      userId: args.userId,
      key: args.key,
      kind: args.kind,
      repo: args.repo,
      severity: args.severity,
      title: cleanText(args.title, 200),
      detail: cleanText(args.detail, 600),
      evidence: cleanText(args.evidence, 400),
      file: args.file ? cleanPath(args.file, 300) : undefined,
      remediation: cleanText(args.remediation, 600),
      createdAt: now,
    };
    if (existing !== null) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("securityFindings", doc);
    }
  },
});

/** Internal: drop findings for a repo whose keys are no longer current. */
export const pruneSecurityFindings = internalMutation({
  args: { userId: v.id("users"), repo: v.string(), keepKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const keep = new Set(args.keepKeys);
    const rows = await ctx.db
      .query("securityFindings")
      .withIndex("by_userRepo", (q) =>
        q.eq("userId", args.userId as never).eq("repo", args.repo),
      )
      .collect();
    for (const row of rows) {
      if (!keep.has(row.key)) await ctx.db.delete(row._id);
    }
  },
});

/** Internal: upsert one dependency report by (userId, key). */
export const upsertDependencyReport = internalMutation({
  args: {
    userId: v.id("users"),
    repo: v.string(),
    key: v.string(),
    package: v.string(),
    installed: v.optional(v.string()),
    latest: v.optional(v.string()),
    status: v.union(
      v.literal("vulnerable"),
      v.literal("outdated_major"),
      v.literal("outdated_minor"),
      v.literal("current"),
      v.literal("unknown"),
    ),
    majorDiff: v.number(),
    fixedVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("dependencyReports")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", args.userId as never).eq("key", args.key),
      )
      .unique();
    const doc = {
      userId: args.userId,
      repo: args.repo,
      key: args.key,
      package: cleanName(args.package, 120),
      installed: args.installed ?? undefined,
      latest: args.latest ?? undefined,
      status: args.status,
      majorDiff: args.majorDiff,
      fixedVersion: args.fixedVersion ?? undefined,
      createdAt: now,
    };
    if (existing !== null) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("dependencyReports", doc);
    }
  },
});

/** Internal: drop dependency reports for a repo no longer scanned. */
export const pruneDependencyReports = internalMutation({
  args: { userId: v.id("users"), repo: v.string(), keepKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const keep = new Set(args.keepKeys);
    const rows = await ctx.db
      .query("dependencyReports")
      .withIndex("by_userRepo", (q) =>
        q.eq("userId", args.userId as never).eq("repo", args.repo),
      )
      .collect();
    for (const row of rows) {
      if (!keep.has(row.key)) await ctx.db.delete(row._id);
    }
  },
});

/** Internal: persist the latest explainable health scores for a repo. */
export const upsertRepoHealth = internalMutation({
  args: {
    userId: v.id("users"),
    repo: v.string(),
    scores: v.record(v.string(), v.number()),
    evidence: v.record(v.string(), v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("repoHealth")
      .withIndex("by_userRepo", (q) =>
        q.eq("userId", args.userId as never).eq("repo", args.repo),
      )
      .unique();
    const doc = {
      userId: args.userId,
      repo: args.repo,
      scores: args.scores,
      evidence: args.evidence,
      updatedAt: Date.now(),
    };
    if (existing !== null) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("repoHealth", doc);
    }
  },
});

/** The permission levels UI offers when creating a mission. */
export const permissionLevels = PERMISSION_LEVELS;

// ---------------------------------------------------------------------------
// Internal reads for the "use node" scanner half
// ---------------------------------------------------------------------------

/** Internal: full mission row for an agent step (ownership checked by the
 *  caller action, which resolves the auth user itself). */
export const missionForAgent = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.missionId);
  },
});

/** Internal: a user's memory entries for one repo (agent context). */
export const listMemoryInternal = internalQuery({
  args: { userId: v.id("users"), repo: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("projectMemory")
      .withIndex("by_userRepo", (q) =>
        q.eq("userId", args.userId as never).eq("repo", args.repo),
      )
      .collect();
    return rows.map((m) => ({ title: m.title, body: m.body }));
  },
});

/** Internal: a user's rules for one repo (agent context). */
export const listSecurityFindingsInternal = internalQuery({
  args: { userId: v.id("users"), repo: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("securityFindings")
      .withIndex("by_userRepo", (q) =>
        q.eq("userId", args.userId as never).eq("repo", args.repo),
      )
      .collect();
    return rows.map((f) => ({ severity: f.severity, key: f.key }));
  },
});

/** Internal: a user's dependency reports for one repo (agent context). */
export const listDependencyReportsInternal = internalQuery({
  args: { userId: v.id("users"), repo: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("dependencyReports")
      .withIndex("by_userRepo", (q) =>
        q.eq("userId", args.userId as never).eq("repo", args.repo),
      )
      .collect();
    return rows.map((d) => ({ status: d.status, key: d.key }));
  },
});

/** Internal: a user's rules for one repo (agent context). */
export const listRulesInternal = internalQuery({
  args: { userId: v.id("users"), repo: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("projectRules")
      .withIndex("by_userRepo", (q) =>
        q.eq("userId", args.userId as never).eq("repo", args.repo),
      )
      .collect();
    return rows.map((r) => ({
      title: r.title,
      body: r.body,
      paths: r.paths,
      action: r.action,
    }));
  },
});
