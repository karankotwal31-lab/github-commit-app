import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * AI conversation context (Phase 1): the current Ask Aria conversation,
 * persisted per user so it survives a refresh, a closed dialog, or a move to
 * another device. The frontend sends the saved turns back into `aiSuggest`
 * as `history`, so a follow-up asked from a new tab builds on the earlier
 * conversation instead of starting from scratch.
 *
 * Semantics:
 *  - one row per user (the current conversation),
 *  - turns are capped server-side (last 24, content capped to match what
 *    aiSuggest itself accepts),
 *  - saving an empty array clears the conversation ("New conversation").
 */

const MAX_TURNS = 24;
const MAX_TURN_CHARS = 2000;

const turnValidator = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
});

/** The saved conversation (empty array = none). Reactive query. */
export const getConversation = query({
  args: {},
  handler: async (ctx): Promise<Array<{ role: "user" | "assistant"; content: string }>> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const row = await ctx.db
      .query("aiConversations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (row === null) return [];
    return row.turns;
  },
});

/** Persist the current conversation (empty turns clears it). */
export const saveConversation = mutation({
  args: { turns: v.array(turnValidator) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const turns = args.turns
      .slice(-MAX_TURNS)
      .map((t) => ({
        role: t.role,
        content: t.content.slice(0, MAX_TURN_CHARS),
      }))
      .filter((t) => t.content.length > 0);
    const existing = await ctx.db
      .query("aiConversations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (turns.length === 0) {
      // "New conversation" — drop the row so a stale conversation can't
      // resurrect itself on the next load.
      if (existing !== null) await ctx.db.delete(existing._id);
      return;
    }
    if (existing !== null) {
      await ctx.db.replace(existing._id, {
        userId,
        turns,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiConversations", {
        userId,
        turns,
        updatedAt: Date.now(),
      });
    }
  },
});
