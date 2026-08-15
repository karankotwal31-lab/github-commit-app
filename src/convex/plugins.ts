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
  grantCapabilities,
  PLUGIN_CAPABILITIES,
  SENSITIVE_CAPABILITIES,
  type PluginCapability,
} from "../lib/phase4";

/**
 * Phase 4 J — Plugin registry.
 *
 * Plugins are declarative manifests persisted per user. They declare the
 * capabilities they want; the user grants a subset; the runtime gates every
 * capability server-side via the internal query. No plugin ever receives
 * GitHub tokens, secrets, or private-repo data implicitly — those are not
 * capabilities and require explicit authorization outside this system
 * (currently: none exists, so they are never available to plugins).
 */

async function currentUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("You are not signed in.");
  return userId;
}

function isCapability(value: unknown): value is PluginCapability {
  return (
    typeof value === "string" &&
    (PLUGIN_CAPABILITIES as readonly string[]).includes(value)
  );
}

export const myPlugins = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("plugins")
      .withIndex("by_user", (q) => q.eq("userId", userId as never))
      .collect();
    return rows
      .map((p) => ({
        _id: p._id,
        slug: p.slug,
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        declaredCapabilities: p.declaredCapabilities,
        grantedCapabilities: p.grantedCapabilities,
        privacyStatement: p.privacyStatement,
        status: p.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Install a plugin. `requestedCapabilities` is the intersection of what the
 * plugin declared and what the user approved — sensitive capabilities
 * (github.read, network, files) are never granted without explicit approval,
 * which this mutation models as the caller passing them in the requested
 * list (the UI shows the privacy statement first). Grants are capped and
 * validated.
 */
export const installPlugin = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    version: v.string(),
    description: v.string(),
    author: v.string(),
    declaredCapabilities: v.array(v.string()),
    requestedCapabilities: v.array(v.string()),
    privacyStatement: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const slug = cleanText(args.slug).trim().slice(0, 80);
    if (!slug) throw new Error("Plugin slug is required.");
    const name = cleanName(args.name).slice(0, 80) || "Unnamed plugin";
    const version = cleanText(args.version).trim().slice(0, 40) || "0.0.0";
    const description = cleanText(args.description).trim().slice(0, 400);
    const author = cleanText(args.author).trim().slice(0, 120) || "Unknown";
    const privacyStatement = cleanText(args.privacyStatement).trim().slice(
      0,
      1200,
    );
    if (!privacyStatement) {
      throw new Error("Plugins must declare a privacy statement.");
    }
    const declared = args.declaredCapabilities
      .filter(isCapability)
      .slice(0, PLUGIN_CAPABILITIES.length);
    const requested = args.requestedCapabilities
      .filter(isCapability)
      .slice(0, PLUGIN_CAPABILITIES.length);
    const granted = grantCapabilities(declared, requested);

    const existing = await ctx.db
      .query("plugins")
      .withIndex("by_userSlug", (q) =>
        q.eq("userId", userId as never).eq("slug", slug),
      )
      .unique();
    if (existing) {
      throw new Error("You already have a plugin with this slug.");
    }
    await ctx.db.insert("plugins", {
      userId,
      slug,
      name,
      version,
      description,
      author,
      declaredCapabilities: declared,
      grantedCapabilities: granted,
      privacyStatement,
      status: "installed",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "plugin.install",
      resource: `plugin:${slug}`,
      result: "ok",
      detail: `granted: ${granted.join(", ") || "none"}`,
      createdAt: Date.now(),
    });
    return granted;
  },
});

/** Enable/disable a plugin or change its granted capabilities. */
export const updatePlugin = mutation({
  args: {
    pluginId: v.id("plugins"),
    enabled: v.optional(v.boolean()),
    grantedCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const plugin = await ctx.db.get(args.pluginId);
    if (!plugin || plugin.userId !== userId) {
      throw new Error("Plugin not found.");
    }
    const granted = args.grantedCapabilities
      ? grantCapabilities(
          plugin.declaredCapabilities as PluginCapability[],
          args.grantedCapabilities.filter(isCapability),
        )
      : plugin.grantedCapabilities;
    // Re-enabling from "disabled" back to "installed" is allowed; enabling
    // never re-grants capabilities beyond what is already granted.
    const status =
      args.enabled === false
        ? "disabled"
        : args.enabled === true
          ? "installed"
          : plugin.status;
    await ctx.db.patch(plugin._id, {
      status,
      grantedCapabilities: granted,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "plugin.update",
      resource: `plugin:${plugin.slug}`,
      result: "ok",
      detail: `status: ${status}; granted: ${granted.join(", ") || "none"}`,
      createdAt: Date.now(),
    });
  },
});

export const uninstallPlugin = mutation({
  args: { pluginId: v.id("plugins") },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const plugin = await ctx.db.get(args.pluginId);
    if (!plugin || plugin.userId !== userId) {
      throw new Error("Plugin not found.");
    }
    await ctx.db.delete(plugin._id);
    await ctx.db.insert("auditLogs", {
      userId,
      action: "plugin.uninstall",
      resource: `plugin:${plugin.slug}`,
      result: "ok",
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Internal gating (server-side): what may this plugin do?
// ---------------------------------------------------------------------------

/** Internal: the granted capabilities of a user's plugin. */
export const internalPluginGrants = internalQuery({
  args: { userId: v.id("users"), slug: v.string() },
  handler: async (ctx, args) => {
    const plugin = await ctx.db
      .query("plugins")
      .withIndex("by_userSlug", (q) =>
        q.eq("userId", args.userId as never).eq("slug", args.slug),
      )
      .unique();
    if (!plugin || plugin.status !== "installed") return [];
    return plugin.grantedCapabilities;
  },
});

/** Internal: does the plugin hold the given capability? */
export const internalPluginHas = internalQuery({
  args: {
    userId: v.id("users"),
    slug: v.string(),
    capability: v.string(),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.db
      .query("plugins")
      .withIndex("by_userSlug", (q) =>
        q.eq("userId", args.userId as never).eq("slug", args.slug),
      )
      .unique();
    if (!plugin || plugin.status !== "installed") return false;
    return plugin.grantedCapabilities.includes(args.capability);
  },
});

/** Internal: record a blocked plugin action in the audit log. */
export const internalBlockPluginAction = internalMutation({
  args: {
    userId: v.id("users"),
    plugin: v.string(),
    capability: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      userId: args.userId,
      action: "plugin.blocked",
      resource: `plugin:${args.plugin}`,
      result: "blocked",
      detail: `blocked ${args.capability}${args.detail ? ` — ${args.detail}` : ""}`,
      createdAt: Date.now(),
    });
  },
});

/** Sensitive capabilities that are never granted implicitly. */
export { SENSITIVE_CAPABILITIES };
