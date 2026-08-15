import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { cleanName, cleanText } from "../lib/sanitize";
import {
  canRole,
  evaluateApprovalPolicies,
  isOrgRole,
  ORG_ROLE_RANK,
  ORG_ROLES,
  type ApprovalAction,
  type ApprovalPolicy,
  type OrgRole,
} from "../lib/phase4";

/**
 * Phase 4 — Organizations, RBAC, and approval policies (default runtime).
 *
 * Authorization model (server-side only — never UI hiding):
 *  - organizations are owned by one user; members have a role from the
 *    ladder owner > admin > developer > reviewer > viewer.
 *  - org-scoped writes check the actor's role in every mutation.
 *  - approval policies are server-authoritative: the git/commit/PR gate in
 *    githubActions consults them via the internal queries below, and the
 *    release center surfaces the same evaluation.
 *  - cross-org data access is impossible by construction: every query is
 *    scoped through the caller's own membership rows.
 */

export async function currentUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("You are not signed in.");
  return userId;
}

async function membership(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
): Promise<{ role: OrgRole; memberId: Id<"orgMembers"> } | null> {
  const row = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgUser", (q) =>
      q.eq("orgId", orgId as never).eq("userId", userId as never),
    )
    .unique();
  if (!row) return null;
  return { role: row.role as OrgRole, memberId: row._id };
}

export async function requireOrgRole(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  required: OrgRole,
): Promise<{ role: OrgRole; memberId: Id<"orgMembers"> }> {
  const m = await membership(ctx, orgId, userId);
  if (!m) throw new Error("You are not a member of this organization.");
  if (!canRole(m.role, required)) {
    throw new Error(
      `This action needs the ${required} role or higher in this organization.`,
    );
  }
  return m;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The signed-in user's organizations, with their role in each. */
export const myOrgs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    const members = await ctx.db
      .query("orgMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId as never))
      .collect();
    const orgs = await Promise.all(
      members.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        if (!org) return null;
        const memberCount = (
          await ctx.db
            .query("orgMembers")
            .withIndex("by_org", (q) => q.eq("orgId", m.orgId as never))
            .collect()
        ).length;
        return {
          _id: org._id,
          name: org.name,
          slug: org.slug,
          ownerId: org.ownerId,
          role: m.role as OrgRole,
          memberCount,
        };
      }),
    );
    return orgs.filter((o): o is NonNullable<typeof o> => o !== null);
  },
});

/** Members of one org, with their GitHub logins where available. */
export const orgMembers = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    await requireOrgRole(ctx, args.orgId, userId, ORG_ROLES.VIEWER);
    const rows = await ctx.db
      .query("orgMembers")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as never))
      .collect();
    return Promise.all(
      rows.map(async (m) => {
        const [user, conn] = await Promise.all([
          ctx.db.get(m.userId),
          ctx.db
            .query("githubConnections")
            .withIndex("by_userId", (q) => q.eq("userId", m.userId as never))
            .unique(),
        ]);
        return {
          _id: m._id,
          userId: m.userId,
          login: conn?.login ?? null,
          email: user?.email ?? null,
          role: m.role as OrgRole,
          invitedBy: m.invitedBy,
          createdAt: m.createdAt,
        };
      }),
    );
  },
});

/** Approval policies for an org (viewer+ can read). */
export const policiesForOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    await requireOrgRole(ctx, args.orgId, userId, ORG_ROLES.VIEWER);
    const rows = await ctx.db
      .query("approvalPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as never))
      .collect();
    return rows.map((p) => ({
      _id: p._id,
      action: p.action as ApprovalAction,
      branchGlob: p.branchGlob,
      minRole: p.minRole as OrgRole,
      minApprovers: p.minApprovers,
      pathGlobs: p.pathGlobs,
    }));
  },
});

/**
 * Evaluate the org's policies for one concrete action (used by the release
 * center). Returns the matched policy plus whether the caller already
 * satisfies it.
 */
