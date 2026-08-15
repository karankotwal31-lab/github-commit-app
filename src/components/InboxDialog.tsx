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
import { useAction, useMutation, useQuery } from "convex/react";
import { errorMessage } from "@/lib/github";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FileText,
  GitPullRequest,
  Inbox,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AiFinding {
  _id: string;
  kind:
    | "dependency"
    | "stale_pr"
    | "config_change"
    | "failing_ci"
    | "security"
    | "dependency_upgrade"
    | "docs"
    | "mission";
  priority: "high" | "medium" | "low";
  readAt?: number | null;
  dismissedAt?: number | null;
  repo: string;
  title: string;
  detail: string;
  url: string | null;
  createdAt: number;
}

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
  const scanRepos = useAction(api.aiFindings.scanRepos);
  const dismissFinding = useMutation(api.aiFindingsStore.dismissFinding);
  const markRead = useMutation(api.aiFindingsStore.markFindingRead);
  const findings = useQuery(api.aiFindingsStore.listFindings);
  const unread = useQuery(api.aiFindingsStore.unreadCount);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
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
            {typeof unread === "number" && unread > 0 && (
              <span className="ml-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-white">
                {unread} new
              </span>
            )}
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
            {/* Aria's background findings — scheduled scans, never auto-fixed */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                  <ShieldAlert className="size-3.5" />
                  Aria's findings
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    setScanning(true);
                    setScanNote(null);
                    try {
                      const r = await scanRepos();
                      setScanNote(
                        r.scanned === 0
                          ? "Open a repo in Aria first — nothing to scan yet."
                          : `Scanned ${r.scanned} repo${r.scanned > 1 ? "s" : ""} · ${r.findings} finding${r.findings === 1 ? "" : "s"}.`,
                      );
                    } catch (e) {
                      setScanNote(errorMessage(e));
                    } finally {
                      setScanning(false);
                    }
                  }}
                  className="flex shrink-0 items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700"
                >
                  {scanning ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  Scan now
                </button>
              </div>
              {scanNote && (
                <p
                  className={cn(
                    "mt-1 px-2 text-[11px]",
                    /Scanned/.test(scanNote)
                      ? "text-neutral-400"
                      : "text-red-600",
                  )}
                >
                  {scanNote}
                </p>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                {findings === undefined ? (
                  <p className="px-2 py-1 text-sm text-neutral-400">
                    Loading findings…
                  </p>
                ) : findings.filter((f) => !f.dismissedAt).length === 0 ? (
                  <p className="px-2 py-1 text-sm text-neutral-400">
                    No findings right now — Aria scans your repos automatically
                    and surfaces issues here for review. Nothing is ever
                    auto-fixed.
                  </p>
                ) : (
                  findings
                    .filter((f) => !f.dismissedAt)
                    .map((f) => (
                      <div
                        key={f._id}
                        className={cn(
                          "rounded-lg border p-2.5",
                          !f.readAt
                            ? "border-neutral-800 bg-neutral-50"
                            : "border-neutral-200",
                        )}
                        onMouseDown={() => {
                          if (!f.readAt) void markRead({ id: f._id });
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <FindingIcon kind={f.kind} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p
                                className={cn(
                                  "text-sm",
                                  f.readAt
                                    ? "font-normal text-neutral-700"
                                    : "font-medium text-neutral-900",
                                )}
                              >
                                {f.title}
                              </p>
                              {!f.readAt && (
                                <span className="size-1.5 shrink-0 rounded-full bg-neutral-800" />
                              )}
                            </div>
                            <p className="mt-0.5 text-xs leading-5 text-neutral-500">
                              {f.detail}
                            </p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
                                  f.priority === "high"
                                    ? "bg-rose-100 text-rose-700"
                                    : f.priority === "medium"
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-neutral-100 text-neutral-500",
                                )}
                              >
                                {f.priority}
                              </span>
                              <span className="font-mono text-[10px] text-neutral-400">
                                {f.repo}
                              </span>
                              {f.url && (
                                <a
                                  href={f.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => {
                                    if (!f.readAt) void markRead({ id: f._id });
                                  }}
                                  className="text-[10px] text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                                >
                                  Open
                                </a>
                              )}
                              <span className="text-[10px] text-neutral-300">
                                {new Date(f.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void dismissFinding({ id: f._id })}
                            className="shrink-0 rounded p-1 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700"
                            title="Dismiss (already reviewed)"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
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

function FindingIcon({ kind }: { kind: AiFinding["kind"] }) {
  const styles: Record<AiFinding["kind"], string> = {
    dependency: "text-amber-600",
    stale_pr: "text-sky-600",
    config_change: "text-red-600",
    failing_ci: "text-rose-600",
    security: "text-rose-600",
    dependency_upgrade: "text-amber-600",
    docs: "text-sky-600",
    mission: "text-emerald-600",
  };
  return (
    <span className={cn("mt-0.5 shrink-0", styles[kind])}>
      {kind === "dependency" && <AlertTriangle className="size-3.5" />}
      {kind === "stale_pr" && <GitPullRequest className="size-3.5" />}
      {kind === "config_change" && <Lock className="size-3.5" />}
      {kind === "failing_ci" && <XCircle className="size-3.5" />}
      {kind === "security" && <ShieldAlert className="size-3.5" />}
      {kind === "dependency_upgrade" && <AlertTriangle className="size-3.5" />}
      {kind === "docs" && <FileText className="size-3.5" />}
      {kind === "mission" && <CheckCircle2 className="size-3.5" />}
    </span>
  );
}
