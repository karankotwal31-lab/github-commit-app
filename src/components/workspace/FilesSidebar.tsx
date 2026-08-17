import { ChecksChip } from "@/components/workspace-shared";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatSize } from "@/lib/github";
import { cn } from "@/lib/utils";
import type { WorkspaceViewProps } from "./types";
import type { DeploymentInfo } from "@/components/PreviewPanel";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileCode2,
  FilePlus2,
  FileSearch,
  Folder,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  History,
  Loader2,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

type FilesSidebarProps = Pick<
  WorkspaceViewProps,
  | "mobileView"
  | "focusMode"
  | "handleBackToRepos"
  | "selectedRepo"
  | "currentBranch"
  | "branches"
  | "branchesLoading"
  | "handleSwitchBranch"
  | "setDialog"
  | "path"
  | "setPath"
  | "pathSegments"
  | "handleBreadcrumb"
  | "handleOpenEntry"
  | "loadEntries"
  | "entries"
  | "entriesLoading"
  | "entriesError"
  | "sortedEntries"
  | "checks"
  | "checksLoading"
  | "deployment"
  | "deploymentLoading"
>;

interface FilesSidebarCallbacks {
  stagedPathSet: Set<string>;
  onOpenChecks: () => void;
  onPreview: () => void;
  onJumpToFile: () => void;
  onCodeSearch: () => void;
  onOpenHistory: () => void;
  onOpenIssues: () => void;
  onOpenPrs: () => void;
  onAskAria: () => void;
  onOpenVault: () => void;
  onNewFile: () => void;
}

/** Compact deployment chip shown next to the CI chip in the files sidebar. */
function DeploymentChip({
  deployment,
  loading,
  onClick,
}: {
  deployment: DeploymentInfo | null;
  loading: boolean;
  onClick: () => void;
}) {
  const state = deployment?.state ?? "none";
  const dot =
    state === "success"
      ? "bg-emerald-500"
      : state === "failure" || state === "error"
        ? "bg-red-500"
        : state === "pending" || state === "in_progress"
          ? "bg-amber-500 animate-pulse"
          : "bg-neutral-300";
  const label =
    state === "success"
      ? "Live"
      : state === "failure" || state === "error"
        ? "Failed"
        : state === "pending" || state === "in_progress"
          ? "Deploying"
          : "No deploy";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-neutral-100"
      title="Live deployment preview for this branch"
    >
      {loading ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-neutral-400" />
      ) : (
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      )}
      <span className="truncate text-neutral-500">{label}</span>
    </button>
  );
}

