import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // A user's linked GitHub connection (OAuth token + profile). One per user.
    githubConnections: defineTable({
      userId: v.id("users"),
      token: v.string(), // GitHub OAuth access token, read server-side only
      login: v.string(),
      name: v.optional(v.string()),
      avatar: v.optional(v.string()),
    }).index("by_userId", ["userId"]),

    // One-time OAuth state tokens used to bind a GitHub authorization
    // callback back to the app user that started the flow.
    githubOAuthStates: defineTable({
      state: v.string(),
      userId: v.id("users"),
      origin: v.optional(v.string()), // app origin to redirect back to
      expiresAt: v.number(),
    }).index("by_state", ["state"]),

    // Cross-device continuity: the last workspace the user was in, so opening
    // Aria on another device picks up right where they left off (repo, branch,
    // browsed folder, open file, unsaved draft, cursor). One row per user.
    workspaceStates: defineTable({
      userId: v.id("users"),
      repo: v.string(), // full name, e.g. "owner/name"
      branch: v.string(),
      path: v.optional(v.string()), // last browsed folder, if any
      openPath: v.optional(v.string()), // open file path, if any
      draft: v.optional(v.string()), // unsaved editor content (capped)
      cursorLine: v.optional(v.number()),
      cursorColumn: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    // Draft vault: an unsaved copy of every file the user has edited, keyed
    // by (repo, branch, path), so no work is ever trapped in one browser tab
    // and anything can be resumed from any device.
    drafts: defineTable({
      userId: v.id("users"),
      repo: v.string(), // full name, e.g. "owner/name"
      branch: v.string(),
      path: v.string(),
      content: v.string(), // capped server-side
      cursorLine: v.optional(v.number()),
      cursorColumn: v.optional(v.number()),
      updatedAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userKey", ["userId", "repo", "branch", "path"]),

    // Live presence: one row per open browser tab, updated as the user moves
    // between repos/files and types. The reactive query shows which other
    // devices are in the workspace right now (and where they are).
    liveSessions: defineTable({
      userId: v.id("users"),
      deviceId: v.string(), // per-tab id, regenerated on each load
      label: v.string(), // human label, e.g. "Chrome · Desktop"
      repo: v.optional(v.string()),
      branch: v.optional(v.string()),
      path: v.optional(v.string()),
      cursorLine: v.optional(v.number()),
      cursorColumn: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    // Billing: the signed-in user's subscription state. One row per user.
    // plan ladder: free → pro → pro_plus → team → enterprise. Empty until
    // Stripe is configured and a checkout completes.
    billing: defineTable({
      userId: v.id("users"),
      plan: v.union(
        v.literal("free"),
        v.literal("pro"),
        v.literal("pro_plus"),
        v.literal("team"),
        v.literal("enterprise"),
      ),
      stripeCustomerId: v.optional(v.string()),
      stripeSubscriptionId: v.optional(v.string()),
      currentPeriodEnd: v.optional(v.number()),
      // Team tier: number of paid seats the org owner is billed for.
      seats: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    // Chunked blob uploads for the in-browser git engine: files larger than
    // a single Convex call can carry are streamed here as base64 slices, then
    // reassembled server-side by the push action. Rows are pruned after use.
    blobUploads: defineTable({
      userId: v.id("users"),
      sha: v.string(), // expected git blob sha (integrity check on finalize)
      size: v.number(),
      totalChunks: v.number(),
      createdAt: v.number(),
    }).index("by_userId", ["userId"]),
    blobUploadChunks: defineTable({
      userId: v.id("users"),
      uploadId: v.id("blobUploads"),
      chunkIndex: v.number(),
      data: v.string(), // base64 slice
    }).index("by_upload", ["uploadId", "chunkIndex"]),

    // AI usage metering: one row per user per calendar month, incremented
    // server-side before every AI call so quotas are enforced at the action
    // layer (never by UI hiding alone).
    aiUsage: defineTable({
      userId: v.id("users"),
      period: v.string(), // "YYYY-MM"
      count: v.number(),
      updatedAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userPeriod", ["userId", "period"]),

    // Audit trail: who did what and when (commits, pushes, merges, AI calls,
    // plan changes). Written from the action layer; shown to Team/Enterprise
    // admins.
    auditLogs: defineTable({
      userId: v.id("users"),
      action: v.string(),
      repo: v.optional(v.string()),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_createdAt", ["createdAt"]),

    // Free-tier repo gate: the private repos a user has opened in Aria.
    // Free plans may track at most one private repo (public repos are free);
    // the limit is enforced server-side in the repo-loading actions.
    connectedRepos: defineTable({
      userId: v.id("users"),
      repo: v.string(), // full name, e.g. "owner/name"
      private: v.boolean(),
      updatedAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userRepo", ["userId", "repo"]),

    // Web push: one row per browser subscription, so notifications reach the
    // user 24×7 — even with the tab closed, via the Convex cron. Endpoints are
    // pruned when the browser push service reports them dead (404/410).
    pushSubscriptions: defineTable({
      userId: v.id("users"),
      endpoint: v.string(),
      keys: v.object({ p256dh: v.string(), auth: v.string() }),
      deviceLabel: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_endpoint", ["endpoint"]),

    // Dedup: which inbox items have already been pushed to each user, so the
    // polling check and the cron never fire the same notification twice.
    sentNotifications: defineTable({
      userId: v.id("users"),
      key: v.string(), // e.g. "review:owner/repo#12"
      sentAt: v.number(),
    })
      .index("by_userKey", ["userId", "key"]),

    // Team workspaces: a short join code that points other users at the same
    // repo + branch. Everyone joins with their own GitHub connection; drafts
    // and presence stay per-user.
    sharedWorkspaces: defineTable({
      code: v.string(), // short join code, e.g. "ARIA-K7Q2"
      repo: v.string(), // full name, e.g. "owner/name"
      branch: v.string(),
      label: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_code", ["code"]).index("by_createdBy", ["createdBy"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
