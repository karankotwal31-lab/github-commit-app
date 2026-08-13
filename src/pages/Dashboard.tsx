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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import {
  formatDate,
  formatSize,
  githubAuthorizeUrl,
  convexSiteUrl,
  errorMessage,
  ownerOf,
  repoNameOf,
  type Branch,
  type CommitResult,
  type DirEntry,
  type FileData,
  type PullRequestResult,
  type Repository,
} from "@/lib/github";
import { diffLines, type DiffLine } from "@/lib/diff";
import { secretRisk } from "@/lib/secrets";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Github,
  History,
  Loader2,
  Lock,
  LogOut,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Unplug,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

function Wordmark() {
  return (
    <div className="flex items-center gap-1.5">
      <Music2 className="size-4 text-primary" strokeWidth={2.25} />
      <span className="text-[15px] font-semibold tracking-tight">Aria</span>
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
  config: {
    clientIdConfigured: boolean;
    clientSecretConfigured: boolean;
    clientId: string | null;
  };
}) {
  const startOAuth = useMutation(api.github.startOAuth);
  const callbackUrl = `${convexSiteUrl()}/api/github/callback`;
  const keysReady = config.clientIdConfigured && config.clientSecretConfigured;

  const handleConnect = async () => {
    if (!config.clientId) {
      toast.error("GitHub keys aren't configured yet — see the setup steps.");
      return;
    }
    try {
      const state = await startOAuth({ origin: window.location.origin });
      window.location.href = githubAuthorizeUrl(state, config.clientId);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground antialiased">
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 px-6">
        <Wordmark />
        <span className="text-xs text-neutral-400">Not connected</span>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
              Step 1 of 1
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              Connect your GitHub
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-500">
              Authorize Aria to read your repositories and push commits.
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
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
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
            onClick={handleConnect}
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
// Input dialog (new file / rename / new branch)
// ---------------------------------------------------------------------------

function InputDialog({
  open,
  title,
  label,
  placeholder,
  initial,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {label && <p className="text-sm leading-5 text-neutral-500">{label}</p>}
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() && !busy) {
              onConfirm(value.trim());
            }
          }}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!value.trim() || busy}
            onClick={() => onConfirm(value.trim())}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Diff view
// ---------------------------------------------------------------------------

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="h-full overflow-auto bg-background">
      <table className="w-full border-collapse font-mono text-sm leading-6">
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={i}
              className={
                line.type === "add"
                  ? "bg-emerald-50/60"
                  : line.type === "del"
                    ? "bg-red-50/60"
                    : ""
              }
            >
              <td className="w-12 select-none border-r border-neutral-100 px-2 text-right text-xs text-neutral-400">
                {line.oldLine ?? ""}
              </td>
              <td className="w-12 select-none border-r border-neutral-100 px-2 text-right text-xs text-neutral-400">
                {line.newLine ?? ""}
              </td>
              <td
                className={`whitespace-pre px-3 ${
                  line.type === "add"
                    ? "text-emerald-900"
                    : line.type === "del"
                      ? "text-red-900"
                      : "text-neutral-800"
                }`}
              >
                {line.text || " "}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length === 0 && (
        <p className="p-6 text-sm text-neutral-400">No changes yet.</p>
      )}
    </div>
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
  const createFile = useAction(api.githubActions.createFile);
  const deleteFile = useAction(api.githubActions.deleteFile);
  const renameFile = useAction(api.githubActions.renameFile);
  const listBranches = useAction(api.githubActions.listBranches);
  const createBranchAction = useAction(api.githubActions.createBranch);
  const createPullRequest = useAction(api.githubActions.createPullRequest);
  const commitChanges = useAction(api.githubActions.commitChanges);
  const listTreeFiles = useAction(api.githubActions.listTreeFiles);
  const getCommitHistory = useAction(api.githubActions.getCommitHistory);
  const revertCommit = useAction(api.githubActions.revertCommit);
  const disconnect = useMutation(api.github.disconnect);

  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);

  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [path, setPath] = useState("");

  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);

  const [openFile, setOpenFile] = useState<(FileData & { path: string }) | null>(
    null,
  );
  const [isNewFile, setIsNewFile] = useState(false);
  const [editorContent, setEditorContent] = useState("");
  const [viewMode, setViewMode] = useState<"edit" | "diff">("edit");
  const [fileLoading, setFileLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const [dialog, setDialog] = useState<
    { kind: "newFile" | "rename" | "branch" } | null
  >(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastCommit, setLastCommit] = useState<CommitResult | null>(null);
  const [prOpen, setPrOpen] = useState(false);
  const [prResult, setPrResult] = useState<PullRequestResult | null>(null);

  // Multi-file staging: each entry is a snapshot of one changed file that will
  // be committed together in a single atomic commit.
  const [staged, setStaged] = useState<
    Array<{
      path: string;
      originalContent: string;
      content: string;
      sha: string;
      action: "update" | "create";
    }>
  >([]);
  const [stagedDiffOpen, setStagedDiffOpen] = useState<string | null>(null);

  // Secret guardrails: committing secret-looking files is blocked until the
  // user explicitly confirms. `allowSecrets` is that explicit confirmation.
  const [allowSecrets, setAllowSecrets] = useState(false);

  // ⌘K quick-jump: every file in the current branch, loaded once per branch.
  const [treeFiles, setTreeFiles] = useState<Array<{ path: string; size: number }> | null>(
    null,
  );
  const [treeFilesLoading, setTreeFilesLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Commit history + revert: the branch's recent commits, and the commit
  // currently queued for reverting.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<
    Array<{
      sha: string;
      message: string;
      author: string;
      date: string | null;
      htmlUrl: string;
    }> | null
  >(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [revertTarget, setRevertTarget] = useState<
    | { sha: string; message: string }
    | null
  >(null);
  const [reverting, setReverting] = useState(false);

  const currentBranch = branch ?? selectedRepo?.defaultBranch ?? null;

  // On mobile the workspace is a single drill-down screen; desktop shows all
  // three panes side by side.
  const mobileView: "repos" | "files" | "editor" = openFile
    ? "editor"
    : selectedRepo
      ? "files"
      : "repos";

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
    let cancelled = false;
    (async () => {
      try {
        const data = await listRepositories();
        if (!cancelled) setRepos(data);
      } catch (e) {
        if (!cancelled) setReposError(errorMessage(e));
      } finally {
        if (!cancelled) setReposLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listRepositories]);

  const loadEntries = useCallback(
    async (repo: Repository, branchName: string, dirPath: string) => {
      setEntriesLoading(true);
      setEntriesError(null);
      try {
        const data = await listContents({
          owner: ownerOf(repo.fullName),
          repo: repoNameOf(repo.fullName),
          path: dirPath,
          branch: branchName,
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

  const loadBranches = useCallback(
    async (repo: Repository) => {
      setBranchesLoading(true);
      try {
        const data = await listBranches({
          owner: ownerOf(repo.fullName),
          repo: repoNameOf(repo.fullName),
        });
        setBranches(data);
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setBranchesLoading(false);
      }
    },
    [listBranches],
  );

  const loadTreeFiles = useCallback(
    async (repo: Repository, branchName: string) => {
      setTreeFilesLoading(true);
      try {
        const data = await listTreeFiles({
          owner: ownerOf(repo.fullName),
          repo: repoNameOf(repo.fullName),
          branch: branchName,
        });
        setTreeFiles(data);
      } catch (e) {
        // Search is a nicety — don't block the workspace on it.
        setTreeFiles(null);
        console.error(errorMessage(e));
      } finally {
        setTreeFilesLoading(false);
      }
    },
    [listTreeFiles],
  );

  const loadHistory = useCallback(async () => {
    if (!selectedRepo || !currentBranch) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await getCommitHistory({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        branch: currentBranch,
      });
      setHistory(data);
    } catch (e) {
      setHistoryError(errorMessage(e));
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedRepo, currentBranch, getCommitHistory]);

  const handleOpenHistory = () => {
    setHistoryOpen(true);
    loadHistory();
  };

  const handleRevert = async () => {
    if (!revertTarget || !selectedRepo || !currentBranch) return;
    setReverting(true);
    try {
      const result = await revertCommit({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        branch: currentBranch,
        commitSha: revertTarget.sha,
      });
      toast.success(
        `Reverted ${revertTarget.sha.slice(0, 7)} → ${result.sha?.slice(0, 7) ?? ""} on ${currentBranch}`,
      );
      setRevertTarget(null);
      setHistoryOpen(false);
      setHistory(null);
      setLastCommit(null);
      setPrResult(null);
      // Refresh the file tree and any open file so the workspace matches the
      // new branch tip.
      loadEntries(selectedRepo, currentBranch, path);
      if (openFile && !isNewFile) {
        try {
          const data = await getFile({
            owner: ownerOf(selectedRepo.fullName),
            repo: repoNameOf(selectedRepo.fullName),
            path: openFile.path,
            branch: currentBranch,
          });
          setOpenFile({ ...data, path: openFile.path });
          setEditorContent(data.content);
        } catch {
          // The revert may have removed this file — close it gracefully.
          setOpenFile(null);
          setEditorContent("");
        }
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setReverting(false);
    }
  };

  // ⌘K / Ctrl+K opens the file quick-jump.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (selectedRepo) setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedRepo]);

  const handleSelectRepo = (repo: Repository) => {
    setSelectedRepo(repo);
    setBranch(repo.defaultBranch);
    setBranches(null);
    setEntries(null);
    setOpenFile(null);
    setIsNewFile(false);
    setStatus(null);
    setLastCommit(null);
    setPrResult(null);
    setStaged([]);
    setStagedDiffOpen(null);
    setAllowSecrets(false);
    setTreeFiles(null);
    setSearchQuery("");
    setSearchOpen(false);
    setHistoryOpen(false);
    setHistory(null);
    setRevertTarget(null);
    setPath("");
    setViewMode("edit");
    loadEntries(repo, repo.defaultBranch, "");
    loadBranches(repo);
    loadTreeFiles(repo, repo.defaultBranch);
  };

  const handleBackToRepos = () => {
    setSelectedRepo(null);
    setBranch(null);
    setBranches(null);
    setEntries(null);
    setOpenFile(null);
    setIsNewFile(false);
    setStatus(null);
    setLastCommit(null);
    setPrResult(null);
    setStaged([]);
    setStagedDiffOpen(null);
    setAllowSecrets(false);
    setTreeFiles(null);
    setSearchQuery("");
    setSearchOpen(false);
    setHistoryOpen(false);
    setHistory(null);
    setRevertTarget(null);
    setPath("");
    setViewMode("edit");
  };

  const handleSwitchBranch = (name: string) => {
    if (!selectedRepo || !currentBranch || name === currentBranch) return;
    setBranch(name);
    setEntries(null);
    setOpenFile(null);
    setIsNewFile(false);
    setStatus(null);
    setLastCommit(null);
    setPrResult(null);
    setStaged([]);
    setStagedDiffOpen(null);
    setAllowSecrets(false);
    setTreeFiles(null);
    setSearchQuery("");
    setSearchOpen(false);
    setHistoryOpen(false);
    setHistory(null);
    setRevertTarget(null);
    setPath("");
    setViewMode("edit");
    loadEntries(selectedRepo, name, "");
    if (selectedRepo) loadTreeFiles(selectedRepo, name);
  };

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

  const stagedPathSet = useMemo(
    () => new Set(staged.map((f) => f.path)),
    [staged],
  );

  const handleOpenEntry = async (entry: DirEntry) => {
    if (!selectedRepo || !currentBranch) return;
    if (entry.type === "dir") {
      setPath(entry.path);
      loadEntries(selectedRepo, currentBranch, entry.path);
      return;
    }
    setFileLoading(true);
    setStatus(null);
    try {
      const data = await getFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path: entry.path,
        branch: currentBranch,
      });
      setOpenFile({ ...data, path: entry.path });
      setEditorContent(data.content);
      setIsNewFile(false);
      setLastCommit(null);
      setPrResult(null);
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setFileLoading(false);
    }
  };

  const searchResults = useMemo(() => {
    if (!treeFiles) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return treeFiles.slice(0, 50);
    return treeFiles
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 50);
  }, [treeFiles, searchQuery]);

  const handleSearchSelect = async (path: string) => {
    if (!selectedRepo || !currentBranch) return;
    setSearchOpen(false);
    setSearchQuery("");
    setFileLoading(true);
    setStatus(null);
    try {
      const data = await getFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path,
        branch: currentBranch,
      });
      setOpenFile({ ...data, path });
      setEditorContent(data.content);
      setIsNewFile(false);
      setLastCommit(null);
      setPrResult(null);
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setFileLoading(false);
    }
  };

  const handleBreadcrumb = (index: number) => {
    if (!selectedRepo || !currentBranch) return;
    const target = pathSegments.slice(0, index + 1).join("/");
    setPath(target);
    loadEntries(selectedRepo, currentBranch, target);
  };

  const handleDialogConfirm = async (value: string) => {
    if (!selectedRepo || !dialog) return;
    const clean = value.startsWith("/") ? value.slice(1) : value;
    setDialogBusy(true);
    try {
      if (dialog.kind === "newFile") {
        setOpenFile({ content: "", sha: "", size: 0, truncated: false, path: clean });
        setEditorContent("");
        setIsNewFile(true);
        setStatus(null);
        setViewMode("edit");
        setLastCommit(null);
        setPrResult(null);
        setDialog(null);
      } else if (dialog.kind === "rename") {
        if (!openFile || !currentBranch) return;
        const oldPath = openFile.path;
        if (clean === oldPath) {
          toast.error("New path is the same as the current path.");
          return;
        }
        const result = await renameFile({
          owner: ownerOf(selectedRepo.fullName),
          repo: repoNameOf(selectedRepo.fullName),
          oldPath,
          newPath: clean,
          branch: currentBranch,
          message: `Rename ${oldPath} → ${clean}`,
        });
        // A staged entry for the old path is now stale — committing it later
        // would recreate the old file. Drop it.
        setStaged((prev) => prev.filter((f) => f.path !== oldPath));
        setOpenFile({
          content: result.content,
          sha: result.sha ?? "",
          size: 0,
          truncated: false,
          path: clean,
        });
        const dir = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
        setPath(dir);
        loadEntries(selectedRepo, currentBranch, dir);
        setDialog(null);
        toast.success(`Renamed to ${clean}`);
      } else {
        // branch
        if (!currentBranch) return;
        await createBranchAction({
          owner: ownerOf(selectedRepo.fullName),
          repo: repoNameOf(selectedRepo.fullName),
          name: clean,
          base: currentBranch,
        });
        setBranches([...(branches ?? []), { name: clean, sha: "" }]);
        handleSwitchBranch(clean);
        setDialog(null);
        toast.success(`Created branch ${clean}`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDialogBusy(false);
    }
  };

  const handleStage = () => {
    if (!openFile) return;
    const stageRisk = secretRisk(openFile.path, editorContent);
    if (stageRisk.risky) {
      toast.warning(
        "Heads up — this file looks like it contains secrets. Aria will ask you to confirm before committing it.",
      );
    }
    const change = {
      path: openFile.path,
      originalContent: openFile.content,
      content: editorContent,
      sha: openFile.sha,
      action: isNewFile ? ("create" as const) : ("update" as const),
    };
    setStaged((prev) => {
      const next = prev.filter((f) => f.path !== change.path);
      return [...next, change];
    });
    setStagedDiffOpen(null);
    toast.success(isNewFile ? "Staged new file" : "Staged changes");
  };

  const handleUnstage = (path: string) => {
    setStaged((prev) => prev.filter((f) => f.path !== path));
    if (stagedDiffOpen === path) setStagedDiffOpen(null);
  };

  const handleCommit = async () => {
    if (!selectedRepo || !currentBranch) return;
    if (staged.length > 0) {
      // Multi-file: commit every staged file as one atomic commit.
      const message =
        commitMessage.trim() ||
        `Update ${staged.length} file${staged.length > 1 ? "s" : ""}`;
      setCommitting(true);
      setStatus(null);
      try {
        const result = await commitChanges({
          owner: ownerOf(selectedRepo.fullName),
          repo: repoNameOf(selectedRepo.fullName),
          branch: currentBranch,
          message,
          allowSecrets,
          files: staged.map((f) => ({
            path: f.path,
            content: f.content,
            action: f.action,
          })),
        });
        setStatus({
          kind: "ok",
          text: `Committed ${result.sha?.slice(0, 7) ?? ""} — ${message} (${staged.length} file${staged.length > 1 ? "s" : ""})`,
        });
        setCommitMessage("");
        setLastCommit(result);
        setPrResult(null);
        // Refresh the file tree so the new state is visible immediately.
        // New files may live in a different directory than the one we're
        // browsing, so jump the tree there.
        const openDir = openFile?.path.includes("/")
          ? openFile.path.slice(0, openFile.path.lastIndexOf("/"))
          : "";
        if (isNewFile) {
          setPath(openDir);
          loadEntries(selectedRepo, currentBranch, openDir);
        } else {
          loadEntries(selectedRepo, currentBranch, path);
        }
        // If the open file was part of the batch, sync its local copy.
        if (openFile) {
          const stagedOpen = staged.find((f) => f.path === openFile.path);
          if (stagedOpen) {
            setOpenFile({
              ...openFile,
              content: stagedOpen.content,
              sha: result.sha ?? openFile.sha,
            });
            setEditorContent(stagedOpen.content);
          }
        }
        if (isNewFile) setIsNewFile(false);
        setStaged([]);
        setStagedDiffOpen(null);
        setAllowSecrets(false);
      } catch (e) {
        setStatus({ kind: "err", text: errorMessage(e) });
      } finally {
        setCommitting(false);
      }
      return;
    }
    if (!openFile) return;
    const message =
      commitMessage.trim() ||
      (isNewFile ? `Create ${openFile.path}` : `Update ${openFile.path}`);
    setCommitting(true);
    setStatus(null);
    try {
      const result = isNewFile
        ? await createFile({
            owner: ownerOf(selectedRepo.fullName),
            repo: repoNameOf(selectedRepo.fullName),
            path: openFile.path,
            branch: currentBranch,
            message,
            content: editorContent,
            allowSecrets,
          })
        : await commitFile({
            owner: ownerOf(selectedRepo.fullName),
            repo: repoNameOf(selectedRepo.fullName),
            path: openFile.path,
            branch: currentBranch,
            message,
            content: editorContent,
            sha: openFile.sha,
            allowSecrets,
          });
      setStatus({
        kind: "ok",
        text: `Committed ${result.sha?.slice(0, 7) ?? ""} — ${message}`,
      });
      setCommitMessage("");
      setLastCommit(result);
      setPrResult(null);
      if (isNewFile) {
        const dir = openFile.path.includes("/")
          ? openFile.path.slice(0, openFile.path.lastIndexOf("/"))
          : "";
        setPath(dir);
        loadEntries(selectedRepo, currentBranch, dir);
        setOpenFile({
          ...openFile,
          content: editorContent,
          sha: result.sha ?? "",
        });
        setIsNewFile(false);
      } else {
        setOpenFile({
          ...openFile,
          content: editorContent,
          sha: result.sha ?? openFile.sha,
        });
      }
      setAllowSecrets(false);
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setCommitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRepo || !openFile || isNewFile || !currentBranch) return;
    setDeleting(true);
    try {
      await deleteFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path: openFile.path,
        branch: currentBranch,
        message: `Delete ${openFile.path}`,
        sha: openFile.sha,
      });
      const dir = openFile.path.includes("/")
        ? openFile.path.slice(0, openFile.path.lastIndexOf("/"))
        : "";
      // A deleted file must not linger in the staged changes (committing it
      // later would silently recreate it).
      setStaged((prev) => prev.filter((f) => f.path !== openFile.path));
      setOpenFile(null);
      setIsNewFile(false);
      setPath(dir);
      loadEntries(selectedRepo, currentBranch, dir);
      setStatus({ kind: "ok", text: `Deleted the file.` });
      toast.success("File deleted");
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const handleOpenPr = async () => {
    if (!selectedRepo || !lastCommit || !currentBranch) return;
    setPrOpen(true);
    try {
      const result = await createPullRequest({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        title: lastCommit.message,
        head: currentBranch,
        base: selectedRepo.defaultBranch,
      });
      setPrResult(result);
      toast.success(`Pull request #${result.number} opened`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPrOpen(false);
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
    setBranch(null);
    setBranches(null);
    setEntries(null);
    setOpenFile(null);
    setIsNewFile(false);
    setStaged([]);
    setStagedDiffOpen(null);
    setHistoryOpen(false);
    setHistory(null);
    setRevertTarget(null);
    setPath("");
  };

  const dirty = openFile !== null && !isNewFile && editorContent !== openFile.content;
  const riskyStaged = useMemo(
    () => staged.filter((f) => secretRisk(f.path, f.content).risky),
    [staged],
  );
  const openFileRisk = useMemo(() => {
    if (!openFile || (!isNewFile && !dirty)) return null;
    const risk = secretRisk(openFile.path, editorContent);
    return risk.risky ? risk : null;
  }, [openFile, isNewFile, dirty, editorContent]);
  // The warning should only list files that actually block the commit: risky
  // staged files when committing the batch, or the risky open file when
  // committing a single file.
  const flaggedSecretPaths = useMemo(() => {
    if (staged.length > 0) return riskyStaged.map((f) => f.path);
    return openFileRisk && openFile ? [openFile.path] : [];
  }, [staged, riskyStaged, openFileRisk, openFile]);
  const canCommit = staged.length > 0
    ? commitMessage.trim() !== "" && (riskyStaged.length === 0 || allowSecrets)
    : isNewFile
      ? (editorContent.trim() !== "" || commitMessage.trim() !== "") &&
        (openFileRisk === null || allowSecrets)
      : dirty && (openFileRisk === null || allowSecrets);
  const openFileIsStaged =
    openFile !== null && staged.some((f) => f.path === openFile.path);

  const diff = useMemo(
    () => (openFile ? diffLines(openFile.content, editorContent) : []),
    [openFile, editorContent],
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground antialiased">
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
        <aside
          className={cn(
            "shrink-0 flex-col border-r border-neutral-200",
            mobileView === "repos"
              ? "max-md:flex max-md:w-full"
              : "max-md:hidden",
            "md:flex md:w-64",
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

        {/* Files */}
        <aside
          className={cn(
            "shrink-0 flex-col border-r border-neutral-200",
            mobileView === "files"
              ? "max-md:flex max-md:w-full"
              : "max-md:hidden",
            "md:flex md:w-72",
          )}
        >
          <div className="flex items-center gap-1 px-4 pt-4">
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
                <div className="ml-auto flex items-center gap-0.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex max-w-32 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-neutral-500 hover:bg-neutral-100"
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
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    title="Jump to file (⌘K)"
                  >
                    <Search className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenHistory}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    title="Commit history"
                  >
                    <History className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: "newFile" })}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    title="New file"
                  >
                    <FilePlus2 className="size-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                Files
              </p>
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

        {/* Editor */}
        <main
          className={cn(
            "min-w-0 flex-1 flex-col bg-background",
            mobileView === "editor" ? "max-md:flex" : "max-md:hidden",
            "md:flex",
          )}
        >
          {openFile ? (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenFile(null)}
                    className="mr-1 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 md:hidden"
                    title="Back to files"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                  <FileCode2 className="size-4 shrink-0 text-neutral-400" />
                  <p className="truncate font-mono text-sm text-neutral-900">
                    {openFile.path}
                  </p>
                  {isNewFile && (
                    <span className="shrink-0 rounded border border-neutral-300 px-1 py-0.5 text-[11px] uppercase tracking-wide text-neutral-500">
                      New
                    </span>
                  )}
                  {openFileIsStaged && (
                    <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[11px] uppercase tracking-wide text-emerald-900">
                      Staged
                    </span>
                  )}
                  {dirty && (
                    <span className="size-1.5 shrink-0 rounded-full bg-neutral-900" />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex items-center rounded-md border border-neutral-200 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setViewMode("edit")}
                      className={`rounded px-2 py-0.5 transition-colors ${
                        viewMode === "edit"
                          ? "bg-neutral-900 text-white"
                          : "text-neutral-500 hover:bg-neutral-100"
                      }`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("diff")}
                      className={`rounded px-2 py-0.5 transition-colors ${
                        viewMode === "diff"
                          ? "bg-neutral-900 text-white"
                          : "text-neutral-500 hover:bg-neutral-100"
                      }`}
                    >
                      Diff
                    </button>
                  </div>
                  {!isNewFile && (
                    <>
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: "rename" })}
                        title="Rename"
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteOpen(true)}
                        title="Delete"
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                  <span className="hidden font-mono text-xs text-neutral-400 sm:inline">
                    {currentBranch}
                  </span>
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
                ) : viewMode === "diff" ? (
                  <DiffView lines={diff} />
                ) : (
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="h-full w-full resize-none bg-background p-4 font-mono text-sm leading-6 text-neutral-900 outline-none"
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
                {lastCommit &&
                  selectedRepo &&
                  currentBranch &&
                  currentBranch !== selectedRepo.defaultBranch &&
                  !prResult && (
                    <div className="mb-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={handleOpenPr}
                        disabled={prOpen}
                      >
                        {prOpen ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <GitPullRequest className="size-3" />
                        )}
                        Open pull request → {selectedRepo.defaultBranch}
                      </Button>
                    </div>
                  )}
                {prResult && (
                  <p className="mb-2 text-xs text-neutral-700">
                    <a
                      href={prResult.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-neutral-900"
                    >
                      Pull request #{prResult.number} — {prResult.title}
                    </a>
                  </p>
                )}
                {staged.length > 0 && (
                  <div className="mb-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                        Changes · {staged.length}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setStaged([]);
                          setStagedDiffOpen(null);
                          setAllowSecrets(false);
                        }}
                        className="text-xs text-neutral-500 hover:text-neutral-900"
                      >
                        Clear all
                      </button>
                    </div>
                    <ul className="max-h-48 divide-y divide-neutral-100 overflow-auto">
                      {staged.map((f) => (
                        <li key={f.path}>
                          <div className="flex items-center gap-2 px-3 py-1.5">
                            <span
                              className={`shrink-0 rounded px-1 font-mono text-[10px] font-semibold ${
                                f.action === "create"
                                  ? "bg-emerald-50 text-emerald-900"
                                  : "bg-amber-50 text-amber-900"
                              }`}
                            >
                              {f.action === "create" ? "A" : "M"}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setStagedDiffOpen(
                                  stagedDiffOpen === f.path ? null : f.path,
                                )
                              }
                              className="min-w-0 flex-1 truncate text-left font-mono text-xs text-neutral-800 hover:text-neutral-900"
                              title={stagedDiffOpen === f.path ? "Hide diff" : "Show diff"}
                            >
                              {f.path}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUnstage(f.path)}
                              className="shrink-0 text-xs text-neutral-400 hover:text-red-600"
                            >
                              Unstage
                            </button>
                          </div>
                          {stagedDiffOpen === f.path && (
                            <div className="max-h-48 overflow-auto border-t border-neutral-100">
                              <DiffView lines={diffLines(f.originalContent, f.content)} />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {staged.length > 0 && openFile && dirty && !openFileIsStaged && (
                  <p className="mb-2 text-xs text-neutral-500">
                    The open file has unstaged edits — stage it to include it in
                    this commit.
                  </p>
                )}

                {flaggedSecretPaths.length > 0 && (
                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="flex items-start gap-2 text-xs text-amber-900">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        Aria blocked this commit:{" "}
                        <span className="font-mono">
                          {flaggedSecretPaths.join(", ")}
                        </span>{" "}
                        {flaggedSecretPaths.length > 1
                          ? "look like they contain secrets."
                          : "looks like it contains secrets."}
                      </span>
                    </p>
                    <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-amber-900">
                      <input
                        type="checkbox"
                        checked={allowSecrets}
                        onChange={(e) => setAllowSecrets(e.target.checked)}
                        className="size-3.5 accent-amber-700"
                      />
                      I've reviewed these files — commit them anyway
                    </label>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder={
                      staged.length > 0
                        ? `Commit message (${staged.length} file${staged.length > 1 ? "s" : ""})`
                        : isNewFile
                          ? "Commit message (creates the file)"
                          : "Commit message"
                    }
                    className="h-9 flex-1 font-mono text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (canCommit) handleCommit();
                      }
                    }}
                  />
                  {(dirty || isNewFile) && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 shrink-0 gap-1.5"
                      onClick={handleStage}
                      disabled={committing}
                      title="Add this file to the staged changes"
                    >
                      <Plus className="size-4" />
                      {openFileIsStaged ? "Re-stage" : "Stage"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    className="h-9 shrink-0 gap-1.5"
                    onClick={handleCommit}
                    disabled={committing || !canCommit}
                  >
                    {committing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Github className="size-4" />
                    )}
                    {staged.length > 0
                      ? `Commit ${staged.length}`
                      : isNewFile
                        ? "Create"
                        : "Commit"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-6 text-center">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_35%,rgba(0,0,0,0.03),transparent)]"
              />
              <div className="relative w-full max-w-sm">
                {selectedRepo ? (
                  <>
                    <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-sm">
                      <FileCode2 className="size-4 text-neutral-500" />
                    </div>
                    <p className="mt-4 text-lg font-medium text-neutral-800">
                      Select a file to edit
                    </p>
                    <p className="mt-1.5 text-[15px] leading-7 text-neutral-500">
                      Pick a text file from the browser, or create a new one.
                      Changes commit to{" "}
                      <span className="font-mono text-neutral-600">
                        {currentBranch}
                      </span>
                      .
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-sm">
                      <Github className="size-4 text-neutral-500" />
                    </div>
                    <p className="mt-4 text-lg font-medium text-neutral-800">
                      Welcome back, @{connection.login}
                    </p>
                    <p className="mt-1.5 text-[15px] leading-7 text-neutral-500">
                      Pick a repository from the list to start browsing and
                      editing files.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ⌘K quick-jump to any file in the branch */}
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

      {/* Commit history + revert */}
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
          </div>
        </DialogContent>
      </Dialog>

      {/* Input dialog: new file / rename / new branch */}
      <InputDialog
        key={dialog?.kind ?? "closed"}
        open={dialog !== null}
        title={
          dialog?.kind === "newFile"
            ? "New file"
            : dialog?.kind === "rename"
              ? "Rename file"
              : "New branch"
        }
        label={
          dialog?.kind === "newFile"
            ? "Path of the new file, relative to the repository root."
            : dialog?.kind === "rename"
              ? "New path for this file, relative to the repository root."
              : `Branching off ${currentBranch}. The new branch gets everything that's on the current one.`
        }
        placeholder={
          dialog?.kind === "newFile"
            ? "src/new-file.ts"
            : dialog?.kind === "rename"
              ? "src/renamed.ts"
              : "feature/my-change"
        }
        initial={dialog?.kind === "rename" ? openFile?.path ?? "" : ""}
        confirmLabel={
          dialog?.kind === "newFile"
            ? "Create"
            : dialog?.kind === "rename"
              ? "Rename"
              : "Create branch"
        }
        busy={dialogBusy}
        onConfirm={handleDialogConfirm}
        onClose={() => {
          if (!dialogBusy) setDialog(null);
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {openFile?.path}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This commits a deletion on {currentBranch}. It can always be
              restored from Git history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
