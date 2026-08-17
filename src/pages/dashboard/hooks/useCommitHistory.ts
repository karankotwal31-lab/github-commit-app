import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, ownerOf, repoNameOf } from "@/lib/github";
import { toast } from "sonner";
import {
  type HistoryEntry,
  type RepoRef,
  type RevertTarget,
} from "../types";

/**
 * Commit history for the current branch + the revert flow. Reverting rewrites
 * the branch tip server-side; the caller supplies `onWorkspaceChanged` so the
 * hook stays decoupled from the workspace's tree/file refresh machinery.
 */
export function useCommitHistory<R extends RepoRef>(opts: {
  selectedRepo: R;
  currentBranch: string | null;
  onWorkspaceChanged: (
    repo: NonNullable<R>,
    branch: string,
  ) => Promise<void>;
}) {
  const { selectedRepo, currentBranch, onWorkspaceChanged } = opts;
  const getCommitHistory = useAction(api.githubActions.getCommitHistory);
  const revertCommit = useAction(api.githubActions.revertCommit);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);
  const [reverting, setReverting] = useState(false);
  const PER_PAGE = 50;

  const loadHistory = useCallback(
    async (page: number = 1, append = false) => {
      if (!selectedRepo || !currentBranch) return;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const data = await getCommitHistory({
          owner: ownerOf(selectedRepo.fullName),
          repo: repoNameOf(selectedRepo.fullName),
          branch: currentBranch,
          perPage: PER_PAGE,
          page,
        });
        setHistory((prev) => {
          if (!append || !prev) return data;
          const seen = new Set(prev.map((c) => c.sha));
          return [...prev, ...data.filter((c) => !seen.has(c.sha))];
        });
        setHistoryPage(page);
      } catch (e) {
        setHistoryError(errorMessage(e));
      } finally {
        setHistoryLoading(false);
      }
    },
    [selectedRepo, currentBranch, getCommitHistory],
  );

  const loadMoreHistory = useCallback(() => {
    void loadHistory(historyPage + 1, true);
  }, [historyPage, loadHistory]);

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
      await onWorkspaceChanged(selectedRepo, currentBranch);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setReverting(false);
    }
  };

  return {
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
  };
}
