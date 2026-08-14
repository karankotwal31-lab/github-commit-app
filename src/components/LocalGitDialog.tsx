import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiffView } from "@/components/workspace-shared";
import { ConflictResolverDialog } from "@/components/ConflictResolverDialog";
import { diffLines } from "@/lib/diff";
import {
  abortSession,
  branchColor,
  checkoutRef,
  cherryPickCommit,
  cloneRepo,
  commitLocal,
  commitDiff,
  finishCherryPick,
  finishMerge,
  getActiveSession,
  getGraph,
  getStatus,
  localRepoExists,
  mergeBranch,
  pushLocal,
  resolveConflictFile,
  runRebase,
  stageFile,
  stashClear,
  stashDrop,
  stashList,
  stashPop,
  stashPush,
  startRebase,
  unstageFile,
  type CloneProgress,
  type ConflictFile,
  type GitBackend,
  type GraphCommit,
  type GraphData,
  type RebasePlan,
  type RebaseTodo,
  type StashEntry,
  type StatusRow,
} from "@/lib/localGit";
import { errorMessage, ownerOf, repoNameOf } from "@/lib/github";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleDot,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  HardDrive,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";

type Tab = "status" | "graph" | "merge" | "rebase" | "stash";

export function LocalGitDialog({
  open,
  onOpenChange,
  fullName,
  branch,
  connection,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fullName: string;
  branch: string;
  connection: { login: string | null; name: string | null };
  onRefresh: () => void;
}) {
  const owner = ownerOf(fullName);
  const repo = repoNameOf(fullName);

  const listBranches = useAction(api.githubActions.listBranches);
  const getCommitDetails = useAction(api.githubActions.getCommitDetails);
  const getTree = useAction(api.githubActions.getTree);
  const getBlob = useAction(api.githubActions.getBlob);
  const commitChanges = useAction(api.githubActions.commitChanges);

  const backend: GitBackend = useMemo(
    () => ({
      listBranches: (a) => listBranches(a),
      getCommitDetails: (a) => getCommitDetails(a),
      getTree: (a) => getTree(a),
      getBlob: (a) => getBlob(a),
      commitChanges: (a) => commitChanges(a),
    }),
    [listBranches, getCommitDetails, getTree, getBlob, commitChanges],
  );

  const author = useMemo(
    () => ({
      name: connection.name ?? connection.login ?? "Aria",
      email: connection.login
        ? `${connection.login}@users.noreply.github.com`
        : "aria@users.noreply.github.com",
      date: null as string | null,
    }),
    [connection],
  );

  const [tab, setTab] = useState<Tab>("status");
  const [checked, setChecked] = useState(false);
  const [exists, setExists] = useState(false);

  // Clone
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);
  const [depth, setDepth] = useState(20);

  // Status / commit / push
  const [statusRows, setStatusRows] = useState<StatusRow[] | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [allowSecrets, setAllowSecrets] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [pushConfirm, setPushConfirm] = useState(false);

  // Graph
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [selected, setSelected] = useState<GraphCommit | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<
    Array<{ path: string; oldText: string; newText: string; binary: boolean }> | null
  >(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Branches (local) for merge/rebase targets
  const [localBranches, setLocalBranches] = useState<string[]>([]);

  // Merge
  const [mergeTarget, setMergeTarget] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeNote, setMergeNote] = useState<string | null>(null);

  // Rebase
  const [rebaseBase, setRebaseBase] = useState("");
  const [rebasePlan, setRebasePlan] = useState<RebasePlan | null>(null);
  const [rebaseTodos, setRebaseTodos] = useState<RebaseTodo[]>([]);
  const [rebasing, setRebasing] = useState(false);

  // Stash
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [stashMsg, setStashMsg] = useState("");
  const [stashBusy, setStashBusy] = useState(false);

  // Conflicts
  const [conflict, setConflict] = useState<{
    kind: "merge" | "rebase" | "cherry-pick";
    files: ConflictFile[];
  } | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);

  const reloadAll = useCallback(async () => {
    const [status, g, stashes] = await Promise.all([
      getStatus(owner, repo),
      getGraph(owner, repo).catch(() => null),
      stashList(owner, repo).catch(() => []),
    ]);
    // Local branch names come from the graph's ref list.
    setStatusRows(status);
    setGraph(g);
    setStashes(stashes);
    setLocalBranches(
      g
        ? [...new Set([...g.branches.map((b) => b.name), branch])].sort()
        : [branch],
    );
    setMergeTarget((prev) => prev || (g?.branches[0]?.name ?? ""));
    setRebaseBase((prev) => prev || (g?.branches[0]?.name ?? ""));
  }, [owner, repo, branch]);

  const init = useCallback(async () => {
    if (!open) return;
    setChecked(false);
    setExists(await localRepoExists(owner, repo));
    setChecked(true);
    setTab("status");
    setConflict(null);
    setPushNote(null);
    setMergeNote(null);
    setPushConfirm(false);
    if (await localRepoExists(owner, repo)) {
      await reloadAll();
    }
  }, [open, owner, repo, reloadAll]);

  useEffect(() => {
    // Defer past the effect body so synchronous state updates don't cascade.
    const timer = setTimeout(() => void init(), 0);
    return () => clearTimeout(timer);
  }, [init]);

  // Refresh status/graph when the repo was just cloned.
  const afterLocalChange = useCallback(() => {
    void reloadAll();
  }, [reloadAll]);

  const handleClone = async () => {
    setCloning(true);
    setCloneProgress({ phase: "initializing", done: 0, total: 1 });
    try {
      const result = await cloneRepo(backend, {
        owner,
        repo,
        branch,
        depth,
        author,
        onProgress: setCloneProgress,
      });
      setExists(true);
      setCloneProgress(null);
      await reloadAll();
      toast.success(
        `Cloned ${fullName} into this device — ${result.commits} commits, ${result.files} files (${result.durationMs / 1000}s).`,
      );
    } catch (e) {
      setCloneProgress(null);
      toast.error(errorMessage(e));
    } finally {
      setCloning(false);
    }
  };

  const handleStage = async (path: string) => {
    try {
      await stageFile(owner, repo, path);
      afterLocalChange();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleUnstage = async (path: string) => {
    try {
      await unstageFile(owner, repo, path);
      afterLocalChange();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleCommit = async () => {
    setCommitting(true);
    try {
      const result = await commitLocal({
        owner,
        repo,
        message: commitMessage.trim(),
        author,
        allowSecrets,
      });
      setCommitMessage("");
      setAllowSecrets(false);
      setStatusRows(null);
      afterLocalChange();
      toast.success(`Committed locally ${result.oid.slice(0, 7)}`);
    } catch (e) {
      const message = errorMessage(e);
      if (/secret/i.test(message)) {
        setAllowSecrets(true);
        toast.warning(message, {
          action: {
            label: "Commit anyway",
            onClick: () => {
              setAllowSecrets(true);
              void handleCommit();
            },
          },
        });
      } else {
        toast.error(message);
      }
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setPushNote(null);
    try {
      const result = await pushLocal(backend, {
        owner,
        repo,
        branch,
        allowSecrets: pushConfirm,
        onProgress: () => {},
      });
      setPushConfirm(false);
      setPushNote(
        result.pushed === 0
          ? "Already up to date — nothing to push."
          : `Pushed ${result.pushed} commit${result.pushed > 1 ? "s" : ""} to GitHub${result.replayed ? " (replayed onto the current tip — ancestry may differ from local after a rebase)" : ""}${result.skippedBinary.length > 0 ? `. Skipped binary files: ${result.skippedBinary.join(", ")}` : ""}`,
      );
      toast.success("Pushed to GitHub");
      onRefresh();
    } catch (e) {
      const message = errorMessage(e);
      if (/secret/i.test(message) && !pushConfirm) {
        setPushConfirm(true);
        toast.warning(message, {
          action: {
            label: "Push anyway",
            onClick: () => {
              setPushConfirm(true);
              void handlePush();
            },
          },
        });
      } else {
        toast.error(message);
      }
    } finally {
      setPushing(false);
    }
  };

  const handleMerge = async () => {
    if (!mergeTarget) return;
    setMerging(true);
    setMergeNote(null);
    try {
      const outcome = await mergeBranch(backend, {
        owner,
        repo,
        theirs: mergeTarget,
        message: `Merge branch '${mergeTarget}' into ${branch}`,
        author,
        onProgress: () => {},
      });
      if (outcome.type === "clean") {
        if (outcome.alreadyMerged) {
          setMergeNote(`${mergeTarget} is already fully merged.`);
        } else if (outcome.fastForward) {
          setMergeNote(`Fast-forwarded ${branch} to ${mergeTarget}.`);
        } else {
          setMergeNote(`Merged ${mergeTarget} into ${branch}.`);
        }
        toast.success(
          outcome.fastForward
            ? `Fast-forwarded to ${mergeTarget}`
            : `Merged ${mergeTarget}`,
        );
        onRefresh();
        afterLocalChange();
      } else {
        setConflict({ kind: "merge", files: outcome.files });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setMerging(false);
    }
  };

  const handleRebaseStart = async () => {
    if (!rebaseBase) return;
    try {
      const plan = await startRebase({ owner, repo, base: rebaseBase });
      setRebasePlan(plan);
      setRebaseTodos(
        plan.todos.map((t) => ({ ...t, action: t.action })),
      );
      if (plan.autoDroppedMerges > 0) {
        toast.info(
          `Dropped ${plan.autoDroppedMerges} merge commit${plan.autoDroppedMerges > 1 ? "s" : ""} (rebase linearizes history).`,
        );
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const moveTodo = (index: number, dir: -1 | 1) => {
    setRebaseTodos((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleRebaseApply = async () => {
    setRebasing(true);
    try {
      // Write the edited todos into the engine session.
      const session = getActiveSession();
      if (session && session.kind === "rebase") {
        session.todos = rebaseTodos;
      }
      const outcome = await runRebase(backend, { owner, repo });
      if (outcome.conflict) {
        setConflict({ kind: "rebase", files: outcome.files });
      } else {
        setRebasePlan(null);
        setRebaseTodos([]);
        toast.success(`Rebased ${branch} — ${outcome.commits} commit${outcome.commits === 1 ? "" : "s"} replayed.`);
        onRefresh();
        afterLocalChange();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRebasing(false);
    }
  };

  const handleStashPush = async () => {
    setStashBusy(true);
    try {
      await stashPush(owner, repo, stashMsg.trim() || "WIP");
      setStashMsg("");
      afterLocalChange();
      toast.success("Stashed changes");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStashBusy(false);
    }
  };

  const handleStashPop = async (index: number) => {
    setStashBusy(true);
    try {
      await stashPop(owner, repo, index);
      afterLocalChange();
      toast.success("Stash applied");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStashBusy(false);
    }
  };

  const handleStashDrop = async (index: number) => {
    setStashBusy(true);
    try {
      await stashDrop(owner, repo, index);
      afterLocalChange();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStashBusy(false);
    }
  };

  const handleCheckout = async (ref: string) => {
    try {
      const result = await checkoutRef(owner, repo, ref, false);
      toast.success(
        result.detached
          ? `Detached HEAD at ${ref.slice(0, 7)}`
          : `Checked out ${result.branch}`,
      );
      onRefresh();
      await reloadAll();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleCherryPick = async (oid: string) => {
    try {
      const outcome = await cherryPickCommit(backend, { owner, repo, oid });
      if (outcome.conflict) {
        setConflict({ kind: "cherry-pick", files: outcome.files });
      } else {
        toast.success(`Cherry-picked ${oid.slice(0, 7)}`);
        onRefresh();
        afterLocalChange();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleSelectCommit = async (commit: GraphCommit) => {
    setSelected(commit);
    setSelectedDiff(null);
    setDiffLoading(true);
    try {
      const diffs = await commitDiff(backend, owner, repo, commit.oid);
      setSelectedDiff(diffs);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDiffLoading(false);
    }
  };

  // Conflict resolver wiring
  const handleSaveConflictFile = async (path: string, content: Uint8Array | null) => {
    await resolveConflictFile(owner, repo, path, content);
    setConflict((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        files: prev.files.map((f) =>
          f.path === path ? { ...f, resolved: true } : f,
        ),
      };
    });
  };

  const handleFinishConflicts = async () => {
    setConflictBusy(true);
    try {
      const session = getActiveSession();
      if (!session) return;
      if (session.kind === "merge") {
        await finishMerge({
          owner,
          repo,
          message: `Merge branch '${session.theirs}' into ${session.branch}`,
          author,
        });
        toast.success(`Merged ${session.theirs} into ${session.branch}`);
      } else if (session.kind === "rebase") {
        const outcome = await runRebase(backend, { owner, repo });
        if (outcome.conflict) {
          setConflict({ kind: "rebase", files: outcome.files });
          return;
        }
        setRebasePlan(null);
        setRebaseTodos([]);
        toast.success(`Rebase completed — ${outcome.commits} commit${outcome.commits === 1 ? "" : "s"} replayed.`);
      } else {
        await finishCherryPick({ owner, repo });
        toast.success("Cherry-pick completed");
      }
      setConflict(null);
      onRefresh();
      afterLocalChange();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setConflictBusy(false);
    }
  };

  const handleAbortConflicts = async () => {
    setConflictBusy(true);
    try {
      await abortSession({ owner, repo });
      setConflict(null);
      toast.info("Operation aborted");
      afterLocalChange();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setConflictBusy(false);
    }
  };

  const stagedCount = (statusRows ?? []).filter((r) => r.staged).length;
  const changedCount = (statusRows ?? []).length;
  const riskyStaged = (statusRows ?? []).filter((r) => r.staged && /secret|env|key/i.test(r.path)).length;

  const lanes = useMemo(() => layoutLanes(graph), [graph]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[86vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="size-4 text-neutral-600" />
            Local git — {fullName}
            <span className="rounded border border-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
              {branch}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-neutral-100 pb-2">
          {(
            [
              ["status", "Status"],
              ["graph", "Graph"],
              ["merge", "Merge"],
              ["rebase", "Rebase"],
              ["stash", "Stash"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === key
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-500 hover:bg-neutral-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto pt-3">
          {!checked ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-neutral-400">
              <Loader2 className="size-4 animate-spin" />
              Checking local repository…
            </div>
          ) : !exists ? (
            <div className="mx-auto max-w-md py-10 text-center">
              <HardDrive className="mx-auto mb-3 size-8 text-neutral-200" />
              <p className="text-sm font-medium text-neutral-800">
                This repo isn't on this device yet
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                Aria clones the branch into your browser (LightningFS) so
                merges, rebases, stashes and cherry-picks run as real git —
                offline, against real objects.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <select
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-700"
                  title="History depth for the shallow clone"
                >
                  {[1, 5, 20, 50].map((d) => (
                    <option key={d} value={d}>
                      depth {d}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={() => void handleClone()}
                  disabled={cloning}
                >
                  {cloning ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <GitBranch className="mr-1.5 size-3.5" />
                  )}
                  Clone into browser
                </Button>
              </div>
              {cloneProgress && (
                <div className="mt-4 text-left">
                  <p className="mb-1 text-[11px] text-neutral-500">
                    {cloneProgress.phase === "history" && "Fetching commit history…"}
                    {cloneProgress.phase === "commits" && `Writing ${cloneProgress.total} commits…`}
                    {cloneProgress.phase === "trees" && "Writing trees…"}
                    {cloneProgress.phase === "files" &&
                      `Downloading ${cloneProgress.total} files…`}
                    {cloneProgress.phase === "checkout" && "Checking out…"}
                  </p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full bg-neutral-900 transition-all"
                      style={{
                        width:
                          cloneProgress.total > 0
                            ? `${Math.min(100, (cloneProgress.done / cloneProgress.total) * 100)}%`
                            : "8%",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {tab === "status" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
                    Working tree on this device. Changes are real git objects;
                    <span className="font-medium text-neutral-700"> Commit</span>{" "}
                    creates a local commit,{" "}
                    <span className="font-medium text-neutral-700"> Push</span>{" "}
                    translates local commits into GitHub commits.{" "}
                    <span className="font-medium text-neutral-700">Reset</span>{" "}
                    restores the local repo from GitHub at any time.
                  </div>

                  {pushNote && (
                    <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] text-sky-800">
                      {pushNote}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-neutral-700">
                      {statusRows === null
                        ? "Reading status…"
                        : `${changedCount} change${changedCount === 1 ? "" : "s"} · ${stagedCount} staged`}
                    </p>
                    <button
                      type="button"
                      onClick={() => afterLocalChange()}
                      className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700"
                    >
                      <RefreshCw className="size-3" /> Refresh
                    </button>
                  </div>

                  {statusRows && statusRows.length === 0 ? (
                    <div className="py-6 text-center text-xs text-neutral-400">
                      <CheckCircle2 className="mx-auto mb-2 size-5 text-emerald-400" />
                      Working tree clean.
                    </div>
                  ) : (
                    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
                      {statusRows?.map((row) => (
                        <li
                          key={row.path}
                          className="flex items-center gap-2 px-3 py-2"
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              row.label === "modified" && "bg-amber-400",
                              row.label === "deleted" && "bg-red-400",
                              row.label === "untracked" && "bg-neutral-300",
                              row.label === "added" && "bg-emerald-400",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-800">
                            {row.path}
                          </span>
                          <span className="shrink-0 rounded border border-neutral-200 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-400">
                            {row.label}
                            {row.staged ? " · staged" : ""}
                          </span>
                          {row.staged ? (
                            <button
                              type="button"
                              onClick={() => void handleUnstage(row.path)}
                              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            >
                              Unstage
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleStage(row.path)}
                              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            >
                              Stage
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center gap-2">
                    <Input
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit message"
                      className="h-9 flex-1 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && stagedCount > 0) void handleCommit();
                      }}
                    />
                    <Button
                      type="button"
                      onClick={() => void handleCommit()}
                      disabled={stagedCount === 0 || committing}
                    >
                      {committing ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Check className="mr-1.5 size-3.5" />
                      )}
                      Commit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handlePush()}
                      disabled={pushing}
                      title="Translate local commits into GitHub commits"
                    >
                      {pushing ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Send className="mr-1.5 size-3.5" />
                      )}
                      Push
                    </Button>
                  </div>
                  {riskyStaged > 0 && (
                    <label className="flex items-center gap-2 text-[11px] text-amber-700">
                      <input
                        type="checkbox"
                        checked={allowSecrets}
                        onChange={(e) => setAllowSecrets(e.target.checked)}
                      />
                      {riskyStaged} staged file{riskyStaged > 1 ? "s look" : " looks"}{" "}
                      like {riskyStaged > 1 ? "they contain" : "it contains"}{" "}
                      secrets — commit anyway
                    </label>
                  )}
                </div>
              )}

              {tab === "graph" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-neutral-500">
                      {graph === null
                        ? "Loading graph…"
                        : `${graph?.branches.length ?? 0} branches · ${graph?.commits.length ?? 0} commits`}
                    </p>
                    <div className="flex items-center gap-1">
                      {graph?.branches.map((b, i) => (
                        <span
                          key={b.name}
                          className="flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600"
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: branchColor(i) }}
                          />
                          {b.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {!graph || graph.commits.length === 0 ? (
                    <p className="py-8 text-center text-xs text-neutral-400">
                      No local commits yet — clone the repo first.
                    </p>
                  ) : (
                    <>
                      <div className="overflow-hidden rounded-lg border border-neutral-200">
                        {graph.commits.slice(0, 60).map((commit) => {
                          const lane = lanes.get(commit.oid) ?? 0;
                          const color = branchColor(lane);
                          const branchHere = graph.branches
                            .filter((b) => b.oid === commit.oid)
                            .map((b) => ({
                              name: b.name,
                              color: branchColor(
                                graph.branches.findIndex((x) => x.name === b.name),
                              ),
                            }));
                          const isHead = graph.headOid === commit.oid;
                          return (
                            <button
                              key={commit.oid}
                              type="button"
                              onClick={() => void handleSelectCommit(commit)}
                              className={cn(
                                "flex w-full items-center gap-2 border-b border-neutral-100 px-2 py-1.5 text-left last:border-b-0",
                                selected?.oid === commit.oid
                                  ? "bg-neutral-50"
                                  : "hover:bg-neutral-50/60",
                              )}
                            >
                              <svg
                                width={Math.max(lanes.size, 2) * 14}
                                height={26}
                                className="shrink-0"
                              >
                                <line
                                  x1={lane * 14 + 7}
                                  y1={0}
                                  x2={lane * 14 + 7}
                                  y2={26}
                                  stroke={color}
                                  strokeWidth={1.5}
                                  opacity={0.35}
                                />
                                {commit.parents.slice(0, 2).map((parent) => {
                                  const pl = lanes.get(parent);
                                  if (pl === undefined) return null;
                                  return (
                                    <path
                                      key={parent}
                                      d={`M ${lane * 14 + 7} 13 L ${pl * 14 + 7} 26`}
                                      stroke={branchColor(pl)}
                                      strokeWidth={1.5}
                                      opacity={0.5}
                                      fill="none"
                                    />
                                  );
                                })}
                                <circle
                                  cx={lane * 14 + 7}
                                  cy={13}
                                  r={isHead ? 5 : 3.5}
                                  fill={color}
                                  stroke="white"
                                  strokeWidth={isHead ? 2 : 1}
                                />
                              </svg>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-neutral-800">
                                  {commit.message.split("\n")[0]}
                                </p>
                                <p className="truncate text-[10px] text-neutral-400">
                                  {commit.author} ·{" "}
                                  {new Date(commit.date).toLocaleString()}
                                </p>
                              </div>
                              {branchHere.length > 0 && (
                                <div className="flex shrink-0 items-center gap-1">
                                  {branchHere.map((b) => (
                                    <span
                                      key={b.name}
                                      className="rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white"
                                      style={{ backgroundColor: b.color }}
                                    >
                                      {b.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <span className="shrink-0 font-mono text-[10px] text-neutral-300">
                                {commit.oid.slice(0, 7)}
                              </span>
                            </button>
                          );
                        })}
                        {graph.commits.length > 60 && (
                          <p className="px-3 py-2 text-[10px] text-neutral-400">
                            Showing first 60 commits.
                          </p>
                        )}
                      </div>

                      {selected && (
                        <div className="rounded-lg border border-neutral-200">
                          <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                            <p className="truncate font-mono text-xs font-medium text-neutral-800">
                              {selected.oid.slice(0, 12)} —{" "}
                              {selected.message.split("\n")[0]}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={() => void handleCherryPick(selected.oid)}
                              >
                                <GitCommitHorizontal className="mr-1 size-3" />
                                Cherry-pick
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[11px]"
                                disabled={selected.oid === graph.headOid}
                                onClick={() => void handleCheckout(selected.oid)}
                              >
                                <GitBranch className="mr-1 size-3" />
                                Checkout
                              </Button>
                            </div>
                          </div>
                          {diffLoading ? (
                            <div className="flex items-center justify-center gap-2 py-6 text-xs text-neutral-400">
                              <Loader2 className="size-3.5 animate-spin" />
                              Computing diff…
                            </div>
                          ) : (
                            <div className="max-h-72 overflow-auto">
                              {selectedDiff?.map((file) => (
                                <div
                                  key={file.path}
                                  className="border-b border-neutral-100 last:border-b-0"
                                >
                                  <p className="px-3 py-1.5 font-mono text-[11px] text-neutral-600">
                                    {file.path}
                                  </p>
                                  <DiffView
                                    lines={diffLines(file.oldText, file.newText)}
                                  />
                                </div>
                              ))}
                              {selectedDiff?.length === 0 && (
                                <p className="px-3 py-4 text-center text-[11px] text-neutral-400">
                                  Root commit — no parent to diff against.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {tab === "merge" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
                    Merge another local branch into{" "}
                    <span className="font-mono font-medium text-neutral-800">
                      {branch}
                    </span>
                    . Conflicting files open in the three-way resolver.
                  </div>
                  {mergeNote && (
                    <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                      {mergeNote}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <select
                      value={mergeTarget}
                      onChange={(e) => setMergeTarget(e.target.value)}
                      className="h-9 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-sm text-neutral-700"
                    >
                      {localBranches
                        .filter((b) => b !== branch)
                        .map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                    </select>
                    <Button
                      type="button"
                      onClick={() => void handleMerge()}
                      disabled={!mergeTarget || merging}
                    >
                      {merging ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <GitMerge className="mr-1.5 size-3.5" />
                      )}
                      Merge into {branch}
                    </Button>
                  </div>
                </div>
              )}

              {tab === "rebase" && (
                <div className="space-y-4">
                  {!rebasePlan ? (
                    <>
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
                        Replay this branch's commits onto another branch. Pick,
                        squash, reword or drop each commit, reorder them, then
                        apply. Conflicts open in the three-way resolver.
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={rebaseBase}
                          onChange={(e) => setRebaseBase(e.target.value)}
                          className="h-9 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-sm text-neutral-700"
                        >
                          {localBranches
                            .filter((b) => b !== branch)
                            .map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                        </select>
                        <Button
                          type="button"
                          onClick={() => void handleRebaseStart()}
                          disabled={!rebaseBase}
                        >
                          <GitBranch className="mr-1.5 size-3.5" />
                          Plan rebase
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        Rebase {branch} onto {rebaseBase} — {rebaseTodos.length}{" "}
                        commits. The working tree was reset to the base.
                      </div>
                      <ul className="space-y-1">
                        {rebaseTodos.map((todo, index) => (
                          <li
                            key={todo.oid}
                            className="flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5"
                          >
                            <div className="flex flex-col">
                              <button
                                type="button"
                                className="rounded p-0.5 text-neutral-300 hover:text-neutral-600"
                                onClick={() => moveTodo(index, -1)}
                                disabled={index === 0}
                              >
                                <ArrowUp className="size-3" />
                              </button>
                              <button
                                type="button"
                                className="rounded p-0.5 text-neutral-300 hover:text-neutral-600"
                                onClick={() => moveTodo(index, 1)}
                                disabled={index === rebaseTodos.length - 1}
                              >
                                <ArrowDown className="size-3" />
                              </button>
                            </div>
                            <select
                              value={todo.action}
                              onChange={(e) =>
                                setRebaseTodos((prev) =>
                                  prev.map((t, i) =>
                                    i === index
                                      ? {
                                          ...t,
                                          action: e.target
                                            .value as RebaseTodo["action"],
                                        }
                                      : t,
                                  ),
                                )
                              }
                              className="h-7 w-24 rounded border border-neutral-200 bg-white px-1 text-[11px] text-neutral-700"
                            >
                              <option value="pick">pick</option>
                              <option value="squash">squash</option>
                              <option value="reword">reword</option>
                              <option value="drop">drop</option>
                            </select>
                            {todo.action === "reword" ? (
                              <Input
                                value={todo.message}
                                onChange={(e) =>
                                  setRebaseTodos((prev) =>
                                    prev.map((t, i) =>
                                      i === index
                                        ? { ...t, message: e.target.value }
                                        : t,
                                    ),
                                  )
                                }
                                className="h-7 flex-1 text-[11px]"
                              />
                            ) : (
                              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-700">
                                {todo.message.split("\n")[0]}
                              </span>
                            )}
                            <span className="font-mono text-[10px] text-neutral-300">
                              {todo.oid.slice(0, 7)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRebasePlan(null);
                            setRebaseTodos([]);
                            void abortSession({ owner, repo }).then(afterLocalChange);
                          }}
                        >
                          <RotateCcw className="mr-1.5 size-3.5" />
                          Abort
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleRebaseApply()}
                          disabled={rebasing}
                        >
                          {rebasing ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <GitBranch className="mr-1.5 size-3.5" />
                          )}
                          Apply rebase
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === "stash" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Input
                      value={stashMsg}
                      onChange={(e) => setStashMsg(e.target.value)}
                      placeholder="Stash message (optional)"
                      className="h-9 flex-1 text-sm"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleStashPush()}
                      disabled={stashBusy || changedCount === 0}
                    >
                      {stashBusy ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <HardDrive className="mr-1.5 size-3.5" />
                      )}
                      Stash changes
                    </Button>
                  </div>
                  {stashes.length === 0 ? (
                    <p className="py-6 text-center text-xs text-neutral-400">
                      No stashes yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
                      {stashes.map((stash) => (
                        <li
                          key={stash.index}
                          className="flex items-center gap-2 px-3 py-2"
                        >
                          <CircleDot className="size-3 shrink-0 text-neutral-300" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-800">
                            {stash.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleStashPop(stash.index)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                          >
                            Pop
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleStashDrop(stash.index)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {stashes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void stashClear(owner, repo).then(afterLocalChange)}
                      className="text-[11px] text-neutral-400 hover:text-red-600"
                    >
                      Clear all stashes
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>

      {conflict && (
        <ConflictResolverDialog
          open={!!conflict}
          onOpenChange={(v) => {
            if (!v) setConflict(null);
          }}
          kind={conflict.kind}
          files={conflict.files}
          busy={conflictBusy}
          onSaveFile={handleSaveConflictFile}
          onFinish={handleFinishConflicts}
          onAbort={handleAbortConflicts}
        />
      )}
    </Dialog>
  );
}

/** Gitk-style lane assignment: newest → oldest, freeing lanes as commits pass. */
function layoutLanes(graph: GraphData | null): Map<string, number> {
  const laneOf = new Map<string, number>();
  if (!graph) return laneOf;
  const lanes: Array<string | null> = [];
  for (const commit of graph.commits) {
    let lane = lanes.indexOf(commit.oid);
    if (lane === -1) {
      lane = lanes.findIndex((l) => l === null);
      if (lane === -1) lane = lanes.length;
    }
    lanes[lane] = null;
    laneOf.set(commit.oid, lane);
    let first = true;
    for (const parent of commit.parents.slice(0, 2)) {
      let pl = lanes.indexOf(parent);
      if (pl === -1) {
        pl = first ? lane : lanes.findIndex((l) => l === null);
        if (pl === -1) pl = lanes.length;
      }
      if (lanes[pl] === null || lanes[pl] === parent) lanes[pl] = parent;
      first = false;
    }
  }
  return laneOf;
}
