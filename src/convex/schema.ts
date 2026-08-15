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
    // browsed folder, open file, unsaved draft, caret, scroll position, active
    // panel, and layout). One row per user; position fields are last-write-wins
    // across devices by design (unsaved *content* is protected separately by
    // the draft vault's saveDraftIfNewer).
    workspaceStates: defineTable({
      userId: v.id("users"),
      repo: v.string(), // full name, e.g. "owner/name"
      branch: v.string(),
      path: v.optional(v.string()), // last browsed folder, if any
      openPath: v.optional(v.string()), // active file path, if any
      // Ordered list of open tabs (paths only — each tab's unsaved content
      // lives in the draft vault keyed by (repo, branch, path), so every tab
      // is independently resumable and cross-device safe). Capped at 10.
      openTabs: v.optional(v.array(v.string())),
      draft: v.optional(v.string()), // unsaved editor content (capped)
      cursorLine: v.optional(v.number()),
      cursorColumn: v.optional(v.number()),
      // Editor scroll offset of the open file (Monaco scrollTop/scrollLeft).
      scrollTop: v.optional(v.number()),
      scrollLeft: v.optional(v.number()),
      // Active panel (edit/diff/preview) + layout (focus mode collapses the
      // sidebars) so the restored workspace looks the same as it was left.
      viewMode: v.optional(
        v.union(v.literal("edit"), v.literal("diff"), v.literal("preview")),
      ),
      focusMode: v.optional(v.boolean()),
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

    // AI conversation context: the current Ask Aria conversation (last N
    // turns), one row per user, so a conversation survives a refresh, a
    // closed dialog, or a move to another device. Capped server-side; empty
    // turns array = no active conversation (row may be deleted).
    aiConversations: defineTable({
      userId: v.id("users"),
      turns: v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          content: v.string(),
        }),
      ),
      updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    // Rate limiting: fixed one-minute window counters, keyed by bucket
    // (e.g. "ai:user:xxx", "github:user:xxx", "otp:email:xxx",
    // "ghcallback:ip:xxx"). Soft enforcement — a limiter hiccup never blocks
    // a request. Rows are pruned as they age out.
    rateLimits: defineTable({
      bucket: v.string(),
      windowStart: v.number(), // start of the current 60s window
      count: v.number(),
    }).index("by_bucket", ["bucket"]),

    // Global feature switches (kill switches): a row per flag. Absent row =
    // feature enabled (so fresh deployments keep everything on). Enforcement
    // is server-side in the actions/mutations/crons — never UI hiding alone.
    featureFlags: defineTable({
      key: v.string(), // e.g. "aiBackgroundChecker" | "liveCollaboration" | "crossRepoEdits"
      enabled: v.boolean(),
      updatedBy: v.optional(v.id("users")),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // Health checks: the latest result of each background connectivity probe
    // (login/auth OIDC, GitHub API reachability, AI provider reachability).
    // Written by the hourly cron; shown in the admin console. An entry here
    // still needs a human to read it — the check only records, never alerts.
    healthChecks: defineTable({
      check: v.string(), // "auth" | "github" | "ai" | "db"
      ok: v.boolean(),
      detail: v.optional(v.string()),
      checkedAt: v.number(),
    }).index("by_checkedAt", ["checkedAt"]),

    // Error log: server-side failures worth reviewing (cron per-user failures,
    // health probe failures, provider hiccups). Capped by the writer; surfaced
    // in the admin console. A log entry still needs a human to read it.
    errorLogs: defineTable({
      source: v.string(), // e.g. "aiFindings" | "health" | "push"
      userId: v.optional(v.id("users")),
      message: v.string(),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_createdAt", ["createdAt"])
      .index("by_source", ["source"]),

    // Background AI checker findings: one row per issue the scheduled scan
    // surfaced (outdated/risky dependencies, stale PRs, suspicious config
    // changes, failing CI). Deterministic scans produce template explanations
    // — nothing is ever auto-fixed, only surfaced as cards for review. Rows
    // are upserted by (userId, key) so a fixed finding disappears on the next
    // scan, and pruned to a cap so the inbox stays tidy.
    aiFindings: defineTable({
      userId: v.id("users"),
      key: v.string(), // dedup: e.g. "deps:owner/repo:lodash"
      kind: v.union(
        v.literal("dependency"),
        v.literal("stale_pr"),
        v.literal("config_change"),
        v.literal("failing_ci"),
      ),
      repo: v.string(), // full name, e.g. "owner/name"
      title: v.string(),
      detail: v.string(), // short plain-language explanation
      url: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userKey", ["userId", "key"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
