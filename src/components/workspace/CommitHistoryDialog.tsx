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
import { formatDate } from "@/lib/github";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";

type CommitHistoryDialogProps = Pick<
  WorkspaceViewProps,
  | "selectedRepo"
  | "currentBranch"
  | "historyOpen"
  | "setHistoryOpen"
  | "historyLoading"
  | "history"
  | "historyError"
  | "loadHistory"
  | "historyPage"
  | "loadMoreHistory"
  | "revertTarget"
  | "setRevertTarget"
  | "reverting"
  | "handleRevert"
>;

/** Commit history + revert (revert is a separate AlertDialog, kept cohesive). */
export function CommitHistoryDialog(props: CommitHistoryDialogProps) {
  const {
    selectedRepo,
    currentBranch,
    historyOpen,
    setHistoryOpen,
    historyLoading,
    history,
    historyError,
    loadHistory,
    historyPage,
    loadMoreHistory,
    revertTarget,
    setRevertTarget,
    reverting,
    handleRevert,
  } = props;

  return (
    <>
      <Dialog
        open={historyOpen}
        onOpenChange={(open) => {
          setHistoryOpen(open);
          if (!open) setRevertTarget(null);
        }}
      >
        <DialogContent className="top-[10%] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Commit history</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-xs text-neutral-500">
              {selectedRepo?.name} · {currentBranch}
            </p>
            <button
              type="button"
              onClick={loadHistory}
              className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
            >
              <RefreshCw className="size-3" />
              Refresh
            </button>
          </div>
          <div className="max-h-[24rem] overflow-auto">
            {historyLoading && !history ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
                <Loader2 className="size-3.5 animate-spin" />
                Loading history…
              </div>
            ) : historyError ? (
              <p className="py-6 text-center text-xs text-red-600">{historyError}</p>
            ) : history?.length === 0 ? (
              <p className="py-6 text-center text-xs text-neutral-400">
                No commits on this branch yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {history?.map((c) => (
                  <li key={c.sha} className="flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-800">
                        {c.message}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {c.author} · {formatDate(c.date)} ·{" "}
                        <span className="font-mono text-neutral-600">
                          {c.sha.slice(0, 7)}
                        </span>
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1 text-xs"
                      onClick={() =>
                        setRevertTarget({ sha: c.sha, message: c.message })
                      }
                      title="Create a new commit that undoes this one"
                    >
                      <RotateCcw className="size-3" />
                      Revert
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {history && history.length >= historyPage * 50 && (
              <div className="mt-2 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={loadMoreHistory}
                  disabled={historyLoading}
                >
                  {historyLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Revert confirmation */}
      <AlertDialog
        open={revertTarget !== null}
        onOpenChange={(open) => {
          if (!open && !reverting) setRevertTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Revert this commit?</AlertDialogTitle>
            <AlertDialogDescription>
              Aria will apply the reverse of “{revertTarget?.message}” as a new
              commit on {currentBranch}. The original commit stays in history —
              nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reverting}
              onClick={(e) => {
                e.preventDefault();
                handleRevert();
              }}
            >
              {reverting && <Loader2 className="size-4 animate-spin" />}
              Revert commit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
