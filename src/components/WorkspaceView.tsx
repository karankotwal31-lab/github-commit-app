import {
  CodeEditor,
  insertTextAtCursor,
  onActiveEditorFocus,
} from "@/components/CodeEditor";
import { CodingAccessoryBar } from "@/components/CodingAccessoryBar";
import { PreviewPanel, type DeploymentInfo } from "@/components/PreviewPanel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { RuntimeDialog } from "@/components/RuntimeDialog";
import { LocalGitDialog } from "@/components/LocalGitDialog";
import { BillingDialog } from "@/components/BillingDialog";
import { AiUsageMeter } from "@/components/AiUsageMeter";
import { RepoUsageBadge } from "@/components/RepoUsageBadge";
import { InboxDialog } from "@/components/InboxDialog";
import { AiReviewDialog } from "@/components/AiReviewDialog";
import { AdminDialog } from "@/components/AdminDialog";
import { PLAN_BY_ID } from "@/lib/plans";
import {
  ShareWorkspaceDialog,
  type SharedWorkspaceRow,
} from "@/components/ShareWorkspaceDialog";
import {
  Wordmark,
  InputDialog,
  DiffView,
  ChecksChip,
  timeAgo,
} from "@/components/workspace-shared";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatSize, type Repository } from "@/lib/github";
import { diffLines, parseUnifiedPatch } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Archive,
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  Cpu,
  Crown,
  ExternalLink,
  Eye,
  FileCode2,
  FilePlus2,
  FileSearch,
  Folder,
  FolderOpen,
  Focus,
  GitBranch,
  GitPullRequest,
  Github,
  History,
  Loader2,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Unplug,
  Users,
  WifiOff,
  XCircle,
} from "lucide-react";

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

