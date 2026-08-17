import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/github";
import { cn } from "@/lib/utils";
import type { WorkspaceViewProps } from "./types";
import { Loader2, Lock, RefreshCw, Search } from "lucide-react";

type ReposSidebarProps = Pick<
  WorkspaceViewProps,
  | "mobileView"
  | "focusMode"
  | "reposLoading"
  | "reposError"
  | "repoQuery"
  | "setRepoQuery"
  | "filteredRepos"
  | "selectedRepo"
  | "handleSelectRepo"
  | "loadRepos"
>;

/** Repositories — list, filter, select. */
export function ReposSidebar(props: ReposSidebarProps) {
  const {
    mobileView,
    focusMode,
    reposLoading,
    reposError,
    repoQuery,
    setRepoQuery,
    filteredRepos,
    selectedRepo,
    handleSelectRepo,
    loadRepos,
  } = props;

  return (
    <aside
      className={cn(
        "shrink-0 flex-col border-r border-neutral-200",
        mobileView === "repos"
          ? "max-md:flex max-md:w-full"
          : "max-md:hidden",
        // Focus mode on desktop collapses the sidebars.
        focusMode ? "md:hidden" : "md:flex md:w-64",
      )}
    >
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
          Repositories
        </p>
        <button
          type="button"
          onClick={loadRepos}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          title="Refresh"
        >
          <RefreshCw className={`size-3.5 ${reposLoading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="px-3 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
          <Input
            value={repoQuery}
            onChange={(e) => setRepoQuery(e.target.value)}
            placeholder="Filter"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {reposLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-4 animate-spin text-neutral-400" />
          </div>
        ) : reposError ? (
          <p className="px-2 py-4 text-xs text-red-600">{reposError}</p>
        ) : (
          <ul className="space-y-0.5">
            {filteredRepos.map((repo) => {
              const active = selectedRepo?.fullName === repo.fullName;
              return (
                <li key={repo.fullName}>
                  <button
                    type="button"
                    onClick={() => handleSelectRepo(repo)}
                    className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "bg-neutral-900 text-white"
                        : "hover:bg-neutral-100"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p
                        className={`truncate font-mono text-sm ${
                          active ? "text-white" : "text-neutral-900"
                        }`}
                      >
                        {repo.name}
                      </p>
                      {repo.private && (
                        <Lock
                          className={cn(
                            "size-3 shrink-0",
                            active ? "text-neutral-400" : "text-neutral-300",
                          )}
                        />
                      )}
                    </div>
                    <p
                      className={`mt-0.5 truncate text-xs ${
                        active ? "text-neutral-300" : "text-neutral-400"
                      }`}
                    >
                      {repo.defaultBranch} · {formatDate(repo.updatedAt)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
