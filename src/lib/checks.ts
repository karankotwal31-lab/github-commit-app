export function summarizeChecks(
  checks: Array<{ status: string; conclusion: string | null }>,
  contexts: Array<{ state: string }>,
): "none" | "pending" | "failure" | "success" {
  if (!checks.length && !contexts.length) return "none";
  if (contexts.some(c => ["failure", "error"].includes(c.state)) ||
      checks.some(c => ["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(c.conclusion ?? ""))) return "failure";
  if (contexts.some(c => c.state !== "success") || checks.some(c =>
    c.status !== "completed" || !["success", "neutral", "skipped"].includes(c.conclusion ?? ""))) return "pending";
  return "success";
}
