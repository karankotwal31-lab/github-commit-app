"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, type GenericId } from "convex/values";
import webpush from "web-push";
import { emailConfigured } from "./email";
import { notificationDelivered } from "../lib/notificationDelivery";

/**
 * Web push delivery — self-hosted over the standard Web Push protocol
 * (browsers deliver via their own push service: FCM, Apple, Mozilla). No
 * third-party account or per-message cost, so 24×7 operation stays cheap.
 *
 * Subscription storage lives in pushSubscriptions.ts (default runtime);
 * this file is "use node" because the web-push library needs Node.
 *
 * Flow: the client stores its PushSubscription → a periodic check (the open
 * app polls every few minutes; the Convex cron covers closed tabs) runs the
 * user's inbox (PRs awaiting review, assigned issues) and pushes anything
 * new, deduped per item via `sentNotifications`.
 *
 * Env vars (set in project keys): VAPID_PUBLIC_KEY (also baked into the
 * client) and VAPID_PRIVATE_KEY. Without them everything degrades to no-ops.
 */

const VAPID_SUBJECT = "mailto:notify@arialabs.dev";

function pushConfigured(): boolean {
  return !!(process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY);
}

function vapidDetails() {
  return {
    subject: VAPID_SUBJECT,
    publicKey: process.env.VAPID_PUBLIC_KEY as string,
    privateKey: process.env.VAPID_PRIVATE_KEY as string,
  };
}

/**
 * Send one notification to every device subscribed by a user; prune any
 * subscription the push service reports dead (404/410 — endpoint expired).
 */
export const sendPushToUser = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    tag: v.optional(v.string()),
    // "review" notifications carry Approve/Comment/Merge actions on the
    // notification itself; "assign" ones just open the item.
    kind: v.optional(v.union(v.literal("review"), v.literal("assign"))),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    if (!pushConfigured()) return { sent: 0 };
    const subs = await ctx.runQuery(internal.pushSubscriptions.subsForUser, {
      userId: args.userId,
    });
    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          },
          JSON.stringify({
            title: args.title,
            body: args.body,
            url: args.url,
            tag: args.tag ?? "aria",
            kind: args.kind ?? "assign",
          }),
          { vapidDetails: vapidDetails(), TTL: 60 * 60 },
        );
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await ctx.runMutation(internal.pushSubscriptions.pruneSubscription, {
            endpoint: sub.endpoint,
          });
        }
        // Other failures (network, quota) are retried on the next check.
      }
    }
    return { sent };
  },
});

/**
 * The per-user check: fetch their inbox, notify anything not yet notified —
 * push to subscribed devices and, when email is configured and the user has
 * an email on file, one digest email per check. Used by the open-app poll
 * (checkNotifications) and by the 24×7 cron (checkAllPush) so closed tabs
 * still get alerts.
 */
