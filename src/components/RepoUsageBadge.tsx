import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Lock } from "lucide-react";

/**
 * Free-tier repo usage: shows "1/1 private repo" on the Free plan once a
 * private repo is opened, with an upgrade CTA. Hidden for paid plans and in
 * dev mode (unconfigured). Self-querying — no prop drilling.
 */
export function RepoUsageBadge({ onUpgrade }: { onUpgrade?: () => void }) {
  const usage = useQuery(api.github.repoUsage);
  if (
    !usage ||
    !usage.configured ||
    usage.plan !== "free" ||
    usage.limit === null
  ) {
    return null;
  }
  const full = usage.privateRepos >= (usage.limit ?? 1);
  return (
    <button
      type="button"
      onClick={onUpgrade}
      title="Free plan includes 1 private repository — upgrade for unlimited."
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
        full
          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          : "border-neutral-200 text-neutral-500 hover:bg-neutral-100"
      }`}
    >
      <Lock className="size-3 text-amber-600" />
      <span className="hidden sm:inline">
        {usage.privateRepos}/{usage.limit} private repo
      </span>
      {full && <span className="font-medium">Upgrade</span>}
    </button>
  );
}
