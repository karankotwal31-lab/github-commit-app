import * as vscode from "vscode";

/** Aria backend client. The token is a personal access token created in the
 *  web app (Platform → CLI & API) and stored in the OS keychain via VS Code
 *  SecretStorage. It only ever grants access to YOUR data on YOUR account. */
export class AriaApi {
  constructor(private readonly url: string) {}

  async request<T>(token: string, path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${this.url}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Token rejected — sign in again (Aria: Sign in).");
        }
        throw new Error(`Aria backend replied ${res.status}.`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface Whoami {
  user: { name: string | null } | null;
  github: { login: string; name: string | null } | null;
}

export interface InboxItem {
  kind: string;
  priority: string;
  repo: string;
  title: string;
  detail: string;
  url: string | null;
  read: boolean;
  createdAt: number;
}

export async function getStoredToken(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  return (await context.secrets.get("aria.accessToken")) ?? null;
}

export async function storeToken(
  context: vscode.ExtensionContext,
  token: string,
): Promise<void> {
  await context.secrets.store("aria.accessToken", token);
}

export async function clearToken(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.secrets.delete("aria.accessToken");
}

export function apiFromConfig(): AriaApi {
  const url = vscode.workspace
    .getConfiguration("aria")
    .get<string>("url", "https://steady-scorpion-839.convex.site");
  return new AriaApi(url.replace(/\/$/, ""));
}
