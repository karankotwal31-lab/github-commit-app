#!/usr/bin/env bun
/**
 * Aria CLI — a real command-line client for Aria's backend.
 *
 * Authenticates with a personal access token created in the app
 * (Platform → CLI & API). The token only ever grants access to YOUR data on
 * YOUR account — it is not a GitHub token and cannot read anyone else's.
 *
 * Usage:
 *   bun run cli -- login --url https://… --token aria_…
 *   bun run cli -- whoami             who is this token
 *   bun run cli -- repos              list connected repositories
 *   bun run cli -- inbox              latest engineering-inbox findings
 *   bun run cli -- whoami --token aria_…   (or set ARIA_TOKEN)
 *   bun run cli -- whoami --url https://…  (or set ARIA_URL)
 *   bun run cli -- repos --json       machine-readable output
 *
 * The token is read from --token, then ARIA_TOKEN, then ~/.aria/config.json
 * (written by `login --token <paste>`). No token is ever printed back.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".aria");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  url?: string;
  token?: string;
}

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Config;
    }
  } catch {
    // corrupt/missing config — start fresh
  }
  return {};
}

function saveConfig(config: Config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

interface Flags {
  token: string | null;
  url: string;
  json: boolean;
  command: string;
  rest: string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    token: null,
    url: "",
    json: false,
    command: "",
    rest: [],
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--token") flags.token = argv[++i] ?? null;
    else if (arg.startsWith("--token=")) flags.token = arg.slice("--token=".length);
    else if (arg === "--url") flags.url = argv[++i] ?? "";
    else if (arg.startsWith("--url=")) flags.url = arg.slice("--url=".length);
    else if (arg === "--help" || arg === "-h") flags.command = "help";
    else positional.push(arg);
  }
  flags.command = flags.command || positional[0] || "help";
  flags.rest = positional.slice(1);
  return flags;
}

function requireUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) {
    throw new Error(
      "Aria backend URL is not configured. Pass --url https://YOUR_PUBLIC_APP_ORIGIN, set ARIA_URL/ARIA_SITE, or save the URL during login.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Aria backend URL is invalid.");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) {
    throw new Error("Aria backend URL must use HTTPS outside local development.");
  }
  return value;
}

function resolveUrl(flags: Flags, config: Config = loadConfig()): string {
  return requireUrl(
    flags.url || process.env.ARIA_URL || process.env.ARIA_SITE || config.url || "",
  );
}

async function apiCall(
  flags: Flags,
  path: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const config = loadConfig();
  const token = flags.token ?? process.env.ARIA_TOKEN ?? config.token;
  const url = resolveUrl(flags, config);
  if (!token) {
    console.error(
      "No token found. Create one in the app (Platform → CLI & API), then run:\n" +
        "  bun run cli -- login --url https://YOUR_PUBLIC_APP_ORIGIN --token <paste>\n" +
        "or set ARIA_TOKEN.",
    );
    process.exit(2);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${url}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function printJson(body: unknown) {
  console.log(JSON.stringify(body, null, 2));
}

function printTable(rows: Array<Record<string, string>>) {
  if (rows.length === 0) {
    console.log("(empty)");
    return;
  }
  const keys = Object.keys(rows[0]);
  const widths = keys.map((key) =>
    Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length)),
  );
  const line = (row: Record<string, string>) =>
    keys.map((key, i) => String(row[key] ?? "").padEnd(widths[i])).join("  ");
  console.log(line(Object.fromEntries(keys.map((key) => [key, key]))));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

async function cmdLogin(flags: Flags) {
  const config = loadConfig();
  const url = resolveUrl(flags, config);
  if (flags.token) {
    saveConfig({ ...config, token: flags.token, url });
    console.log("Token and Aria URL saved to ~/.aria/config.json");
    return;
  }
  console.log(
    "Aria CLI login\n" +
      "──────────────\n" +
      `1. Open ${url} and sign in.\n` +
      "2. Open Platform → CLI & API → Create token.\n" +
      "3. Copy the token (shown once) and run:\n" +
      `     bun run cli -- login --url ${url} --token <paste>\n` +
      "The token is stored in ~/.aria/config.json and never printed again.",
  );
}

async function cmdWhoami(flags: Flags) {
  const { ok, status, body } = await apiCall(flags, "/api/cli/whoami");
  if (!ok) {
    console.error(`whoami failed (${status}):`, body);
    process.exit(1);
  }
  if (flags.json) return printJson(body);
  const data = body as {
    user: { name: string | null } | null;
    github: { login: string; name: string | null } | null;
  };
  console.log(`Aria user:   ${data.user?.name ?? "(no name)"}`);
  console.log(
    `GitHub:      ${data.github ? `@${data.github.login}${data.github.name ? ` (${data.github.name})` : ""}` : "not connected"}`,
  );
}

async function cmdRepos(flags: Flags) {
  const { ok, status, body } = await apiCall(flags, "/api/cli/repos");
  if (!ok) {
    console.error(`repos failed (${status}):`, body);
    process.exit(1);
  }
  const repos = (body as Array<{ repo: string; private: boolean }>) ?? [];
  if (flags.json) return printJson(body);
  printTable(
    repos.map((r) => ({ repo: r.repo, visibility: r.private ? "private" : "public" })),
  );
  console.log(`\n${repos.length} repository${repos.length === 1 ? "" : "s"}`);
}

async function cmdPrs(flags: Flags) {
  const { ok, status, body } = await apiCall(flags, "/api/cli/prs");
  if (!ok) {
    console.error(`prs failed (${status}):`, body);
    process.exit(1);
  }
  const items = (body as Array<{
    repo: string;
    number: number;
    title: string;
    htmlUrl: string;
    draft: boolean;
    updatedAt: string | null;
  }>) ?? [];
  if (flags.json) return printJson(body);
  if (items.length === 0) {
    console.log("No open pull requests across your connected repos.");
    return;
  }
  printTable(
    items.map((item) => ({
      repo: item.repo,
      pr: `#${item.number}${item.draft ? " (draft)" : ""}`,
      title: item.title.slice(0, 64),
      updated: (item.updatedAt ?? "?").slice(0, 10),
    })),
  );
  console.log(
    `\n${items.length} open PR${items.length === 1 ? "" : "s"} — review at ${resolveUrl(flags)}/dashboard.`,
  );
}

async function cmdInbox(flags: Flags) {
  const { ok, status, body } = await apiCall(flags, "/api/cli/inbox");
  if (!ok) {
    console.error(`inbox failed (${status}):`, body);
    process.exit(1);
  }
  const items = (body as Array<{
    kind: string;
    priority: string;
    repo: string;
    title: string;
    detail: string;
    url: string | null;
    read: boolean;
    createdAt: number;
  }>) ?? [];
  if (flags.json) return printJson(body);
  if (items.length === 0) {
    console.log("Inbox is clear — no open findings.");
    return;
  }
  printTable(
    items.map((item) => ({
      priority: item.priority.toUpperCase(),
      kind: item.kind,
      repo: item.repo,
      title: item.title.slice(0, 72),
    })),
  );
  console.log(
    `\n${items.length} finding${items.length === 1 ? "" : "s"} — see ${resolveUrl(flags)}/dashboard for details.`,
  );
}

async function cmdHelp() {
  console.log(
    "Aria CLI\n" +
      "────────\n" +
      "  login      print setup instructions (or save a token with --token)\n" +
      "  whoami     show the account behind this token\n" +
      "  repos      list connected repositories\n" +
      "  inbox      latest engineering-inbox findings\n" +
      "  prs        open pull requests across your repos\n" +
      "Flags: --token <t> | --url <base> | --json\n" +
      "Env:   ARIA_TOKEN, ARIA_URL (ARIA_SITE is also accepted)\n" +
      "The Aria URL is required; no historical deployment is used as a fallback.",
  );
}

const flags = parseArgs(process.argv.slice(2));
switch (flags.command) {
  case "login":
    await cmdLogin(flags);
    break;
  case "whoami":
    await cmdWhoami(flags);
    break;
  case "repos":
    await cmdRepos(flags);
    break;
  case "inbox":
    await cmdInbox(flags);
    break;
  case "prs":
    await cmdPrs(flags);
    break;
  default:
    await cmdHelp();
}