/** Files — branch selector, breadcrumbs, and the entry tree. */
export function FilesSidebar(
  props: FilesSidebarProps & FilesSidebarCallbacks,
) {
  const {
    mobileView,
    focusMode,
    selectedRepo,
    currentBranch,
    branches,
    branchesLoading,
    handleSwitchBranch,
    setDialog,
    path,
    setPath,
    pathSegments,
    handleBreadcrumb,
    handleOpenEntry,
    loadEntries,
    entries,
    entriesLoading,
    entriesError,
    sortedEntries,
    stagedPathSet,
    checks,
    checksLoading,
    deployment,
    deploymentLoading,
    onOpenChecks,
    onPreview,
    onJumpToFile,
    onCodeSearch,
    onOpenHistory,
    onOpenIssues,
    onOpenPrs,
    onAskAria,
    onOpenVault,
    handleBackToRepos,
    onNewFile,
  } = props;

  return (
    <aside
      className={cn(
        "shrink-0 flex-col border-r border-neutral-200",
        mobileView === "files"
          ? "max-md:flex max-md:w-full"
          : "max-md:hidden",
        focusMode ? "md:hidden" : "md:flex md:w-72",
      )}
    >
      <div className="px-4 pt-4">
        <div className="flex items-center gap-1">
          {selectedRepo ? (
            <>
              <button
                type="button"
                onClick={handleBackToRepos}
                className="mr-1 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                title="Back to repositories"
              >
                <ArrowLeft className="size-3.5" />
              </button>
              <p className="truncate font-mono text-sm font-medium text-neutral-900">
                {selectedRepo.name}
              </p>
              <div className="ml-auto flex min-w-0 items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex max-w-28 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-neutral-500 hover:bg-neutral-100"
                      title="Switch branch"
                    >
                      <GitBranch className="size-3 shrink-0" />
                      <span className="truncate">{currentBranch}</span>
                      <ChevronDown className="size-3 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-72 w-52 overflow-y-auto"
                  >
                    {branchesLoading && !branches && (
                      <DropdownMenuItem disabled>
                        <Loader2 className="mr-2 size-3 animate-spin" />
                        Loading branches…
                      </DropdownMenuItem>
                    )}
                    {branches?.map((b) => (
                      <DropdownMenuItem
                        key={b.name}
                        onClick={() => handleSwitchBranch(b.name)}
                        className="cursor-pointer font-mono text-sm"
                      >
                        {b.name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDialog({ kind: "branch" })}
                      className="cursor-pointer text-sm"
                    >
                      <Plus className="mr-2 size-3.5" />
                      Create branch…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ChecksChip
                  overall={checks?.overall ?? null}
                  loading={checksLoading}
                  onClick={onOpenChecks}
                />
                <DeploymentChip
                  deployment={deployment}
                  loading={deploymentLoading}
                  onClick={onPreview}
                />
              </div>
            </>
          ) : (
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
              Files
            </p>
          )}
        </div>
        {selectedRepo && (
          <div className="mt-2 flex flex-wrap items-center gap-0.5">
            <button
              type="button"
              onClick={onJumpToFile}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="Jump to file (⌘K)"
            >
              <Search className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onCodeSearch}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="Search code in this repo"
            >
              <FileSearch className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenHistory}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="Commit history"
            >
              <History className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenIssues}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="Open issues"
            >
              <CircleDot className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenPrs}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="Pull requests"
            >
              <GitPullRequest className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onAskAria}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="Ask Aria"
            >
              <Sparkles className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenVault}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="Draft vault"
            >
              <Archive className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onNewFile}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="New file"
            >
              <FilePlus2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {selectedRepo && currentBranch && (
        <div className="flex items-center gap-1 px-4 pt-2 text-[13px]">
          <button
            type="button"
            onClick={() => {
              setPath("");
              loadEntries(selectedRepo, currentBranch, "");
            }}
            className={`truncate font-mono hover:underline ${
              path === "" ? "text-neutral-900" : "text-neutral-500"
            }`}
          >
            {selectedRepo.name}
          </button>
          {pathSegments.map((segment, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0 text-neutral-300" />
              <button
                type="button"
                onClick={() => handleBreadcrumb(i)}
                className={`truncate font-mono hover:underline ${
                  i === pathSegments.length - 1
                    ? "text-neutral-900"
                    : "text-neutral-500"
                }`}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {!selectedRepo ? (
          <p className="px-3 py-6 text-sm text-neutral-400">
            Select a repository to browse its files.
          </p>
        ) : entriesLoading && !entries ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-4 animate-spin text-neutral-400" />
          </div>
        ) : entriesError ? (
          <p className="px-3 py-4 text-xs text-red-600">{entriesError}</p>
        ) : (
          <ul className="space-y-0.5">
            {path !== "" && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    const parent = pathSegments.slice(0, -1).join("/");
                    setPath(parent);
                    if (selectedRepo && currentBranch) {
                      loadEntries(selectedRepo, currentBranch, parent);
                    }
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-100"
                >
                  <FolderOpen className="size-4 shrink-0" />
                  <span className="truncate">..</span>
                </button>
              </li>
            )}
            {sortedEntries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => handleOpenEntry(entry)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-neutral-100"
                >
                  {entry.type === "dir" ? (
                    <Folder className="size-4 shrink-0 text-neutral-400" />
                  ) : (
                    <FileCode2 className="size-4 shrink-0 text-neutral-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-neutral-800">
                    {entry.name}
                  </span>
                  {entry.type === "file" && stagedPathSet.has(entry.path) && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                      title="Staged"
                    />
                  )}
                  {entry.type === "file" && (
                    <span className="shrink-0 text-xs text-neutral-400">
                      {formatSize(entry.size)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
