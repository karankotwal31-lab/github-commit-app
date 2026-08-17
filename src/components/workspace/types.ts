import type { Repository } from "@/lib/github";
import type { DeploymentInfo } from "@/components/PreviewPanel";
import type { SharedWorkspaceRow } from "@/components/ShareWorkspaceDialog";

/**
 * The full props contract for <WorkspaceView />. Kept as one exported
 * interface so Dashboard's call site and every extracted workspace
 * sub-component (`Pick<WorkspaceViewProps, ...>`) share one source of truth.
 */
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
  focusMode: boolean;
  setFocusMode: (v: boolean | ((prev: boolean) => boolean)) => void;
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
