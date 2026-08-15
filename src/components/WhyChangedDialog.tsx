import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { errorMessage } from "@/lib/github";
import {
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequest,
  HelpCircle,
  Loader2,
  Sparkles,
} from "lucide-react";

interface WhyResult {
  explanation: string;
  commits: Array<{ sha: string; message: string; htmlUrl: string }>;
  prs: Array<{ number: number; title: string; htmlUrl: string }>;
}

/**
 * "Why did this change?" — click a file (optionally a line) and Aria explains
 * the change in plain language, grounded ONLY in the real commit history and
 * pull-request text for that path. If the record doesn't explain it, the
 * model says so instead of guessing. Metered against the plan's AI quota.
 */
export function WhyChangedDialog({
  open,
  onOpenChange,
  owner,
  repo,
  branch,
  path,
  line,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  line?: number | null;
}) {
  const whyChanged = useAction(api.aiActions.aiWhyChanged);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WhyResult | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    const run = async () => {
      try {
        const data = await whyChanged({
          owner,
          repo,
          path,
          branch,
          line: line ?? undefined,
        });
        if (!cancelled) setResult(data);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, owner, repo, path, branch, line, whyChanged]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="size-4 text-neutral-500" />
            Why was this changed?
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-mono text-xs text-neutral-500">
            {owner}/{repo} · {path}
            {line ? ` :${line}` : ""}
          </p>
          <span className="shrink-0 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
            {branch}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
            <Loader2 className="size-4 animate-spin" />
            Reading commit history and pull requests…
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        ) : result ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <p className="text-sm leading-6 text-neutral-800">
                {result.explanation}
              </p>
            </div>

            {result.commits.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                  <GitCommitHorizontal className="size-3.5" />
                  Grounded in
                </p>
                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                  {result.commits.slice(0, 6).map((c) => (
                    <li
                      key={c.sha}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <span className="shrink-0 font-mono text-[10px] text-neutral-400">
                        {c.sha.slice(0, 7)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-700">
                        {c.message}
                      </span>
                      <a
                        href={c.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-neutral-400 hover:text-neutral-900"
                        title="Open commit on GitHub"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.prs.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                  <GitPullRequest className="size-3.5" />
                  Related pull requests
                </p>
                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                  {result.prs.slice(0, 4).map((pr) => (
                    <li
                      key={pr.number}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-700">
                        #{pr.number} · {pr.title}
                      </span>
                      <a
                        href={pr.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-neutral-400 hover:text-neutral-900"
                        title="Open PR on GitHub"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="flex items-start gap-1.5 text-[11px] leading-4 text-neutral-400">
              <Sparkles className="mt-0.5 size-3 shrink-0" />
              Based only on the commits and pull requests above — if the record
              doesn't say why, Aria says so instead of guessing.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
