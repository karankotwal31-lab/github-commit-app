// WorkspaceView: composition of extracted workspace modules.
// Each dialog/panel lives in src/components/workspace/*.tsx.
// This file owns only the open/close state and the layout shell.
import { insertTextAtCursor, onActiveEditorFocus } from "@/lib/editorRegistry";
import { CodingAccessoryBar } from "@/components/CodingAccessoryBar";
import { PreviewPanel } from "@/components/PreviewPanel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { RuntimeDialog } from "@/components/RuntimeDialog";
import { BillingDialog } from "@/components/BillingDialog";
import { InboxDialog } from "@/components/InboxDialog";
import { AiReviewDialog } from "@/components/AiReviewDialog";
import { AdminDialog } from "@/components/AdminDialog";
import { SecurityCenterDialog } from "@/components/SecurityCenterDialog";
import { PlatformDialog } from "@/components/PlatformDialog";
import { StressTestDialog } from "@/components/StressTestDialog";
import { CreateIssueDialog } from "@/components/CreateIssueDialog";
import { WhyChangedDialog } from "@/components/WhyChangedDialog";
import { CrossRepoDialog } from "@/components/CrossRepoDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { ShareWorkspaceDialog } from "@/components/ShareWorkspaceDialog";
import { InputDialog } from "@/components/workspace-shared";
import { SimpleModePanel } from "@/components/workspace/SimpleModePanel";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { ReposSidebar } from "@/components/workspace/ReposSidebar";
import { FilesSidebar } from "@/components/workspace/FilesSidebar";
import { EditorPane } from "@/components/workspace/EditorPane";
import { PullRequestsDialog } from "@/components/workspace/PullRequestsDialog";
import { CiChecksDialog } from "@/components/workspace/CiChecksDialog";
import { CommitHistoryDialog } from "@/components/workspace/CommitHistoryDialog";
import { DraftVaultDialog } from "@/components/workspace/DraftVaultDialog";
import { PrReviewDialog } from "@/components/workspace/PrReviewDialog";
import { CodeSearchDialog } from "@/components/workspace/CodeSearchDialog";
import { IssuesDialog } from "@/components/workspace/IssuesDialog";
import { AskAriaDialog } from "@/components/workspace/AskAriaDialog";
import { RepoQaDialog } from "@/components/workspace/RepoQaDialog";
import { StackDialog } from "@/components/workspace/StackDialog";
import { JumpToFileDialog } from "@/components/workspace/JumpToFileDialog";
import { DeleteFileDialog } from "@/components/workspace/DeleteFileDialog";
import { cn } from "@/lib/utils";
import { lazy, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, Cpu, ShieldAlert } from "lucide-react";
export type { WorkspaceViewProps } from "./workspace/types";
import type { WorkspaceViewProps } from "./workspace/types";

const LocalGitDialog = lazy(() =>
  import("@/components/LocalGitDialog").then((m) => ({ default: m.LocalGitDialog })),
);
const EngineeringDock = lazy(() =>
  import("@/components/EngineeringDock").then((m) => ({ default: m.EngineeringDock })),
);

