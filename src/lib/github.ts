/** Client-side helpers for the GitHub workspace. */

/** The Convex site origin where the app's HTTP routes (OAuth) live. */
export function convexSiteUrl(): string {
  const api = import.meta.env.VITE_CONVEX_URL as string;
  if (api.includes(".convex.cloud")) {
    return api.replace(".convex.cloud", ".convex.site");
  }
  return new URL(api).origin;
}

export function githubAuthorizeUrl(): string {
  return `${convexSiteUrl()}/api/github/authorize`;
}

export interface Repository {
  fullName: string;
  name: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  updatedAt: string | null;
}

export interface DirEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
}

export interface FileData {
  content: string;
  sha: string;
  size: number;
  truncated: boolean;
}

export function ownerOf(fullName: string): string {
  return fullName.split("/")[0];
}

export function repoNameOf(fullName: string): string {
  return fullName.split("/")[1] ?? fullName;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
