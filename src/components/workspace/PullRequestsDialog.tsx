import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceViewProps } from "./types";
import { Eye, GitPullRequest, Loader2, RefreshCw } from "lucide-react";

type PullRequestsDialogProps = Pick<
  WorkspaceViewProps,
  | "selectedRepo"
  | "prsOpen"
  | "setPrsOpen"
  | "prs"
  | "prsLoading"
  | "prsError"
  | "loadPullRequests"
  | "openPrReview"
  | "mergeTarget"
  | "setMergeTarget"
  | "merging"
  | "handleMergePr"
>;

/** Pull requests — open PRs with merge (list + merge confirmation). */
export function PullRequestsDialog(props: PullRequestsDialogProps) {
  const {
    selectedRepo,
    prsOpen,
    setPrsOpen,
    prs,
    prsLoading,
    prsError,
    loadPullRequests,
    openPrReview,
    mergeTarget,
    setMergeTarget,
    merging,
    handleMergePr,
  } = props;

  return (
    <>
      <Dialog open={prsOpen} onOpenChange={setPrsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Pull requests</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-xs text-neutral-500">
              {selectedRepo?.name}
            </p>
            <button
              type="button"
              onClick={loadPullRequests}
              className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
            >
              <RefreshCw className="size-3" />
              Refresh
            </button>
          </div>
          <div className="max-h-[24rem] overflow-auto">
            {prsLoading && !prs ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
                <Loader2 className="size-3.5 animate-spin" />
                Loading pull requests…
              </div>
            ) : prsError ? (
              <p className="py-6 text-center text-xs text-red-600">{prsError}</p>
            ) : prs?.length === 0 ? (
              <p className="py-6 text-center text-xs text-neutral-400">
                No open pull requests.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {prs?.map((pr) => (
                  <li key={pr.number} className="py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-800">
                          {pr.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-neutral-500">
                          #{pr.number} · {pr.author} ·{" "}
                          <span className="font-mono">{pr.head}</span>
                          {" → "}
                          <span className="font-mono">{pr.base}</span>
                        </p>
                        {pr.draft && (
                          <span className="mt-1 inline-block rounded border border-neutral-300 px-1 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                            Draft
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 gap-1 text-xs"
                        onClick={() =>
                          openPrReview({ number: pr.number, title: pr.title })
                        }
                        title="Review the files changed by this pull request"
                      >
                        <Eye className="size-3" />
                        Review
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 gap-1 text-xs"
                        disabled={pr.draft || pr.mergeable === false || pr.mergeable === null}
                        title={
                          pr.draft
                            ? "Draft pull requests can't be merged"
                            : pr.mergeable === false
                              ? "Has conflicts — resolve them before merging"
                              : pr.mergeable === null
                                ? "GitHub is still checking mergeability"
                                : "Merge this pull request"
                        }
                        onClick={() =>
                          setMergeTarget({ number: pr.number, title: pr.title })
                        }
                      >
                        <GitPullRequest className="size-3" />
                        Merge
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge confirmation */}
      <AlertDialog
        open={mergeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !merging) setMergeTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Merge this pull request?</AlertDialogTitle>
            <AlertDialogDescription>
              “{mergeTarget?.title}” will be squash-merged into its base branch
              as a single commit. The branch itself stays untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={merging}
              onClick={(e) => {
                e.preventDefault();
                handleMergePr();
              }}
            >
              {merging && <Loader2 className="size-4 animate-spin" />}
              Merge pull request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