export const evaluateAction = query({
  args: {
    orgId: v.id("organizations"),
    action: v.union(
      v.literal("deploy"),
      v.literal("protected_branch"),
      v.literal("dependency_upgrade"),
      v.literal("database_migration"),
      v.literal("high_risk_ai"),
    ),
    branch: v.string(),
    paths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const m = await requireOrgRole(ctx, args.orgId, userId, ORG_ROLES.VIEWER);
    const rows = await ctx.db
      .query("approvalPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as never))
      .collect();
    const matched = evaluateApprovalPolicies(
      rows.map((p) => ({
        action: p.action as ApprovalAction,
        branchGlob: p.branchGlob,
        minRole: p.minRole as OrgRole,
        minApprovers: p.minApprovers,
        pathGlobs: p.pathGlobs,
      })),
      { action: args.action, branch: args.branch, paths: args.paths },
    );
    return {
      policy: matched,
      satisfied: matched
        ? canRole(m.role, matched.minRole) && matched.minApprovers <= 1
        : true,
      actorRole: m.role,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const slugify = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";

/** Create an organization; the creator becomes the owner. */
export const createOrg = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const name = cleanName(args.name).slice(0, 80);
    if (!name) throw new Error("Organization name can't be empty.");
    const slug = slugify(name);
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) {
      throw new Error(
        `An organization named “${name}” already exists — pick another name.`,
      );
    }
    const orgId = await ctx.db.insert("organizations", {
      name,
      slug,
      ownerId: userId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("orgMembers", {
      orgId,
      userId,
      role: ORG_ROLES.OWNER,
      createdAt: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "org.create",
      resource: `org:${name}`,
      result: "ok",
      createdAt: Date.now(),
    });
    return orgId;
  },
});

/**
 * Add a member by GitHub login or email. Resolves an existing Aria user;
 * invites to people without an account require email infrastructure we don't
 * ship here, so that case is reported rather than faked.
 */
export const inviteMember = mutation({
  args: { orgId: v.id("organizations"), loginOrEmail: v.string() },
  handler: async (ctx, args) => {
    const actor = await currentUserId(ctx);
    await requireOrgRole(ctx, args.orgId, actor, ORG_ROLES.ADMIN);
    const target = cleanText(args.loginOrEmail).trim().slice(0, 120).toLowerCase();
    if (!target) throw new Error("Enter a GitHub login or email.");

    const conn = await ctx.db
      .query("githubConnections")
      .filter((q) => q.eq(q.field("login"), target))
      .unique();
    const byEmail = conn
      ? null
      : await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("email"), target))
          .unique();
    const targetUserId = (conn?.userId ?? byEmail?._id) as
      | Id<"users">
      | undefined;
    if (!targetUserId) {
      throw new Error(
        `No Aria user matches “${target}” yet — they need to sign in to Aria once. (Email invitations need an email provider; that's an external dependency.)`,
      );
    }
    const existing = await membership(ctx, args.orgId, targetUserId);
    if (existing) {
      throw new Error("That user is already a member.");
    }
    await ctx.db.insert("orgMembers", {
      orgId: args.orgId,
      userId: targetUserId,
      role: ORG_ROLES.DEVELOPER,
      invitedBy: actor,
      createdAt: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      userId: actor,
      action: "org.member.invite",
      resource: `org:${args.orgId}`,
      result: "ok",
      detail: `invited ${target} as developer`,
      createdAt: Date.now(),
    });
  },
});

/** Change a member's role. Owner changes anyone (except demoting the last owner); admin changes below-admin roles. */
export const updateMemberRole = mutation({
  args: {
    orgId: v.id("organizations"),
    memberId: v.id("orgMembers"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("developer"),
      v.literal("reviewer"),
      v.literal("viewer"),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await currentUserId(ctx);
    if (!isOrgRole(args.role)) throw new Error("Invalid role.");
    const actorM = await requireOrgRole(ctx, args.orgId, actor, ORG_ROLES.ADMIN);
    const target = await ctx.db.get(args.memberId);
    if (!target || target.orgId !== args.orgId) {
      throw new Error("Member not found in this organization.");
    }
    if (args.role === ORG_ROLES.OWNER && actorM.role !== ORG_ROLES.OWNER) {
      throw new Error("Only the owner can transfer ownership.");
    }
    if (target.userId === actor && args.role !== ORG_ROLES.OWNER) {
      throw new Error("You can't change your own role.");
    }
    if (args.role === ORG_ROLES.OWNER || target.role === ORG_ROLES.OWNER) {
      // Only the owner may promote/demote owner-level roles.
      if (actorM.role !== ORG_ROLES.OWNER) {
        throw new Error("Only the owner can manage owner roles.");
      }
    }
    await ctx.db.patch(args.memberId, { role: args.role });
    await ctx.db.insert("auditLogs", {
      userId: actor,
      action: "org.member.role",
      resource: `org:${args.orgId}`,
      result: "ok",
      detail: `member ${target.userId} → ${args.role}`,
      createdAt: Date.now(),
    });
  },
});

/** Remove a member (owner/admin). The owner can't remove themselves. */
export const removeMember = mutation({
  args: { orgId: v.id("organizations"), memberId: v.id("orgMembers") },
  handler: async (ctx, args) => {
    const actor = await currentUserId(ctx);
    await requireOrgRole(ctx, args.orgId, actor, ORG_ROLES.ADMIN);
    const target = await ctx.db.get(args.memberId);
    if (!target || target.orgId !== args.orgId) {
      throw new Error("Member not found in this organization.");
    }
    if (target.userId === actor) {
      throw new Error("Leave the organization instead of removing yourself.");
    }
    await ctx.db.delete(args.memberId);
    await ctx.db.insert("auditLogs", {
      userId: actor,
      action: "org.member.remove",
      resource: `org:${args.orgId}`,
      result: "ok",
      createdAt: Date.now(),
    });
  },
});

/** Leave an org. The owner transfers ownership to the most senior admin instead. */
export const leaveOrg = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const m = await membership(ctx, args.orgId, userId);
    if (!m) throw new Error("You are not a member of this organization.");
    const org = await ctx.db.get(args.orgId);
    if (org && org.ownerId === userId) {
      const admins = await ctx.db
        .query("orgMembers")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId as never))
        .filter((q) =>
          q.or(
            q.eq(q.field("role"), "admin"),
            q.eq(q.field("role"), "owner"),
          ),
        )
        .collect();
      const heir = admins.find((a) => a.userId !== userId);
      if (!heir) {
        throw new Error(
          "You're the only owner — transfer ownership to another member first.",
        );
      }
      await ctx.db.patch(args.orgId, { ownerId: heir.userId });
      await ctx.db.patch(heir._id, { role: ORG_ROLES.OWNER });
    }
    await ctx.db.delete(m.memberId);
    await ctx.db.insert("auditLogs", {
      userId,
      action: "org.member.leave",
      resource: `org:${args.orgId}`,
      result: "ok",
      createdAt: Date.now(),
    });
  },
});

