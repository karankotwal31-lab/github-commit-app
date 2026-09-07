import * as vscode from "vscode";

/** Aria backend client. The token is a personal access token created in the
 *  web app (Platform → CLI & API) and stored in the OS keychain via VS Code
 *  SecretStorage. It only ever grants access to YOUR data on YOUR account. */
export class AriaApi {
  constructor(private readonly url: string) {}

  private baseUrl(): string {
    const value = this.url.trim().replace(/\/+$/, "");
    if (!value) {
      throw new Error(
        "Aria backend URL is not configured. Set aria.url in VS Code Settings to the trusted production HTTPS origin.",
      );
    }
    try {
      const parsed = new URL(value);
      const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !local) {
        throw new Error("Aria backend URL must use HTTPS outside local development.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Aria backend URL")) {
        throw error;
      }
      throw new Error("Aria backend URL is invalid. Update aria.url in VS Code Settings.");
    }
    return value;
  }

  async request<T>(token: string, path: string): Promise<T> {
    const baseUrl = this.baseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
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
  const url =
    vscode.workspace.getConfiguration("aria").get<string>("url", "") ?? "";
  return new AriaApi(url.trim().replace(/\/+$/, ""));
}
