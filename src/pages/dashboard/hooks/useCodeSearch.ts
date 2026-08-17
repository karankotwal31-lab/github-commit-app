import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, ownerOf, repoNameOf } from "@/lib/github";
import { type CodeSearchResult, type RepoRef } from "../types";

/**
 * Full-text code search inside the current repo. Owns the dialog state, the
 * query, the results, and the search runner. Opening a result in the editor
 * stays with the caller (it shares the workspace's open-file machinery).
 */
export function useCodeSearch(opts: { selectedRepo: RepoRef }) {
  const { selectedRepo } = opts;
  const searchCode = useAction(api.githubActions.searchCode);
  const [codeSearchOpen, setCodeSearchOpen] = useState(false);
  const [codeQuery, setCodeQuery] = useState("");
  const [codeResults, setCodeResults] = useState<CodeSearchResult[] | null>(
    null,
  );
  const [codeSearchLoading, setCodeSearchLoading] = useState(false);
  const [codeSearchError, setCodeSearchError] = useState<string | null>(null);

  const runCodeSearch = useCallback(async () => {
    if (!selectedRepo || !codeQuery.trim()) return;
    setCodeSearchLoading(true);
    setCodeSearchError(null);
    try {
      const results = await searchCode({
        owner: ownerOf(selectedRepo.fullName),
        repo: repoNameOf(selectedRepo.fullName),
        query: codeQuery.trim(),
      });
      setCodeResults(results);
    } catch (e) {
      setCodeSearchError(errorMessage(e));
    } finally {
      setCodeSearchLoading(false);
    }
  }, [selectedRepo, codeQuery, searchCode]);

  return {
    codeSearchOpen,
    setCodeSearchOpen,
    codeQuery,
    setCodeQuery,
    codeResults,
    setCodeResults,
    codeSearchLoading,
    setCodeSearchLoading,
    codeSearchError,
    setCodeSearchError,
    runCodeSearch,
  };
}
