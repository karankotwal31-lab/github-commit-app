import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceViewProps } from "./types";
import {
  ExternalLink,
  FileCode2,
  Loader2,
  Search,
} from "lucide-react";

type CodeSearchDialogProps = Pick<
  WorkspaceViewProps,
  | "selectedRepo"
  | "currentBranch"
  | "codeSearchOpen"
  | "setCodeSearchOpen"
  | "codeQuery"
  | "setCodeQuery"
  | "codeResults"
  | "setCodeResults"
  | "codeSearchLoading"
  | "codeSearchError"
  | "setCodeSearchError"
  | "runCodeSearch"
  | "handleCodeResultSelect"
>;

/** Code search — full-text search across the repo. */
export function CodeSearchDialog(props: CodeSearchDialogProps) {
  const {
    selectedRepo,
    currentBranch,
    codeSearchOpen,
    setCodeSearchOpen,
    codeQuery,
    setCodeQuery,
    codeResults,
    setCodeResults,
    codeSearchLoading,
    codeSearchError,
    setCodeSearchError,
    runCodeSearch,
    handleCodeResultSelect,
  } = props;

  return (
    <Dialog
      open={codeSearchOpen}
      onOpenChange={(open) => {
        setCodeSearchOpen(open);
        if (!open) {
          setCodeQuery("");
          setCodeResults(null);
          setCodeSearchError(null);
        }
      }}
    >
      <DialogContent className="top-[18%] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Search code</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <Input
              value={codeQuery}
              onChange={(e) => setCodeQuery(e.target.value)}
              placeholder="Search symbols, names, strings…"
              className="h-10 pl-8 font-mono text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && codeQuery.trim() && !codeSearchLoading) {
                  runCodeSearch();
                }
              }}
            />
          </div>
          <Button
            type="button"
            className="h-10 shrink-0 gap-1.5"
            onClick={runCodeSearch}
            disabled={!codeQuery.trim() || codeSearchLoading}
          >
            {codeSearchLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </div>
        <p className="text-xs leading-5 text-neutral-400">
          Searches {selectedRepo?.name} across GitHub. Results open on{" "}
          <span className="font-mono text-neutral-500">{currentBranch}</span>.
        </p>
        <div className="max-h-72 overflow-auto">
          {codeSearchLoading && !codeResults ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              Searching…
            </div>
          ) : codeSearchError ? (
            <p className="py-6 text-center text-xs text-red-600">{codeSearchError}</p>
          ) : codeResults && codeResults.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">
              No matches for that query.
            </p>
          ) : codeResults ? (
            <ul className="divide-y divide-neutral-100">
              {codeResults.map((r) => (
                <li key={r.path} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCodeResultSelect(r.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-neutral-100"
                  >
                    <FileCode2 className="size-3.5 shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-800">
                      {r.path}
                    </span>
                  </button>
                  <a
                    href={r.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 p-1 text-neutral-400 hover:text-neutral-900"
                    title="Open on GitHub"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
