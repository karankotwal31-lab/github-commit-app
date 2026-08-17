import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, ownerOf, repoNameOf } from "@/lib/github";
import { type CiChecks, type RepoRef } from "../types";

/**
 * CI status for the current branch tip: check runs + legacy status contexts,
 * plus the dialog state that breaks them down.
 */
export function useCiChecks(opts: {
  selectedRepo: RepoRef;
  currentBranch: string | null;
}) {
  const { selectedRepo, currentBranch } = opts;
  const getBranchChecks = useAction(api.githubActions.getBranchChecks);
  const [checksOpen, setChecksOpen] = useState(false);
  const [checks, setChecks] = useState<CiChecks | null>(null);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checksError, setChecksError] = useState<string | null>(null);

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

  return {
    checksOpen,
    setChecksOpen,
    checks,
    setChecks,
    checksLoading,
    checksError,
    loadChecks,
  };
}
