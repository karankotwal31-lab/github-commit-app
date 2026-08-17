import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/github";
import { type DeploymentInfo } from "@/components/PreviewPanel";
import { type RepoRef } from "../types";

/**
 * Live deployment preview for the current branch: fetches the latest GitHub
 * deployment (Vercel / Netlify / Actions register these on push) and polls
 * it every 30s while a repo + branch are open.
 */
export function useDeployment(opts: {
  selectedRepo: RepoRef;
  currentBranch: string | null;
}) {
  const { selectedRepo, currentBranch } = opts;
  const getDeploymentStatus = useAction(api.deployments.getDeploymentStatus);
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  const loadDeployment = useCallback(async () => {
    if (!selectedRepo || !currentBranch) return;
    const [owner, repo] = selectedRepo.fullName.split("/");
    if (!owner || !repo) return;
    setDeploymentLoading(true);
    try {
      const result = await getDeploymentStatus({
        owner,
        repo,
        branch: currentBranch,
      });
      setDeployment(result.deployment);
      setDeploymentError(result.error);
    } catch (e) {
      setDeploymentError(errorMessage(e));
    } finally {
      setDeploymentLoading(false);
    }
  }, [selectedRepo, currentBranch, getDeploymentStatus]);

  useEffect(() => {
    if (!selectedRepo || !currentBranch) {
      setDeployment(null);
      return;
    }
    void loadDeployment();
    const id = setInterval(() => void loadDeployment(), 30_000);
    return () => clearInterval(id);
  }, [selectedRepo, currentBranch, loadDeployment]);

  return {
    deployment,
    setDeployment,
    deploymentLoading,
    deploymentError,
    loadDeployment,
  };
}
