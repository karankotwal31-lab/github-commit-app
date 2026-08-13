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
  },
  {
    schemaValidation: false,
  },
);

export default schema;
