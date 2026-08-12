import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import {
  formatDate,
  formatSize,
  githubAuthorizeUrl,
  errorMessage,
  ownerOf,
  repoNameOf,
  type DirEntry,
  type FileData,
  type Repository,
} from "@/lib/github";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  Github,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Unplug,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

function Wordmark() {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[15px] font-semibold tracking-tight">commit</span>
      <span className="text-[15px] font-semibold tracking-tight text-neutral-400">
        .
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect screen
// ---------------------------------------------------------------------------

function ConnectScreen({
  config,
}: {
  config: { clientIdConfigured: boolean; clientSecretConfigured: boolean };
}) {
  const siteUrl = githubAuthorizeUrl().replace("/api/github/authorize", "");
  const callbackUrl = `${siteUrl}/api/github/callback`;
  const keysReady = config.clientIdConfigured && config.clientSecretConfigured;

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground antialiased">
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 px-6">
        <Wordmark />
        <span className="text-xs text-neutral-400">Not connected</span>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-400">
              Step 1 of 1
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              Connect your GitHub
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-500">
              Authorize commit. to read your repositories and push commits.
              It's a one-time handshake — after this, everything happens here.
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-6">
            <div className="flex items-center gap-3">
              <span
                className={`flex size-5 items-center justify-center rounded-full border text-[11px] ${
                  keysReady
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 text-neutral-400"
                }`}
              >
                {keysReady ? "✓" : "1"}
              </span>
              <p className="text-sm text-neutral-700">
                Add your GitHub OAuth keys to the project
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`flex size-5 items-center justify-center rounded-full border text-[11px] ${
                  keysReady
                    ? "border-neutral-300 text-neutral-400"
                    : "border-neutral-300 text-neutral-400"
                }`}
              >
                2
              </span>
              <p className="text-sm text-neutral-700">Authorize below</p>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-neutral-200 p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
              Callback URL
            </p>
            <p className="mt-2 break-all font-mono text-xs text-neutral-700">
              {callbackUrl}
            </p>
            <p className="mt-3 text-xs leading-5 text-neutral-500">
              Register an OAuth app at{" "}
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-neutral-800"
              >
                github.com/settings/developers
              </a>{" "}
              and use the URL above as the authorization callback. Set{" "}
              <code className="font-mono text-neutral-700">GITHUB_CLIENT_ID</code>{" "}
              and{" "}
              <code className="font-mono text-neutral-700">
                GITHUB_CLIENT_SECRET
              </code>{" "}
              in your project keys.
            </p>
          </div>

          <Button
            type="button"
            className="mt-6 h-11 w-full gap-2"
            onClick={() => {
              window.location.href = githubAuthorizeUrl();
            }}
          >
            <Github className="size-4" />
            {keysReady ? "Connect GitHub" : "Connect GitHub (keys pending)"}
          </Button>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

function Workspace({
  connection,
}: {
  connection: {
    connected: boolean;
    login: string | null;
    name: string | null;
    avatar: string | null;
  };
}) {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const listRepositories = useAction(api.githubActions.listRepositories);
  const listContents = useAction(api.githubActions.listContents);
  const getFile = useAction(api.githubActions.getFile);
  const commitFile = useAction(api.githubActions.commitFile);
  const disconnect = useMutation(api.github.disconnect);

  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);

  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [path, setPath] = useState("");

  const [openFile, setOpenFile] = useState<(FileData & { path: string }) | null>(
    null,
  );
  const [editorContent, setEditorContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const loadRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const data = await listRepositories();
      setRepos(data);
    } catch (e) {
      setReposError(errorMessage(e));
    } finally {
      setReposLoading(false);
    }
  }, [listRepositories]);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const loadEntries = useCallback(
    async (repo: Repository, dirPath: string) => {
      setEntriesLoading(true);
      setEntriesError(null);
      try {
        const data = await listContents({
          owner: ownerOf(repo.fullName),
          repo: repoNameOf(repo.fullName),
          path: dirPath,
          branch: repo.defaultBranch,
        });
        setEntries(data as DirEntry[]);
      } catch (e) {
        setEntriesError(errorMessage(e));
      } finally {
        setEntriesLoading(false);
      }
    },
    [listContents],
  );

  useEffect(() => {
    if (selectedRepo) {
      setEntries(null);
      setOpenFile(null);
      setStatus(null);
      setPath("");
      loadEntries(selectedRepo, "");
    }
  }, [selectedRepo, loadEntries]);

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    const q = repoQuery.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos, repoQuery]);

  const sortedEntries = useMemo(() => {
    if (!entries) return [];
    const dirs = entries
      .filter((e) => e.type === "dir")
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = entries
      .filter((e) => e.type === "file")
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
  }, [entries]);

  const pathSegments = useMemo(
    () => (path ? path.split("/") : []),
    [path],
  );

  const handleOpenEntry = async (entry: DirEntry) => {
    if (!selectedRepo) return;
    if (entry.type === "dir") {
      setPath(entry.path);
      loadEntries(selectedRepo, entry.path);
      return;
    }
    // file
    setFileLoading(true);
    setStatus(null);
    try {
      const data = await getFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path: entry.path,
        branch: selectedRepo.defaultBranch,
      });
      setOpenFile({ ...data, path: entry.path });
      setEditorContent(data.content);
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setFileLoading(false);
    }
  };

  const handleBreadcrumb = (index: number) => {
    if (!selectedRepo) return;
    const target = pathSegments.slice(0, index + 1).join("/");
    setPath(target);
    loadEntries(selectedRepo, target);
  };

  const handleCommit = async () => {
    if (!selectedRepo || !openFile) return;
    const message = commitMessage.trim() || `Update ${openFile.path}`;
    setCommitting(true);
    setStatus(null);
    try {
      const result = await commitFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path: openFile.path,
        branch: selectedRepo.defaultBranch,
        message,
        content: editorContent,
        sha: openFile.sha,
      });
      setStatus({
        kind: "ok",
        text: `Committed ${result.sha?.slice(0, 7) ?? ""} — ${message}`,
      });
      setCommitMessage("");
      setOpenFile({ ...openFile, content: editorContent, sha: result.sha ?? openFile.sha });
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setCommitting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleDisconnect = async () => {
    await disconnect();
    setRepos(null);
    setSelectedRepo(null);
    setEntries(null);
    setOpenFile(null);
    setPath("");
  };

  const dirty = openFile !== null && editorContent !== openFile.content;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground antialiased">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-4">
        <Wordmark />
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100"
              >
                {connection.avatar ? (
                  <img
                    src={connection.avatar}
                    alt=""
                    className="size-6 rounded-full border border-neutral-200"
                  />
                ) : (
                  <span className="flex size-6 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-medium text-white">
                    {(connection.login ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="font-medium text-neutral-800">
                  @{connection.login ?? "github"}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={handleDisconnect}
              >
                <Unplug className="mr-2 size-4" />
                Disconnect GitHub
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={handleSignOut}
              >
                <LogOut className="mr-2 size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Repos */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200">
          <div className="flex items-center justify-between px-4 pt-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
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
            {reposLoading && !repos ? (
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
                        onClick={() => setSelectedRepo(repo)}
                        className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                          active
                            ? "bg-neutral-900 text-white"
                            : "hover:bg-neutral-100"
                        }`}
                      >
                        <p
                          className={`truncate font-mono text-[13px] ${
                            active ? "text-white" : "text-neutral-900"
                          }`}
                        >
                          {repo.name}
                        </p>
                        <p
                          className={`mt-0.5 truncate text-[11px] ${
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

        {/* Files */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200">
          <div className="flex items-center gap-1 px-4 pt-4">
            {selectedRepo ? (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedRepo(null)}
                  className="mr-1 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  title="Back to repositories"
                >
                  <ArrowLeft className="size-3.5" />
                </button>
                <p className="truncate font-mono text-[13px] font-medium text-neutral-900">
                  {selectedRepo.name}
                </p>
              </>
            ) : (
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                Files
              </p>
            )}
          </div>

          {selectedRepo && (
            <div className="flex items-center gap-1 px-4 pt-2 text-[13px]">
              <button
                type="button"
                onClick={() => {
                  setPath("");
                  loadEntries(selectedRepo, "");
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
                        loadEntries(selectedRepo, parent);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-neutral-500 hover:bg-neutral-100"
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
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-neutral-800">
                        {entry.name}
                      </span>
                      {entry.type === "file" && (
                        <span className="shrink-0 text-[11px] text-neutral-400">
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

        {/* Editor */}
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          {openFile ? (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <FileCode2 className="size-4 shrink-0 text-neutral-400" />
                  <p className="truncate font-mono text-[13px] text-neutral-900">
                    {openFile.path}
                  </p>
                  {dirty && (
                    <span className="size-1.5 shrink-0 rounded-full bg-neutral-900" />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  {selectedRepo && (
                    <span className="hidden font-mono text-[11px] text-neutral-400 sm:inline">
                      {selectedRepo.defaultBranch}
                    </span>
                  )}
                  {dirty && (
                    <button
                      type="button"
                      onClick={() => setEditorContent(openFile.content)}
                      className="text-xs text-neutral-500 hover:text-neutral-900"
                    >
                      Discard
                    </button>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1">
                {fileLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="size-4 animate-spin text-neutral-400" />
                  </div>
                ) : (
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="h-full w-full resize-none bg-background p-4 font-mono text-[13px] leading-6 text-neutral-900 outline-none"
                  />
                )}
              </div>

              <div className="shrink-0 border-t border-neutral-200 p-3">
                {status && (
                  <p
                    className={`mb-2 text-xs ${
                      status.kind === "ok" ? "text-neutral-700" : "text-red-600"
                    }`}
                  >
                    {status.text}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message"
                    className="h-9 flex-1 font-mono text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleCommit();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    className="h-9 shrink-0 gap-1.5"
                    onClick={handleCommit}
                    disabled={committing || !dirty}
                  >
                    {committing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Github className="size-4" />
                    )}
                    Commit
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              {selectedRepo ? (
                <>
                  <FileCode2 className="size-6 text-neutral-300" />
                  <p className="mt-4 text-sm font-medium text-neutral-700">
                    Select a file to edit
                  </p>
                  <p className="mt-1 max-w-xs text-sm text-neutral-400">
                    Pick a text file from the browser to the left. Changes are
                    committed to{" "}
                    <span className="font-mono">{selectedRepo.defaultBranch}</span>.
                  </p>
                </>
              ) : (
                <>
                  <FolderOpen className="size-6 text-neutral-300" />
                  <p className="mt-4 text-sm font-medium text-neutral-700">
                    No repository selected
                  </p>
                  <p className="mt-1 max-w-xs text-sm text-neutral-400">
                    Choose a repository to start browsing and editing files.
                  </p>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const connection = useQuery(api.github.connection);
  const config = useQuery(api.github.config);
  const [searchParams, setSearchParams] = useSearchParams();

  const githubParam = searchParams.get("github");

  useEffect(() => {
    if (githubParam) {
      if (githubParam === "connected") {
        toast.success("Connected to GitHub");
      } else if (githubParam === "config") {
        toast.error("GitHub keys aren't configured yet — see the setup steps.");
      } else if (githubParam === "error") {
        toast.error("Couldn't connect to GitHub. Please try again.");
      }
      setSearchParams({}, { replace: true });
    }
  }, [githubParam, setSearchParams]);

  if (connection === undefined || config === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!connection.connected) {
    return <ConnectScreen config={config} />;
  }

  return <Workspace connection={connection} />;
}
