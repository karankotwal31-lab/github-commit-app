import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiffView } from "@/components/workspace-shared";
import { diffLines } from "@/lib/diff";
import { formatSize } from "@/lib/github";
import { cn } from "@/lib/utils";
import { lazy, useMemo } from "react";
import type { WorkspaceViewProps } from "./types";
import {
  ArrowLeft,
  FileCode2,
  GitPullRequest,
  Github,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";

// CodeEditor pulls in Monaco (≈1.5 MB gzipped) — lazy-load it so the app
// shell loads fast and the editor arrives on the first file open. The tiny
// symbol-insertion/focus registry stays in the main bundle (type-only monaco
// import in editorRegistry).
const CodeEditor = lazy(() =>
  import("@/components/CodeEditor").then((m) => ({ default: m.CodeEditor })),
);

type EditorPaneProps = Pick<
  WorkspaceViewProps,
  | "mobileView"
  | "connection"
  | "selectedRepo"
  | "currentBranch"
  | "openFile"
  | "setOpenFile"
  | "isNewFile"
  | "editorContent"
  | "setEditorContent"
  | "viewMode"
  | "setViewMode"
  | "fileLoading"
  | "dirty"
  | "openFileIsStaged"
  | "status"
  | "lastCommit"
  | "prResult"
  | "handleOpenPr"
  | "prOpen"
  | "staged"
  | "setStaged"
  | "stagedDiffOpen"
  | "setStagedDiffOpen"
  | "handleUnstage"
  | "flaggedSecretPaths"
  | "allowSecrets"
  | "setAllowSecrets"
  | "commitMessage"
  | "setCommitMessage"
  | "canCommit"
  | "handleCommit"
  | "handleStage"
  | "committing"
>;

interface EditorPaneCallbacks {
  onOpenWhy: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/** Editor — open file chrome, diff/editor surface, staged changes, commit bar. */
export function EditorPane(props: EditorPaneProps & EditorPaneCallbacks) {
  const {
    mobileView,
    connection,
    selectedRepo,
    currentBranch,
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
    onOpenWhy,
    onRename,
    onDelete,
  } = props;

  const diff = useMemo(
    () => (openFile ? diffLines(openFile.content, editorContent) : []),
    [openFile, editorContent],
  );

  return (
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
                <button
                  type="button"
                  onClick={onOpenWhy}
                  title="Why was this changed? — Aria explains this file's history in plain language"
                  className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
                >
                  Why?
                </button>
              )}
              {!isNewFile && (
                <>
                  <button
                    type="button"
                    onClick={onRename}
                    title="Rename"
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onDelete}
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
            ) : openFile.size > 1_000_000 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm font-medium text-neutral-700">This file is {formatSize(openFile.size)}.</p>
                <p className="text-xs text-neutral-500 max-w-md">Large files may be slow to load in the editor. The file is read-only for performance.</p>
                <div className="max-h-[70vh] w-full overflow-auto rounded-lg border border-neutral-200">
                  <pre className="p-4 text-xs font-mono leading-5 text-neutral-800 whitespace-pre-wrap">{editorContent.slice(0, 50_000)}{editorContent.length > 50_000 ? "\n\n… truncated for performance" : ""}</pre>
                </div>
              </div>
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
  );
}
