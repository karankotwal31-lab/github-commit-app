import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, ownerOf, repoNameOf } from "@/lib/github";
import { type IssueEntry, type RepoRef } from "../types";

/** Open issues for the current repo + the dialog state that lists them. */
export function useIssues(opts: { selectedRepo: RepoRef }) {
  const { selectedRepo } = opts;
  const listIssues = useAction(api.githubActions.listIssues);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issues, setIssues] = useState<IssueEntry[] | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);

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

  return {
    issuesOpen,
    setIssuesOpen,
    issues,
    setIssues,
    issuesLoading,
    issuesError,
    loadIssues,
  };
}