export const checkForUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const userId = args.userId;
    const hasPush = pushConfigured();
    const hasEmail = emailConfigured();
    if (!hasPush && !hasEmail) return { sent: 0 };

    // Phase 4 G: honor per-user notification preferences. Absent prefs =
    // everything on (backwards compatible).
    const prefs = await ctx
      .runQuery(internal.pushSubscriptions.internalNotificationPrefs, { userId })
      .catch(() => null);
    const emailOn = prefs?.email ?? true;
    const pushOn = prefs?.push ?? true;
    const cats = prefs?.categories ?? [];
    const categoryOn = (kind: string) =>
      cats.length === 0 || cats.includes(kind);
    if (!pushOn && !emailOn) return { sent: 0 };

    const subs =
      hasPush && pushOn
        ? await ctx.runQuery(internal.pushSubscriptions.subsForUser, { userId })
        : [];
    if (subs.length === 0 && !(hasEmail && emailOn)) return { sent: 0 };

    // The inbox is Pro-gated; free users simply get nothing notified.
    let inbox: {
      awaitingReview: Array<{
        repo: string;
        number: number;
        title: string;
        htmlUrl: string;
      }>;
      assigned: Array<{
        repo: string;
        number: number;
        title: string;
        htmlUrl: string;
        isPr: boolean;
      }>;
    } | null = null;
    try {
      inbox = await ctx.runAction(internal.githubActions.getInboxForUser, {
        userId,
      });
    } catch {
      return { sent: 0 };
    }
    if (inbox === null) return { sent: 0 };

    const items: Array<{
      key: string;
      title: string;
      body: string;
      url: string;
      kind: "review" | "assign";
    }> = [];
    for (const pr of inbox.awaitingReview) {
      items.push({
        key: `review:${pr.repo}#${pr.number}`,
        title: pr.title,
        body: `${pr.repo} · PR #${pr.number} is waiting on your review`,
        url: pr.htmlUrl,
        kind: "review",
      });
    }
    for (const item of inbox.assigned) {
      items.push({
        key: `assign:${item.repo}#${item.number}`,
        title: item.title,
        body: `${item.repo} · ${item.isPr ? "PR" : "issue"} #${item.number} assigned to you`,
        url: item.htmlUrl,
        kind: "assign",
      });
    }

    type PendingDelivery = {
      key: string;
      pushDelivered: boolean;
      emailItem: { title: string; body: string; url: string };
    };

    const pending: PendingDelivery[] = [];
    for (const item of items) {
      if (!categoryOn(item.kind)) continue;

      const seen = await ctx.runQuery(internal.pushSubscriptions.wasSent, {
        userId,
        key: item.key,
      });
      if (seen) continue;

      let pushDelivered = false;
      if (subs.length > 0 && pushOn) {
        try {
          const result = await ctx.runAction(
            internal.notifications.sendPushToUser,
            {
              userId,
              title: item.title.slice(0, 80),
              body: item.body.slice(0, 140),
              url: item.url,
              tag: item.key,
              kind: item.kind,
            },
          );
          pushDelivered = result.sent > 0;
        } catch (e) {
          await ctx
            .runMutation(internal.security.logError, {
              source: "push",
              message:
                e instanceof Error
                  ? e.message.slice(0, 300)
                  : "push delivery failed",
              userId,
            })
            .catch(() => {});
        }
      }

      pending.push({
        key: item.key,
        pushDelivered,
        emailItem: {
          title: item.title.slice(0, 120),
          body: item.body.slice(0, 160),
          url: item.url.slice(0, 200),
        },
      });
    }

    let emailDelivered = false;
    if (pending.length > 0 && hasEmail && emailOn) {
      try {
        const result = await ctx.runAction(internal.email.sendInboxDigest, {
          userId,
          items: pending.map((item) => item.emailItem),
        });
        emailDelivered = result.sent;
        if (!result.sent && result.reason) {
          await ctx
            .runMutation(internal.security.logError, {
              source: "email",
              message: `email digest not delivered: ${result.reason}`.slice(0, 300),
              userId,
            })
            .catch(() => {});
        }
      } catch (e) {
        await ctx
          .runMutation(internal.security.logError, {
            source: "email",
            message:
              e instanceof Error
                ? e.message.slice(0, 300)
                : "email digest failed",
            userId,
          })
          .catch(() => {});
      }
    }

    let sent = 0;
    for (const item of pending) {
      if (!notificationDelivered(item.pushDelivered, emailDelivered)) continue;
      try {
        await ctx.runMutation(internal.pushSubscriptions.markSent, {
          userId,
          key: item.key,
        });
        sent += 1;
      } catch (e) {
        // Delivery happened, but dedupe acknowledgement failed. Leave the item
        // retryable rather than claiming success; a duplicate is safer than a
        // permanently lost notification.
        await ctx
          .runMutation(internal.security.logError, {
            source: "notification-dedupe",
            message:
              e instanceof Error
                ? e.message.slice(0, 300)
                : "notification acknowledgement failed",
            userId,
          })
          .catch(() => {});
      }
    }

    return { sent };
  },
});

/** Open-app poll: run the check for the signed-in user. */
export const checkNotifications = action({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { sent: 0 };
    return ctx.runAction(internal.notifications.checkForUser, { userId });
  },
});

/**
 * Cron entry: check every user who can be notified (push subscription or an
 * email on file) — runs 24×7 on the Convex cloud. Email-only users are
 * covered too, so notifications don't depend on having a subscribed device.
 */
export const checkAllPush = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    const hasPush = pushConfigured();
    const hasEmail = emailConfigured();
    if (!hasPush && !hasEmail) return { checked: 0 };
    const pushUsers = hasPush
      ? await ctx.runQuery(
          internal.pushSubscriptions.usersWithSubscriptions,
        )
      : [];
    const emailUsers = hasEmail
      ? await ctx.runQuery(internal.email.userEmails)
      : [];
    const users = [
      ...new Set([
        ...pushUsers,
        ...emailUsers.map((u) => u.userId),
      ]),
    ] as Array<GenericId<"users">>;
    let checked = 0;
    for (const userId of users) {
      try {
        await ctx.runAction(internal.notifications.checkForUser, { userId });
        checked += 1;
      } catch (e) {
        await ctx
          .runMutation(internal.security.logError, {
            source: "push",
            message:
              e instanceof Error
                ? e.message.slice(0, 300)
                : "push check failed",
            userId,
          })
          .catch(() => {});
      }
    }
    return { checked };
  },
});
