import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Check, X, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface Proposal {
  resolution: string;
  rationale: string;
}

/**
 * Per-hunk AI resolution proposal. Calls the metered aiResolveConflict action
 * and shows the proposed resolution + rationale. Proposes only — the developer
 * explicitly applies it (never auto-applied).
 */
export function AiConflictProposal({
  path,
  base,
  ours,
  theirs,
  onApply,
  onDismiss,
}: {
  path: string;
  base: string;
  ours: string;
  theirs: string;
  onApply: (resolution: string) => void;
  onDismiss: () => void;
}) {
  const resolveConflict = useAction(api.aiActions.aiResolveConflict);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const ask = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      const result = await resolveConflict({ path, base, ours, theirs });
      setProposal(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ask Aria failed — try again.");
    } finally {
      setLoading(false);
    }
  }, [resolveConflict, path, base, ours, theirs]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-neutral-500">
        <Loader2 className="size-3 animate-spin text-teal-600" />
        Aria is proposing a resolution…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        <span className="min-w-0 flex-1">{error}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-[10px]"
          onClick={() => {
            setError(null);
            void ask();
          }}
        >
          Retry
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-amber-500 hover:text-amber-700"
          aria-label="Dismiss"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="border-t border-neutral-200 bg-neutral-50 px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 text-[10px]"
          onClick={() => void ask()}
        >
          <Sparkles className="mr-1 size-3 text-teal-600" />
          Ask Aria to resolve this conflict
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-teal-200 bg-teal-50/60">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-teal-700">
          <Lightbulb className="size-3" />
          Aria's proposal — review before applying
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-neutral-400 hover:text-neutral-600"
          aria-label="Dismiss proposal"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <pre
        className={cn(
          "mx-3 mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-teal-200 bg-white p-2 font-mono text-[11px] leading-5 text-neutral-800",
        )}
      >
        {proposal.resolution}
      </pre>
      {proposal.rationale && (
        <p className="px-3 py-1.5 text-[11px] leading-4 text-teal-900/80">
          {proposal.rationale}
        </p>
      )}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <Button
          type="button"
          size="sm"
          className="h-6 text-[10px]"
          onClick={() => onApply(proposal.resolution)}
        >
          <Check className="mr-1 size-3" />
          Apply proposal
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => setProposal(null)}
        >
          Regenerate
        </Button>
      </div>
    </div>
  );
}
