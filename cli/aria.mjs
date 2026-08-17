#!/usr/bin/env node
/**
 * Aria CLI — the terminal front door to your Aria workspace.
 *
 * A thin, zero-dependency Node.js client for the read-only HTTP endpoints
 * the Aria backend already exposes (`/api/cli/*`). You authenticate with a
 * personal access token created in the app (Platform → CLI & API). The CLI
 * never sees your GitHub OAuth token — the server scopes every response to
 * the user the token belongs to, and revoked tokens are rejected instantly.
 *
 * Usage:
 *   aria login <token>      Save your token (stored in ~/.aria/config.json)
 *   aria whoami             Your Aria identity + connected GitHub account
 *   aria repos              Your connected repositories
 *   aria inbox              Your unified inbox (findings, newest first)
 *   aria prs                Open pull requests across your repos
 *   aria open               Print the web app URL
 *   aria help               Show help
 *
 * Flags:
 *   --json                  Machine-readable output (one JSON document)
 *   --site <url>            Override the Aria backend URL (env: ARIA_SITE)
 *   --token <token>         Token for this call only (env: ARIA_TOKEN)
 *
 * Install:  alias aria="node /path/to/cli/aria.mjs"   (or `npm link` after
 *           `cd cli && npm link` — see cli/README.md)
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const VERSION = "0.1.0";
const DEFAULT_SITE = "https://steady-scorpion-839.convex.site";
const CONFIG_DIR = join(homedir(), ".aria");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Read the CLI config file (missing/corrupt file → empty config). */
export function loadConfig() {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      site: typeof parsed.site === "string" ? parsed.site : DEFAULT_SITE,
      token: typeof parsed.token === "string" ? parsed.token : "",
    };
  } catch {
    return { site: DEFAULT_SITE, token: "" };
  }
}

/** Write the config file with owner-only permissions. */
export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // best effort — some filesystems ignore chmod
  }
}

/** Effective settings for a run: flags/env beat the config file. */
export function resolveSettings(cli) {
  const config = loadConfig();
  const site = (cli.site ?? process.env.ARIA_SITE ?? config.site ?? "")
    .replace(/\/+$/, "");
  const token = cli.token ?? process.env.ARIA_TOKEN ?? config.token ?? "";
  return { site: site || DEFAULT_SITE, token };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** GET one of the Aria CLI endpoints. Throws a readable Error on failure. */
export async function fetchJson(base, path, token) {
  if (!token) {
    throw new Error(
      "No token. Run `aria login <token>` or set ARIA_TOKEN (create a token " +
        "in the app under Platform → CLI & API).",
    );
  }
  const url = `${base}${path}`;
  const res = await fetch(
    new Request(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": `aria-cli/${VERSION}`,
      },
    }),
  );
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && data.error) ||
      `Request failed (${res.status} ${res.statusText})`;
    throw new Error(String(message));
  }
  return data;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

export function formatWhoami(data) {
  const name = data?.user?.name ?? "—";
  const gh = data?.github;
  if (!gh) return `Aria user: ${name}\nGitHub:   not connected`;
  return `Aria user: ${name}\nGitHub:   ${gh.login}${gh.name ? ` (${gh.name})` : ""}`;
}

export function formatRepos(rows) {
  if (!rows || rows.length === 0) return "No connected repositories.";
  return rows
    .map((r) => `${r.repo}${r.private ? "  (private)" : ""}`)
    .join("\n");
}

const KIND_LABEL = {
  dependency: "dependency",
  stale_pr: "stale PR",
  config_change: "config change",
  failing_ci: "failing CI",
  security: "security",
  dependency_upgrade: "upgrade",
  docs: "docs",
  mission: "mission",
};

export function formatInbox(rows) {
  if (!rows || rows.length === 0) return "Inbox is clear — nothing to review.";
  return rows
    .map((f) => {
      const kind = KIND_LABEL[f.kind] ?? f.kind;
      const unread = f.read ? "" : "  [new]";
      const when = new Date(f.createdAt).toISOString().slice(0, 10);
      return `[${f.priority ?? "?"}] ${kind} · ${f.repo} · ${when}${unread}\n    ${f.title}\n    ${f.url ?? ""}`;
    })
    .join("\n");
}

