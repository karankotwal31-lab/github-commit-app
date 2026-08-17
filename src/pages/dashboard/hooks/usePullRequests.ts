import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, ownerOf, repoNameOf } from "@/lib/github";
import { toast } from "sonner";
import {
  type MergeTarget,
  type PullRequestEntry,
  type PullRequestFile,
  type PullRequestReview,
  type RepoRef,
} from "../types";

/**
 * Open pull requests for the current repo + the merge and review flows.
 * Merging onto the branch you're viewing changes the workspace's branch tip,
 * so the caller supplies `onMergedOntoCurrentBranch` to refresh it.
 */
export function usePullRequests<R extends RepoRef>(opts: {
  selectedRepo: R;
  currentBranch: string | null;
  onMergedOntoCurrentBranch: (
    repo: NonNullable<R>,
    branch: string,
  ) => Promise<void>;
}) {
  const { selectedRepo, currentBranch, onMergedOntoCurrentBranch } = opts;
  const listPullRequests = useAction(api.githubActions.listPullRequests);
  const mergePullRequest = useAction(api.githubActions.mergePullRequest);
  const getPullRequestFiles = useAction(api.githubActions.getPullRequestFiles);
  const [prsOpen, setPrsOpen] = useState(false);
  const [prs, setPrs] = useState<PullRequestEntry[] | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<MergeTarget | null>(null);
  const [merging, setMerging] = useState(false);
  const [prReview, setPrReview] = useState<PullRequestReview | null>(null);
  const [prFiles, setPrFiles] = useState<PullRequestFile[] | null>(null);
  const [prFilesLoading, setPrFilesLoading] = useState(false);
  const [prFilesError, setPrFilesError] = useState<string | null>(null);
  const [expandedPrFile, setExpandedPrFile] = useState<string | null>(null);

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
      toast.success(
        result.message || `Merged pull request #${mergeTarget.number}`,
      );
      // Refresh the PR list, and if the merge landed on the branch we're
      // viewing, refresh the workspace too.
      loadPullRequests();
      if (currentBranch === selectedRepo.defaultBranch) {
        await onMergedOntoCurrentBranch(selectedRepo, currentBranch);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setMerging(false);
    }
  };

  /** Open the review dialog for a pull request and load its changed files. */
  const openPrReview = async (pr: PullRequestReview) => {
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

  return {
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
  };
}