export interface WorkspaceViewProps {
  connection: {
    connected: boolean;
    login: string | null;
    name: string | null;
    avatar: string | null;
  };
  currentBranch: string | null;
  mobileView: "repos" | "files" | "editor";
  reposLoading: boolean;
  reposError: string | null;
  repoQuery: string;
  setRepoQuery: (v: string) => void;
  selectedRepo: Repository | null;
  loadRepos: () => void;
  handleSelectRepo: (repo: Repository) => void;
  handleBackToRepos: () => void;
  filteredRepos: Repository[];
  entries: { name: string; path: string; type: "dir" | "file"; size: number }[] | null;
  entriesLoading: boolean;
  entriesError: string | null;
  sortedEntries: { name: string; path: string; type: "dir" | "file"; size: number }[];
  path: string;
  setPath: (v: string) => void;
  pathSegments: string[];
  handleOpenEntry: (entry: { name: string; path: string; type: "dir" | "file"; size: number }) => void;
  handleBreadcrumb: (index: number) => void;
  loadEntries: (repo: Repository, branchName: string, dirPath: string) => void;
  branches: { name: string; sha: string }[] | null;
  branchesLoading: boolean;
  handleSwitchBranch: (name: string) => void;
  setDialog: (v: { kind: "newFile" | "rename" | "branch" } | null) => void;
  openFile: { content: string; sha: string; size: number; truncated: boolean; path: string } | null;
  setOpenFile: (v: { content: string; sha: string; size: number; truncated: boolean; path: string } | null) => void;
  isNewFile: boolean;
  editorContent: string;
  setEditorContent: (v: string) => void;
  viewMode: "edit" | "diff" | "preview";
  setViewMode: (v: "edit" | "diff" | "preview") => void;
  deployment: DeploymentInfo | null;
  deploymentLoading: boolean;
  deploymentError: string | null;
  loadDeployment: () => void;
  offline: { online: boolean; pending: number; syncing: boolean };
  fileLoading: boolean;
  dirty: boolean;
  openFileIsStaged: boolean;
  status: { kind: "ok" | "err"; text: string } | null;
  lastCommit: { sha: string | null; message: string; htmlUrl: string | null } | null;
  prResult: { number: number; title: string; htmlUrl: string } | null;
  handleOpenPr: () => void;
  prOpen: boolean;
  staged: Array<{
    path: string;
    originalContent: string;
    content: string;
    sha: string;
    action: "update" | "create";
  }>;
  setStaged: (v: Array<{
    path: string;
    originalContent: string;
    content: string;
    sha: string;
    action: "update" | "create";
  }>) => void;
  stagedDiffOpen: string | null;
  setStagedDiffOpen: (v: string | null) => void;
  handleUnstage: (path: string) => void;
  flaggedSecretPaths: string[];
  allowSecrets: boolean;
  setAllowSecrets: (v: boolean) => void;
  commitMessage: string;
  setCommitMessage: (v: string) => void;
  canCommit: boolean;
  handleCommit: () => void;
  handleStage: () => void;
  committing: boolean;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  treeFilesLoading: boolean;
  treeFiles: Array<{ path: string; size: number }> | null;
  searchResults: Array<{ path: string; size: number }>;
  handleSearchSelect: (path: string) => void;
  historyOpen: boolean;
  setHistoryOpen: (v: boolean) => void;
  historyLoading: boolean;
  history: Array<{
    sha: string;
    message: string;
    author: string;
    date: string | null;
    htmlUrl: string;
  }> | null;
  historyError: string | null;
  loadHistory: () => void;
  revertTarget: { sha: string; message: string } | null;
  setRevertTarget: (v: { sha: string; message: string } | null) => void;
  reverting: boolean;
  handleRevert: () => void;
  prsOpen: boolean;
  setPrsOpen: (v: boolean) => void;
  prs: Array<{
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
  }> | null;
  prsLoading: boolean;
  prsError: string | null;
  loadPullRequests: () => void;
  openPrReview: (pr: { number: number; title: string }) => void;
  mergeTarget: { number: number; title: string } | null;
  setMergeTarget: (v: { number: number; title: string } | null) => void;
  merging: boolean;
  handleMergePr: () => void;
  checksOpen: boolean;
  setChecksOpen: (v: boolean) => void;
  checks: {
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
  } | null;
  checksLoading: boolean;
  checksError: string | null;
  loadChecks: () => void;
  vaultOpen: boolean;
  setVaultOpen: (v: boolean) => void;
  drafts: Array<{ repo: string; branch: string; path: string; preview: string; updatedAt: number }> | undefined;
  restoreDraft: (draft: { repo: string; branch: string; path: string }) => void;
  prReview: { number: number; title: string } | null;
  setPrReview: (v: { number: number; title: string } | null) => void;
  prFiles: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string | null;
  }> | null;
  setPrFiles: (v: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string | null;
  }> | null) => void;
  prFilesLoading: boolean;
  prFilesError: string | null;
  expandedPrFile: string | null;
  setExpandedPrFile: (v: string | null) => void;
  codeSearchOpen: boolean;
  setCodeSearchOpen: (v: boolean) => void;
  codeQuery: string;
  setCodeQuery: (v: string) => void;
  codeResults: Array<{ path: string; name: string; htmlUrl: string }> | null;
  setCodeResults: (v: Array<{ path: string; name: string; htmlUrl: string }> | null) => void;
  codeSearchLoading: boolean;
  codeSearchError: string | null;
  setCodeSearchError: (v: string | null) => void;
  runCodeSearch: () => void;
  handleCodeResultSelect: (path: string) => void;
  issuesOpen: boolean;
  setIssuesOpen: (v: boolean) => void;
  issues: Array<{
    number: number;
    title: string;
    htmlUrl: string;
    author: string;
    createdAt: string | null;
    comments: number;
    body: string | null;
    labels: string[];
  }> | null;
  issuesLoading: boolean;
  issuesError: string | null;
  loadIssues: () => void;
  aiOpen: boolean;
  setAiOpen: (v: boolean) => void;
  aiHistory: Array<{ role: "user" | "assistant"; content: string }>;
  setAiHistory: (v: Array<{ role: "user" | "assistant"; content: string }>) => void;
  aiInstruction: string;
  setAiInstruction: (v: string) => void;
  aiLoading: boolean;
  aiError: string | null;
  aiResult: {
    explanation: string;
    changes: Array<{
      path: string;
      action: "update" | "create";
      content: string;
      originalContent: string;
    }>;
  } | null;
  setAiResult: (v: {
    explanation: string;
    changes: Array<{
      path: string;
      action: "update" | "create";
      content: string;
      originalContent: string;
    }>;
  } | null) => void;
  setAiError: (v: string | null) => void;
  handleAiAsk: () => void;
  stageAiChange: (change: {
    path: string;
    action: "update" | "create";
    content: string;
    originalContent: string;
  }) => void;
  stageAllAiChanges: () => void;
  liveSessions: Array<{
    deviceId: string;
    label: string;
    repo: string | null;
    branch: string | null;
    path: string | null;
    cursorLine: number | null;
    cursorColumn: number | null;
  }> | undefined;
  billing: {
    configured: boolean;
    plan: "free" | "pro" | "pro_plus" | "team" | "enterprise";
    currentPeriodEnd: number | null;
  } | undefined;
  billingOpen: boolean;
  setBillingOpen: (v: boolean) => void;
  mySharedWorkspaces: SharedWorkspaceRow[] | undefined;
  handleJoinWorkspace: (code: string) => Promise<boolean>;
  createSharedWorkspace: (args: {
    repo: string;
    branch: string;
    label?: string;
  }) => Promise<string>;
  handleDisconnect: () => void;
  handleSignOut: () => void;
  onRefreshWorkspace: () => void;
  dialog: { kind: "newFile" | "rename" | "branch" } | null;
  dialogBusy: boolean;
  handleDialogConfirm: (value: string) => void;
  deleteOpen: boolean;
  setDeleteOpen: (v: boolean) => void;
  deleting: boolean;
  handleDelete: () => void;
}

