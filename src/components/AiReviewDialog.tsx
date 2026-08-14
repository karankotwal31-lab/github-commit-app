import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { errorMessage } from "@/lib/github";
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  ScanSearch,
  Sparkles,
} from "lucide-react";

interface ReviewResult {
  review: string;
  risks: string[];
  prTitle: string;
  prBody: string;
  stats: {
    aheadBy: number;
    files: number;
    addedLines: number;
    deletedLines: number;
  };
}

/**
 * AI review pass (Pro+): diffs the current branch against a base and returns
 * a grounded review, risk flags, and a ready-to-use PR title/description.
 * Never auto-applied — the developer decides what to do with it.
 */
export function AiReviewDialog({
  open,
  onOpenChange,
  owner,
  repo,
  branch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  branch: string;
}) {
  const plan = useQuery(api.billing.plan);
  const aiReview = useAction(api.aiActions.aiReviewBranch);
  const [base, setBase] = useState("main");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"title" | "body" | null>(null);

  const isBelowProPlus =
    plan?.configured && (plan.plan === "free" || plan.plan === "pro");

  const run = async () => {
    if (!owner || !repo || !branch || !base.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await aiReview({
        owner,
        repo,
        branch,
        base: base.trim(),
      });
      setResult(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async (kind: "title" | "body", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard blocked — user can select the text manually.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="size-4 text-neutral-500" />
            AI review
          </DialogTitle>
          <DialogDescription>
            Review the current branch before you push — with risk flags and a
            ready-to-use pull request description. Nothing is changed or
            committed; you decide.
          </DialogDescription>
        </DialogHeader>

        {isBelowProPlus ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
            AI review is a Pro+ feature — upgrade to review branches before you
            push.
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="text-xs font-medium text-neutral-500">
                  Base branch to compare against
                </span>
                <input
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  spellCheck={false}
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-background px-3 py-2 font-mono text-sm text-neutral-900 outline-none focus:border-neutral-400"
                />
              </label>
              <Button
                type="button"
                className="gap-1.5"
                onClick={run}
                disabled={loading || !branch || !base.trim()}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Review
              </Button>
            </div>
            <p className="font-mono text-xs text-neutral-400">
              {owner}/{repo} · {branch} vs {base || "main"}
            </p>

            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}

            {result && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2 text-xs text-neutral-500">
                  <span>{result.stats.aheadBy} commits</span>
                  <span>{result.stats.files} files</span>
                  <span className="text-emerald-600">
                    +{result.stats.addedLines}
                  </span>
                  <span className="text-rose-500">
                    −{result.stats.deletedLines}
                  </span>
                </div>

                {result.risks.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                      <AlertTriangle className="size-3.5" /> Risks
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {result.risks.map((r) => (
                        <li
                          key={r}
                          className="flex items-start gap-1.5 text-xs leading-4 text-amber-800"
                        >
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                    Review
                  </p>
                  <p className="mt-1 text-sm leading-6 text-neutral-700">
                    {result.review || "No review summary returned."}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                      PR title
                    </p>
                    <button
                      type="button"
                      onClick={() => copy("title", result.prTitle)}
                      className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-900"
                    >
                      {copied === "title" ? (
                        <Check className="size-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      Copy
                    </button>
                  </div>
                  <p className="mt-1 rounded-md border border-neutral-200 px-3 py-2 font-mono text-sm text-neutral-900">
                    {result.prTitle || "—"}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                      PR description
                    </p>
                    <button
                      type="button"
                      onClick={() => copy("body", result.prBody)}
                      className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-900"
                    >
                      {copied === "body" ? (
                        <Check className="size-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      Copy
                    </button>
                  </div>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-200 px-3 py-2 text-xs leading-5 text-neutral-600">
                    {result.prBody || "—"}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
