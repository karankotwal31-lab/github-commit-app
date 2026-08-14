import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled jobs — run 24×7 on the Convex cloud (independent of the Freebuff
 * dev/preview environment, and independent of whether any tab is open).
 *
 * Every 10 minutes, check each user with a push subscription for new inbox
 * items (PRs awaiting review, assigned issues) and push them. The check is
 * cheap (a handful of GitHub API calls per subscribed user) and deduped per
 * item, so idle users cost nothing beyond the query.
 */
const crons = cronJobs();

crons.interval(
  "push-notification-checks",
  { minutes: 10 },
  internal.notifications.checkAllPush,
);

export default crons;
