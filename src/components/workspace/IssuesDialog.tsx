import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/github";
import type { WorkspaceViewProps } from "./types";
import { CircleDot, Loader2, Plus, RefreshCw } from "lucide-react";

type IssuesDialogProps = Pick<
  WorkspaceViewProps,
  | "selectedRepo"
  | "issuesOpen"
  | "setIssuesOpen"
  | "issues"
  | "issuesLoading"
  | "issuesError"
  | "loadIssues"
>;

/** Open issues for the current repository. */
export function IssuesDialog(props: IssuesDialogProps) {
  const {
    selectedRepo,
    issuesOpen,
    setIssuesOpen,
    issues,
    issuesLoading,
    issuesError,
    loadIssues,
  } = props;

  return (
    <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Issues</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-mono text-xs text-neutral-500">
            {selectedRepo?.name}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <a
              href={`https://github.com/${selectedRepo?.fullName ?? ""}/issues/new`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
            >
              <Plus className="size-3" />
              New issue
            </a>
            <button
              type="button"
              onClick={loadIssues}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
            >
              <RefreshCw className="size-3" />
              Refresh
            </button>
          </div>
        </div>
        <div className="max-h-[24rem] overflow-auto">
          {issuesLoading && !issues ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              Loading issues…
            </div>
          ) : issuesError ? (
            <p className="py-6 text-center text-xs text-red-600">{issuesError}</p>
          ) : issues?.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">
              No open issues. Nice work.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {issues?.map((issue) => (
                <li key={issue.number} className="py-3">
                  <div className="flex items-start gap-3">
                    <CircleDot className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={issue.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-sm font-medium text-neutral-800 hover:underline"
                        >
                          {issue.title}
                        </a>
                        {issue.labels.slice(0, 3).map((label) => (
                          <span
                            key={label}
                            className="rounded border border-neutral-200 px-1 py-0.5 text-[10px] text-neutral-500"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        #{issue.number} · {issue.author} ·{" "}
                        {formatDate(issue.createdAt)} · {issue.comments} comment
                        {issue.comments === 1 ? "" : "s"}
                      </p>
                      {issue.body && (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-400">
                          {issue.body}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