export function WorkspaceView(props: WorkspaceViewProps) {
  const {
    connection, currentBranch, mobileView, selectedRepo, filteredRepos,
    entries, entriesLoading, entriesError, sortedEntries, path, setPath,
    pathSegments, handleOpenEntry, handleBreadcrumb, loadEntries,
    branches, branchesLoading, handleSwitchBranch, setDialog,
    openFile, setOpenFile, isNewFile, editorContent, setEditorContent,
    viewMode, setViewMode, focusMode, setFocusMode, fileLoading, dirty,
    openFileIsStaged, status, lastCommit, prResult, handleOpenPr, prOpen,
    staged, setStaged, stagedDiffOpen, setStagedDiffOpen, handleUnstage,
    commitMessage, setCommitMessage, canCommit, handleCommit, handleStage,
    committing, searchOpen, setSearchOpen, treeFilesLoading, treeFiles,
    searchResults, handleSearchSelect, historyOpen, setHistoryOpen,
    historyLoading, history, historyError, loadHistory, revertTarget,
    setRevertTarget, reverting, handleRevert, prsOpen, setPrsOpen, prs,
    prsLoading, prsError, loadPullRequests, openPrReview, mergeTarget,
    setMergeTarget, merging, handleMergePr, checksOpen, setChecksOpen,
    checks, checksLoading, checksError, loadChecks, deployment,
    deploymentLoading, loadDeployment, offline, vaultOpen, setVaultOpen,
    drafts, restoreDraft, prReview, setPrReview, prFiles, setPrFiles,
    prFilesLoading, prFilesError, expandedPrFile, setExpandedPrFile,
    codeSearchOpen, setCodeSearchOpen, codeQuery, setCodeQuery,
    codeResults, setCodeResults, codeSearchError, setCodeSearchError,
    runCodeSearch, issuesOpen, setIssuesOpen, issues, issuesLoading,
    issuesError, loadIssues, aiOpen, setAiOpen, aiHistory, setAiHistory,
    aiInstruction, setAiInstruction, aiLoading, aiError, aiResult,
    setAiResult, setAiError, handleAiAsk, stageAiChange, stageAllAiChanges,
    billing, billingOpen, setBillingOpen, onRefreshWorkspace, dialogBusy,
    handleDialogConfirm, deleteOpen, setDeleteOpen, deleting, handleDelete,
    handleDisconnect, handleSignOut,
    dialog,
  } = props;

  // Presentational dialog open states
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const [stressOpen, setStressOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [simpleMode, setSimpleMode] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [crossRepoOpen, setCrossRepoOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);

  const centerPanelOpen =
    runtimeOpen || shareOpen || localOpen || dockOpen || inboxOpen ||
    reviewOpen || adminOpen || securityOpen || platformOpen || stressOpen ||
    issueOpen || whyOpen || crossRepoOpen || billingOpen || aiOpen ||
    stackOpen ||
    vaultOpen || prsOpen || historyOpen || codeSearchOpen || searchOpen ||
    issuesOpen || checksOpen || deleteOpen || stagedDiffOpen ||
    dialog !== null || revertTarget !== null || mergeTarget !== null ||
    prReview !== null;

  useEffect(() => {
    document.querySelector<HTMLElement>(".aria-workspace")
      ?.setAttribute("data-center-panel", centerPanelOpen ? "true" : "false");
  }, [centerPanelOpen]);

  const isMobile = useIsMobile();
  const vv = useVisualViewport();
  const [editorFocused, setEditorFocused] = useState(false);
  const [accessoryHidden, setAccessoryHidden] = useState(false);

  useEffect(() => {
    if (isMobile && editorFocused) setFocusMode(true);
  }, [isMobile, editorFocused]);
  useEffect(() => onActiveEditorFocus(setEditorFocused), []);

  const accessoryVisible = isMobile && !accessoryHidden && (focusMode || editorFocused || vv.keyboardOpen);
  const stagedPathSet = useMemo(() => new Set(staged.map((f) => f.path)), [staged]);
  const crossRepoAllowed = !billing?.configured || billing.plan === "team" || billing.plan === "enterprise";

  const owner = selectedRepo?.fullName.split("/")[0] ?? "";
  const repo = selectedRepo?.fullName.split("/")[1] ?? "";
  const branch = currentBranch ?? "";

  return (
    <div
      className={cn("aria-workspace flex flex-col bg-background text-foreground antialiased", isMobile ? "h-[var(--vvh)]" : "h-screen")}
      data-focus-mode={focusMode ? "true" : undefined}
      data-kb-inset={isMobile && vv.keyboardOpen ? "true" : undefined}
      style={isMobile && vv.keyboardOpen ? ({ "--kb-inset": `${vv.keyboardInset}px` } as CSSProperties) : undefined}
    >
      <CodingAccessoryBar visible={accessoryVisible} focusMode={focusMode} onToggleFocusMode={() => setFocusMode((f) => !f)} onInsert={insertTextAtCursor} onClose={() => setAccessoryHidden(true)} />

      {/* Full-screen live preview */}
      {viewMode === "preview" && selectedRepo && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
            <button type="button" onClick={() => setViewMode("edit")} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800" title="Back to the editor">
              <ArrowLeft className="size-4" />
            </button>
            <p className="truncate font-mono text-sm font-medium text-neutral-900">{selectedRepo.name} · {currentBranch}</p>
            <span className="ml-auto text-xs text-neutral-400">Live preview</span>
          </div>
          <div className="min-h-0 flex-1">
            <PreviewPanel deployment={deployment} loading={deploymentLoading} error={props.deploymentError} onRefresh={loadDeployment} />
          </div>
        </div>
      )}

      {/* Extracted workspace dialogs */}
      <PullRequestsDialog {...props} />
      <CiChecksDialog {...props} />
      <DraftVaultDialog {...props} />
      <PrReviewDialog {...props} />
      <CodeSearchDialog {...props} />
      <IssuesDialog {...props} />
      <AskAriaDialog {...props} />
      <CommitHistoryDialog {...props} />
      <StackDialog
        open={stackOpen}
        onOpenChange={setStackOpen}
        owner={owner}
        repo={repo}
        currentBranch={branch}
        defaultBranch={selectedRepo?.defaultBranch ?? "main"}
        onOpenLocal={() => setLocalOpen(true)}
      />
      <RepoQaDialog
        open={qaOpen}
        onOpenChange={setQaOpen}
        owner={owner}
        repo={repo}
        branch={branch}
        onOpenFile={(filePath) => {
          const dir = filePath.includes("/")
            ? filePath.slice(0, filePath.lastIndexOf("/"))
            : "";
          setPath(dir);
          setQaOpen(false);
          handleOpenEntry({
            name: filePath.split("/").pop() ?? filePath,
            path: filePath,
            type: "file",
            size: 0,
          });
        }}
      />

      {/* Standalone heavy dialogs (still lazy, not yet extracted) */}
      <EngineeringDock open={dockOpen} onOpenChange={setDockOpen} owner={owner} repo={repo} branch={branch} connection={connection} openPath={openFile?.path ?? ""} onRefresh={onRefreshWorkspace} />
      <LocalGitDialog open={localOpen} onOpenChange={setLocalOpen} fullName={selectedRepo?.fullName ?? ""} branch={branch} connection={connection} onRefresh={onRefreshWorkspace} />
      <RuntimeDialog open={runtimeOpen} onOpenChange={setRuntimeOpen} />
      <BillingDialog open={billingOpen} onOpenChange={setBillingOpen} />
      <InboxDialog open={inboxOpen} onOpenChange={setInboxOpen} />
      <AiReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} owner={owner} repo={repo} branch={branch} />
      <AdminDialog open={adminOpen} onOpenChange={setAdminOpen} />
      <SecurityCenterDialog open={securityOpen} onOpenChange={setSecurityOpen} owner={owner} repo={repo} branch={branch} />
      <PlatformDialog open={platformOpen} onOpenChange={setPlatformOpen} owner={owner} repo={repo} branch={branch} commit={lastCommit?.sha ?? null} />

      {selectedRepo && !securityOpen && (
        <button type="button" onClick={() => setSecurityOpen(true)} className="fixed bottom-16 right-4 z-40 flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50" title="Security command center">
          <ShieldAlert className="size-3.5 text-neutral-500" /> Security
        </button>
      )}
      {selectedRepo && !platformOpen && !securityOpen && (
        <button type="button" onClick={() => setPlatformOpen(true)} className="fixed bottom-24 right-4 z-40 flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50" title="Platform controls">
          <Cpu className="size-3.5 text-neutral-500" /> Platform
        </button>
      )}

      <StressTestDialog open={stressOpen} onOpenChange={setStressOpen} />
      <CreateIssueDialog open={issueOpen} onOpenChange={setIssueOpen} owner={owner} repo={repo} />
      <WhyChangedDialog open={whyOpen} onOpenChange={setWhyOpen} owner={owner} repo={repo} branch={branch} path={openFile?.path ?? ""} line={null} />
      <CrossRepoDialog open={crossRepoOpen} onOpenChange={setCrossRepoOpen} repos={filteredRepos.map((r) => ({ fullName: r.fullName, defaultBranch: r.defaultBranch }))} isTeam={crossRepoAllowed} />
      <CommandPalette onInbox={() => setInboxOpen(true)} onReview={() => setReviewOpen(true)} onIssue={() => setIssueOpen(true)} onAi={() => setAiOpen(true)} onBilling={() => setBillingOpen(true)} onAdmin={() => setAdminOpen(true)} onStress={() => setStressOpen(true)} onVault={() => setVaultOpen(true)} onPrs={() => setPrsOpen(true)} onHistory={() => setHistoryOpen(true)} onCodeSearch={() => setCodeSearchOpen(true)} />
      <ShareWorkspaceDialog open={shareOpen} onOpenChange={setShareOpen} repo={selectedRepo?.fullName ?? null} branch={currentBranch} onJoin={props.handleJoinWorkspace} myShared={props.mySharedWorkspaces} createSharedWorkspace={props.createSharedWorkspace} />

      {/* Top bar */}
      <WorkspaceHeader connection={connection} billing={billing} liveSessions={props.liveSessions} offline={offline} focusMode={focusMode} isMobile={isMobile} simpleMode={simpleMode} selectedRepo={selectedRepo} currentBranch={currentBranch} crossRepoAllowed={crossRepoAllowed} setSimpleMode={setSimpleMode} setFocusMode={setFocusMode} onOpenLocal={() => setLocalOpen(true)} onOpenStack={() => setStackOpen(true)} onOpenDock={() => setDockOpen(true)} onOpenRuntime={() => setRuntimeOpen(true)} onOpenShare={() => setShareOpen(true)} onOpenCrossRepo={() => setCrossRepoOpen(true)} onOpenInbox={() => setInboxOpen(true)} onOpenReview={() => setReviewOpen(true)} onOpenAdmin={() => setAdminOpen(true)} onOpenIssue={() => setIssueOpen(true)} onOpenStress={() => setStressOpen(true)} onOpenBilling={() => setBillingOpen(true)} onLivePreview={() => { setViewMode("preview"); loadDeployment(); }} handleDisconnect={handleDisconnect} handleSignOut={handleSignOut} />

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {simpleMode ? (
          <SimpleModePanel instruction={aiInstruction} setInstruction={setAiInstruction} loading={aiLoading} error={aiError} result={aiResult} onAsk={handleAiAsk} onStage={stageAiChange} onStageAll={stageAllAiChanges} onExit={() => setSimpleMode(false)} />
        ) : (
          <>
            <ReposSidebar mobileView={mobileView} focusMode={focusMode} reposLoading={props.reposLoading} reposError={props.reposError} repoQuery={props.repoQuery} setRepoQuery={props.setRepoQuery} filteredRepos={filteredRepos} selectedRepo={selectedRepo} handleSelectRepo={props.handleSelectRepo} loadRepos={props.loadRepos} />
            <FilesSidebar mobileView={mobileView} focusMode={focusMode} handleBackToRepos={props.handleBackToRepos} selectedRepo={selectedRepo} currentBranch={currentBranch} branches={branches} branchesLoading={branchesLoading} handleSwitchBranch={handleSwitchBranch} setDialog={setDialog} path={path} setPath={setPath} pathSegments={pathSegments} handleBreadcrumb={handleBreadcrumb} handleOpenEntry={handleOpenEntry} loadEntries={loadEntries} entries={entries} entriesLoading={entriesLoading} entriesError={entriesError} sortedEntries={sortedEntries} stagedPathSet={stagedPathSet} checks={checks} checksLoading={checksLoading} deployment={deployment} deploymentLoading={deploymentLoading} onOpenChecks={() => { setChecksOpen(true); if (!checks) loadChecks(); }} onPreview={() => { setViewMode("preview"); loadDeployment(); }} onJumpToFile={() => setSearchOpen(true)} onCodeSearch={() => { setCodeQuery(""); setCodeResults(null); setCodeSearchError(null); setCodeSearchOpen(true); }} onOpenHistory={() => { setHistoryOpen(true); loadHistory(); }} onOpenIssues={() => { setIssuesOpen(true); loadIssues(); }} onOpenPrs={() => { setPrsOpen(true); loadPullRequests(); }} onAskAria={() => { setAiInstruction(""); setAiResult(null); setAiError(null); setAiOpen(true); }} onAskAboutRepo={() => setQaOpen(true)} onOpenVault={() => setVaultOpen(true)} onNewFile={() => setDialog({ kind: "newFile" })} />
            <EditorPane mobileView={mobileView} connection={connection} selectedRepo={selectedRepo} currentBranch={currentBranch} openFile={openFile} setOpenFile={setOpenFile} isNewFile={isNewFile} editorContent={editorContent} setEditorContent={setEditorContent} viewMode={viewMode} setViewMode={setViewMode} fileLoading={fileLoading} dirty={dirty} openFileIsStaged={openFileIsStaged} status={status} lastCommit={lastCommit} prResult={prResult} handleOpenPr={handleOpenPr} prOpen={prOpen} staged={staged} setStaged={setStaged} stagedDiffOpen={stagedDiffOpen} setStagedDiffOpen={setStagedDiffOpen} handleUnstage={handleUnstage} flaggedSecretPaths={props.flaggedSecretPaths} allowSecrets={props.allowSecrets} setAllowSecrets={props.setAllowSecrets} commitMessage={commitMessage} setCommitMessage={setCommitMessage} canCommit={canCommit} handleCommit={handleCommit} handleStage={handleStage} committing={committing} onOpenWhy={() => setWhyOpen(true)} onRename={() => setDialog({ kind: "rename" })} onDelete={() => setDeleteOpen(true)} />
          </>
        )}
      </div>

      <JumpToFileDialog {...props} />
      <InputDialog key={dialog?.kind ?? "closed"} open={dialog !== null} title={dialog?.kind === "newFile" ? "New file" : dialog?.kind === "rename" ? "Rename file" : "New branch"} label={dialog?.kind === "newFile" ? "Path of the new file, relative to the repository root." : dialog?.kind === "rename" ? "New path for this file, relative to the repository root." : `Branching off ${currentBranch}. The new branch gets everything that's on the current one.`} placeholder={dialog?.kind === "newFile" ? "src/new-file.ts" : dialog?.kind === "rename" ? "src/renamed.ts" : "feature/my-change"} initial={dialog?.kind === "rename" ? openFile?.path ?? "" : ""} confirmLabel={dialog?.kind === "newFile" ? "Create" : dialog?.kind === "rename" ? "Rename" : "Create branch"} busy={dialogBusy} onConfirm={handleDialogConfirm} onClose={() => { if (!dialogBusy) setDialog(null); }} />
      <DeleteFileDialog {...props} />
    </div>
  );
}
