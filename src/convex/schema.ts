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
    // plan changes, secret overrides, mission approvals). Written from the
    // action layer; shown to Team/Enterprise admins (and the mission owner in
    // the security center). Phase 3 extends the record with the branch,
    // result, whether an approval was involved, and the mission it belongs to.
    auditLogs: defineTable({
      userId: v.id("users"),
      actorLogin: v.optional(v.string()), // GitHub login of the actor
      action: v.string(),
      resource: v.optional(v.string()), // e.g. "commit" | "pr" | "mission" | "org:name"
      repo: v.optional(v.string()),
      branch: v.optional(v.string()),
      result: v.optional(v.string()), // e.g. "ok" | "blocked" | "overridden" | "approved" | "denied"
      approval: v.optional(v.boolean()),
      missionId: v.optional(v.id("missions")),
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
    // changes, failing CI, security scan hits, dependency upgrade warnings,
    // docs gaps, mission completions). Deterministic scans produce template
    // explanations — nothing is ever auto-fixed, only surfaced as cards for
    // review. Rows are upserted by (userId, key) so a fixed finding
    // disappears on the next scan, and pruned to a cap so the inbox stays
    // tidy. Phase 4 adds priority, read/dismissed state so the inbox can
    // rank actionable items and track what the user has seen.
    aiFindings: defineTable({
      userId: v.id("users"),
      key: v.string(), // dedup: e.g. "deps:owner/repo:lodash"
      kind: v.union(
        v.literal("dependency"),
        v.literal("stale_pr"),
        v.literal("config_change"),
        v.literal("failing_ci"),
        v.literal("security"),
        v.literal("dependency_upgrade"),
        v.literal("docs"),
        v.literal("mission"),
      ),
      priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      readAt: v.optional(v.number()),
      dismissedAt: v.optional(v.number()),
      repo: v.string(), // full name, e.g. "owner/name"
      title: v.string(),
      detail: v.string(), // short plain-language explanation
      url: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userKey", ["userId", "key"]),

    // Project constitution (Phase 3): repository-specific rules a user has
    // written down — files never to modify, conventions, testing/deployment
    // requirements. Rules are visible, editable, persisted, and enforced
    // server-side at the commit and PR gates (never UI hiding alone).
    projectRules: defineTable({
      userId: v.id("users"),
      repo: v.string(), // full name, e.g. "owner/name"
      title: v.string(),
      body: v.string(), // free-text rule
      paths: v.array(v.string()), // file specs the rule applies to
      action: v.union(v.literal("block"), v.literal("require_review")),
      updatedAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userRepo", ["userId", "repo"]),

    // Project memory (Phase 3): repository-scoped facts/instructions the user
    // wants Aria to remember. Visible, editable, deletable, permission-aware
    // (only the owner edits; read by the mission/agent pipeline). Secrets are
    // rejected at write time.
    projectMemory: defineTable({
      userId: v.id("users"),
      repo: v.string(), // full name, e.g. "owner/name"
      title: v.string(),
      body: v.string(),
      updatedAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userRepo", ["userId", "repo"]),

    // Missions (Phase 3): resumable multi-step engineering missions with
    // tasks, agents, permissions, approvals, and evidence. Nothing a mission
    // does ever silently commits, merges, deploys, or deletes — it prepares
    // proposals the user applies and approves.
    missions: defineTable({
      userId: v.id("users"),
      // Phase 4: optional org scope so teams can share missions. When set,
      // membership is enforced server-side before any mission is read/written.
      orgId: v.optional(v.id("organizations")),
      repo: v.string(),
      branch: v.string(),
      title: v.string(),
      objective: v.string(),
      plan: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("awaiting_review"),
        v.literal("done"),
        v.literal("cancelled"),
      ),
      tasks: v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          status: v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("done"),
            v.literal("blocked"),
          ),
          detail: v.optional(v.string()),
        }),
      ),
      agents: v.array(
        v.object({
          role: v.string(), // "analyst" | "security" | "coding" | "test" | "reviewer"
          permission: v.string(), // PermissionLevel: read | suggest | modify | test | git | pr | deploy
          status: v.union(
            v.literal("idle"),
            v.literal("running"),
            v.literal("done"),
            v.literal("blocked"),
          ),
          objective: v.string(),
          files: v.array(v.string()), // files claimed / inspected (parallel-safety)
          result: v.optional(v.string()),
        }),
      ),
      approvals: v.array(
        v.object({
          by: v.string(), // user login or reviewer role label
          at: v.number(),
          kind: v.union(v.literal("user"), v.literal("reviewer")),
          note: v.optional(v.string()),
        }),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    // Security command center findings (Phase 3): everything the security
    // scans surfaced for a repo — secrets, dependency vulnerabilities, risky
    // config, CI problems, docs gaps. Each row carries severity, evidence
    // (never the secret value), the affected file, an explanation, and a
    // remediation. Deduped per (userId, key).
    securityFindings: defineTable({
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
      evidence: v.string(), // redacted description, e.g. "AWS access key ID pattern"
      file: v.optional(v.string()),
      remediation: v.string(),
      createdAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userRepo", ["userId", "repo"])
      .index("by_userKey", ["userId", "key"]),

    // Dependency intelligence reports (Phase 3): per-package scan results
    // (installed vs latest from the npm registry, OSV advisory hits). The
    // security center renders these; upgrades are proposed, never applied.
    dependencyReports: defineTable({
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
      createdAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userRepo", ["userId", "repo"])
      .index("by_userKey", ["userId", "key"]),

    // Flight recorder (Phase 3): one record per significant AI operation —
    // mission, user request, plan summary, files inspected/modified, commands
    // run, tests, approvals, result. Never stores model chain-of-thought or
    // secrets.
    flightRecords: defineTable({
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
      createdAt: v.number(),
    }).index("by_userId", ["userId"]),

    // Aria health (Phase 3): the latest explainable repo health score per
    // category (architecture, security, testing, dependencies, docs, CI/CD,
    // maintainability). Every score carries the evidence that produced it;
    // a category with no evidence is simply absent, never a fabricated zero.
    repoHealth: defineTable({
      userId: v.id("users"),
      repo: v.string(),
      scores: v.record(v.string(), v.number()),
      evidence: v.record(v.string(), v.array(v.string())),
      updatedAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userRepo", ["userId", "repo"]),

    // Organizations (Phase 4): a tenant that groups users with roles so
    // teams can share rules, approvals, and missions. Authorization is
    // enforced server-side — membership is checked before any org-scoped
    // data is read or written.
    organizations: defineTable({
      name: v.string(),
      slug: v.string(), // unique, used in shareable links
      ownerId: v.id("users"),
      createdAt: v.number(),
    }).index("by_slug", ["slug"]).index("by_owner", ["ownerId"]),

    // Org membership with a role ladder (owner > admin > developer >
    // reviewer > viewer). One row per (org, user).
    orgMembers: defineTable({
      orgId: v.id("organizations"),
      userId: v.id("users"),
      role: v.union(
        v.literal("owner"),
        v.literal("admin"),
        v.literal("developer"),
        v.literal("reviewer"),
        v.literal("viewer"),
      ),
      invitedBy: v.optional(v.id("users")),
      createdAt: v.number(),
    })
      .index("by_org", ["orgId"])
      .index("by_user", ["userId"])
      .index("by_orgUser", ["orgId", "userId"]),

    // Approval policies (Phase 4): configurable, server-authoritative
    // requirements for sensitive actions (deploy, protected branches,
    // dependency upgrades, DB migrations, high-risk AI). A matched policy
    // is enforced at the action layer — never by hiding buttons.
    approvalPolicies: defineTable({
      orgId: v.id("organizations"),
      action: v.union(
        v.literal("deploy"),
        v.literal("protected_branch"),
        v.literal("dependency_upgrade"),
        v.literal("database_migration"),
        v.literal("high_risk_ai"),
      ),
      branchGlob: v.string(), // "" = all branches
      minRole: v.union(
        v.literal("owner"),
        v.literal("admin"),
        v.literal("developer"),
        v.literal("reviewer"),
        v.literal("viewer"),
      ),
      minApprovers: v.number(),
      pathGlobs: v.array(v.string()),
      createdBy: v.id("users"),
      updatedAt: v.number(),
    }).index("by_org", ["orgId"]),

    // Webhook idempotency (Phase 4): which provider events have already been
    // processed, so Stripe retries/replays can never double-apply a plan
    // change. Keyed by (provider, eventId).
    processedEvents: defineTable({
      provider: v.string(), // "stripe"
      eventId: v.string(),
      processedAt: v.number(),
    })
      .index("by_event", ["provider", "eventId"])
      .index("by_processedAt", ["processedAt"]),

    // Plugin registry (Phase 4): declarative plugin manifests with declared
    // capabilities, per-user grants, a privacy statement, and a lifecycle
    // status. The runtime gates every capability server-side; plugins never
    // receive GitHub tokens, secrets, or private-repo data implicitly.
    plugins: defineTable({
      userId: v.id("users"),
      slug: v.string(), // unique per user
      name: v.string(),
      version: v.string(),
      description: v.string(),
      author: v.string(),
      declaredCapabilities: v.array(v.string()),
      grantedCapabilities: v.array(v.string()),
      privacyStatement: v.string(),
      status: v.union(
        v.literal("installed"),
        v.literal("disabled"),
        v.literal("uninstalled"),
      ),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_userSlug", ["userId", "slug"]),

    // Notification preferences (Phase 4): which channels (email / web push)
    // and categories each user wants. Honored by the notification layer;
    // absent row = all channels on (backwards compatible).
    notificationPrefs: defineTable({
      userId: v.id("users"),
      email: v.boolean(),
      push: v.boolean(),
      categories: v.array(v.string()), // e.g. ["review", "security", "ci"]
      updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    // AI in-flight guard (Phase 4 M): one row per user while an AI request
    // is running, so concurrent duplicate submissions can't double-fire a
    // paid AI call. Rows are acquired server-side with a short TTL and
    // released on completion — a stale row can never block a user forever.
    aiInflight: defineTable({
      userId: v.id("users"),
      updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    // Action approvals (Phase 4 C): one row per (org, action, branch, user)
    // recording that a member with sufficient role approved the action.
    // The count of distinct approvers is what gates sensitive actions —
    // server-authoritative, independent of any UI.
    actionApprovals: defineTable({
      orgId: v.id("organizations"),
      action: v.string(), // e.g. "deploy" | "protected_branch" | "dependency_upgrade"
      branch: v.string(),
      approvedBy: v.id("users"),
      approvedAt: v.number(),
    }).index("by_orgAction", ["orgId", "action", "branch"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
