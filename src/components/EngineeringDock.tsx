import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiffView } from "@/components/workspace-shared";
import { diffLines, parseUnifiedPatch } from "@/lib/diff";
import {
  cloneRepo,
  commitLocal,
  getFs,
  getGraph,
  getStatus,
  localRepoExists,
  promisesOf,
  repoPath,
  resetEngine,
  stageFile,
  stashDrop,
  stashList,
  stashPop,
  stashPush,
  unstageFile,
  type CloneProgress,
  type GitBackend,
  type StashEntry,
} from "@/lib/localGit";
import { errorMessage } from "@/lib/github";
import { secretRisk } from "@/lib/secrets";
import {
  classifyDanger,
  COMMAND_HELP,
  formatLines,
  isBlockedShellCommand,
  parseCommand,
  TERMINAL_HEADER,
  type ParsedCommand,
} from "@/lib/terminal";
import { analyzeImpact, type ImpactAnalysis } from "@/lib/impact";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Copy,
  FlaskConical,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  Loader2,
  RefreshCw,
  ScanSearch,
  Send,
  Sparkles,
  Tag,
  TerminalSquare,
  Trash2,
  XCircle,
} from "lucide-react";

type DockTab =
  | "terminal"
  | "tests"
  | "history"
  | "impact"
  | "ci"
  | "git"
  | "pr";

const TABS: Array<[DockTab, string, typeof TerminalSquare]> = [
  ["terminal", "Terminal", TerminalSquare],
  ["tests", "Test lab", FlaskConical],
  ["history", "Time machine", History],
  ["impact", "Impact", ScanSearch],
  ["ci", "CI", Activity],
  ["git", "Git ops", GitBranch],
  ["pr", "Pull requests", GitPullRequest],
];

interface DockProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  owner: string;
  repo: string;
  branch: string;
  connection: { login: string | null; name: string | null };
  openPath: string;
  onRefresh: () => void;
}

function asUploadId(value: string): Id<"blobUploads"> {
  return value as Id<"blobUploads">;
}

