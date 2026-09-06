import { api } from "@/convex/_generated/api";
import { getCursorSync, setCursorSync } from "@/lib/cursorSync";
import { getScrollSync, setScrollSync } from "@/lib/scrollSync";
import {
  publishTabs,
  registerTabActions,
} from "@/lib/tabsBus";
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
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ConnectScreen } from "@/components/workspace-shared";
import { WorkspaceView } from "@/components/WorkspaceView";
import { useDeployment } from "@/pages/dashboard/hooks/useDeployment";
import { useCiChecks } from "@/pages/dashboard/hooks/useCiChecks";
import { useIssues } from "@/pages/dashboard/hooks/useIssues";
import { useCodeSearch } from "@/pages/dashboard/hooks/useCodeSearch";
import { useCommitHistory } from "@/pages/dashboard/hooks/useCommitHistory";
import { usePullRequests } from "@/pages/dashboard/hooks/usePullRequests";
import { useNetworkReconciliation } from "@/hooks/useNetworkReconciliation";
import {
  clearPendingCommit,
  pendingCommitCount,
  pendingCommits,
  queueCommit,
  queueDraft,
  getOfflineAccount,
  offlineStorageDurable,
} from "@/lib/offlineBuffer";

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

/** True when a Convex/GitHub failure looks like a connectivity problem
 *  (used by the offline commit queue — network failures queue the commit
 *  instead of losing it). */
