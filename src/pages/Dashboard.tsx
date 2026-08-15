import { api } from "@/convex/_generated/api";
import { getCursorSync, setCursorSync } from "@/lib/cursorSync";
import { onEditorCursorMove } from "@/lib/editorRegistry";
import { useAuth } from "@/hooks/use-auth";
import {
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
import { secretRisk } from "@/lib/secrets";
import { clearPrDraft, readPrDraft } from "@/lib/prDraft";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ConnectScreen } from "@/components/workspace-shared";
import { WorkspaceView } from "@/components/WorkspaceView";
import { type DeploymentInfo } from "@/components/PreviewPanel";
import { useNetworkReconciliation } from "@/hooks/useNetworkReconciliation";
import { queueDraft } from "@/lib/offlineBuffer";

// Per-tab device id for live presence. Module-scope so it is generated once
// per page load (not on every render — keeps the component pure) and stays
// stable for the lifetime of this tab.
const DEVICE_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

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
  const aiSuggest = useAction(api.aiActions.aiSuggest);
  const listPullRequests = useAction(api.githubActions.listPullRequests);
  const mergePullRequest = useAction(api.githubActions.mergePullRequest);
  const disconnect = useMutation(api.github.disconnect);
  const saveWorkspaceState = useMutation(api.github.saveWorkspaceState);
  const workspaceState = useQuery(api.github.getWorkspaceState);

  // Billing: the user's plan (free → enterprise) + AI usage metering. When
  // Stripe isn't configured the app stays fully unlocked (configured: false),
  // so every gate below only activates once billing keys exist.
  const billing = useQuery(api.billing.plan);
  const aiUsage = useQuery(api.aiUsage.getAiUsage);
  const [billingOpen, setBillingOpen] = useState(false);

  // Team workspaces: share the current repo + branch with teammates via a
  // short code. Everyone joins with their own GitHub connection.
  const createSharedWorkspace = useMutation(api.github.createSharedWorkspace);
  const joinSharedWorkspace = useMutation(api.github.joinSharedWorkspace);
  const mySharedWorkspaces = useQuery(api.github.mySharedWorkspaces);

  // CI status: check runs + legacy status contexts on the branch tip.
  const getBranchChecks = useAction(api.githubActions.getBranchChecks);
  // PR review: files changed by a pull request, with unified diffs.
  const getPullRequestFiles = useAction(api.githubActions.getPullRequestFiles);
  // Full-text code search inside the repo (GitHub code search API).
  const searchCode = useAction(api.githubActions.searchCode);
  // Open issues for the repo.
  const listIssues = useAction(api.githubActions.listIssues);

  // Draft vault: autosave unsaved edits per (repo, branch, path), drop them
  // once committed, and list everything for the vault dialog.
  const saveDraft = useMutation(api.github.saveDraft);
  // Offline reconciliation writes buffered drafts back with a recency check,
  // so replay never clobbers a fresher draft another device saved.
  const saveDraftIfNewer = useMutation(api.github.saveDraftIfNewer);
  const deleteDraft = useMutation(api.github.deleteDraft);
  const getDraftContent = useMutation(api.github.getDraftContent);
  const drafts = useQuery(api.github.listDrafts);

  // Live deployment preview: the latest GitHub deployment for the branch
  // (Vercel / Netlify / Actions publish these), powering the Preview tab and
  // the deployment chip. `loadDeployment` lives below next to currentBranch;
  // this polling effect refreshes the chip every 30s while a repo is open.
  const getDeploymentStatus = useAction(api.deployments.getDeploymentStatus);
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  // Live presence: one row per browser tab. This tab heartbeats so other
  // devices see where it is, and we subscribe to everyone else's sessions.
  const updateLiveSession = useMutation(api.github.updateLiveSession);
  const clearLiveSession = useMutation(api.github.clearLiveSession);
  const liveSessions = useQuery(api.github.listLiveSessions, {
    deviceId: DEVICE_ID,
  });
  const deviceLabel = useMemo(() => {
    if (typeof navigator === "undefined") return "Device";
    const ua = navigator.userAgent;
    const mobile = /iPhone|iPad|Android/i.test(ua);
    const browser = ua.includes("Edg")
      ? "Edge"
      : ua.includes("Chrome")
        ? "Chrome"
        : ua.includes("Firefox")
          ? "Firefox"
          : ua.includes("Safari")
            ? "Safari"
            : "Browser";
    return `${browser} · ${mobile ? "Mobile" : "Desktop"}`;
  }, []);

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
  const [viewMode, setViewMode] = useState<"edit" | "diff" | "preview">("edit");
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

  // The AI assistant: a grounded, diff-gated proposal flow. The agent never
  // commits — it proposes changes that the user reviews and stages through
  // the normal staging pipeline.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{
    explanation: string;
    changes: Array<{
      path: string;
      action: "update" | "create";
      content: string;
      originalContent: string;
    }>;
  } | null>(null);

  // Pull requests: open PRs for the current repo + the PR queued for merging.
  const [prsOpen, setPrsOpen] = useState(false);
  const [prs, setPrs] = useState<
    Array<{
      number: number;
      title: string;
      htmlUrl: string;
      author: string;
      createdAt: string | null;
      draft: boolean;
      head: string;
      base: string;
      mergeable: boolean | null;
      mergeableState: string;
    }> | null
  >(null);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<{
    number: number;
    title: string;
  } | null>(null);
  const [merging, setMerging] = useState(false);

  // CI status: the branch tip's check runs + status contexts, and the dialog
  // that breaks them down.
  const [checksOpen, setChecksOpen] = useState(false);
  const [checks, setChecks] = useState<{
    sha: string;
    overall: "none" | "pending" | "failure" | "success";
    checkRuns: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
    }>;
    statusContexts: Array<{
      context: string;
      state: string;
      description: string | null;
      targetUrl: string | null;
    }>;
  } | null>(null);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checksError, setChecksError] = useState<string | null>(null);

  // Draft vault dialog (listDrafts is a reactive query — see `drafts`).
  const [vaultOpen, setVaultOpen] = useState(false);

  // Multi-turn AI: the running conversation (user asks + assistant summaries),
  // sent back into aiSuggest so follow-ups build on earlier turns.
  const [aiHistory, setAiHistory] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  // PR review: the pull request under review plus its changed files.
  const [prReview, setPrReview] = useState<{
    number: number;
    title: string;
  } | null>(null);
  const [prFiles, setPrFiles] = useState<
    Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch: string | null;
    }> | null
  >(null);
  const [prFilesLoading, setPrFilesLoading] = useState(false);
  const [prFilesError, setPrFilesError] = useState<string | null>(null);
  const [expandedPrFile, setExpandedPrFile] = useState<string | null>(null);

  // Full-text code search within the repo.
  const [codeSearchOpen, setCodeSearchOpen] = useState(false);
  const [codeQuery, setCodeQuery] = useState("");
  const [codeResults, setCodeResults] = useState<
    Array<{ path: string; name: string; htmlUrl: string }> | null
  >(null);
  const [codeSearchLoading, setCodeSearchLoading] = useState(false);
  const [codeSearchError, setCodeSearchError] = useState<string | null>(null);

  // Open issues for the repo.
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issues, setIssues] = useState<
    Array<{
      number: number;
      title: string;
      htmlUrl: string;
      author: string;
      createdAt: string | null;
      comments: number;
      body: string | null;
      labels: string[];
    }> | null
  >(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);

  // Cross-device continuity: guards so the restore doesn't clobber state the
  // user is actively changing. The caret itself lives in the shared cursor
  // store (see @/lib/cursorSync) — the editor writes it, we read it to save.
  const restoredRef = useRef(false);
  const restoringRef = useRef(false);

  // Stale-response guard: every file-open bumps this counter, so a slow older
  // request can't clobber the file the user just opened.
  const fileRequestRef = useRef(0);

  const currentBranch = branch ?? selectedRepo?.defaultBranch ?? null;

  // Live deployment preview — fetch + 30s polling for the branch's latest
  // GitHub deployment (Vercel / Netlify / Actions register these on push).
  const loadDeployment = useCallback(async () => {
    if (!selectedRepo || !currentBranch) return;
    const [owner, repo] = selectedRepo.fullName.split("/");
    if (!owner || !repo) return;
    setDeploymentLoading(true);
    try {
      const result = await getDeploymentStatus({
        owner,
        repo,
        branch: currentBranch,
      });
      setDeployment(result.deployment);
      setDeploymentError(result.error);
    } catch (e) {
      setDeploymentError(errorMessage(e));
    } finally {
      setDeploymentLoading(false);
    }
  }, [selectedRepo, currentBranch, getDeploymentStatus]);
  useEffect(() => {
    if (!selectedRepo || !currentBranch) {
      setDeployment(null);
      return;
    }
    void loadDeployment();
    const id = setInterval(() => void loadDeployment(), 30_000);
    return () => clearInterval(id);
  }, [selectedRepo, currentBranch, loadDeployment]);

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

  // Cross-device continuity: once both the repo list and the saved workspace
  // are ready, restore repo + branch + open file + draft + caret exactly where
  // the user left off on the other device. Runs exactly once. The restore is
  // deferred a tick so the effect exits before touching React state.
  useEffect(() => {
    if (restoredRef.current) return;
    if (repos === null || workspaceState === undefined) return; // still loading
    restoredRef.current = true;
    if (!workspaceState) return;
    const saved = workspaceState;
    const repo = repos.find((r) => r.fullName === saved.repo);
    if (!repo) return; // repo no longer accessible — don't force it
    const timer = setTimeout(() => {
      restoringRef.current = true;
      // Select repo + saved branch.
      setSelectedRepo(repo);
      setBranch(saved.branch);
      setBranches(null);
      setEntries(null);
      setStatus(null);
      setLastCommit(null);
      setPrResult(null);
      setStaged([]);
      setStagedDiffOpen(null);
      setAllowSecrets(false);
      setTreeFiles(null);
      setSearchOpen(false);
      setHistoryOpen(false);
      setHistory(null);
      setRevertTarget(null);
      setPrsOpen(false);
      setPrs(null);
      setChecks(null);
      setPath(saved.path ?? "");
      setViewMode("edit");
      loadEntries(repo, saved.branch, saved.path ?? "");
      loadBranches(repo);
      loadTreeFiles(repo, saved.branch);
      toast.success(
        saved.openPath
          ? `Resumed ${saved.repo} on ${saved.branch} — ${saved.openPath} is open${saved.draft ? ", with your unsaved edits" : ""}.`
          : `Resumed ${saved.repo} on ${saved.branch}.`,
      );
      if (saved.openPath) {
        const openPath = saved.openPath;
        void (async () => {
          try {
            const data = await getFile({
              owner: ownerOf(repo.fullName),
              repo: repoNameOf(repo.fullName),
              path: openPath,
              branch: saved.branch,
            });
            setOpenFile({ ...data, path: openPath });
            setIsNewFile(false);
            // Restore the unsaved draft when it differs from the committed file;
            // otherwise open the committed content.
            setEditorContent(
              saved.draft && saved.draft !== data.content
                ? saved.draft
                : data.content,
            );
            if (saved.cursorLine && saved.cursorColumn) {
              setCursorSync({
                line: saved.cursorLine,
                column: saved.cursorColumn,
              });
            }
          } catch {
            // File may have been deleted or renamed — just land on the repo.
          } finally {
            restoringRef.current = false;
          }
        })();
      } else {
        restoringRef.current = false;
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [
    repos,
    workspaceState,
    loadEntries,
    loadBranches,
    loadTreeFiles,
    getFile,
  ]);

  // Cross-device continuity: persist the workspace (debounced) so the other
  // device can pick up where this one left off. Skipped while restoring.
  // The same tick writes the draft vault row for the open file, so any
  // unsaved edit is resumable from any device (not just the last workspace).
  useEffect(() => {
    if (restoringRef.current) return;
    if (!selectedRepo || !currentBranch) return;
    const dirty =
      openFile !== null && !isNewFile && editorContent !== openFile.content;
    const timer = setTimeout(() => {
      void saveWorkspaceState({
        repo: selectedRepo.fullName,
        branch: currentBranch,
        path,
        openPath: openFile?.path,
        // Only persist content that differs from what's committed — a clean
        // file shouldn't resurrect stale edits on the other device.
        draft: openFile && (isNewFile || dirty) ? editorContent : undefined,
        cursorLine: getCursorSync()?.line,
        cursorColumn: getCursorSync()?.column,
      }).catch(() => {
        // Best-effort persistence — never interrupt the workspace for it.
      });
      // Draft vault: only files that actually have unsaved work. If the write
      // fails (weak Wi-Fi / dead zone / Convex hiccup), the edit is queued to
      // localStorage and replayed by useNetworkReconciliation on reconnect —
      // never silently dropped.
      if (openFile && (isNewFile || dirty)) {
        const draftArgs = {
          repo: selectedRepo.fullName,
          branch: currentBranch,
          path: openFile.path,
          content: editorContent,
          cursorLine: getCursorSync()?.line,
          cursorColumn: getCursorSync()?.column,
        };
        void saveDraft(draftArgs).catch(() => {
          queueDraft({
            ...draftArgs,
            cursorLine: draftArgs.cursorLine ?? null,
            cursorColumn: draftArgs.cursorColumn ?? null,
            updatedAt: Date.now(),
          });
        });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [
    selectedRepo,
    currentBranch,
    path,
    openFile,
    isNewFile,
    editorContent,
    saveWorkspaceState,
    saveDraft,
  ]);

  // Live presence: keep the freshest workspace context in a ref (updated on
  // every render), heartbeat it every 15s so other devices see this tab, and
  // remove the session when the workspace unmounts.
  const presenceRef = useRef<{
    repo: string | null;
    branch: string | null;
    path: string | null;
    cursorLine: number | null;
    cursorColumn: number | null;
  }>({ repo: null, branch: null, path: null, cursorLine: null, cursorColumn: null });
  useEffect(() => {
    presenceRef.current = {
      repo: selectedRepo?.fullName ?? null,
      branch: currentBranch,
      path: openFile?.path ?? path ?? null,
      cursorLine: getCursorSync()?.line ?? null,
      cursorColumn: getCursorSync()?.column ?? null,
    };
  });
  useEffect(() => {
    const beat = () => {
      const p = presenceRef.current;
      void updateLiveSession({
        deviceId: DEVICE_ID,
        label: deviceLabel,
        repo: p.repo ?? undefined,
        branch: p.branch ?? undefined,
        path: p.path ?? undefined,
        cursorLine: p.cursorLine ?? undefined,
        cursorColumn: p.cursorColumn ?? undefined,
      }).catch(() => {
        // Presence is best-effort — never interrupt the workspace for it.
      });
    };
    beat();
    const timer = setInterval(beat, 15_000);
    return () => {
      clearInterval(timer);
      void clearLiveSession({ deviceId: DEVICE_ID }).catch(() => {});
    };
  }, [updateLiveSession, clearLiveSession, deviceLabel]);

  // Live collaboration: push caret moves to the presence row immediately
  // (throttled) so other devices see the cursor move in near-real-time.
  useEffect(() => {
    let lastSent = 0;
    return onEditorCursorMove((cursor) => {
      const now = Date.now();
      if (now - lastSent < 1_200) return;
      lastSent = now;
      const p = presenceRef.current;
      void updateLiveSession({
        deviceId: DEVICE_ID,
        label: deviceLabel,
        repo: p.repo ?? undefined,
        branch: p.branch ?? undefined,
        path: p.path ?? undefined,
        cursorLine: cursor.line,
        cursorColumn: cursor.column,
      }).catch(() => {
        // Presence is best-effort.
      });
    });
  }, [updateLiveSession, deviceLabel]);

  // Offline safeguard: draft saves that failed while offline were queued to
  // localStorage; this hook replays the queue the moment connectivity
  // returns — via saveDraftIfNewer so a fresher draft from another device
  // always wins.
  const offlineToastShownRef = useRef(false);
  const { online, pendingCount: offlinePending, syncing: offlineSyncing } =
    useNetworkReconciliation({
      enabled: selectedRepo !== null,
      push: async (draft) => {
        await saveDraftIfNewer({
          repo: draft.repo,
          branch: draft.branch,
          path: draft.path,
          content: draft.content,
          cursorLine: draft.cursorLine ?? undefined,
          cursorColumn: draft.cursorColumn ?? undefined,
          updatedAt: draft.updatedAt,
        });
      },
      onSynced: (count) => {
        toast.success(
          `${count} offline edit${count > 1 ? "s" : ""} synced to the draft vault.`,
        );
      },
      onOffline: () => {
        if (!offlineToastShownRef.current) {
          offlineToastShownRef.current = true;
          toast.warning(
            "You're offline — edits are saved on this device and will sync when you're back.",
          );
        }
      },
    });
  useEffect(() => {
    if (online) offlineToastShownRef.current = false;
  }, [online]);

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

  const handleAiAsk = async () => {
    if (!selectedRepo || !currentBranch) return;
    const instruction = aiInstruction.trim();
    if (!instruction) return;
    // Quota gate: Free includes a monthly taste of Ask Aria; every tier's
    // quota is enforced server-side in the action. If this month's requests
    // are spent, nudge the user to upgrade instead of letting the action fail.
    if (
      billing?.configured &&
      aiUsage &&
      aiUsage.quota !== null &&
      aiUsage.used >= aiUsage.quota
    ) {
      setAiError(null);
      toast.error("You've used all your Ask Aria requests for this month.", {
        action: {
          label: "Upgrade",
          onClick: () => setBillingOpen(true),
        },
      });
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const result = await aiSuggest({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        branch: currentBranch,
        instruction,
        openFile:
          openFile && !isNewFile
            ? { path: openFile.path, content: editorContent }
            : undefined,
        // Multi-turn: send the running conversation so follow-ups build on
        // earlier turns instead of starting from scratch.
        history: aiHistory,
      });
      setAiResult(result);
      setAiHistory((prev) => [
        ...prev,
        { role: "user", content: instruction },
        { role: "assistant", content: result.explanation },
      ]);
    } catch (e) {
      setAiError(errorMessage(e));
    } finally {
      setAiLoading(false);
    }
  };

  /** Load the branch tip's CI checks (check runs + status contexts). */
  const loadChecks = useCallback(async () => {
    if (!selectedRepo || !currentBranch) return;
    setChecksLoading(true);
    setChecksError(null);
    try {
      const data = await getBranchChecks({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        branch: currentBranch,
      });
      setChecks(data);
    } catch (e) {
      setChecksError(errorMessage(e));
    } finally {
      setChecksLoading(false);
    }
  }, [selectedRepo, currentBranch, getBranchChecks]);

  /**
   * Restore a draft from the vault: fetch its full content, switch to its
   * repo/branch if needed, open the file, and load the unsaved content +
   * caret back into the editor.
   */
  const restoreDraft = async (draft: {
    repo: string;
    branch: string;
    path: string;
  }) => {
    if (!repos) return;
    const repo = repos.find((r) => r.fullName === draft.repo);
    if (!repo) {
      toast.error(
        `${draft.repo} is no longer accessible — can't restore the draft.`,
      );
      return;
    }
    let draftData: {
      content: string;
      cursorLine: number | null;
      cursorColumn: number | null;
    } | null = null;
    try {
      draftData = await getDraftContent({
        repo: draft.repo,
        branch: draft.branch,
        path: draft.path,
      });
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    if (!draftData) {
      toast.error("That draft no longer exists.");
      return;
    }
    setVaultOpen(false);
    const repoChanged = selectedRepo?.fullName !== draft.repo;
    if (repoChanged) {
      setSelectedRepo(repo);
      setBranch(draft.branch);
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
      setPrsOpen(false);
      setPrs(null);
      setMergeTarget(null);
      setChecks(null);
      setPath("");
      setViewMode("edit");
      loadEntries(repo, draft.branch, "");
      loadBranches(repo);
      loadTreeFiles(repo, draft.branch);
    } else if (draft.branch !== currentBranch) {
      handleSwitchBranch(draft.branch);
    }
    // Open the file and load the draft on top of it.
    const requestId = ++fileRequestRef.current;
    setFileLoading(true);
    setStatus(null);
    setCursorSync(null);
    try {
      const data = await getFile({
        owner: ownerOf(repo.fullName),
        repo: repoNameOf(repo.fullName),
        path: draft.path,
        branch: draft.branch,
      });
      if (requestId !== fileRequestRef.current) return;
      setOpenFile({ ...data, path: draft.path });
      setIsNewFile(false);
    } catch {
      // The file doesn't exist in the repo yet — the draft is a new file.
      if (requestId !== fileRequestRef.current) return;
      setOpenFile({
        content: "",
        sha: "",
        size: 0,
        truncated: false,
        path: draft.path,
      });
      setIsNewFile(true);
    } finally {
      if (requestId === fileRequestRef.current) setFileLoading(false);
    }
    setEditorContent(draftData.content);
    if (draftData.cursorLine && draftData.cursorColumn) {
      setCursorSync({ line: draftData.cursorLine, column: draftData.cursorColumn });
    }
    toast.success(`Restored draft — ${draft.path}`);
  };

  /** Open the review dialog for a pull request and load its changed files. */
  const openPrReview = async (pr: { number: number; title: string }) => {
    if (!selectedRepo) return;
    setPrsOpen(false);
    setPrReview(pr);
    setPrFiles(null);
    setPrFilesError(null);
    setExpandedPrFile(null);
    setPrFilesLoading(true);
    try {
      const files = await getPullRequestFiles({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        number: pr.number,
      });
      setPrFiles(files);
    } catch (e) {
      setPrFilesError(errorMessage(e));
    } finally {
      setPrFilesLoading(false);
    }
  };

  /** Run a full-text code search against the current repo. */
  const runCodeSearch = async () => {
    if (!selectedRepo || !codeQuery.trim()) return;
    setCodeSearchLoading(true);
    setCodeSearchError(null);
    try {
      const results = await searchCode({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        query: codeQuery.trim(),
      });
      setCodeResults(results);
    } catch (e) {
      setCodeSearchError(errorMessage(e));
    } finally {
      setCodeSearchLoading(false);
    }
  };

  /** Open a code-search result in the editor (on the current branch). */
  const handleCodeResultSelect = async (path: string) => {
    if (!selectedRepo || !currentBranch) return;
    setCodeSearchOpen(false);
    setCodeQuery("");
    setCodeResults(null);
    const requestId = ++fileRequestRef.current;
    setFileLoading(true);
    setStatus(null);
    setCursorSync(null);
    try {
      const data = await getFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path,
        branch: currentBranch,
      });
      if (requestId !== fileRequestRef.current) return;
      setOpenFile({ ...data, path });
      setEditorContent(data.content);
      setIsNewFile(false);
      setLastCommit(null);
      setPrResult(null);
    } catch (e) {
      if (requestId !== fileRequestRef.current) return;
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      if (requestId === fileRequestRef.current) setFileLoading(false);
    }
  };

  /** Load open issues for the current repo. */
  const loadIssues = useCallback(async () => {
    if (!selectedRepo) return;
    setIssuesLoading(true);
    setIssuesError(null);
    try {
      const data = await listIssues({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
      });
      setIssues(data);
    } catch (e) {
      setIssuesError(errorMessage(e));
    } finally {
      setIssuesLoading(false);
    }
  }, [selectedRepo, listIssues]);

  const stageAiChange = (change: {
    path: string;
    action: "update" | "create";
    content: string;
    originalContent: string;
  }) => {
    const risk = secretRisk(change.path, change.content);
    if (risk.risky) {
      toast.warning(
        "This proposed file looks like it contains secrets — Aria will ask you to confirm before committing it.",
      );
    }
    setStaged((prev) => [
      ...prev.filter((f) => f.path !== change.path),
      {
        path: change.path,
        originalContent: change.originalContent,
        content: change.content,
        sha: "",
        action: change.action,
      },
    ]);
    toast.success(`Staged ${change.path}`);
  };

  const stageAllAiChanges = () => {
    if (!aiResult) return;
    for (const change of aiResult.changes) stageAiChange(change);
    const n = aiResult.changes.length;
    setAiOpen(false);
    toast.success(
      `Staged ${n} change${n > 1 ? "s" : ""} — review the diffs before committing`,
    );
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
    setPrsOpen(false);
    setPrs(null);
    setMergeTarget(null);
    setChecks(null);
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
    setPrsOpen(false);
    setPrs(null);
    setMergeTarget(null);
    setChecks(null);
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
    setPrsOpen(false);
    setPrs(null);
    setMergeTarget(null);
    setChecks(null);
    setPath("");
    setViewMode("edit");
    loadEntries(selectedRepo, name, "");
    if (selectedRepo) loadTreeFiles(selectedRepo, name);
  };

  /** Join a teammate's shared workspace: switch to its repo + branch. */
  const handleJoinWorkspace = async (code: string): Promise<boolean> => {
    if (!repos) return false;
    let shared: { repo: string; branch: string; label: string | null } | null;
    try {
      shared = await joinSharedWorkspace({ code });
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
    if (!shared) {
      toast.error(`No workspace found for ${code}.`);
      return false;
    }
    const repo = repos.find((r) => r.fullName === shared.repo);
    if (!repo) {
      toast.error(
        `You don't have access to ${shared.repo} — ask the owner to add you as a collaborator.`,
      );
      return false;
    }
    // Same reset pattern as repo selection, but landing on the shared branch.
    setSelectedRepo(repo);
    setBranch(shared.branch);
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
    setPrsOpen(false);
    setPrs(null);
    setMergeTarget(null);
    setChecks(null);
    setPath("");
    setViewMode("edit");
    loadEntries(repo, shared.branch, "");
    loadBranches(repo);
    loadTreeFiles(repo, shared.branch);
    toast.success(`Joined ${shared.repo} on ${shared.branch}`);
    return true;
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

  const handleOpenEntry = async (entry: DirEntry) => {
    if (!selectedRepo || !currentBranch) return;
    if (entry.type === "dir") {
      setPath(entry.path);
      loadEntries(selectedRepo, currentBranch, entry.path);
      return;
    }
    const requestId = ++fileRequestRef.current;
    setFileLoading(true);
    setStatus(null);
    setCursorSync(null);
    try {
      const data = await getFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path: entry.path,
        branch: currentBranch,
      });
      if (requestId !== fileRequestRef.current) return;
      setOpenFile({ ...data, path: entry.path });
      setEditorContent(data.content);
      setIsNewFile(false);
      setLastCommit(null);
      setPrResult(null);
    } catch (e) {
      if (requestId !== fileRequestRef.current) return;
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      if (requestId === fileRequestRef.current) setFileLoading(false);
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
    const requestId = ++fileRequestRef.current;
    setFileLoading(true);
    setStatus(null);
    setCursorSync(null);
    try {
      const data = await getFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path,
        branch: currentBranch,
      });
      if (requestId !== fileRequestRef.current) return;
      setOpenFile({ ...data, path });
      setEditorContent(data.content);
      setIsNewFile(false);
      setLastCommit(null);
      setPrResult(null);
    } catch (e) {
      if (requestId !== fileRequestRef.current) return;
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      if (requestId === fileRequestRef.current) setFileLoading(false);
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
        setCursorSync(null);
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
        // Drop the committed files from the draft vault.
        for (const f of staged) {
          void deleteDraft({
            repo: selectedRepo.fullName,
            branch: currentBranch,
            path: f.path,
          }).catch(() => {});
        }
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
      // Drop the committed file from the draft vault.
      void deleteDraft({
        repo: selectedRepo.fullName,
        branch: currentBranch,
        path: openFile.path,
      }).catch(() => {});
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
      // An AI review may have staged a title/body draft (per-device) — use it
      // when present, otherwise fall back to the commit message as the title.
      const draft = readPrDraft();
      const result = await createPullRequest({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        title: draft?.title || lastCommit.message,
        body: draft?.body || undefined,
        head: currentBranch,
        base: selectedRepo.defaultBranch,
      });
      setPrResult(result);
      clearPrDraft();
      toast.success(`Pull request #${result.number} opened`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPrOpen(false);
    }
  };

  const loadPullRequests = useCallback(async () => {
    if (!selectedRepo) return;
    setPrsLoading(true);
    setPrsError(null);
    try {
      const data = await listPullRequests({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
      });
      setPrs(data);
    } catch (e) {
      setPrsError(errorMessage(e));
    } finally {
      setPrsLoading(false);
    }
  }, [selectedRepo, listPullRequests]);

  const handleMergePr = async () => {
    if (!selectedRepo || !mergeTarget) return;
    setMerging(true);
    try {
      const result = await mergePullRequest({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        number: mergeTarget.number,
      });
      setMergeTarget(null);
      toast.success(result.message || `Merged pull request #${mergeTarget.number}`);
      // Refresh the PR list, and if the merge landed on the branch we're
      // viewing, refresh the workspace too.
      loadPullRequests();
      if (currentBranch === selectedRepo.defaultBranch) {
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
            // The merge may have touched this file — close it gracefully.
            setOpenFile(null);
            setEditorContent("");
          }
        }
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setMerging(false);
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
    setPrsOpen(false);
    setPrs(null);
    setMergeTarget(null);
    setChecks(null);
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

  // The in-browser git engine (LocalGitDialog) calls this after clone, push,
  // checkout, merge or rebase so the API-driven workspace reflects the new
  // GitHub state: refresh the file tree, quick-jump index, branches, history
  // and any open file.
  const refreshWorkspace = useCallback(() => {
    if (!selectedRepo || !currentBranch) return;
    loadEntries(selectedRepo, currentBranch, path);
    loadTreeFiles(selectedRepo, currentBranch);
    loadBranches(selectedRepo);
    if (openFile && !isNewFile) {
      void getFile({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        path: openFile.path,
        branch: currentBranch,
      })
        .then((data) => {
          setOpenFile({ ...data, path: openFile.path });
          setEditorContent(data.content);
        })
        .catch(() => {
          // The operation may have moved or removed the file — close it.
          setOpenFile(null);
          setEditorContent("");
        });
    }
  }, [
    selectedRepo,
    currentBranch,
    path,
    openFile,
    isNewFile,
    loadEntries,
    loadTreeFiles,
    loadBranches,
    getFile,
  ]);

  return (
    <WorkspaceView
      connection={connection}
      currentBranch={currentBranch}
      mobileView={mobileView}
      reposLoading={reposLoading}
      reposError={reposError}
      repoQuery={repoQuery}
      setRepoQuery={setRepoQuery}
      selectedRepo={selectedRepo}
      loadRepos={loadRepos}
      handleSelectRepo={handleSelectRepo}
      handleBackToRepos={handleBackToRepos}
      filteredRepos={filteredRepos}
      entries={entries}
      entriesLoading={entriesLoading}
      entriesError={entriesError}
      sortedEntries={sortedEntries}
      path={path}
      setPath={setPath}
      pathSegments={pathSegments}
      handleOpenEntry={handleOpenEntry}
      handleBreadcrumb={handleBreadcrumb}
      loadEntries={loadEntries}
      branches={branches}
      branchesLoading={branchesLoading}
      handleSwitchBranch={handleSwitchBranch}
      setDialog={setDialog}
      openFile={openFile}
      setOpenFile={setOpenFile}
      isNewFile={isNewFile}
      editorContent={editorContent}
      setEditorContent={setEditorContent}
      viewMode={viewMode}
      setViewMode={setViewMode}
      deployment={deployment}
      deploymentLoading={deploymentLoading}
      deploymentError={deploymentError}
      loadDeployment={loadDeployment}
      offline={{ online, pending: offlinePending, syncing: offlineSyncing }}
      fileLoading={fileLoading}
      dirty={dirty}
      openFileIsStaged={openFileIsStaged}
      status={status}
      lastCommit={lastCommit}
      prResult={prResult}
      handleOpenPr={handleOpenPr}
      prOpen={prOpen}
      staged={staged}
      setStaged={setStaged}
      stagedDiffOpen={stagedDiffOpen}
      setStagedDiffOpen={setStagedDiffOpen}
      handleUnstage={handleUnstage}
      flaggedSecretPaths={flaggedSecretPaths}
      allowSecrets={allowSecrets}
      setAllowSecrets={setAllowSecrets}
      commitMessage={commitMessage}
      setCommitMessage={setCommitMessage}
      canCommit={canCommit}
      handleCommit={handleCommit}
      handleStage={handleStage}
      committing={committing}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      treeFilesLoading={treeFilesLoading}
      treeFiles={treeFiles}
      searchResults={searchResults}
      handleSearchSelect={handleSearchSelect}
      historyOpen={historyOpen}
      setHistoryOpen={setHistoryOpen}
      historyLoading={historyLoading}
      history={history}
      historyError={historyError}
      loadHistory={loadHistory}
      revertTarget={revertTarget}
      setRevertTarget={setRevertTarget}
      reverting={reverting}
      handleRevert={handleRevert}
      prsOpen={prsOpen}
      setPrsOpen={setPrsOpen}
      prs={prs}
      prsLoading={prsLoading}
      prsError={prsError}
      loadPullRequests={loadPullRequests}
      openPrReview={openPrReview}
      mergeTarget={mergeTarget}
      setMergeTarget={setMergeTarget}
      merging={merging}
      handleMergePr={handleMergePr}
      checksOpen={checksOpen}
      setChecksOpen={setChecksOpen}
      checks={checks}
      checksLoading={checksLoading}
      checksError={checksError}
      loadChecks={loadChecks}
      vaultOpen={vaultOpen}
      setVaultOpen={setVaultOpen}
      drafts={drafts}
      restoreDraft={restoreDraft}
      prReview={prReview}
      setPrReview={setPrReview}
      prFiles={prFiles}
      setPrFiles={setPrFiles}
      prFilesLoading={prFilesLoading}
      prFilesError={prFilesError}
      expandedPrFile={expandedPrFile}
      setExpandedPrFile={setExpandedPrFile}
      codeSearchOpen={codeSearchOpen}
      setCodeSearchOpen={setCodeSearchOpen}
      codeQuery={codeQuery}
      setCodeQuery={setCodeQuery}
      codeResults={codeResults}
      setCodeResults={setCodeResults}
      codeSearchLoading={codeSearchLoading}
      codeSearchError={codeSearchError}
      setCodeSearchError={setCodeSearchError}
      runCodeSearch={runCodeSearch}
      handleCodeResultSelect={handleCodeResultSelect}
      issuesOpen={issuesOpen}
      setIssuesOpen={setIssuesOpen}
      issues={issues}
      issuesLoading={issuesLoading}
      issuesError={issuesError}
      loadIssues={loadIssues}
      aiOpen={aiOpen}
      setAiOpen={setAiOpen}
      aiHistory={aiHistory}
      setAiHistory={setAiHistory}
      aiInstruction={aiInstruction}
      setAiInstruction={setAiInstruction}
      aiLoading={aiLoading}
      aiError={aiError}
      setAiError={setAiError}
      aiResult={aiResult}
      setAiResult={setAiResult}
      handleAiAsk={handleAiAsk}
      stageAiChange={stageAiChange}
      stageAllAiChanges={stageAllAiChanges}
      liveSessions={liveSessions}
      billing={billing}
      billingOpen={billingOpen}
      setBillingOpen={setBillingOpen}
      mySharedWorkspaces={mySharedWorkspaces}
      handleJoinWorkspace={handleJoinWorkspace}
      createSharedWorkspace={createSharedWorkspace}
      handleDisconnect={handleDisconnect}
      handleSignOut={handleSignOut}
      onRefreshWorkspace={refreshWorkspace}
      dialog={dialog}
      dialogBusy={dialogBusy}
      handleDialogConfirm={handleDialogConfirm}
      deleteOpen={deleteOpen}
      setDeleteOpen={setDeleteOpen}
      deleting={deleting}
      handleDelete={handleDelete}
    />
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
  const billingParam = searchParams.get("billing");

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

  // Billing return toasts: the Stripe checkout/portal redirects back here with
  // ?billing=success|cancelled. The plan query updates reactively.
  useEffect(() => {
    if (billingParam) {
      if (billingParam === "success") {
        toast.success("Welcome to Aria Pro!");
      } else if (billingParam === "cancelled") {
        toast.info("Checkout cancelled — you're still on Free.");
      }
      setSearchParams({}, { replace: true });
    }
  }, [billingParam, setSearchParams]);

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
