"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "aria";

/**
 * Live deployment status for a branch, read from GitHub's Deployments API.
 *
 * Vercel, Netlify and GitHub Actions all publish preview deployments back to
 * GitHub when they deploy a branch — including the live preview URL in
 * `target_url` — so Aria can surface "your app is live at …" using the user's
 * existing GitHub token, with no extra platform credentials. Platform-native
 * API keys (Vercel/Netlify tokens) can be layered on later behind env vars in
 * this same action.
 *
 * GitHub states: `pending` / `in_progress` / `success` / `failure` /
 * `error` / `inactive` (the deployment may also simply not exist yet).
 */

interface GitHubDeployment {
  id: number;
  environment: string;
  created_at: string | null;
  updated_at: string | null;
  creator?: { login?: string } | null;
  description?: string | null;
}

interface GitHubDeploymentStatus {
  state: string | null;
  target_url: string | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DeploymentInfo {
  id: number;
  environment: string;
  state: string;
  targetUrl: string | null;
  description: string | null;
  creator: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DeploymentLookupResult {
  deployment: DeploymentInfo | null;
  /** Non-fatal error (e.g. no deployments permission) — surfaced in the UI. */
  error: string | null;
}

async function githubFetch<T>(
  url: string,
  token: string,
): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(
      (data as { message?: string } | null)?.message ??
        `GitHub request failed (${res.status} ${res.statusText})`,
    );
  }
  return data as T;
}

export const getDeploymentStatus = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
  },
  handler: async (ctx: ActionCtx, args): Promise<DeploymentLookupResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("You are not signed in.");
    }
    const connection = await ctx.runQuery(internal.github.connectionForUser, {
      userId,
    });
    if (connection === null) {
      throw new Error("GitHub is not connected.");
    }
    const token = connection.token;
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    try {
      const list = await githubFetch<GitHubDeployment[]>(
        `${repoUrl}/deployments?ref=${encodeURIComponent(
          args.branch,
        )}&per_page=10`,
        token,
      );
      if (!Array.isArray(list) || list.length === 0) {
        return {
          deployment: null,
          error:
            "No deployment for this branch yet. Push a commit — Vercel, Netlify or Actions will register one here.",
        };
      }

      // Newest first — the API returns most-recently-created first.
      const latest = list[0];
      const statuses = await githubFetch<GitHubDeploymentStatus[]>(
        `${repoUrl}/deployments/${latest.id}/statuses?per_page=1`,
        token,
      );
      const status = statuses[0];

      return {
        deployment: {
          id: latest.id,
          environment: latest.environment ?? "production",
          state: status?.state ?? "unknown",
          targetUrl: status?.target_url ?? null,
          description: status?.description ?? latest.description ?? null,
          creator: latest.creator?.login ?? null,
          createdAt: latest.created_at ?? null,
          updatedAt: status?.updated_at ?? status?.created_at ?? latest.updated_at ?? null,
        },
        error: null,
      };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Couldn't read deployment status.";
      // Missing deployments permission or none exist — not fatal.
      return { deployment: null, error: message };
    }
  },
});
