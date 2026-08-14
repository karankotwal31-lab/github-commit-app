import { mutation } from "./_generated/server";

/**
 * Diagnostics: trivial server round-trip for the in-app stress test. The
 * client measures elapsed time around this call to get true Convex latency
 * (network + function runtime), then bursts it to simulate load.
 */
export const ping = mutation({
  args: {},
  handler: async () => {
    return { serverTime: Date.now() };
  },
});
