import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatSize } from "@/lib/github";
import type { WorkspaceViewProps } from "./types";
import { FileCode2, Loader2, Search } from "lucide-react";

type JumpToFileDialogProps = Pick<
  WorkspaceViewProps,
  | "searchOpen"
  | "setSearchOpen"
  | "searchQuery"
  | "setSearchQuery"
  | "treeFilesLoading"
  | "treeFiles"
  | "searchResults"
  | "handleSearchSelect"
>;

/** ⌘K quick-jump to any file in the branch. */
export function JumpToFileDialog(props: JumpToFileDialogProps) {
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    treeFilesLoading,
    treeFiles,
    searchResults,
    handleSearchSelect,
  } = props;

  return (
    <Dialog
      open={searchOpen}
      onOpenChange={(open) => {
        setSearchOpen(open);
        if (!open) setSearchQuery("");
      }}
    >
      <DialogContent className="top-[18%] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Jump to file</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type a file name…"
            className="h-10 pl-8 font-mono text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-auto">
          {treeFilesLoading && !treeFiles ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              Loading files…
            </div>
          ) : searchResults.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">
              {searchQuery
                ? "No files match that name."
                : "Type to filter every file in this branch."}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {searchResults.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => handleSearchSelect(file.path)}
                    className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-neutral-100"
                  >
                    <FileCode2 className="size-3.5 shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-800">
                      {file.path}
                    </span>
                    <span className="shrink-0 text-[11px] text-neutral-400">
                      {formatSize(file.size)}
                    </span>
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