export function formatPrs(rows) {
  if (!rows || rows.length === 0) return "No open pull requests.";
  return rows
    .map((pr) => {
      const draft = pr.draft ? " (draft)" : "";
      return `#${pr.number}${draft} ${pr.title}\n    ${pr.repo} · ${pr.htmlUrl}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const HELP = `Aria CLI v${VERSION} — your GitHub workspace, from the terminal.

Usage: aria <command> [options]

Commands:
  login <token>   Save your personal access token (Platform → CLI & API)
  whoami          Your Aria identity and connected GitHub account
  repos           Your connected repositories
  inbox           Your unified inbox (findings, newest first)
  prs             Open pull requests across your repos
  open            Print the web app URL
  help            Show this help
  --version       Print the version

Options:
  --json          Machine-readable output (single JSON document)
  --site <url>    Aria backend URL (default: ${DEFAULT_SITE}, env: ARIA_SITE)
  --token <tok>   Token for this call only (env: ARIA_TOKEN)

The token is stored in ~/.aria/config.json with owner-only permissions.
Revoke it anytime in the app under Platform → CLI & API.`;

async function promptToken() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const token = await new Promise((resolve) => {
    rl.question("Paste your Aria token: ", resolve);
  });
  rl.close();
  return token.trim();
}

export async function main(argv) {
  const args = argv.slice();
  const json = args.includes("--json");
  const flags = { site: null, token: null };

  // Extract --site/--token values (both `--flag value` and `--flag=value`).
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") continue;
    if (a === "--site" || a === "--token") {
      flags[a.slice(2)] = args[i + 1] ?? "";
      i++;
      continue;
    }
    const eq = a.match(/^--(site|token)=(.*)$/);
    if (eq) {
      flags[eq[1]] = eq[2];
      continue;
    }
    positional.push(a);
  }

  const cmd = positional[0] ?? "help";
  const rest = positional.slice(1);
  const { site, token } = resolveSettings(flags);

  try {
    if (cmd === "login") {
      const value = (rest[0] ?? "").trim() || (await promptToken());
      if (!value) throw new Error("No token provided.");
      saveConfig({ site, token: value });
      process.stdout.write(
        "Saved. Tokens are shown once — if you lose it, revoke and create a new one.\n",
      );
      return 0;
    }

    if (cmd === "open") {
      process.stdout.write(`${site}\n`);
      return 0;
    }

    if (cmd === "help" || cmd === "--help" || cmd === "-h") {
      process.stdout.write(HELP + "\n");
      return 0;
    }

    if (cmd === "--version" || cmd === "-v") {
      process.stdout.write(`aria ${VERSION}\n`);
      return 0;
    }

    if (cmd === "whoami") {
      const data = await fetchJson(site, "/api/cli/whoami", token);
      process.stdout.write(json ? JSON.stringify(data) + "\n" : formatWhoami(data) + "\n");
      return 0;
    }

    if (cmd === "repos") {
      const data = await fetchJson(site, "/api/cli/repos", token);
      process.stdout.write(json ? JSON.stringify(data) + "\n" : formatRepos(data) + "\n");
      return 0;
    }

    if (cmd === "inbox") {
      const data = await fetchJson(site, "/api/cli/inbox", token);
      process.stdout.write(json ? JSON.stringify(data) + "\n" : formatInbox(data) + "\n");
      return 0;
    }

    if (cmd === "prs") {
      const data = await fetchJson(site, "/api/cli/prs", token);
      process.stdout.write(json ? JSON.stringify(data) + "\n" : formatPrs(data) + "\n");
      return 0;
    }

    process.stderr.write(`Unknown command "${cmd}". Run \`aria help\`.\n`);
    return 1;
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

// Run when executed directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
