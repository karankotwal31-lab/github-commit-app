import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { timeAgo } from "@/components/workspace-shared";
import type { WorkspaceViewProps } from "./types";
import { Archive, Loader2 } from "lucide-react";

type DraftVaultDialogProps = Pick<
  WorkspaceViewProps,
  "vaultOpen" | "setVaultOpen" | "drafts" | "restoreDraft"
>;

/** Draft vault — unsaved edits resumable from any device. */
export function DraftVaultDialog(props: DraftVaultDialogProps) {
  const { vaultOpen, setVaultOpen, drafts, restoreDraft } = props;

  return (
    <Dialog open={vaultOpen} onOpenChange={setVaultOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Draft vault</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-5 text-neutral-500">
          Unsaved edits are captured as you type and can be resumed from any
          device. Click a draft to restore it into the editor.
        </p>
        <div className="max-h-[24rem] overflow-auto">
          {drafts === undefined ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              Loading drafts…
            </div>
          ) : drafts.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-400">
              No drafts yet — edit a file and its unsaved changes will appear
              here.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {drafts.map((d) => (
                <li key={`${d.repo}/${d.branch}/${d.path}`}>
                  <button
                    type="button"
                    onClick={() =>
                      restoreDraft({
                        repo: d.repo,
                        branch: d.branch,
                        path: d.path,
                      })
                    }
                    className="flex w-full items-start gap-3 rounded px-1 py-2.5 text-left hover:bg-neutral-50"
                  >
                    <Archive className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm text-neutral-800">
                        {d.path}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {d.repo} · <span className="font-mono">{d.branch}</span> ·{" "}
                        {timeAgo(d.updatedAt)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-400">
                        {d.preview}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
