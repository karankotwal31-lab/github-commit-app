/**
 * Aria API client — talks to the exact same read-only endpoints as the Aria
 * CLI (`/api/cli/*`), authenticated with the same personal access token.
 *
 * Deliberately free of any `vscode` import so this module can be unit-tested
 * with a mocked `fetch` (see api.test.ts).
 */

export const DEFAULT_SITE = "";
const USER_AGENT = "aria-vscode/0.1.0";

export interface WhoamiData {
  user: { name: string | null } | null;
  github: { login: string; name: string | null } | null;
}

export interface RepoRow {
  repo: string;
  private: boolean;
}

export interface FindingRow {
  kind: string;
  priority: string;
  repo: string;
  title: string;
  detail: string;
  url: string | null;
  read: boolean;
  createdAt: number;
}

export interface PrRow {
  repo: string;
  number: number;
  title: string;
  htmlUrl: string;
  draft: boolean;
  updatedAt: string | null;
}

export interface PrFileRow {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  /** Full file text at the base sha (null for added/binary files). */
  oldContent: string | null;
  /** Full file text at the head sha (null for removed/binary files). */
  newContent: string | null;
}

export interface PrDetail {
  repo: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  htmlUrl: string;
  body: string | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  files: PrFileRow[];
}

export class AriaApiError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AriaApiError";
    this.status = status;
  }
}

export class AriaApi {
  readonly site: string;

  constructor(site: string) {
    this.site = site.trim().replace(/\/+$/, "");
  }

  private baseUrl(): string {
    if (!this.site) {
      throw new AriaApiError(
        "Aria backend URL is not configured. Set aria.siteUrl in VS Code Settings to the trusted production HTTPS origin.",
      );
    }
    try {
      const parsed = new URL(this.site);
      const local =
        parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !local) {
        throw new AriaApiError(
          "Aria backend URL must use HTTPS outside local development.",
        );
      }
    } catch (error) {
      if (error instanceof AriaApiError) throw error;
      throw new AriaApiError(
        "Aria backend URL is invalid. Update aria.siteUrl in VS Code Settings.",
      );
    }
    return this.site;
  }

  private async get<T>(path: string, token: string): Promise<T> {
    if (!token) {
      throw new AriaApiError(
        "No token. Run the “Aria: Sign in” command (create a token in the " +
          "web app under Platform → CLI & API).",
      );
    }
    const baseUrl = this.baseUrl();
    const res = await fetch(
      new Request(baseUrl + path, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      }),
    );
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Request failed (${res.status} ${res.statusText})`;
      throw new AriaApiError(message, res.status);
    }
    return data as T;
  }

  whoami(token: string): Promise<WhoamiData> {
    return this.get<WhoamiData>("/api/cli/whoami", token);
  }

  repos(token: string): Promise<RepoRow[]> {
    return this.get<RepoRow[]>("/api/cli/repos", token);
  }

  inbox(token: string): Promise<FindingRow[]> {
    return this.get<FindingRow[]>("/api/cli/inbox", token);
  }

  prs(token: string): Promise<PrRow[]> {
    return this.get<PrRow[]>("/api/cli/prs", token);
  }

  /** One PR, fully loaded with per-file old/new contents for diff review. */
  prDetail(repo: string, number: number, token: string): Promise<PrDetail> {
    const encoded = repo
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return this.get<PrDetail>(`/api/cli/prs/${encoded}/${number}`, token);
  }
}

/** Human label for a finding kind (mirrors the CLI's mapping). */
export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    dependency: "dependency",
    stale_pr: "stale PR",
    config_change: "config change",
    failing_ci: "failing CI",
    security: "security",
    dependency_upgrade: "upgrade",
    docs: "docs",
    mission: "mission",
  };
  return map[kind] ?? kind;
}

/** Compact relative time for a millisecond timestamp (or empty). */
export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
