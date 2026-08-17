/**
 * Shared domain types for the dashboard's extracted concern hooks.
 * Kept deliberately structural so hooks stay decoupled from the full
 * Repository/FileData types defined in @/lib/github.
 */

/** What the workspace hooks need to know about the selected repo. */
export type RepoRef = {
  fullName: string;
  defaultBranch: string;
} | null;

export type HistoryEntry = {
  sha: string;
  message: string;
  author: string;
  date: string | null;
  htmlUrl: string;
};

export type RevertTarget = {
  sha: string;
  message: string;
};

export type PullRequestEntry = {
  number: number;
  title: string;
  htmlUrl: string;
  author: string;
  createdAt: string | null;
  draft: boolean;
  head: string;
  base: string;
  mergeable: boolean | null;
  mergeableState: string;
};

export type MergeTarget = {
  number: number;
  title: string;
};

export type PullRequestReview = {
  number: number;
  title: string;
};

export type PullRequestFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
};

export type CiChecks = {
  sha: string;
  overall: "none" | "pending" | "failure" | "success";
  checkRuns: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    detailsUrl: string | null;
  }>;
  statusContexts: Array<{
    context: string;
    state: string;
    description: string | null;
    targetUrl: string | null;
  }>;
};

export type IssueEntry = {
  number: number;
  title: string;
  htmlUrl: string;
  author: string;
  createdAt: string | null;
  comments: number;
  body: string | null;
  labels: string[];
};

export type CodeSearchResult = {
  path: string;
  name: string;
  htmlUrl: string;
};
