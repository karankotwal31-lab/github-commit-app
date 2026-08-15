/**
 * Terminal logic for the Engineering dock.
 *
 * Aria runs in the browser without a shell, so the terminal executes a
 * whitelist of git commands against the real in-browser git engine
 * (isomorphic-git + LightningFS). Anything outside the whitelist is reported
 * honestly as unavailable instead of faked. Destructive commands must pass
 * `classifyDanger` before they can run.
 *
 * This module is pure (no fs/network) so it's unit-testable; the component
 * wires the parsed commands to the localGit engine.
 */

export interface ParsedCommand {
  command: string;
  args: string[];
  raw: string;
}

export function parseCommand(line: string): ParsedCommand {
  const raw = line.trim();
  if (!raw) return { command: "", args: [], raw: "" };
  // Split on whitespace but keep double-quoted segments as one arg.
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2]);
  }
  return {
    command: tokens[0]?.toLowerCase() ?? "",
    args: tokens.slice(1),
    raw,
  };
}

/** Whitelisted git commands the terminal can really execute in the browser. */
export const GIT_COMMANDS = [
  "clone",
  "status",
  "log",
  "branch",
  "stage",
  "add",
  "unstage",
  "commit",
  "amend",
  "stash",
  "reset",
  "clear",
  "help",
] as const;

export const COMMAND_HELP: Record<string, string> = {
  clone: "clone [depth] — clone this repo into the browser (default depth 20)",
  status: "status — working tree changes on this device",
  log: "log — recent commits with branch lanes",
  branch: "branch — local branches in the browser clone",
  stage: "stage <path> — stage a file (alias: add)",
  add: "add <path> — stage a file",
  unstage: "unstage <path> — unstage a file",
  commit: 'commit -m "message" — local commit (secret scan enforced)',
  amend: 'amend [-m "message"] — replace the last local commit; folds in staged changes, keeps the message if -m is omitted',
  stash: "stash — save changes; stash list / stash pop [n] / stash drop [n]",
  reset: "reset — wipe the local clone and restore from GitHub (destructive)",
  clear: "clear — clear the terminal output",
  help: "help — list available commands",
};

export const TERMINAL_HEADER = `Aria terminal — in-browser git shell.
Runs real git operations against the local clone (isomorphic-git).
Shell commands (ls, cat, npm, …) are not available in this hosted
environment; they are reported as blocked rather than faked.
Type "help" for commands.`;

/**
 * Classify whether a parsed command is dangerous and needs confirmation
 * before running. Anything matching destructive patterns returns a reason.
 */
export function classifyDanger(cmd: ParsedCommand): {
  dangerous: boolean;
  reason: string | null;
} {
  const tokens = [cmd.command, ...cmd.args].filter(Boolean);
  if (cmd.command === "reset") {
    return {
      dangerous: true,
      reason:
        "reset wipes this device's local clone and re-downloads the branch — local-only commits you haven't pushed will be lost.",
    };
  }
  if (cmd.command === "amend") {
    return {
      dangerous: true,
      reason:
        "amend rewrites the last local commit. If that commit was already pushed, the next push will need force confirmation; un-pushed commits are safe to amend.",
    };
  }
  if (tokens.some((t) => t === "force" || t === "--force" || t === "-f")) {
    return {
      dangerous: true,
      reason: "force operations can rewrite history that others rely on.",
    };
  }
  if (
    tokens.some((t) =>
      ["drop", "delete", "rm", "remove", "--hard", "-D", "-d"].includes(t),
    )
  ) {
    return {
      dangerous: true,
      reason: "this command deletes or discards data that can't be recovered.",
    };
  }
  return { dangerous: false, reason: null };
}

/** Is this a shell command outside the whitelist? (blocked, not faked) */
export function isBlockedShellCommand(cmd: ParsedCommand): boolean {
  if (!cmd.command) return false;
  if ((GIT_COMMANDS as readonly string[]).includes(cmd.command)) return false;
  return true;
}

/** Format an execution result line for the terminal output. */
export function formatLines(lines: string[]): string {
  return lines.map((l) => l.replace(/\s+$/, "")).join("\n");
}
