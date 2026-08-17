import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceViewProps } from "./types";
import {
  CheckCircle2,
  CircleDot,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

type CiChecksDialogProps = Pick<
  WorkspaceViewProps,
  | "selectedRepo"
  | "currentBranch"
  | "checksOpen"
  | "setChecksOpen"
  | "checks"
  | "checksLoading"
  | "checksError"
  | "loadChecks"
>;

/** CI checks — check runs + status contexts on the branch tip. */
export function CiChecksDialog(props: CiChecksDialogProps) {
  const {
    selectedRepo,
    currentBranch,
    checksOpen,
    setChecksOpen,
    checks,
    checksLoading,
    checksError,
    loadChecks,
  } = props;

  return (
    <Dialog open={checksOpen} onOpenChange={setChecksOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>CI checks</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-mono text-xs text-neutral-500">
            {selectedRepo?.name} · {currentBranch}
            {checks?.sha ? ` · ${checks.sha.slice(0, 7)}` : ""}
          </p>
          <button
            type="button"
            onClick={loadChecks}
            className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
          >
            <RefreshCw className="size-3" />
            Refresh
          </button>
        </div>
        <div className="max-h-[24rem] overflow-auto">
          {checksLoading && !checks ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              Loading checks…
            </div>
          ) : checksError ? (
            <p className="py-6 text-center text-xs text-red-600">{checksError}</p>
          ) : checks && checks.checkRuns.length === 0 && checks.statusContexts.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">
              No checks or statuses on the tip of this branch.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {checks && checks.checkRuns.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                    Check runs
                  </p>
                  <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                    {checks.checkRuns.map((run, i) => (
                      <li key={i} className="flex items-center gap-2 px-3 py-2">
                        {run.conclusion === "success" ? (
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                        ) : run.conclusion === "failure" ||
                          run.conclusion === "timed_out" ||
                          run.conclusion === "cancelled" ||
                          run.conclusion === "action_required" ? (
                          <XCircle className="size-4 shrink-0 text-red-500" />
                        ) : run.status === "completed" ? (
                          <CircleDot className="size-4 shrink-0 text-neutral-300" />
                        ) : (
                          <Clock className="size-4 shrink-0 animate-pulse text-amber-500" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                          {run.name}
                        </span>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {run.conclusion ?? run.status}
                        </span>
                        {run.detailsUrl && (
                          <a
                            href={run.detailsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-neutral-400 hover:text-neutral-900"
                            title="Open details"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {checks && checks.statusContexts.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                    Statuses
                  </p>
                  <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                    {checks.statusContexts.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 px-3 py-2">
                        <span
                          className={`size-2 shrink-0 rounded-full ${
                            s.state === "success"
                              ? "bg-emerald-500"
                              : s.state === "failure" || s.state === "error"
                                ? "bg-red-500"
                                : s.state === "pending"
                                  ? "bg-amber-500"
                                  : "bg-neutral-300"
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                          {s.context}
                        </span>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {s.description ?? s.state}
                        </span>
                        {s.targetUrl && (
                          <a
                            href={s.targetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-neutral-400 hover:text-neutral-900"
                            title="Open details"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
