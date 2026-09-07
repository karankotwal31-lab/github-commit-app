export type PushReviewAction = "approve" | "comment" | "merge";

export interface GithubPullTarget {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export function isPushReviewAction(value: string): value is PushReviewAction {
  return value === "approve" || value === "comment" || value === "merge";
}

/** Accept only canonical HTTPS github.com pull-request URLs for write actions. */
export function parseGithubPullTarget(value: string): GithubPullTarget | null {
  if (!value || value.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url.pathname);
  if (!match) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  try {
    const owner = decodeURIComponent(match[1]);
    const repo = decodeURIComponent(match[2]);
    if (!owner || !repo || owner.includes("/") || repo.includes("/")) return null;
    return { owner, repo, number, url: url.href };
  } catch {
    return null;
  }
}

/** Remove one-shot push action parameters without disturbing other URL state. */
export function scrubPushActionParams(value: string): string {
  const url = new URL(value);
  url.searchParams.delete("ariaAction");
  url.searchParams.delete("ariaUrl");
  return `${url.pathname}${url.search}${url.hash}`;
}