function isNetworkError(message: string): boolean {
  return /failed to fetch|networkerror|network error|offline|ecoconn|fetch failed|timeout|enetdown|socket hang up/i.test(
    message,
  );
}

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
  const { signOut, user } = useAuth();
  const accountId = user!._id;
  const navigate = useNavigate();
  useEffect(() => {
    const warn = () => toast.warning("Browser storage is unavailable. Your offline work is held in this tab only; keep it open until it syncs.", { id: "offline-storage" });
    window.addEventListener("aria-storage-unavailable", warn);
    return () => window.removeEventListener("aria-storage-unavailable", warn);
  }, []);


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
  const aiSuggest = useAction(api.aiActions.aiSuggest);
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

  // Draft vault: autosave unsaved edits per (repo, branch, path), drop them
  // once committed, and list everything for the vault dialog.
  const saveDraft = useMutation(api.github.saveDraft);
  // Offline reconciliation writes buffered drafts back with a recency check,
  // so replay never clobbers a fresher draft another device saved.
  const saveDraftIfNewer = useMutation(api.github.saveDraftIfNewer);
  const deleteDraft = useMutation(api.github.deleteDraft);
  const getDraftContent = useMutation(api.github.getDraftContent);
  const drafts = useQuery(api.github.listDrafts);

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

  // Tabs (Phase 1): the ordered list of open files (content lives in the draft vault). Content is NOT cached
  // here — the active tab's buffer is `editorContent`, and every tab's
  // unsaved content is flushed to the draft vault on switch/close, so each
  // tab is independently resumable and cross-device safe (the vault is the
  // per-tab buffer, matching the draft-vault architecture).
  const [tabs, setTabs] = useState<Array<{ path: string; isNewFile: boolean }>>(
    [],
  );

  // Editor state (declared before the tab handlers so the registry effects
  // and loadFileIntoEditor below can reference them — they're owned here,
  // not in WorkspaceView, so they persist/restore with the workspace).
  const [editorContent, setEditorContent] = useState("");
  const [viewMode, setViewMode] = useState<"edit" | "diff" | "preview">("edit");
  // Layout (Phase 1): focus mode collapses the sidebars while typing — lifted
  // from WorkspaceView so it can be persisted/restored with the workspace.
  const [focusMode, setFocusMode] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  // Stale-response guard: every file-open bumps this counter, so a slow older
  // request can't clobber the file the user just opened.
  const fileRequestRef = useRef(0);
  const currentBranch = branch ?? selectedRepo?.defaultBranch ?? null;

  // Tab registry: keep the active file present in the tab list. Every open
  // flow (tree click, draft restore, new file, commit refresh) sets openFile
  // directly, and this effect makes sure it also becomes/updates a tab — so
  // no existing open flow needed rewriting.
  useEffect(() => {
    if (!openFile) return;
    setTabs((prev) => {
      const existing = prev.find((t) => t.path === openFile!.path);
      if (existing) {
        if (existing.isNewFile === isNewFile) return prev;
        return prev.map((t) =>
          t.path === openFile!.path ? { ...t, isNewFile } : t,
        );
      }
      return [...prev, { path: openFile!.path, isNewFile }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile?.path, isNewFile]);

  /**
   * Load a file (by path) into the editor, pulling its vault draft on top of
   * the committed content — the same logic the draft restorer uses. Falls
   * back to new-file mode when the file doesn't exist in the repo yet.
   */
  const loadFileIntoEditor = useCallback(
    async (path: string) => {
      if (!selectedRepo || !currentBranch) return;
      const tab = tabs.find((t) => t.path === path);
      const requestId = ++fileRequestRef.current;
      setFileLoading(true);
      setStatus(null);
      setCursorSync(null);
      try {
        let draftData: { content: string } | null = null;
        try {
          draftData = await getDraftContent({
            repo: selectedRepo.fullName,
            branch: currentBranch,
            path,
          });
        } catch {
          draftData = null; // vault hiccup — open committed content
        }
        if (tab?.isNewFile) {
          setOpenFile({ content: "", sha: "", size: 0, truncated: false, path });
          setIsNewFile(true);
          setEditorContent(draftData?.content ?? "");
          setViewMode("edit");
          return;
        }
        const data = await getFile({
          owner: ownerOf(selectedRepo.fullName),
          repo: repoNameOf(selectedRepo.fullName),
          path,
          branch: currentBranch,
        });
        if (requestId !== fileRequestRef.current) return;
        setOpenFile({ ...data, path });
        setIsNewFile(false);
        setEditorContent(
          draftData && draftData.content !== data.content
            ? draftData.content
            : data.content,
        );
        setViewMode("edit");
      } catch {
        if (requestId !== fileRequestRef.current) return;
        // The file isn't in the repo — if a vault draft exists, open as new.
        setOpenFile({ content: "", sha: "", size: 0, truncated: false, path });
        setIsNewFile(true);
        setEditorContent("");
        setStatus(null);
        setViewMode("edit");
      } finally {
        if (requestId === fileRequestRef.current) setFileLoading(false);
      }
    },
    [
      selectedRepo,
      currentBranch,
      tabs,
      getFile,
      getDraftContent,
      setViewMode,
      setStatus,
    ],
  );

  /** Immediately flush the active tab's unsaved content to the vault. */
  const flushCurrentDraft = useCallback(() => {
    if (!selectedRepo || !currentBranch || !openFile) return;
    const dirty = !isNewFile && editorContent !== openFile.content;
    if (!isNewFile && !dirty) return;
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
      }, accountId);
    });
  }, [selectedRepo, currentBranch, openFile, isNewFile, editorContent, saveDraft]);

  /** Switch to another open tab (flushing the outgoing tab's content). */
  const switchTab = useCallback(
    (path: string) => {
      if (!openFile || openFile.path === path) return;
      flushCurrentDraft();
      void loadFileIntoEditor(path);
    },
    [openFile, flushCurrentDraft, loadFileIntoEditor],
  );

  /** Close a tab; when it was active, activate the neighbor (or clear). */
  const closeTab = useCallback(
    (path: string) => {
      const idx = tabs.findIndex((t) => t.path === path);
      const wasActive = openFile?.path === path;
      const next = tabs.filter((t) => t.path !== path);
      if (wasActive) flushCurrentDraft();
      setTabs(next);
      if (wasActive) {
        const neighbor = next[idx] ?? next[idx - 1] ?? null;
        if (neighbor) {
          void loadFileIntoEditor(neighbor.path);
        } else {
          setOpenFile(null);
          setIsNewFile(false);
          setEditorContent("");
          setCursorSync(null);
        }
      }
    },
    [tabs, openFile, flushCurrentDraft, loadFileIntoEditor],
  );

  // Tabs bus: publish the tab list + active path for the tab bar, and expose
  // the switch/close handlers to it. (The bar lives in WorkspaceView; this
  // keeps the two decoupled without threading more props through the giant
  // workspace prop surface.)
  useEffect(() => {
    publishTabs(tabs, openFile?.path ?? null);
  }, [tabs, openFile?.path]);
  useEffect(() => {
    registerTabActions({ switchTab, closeTab });
  }, [switchTab, closeTab]);

  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
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

  // ⌘P quick-jump: every file in the current branch, loaded once per branch.
  const [treeFiles, setTreeFiles] = useState<Array<{ path: string; size: number }> | null>(
    null,
  );
  const [treeFilesLoading, setTreeFilesLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  // Draft vault dialog (listDrafts is a reactive query — see `drafts`).
  const [vaultOpen, setVaultOpen] = useState(false);

  // Multi-turn AI: the running conversation (user asks + assistant summaries),
  // sent back into aiSuggest so follow-ups build on earlier turns.
  const [aiHistory, setAiHistory] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  // Phase 1: AI conversation context — persist the running Ask Aria
  // conversation so it survives a refresh, a closed dialog, or a move to
  // another device (the saved turns feed aiSuggest's `history` on the next
  // follow-up, exactly like the live session's turns).
  const savedConversation = useQuery(api.aiConversations.getConversation);
  const saveConversation = useMutation(api.aiConversations.saveConversation);
  const conversationLoadedRef = useRef(false);

  // Load once, when the saved conversation arrives — never clobber an active
  // conversation on reactive re-fires.
  useEffect(() => {
    if (conversationLoadedRef.current) return;
    if (savedConversation === undefined) return; // still loading
    conversationLoadedRef.current = true;
    setAiHistory(savedConversation);
  }, [savedConversation, setAiHistory]);

  // Debounced save: every turn lands server-side shortly after it's added;
  // an empty history ("New conversation") clears the saved row.
  useEffect(() => {
    if (!conversationLoadedRef.current) return;
    const timer = setTimeout(() => {
      void saveConversation({
        turns: aiHistory
          .slice(-24)
          .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) })),
      }).catch(() => {
        // Best-effort — a failed save only means the conversation doesn't
        // carry over; the live session is unaffected.
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [aiHistory, saveConversation]);

  // Cross-device continuity: guards so the restore doesn't clobber state the
  // user is actively changing. The caret itself lives in the shared cursor
  // store (see @/lib/cursorSync) — the editor writes it, we read it to save.
  const restoredRef = useRef(false);
  const restoringRef = useRef(false);
  // Deep-link target (?repo=&branch=&path=), captured once from the URL. The
  // restore effect prefers it over the last-saved workspace, so the
  // extension/desktop "Open in Aria" (and any shared link) jumps straight to
  // the file instead of landing on whatever was open before.
  const [searchParams] = useSearchParams();
  const deepLinkRef = useRef<{
    repo: string;
    branch: string | null;
    path: string | null;
  } | null>(null);
  if (deepLinkRef.current === null) {
    const repo = searchParams.get("repo");
    if (repo) {
      deepLinkRef.current = {
        repo,
        branch: searchParams.get("branch"),
        path: searchParams.get("path"),
      };
    }
  }

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

  // ---------------------------------------------------------------------------
  // Decoupled concern hooks (see src/pages/dashboard/hooks). Each owns its own
  // state + loader, so Workspace only orchestrates them.
  // ---------------------------------------------------------------------------

  /** Refresh the workspace after a server-side branch-tip change (a revert). */
  const refreshAfterTipChange = async (repo: Repository, repoBranch: string) => {
    setLastCommit(null);
    setPrResult(null);
    loadEntries(repo, repoBranch, path);
    if (openFile && !isNewFile) {
      try {
        const data = await getFile({
          owner: ownerOf(repo.fullName),
          repo: repoNameOf(repo.fullName),
          path: openFile.path,
          branch: repoBranch,
        });
        setOpenFile({ ...data, path: openFile.path });
        setEditorContent(data.content);
      } catch {
        // The change may have removed this file — close it gracefully.
        setOpenFile(null);
        setEditorContent("");
      }
    }
  };

  /** Refresh the workspace after merging a PR onto the branch being viewed. */
  const refreshAfterMerge = async (repo: Repository, repoBranch: string) => {
    loadEntries(repo, repoBranch, path);
    if (openFile && !isNewFile) {
      try {
        const data = await getFile({
          owner: ownerOf(repo.fullName),
          repo: repoNameOf(repo.fullName),
          path: openFile.path,
          branch: repoBranch,
        });
        setOpenFile({ ...data, path: openFile.path });
        setEditorContent(data.content);
      } catch {
        // The merge may have touched this file — close it gracefully.
        setOpenFile(null);
        setEditorContent("");
      }
    }
  };

  const {
    deployment,
    deploymentLoading,
    deploymentError,
    loadDeployment,
  } = useDeployment({ selectedRepo, currentBranch });

  const {
    checksOpen,
    setChecksOpen,
    checks,
    setChecks,
    checksLoading,
    checksError,
    loadChecks,
  } = useCiChecks({ selectedRepo, currentBranch });

  const {
    issuesOpen,
    setIssuesOpen,
    issues,
    setIssues,
    issuesLoading,
    issuesError,
    loadIssues,
  } = useIssues({ selectedRepo });

  const {
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
  } = useCodeSearch({ selectedRepo });

  const {
    historyOpen,
    setHistoryOpen,
    history,
    setHistory,
    historyLoading,
    historyError,
    historyPage,
    loadMoreHistory,
    revertTarget,
    setRevertTarget,
    reverting,
    loadHistory,
    handleRevert,
  } = useCommitHistory({
    selectedRepo,
    currentBranch,
    onWorkspaceChanged: refreshAfterTipChange,
  });

  const {
    prsOpen,
    setPrsOpen,
    prs,
    setPrs,
    prsLoading,
    prsError,
    mergeTarget,
    setMergeTarget,
    merging,
    loadPullRequests,
    handleMergePr,
    prReview,
    setPrReview,
    prFiles,
    setPrFiles,
    prFilesLoading,
    prFilesError,
    expandedPrFile,
    setExpandedPrFile,
    openPrReview,
  } = usePullRequests({
    selectedRepo,
    currentBranch,
    onMergedOntoCurrentBranch: refreshAfterMerge,
  });

  // Cross-device continuity: once both the repo list and the saved workspace
  // are ready, restore repo + branch + open file + draft + caret exactly where
  // the user left off on the other device. Runs exactly once. The restore is
  // deferred a tick so the effect exits before touching React state.
  useEffect(() => {
    if (restoredRef.current) return;
    if (repos === null || workspaceState === undefined) return; // still loading
    restoredRef.current = true;
    // A deep link (?repo=&branch=&path= — extension/desktop "Open in Aria" or
    // a shared URL) takes priority over the last-saved workspace.
    const deep = deepLinkRef.current;
    if (!workspaceState && !deep) return;
    const saved = workspaceState;
    const repo = repos.find((r) => r.fullName === (deep?.repo ?? saved?.repo));
    if (!repo) return; // repo no longer accessible — don't force it
    const branch = deep?.branch ?? saved?.branch ?? repo.defaultBranch;
    const openPath = deep?.path ?? saved?.openPath;
    const dirPath = openPath?.includes("/")
      ? openPath.slice(0, openPath.lastIndexOf("/"))
      : saved?.path ?? "";
    const timer = setTimeout(() => {
      restoringRef.current = true;
      // Select repo + branch (deep link or saved).
      setSelectedRepo(repo);
      setBranch(branch);
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
      setPath(dirPath);
      // Restore the open tabs (paths only — content loads on demand from
      // GitHub + the draft vault when each tab is activated). The active tab
      // is added/kept by the tab-registry effect.
      setTabs(
        (saved?.openTabs ?? [])
          .filter((p) => p)
          .slice(0, 10)
          .map((p) => ({ path: p, isNewFile: false })),
      );
      // Restore the active panel + layout exactly as left (defaults when
      // missing — older saves predate these fields).
      setViewMode(saved?.viewMode ?? "edit");
      setFocusMode(saved?.focusMode ?? false);
      // Restore the editor scroll offset so the open file lands where it was.
      setScrollSync(
        saved?.scrollTop != null
          ? { top: saved.scrollTop, left: saved.scrollLeft ?? 0 }
          : null,
      );
      loadEntries(repo, branch, dirPath);
      loadBranches(repo);
      loadTreeFiles(repo, branch);
      toast.success(
        openPath
          ? deep
            ? `Opened ${repo.fullName} — ${openPath}`
            : `Resumed ${repo.fullName} on ${branch} — ${openPath} is open${saved?.draft ? ", with your unsaved edits" : ""}.`
          : `Resumed ${repo.fullName} on ${branch}.`,
      );
      if (openPath) {
        void (async () => {
          try {
            const data = await getFile({
              owner: ownerOf(repo.fullName),
              repo: repoNameOf(repo.fullName),
              path: openPath,
              branch,
            });
            setOpenFile({ ...data, path: openPath });
            setIsNewFile(false);
            // Restore the unsaved draft when it differs from the committed file;
            // otherwise open the committed content.
            setEditorContent(
              saved?.draft && saved.draft !== data.content
                ? saved.draft
                : data.content,
            );
            if (saved?.cursorLine && saved?.cursorColumn) {
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
    const dirty = openFile !== null && !isNewFile && editorContent !== openFile.content;
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
        // Phase 1: open tabs + scroll offset + active panel + layout so the
        // restored workspace looks and feels exactly like it was left.
        openTabs: tabs.map((t) => t.path),
        scrollTop: getScrollSync()?.top,
        scrollLeft: getScrollSync()?.left,
        viewMode,
        focusMode,
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
          }, accountId);
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
    tabs,
    viewMode,
    focusMode,
    saveWorkspaceState,
    saveDraft,
  ]);

  // Cross-device continuity: the moment the tab is hidden or closed (switching
  // to the phone, backgrounding the app, closing the tab), flush the workspace
  // state + draft immediately instead of waiting for the debounce above —
  // otherwise the last second of work can be missing on the other device. The
  // draft is written to the offline buffer first (synchronous, survives the
  // tab being killed), then the server is updated best-effort. The replay is
  // deduped by recency, so it can never clobber a newer draft another device
  // saved while this one was away.
  useEffect(() => {
    const flush = () => {
      if (restoringRef.current) return;
      if (!selectedRepo || !currentBranch) return;
      const dirty =
        openFile !== null && !isNewFile && editorContent !== openFile.content;
      void saveWorkspaceState({
        repo: selectedRepo.fullName,
        branch: currentBranch,
        path,
        openPath: openFile?.path,
        draft: openFile && (isNewFile || dirty) ? editorContent : undefined,
        cursorLine: getCursorSync()?.line,
        cursorColumn: getCursorSync()?.column,
        openTabs: tabs.map((t) => t.path),
        scrollTop: getScrollSync()?.top,
        scrollLeft: getScrollSync()?.left,
        viewMode,
        focusMode,
      }).catch(() => {
        // Best-effort — the offline draft buffer still has the content.
      });
      if (openFile && (isNewFile || dirty)) {
        const draftArgs = {
          repo: selectedRepo.fullName,
          branch: currentBranch,
          path: openFile.path,
          content: editorContent,
          cursorLine: getCursorSync()?.line,
          cursorColumn: getCursorSync()?.column,
        };
        queueDraft({
          ...draftArgs,
          cursorLine: draftArgs.cursorLine ?? null,
          cursorColumn: draftArgs.cursorColumn ?? null,
          updatedAt: Date.now(),
        }, accountId);
        void saveDraft(draftArgs).catch(() => {
          // The queue above already holds it — replay happens on reconnect.
        });
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [
    selectedRepo,
    currentBranch,
    path,
    openFile,
    isNewFile,
    editorContent,
    tabs,
    viewMode,
    focusMode,
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

  // Offline commits: handleCommit queues the full staged change set when the
  // network is down; this effect replays the queue oldest-first through the
  // normal commit action the moment connectivity returns.
  const commitFlushRef = useRef(false);
  const [pendingCommitsVersion, setPendingCommitsVersion] = useState(0);
  useEffect(() => {
    if (!online || !selectedRepo) return;
    const flush = async () => {
      if (commitFlushRef.current) return;
      commitFlushRef.current = true;
      try {
        const queued = pendingCommits();
        let replayed = 0;
        for (const c of queued) {
          if (getOfflineAccount() !== accountId) break;
          try {
            await commitChanges({
              owner: ownerOf(c.repo),
              repo: repoNameOf(c.repo),
              branch: c.branch,
              message: c.message,
              allowSecrets: c.allowSecrets ?? false,
              files: c.files.map((f) => ({
                path: f.path,
                action: f.action,
                expectedSha: f.expectedSha,
                ...(f.content !== undefined ? { content: f.content } : {}),
                ...(f.contentBase64 !== undefined ? { contentBase64: f.contentBase64 } : {}),
                ...(f.mode !== undefined ? { mode: f.mode } : {}),
                ...(f.gitlink !== undefined ? { gitlink: f.gitlink } : {}),
              })),
            });
            if (getOfflineAccount() !== accountId) break;
            clearPendingCommit(c.id);
            replayed++;
          } catch {
            // One failed replay keeps the rest queued — retry next reconnect.
            break;
          }
        }
        if (replayed > 0) {
          setPendingCommitsVersion((v) => v + 1);
          toast.success(
            `${replayed} offline commit${replayed > 1 ? "s" : ""} pushed to GitHub.`,
          );
        }
      } finally {
        commitFlushRef.current = false;
      }
    };
    void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, selectedRepo, pendingCommitsVersion]);

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

  // ⌘P / Ctrl+P opens the file quick-jump. (⌘K belongs to the command
  // palette alone — previously both surfaces fired on the same key, so the
  // palette and the file picker opened on top of each other.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
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

  // Deferred query value: the filter stays responsive even with hundreds of
  // repos — keystrokes update the input immediately while the (cheap but
  // not-free) filtering runs on a deferred copy.
  const deferredRepoQuery = useDeferredValue(repoQuery);
  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    const q = deferredRepoQuery.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos, deferredRepoQuery]);

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
          sha: result.blobSha ?? "",
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
            expectedSha: f.action === "create" ? null : f.sha,
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
              sha: (await getFile({ owner: ownerOf(selectedRepo.fullName), repo: repoNameOf(selectedRepo.fullName), branch: result.sha!, path: openFile.path })).sha,
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
        const failureMessage = errorMessage(e);
        const offline = !navigator.onLine || isNetworkError(failureMessage);
        if (offline) {
          queueCommit({
            repo: selectedRepo.fullName,
            branch: currentBranch,
            message,
            allowSecrets,
            files: staged.map((f) => ({
              path: f.path,
              action: f.action,
              expectedSha: f.action === "create" ? null : f.sha,
              content: f.content,
            })),
          }, accountId);
          setPendingCommitsVersion((v) => v + 1);
          setStaged([]);
          setStagedDiffOpen(null);
          setAllowSecrets(false);
          setStatus({
            kind: "ok",
            text: offlineStorageDurable() ? "Saved offline — will commit when you are back online." : "Queued in memory only. Keep this tab open until it syncs.",
          });
          toast.warning(
            "Offline — commit queued on this device and will push when you reconnect.",
          );
        } else {
          setStatus({ kind: "err", text: errorMessage(e) });
        }
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
          sha: result.blobSha ?? "",
        });
        setIsNewFile(false);
      } else {
        setOpenFile({
          ...openFile,
          content: editorContent,
          sha: result.blobSha ?? openFile.sha,
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
      const failureMessage = errorMessage(e);
      const offline = !navigator.onLine || isNetworkError(failureMessage);
      if (offline) {
        queueCommit({
          repo: selectedRepo.fullName,
          branch: currentBranch,
          message,
          allowSecrets,
          files: [
            {
              path: openFile.path,
              action: isNewFile ? "create" : "update",
              expectedSha: isNewFile ? null : openFile.sha,
              content: editorContent,
            },
          ],
        }, accountId);
        setPendingCommitsVersion((v) => v + 1);
        setAllowSecrets(false);
        setStatus({
          kind: "ok",
          text: offlineStorageDurable() ? "Saved offline — will commit when you are back online." : "Queued in memory only. Keep this tab open until it syncs.",
        });
        toast.warning(
          "Offline — commit queued on this device and will push when you reconnect.",
        );
      } else {
        setStatus({ kind: "err", text: errorMessage(e) });
      }
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
      const failureMessage = errorMessage(e);
      const offline = !navigator.onLine || isNetworkError(failureMessage);
      if (offline) {
        queueCommit({
          repo: selectedRepo.fullName,
          branch: currentBranch,
          message: `Delete ${openFile.path}`,
          files: [{ path: openFile.path, action: "delete", expectedSha: openFile.sha }],
        }, accountId);
        setPendingCommitsVersion((v) => v + 1);
        const dir = openFile.path.includes("/")
          ? openFile.path.slice(0, openFile.path.lastIndexOf("/"))
          : "";
        setStaged((prev) => prev.filter((f) => f.path !== openFile.path));
        setOpenFile(null);
        setIsNewFile(false);
        setPath(dir);
        setStatus({
          kind: "ok",
          text: offlineStorageDurable()
            ? "Deletion queued offline — it will be committed when you reconnect."
            : "Deletion queued in memory only. Keep this tab open until it syncs.",
        });
        toast.warning("Offline — deletion queued and will push when you reconnect.");
      } else {
        setStatus({ kind: "err", text: failureMessage });
      }
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

  const handleSignOut = async () => {
    if (!offlineStorageDurable() && !window.confirm("Some edits are only in memory. Keep this tab open to recover them. Sign out anyway?")) return;
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
      focusMode={focusMode}
      setFocusMode={setFocusMode}
      deployment={deployment}
      deploymentLoading={deploymentLoading}
      deploymentError={deploymentError}
      loadDeployment={loadDeployment}
      offline={{
        online,
        pending: offlinePending + pendingCommitCount(),
        syncing: offlineSyncing,
      }}
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
      historyPage={historyPage}
      loadMoreHistory={loadMoreHistory}
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
