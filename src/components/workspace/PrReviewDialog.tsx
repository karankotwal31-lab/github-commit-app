import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DiffView } from "@/components/workspace-shared";
import { parseUnifiedPatch } from "@/lib/diff";
import { cn } from "@/lib/utils";
import type { WorkspaceViewProps } from "./types";
import { ChevronDown, Loader2 } from "lucide-react";

type PrReviewDialogProps = Pick<
  WorkspaceViewProps,
  | "prReview"
  | "setPrReview"
  | "prFiles"
  | "setPrFiles"
  | "prFilesLoading"
  | "prFilesError"
  | "expandedPrFile"
  | "setExpandedPrFile"
>;

/** PR review — files changed by a pull request, with expandable diffs. */
export function PrReviewDialog(props: PrReviewDialogProps) {
  const {
    prReview,
    setPrReview,
    prFiles,
    setPrFiles,
    prFilesLoading,
    prFilesError,
    expandedPrFile,
    setExpandedPrFile,
  } = props;

  return (
    <Dialog
      open={prReview !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPrReview(null);
          setPrFiles(null);
          setExpandedPrFile(null);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review PR #{prReview?.number}</DialogTitle>
        </DialogHeader>
        <p className="truncate text-sm text-neutral-600">{prReview?.title}</p>
        <div className="max-h-[26rem] overflow-auto">
          {prFilesLoading && !prFiles ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              Loading changed files…
            </div>
          ) : prFilesError ? (
            <p className="py-6 text-center text-xs text-red-600">{prFilesError}</p>
          ) : prFiles?.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">
              This pull request has no file changes.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {prFiles?.map((f) => (
                <li key={f.filename}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedPrFile(expandedPrFile === f.filename ? null : f.filename)
                    }
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-50"
                  >
                    <span
                      className={`shrink-0 rounded px-1 font-mono text-[10px] font-semibold ${
                        f.status === "added"
                          ? "bg-emerald-50 text-emerald-900"
                          : f.status === "removed"
                            ? "bg-red-50 text-red-900"
                            : f.status === "renamed"
                              ? "bg-blue-50 text-blue-900"
                              : "bg-amber-50 text-amber-900"
                      }`}
                    >
                      {f.status === "added"
                        ? "A"
                        : f.status === "removed"
                          ? "D"
                          : f.status === "renamed"
                            ? "R"
                            : "M"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-800">
                      {f.filename}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-emerald-700">
                      +{f.additions}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-red-600">
                      −{f.deletions}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-3 shrink-0 text-neutral-400 transition-transform",
                        expandedPrFile === f.filename && "rotate-180",
                      )}
                    />
                  </button>
                  {expandedPrFile === f.filename && (
                    <div className="max-h-64 overflow-auto border-t border-neutral-100">
                      <DiffView lines={parseUnifiedPatch(f.patch)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
