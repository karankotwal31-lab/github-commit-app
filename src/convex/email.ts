import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalAction,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, type GenericId } from "convex/values";
import { fetchWithRetry } from "./net";

/**
 * Email notifications (Resend) — fail-open.
 *
 * The open-app poll and the 24×7 cron find new inbox items (PRs awaiting
 * review, assigned issues). Push notifications cover those with a subscribed
 * device; this module adds an email fallback so a user with an email on file
 * still hears about new items with no tab open. One digest email per check
 * (all new items at once), deduped with the same sentNotifications keys as
 * push, gated to Pro plans exactly like the inbox itself.
 *
 * Env vars (project keys):
 *   - RESEND_API_KEY — required to send. Without it everything is a no-op.
 *   - RESEND_FROM — optional "Name <email@yourdomain.com>" sender. Defaults
 *     to Resend's onboarding@resend.dev test sender, which works immediately
 *     but only delivers to the account owner until a domain is verified in
 *     Resend and RESEND_FROM points at it.
 */

const RESEND_API = "https://api.resend.com";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export function fromAddress(): string {
  return process.env.RESEND_FROM ?? "Aria <onboarding@resend.dev>";
}

/**
 * Users who can receive notification emails (non-anonymous, email on file).
 * Declared before emailStatus so the query below can type its runQuery
 * result without a circular inference (which would degrade every other
 * Convex return type in the module to `any`).
 */
export const userEmails = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ userId: GenericId<"users">; email: string }>> => {
    const rows = await ctx.db.query("users").collect();
    return rows
      .filter(
        (u) =>
          typeof u.email === "string" &&
          u.email.trim().length > 0 &&
          !u.isAnonymous,
      )
      .map((u) => ({
        userId: u._id as GenericId<"users">,
        email: (u.email as string).trim().slice(0, 254),
      }));
  },
});

/** Signed-in user's view of the email notification setup. */
export const emailStatus = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    | { signedIn: false }
    | {
        signedIn: true;
        configured: boolean;
        from: string;
        onFile: boolean;
        email: string | null;
      }
  > => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { signedIn: false };
    const users = await ctx.runQuery(internal.email.userEmails);
    const me = users.find((u) => u.userId === userId);
    return {
      signedIn: true,
      configured: emailConfigured(),
      from: fromAddress(),
      onFile: !!me,
      email: me?.email ?? null,
    };
  },
});

/** Send one digest email listing the user's new inbox items. Never throws. */
export const sendInboxDigest = internalAction({
  args: {
    userId: v.id("users"),
    items: v.array(
      v.object({
        title: v.string(),
        body: v.string(),
        url: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    if (!emailConfigured()) return { sent: false, reason: "no key" };
    const users = await ctx.runQuery(internal.email.userEmails);
    const user = users.find((u) => u.userId === args.userId);
    if (!user) return { sent: false, reason: "no email on file" };

    const items = args.items.slice(0, 20);
    const lines = items
      .map(
        (i, idx) =>
          `${idx + 1}. ${i.title.slice(0, 120)}\n   ${i.body.slice(0, 160)}\n   ${i.url.slice(0, 200)}`,
      )
      .join("\n\n");
    const text =
      `You have ${items.length} new update${
        items.length === 1 ? "" : "s"
      } in Aria:\n\n${lines}\n\n— Aria`;
    const html =
      `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">` +
      `<p style="font-size:15px;line-height:1.6">You have <strong>${items.length}</strong> new update${
        items.length === 1 ? "" : "s"
      } in Aria:</p>` +
      `<ul style="font-size:14px;line-height:1.6;padding-left:20px">` +
      items
        .map(
          (i) =>
            `<li><a href="${escapeHtml(i.url)}" style="color:#171717">${escapeHtml(
              i.title.slice(0, 120),
            )}</a><br/><span style="color:#525252">${escapeHtml(
              i.body.slice(0, 160),
            )}</span></li>`,
        )
        .join("") +
      `</ul><p style="color:#737373;font-size:12px">— Aria</p></div>`;

    try {
      const res = await fetchWithRetry(
        `${RESEND_API}/emails`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.RESEND_API_KEY as string}`,
          },
          body: JSON.stringify({
            from: fromAddress(),
            to: [user.email],
            subject: `Aria — ${items.length} new update${
              items.length === 1 ? "" : "s"
            } for you`,
            text,
            html,
          }),
        },
        { attempts: 2 },
      );
      if (!res.ok) {
        return { sent: false, reason: `HTTP ${res.status}` };
      }
      return { sent: true };
    } catch {
      return { sent: false, reason: "network failure" };
    }
  },
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
