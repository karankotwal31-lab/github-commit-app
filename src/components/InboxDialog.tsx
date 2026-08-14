import { useEffect, useState } from "react";
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
  CheckCircle2,
  CircleDashed,
  GitPullRequest,
  Inbox,
  Loader2,
  XCircle,
} from "lucide-react";

interface InboxPr {
  repo: string;
  number: number;
  title: string;
  htmlUrl: string;
  ci: "success" | "failure" | "pending" | "unknown";
  updatedAt: string | null;
}

interface InboxAssigned {
  repo: string;
  number: number;
  title: string;
  htmlUrl: string;
  isPr: boolean;
  updatedAt: string | null;
}

function CiDot({ ci }: { ci: InboxPr["ci"] }) {
  if (ci === "success") {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />;
  }
  if (ci === "failure") {
    return <XCircle className="size-3.5 shrink-0 text-rose-500" />;
  }
  if (ci === "pending") {
    return <CircleDashed className="size-3.5 shrink-0 text-amber-500" />;
  }
  return <CircleDashed className="size-3.5 shrink-0 text-neutral-300" />;
}

function Row({
  repo,
  number,
  title,
  htmlUrl,
  isPr,
  ci,
}: {
  repo: string;
  number: number;
  title: string;
  htmlUrl: string;
  isPr: boolean;
  ci?: InboxPr["ci"];
}) {
  return (
    <a
      href={htmlUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-neutral-50"
    >
      {ci ? (
        <CiDot ci={ci} />
      ) : isPr ? (
        <GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
      ) : (
        <Inbox className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-800 group-hover:text-neutral-950">
          {title}
        </span>
        <span className="mt-0.5 block truncate font-mono text-xs text-neutral-400">
          {repo} #{number}
          {ci === "failure" && (
            <span className="ml-2 text-rose-500">CI failing</span>
          )}
        </span>
      </span>
    </a>
  );
}

/**
 * Unified cross-repo inbox (Pro): PRs awaiting review and issues assigned to
 * the user, aggregated across every repo/org — one feed instead of digging
 * per repo. Items open on GitHub.
 */
export function InboxDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const plan = useQuery(api.billing.plan);
  const getInbox = useAction(api.githubActions.getInbox);
  const [data, setData] = useState<{
    awaitingReview: InboxPr[];
    assigned: InboxAssigned[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFree = plan?.configured && plan.plan === "free";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getInbox();
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, getInbox]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="size-4 text-neutral-500" />
            Inbox
          </DialogTitle>
          <DialogDescription>
            Across every repo you can access — PRs waiting on your review and
            issues assigned to you.
          </DialogDescription>
        </DialogHeader>

        {isFree ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
            The unified inbox is a Pro feature — upgrade to see activity across
            all your repositories.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
            <Loader2 className="size-4 animate-spin" /> Gathering across repos…
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        ) : data ? (
          <div className="flex flex-col gap-5">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                <GitPullRequest className="size-3.5" />
                Awaiting your review
              </p>
              <div className="mt-2 flex flex-col">
                {data.awaitingReview.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-neutral-400">
                    Nothing waiting — you're all caught up.
                  </p>
                ) : (
                  data.awaitingReview.map((pr) => (
                    <Row
                      key={`${pr.repo}#${pr.number}`}
                      repo={pr.repo}
                      number={pr.number}
                      title={pr.title}
                      htmlUrl={pr.htmlUrl}
                      isPr
                      ci={pr.ci}
                    />
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                <Inbox className="size-3.5" />
                Assigned to you
              </p>
              <div className="mt-2 flex flex-col">
                {data.assigned.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-neutral-400">
                    No open items assigned to you.
                  </p>
                ) : (
                  data.assigned.map((item) => (
                    <Row
                      key={`${item.repo}#${item.number}`}
                      repo={item.repo}
                      number={item.number}
                      title={item.title}
                      htmlUrl={item.htmlUrl}
                      isPr={item.isPr}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        {!isFree && !loading && !error && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                setData(await getInbox());
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setLoading(false);
              }
            }}
          >
            <Loader2 className="size-3.5" />
            Refresh
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