export function WorkspaceView(props: WorkspaceViewProps) {
  const {
    connection,
    currentBranch,
    mobileView,
    reposLoading,
    reposError,
    repoQuery,
    setRepoQuery,
    selectedRepo,
    loadRepos,
    handleSelectRepo,
    handleBackToRepos,
    filteredRepos,
    entries,
    entriesLoading,
    entriesError,
    sortedEntries,
    path,
    setPath,
    pathSegments,
    handleOpenEntry,
    handleBreadcrumb,
    loadEntries,
    branches,
    branchesLoading,
    handleSwitchBranch,
    setDialog,
    openFile,
    setOpenFile,
    isNewFile,
    editorContent,
    setEditorContent,
    viewMode,
    setViewMode,
    fileLoading,
    dirty,
    openFileIsStaged,
    status,
    lastCommit,
    prResult,
    handleOpenPr,
    prOpen,
    staged,
    setStaged,
    stagedDiffOpen,
    setStagedDiffOpen,
    handleUnstage,
    flaggedSecretPaths,
    allowSecrets,
    setAllowSecrets,
    commitMessage,
    setCommitMessage,
    canCommit,
    handleCommit,
    handleStage,
    committing,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    treeFilesLoading,
    treeFiles,
    searchResults,
    handleSearchSelect,
    historyOpen,
    setHistoryOpen,
    historyLoading,
    history,
    historyError,
    loadHistory,
    revertTarget,
    setRevertTarget,
    reverting,
    handleRevert,
    prsOpen,
    setPrsOpen,
    prs,
    prsLoading,
    prsError,
    loadPullRequests,
    openPrReview,
    mergeTarget,
    setMergeTarget,
    merging,
    handleMergePr,
    checksOpen,
    setChecksOpen,
    checks,
    checksLoading,
    checksError,
    loadChecks,
    deployment,
    deploymentLoading,
    deploymentError,
    loadDeployment,
    offline,
    vaultOpen,
    setVaultOpen,
    drafts,
    restoreDraft,
    prReview,
    setPrReview,
    prFiles,
    setPrFiles,
    prFilesLoading,
    prFilesError,
    expandedPrFile,
    setExpandedPrFile,
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
    issuesOpen,
    setIssuesOpen,
    issues,
    issuesLoading,
    issuesError,
    loadIssues,
    aiOpen,
    setAiOpen,
    aiHistory,
    setAiHistory,
    aiInstruction,
    setAiInstruction,
    aiLoading,
    aiError,
    aiResult,
    setAiResult,
    setAiError,
    handleAiAsk,
    stageAiChange,
    stageAllAiChanges,
    liveSessions,
    billing,
    billingOpen,
    setBillingOpen,
    mySharedWorkspaces,
    handleJoinWorkspace,
    createSharedWorkspace,
    handleDisconnect,
    handleSignOut,
    onRefreshWorkspace,
    dialog,
    dialogBusy,
    handleDialogConfirm,
    deleteOpen,
    setDeleteOpen,
    deleting,
    handleDelete,
  } = props;

  // Local UI state: the Runtime & Plugins, billing, team-workspace, and the
  // in-browser git engine dialogs. Kept here because they're presentational.
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  // Mobile editor: visual-viewport height (so the keyboard never clips the
  // canvas), focus mode (collapse everything but the code while typing) and
  // the coding accessory bar above the keyboard. The bar is fixed-positioned
  // so it renders from the workspace root; Monaco itself is reached through
  // the active-editor registry in CodeEditor.tsx (no prop drilling through
  // the whole layout).
  const isMobile = useIsMobile();
  const vv = useVisualViewport(); // publishes --vvh + measured keyboard inset
  const [focusMode, setFocusMode] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [accessoryHidden, setAccessoryHidden] = useState(false);

  // Aggressive focus mode: typing on a phone collapses the header, editor
  // chrome and commit bar automatically; exit via the Focus toggle in the
  // accessory bar (or the header button on desktop).
  useEffect(() => {
    if (isMobile && editorFocused) setFocusMode(true);
  }, [isMobile, editorFocused]);
  useEffect(() => onActiveEditorFocus(setEditorFocused), []);

  const accessoryVisible =
    isMobile &&
    !accessoryHidden &&
    (focusMode || editorFocused || vv.keyboardOpen);

  const handleOpenHistory = () => {
    setHistoryOpen(true);
    loadHistory();
  };

  const handleOpenIssues = () => {
    setIssuesOpen(true);
    loadIssues();
  };

  const handleOpenPrs = () => {
    setPrsOpen(true);
    loadPullRequests();
  };

  const stagedPathSet = useMemo(
    () => new Set(staged.map((f) => f.path)),
    [staged],
  );

  const diff = useMemo(
    () => (openFile ? diffLines(openFile.content, editorContent) : []),
    [openFile, editorContent],
  );

  return (
    <div
      className={cn(
        "aria-workspace flex flex-col bg-background text-foreground antialiased",
        isMobile ? "h-[var(--vvh)]" : "h-screen",
      )}
      data-focus-mode={focusMode ? "true" : undefined}
      data-kb-inset={isMobile && vv.keyboardOpen ? "true" : undefined}
      style={
        isMobile && vv.keyboardOpen
          ? ({ "--kb-inset": `${vv.keyboardInset}px` } as CSSProperties)
          : undefined
      }
    >
      {/* Coding accessory toolbar — fixed above the mobile keyboard */}
      <CodingAccessoryBar
        visible={accessoryVisible}
        focusMode={focusMode}
        onToggleFocusMode={() => setFocusMode((f) => !f)}
        onInsert={insertTextAtCursor}
        onClose={() => setAccessoryHidden(true)}
      />

      {/* Live deployment preview — full-screen so the app can be tested */}
      {viewMode === "preview" && selectedRepo && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setViewMode("edit")}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
              title="Back to the editor"
            >
              <ArrowLeft className="size-4" />
            </button>
            <p className="truncate font-mono text-sm font-medium text-neutral-900">
              {selectedRepo.name} · {currentBranch}
            </p>
            <span className="ml-auto text-xs text-neutral-400">
              Live preview
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <PreviewPanel
              deployment={deployment}
              loading={deploymentLoading}
              error={deploymentError}
              onRefresh={loadDeployment}
            />
          </div>
        </div>
      )}

      {/* Pull requests — open PRs with merge */}
      <Dialog open={prsOpen} onOpenChange={setPrsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Pull requests</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-xs text-neutral-500">
              {selectedRepo?.name}
            </p>
            <button
              type="button"
              onClick={loadPullRequests}
              className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
            >
              <RefreshCw className="size-3" />
              Refresh
            </button>
          </div>
          <div className="max-h-[24rem] overflow-auto">
            {prsLoading && !prs ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
                <Loader2 className="size-3.5 animate-spin" />
                Loading pull requests…
              </div>
            ) : prsError ? (
              <p className="py-6 text-center text-xs text-red-600">{prsError}</p>
            ) : prs?.length === 0 ? (
              <p className="py-6 text-center text-xs text-neutral-400">
                No open pull requests.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {prs?.map((pr) => (
                  <li key={pr.number} className="py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-800">
                          {pr.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-neutral-500">
                          #{pr.number} · {pr.author} ·{" "}
                          <span className="font-mono">{pr.head}</span>
                          {" → "}
                          <span className="font-mono">{pr.base}</span>
                        </p>
                        {pr.draft && (
                          <span className="mt-1 inline-block rounded border border-neutral-300 px-1 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                            Draft
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 gap-1 text-xs"
                        onClick={() =>
                          openPrReview({ number: pr.number, title: pr.title })
                        }
                        title="Review the files changed by this pull request"
                      >
                        <Eye className="size-3" />
                        Review
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 gap-1 text-xs"
                        disabled={pr.draft || pr.mergeable === false || pr.mergeable === null}
                        title={
                          pr.draft
                            ? "Draft pull requests can't be merged"
                            : pr.mergeable === false
                              ? "Has conflicts — resolve them before merging"
                              : pr.mergeable === null
                                ? "GitHub is still checking mergeability"
                                : "Merge this pull request"
                        }
                        onClick={() =>
                          setMergeTarget({ number: pr.number, title: pr.title })
                        }
                      >
                        <GitPullRequest className="size-3" />
                        Merge
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* CI checks — check runs + status contexts on the branch tip */}
      <Dialog open={checksOpen} onOpenChange={setChecksOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>CI checks</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-xs text-neutral-500">
              {selectedRepo?.name} · {currentBranch}
              {checks?.sha ? ` · ${checks.sha.slice(0, 7)}` : ""}
            </p>
            <button
              type="button"
              onClick={loadChecks}
              className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
            >
              <RefreshCw className="size-3" />
              Refresh
            </button>
          </div>
          <div className="max-h-[24rem] overflow-auto">
            {checksLoading && !checks ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
                <Loader2 className="size-3.5 animate-spin" />
                Loading checks…
              </div>
            ) : checksError ? (
              <p className="py-6 text-center text-xs text-red-600">{checksError}</p>
            ) : checks && checks.checkRuns.length === 0 && checks.statusContexts.length === 0 ? (
              <p className="py-6 text-center text-xs text-neutral-400">
                No checks or statuses on the tip of this branch.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {checks && checks.checkRuns.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                      Check runs
                    </p>
                    <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                      {checks.checkRuns.map((run, i) => (
                        <li key={i} className="flex items-center gap-2 px-3 py-2">
                          {run.conclusion === "success" ? (
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                          ) : run.conclusion === "failure" ||
                            run.conclusion === "timed_out" ||
                            run.conclusion === "cancelled" ||
                            run.conclusion === "action_required" ? (
                            <XCircle className="size-4 shrink-0 text-red-500" />
                          ) : run.status === "completed" ? (
                            <CircleDot className="size-4 shrink-0 text-neutral-300" />
                          ) : (
                            <Clock className="size-4 shrink-0 animate-pulse text-amber-500" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                            {run.name}
                          </span>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {run.conclusion ?? run.status}
                          </span>
                          {run.detailsUrl && (
                            <a
                              href={run.detailsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 text-neutral-400 hover:text-neutral-900"
                              title="Open details"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {checks && checks.statusContexts.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                      Statuses
                    </p>
                    <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                      {checks.statusContexts.map((s, i) => (
                        <li key={i} className="flex items-center gap-2 px-3 py-2">
                          <span
                            className={`size-2 shrink-0 rounded-full ${
                              s.state === "success"
                                ? "bg-emerald-500"
                                : s.state === "failure" || s.state === "error"
                                  ? "bg-red-500"
                                  : s.state === "pending"
                                    ? "bg-amber-500"
                                    : "bg-neutral-300"
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                            {s.context}
                          </span>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {s.description ?? s.state}
                          </span>
                          {s.targetUrl && (
                            <a
                              href={s.targetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 text-neutral-400 hover:text-neutral-900"
                              title="Open details"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Draft vault — unsaved edits resumable from any device */}
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

      {/* PR review — files changed by a pull request */}
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

      {/* Code search — full-text search across the repo */}
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

      {/* Open issues */}
      <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Issues</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-xs text-neutral-500">
              {selectedRepo?.name}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <a
                href={`https://github.com/${selectedRepo?.fullName ?? ""}/issues/new`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
              >
                <Plus className="size-3" />
                New issue
              </a>
              <button
                type="button"
                onClick={loadIssues}
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
              >
                <RefreshCw className="size-3" />
                Refresh
              </button>
            </div>
          </div>
          <div className="max-h-[24rem] overflow-auto">
            {issuesLoading && !issues ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
                <Loader2 className="size-3.5 animate-spin" />
                Loading issues…
              </div>
            ) : issuesError ? (
              <p className="py-6 text-center text-xs text-red-600">{issuesError}</p>
            ) : issues?.length === 0 ? (
              <p className="py-6 text-center text-xs text-neutral-400">
                No open issues. Nice work.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {issues?.map((issue) => (
                  <li key={issue.number} className="py-3">
                    <div className="flex items-start gap-3">
                      <CircleDot className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <a
                            href={issue.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-sm font-medium text-neutral-800 hover:underline"
                          >
                            {issue.title}
                          </a>
                          {issue.labels.slice(0, 3).map((label) => (
                            <span
                              key={label}
                              className="rounded border border-neutral-200 px-1 py-0.5 text-[10px] text-neutral-500"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                        <p className="mt-0.5 text-xs text-neutral-500">
                          #{issue.number} · {issue.author} ·{" "}
                          {formatDate(issue.createdAt)} · {issue.comments} comment
                          {issue.comments === 1 ? "" : "s"}
                        </p>
                        {issue.body && (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-400">
                            {issue.body}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Ask Aria — the grounded AI assistant */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ask Aria</DialogTitle>
          </DialogHeader>
          <AiUsageMeter onUpgrade={() => setBillingOpen(true)} />
          {aiHistory.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                  Conversation
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAiHistory([]);
                    setAiResult(null);
                    setAiError(null);
                  }}
                  className="text-xs text-neutral-500 hover:text-neutral-900"
                >
                  New conversation
                </button>
              </div>
              <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-neutral-200 p-3">
                {aiHistory.map((turn, i) =>
                  turn.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <p className="max-w-[85%] rounded-lg bg-neutral-900 px-3 py-1.5 text-xs leading-5 text-white">
                        {turn.content}
                      </p>
                    </div>
                  ) : (
                    <div key={i} className="flex justify-start">
                      <p className="max-w-[85%] rounded-lg border border-neutral-200 px-3 py-1.5 text-xs leading-5 text-neutral-700">
                        {turn.content}
                      </p>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3">
            <textarea
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="What should I change? For example: “Add input validation to the signup form” or “Fix the race condition in the file loader.”"
              rows={3}
              spellCheck={false}
              className="w-full resize-none rounded-md border border-neutral-200 bg-background p-3 font-mono text-sm leading-6 text-neutral-900 outline-none focus:border-neutral-400"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (!aiLoading && aiInstruction.trim()) handleAiAsk();
                }
              }}
            />
            <p className="text-xs leading-5 text-neutral-400">
              Aria reads the current branch and{" "}
              {openFile && !isNewFile ? (
                <span className="font-mono text-neutral-500">
                  {openFile.path}
                </span>
              ) : (
                "no open file"
              )}
              . It proposes changes you review and stage — nothing is committed
              automatically. Follow-ups build on this conversation.
            </p>
            <Button
              type="button"
              className="h-9 w-full gap-1.5"
              onClick={handleAiAsk}
              disabled={aiLoading || !aiInstruction.trim()}
            >
              {aiLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {aiLoading ? "Thinking…" : "Propose changes"}
            </Button>
            {aiError && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {aiError}
              </p>
            )}
            {aiResult && (
              <div className="flex flex-col gap-3">
                <p className="text-sm leading-6 text-neutral-700">
                  {aiResult.explanation}
                </p>
                <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
                  <ul className="divide-y divide-neutral-100">
                    {aiResult.changes.map((change) => (
                      <li key={change.path} className="p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`shrink-0 rounded px-1 font-mono text-[10px] font-semibold ${
                              change.action === "create"
                                ? "bg-emerald-50 text-emerald-900"
                                : "bg-amber-50 text-amber-900"
                            }`}
                          >
                            {change.action === "create" ? "A" : "M"}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-sm text-neutral-800">
                            {change.path}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 gap-1 text-xs"
                            onClick={() => stageAiChange(change)}
                          >
                            <Plus className="size-3" />
                            Stage
                          </Button>
                        </div>
                        <div className="mt-2 max-h-48 overflow-auto rounded border border-neutral-100">
                          <DiffView
                            lines={diffLines(
                              change.originalContent,
                              change.content,
                            )}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  type="button"
                  className="h-9 w-full gap-1.5"
                  onClick={stageAllAiChanges}
                >
                  <Plus className="size-4" />
                  Stage all {aiResult.changes.length} change
                  {aiResult.changes.length > 1 ? "s" : ""}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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

      {/* Merge confirmation */}
      <AlertDialog
        open={mergeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !merging) setMergeTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Merge this pull request?</AlertDialogTitle>
            <AlertDialogDescription>
              “{mergeTarget?.title}” will be squash-merged into its base branch
              as a single commit. The branch itself stays untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={merging}
              onClick={(e) => {
                e.preventDefault();
                handleMergePr();
              }}
            >
              {merging && <Loader2 className="size-4 animate-spin" />}
              Merge pull request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocalGitDialog
        open={localOpen}
        onOpenChange={setLocalOpen}
        fullName={selectedRepo?.fullName ?? ""}
        branch={currentBranch ?? ""}
        connection={connection}
        onRefresh={onRefreshWorkspace}
      />
      <RuntimeDialog open={runtimeOpen} onOpenChange={setRuntimeOpen} />
      <BillingDialog open={billingOpen} onOpenChange={setBillingOpen} />
      <InboxDialog open={inboxOpen} onOpenChange={setInboxOpen} />
      <AiReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        owner={selectedRepo?.fullName.split("/")[0] ?? ""}
        repo={selectedRepo?.fullName.split("/")[1] ?? ""}
        branch={currentBranch ?? ""}
      />
      <AdminDialog open={adminOpen} onOpenChange={setAdminOpen} />
      <ShareWorkspaceDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        repo={selectedRepo?.fullName ?? null}
        branch={currentBranch}
        onJoin={handleJoinWorkspace}
        myShared={mySharedWorkspaces}
        createSharedWorkspace={createSharedWorkspace}
      />

      {/* Top bar — hidden in mobile focus mode for maximum code space */}
      <header
        className={cn(
          "flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-4",
          focusMode && isMobile && "hidden",
        )}
      >
        <Wordmark />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLocalOpen(true)}
            disabled={!selectedRepo}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Local git — clone into the browser, merge, rebase, stash, graph"
          >
            <GitBranch className="size-3.5 text-neutral-500" />
            <span className="hidden text-xs text-neutral-500 sm:inline">
              Local
            </span>
          </button>
          <button
            type="button"
            onClick={() => setRuntimeOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
            title="Runtime & plugins — what Aria detected on this device"
          >
            <Cpu className="size-3.5 text-neutral-500" />
            <span className="hidden text-xs text-neutral-500 sm:inline">
              Runtime
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode("preview");
              loadDeployment();
            }}
            disabled={!selectedRepo}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Live deployment preview — test the app without leaving Aria"
          >
            <Rocket className="size-3.5 text-neutral-500" />
            <span className="hidden text-xs text-neutral-500 sm:inline">
              Live
            </span>
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((f) => !f)}
            aria-pressed={focusMode}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors ${
              focusMode
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 hover:bg-neutral-100"
            }`}
            title={
              focusMode
                ? "Exit focus mode"
                : "Focus mode — hide everything but the code"
            }
          >
            <Focus className="size-3.5" />
            <span className="hidden text-xs sm:inline">
              {focusMode ? "Exit focus" : "Focus"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
            title="Team workspaces — share the current repo with a code"
          >
            <Users className="size-3.5 text-neutral-500" />
            <span className="hidden text-xs text-neutral-500 sm:inline">
              Share
            </span>
          </button>
          <button
            type="button"
            onClick={() => setInboxOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
            title="Unified inbox — PRs and issues across all your repos"
          >
            <Bell className="size-3.5 text-neutral-500" />
            <span className="hidden text-xs text-neutral-500 sm:inline">
              Inbox
            </span>
          </button>
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            disabled={!selectedRepo || !currentBranch}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:opacity-40"
            title="AI review — review the branch before you push"
          >
            <ScanSearch className="size-3.5 text-neutral-500" />
            <span className="hidden text-xs text-neutral-500 sm:inline">
              Review
            </span>
          </button>
          {billing?.configured &&
            (billing.plan === "team" || billing.plan === "enterprise") && (
              <button
                type="button"
                onClick={() => setAdminOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
                title="Admin console — seats, usage, audit"
              >
                <ShieldCheck className="size-3.5 text-neutral-500" />
                <span className="hidden text-xs text-neutral-500 sm:inline">
                  Admin
                </span>
              </button>
            )}
          <RepoUsageBadge onUpgrade={() => setBillingOpen(true)} />
          <button
            type="button"
            onClick={() => setBillingOpen(true)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors ${
              billing?.configured && billing.plan !== "free"
                ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-neutral-200 hover:bg-neutral-100"
            }`}
            title={
              billing?.configured && billing.plan === "free"
                ? "Upgrade to Aria Pro"
                : billing?.configured
                  ? `Aria ${PLAN_BY_ID[billing.plan].name}`
                  : "Aria plans"
            }
          >
            <Crown className="size-3.5 text-amber-600" />
            <span className="hidden text-xs font-medium sm:inline">
              {billing?.configured && billing.plan === "free"
                ? "Upgrade"
                : billing?.configured
                  ? PLAN_BY_ID[billing.plan].name
                  : "Plans"}
            </span>
          </button>
          {/* Offline sync safeguard indicator */}
          {(offline.pending > 0 || !offline.online) && (
            <span
              className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700"
              title={
                !offline.online
                  ? "You're offline — edits are saved on this device and sync when you're back."
                  : `${offline.pending} unsaved edit${offline.pending > 1 ? "s" : ""} queued — syncing when online.`
              }
            >
              <WifiOff className="size-3" />
              <span className="hidden sm:inline">
                {!offline.online
                  ? "Offline"
                  : `${offline.pending} queued`}
              </span>
              {offline.syncing && <Loader2 className="size-3 animate-spin" />}
            </span>
          )}
          {liveSessions && liveSessions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
                  title="Devices in this workspace"
                >
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="hidden text-xs text-neutral-500 sm:inline">
                    {liveSessions.length} other
                    {liveSessions.length > 1 ? "s" : ""}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                    Live now
                  </p>
                </div>
                {liveSessions.map((s) => (
                  <div key={s.deviceId} className="px-3 pb-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-800">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      {s.label}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">
                      {s.repo
                        ? `${s.repo} · ${s.branch ?? ""}${s.path ? ` · ${s.path}` : ""}`
                        : "Browsing repositories"}
                    </p>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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

        {/* Files */}
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
                      onClick={() => {
                        setChecksOpen(true);
                        if (!checks) loadChecks();
                      }}
                    />
                    <DeploymentChip
                      deployment={deployment}
                      loading={deploymentLoading}
                      onClick={() => {
                        setViewMode("preview");
                        loadDeployment();
                      }}
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
                  onClick={() => setSearchOpen(true)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  title="Jump to file (⌘K)"
                >
                  <Search className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCodeQuery("");
                    setCodeResults(null);
                    setCodeSearchError(null);
                    setCodeSearchOpen(true);
                  }}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  title="Search code in this repo"
                >
                  <FileSearch className="size-3.5" />
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
                  onClick={handleOpenIssues}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  title="Open issues"
                >
                  <CircleDot className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleOpenPrs}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  title="Pull requests"
                >
                  <GitPullRequest className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAiInstruction("");
                    setAiResult(null);
                    setAiError(null);
                    setAiOpen(true);
                  }}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  title="Ask Aria"
                >
                  <Sparkles className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setVaultOpen(true)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  title="Draft vault"
                >
                  <Archive className="size-3.5" />
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
                  <CodeEditor
                    key={openFile?.path ?? "editor"}
                    path={openFile?.path ?? ""}
                    value={editorContent}
                    onChange={setEditorContent}
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