export function EngineeringDock({
  open,
  onOpenChange,
  owner,
  repo,
  branch,
  connection,
  openPath,
  onRefresh,
}: DockProps) {
  const [tab, setTab] = useState<DockTab>("terminal");
  useEffect(() => {
    if (open) setTab("terminal");
  }, [open]);

  const listBranches = useAction(api.githubActions.listBranches);
  const getCommitDetails = useAction(api.githubActions.getCommitDetails);
  const getTree = useAction(api.githubActions.getTree);
  const getBlob = useAction(api.githubActions.getBlob);
  const getBlobs = useAction(api.githubActions.getBlobs);
  const commitChanges = useAction(api.githubActions.commitChanges);
  const pushCommits = useAction(api.githubActions.pushCommits);
  const beginBlobUpload = useMutation(api.github.beginBlobUpload);
  const uploadBlobChunk = useMutation(api.github.uploadBlobChunk);

  const backend: GitBackend = useMemo(
    () => ({
      listBranches: (a) => listBranches(a),
      getCommitDetails: (a) => getCommitDetails(a),
      getTree: (a) => getTree(a),
      getBlob: (a) => getBlob(a),
      getBlobs: (a) => getBlobs(a),
      commitChanges: (a) =>
        commitChanges({
          ...a,
          files: a.files.map((f) => ({
            ...f,
            uploadId: f.uploadId ? asUploadId(f.uploadId) : undefined,
          })),
        }),
      pushCommits: (a) =>
        pushCommits({
          ...a,
          commit: {
            ...a.commit,
            files: a.commit.files.map((f) => ({
              ...f,
              uploadId: f.uploadId ? asUploadId(f.uploadId) : undefined,
            })),
          },
        }),
      beginBlobUpload: (a) => beginBlobUpload(a),
      uploadBlobChunk: async (a) => {
        await uploadBlobChunk({ ...a, uploadId: asUploadId(a.uploadId) });
      },
    }),
    [
      listBranches,
      getCommitDetails,
      getTree,
      getBlob,
      getBlobs,
      commitChanges,
      pushCommits,
      beginBlobUpload,
      uploadBlobChunk,
    ],
  );

  const author = useMemo(
    () => ({
      name: connection.name ?? connection.login ?? "Aria",
      email: connection.login
        ? `${connection.login}@users.noreply.github.com`
        : "aria@users.noreply.github.com",
      date: null as string | null,
    }),
    [connection],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TerminalSquare className="size-4 text-neutral-600" />
            Engineering command center
            <span className="rounded border border-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
              {owner}/{repo} · {branch}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1 border-b border-neutral-100 pb-2">
          {TABS.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === key
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-500 hover:bg-neutral-100",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto pt-3">
          {tab === "terminal" && (
            <TerminalPanel
              owner={owner}
              repo={repo}
              branch={branch}
              backend={backend}
              author={author}
            />
          )}
          {tab === "tests" && (
            <TestLabPanel
              owner={owner}
              repo={repo}
              branch={branch}
              onOpenCi={() => setTab("ci")}
            />
          )}
          {tab === "history" && (
            <TimeMachinePanel
              owner={owner}
              repo={repo}
              branch={branch}
              defaultPath={openPath}
            />
          )}
          {tab === "impact" && (
            <ImpactPanel
              owner={owner}
              repo={repo}
              branch={branch}
              defaultPath={openPath}
            />
          )}
          {tab === "ci" && (
            <CiPanel owner={owner} repo={repo} branch={branch} />
          )}
          {tab === "git" && (
            <GitOpsPanel
              owner={owner}
              repo={repo}
              branch={branch}
              onRefresh={onRefresh}
            />
          )}
          {tab === "pr" && (
            <PrPanel owner={owner} repo={repo} onRefresh={onRefresh} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Terminal — real git commands against the in-browser engine
// ---------------------------------------------------------------------------

function TerminalPanel({
  owner,
  repo,
  branch,
  backend,
  author,
}: {
  owner: string;
  repo: string;
  branch: string;
  backend: GitBackend;
  author: { name: string; email: string; date: string | null };
}) {
  const [lines, setLines] = useState<string[]>([TERMINAL_HEADER]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(
    null,
  );
  const [pending, setPending] = useState<ParsedCommand | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const push = useCallback((text: string) => {
    setLines((prev) => [...prev, text]);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const runCommand = useCallback(
    async (cmd: ParsedCommand, confirmed = false) => {
      if (cmd.command === "clear") {
        setLines([TERMINAL_HEADER]);
        return;
      }
      if (cmd.command === "help") {
        push(
          formatLines(
            Object.values(COMMAND_HELP).map((h) => `  ${h}`),
          ),
        );
        return;
      }
      if (isBlockedShellCommand(cmd)) {
        push(
          `error: “${cmd.command}” is not available here — Aria runs in the browser without a shell.\n  Git commands (status, log, stage, commit, stash, clone, …) run for real against the in-browser git engine. Type “help” to see them.`,
        );
        return;
      }
      const danger = classifyDanger(cmd);
      if (danger.dangerous && !confirmed) {
        setPending(cmd);
        push(
          `warning: this command is dangerous — ${danger.reason}\n  Type “y” to confirm, or anything else to cancel.`,
        );
        return;
      }

      const exists = await localRepoExists(owner, repo);
      try {
        switch (cmd.command) {
          case "clone": {
            if (exists) {
              push("Already cloned into this device — run “status” to see it.");
              return;
            }
            setCloning(true);
            const depth = Number(cmd.args[0] ?? "20");
            const result = await cloneRepo(backend, {
              owner,
              repo,
              branch,
              depth: Number.isFinite(depth) && depth > 0 ? depth : 20,
              author,
              onProgress: setCloneProgress,
            });
            push(
              `Cloned ${owner}/${repo} — ${result.commits} commits, ${result.files} files (${(result.durationMs / 1000).toFixed(1)}s).`,
            );
            break;
          }
          case "status": {
            if (!exists) {
              push("No local clone — run “clone” first.");
              return;
            }
            const rows = await getStatus(owner, repo);
            if (rows.length === 0) {
              push("Working tree clean.");
              return;
            }
            push(
              formatLines(
                rows.map(
                  (r) =>
                    `  ${r.label.padEnd(9)} ${r.staged ? "[staged] " : ""}${r.path}`,
                ),
              ),
            );
            break;
          }
          case "log": {
            if (!exists) {
              push("No local clone — run “clone” first.");
              return;
            }
            const graph = await getGraph(owner, repo).catch(() => null);
            if (!graph || graph.commits.length === 0) {
              push("No commits in the local clone.");
              return;
            }
            const heads = new Set(graph.branches.map((b) => b.oid));
            push(
              formatLines(
                graph.commits.slice(0, 40).map((c) => {
                  const marker = heads.has(c.oid)
                    ? graph.branches
                        .filter((b) => b.oid === c.oid)
                        .map((b) => `(${b.name})`)
                        .join(" ")
                    : "";
                  return `  ${c.oid.slice(0, 7)} ${marker} ${c.message
                    .split("\n")[0]
                    .slice(0, 60)} — ${c.author}, ${new Date(
                    c.date,
                  ).toLocaleDateString()}`;
                }),
              ),
            );
            break;
          }
          case "branch": {
            if (!exists) {
              push("No local clone — run “clone” first.");
              return;
            }
            const graph = await getGraph(owner, repo).catch(() => null);
            if (!graph) {
              push("Couldn't read local branches.");
              return;
            }
            push(
              formatLines(
                graph.branches.map((b) => `  ${b.name} (${b.oid.slice(0, 7)})`),
              ),
            );
            break;
          }
          case "stage":
          case "add": {
            if (!exists) {
              push("No local clone — run “clone” first.");
              return;
            }
            const path = cmd.args[0];
            if (!path) {
              push("usage: stage <path>");
              return;
            }
            await stageFile(owner, repo, path);
            push(`Staged ${path}`);
            break;
          }
          case "unstage": {
            if (!exists) {
              push("No local clone — run “clone” first.");
              return;
            }
            const path = cmd.args[0];
            if (!path) {
              push("usage: unstage <path>");
              return;
            }
            await unstageFile(owner, repo, path);
            push(`Unstaged ${path}`);
            break;
          }
          case "commit": {
            if (!exists) {
              push("No local clone — run “clone” first.");
              return;
            }
            const mIdx = cmd.args.indexOf("-m");
            const message = mIdx !== -1 ? cmd.args[mIdx + 1] : undefined;
            if (!message) {
              push('usage: commit -m "message"');
              return;
            }
            try {
              const result = await commitLocal({
                owner,
                repo,
                message,
                author,
              });
              push(`Committed ${result.oid.slice(0, 7)} — ${message}`);
              break;
            } catch (e) {
              push(`error: ${errorMessage(e)}`);
              return;
            }
          }
          case "stash": {
            if (!exists) {
              push("No local clone — run “clone” first.");
              return;
            }
            const sub = cmd.args[0];
            if (!sub || sub === "save") {
              await stashPush(owner, repo, cmd.args.slice(1).join(" ") || "WIP");
              push("Stashed changes.");
              return;
            }
            if (sub === "list") {
              const stashes: StashEntry[] = await stashList(owner, repo);
              if (stashes.length === 0) {
                push("No stashes.");
                return;
              }
              push(
                formatLines(
                  stashes.map((s) => `  stash@{${s.index}} ${s.label}`),
                ),
              );
              return;
            }
            if (sub === "pop") {
              await stashPop(owner, repo, Number(cmd.args[1] ?? 0));
              push("Stash applied.");
              return;
            }
            if (sub === "drop") {
              await stashDrop(owner, repo, Number(cmd.args[1] ?? 0));
              push("Stash dropped.");
              return;
            }
            push("usage: stash | stash list | stash pop [n] | stash drop [n]");
            return;
          }
          case "reset": {
            await resetEngine();
            push(
              "Local clone wiped. Run “clone” to restore the branch from GitHub.",
            );
            return;
          }
          default:
            push(`unknown command: ${cmd.command} — type “help”`);
        }
      } catch (e) {
        push(`error: ${errorMessage(e)}`);
      } finally {
        setBusy(false);
        setCloning(false);
        setCloneProgress(null);
      }
    },
    [owner, repo, branch, backend, author, push],
  );

  const submit = async () => {
    const raw = input;
    setInput("");
    if (!raw.trim()) return;
    const cmd = parseCommand(raw);
    push(`$ ${raw}${pending ? " (confirmed)" : ""}`);
    if (pending) {
      // A dangerous command is waiting for y/n.
      const was = pending;
      setPending(null);
      if (raw.trim().toLowerCase() === "y") {
        await runCommand(was, true);
      } else {
        push("Cancelled.");
      }
      return;
    }
    historyRef.current = [...historyRef.current.slice(-49), raw];
    historyIndexRef.current = -1;
    setBusy(true);
    await runCommand(cmd);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = historyRef.current;
      if (h.length === 0) return;
      historyIndexRef.current =
        historyIndexRef.current < 0
          ? h.length - 1
          : Math.max(0, historyIndexRef.current - 1);
      setInput(h[historyIndexRef.current]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = historyRef.current;
      if (historyIndexRef.current < 0) return;
      historyIndexRef.current += 1;
      setInput(
        historyIndexRef.current >= h.length
          ? ((historyIndexRef.current = -1), "")
          : h[historyIndexRef.current],
      );
    }
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-950 font-mono text-[12px] leading-5 text-neutral-200">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5 text-[10px] text-neutral-500">
        <span className="size-2 rounded-full bg-emerald-400" />
        aria-terminal · {owner}/{repo}@{branch}
        <span className="ml-auto">{busy ? "running…" : "ready"}</span>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-3 py-2"
      >
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              l.startsWith("error")
                ? "text-red-400"
                : l.startsWith("warning")
                  ? "text-amber-300"
                  : "text-neutral-300",
            )}
          >
            {l}
          </div>
        ))}
        {cloning && cloneProgress && (
          <div className="text-neutral-400">
            {cloneProgress.phase === "history" && "Fetching commit history…"}
            {cloneProgress.phase === "commits" &&
              `Writing ${cloneProgress.total} commits…`}
            {cloneProgress.phase === "trees" && "Writing trees…"}
            {cloneProgress.phase === "files" &&
              `Downloading ${cloneProgress.total} files…`}
            {cloneProgress.phase === "checkout" && "Checking out…"}
            {" ("}
            {cloneProgress.done}/{cloneProgress.total}
            {")"}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2">
        <span className="text-emerald-400">{pending ? "?" : "$"}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={false}
          spellCheck={false}
          disabled={busy}
          placeholder={
            pending
              ? 'Type "y" to confirm the dangerous command, anything else to cancel'
              : "type a git command (help)"
          }
          className="min-w-0 flex-1 bg-transparent text-neutral-200 outline-none placeholder:text-neutral-600 disabled:opacity-50"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test lab — real checks that can run in the browser; honest about the rest
// ---------------------------------------------------------------------------

interface TestResult {
  id: string;
  name: string;
  command: string;
  status: "pass" | "fail" | "warn" | "skipped";
  durationMs: number;
  detail: string[];
}

function TestLabPanel({
  owner,
  repo,
  branch,
  onOpenCi,
}: {
  owner: string;
  repo: string;
  branch: string;
  onOpenCi: () => void;
}) {
  const getBranchChecks = useAction(api.githubActions.getBranchChecks);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResults(null);
    const out: TestResult[] = [];

    // 1. Local git state.
    const t1 = Date.now();
    try {
      const exists = await localRepoExists(owner, repo);
      if (!exists) {
        out.push({
          id: "local",
          name: "Local git state",
          command: "git status (in-browser)",
          status: "skipped",
          durationMs: Date.now() - t1,
          detail: ["No local clone — open the Terminal tab and run “clone”."],
        });
      } else {
        const rows = await getStatus(owner, repo);
        out.push({
          id: "local",
          name: "Local git state",
          command: "git status (in-browser)",
          status: rows.length === 0 ? "pass" : "warn",
          durationMs: Date.now() - t1,
          detail:
            rows.length === 0
              ? ["Working tree clean."]
              : [
                  `${rows.length} change${rows.length === 1 ? "" : "s"} (${rows
                    .filter((r) => r.staged).length} staged).`,
                  ...rows.slice(0, 10).map((r) => `  ${r.label} ${r.path}`),
                ],
        });
      }
    } catch (e) {
      out.push({
        id: "local",
        name: "Local git state",
        command: "git status (in-browser)",
        status: "fail",
        durationMs: Date.now() - t1,
        detail: [errorMessage(e)],
      });
    }

    // 2. Secret scan over the working tree.
    const t2 = Date.now();
    try {
      const pfs = promisesOf(await getFs());
      const dir = repoPath(owner, repo);
      const rows = await getStatus(owner, repo).catch(
        () => [] as Awaited<ReturnType<typeof getStatus>>,
      );
      const flagged: string[] = [];
      for (const row of rows.slice(0, 50)) {
        if (row.label === "deleted") continue;
        try {
          const content = await pfs.readFile(`${dir}/${row.path}`, "utf8");
          const risk = secretRisk(row.path, String(content));
          if (risk.risky) flagged.push(`${row.path} (${risk.reasons[0]})`);
        } catch {
          // Unreadable (binary etc.) — skip.
        }
      }
      out.push({
        id: "secrets",
        name: "Secret scan",
        command: "secret scan (in-browser)",
        status: flagged.length === 0 ? "pass" : "fail",
        durationMs: Date.now() - t2,
        detail:
          flagged.length === 0
            ? ["No secret-like files or content found in the working tree."]
            : [
                "Secret-like content detected — Aria blocks committing these:",
                ...flagged.slice(0, 20),
              ],
      });
    } catch (e) {
      out.push({
        id: "secrets",
        name: "Secret scan",
        command: "secret scan (in-browser)",
        status: "skipped",
        durationMs: Date.now() - t2,
        detail: [errorMessage(e)],
      });
    }

    // 3. CI checks on the branch (real GitHub data).
    const t3 = Date.now();
    try {
      const checks = await getBranchChecks({ owner, repo, branch });
      const failed = checks.checkRuns.filter((c) =>
        ["failure", "timed_out", "cancelled", "action_required"].includes(
          c.conclusion ?? "",
        ),
      );
      out.push({
        id: "ci",
        name: "CI on branch",
        command: "GitHub checks",
        status:
          checks.overall === "success"
            ? "pass"
            : checks.overall === "failure"
              ? "fail"
              : checks.overall === "pending"
                ? "warn"
                : "skipped",
        durationMs: Date.now() - t3,
        detail:
          checks.checkRuns.length === 0
            ? ["No checks configured on this branch (or none ran yet)."]
            : [
                `${checks.overall.toUpperCase()} — ${checks.checkRuns.length} check run${checks.checkRuns.length === 1 ? "" : "s"}`,
                ...checks.checkRuns.slice(0, 20).map((c) => {
                  const s =
                    c.conclusion === "success"
                      ? "pass"
                      : c.conclusion && failed.some((f) => f.name === c.name)
                        ? "fail"
                        : c.status;
                  return `  [${s}] ${c.name}`;
                }),
              ],
      });
    } catch (e) {
      out.push({
        id: "ci",
        name: "CI on branch",
        command: "GitHub checks",
        status: "skipped",
        durationMs: Date.now() - t3,
        detail: [errorMessage(e)],
      });
    }

    out.sort((a, b) => a.id.localeCompare(b.id));
    setResults(out);
    setRunning(false);
  }, [owner, repo, branch, getBranchChecks]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
        Aria can't run <span className="font-mono">tsc</span>,{" "}
        <span className="font-mono">bun test</span>, or{" "}
        <span className="font-mono">vite build</span> here — this hosted
        environment has no shell, so results would be faked. Instead, this lab
        runs the checks that are <span className="font-medium">real</span>{" "}
        right now: in-browser git state, the secret scan, and GitHub CI. Push
        your branch and watch CI here.
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={() => void run()} disabled={running}>
          {running ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <FlaskConical className="mr-1.5 size-3.5" />
          )}
          Run checks
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={onOpenCi}
        >
          <Activity className="mr-1 size-3.5" />
          Open CI center
        </Button>
      </div>

      {results === null && !running && (
        <p className="py-6 text-center text-xs text-neutral-400">
          Run the lab to see results — each check shows the command, result,
          duration, and logs.
        </p>
      )}

      {running && results === null && (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-neutral-400">
          <Loader2 className="size-4 animate-spin" />
          Running checks…
        </div>
      )}

      {results && (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={r.id} className="rounded-lg border border-neutral-200">
              <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
                {r.status === "pass" ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : r.status === "fail" ? (
                  <XCircle className="size-4 text-red-600" />
                ) : r.status === "warn" ? (
                  <AlertTriangle className="size-4 text-amber-600" />
                ) : (
                  <GitBranch className="size-4 text-neutral-400" />
                )}
                <p className="text-sm font-medium text-neutral-800">{r.name}</p>
                <span
                  className={cn(
                    "ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    r.status === "pass" && "bg-emerald-50 text-emerald-700",
                    r.status === "fail" && "bg-red-50 text-red-600",
                    r.status === "warn" && "bg-amber-50 text-amber-700",
                    r.status === "skipped" && "bg-neutral-100 text-neutral-500",
                  )}
                >
                  {r.status}
                </span>
                <span className="font-mono text-[10px] text-neutral-400">
                  {(r.durationMs / 1000).toFixed(2)}s
                </span>
              </div>
              <div className="px-3 py-2">
                <p className="font-mono text-[10px] text-neutral-400">
                  {r.command}
                </p>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-5 text-neutral-700">
                  {r.detail.join("\n")}
                </pre>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time machine — per-file history with diffs and PR association
// ---------------------------------------------------------------------------

function TimeMachinePanel({
  owner,
  repo,
  branch,
  defaultPath,
}: {
  owner: string;
  repo: string;
  branch: string;
  defaultPath: string;
}) {
  const getFileHistory = useAction(api.engineering.getFileHistory);
  const getFile = useAction(api.githubActions.getFile);
  const [path, setPath] = useState(defaultPath || "");
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof getFileHistory>>["commits"] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<
    Array<{ path: string; oldText: string; newText: string; binary: boolean }> | null
  >(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setDiff(null);
    try {
      const res = await getFileHistory({
        owner,
        repo,
        path: path.trim(),
        branch,
      });
      setHistory(res.commits);
      if (res.commits.length > 0) {
        setSelected(res.commits[0].sha);
        const next = res.commits[1]?.sha ?? null;
        setDiffLoading(true);
        try {
          const [current, previous] = await Promise.all([
            getFile({ owner, repo, path: path.trim(), branch: res.commits[0].sha }),
            next
              ? getFile({ owner, repo, path: path.trim(), branch: next })
              : Promise.resolve(null),
          ]);
          setDiff([
            {
              path: path.trim(),
              oldText: previous?.content ?? "",
              newText: current.content,
              binary: false,
            },
          ]);
        } finally {
          setDiffLoading(false);
        }
      }
    } catch (e) {
      setError(errorMessage(e));
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, branch, path, getFileHistory, getFile]);

  const select = useCallback(
    async (sha: string) => {
      setSelected(sha);
      setDiffLoading(true);
      setDiff(null);
      try {
        const idx = (history ?? []).findIndex((c) => c.sha === sha);
        const previous = idx > 0 ? history?.[idx - 1]?.sha ?? null : null;
        const [current, prev] = await Promise.all([
          getFile({ owner, repo, path: path.trim(), branch: sha }),
          previous
            ? getFile({ owner, repo, path: path.trim(), branch: previous })
            : Promise.resolve(null),
        ]);
        setDiff([
          {
            path: path.trim(),
            oldText: prev?.content ?? "",
            newText: current.content,
            binary: false,
          },
        ]);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setDiffLoading(false);
      }
    },
    [owner, repo, path, history, getFile],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
        Navigate every version of one file on this branch. Each entry shows
        the commit, author, date, and the PR that introduced it (when GitHub
        can associate one). Click a commit to diff it against the version
        before it.
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load();
          }}
          placeholder="Path to a file, e.g. src/lib/utils.ts"
          spellCheck={false}
          className="h-9 flex-1 font-mono text-xs"
        />
        <Button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <History className="mr-1.5 size-3.5" />
          )}
          Load history
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {history && history.length === 0 && (
        <p className="py-6 text-center text-xs text-neutral-400">
          No commits touched this path on {branch}.
        </p>
      )}

      {history && history.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ul className="max-h-[28rem] divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200">
            {history.map((c) => (
              <li key={c.sha}>
                <button
                  type="button"
                  onClick={() => void select(c.sha)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left",
                    selected === c.sha ? "bg-neutral-50" : "hover:bg-neutral-50/60",
                  )}
                >
                  <GitCommitHorizontal
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      selected === c.sha
                        ? "text-neutral-700"
                        : "text-neutral-300",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-neutral-800">
                      {c.message.split("\n")[0]}
                    </p>
                    <p className="mt-0.5 text-[10px] text-neutral-400">
                      {c.author} ·{" "}
                      {c.date ? new Date(c.date).toLocaleString() : ""}
                    </p>
                    {c.pr && (
                      <p className="mt-1 inline-block rounded border border-neutral-200 px-1 py-0.5 text-[9px] text-neutral-500">
                        PR #{c.pr.number} — {c.pr.title.slice(0, 48)}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-neutral-300">
                    {c.sha.slice(0, 7)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="max-h-[28rem] overflow-auto rounded-lg border border-neutral-200">
            {diffLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-neutral-400">
                <Loader2 className="size-3.5 animate-spin" />
                Loading versions…
              </div>
            ) : diff ? (
              diff.map((f) => (
                <div key={f.path}>
                  <p className="border-b border-neutral-100 px-3 py-1.5 font-mono text-[11px] text-neutral-600">
                    {f.path}
                  </p>
                  <DiffView lines={diffLines(f.oldText, f.newText)} />
                </div>
              ))
            ) : (
              <p className="py-10 text-center text-xs text-neutral-400">
                Select a commit to see the diff.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impact analysis
// ---------------------------------------------------------------------------

function ImpactPanel({
  owner,
  repo,
  branch,
  defaultPath,
}: {
  owner: string;
  repo: string;
  branch: string;
  defaultPath: string;
}) {
  const listTreeFiles = useAction(api.githubActions.listTreeFiles);
  const [path, setPath] = useState(defaultPath || "");
  const [analysis, setAnalysis] = useState<ImpactAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const files = await listTreeFiles({ owner, repo, branch });
      const allFiles = files.map((f) => f.path);

      // Bounded dependent scan from the local clone's working tree.
      const fileContents: Record<string, string> = {};
      let scanned = 0;
      try {
        if (await localRepoExists(owner, repo)) {
          const pfs = promisesOf(await getFs());
          const dir = repoPath(owner, repo);
          const walk = async (rel: string) => {
            if (scanned >= 400) return;
            const names = (
              await pfs.readdir(`${dir}${rel ? `/${rel}` : ""}`)
            ).filter((n) => n !== ".git" && n !== "node_modules");
            for (const name of names) {
              if (scanned >= 400) return;
              const full = rel ? `${rel}/${name}` : name;
              const st = await pfs.stat(`${dir}/${full}`).catch(() => null);
              if (!st) continue;
              if (st.isDirectory()) {
                await walk(full);
                continue;
              }
              if (!/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(full)) continue;
              if (allFiles.includes(full)) {
                try {
                  const buf = await pfs.readFile(`${dir}/${full}`);
                  const text = String(buf);
                  if (text.length <= 200_000) {
                    fileContents[full] = text;
                    scanned++;
                  }
                } catch {
                  // skip unreadable files
                }
              }
            }
          };
          await walk("");
        }
      } catch {
        // Local scan is best-effort — the analysis still runs with what we have.
      }

      const result = analyzeImpact({
        targetPath: path.trim(),
        allFiles,
        fileContents,
      });
      setAnalysis(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [owner, repo, branch, path, listTreeFiles]);

  const riskCls: Record<string, string> = {
    CRITICAL: "bg-red-50 text-red-700 border-red-200",
    HIGH: "bg-orange-50 text-orange-700 border-orange-200",
    MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
    LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
        Static impact analysis: what this file imports, and which files in the
        repo import it. Dependents are found from the local clone's working
        tree (bounded scan); infrastructure paths and import counts drive the
        risk. It can't see runtime callers, API consumers, or database
        dependencies — treat the risk as a lower bound, not a guarantee.
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder="Path to analyze, e.g. src/components/Button.tsx"
          spellCheck={false}
          className="h-9 flex-1 font-mono text-xs"
        />
        <Button type="button" onClick={() => void run()} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <ScanSearch className="mr-1.5 size-3.5" />
          )}
          Analyze
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {analysis && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-semibold",
                riskCls[analysis.risk],
              )}
            >
              {analysis.risk} risk
            </span>
            <span className="text-xs text-neutral-600">
              {analysis.riskReason}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                Imports ({analysis.imports.length})
              </p>
              <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                {analysis.imports.map((i) => (
                  <li key={i} className="truncate font-mono text-[11px] text-neutral-700">
                    {i}
                  </li>
                ))}
                {analysis.imports.length === 0 && (
                  <li className="text-[11px] text-neutral-400">
                    No internal imports (or none resolvable).
                  </li>
                )}
              </ul>
              {analysis.unresolvedImports.length > 0 && (
                <p className="mt-2 text-[10px] text-neutral-400">
                  External: {analysis.unresolvedImports.slice(0, 6).join(", ")}
                  {analysis.unresolvedImports.length > 6 ? "…" : ""}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                Dependents ({analysis.dependents.length})
              </p>
              <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                {analysis.dependents.slice(0, 60).map((d) => (
                  <li
                    key={d}
                    className={cn(
                      "truncate font-mono text-[11px]",
                      analysis.testDependents.includes(d)
                        ? "text-amber-700"
                        : "text-neutral-700",
                    )}
                  >
                    {d}
                    {analysis.testDependents.includes(d) ? " (test)" : ""}
                  </li>
                ))}
                {analysis.dependents.length === 0 && (
                  <li className="text-[11px] text-neutral-400">
                    Nothing in the scanned working tree imports this file.
                  </li>
                )}
              </ul>
            </div>

            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                Evidence
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {analysis.evidence.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] leading-4 text-neutral-600"
                  >
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-neutral-300" />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CI center + failure investigation
// ---------------------------------------------------------------------------

function CiPanel({
  owner,
  repo,
  branch,
}: {
  owner: string;
  repo: string;
  branch: string;
}) {
  const getBranchChecks = useAction(api.githubActions.getBranchChecks);
  const getFailedCheckDetails = useAction(api.engineering.getFailedCheckDetails);
  const getCommitHistory = useAction(api.githubActions.getCommitHistory);
  const investigate = useAction(api.engineering.aiInvestigateCiFailure);
  const [checks, setChecks] = useState<Awaited<
    ReturnType<typeof getBranchChecks>
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [investigating, setInvestigating] = useState<string | null>(null);
  const [finding, setFinding] = useState<{
    check: string;
    summary: string;
    probableCause: string;
    affectedFiles: string[];
    proposedFix: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChecks(await getBranchChecks({ owner, repo, branch }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [owner, repo, branch, getBranchChecks]);

  useEffect(() => {
    if (owner && repo && branch) void load();
  }, [owner, repo, branch, load]);

  const statusMeta = (
    conclusion: string | null,
    status: string,
  ): { label: string; cls: string; failed: boolean } => {
    if (conclusion === "success") {
      return {
        label: "PASS",
        cls: "bg-emerald-50 text-emerald-700",
        failed: false,
      };
    }
    if (
      conclusion === "failure" ||
      conclusion === "timed_out" ||
      conclusion === "action_required"
    ) {
      return { label: "FAILED", cls: "bg-red-50 text-red-600", failed: true };
    }
    if (
      conclusion === "cancelled" ||
      conclusion === "skipped" ||
      conclusion === "neutral"
    ) {
      return {
        label: "CANCELLED",
        cls: "bg-neutral-100 text-neutral-500",
        failed: false,
      };
    }
    if (status === "in_progress" || status === "queued") {
      return { label: "RUNNING", cls: "bg-amber-50 text-amber-700", failed: false };
    }
    return { label: "UNKNOWN", cls: "bg-neutral-100 text-neutral-500", failed: false };
  };

  const investigateFailure = async (name: string) => {
    setInvestigating(name);
    setFinding(null);
    try {
      const [details, commits] = await Promise.all([
        getFailedCheckDetails({ owner, repo, branch }),
        getCommitHistory({ owner, repo, branch, perPage: 10 }),
      ]);
      const failed =
        details.failed.find((f) => f.name === name) ?? details.failed[0];
      if (!failed) {
        setFinding({
          check: name,
          summary:
            "No failure evidence found — the check may have passed on a newer commit.",
          probableCause: "",
          affectedFiles: [],
          proposedFix: "",
        });
        return;
      }
      const res = await investigate({
        owner,
        repo,
        branch,
        checkName: failed.name,
        failedSteps: failed.failedSteps,
        outputText: failed.outputText,
        annotations: failed.annotations,
        recentCommits: commits.map((c) => c.message.split("\n")[0]).slice(0, 8),
      });
      setFinding({
        check: failed.name,
        summary: res.summary,
        probableCause: res.probableCause,
        affectedFiles: res.affectedFiles,
        proposedFix: res.proposedFix,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setInvestigating(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
        Live GitHub checks on the branch tip: workflows, jobs, and legacy
        status contexts with PASS / FAILED / RUNNING / CANCELLED / UNKNOWN
        states. On a failed check, “Investigate” pulls the real failure
        evidence (failed step, output, annotations) and Aria explains the
        probable cause — grounded in that evidence only. Aria never applies
        the fix; you decide.
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
        {checks && (
          <span className="font-mono text-[10px] text-neutral-400">
            {checks.sha.slice(0, 7)} · overall {checks.overall.toUpperCase()}
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {!checks && loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
          <Loader2 className="size-4 animate-spin" />
          Loading checks…
        </div>
      )}

      {checks && checks.checkRuns.length === 0 && (
        <p className="py-6 text-center text-xs text-neutral-400">
          No check runs on this branch yet — push a commit and GitHub Actions
          results will appear here.
        </p>
      )}

      {checks &&
        checks.checkRuns.map((c) => {
          const meta = statusMeta(c.conclusion, c.status);
          return (
            <div key={c.name} className="rounded-lg border border-neutral-200">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    meta.cls,
                  )}
                >
                  {meta.label}
                </span>
                <p className="text-sm font-medium text-neutral-800">{c.name}</p>
                {c.detailsUrl && (
                  <a
                    href={c.detailsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-neutral-400 hover:text-neutral-900"
                  >
                    view on GitHub ↗
                  </a>
                )}
                <span className="ml-auto text-[10px] text-neutral-400">
                  {c.status}
                </span>
                {meta.failed && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => void investigateFailure(c.name)}
                    disabled={investigating !== null}
                  >
                    {investigating === c.name ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Bug className="size-3" />
                    )}
                    Investigate
                  </Button>
                )}
              </div>
            </div>
          );
        })}

      {finding && (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-800">
            <Sparkles className="size-3.5 text-neutral-500" />
            Investigation — {finding.check}
          </p>
          {finding.summary && (
            <p className="text-sm leading-6 text-neutral-700">
              {finding.summary}
            </p>
          )}
          {finding.probableCause && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                Probable cause
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-600">
                {finding.probableCause}
              </p>
            </div>
          )}
          {finding.affectedFiles.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                Possibly affected files
              </p>
              <ul className="mt-1 space-y-0.5">
                {finding.affectedFiles.map((f) => (
                  <li key={f} className="font-mono text-[11px] text-neutral-700">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {finding.proposedFix && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                Proposed fix — for your review only
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-600">
                {finding.proposedFix}
              </p>
            </div>
          )}
          <p className="rounded-md bg-neutral-50 px-3 py-2 text-[11px] leading-4 text-neutral-500">
            Nothing was changed or committed. To act on this: implement the fix
            via Ask Aria, run the Test lab / push, and re-check CI here.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Git ops — branches and tags (destructive ops require confirmation)
// ---------------------------------------------------------------------------

function GitOpsPanel({
  owner,
  repo,
  branch,
  onRefresh,
}: {
  owner: string;
  repo: string;
  branch: string;
  onRefresh: () => void;
}) {
  const listBranches = useAction(api.githubActions.listBranches);
  const createBranch = useAction(api.githubActions.createBranch);
  const renameBranch = useAction(api.engineering.renameBranch);
  const deleteBranch = useAction(api.engineering.deleteBranch);
  const listTags = useAction(api.engineering.listTags);
  const createTag = useAction(api.engineering.createTag);
  const deleteTag = useAction(api.engineering.deleteTag);

  const [branches, setBranches] = useState<
    Array<{ name: string; sha: string }> | null
  >(null);
  const [tags, setTags] = useState<
    Array<{ name: string; sha: string }> | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [renameOld, setRenameOld] = useState("");
  const [renameNew, setRenameNew] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "branch" | "tag";
    name: string;
  } | null>(null);
  const [newTag, setNewTag] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, t] = await Promise.all([
        listBranches({ owner, repo }),
        listTags({ owner, repo }),
      ]);
      setBranches(b);
      setTags(t);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [owner, repo, listBranches, listTags]);

  useEffect(() => {
    if (owner && repo) void load();
  }, [owner, repo, load]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(success);
      await load();
      onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
        Branch and tag management against GitHub. Creating a branch is
        non-destructive; renaming deletes the old ref, and deleting a branch
        or tag is permanent — both require explicit confirmation.
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Branches */}
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-700">
            <GitBranch className="size-3.5" /> Branches
            <span className="ml-auto text-[10px] text-neutral-400">
              {branches?.length ?? "…"}
            </span>
          </p>

          <div className="mt-2 flex gap-1.5">
            <Input
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder={`new branch from ${branch}`}
              spellCheck={false}
              className="h-8 flex-1 font-mono text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 text-[11px]"
              disabled={!newBranch.trim() || busy}
              onClick={() =>
                void act(
                  () =>
                    createBranch({
                      owner,
                      repo,
                      name: newBranch.trim(),
                      base: branch,
                    }),
                  `Branch ${newBranch.trim()} created`,
                )
              }
            >
              Create
            </Button>
          </div>

          <div className="mt-2 flex gap-1.5">
            <select
              value={renameOld}
              onChange={(e) => setRenameOld(e.target.value)}
              className="h-8 flex-1 rounded-md border border-neutral-200 bg-white px-2 font-mono text-[11px] text-neutral-700"
            >
              <option value="">rename…</option>
              {(branches ?? []).map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
            <Input
              value={renameNew}
              onChange={(e) => setRenameNew(e.target.value)}
              placeholder="to"
              spellCheck={false}
              className="h-8 w-28 font-mono text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-[11px]"
              disabled={!renameOld || !renameNew.trim() || busy}
              onClick={() =>
                void act(
                  () =>
                    renameBranch({
                      owner,
                      repo,
                      oldName: renameOld,
                      newName: renameNew.trim(),
                    }),
                  `Renamed ${renameOld} → ${renameNew.trim()}`,
                )
              }
            >
              Rename
            </Button>
          </div>

          <ul className="mt-3 max-h-52 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
            {(branches ?? []).map((b) => (
              <li key={b.name} className="flex items-center gap-2 px-2 py-1.5">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    b.name === branch ? "bg-emerald-500" : "bg-neutral-300",
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-800">
                  {b.name}
                </span>
                <span className="font-mono text-[9px] text-neutral-300">
                  {b.sha.slice(0, 7)}
                </span>
                {b.name !== branch && (
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmDelete({ kind: "branch", name: b.name })
                    }
                    className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
                    title={`Delete branch ${b.name}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </li>
            ))}
            {branches && branches.length === 0 && (
              <li className="px-2 py-3 text-center text-[11px] text-neutral-400">
                No branches.
              </li>
            )}
          </ul>
        </div>

        {/* Tags */}
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-700">
            <Tag className="size-3.5" /> Tags
            <span className="ml-auto text-[10px] text-neutral-400">
              {tags?.length ?? "…"}
            </span>
          </p>

          <div className="mt-2 flex gap-1.5">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder={`tag at branch tip (${branch})`}
              spellCheck={false}
              className="h-8 flex-1 font-mono text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 text-[11px]"
              disabled={!newTag.trim() || busy}
              onClick={() =>
                void act(
                  () =>
                    createTag({
                      owner,
                      repo,
                      name: newTag.trim(),
                      sha:
                        branches?.find((b) => b.name === branch)?.sha ?? "",
                    }),
                  `Tag ${newTag.trim()} created`,
                )
              }
            >
              Create
            </Button>
          </div>

          <ul className="mt-3 max-h-64 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
            {(tags ?? []).map((t) => (
              <li key={t.name} className="flex items-center gap-2 px-2 py-1.5">
                <Tag className="size-3 shrink-0 text-neutral-300" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-800">
                  {t.name}
                </span>
                <span className="font-mono text-[9px] text-neutral-300">
                  {t.sha.slice(0, 7)}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete({ kind: "tag", name: t.name })}
                  className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
                  title={`Delete tag ${t.name}`}
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
            {tags && tags.length === 0 && (
              <li className="px-2 py-3 text-center text-[11px] text-neutral-400">
                No tags yet.
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Destructive-action confirmation */}
      {confirmDelete && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 p-3">
          <p className="text-xs font-medium text-red-800">
            Delete {confirmDelete.kind} “{confirmDelete.name}” permanently?
          </p>
          <p className="mt-1 text-[11px] leading-4 text-red-700">
            {confirmDelete.kind === "branch"
              ? "The branch and all commits only reachable from it are gone from GitHub. Open PRs on it are unaffected but can't be updated."
              : "The tag is removed from GitHub. This can't be undone."}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 text-[11px]"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    confirmDelete.kind === "branch"
                      ? deleteBranch({ owner, repo, name: confirmDelete.name })
                      : deleteTag({ owner, repo, name: confirmDelete.name }),
                  `Deleted ${confirmDelete.kind} ${confirmDelete.name}`,
                ).then(() => setConfirmDelete(null))
              }
            >
              {busy ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <Trash2 className="mr-1 size-3" />
              )}
              Yes, delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-[11px]"
              onClick={() => setConfirmDelete(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PR center — detail, files, checks, reviews, edit, merge
// ---------------------------------------------------------------------------

interface PrSummary {
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
}

function PrPanel({
  owner,
  repo,
  onRefresh,
}: {
  owner: string;
  repo: string;
  onRefresh: () => void;
}) {
  const listPullRequests = useAction(api.githubActions.listPullRequests);
  const mergePullRequest = useAction(api.githubActions.mergePullRequest);
  const getDetail = useAction(api.engineering.getPullRequestDetail);
  const updatePr = useAction(api.engineering.updatePullRequest);

  const [prs, setPrs] = useState<PrSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<
    Awaited<ReturnType<typeof getDetail>> | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [confirmMerge, setConfirmMerge] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPullRequests({ owner, repo });
      setPrs(data);
      if (selected === null && data.length > 0) setSelected(data[0].number);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [owner, repo, listPullRequests, selected]);

  useEffect(() => {
    if (owner && repo) void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo]);

  const loadDetail = useCallback(
    async (number: number) => {
      setSelected(number);
      setDetail(null);
      setEditing(false);
      setError(null);
      try {
        const d = await getDetail({ owner, repo, number });
        setDetail(d);
        setEditTitle(d.title);
        setEditBody(d.body);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [owner, repo, getDetail],
  );

  useEffect(() => {
    if (selected !== null) void loadDetail(selected);
  }, [selected, loadDetail]);

  const saveEdit = async () => {
    if (!selected || !editTitle.trim()) return;
    setBusy(true);
    try {
      await updatePr({
        owner,
        repo,
        number: selected,
        title: editTitle.trim(),
        body: editBody,
      });
      setEditing(false);
      toast.success(`PR #${selected} updated`);
      await loadDetail(selected);
      await loadList();
      onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doMerge = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await mergePullRequest({ owner, repo, number: selected });
      toast.success(res.message ?? `Merged PR #${selected}`);
      setConfirmMerge(false);
      await loadList();
      await loadDetail(selected);
      onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pr = detail ?? prs?.find((p) => p.number === selected) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {prs === null && loading ? (
          <Loader2 className="size-4 animate-spin text-neutral-400" />
        ) : (
          (prs ?? []).map((p) => (
            <button
              key={p.number}
              type="button"
              onClick={() => void loadDetail(p.number)}
              className={cn(
                "max-w-56 truncate rounded-md border px-2 py-1 text-[11px]",
                selected === p.number
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-100",
              )}
            >
              #{p.number} {p.title}
            </button>
          ))
        )}
        {prs && prs.length === 0 && (
          <span className="text-xs text-neutral-400">
            No open pull requests.
          </span>
        )}
        <button
          type="button"
          onClick={() => void loadList()}
          className="ml-auto flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-900"
        >
          <RefreshCw className="size-3" /> Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {pr && (
        <div className="rounded-lg border border-neutral-200">
          <div className="border-b border-neutral-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-neutral-900">{pr.title}</p>
              {pr.draft && (
                <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                  Draft
                </span>
              )}
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  detail?.overall === "success" &&
                    "bg-emerald-50 text-emerald-700",
                  detail?.overall === "failure" && "bg-red-50 text-red-600",
                  detail?.overall === "pending" && "bg-amber-50 text-amber-700",
                  detail?.overall === "none" && "bg-neutral-100 text-neutral-500",
                )}
              >
                CI {detail?.overall?.toUpperCase() ?? "…"}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              #{pr.number} · @{pr.author} ·{" "}
              <span className="font-mono">{pr.head}</span> →{" "}
              <span className="font-mono">{pr.base}</span>
              {pr.createdAt
                ? ` · opened ${new Date(pr.createdAt).toLocaleDateString()}`
                : ""}
            </p>
            <p className="mt-1 text-[11px] text-neutral-400">
              mergeable:{" "}
              {pr.mergeable === null
                ? "checking…"
                : pr.mergeable
                  ? "yes"
                  : "no"}
              {pr.mergeableState ? ` (${pr.mergeableState})` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {!editing ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setEditing(true)}
                  >
                    <GitPullRequest className="mr-1 size-3" /> Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={
                      !!pr.draft ||
                      pr.mergeable === false ||
                      pr.mergeable === null ||
                      busy
                    }
                    title={
                      pr.draft
                        ? "Draft PRs can't be merged"
                        : pr.mergeable === false
                          ? "Has conflicts"
                          : pr.mergeable === null
                            ? "Still checking mergeability"
                            : "Squash-merge this PR"
                    }
                    onClick={() => setConfirmMerge(true)}
                  >
                    <GitPullRequest className="mr-1 size-3" /> Merge
                  </Button>
                  {pr.htmlUrl && (
                    <a
                      href={pr.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-neutral-400 hover:text-neutral-900"
                    >
                      open on GitHub ↗
                    </a>
                  )}
                </>
              ) : (
                <div className="w-full space-y-2">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="h-8 font-mono text-[11px]"
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    className="w-full rounded-md border border-neutral-200 bg-background px-3 py-2 font-mono text-[11px] leading-5 text-neutral-800 outline-none focus:border-neutral-400"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={!editTitle.trim() || busy}
                      onClick={() => void saveEdit()}
                    >
                      {busy ? (
                        <Loader2 className="mr-1 size-3 animate-spin" />
                      ) : (
                        <Send className="mr-1 size-3" />
                      )}
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px]"
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {detail && (
            <div className="space-y-3 p-4">
              {detail.body && (
                <pre className="whitespace-pre-wrap rounded-md bg-neutral-50 px-3 py-2 font-mono text-[11px] leading-5 text-neutral-600">
                  {detail.body}
                </pre>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-neutral-200">
                  <p className="border-b border-neutral-100 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                    Changed files ({detail.files.length})
                  </p>
                  <ul className="max-h-44 divide-y divide-neutral-100 overflow-y-auto">
                    {detail.files.map((f) => (
                      <li key={f.path} className="px-3 py-1.5">
                        <p className="truncate font-mono text-[11px] text-neutral-800">
                          {f.path}
                        </p>
                        <p className="text-[10px] text-neutral-400">
                          {f.status} · +{f.additions}/−{f.deletions}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-neutral-200">
                  <p className="border-b border-neutral-100 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                    Reviews &amp; comments
                  </p>
                  <div className="max-h-44 overflow-y-auto px-3 py-1.5">
                    {detail.reviews.length === 0 &&
                      detail.reviewComments.length === 0 &&
                      detail.issueComments.length === 0 && (
                        <p className="py-2 text-[11px] text-neutral-400">
                          No reviews or comments yet.
                        </p>
                      )}
                    {detail.reviews.map((r, i) => (
                      <p key={i} className="py-1 text-[11px] text-neutral-600">
                        <span className="font-medium text-neutral-800">
                          @{r.author}
                        </span>{" "}
                        {r.state.toLowerCase()} review
                        {r.body ? ` — ${r.body}` : ""}
                      </p>
                    ))}
                    {detail.reviewComments.map((c, i) => (
                      <p key={`rc${i}`} className="py-1 text-[11px] text-neutral-600">
                        <span className="font-medium text-neutral-800">
                          @{c.author}
                        </span>{" "}
                        on {c.path}
                        {c.line ? `:${c.line}` : ""} — {c.body}
                      </p>
                    ))}
                    {detail.issueComments.map((c, i) => (
                      <p key={`ic${i}`} className="py-1 text-[11px] text-neutral-600">
                        <span className="font-medium text-neutral-800">
                          @{c.author}
                        </span>{" "}
                        — {c.body}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              {detail.files.some((f) => f.patch) && (
                <div className="rounded-lg border border-neutral-200">
                  <p className="border-b border-neutral-100 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                    Unified diff
                  </p>
                  <div className="max-h-72 overflow-auto">
                    {detail.files
                      .filter((f) => f.patch)
                      .map((f) => (
                        <div
                          key={f.path}
                          className="border-b border-neutral-100 last:border-b-0"
                        >
                          <p className="px-3 py-1.5 font-mono text-[11px] text-neutral-600">
                            {f.path}
                          </p>
                          <DiffView lines={parseUnifiedPatch(f.patch)} />
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Merge confirmation */}
      {confirmMerge && pr && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-xs font-medium text-amber-900">
            Squash-merge #{pr.number} “{pr.title}” into {pr.base}?
          </p>
          <p className="mt-1 text-[11px] leading-4 text-amber-800">
            The PR's commits become one commit on {pr.base}. CI status:{" "}
            {detail?.overall.toUpperCase() ?? "unknown"}. The branch itself
            stays untouched.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 text-[11px]"
              disabled={busy}
              onClick={() => void doMerge()}
            >
              {busy ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <GitPullRequest className="mr-1 size-3" />
              )}
              Merge
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-[11px]"
              onClick={() => setConfirmMerge(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {pr && !detail && (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-neutral-400">
          <Loader2 className="size-3.5 animate-spin" />
          Loading PR details…
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
        <Copy className="size-3" />
        PR center reads live GitHub data; AI never edits a PR without your
        explicit save.
      </div>
    </div>
  );
}
