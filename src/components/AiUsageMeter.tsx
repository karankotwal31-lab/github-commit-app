import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Ask Aria usage meter — queries its own metering data (no prop drilling).
 * Shows "X of Y" for quota'd plans, "Unlimited" for Team/Enterprise (or any
 * plan while billing is unconfigured), and an upgrade CTA when exhausted.
 */
export function AiUsageMeter({ onUpgrade }: { onUpgrade?: () => void }) {
  const usage = useQuery(api.aiUsage.getAiUsage);
  if (!usage) return null;
  const { quota, used } = usage;
  if (quota === null) {
    return (
      <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2">
        <span className="text-xs font-medium text-neutral-700">
          Ask Aria this month
        </span>
        <span className="text-xs text-neutral-500">Unlimited</span>
      </div>
    );
  }
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const exhausted = used >= quota;
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-700">
          Ask Aria this month
        </span>
        <span
          className={
            exhausted
              ? "text-xs font-medium text-rose-600"
              : "text-xs text-neutral-500"
          }
        >
          {used.toLocaleString()} of {quota.toLocaleString()}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-200">
        <div
          className={`h-full rounded-full transition-all ${
            exhausted ? "bg-rose-500" : "bg-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {exhausted && onUpgrade && (
        <button
          type="button"
          onClick={onUpgrade}
          className="mt-2 w-full rounded-md bg-neutral-900 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700"
        >
          Upgrade for more requests
        </button>
      )}
    </div>
  );
}