/** Create or update an approval policy (owner/admin). */
export const upsertApprovalPolicy = mutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("approvalPolicies")),
    action: v.union(
      v.literal("deploy"),
      v.literal("protected_branch"),
      v.literal("dependency_upgrade"),
      v.literal("database_migration"),
      v.literal("high_risk_ai"),
    ),
    branchGlob: v.string(),
    minRole: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("developer"),
      v.literal("reviewer"),
      v.literal("viewer"),
    ),
    minApprovers: v.number(),
    pathGlobs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await currentUserId(ctx);
    await requireOrgRole(ctx, args.orgId, actor, ORG_ROLES.ADMIN);
    if (!isOrgRole(args.minRole)) throw new Error("Invalid minimum role.");
    const minApprovers = Math.max(1, Math.min(5, Math.round(args.minApprovers)));
    const branchGlob = cleanText(args.branchGlob).trim().slice(0, 100);
    const pathGlobs = args.pathGlobs
      .map((p) => cleanText(p).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 20);
    if (args.policyId) {
      const existing = await ctx.db.get(args.policyId);
      if (!existing || existing.orgId !== args.orgId) {
        throw new Error("Policy not found in this organization.");
      }
      await ctx.db.patch(args.policyId, {
        action: args.action,
        branchGlob,
        minRole: args.minRole,
        minApprovers,
        pathGlobs,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("approvalPolicies", {
        orgId: args.orgId,
        action: args.action,
        branchGlob,
        minRole: args.minRole,
        minApprovers,
        pathGlobs,
        createdBy: actor,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.insert("auditLogs", {
      userId: actor,
      action: "org.policy.upsert",
      resource: `org:${args.orgId}`,
      result: "ok",
      detail: `${args.action} (${branchGlob || "*"}) needs ${args.minRole}+, ${minApprovers} approval(s)`,
      createdAt: Date.now(),
    });
  },
});

/** Delete an approval policy (owner/admin). */
export const deleteApprovalPolicy = mutation({
  args: { orgId: v.id("organizations"), policyId: v.id("approvalPolicies") },
  handler: async (ctx, args) => {
    const actor = await currentUserId(ctx);
    await requireOrgRole(ctx, args.orgId, actor, ORG_ROLES.ADMIN);
    const existing = await ctx.db.get(args.policyId);
    if (!existing || existing.orgId !== args.orgId) {
      throw new Error("Policy not found in this organization.");
    }
    await ctx.db.delete(args.policyId);
    await ctx.db.insert("auditLogs", {
      userId: actor,
      action: "org.policy.delete",
      resource: `org:${args.orgId}`,
      result: "ok",
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Approval records (Phase 4 C) — count of distinct approvers gates actions
// ---------------------------------------------------------------------------

/** Approve a sensitive action (release center). Only members with role >= the
 *  policy's minRole may approve; the approval is recorded and counted. */
export const approveAction = mutation({
  args: {
    orgId: v.id("organizations"),
    action: v.union(
      v.literal("deploy"),
      v.literal("protected_branch"),
      v.literal("dependency_upgrade"),
      v.literal("database_migration"),
      v.literal("high_risk_ai"),
    ),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await currentUserId(ctx);
    const m = await requireOrgRole(ctx, args.orgId, actor, ORG_ROLES.VIEWER);
    const rows = await ctx.db
      .query("approvalPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as never))
      .collect();
    const matched = evaluateApprovalPolicies(
      rows.map((p) => ({
        action: p.action as ApprovalAction,
        branchGlob: p.branchGlob,
        minRole: p.minRole as OrgRole,
        minApprovers: p.minApprovers,
        pathGlobs: p.pathGlobs,
      })),
      { action: args.action, branch: args.branch, paths: [] },
    );
    if (!matched) {
      throw new Error(
        "No approval policy matches this action on this branch — nothing to approve.",
      );
    }
    if (!canRole(m.role, matched.minRole)) {
      throw new Error(
        `Approving this needs the ${matched.minRole} role or higher in the organization.`,
      );
    }
    const existing = await ctx.db
      .query("actionApprovals")
      .withIndex("by_orgAction", (q) =>
        q
          .eq("orgId", args.orgId as never)
          .eq("action", args.action)
          .eq("branch", args.branch),
      )
      .filter((q) => q.eq(q.field("approvedBy"), actor as never))
      .first();
    if (!existing) {
      await ctx.db.insert("actionApprovals", {
        orgId: args.orgId,
        action: args.action,
        branch: args.branch.slice(0, 200),
        approvedBy: actor,
        approvedAt: Date.now(),
      });
    }
    await ctx.db.insert("auditLogs", {
      userId: actor,
      action: "org.approval.granted",
      resource: `org:${args.orgId}`,
      branch: args.branch.slice(0, 200),
      result: "approved",
      approval: true,
      detail: `${args.action} on ${args.branch.slice(0, 120)}`,
      createdAt: Date.now(),
    });
  },
});

/** Release-center status: matched policy, approval count, and whether the
 *  caller can approve / the action is satisfied. */
export const approvalStatus = query({
  args: {
    orgId: v.id("organizations"),
    action: v.union(
      v.literal("deploy"),
      v.literal("protected_branch"),
      v.literal("dependency_upgrade"),
      v.literal("database_migration"),
      v.literal("high_risk_ai"),
    ),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const m = await requireOrgRole(ctx, args.orgId, userId, ORG_ROLES.VIEWER);
    const rows = await ctx.db
      .query("approvalPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as never))
      .collect();
    const matched = evaluateApprovalPolicies(
      rows.map((p) => ({
        action: p.action as ApprovalAction,
        branchGlob: p.branchGlob,
        minRole: p.minRole as OrgRole,
        minApprovers: p.minApprovers,
        pathGlobs: p.pathGlobs,
      })),
      { action: args.action, branch: args.branch, paths: [] },
    );
    const approvers = matched
      ? await ctx.db
          .query("actionApprovals")
          .withIndex("by_orgAction", (q) =>
            q
              .eq("orgId", args.orgId as never)
              .eq("action", args.action)
              .eq("branch", args.branch),
          )
          .collect()
      : [];
    const count = new Set(approvers.map((a) => a.approvedBy)).size;
    const canApprove = matched ? canRole(m.role, matched.minRole) : false;
    return {
      policy: matched,
      approvalCount: count,
      satisfied: matched
        ? canRole(m.role, matched.minRole) && count >= matched.minApprovers
        : true,
      canApprove,
      actorRole: m.role,
    };
  },
});

/**
 * Release center: record a controlled release action (deploy / dependency
 * upgrade). Server-authoritative — when an approval policy matches, the
 * action is only recorded when the caller's role and the approval count
 * satisfy it. No matching policy means nothing requires approval. A release
 * record is an audit entry + explicit permission gate; actually deploying to
 * a hosting platform is an external dependency (reported, not faked).
 */
export const recordRelease = mutation({
  args: {
    orgId: v.id("organizations"),
    repo: v.string(),
    branch: v.string(),
    commit: v.optional(v.string()),
    action: v.union(v.literal("deploy"), v.literal("dependency_upgrade")),
  },
  handler: async (ctx, args) => {
    const actor = await currentUserId(ctx);
    const m = await requireOrgRole(ctx, args.orgId, actor, ORG_ROLES.VIEWER);
    const rows = await ctx.db
      .query("approvalPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as never))
      .collect();
    const matched = evaluateApprovalPolicies(
      rows.map((p) => ({
        action: p.action as ApprovalAction,
        branchGlob: p.branchGlob,
        minRole: p.minRole as OrgRole,
        minApprovers: p.minApprovers,
        pathGlobs: p.pathGlobs,
      })),
      { action: args.action, branch: args.branch, paths: [] },
    );
    let approvalCount = 0;
    if (matched) {
      const approvers = await ctx.db
        .query("actionApprovals")
        .withIndex("by_orgAction", (q) =>
          q
            .eq("orgId", args.orgId as never)
            .eq("action", args.action)
            .eq("branch", args.branch),
        )
        .collect();
      approvalCount = new Set(approvers.map((a) => a.approvedBy)).size;
      if (
        !canRole(m.role, matched.minRole) ||
        approvalCount < matched.minApprovers
      ) {
        throw new Error(
          `This release needs approval first: the policy requires the ${matched.minRole} role (or higher) and ${matched.minApprovers} approval(s) for ${args.action} on ${args.branch} (${approvalCount} recorded).`,
        );
      }
    }
    await ctx.db.insert("auditLogs", {
      userId: actor,
      action: `release.${args.action}`,
      resource: `org:${args.orgId}`,
      repo: args.repo.slice(0, 200),
      branch: args.branch.slice(0, 200),
      result: "approved",
      approval: matched !== null,
      detail: `${args.commit ? args.commit.slice(0, 12) : ""} recorded (policy ${matched ? "required" : "none"})`,
      createdAt: Date.now(),
    });
    return {
      recorded: true,
      policyRequired: matched !== null,
      approvalCount,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers (called from actions — githubActions gate, release center)
// ---------------------------------------------------------------------------

/** Internal: the user's role in an org (or null). */
export const internalMembership = internalQuery({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const m = await membership(ctx, args.orgId, args.userId);
    return m ? { role: m.role as OrgRole } : null;
  },
});

/** Internal: all policies for an org, for server-side enforcement. */
export const internalPolicies = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("approvalPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as never))
      .collect();
    return rows.map((p) => ({
      action: p.action as ApprovalAction,
      branchGlob: p.branchGlob,
      minRole: p.minRole as OrgRole,
      minApprovers: p.minApprovers,
      pathGlobs: p.pathGlobs,
    }));
  },
});

/**
 * Internal: evaluate the actor's org protected-branch policies for one
 * commit/push. Returns the most restrictive matching policy with the actor's
 * role and the current approval count, so the git gate can block or allow
 * server-side. No org data other than the matched requirement leaks.
 */
export const internalCommitGate = internalQuery({
  args: {
    userId: v.id("users"),
    branch: v.string(),
    paths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("orgMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId as never))
      .collect();
    let best: {
      orgId: Id<"organizations">;
      orgName: string;
      role: OrgRole;
      minRole: OrgRole;
      minApprovers: number;
      approvalCount: number;
    } | null = null;
    for (const member of members) {
      const org = await ctx.db.get(member.orgId);
      if (!org) continue;
      const policies = await ctx.db
        .query("approvalPolicies")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId as never))
        .collect();
      const matched = evaluateApprovalPolicies(
        policies.map((p) => ({
          action: p.action as ApprovalAction,
          branchGlob: p.branchGlob,
          minRole: p.minRole as OrgRole,
          minApprovers: p.minApprovers,
          pathGlobs: p.pathGlobs,
        })),
        {
          action: "protected_branch" as ApprovalAction,
          branch: args.branch,
          paths: args.paths,
        },
      );
      if (!matched) continue;
      const approvers = await ctx.db
        .query("actionApprovals")
        .withIndex("by_orgAction", (q) =>
          q
            .eq("orgId", member.orgId as never)
            .eq("action", "protected_branch")
            .eq("branch", args.branch),
        )
        .collect();
      const approvalCount = new Set(approvers.map((a) => a.approvedBy)).size;
      const role = member.role as OrgRole;
      if (
        !best ||
        (ORG_ROLE_RANK[matched.minRole] ?? 0) >
          (ORG_ROLE_RANK[best.minRole] ?? 0) ||
        (ORG_ROLE_RANK[matched.minRole] ?? 0) ===
          (ORG_ROLE_RANK[best.minRole] ?? 0) &&
          matched.minApprovers > best.minApprovers
      ) {
        best = {
          orgId: member.orgId,
          orgName: org.name,
          role,
          minRole: matched.minRole as OrgRole,
          minApprovers: matched.minApprovers,
          approvalCount,
        };
      }
    }
    return best
      ? {
          ...best,
          satisfied:
            canRole(best.role, best.minRole) &&
            best.approvalCount >= best.minApprovers,
        }
      : null;
  },
});

/** Internal: resolve an org by slug (for org links). */
export const internalOrgBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    return org ? { _id: org._id, name: org.name, slug: org.slug } : null;
  },
});

/** Internal: record an approval decision against a policy (used by gates). */
export const recordApproval = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    action: v.string(),
    branch: v.string(),
    approved: v.boolean(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      userId: args.userId,
      action: `org.approval.${args.approved ? "granted" : "denied"}`,
      resource: `org:${args.orgId}`,
      branch: args.branch,
      result: args.approved ? "approved" : "denied",
      approval: true,
      detail: args.detail ? cleanText(args.detail).slice(0, 300) : undefined,
      createdAt: Date.now(),
    });
  },
});

// Keep an ApprovalPolicy type import used by callers of evaluateApprovalPolicies.
export type { ApprovalPolicy };
