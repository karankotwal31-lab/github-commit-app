import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  githubAuthorizeUrl,
  convexSiteUrl,
  errorMessage,
} from "@/lib/github";
import { type DiffLine } from "@/lib/diff";
import { toast } from "sonner";
import { Github, Loader2, Music2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

export function Wordmark() {
  return (
    <div className="flex items-center gap-1.5">
      <Music2 className="size-4 text-primary" strokeWidth={2.25} />
      <span className="text-[15px] font-semibold tracking-tight">Aria</span>
      <span className="text-[15px] font-semibold tracking-tight text-neutral-400">
        .
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect screen
// ---------------------------------------------------------------------------

export function ConnectScreen({
  config,
}: {
  config: {
    clientIdConfigured: boolean;
    clientSecretConfigured: boolean;
    clientId: string | null;
  };
}) {
  const startOAuth = useMutation(api.github.startOAuth);
  const callbackUrl = `${convexSiteUrl()}/api/github/callback`;
  const keysReady = config.clientIdConfigured && config.clientSecretConfigured;

  const handleConnect = async () => {
    if (!config.clientId) {
      toast.error("GitHub keys aren't configured yet — see the setup steps.");
      return;
    }
    try {
      const state = await startOAuth({ origin: window.location.origin });
      const url = githubAuthorizeUrl(state, config.clientId);
      // GitHub's authorize page refuses to render inside the preview iframe
      // (X-Frame-Options), which blanked the app. Open it in a popup instead
      // — a top-level window, where GitHub renders fine. The Convex callback
      // redirects the popup back to the app, which reports the result here
      // and closes itself.
      const popup = window.open(
        url,
        "aria-github-oauth",
        "popup,width=620,height=760",
      );
      if (!popup) {
        // Popups blocked (sandboxed preview) — fall back to navigating the
        // whole tab, which GitHub allows.
        try {
          const top = window.top ?? window;
          top.location.href = url;
        } catch {
          window.location.href = url;
        }
        return;
      }
      toast.info("Authorize Aria in the popup that just opened.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  // Report the popup's outcome (connected / config / error) back to the
  // preview frame — the reactive connection query finishes the job.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "aria-github-oauth") return;
      const status = event.data.status as string;
      if (status === "connected") {
        toast.success("Connected to GitHub");
      } else if (status === "config") {
        toast.error("GitHub keys aren't configured yet — see the setup steps.");
      } else if (status === "error") {
        toast.error("Couldn't connect to GitHub. Please try again.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground antialiased">
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 px-6">
        <Wordmark />
        <span className="text-xs text-neutral-400">Not connected</span>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
              Step 1 of 1
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              Connect your GitHub
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-500">
              Authorize Aria to read your repositories and push commits.
              It's a one-time handshake — after this, everything happens here.
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-6">
            <div className="flex items-center gap-3">
              <span
                className={`flex size-5 items-center justify-center rounded-full border text-[11px] ${
                  keysReady
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 text-neutral-400"
                }`}
              >
                {keysReady ? "✓" : "1"}
              </span>
              <p className="text-sm text-neutral-700">
                Add your GitHub OAuth keys to the project
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`flex size-5 items-center justify-center rounded-full border text-[11px] ${
                  keysReady
                    ? "border-neutral-300 text-neutral-400"
                    : "border-neutral-300 text-neutral-400"
                }`}
              >
                2
              </span>
              <p className="text-sm text-neutral-700">Authorize below</p>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-neutral-200 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
              Callback URL
            </p>
            <p className="mt-2 break-all font-mono text-xs text-neutral-700">
              {callbackUrl}
            </p>
            <p className="mt-3 text-xs leading-5 text-neutral-500">
              Register an OAuth app at{" "}
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-neutral-800"
              >
                github.com/settings/developers
              </a>{" "}
              and use the URL above as the authorization callback. Set{" "}
              <code className="font-mono text-neutral-700">GITHUB_CLIENT_ID</code>{" "}
              and{" "}
              <code className="font-mono text-neutral-700">
                GITHUB_CLIENT_SECRET
              </code>{" "}
              in your project keys.
            </p>
          </div>

          <Button
            type="button"
            className="mt-6 h-11 w-full gap-2"
            onClick={handleConnect}
          >
            <Github className="size-4" />
            {keysReady ? "Connect GitHub" : "Connect GitHub (keys pending)"}
          </Button>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Input dialog (new file / rename / new branch)
// ---------------------------------------------------------------------------

export function InputDialog({
  open,
  title,
  label,
  placeholder,
  initial,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {label && <p className="text-sm leading-5 text-neutral-500">{label}</p>}
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() && !busy) {
              onConfirm(value.trim());
            }
          }}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!value.trim() || busy}
            onClick={() => onConfirm(value.trim())}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Diff view
// ---------------------------------------------------------------------------

/** Diffs above this many changed lines collapse behind a summary card. */
const LARGE_DIFF_THRESHOLD = 400;

export function DiffView({ lines }: { lines: DiffLine[] }) {
  const [expanded, setExpanded] = useState(false);
  const changed = lines.filter((l) => l.type !== "same").length;
  const isLarge = changed > LARGE_DIFF_THRESHOLD;

  return (
    <div className="h-full overflow-auto bg-background">
      {isLarge && !expanded ? (
        <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <p className="text-sm font-medium text-neutral-800">
            Large diff — {changed.toLocaleString()} changed lines
          </p>
          <p className="max-w-sm text-xs text-neutral-500">
            This diff is big enough that rendering it all at once can stall the
            UI. Expand it only when you need the details.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-1"
            onClick={() => setExpanded(true)}
          >
            Show full diff
          </Button>
        </div>
      ) : (
        <>
          {isLarge && (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2">
              <p className="text-sm text-neutral-600">
                {changed.toLocaleString()} changed lines
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExpanded(false)}
              >
                Collapse diff
              </Button>
            </div>
          )}
          <table className="w-full border-collapse font-mono text-sm leading-6">
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={i}
              className={
                line.type === "add"
                  ? "bg-emerald-50/60"
                  : line.type === "del"
                    ? "bg-red-50/60"
                    : ""
              }
            >
              <td className="w-12 select-none border-r border-neutral-100 px-2 text-right text-xs text-neutral-400">
                {line.oldLine ?? ""}
              </td>
              <td className="w-12 select-none border-r border-neutral-100 px-2 text-right text-xs text-neutral-400">
                {line.newLine ?? ""}
              </td>
              <td
                className={`whitespace-pre px-3 ${
                  line.type === "add"
                    ? "text-emerald-900"
                    : line.type === "del"
                      ? "text-red-900"
                      : "text-neutral-800"
                }`}
              >
                {line.text || " "}
              </td>
            </tr>
          ))}
        </tbody>
          </table>
          {lines.length === 0 && (
            <p className="p-6 text-sm text-neutral-400">No changes yet.</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** Relative time for vault rows and presence, e.g. "3m ago". */
export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Compact CI chip shown next to the branch selector. */
export function ChecksChip({
  overall,
  loading,
  onClick,
}: {
  overall: "none" | "pending" | "failure" | "success" | null;
  loading: boolean;
  onClick: () => void;
}) {
  const state =
    overall === "success"
      ? { dot: "bg-emerald-500", label: "Passed", cls: "text-neutral-600" }
      : overall === "failure"
        ? { dot: "bg-red-500", label: "Failed", cls: "text-red-600" }
        : overall === "pending"
          ? { dot: "bg-amber-500 animate-pulse", label: "Running", cls: "text-amber-700" }
          : { dot: "bg-neutral-300", label: "No checks", cls: "text-neutral-400" };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-neutral-100"
      title={
        overall === null || overall === "none"
          ? "CI status for this branch"
          : "View CI checks for this branch"
      }
    >
      {loading ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-neutral-400" />
      ) : (
        <span className={`size-1.5 shrink-0 rounded-full ${state.dot}`} />
      )}
      <span className={`truncate ${state.cls}`}>{state.label}</span>
    </button>
  );
}

/**
 * Mounted next to the open file: queries the draft vault for that exact
 * (repo, branch, path) and reports once whether an unsaved copy exists, so
 * the workspace can restore it. Fires exactly once per mount — the parent
 * keys it by path.
 */
export function DraftRestorer({
  repo,
  branch,
  path,
  onDraft,
}: {
  repo: string;
  branch: string;
  path: string;
  onDraft: (draft: {
    content: string;
    cursorLine: number | null;
    cursorColumn: number | null;
  }) => void;
}) {
  const draft = useQuery(api.github.getDraft, { repo, branch, path });
  const fired = useRef(false);
  useEffect(() => {
    if (draft === undefined || fired.current) return;
    fired.current = true;
    if (draft) onDraft(draft);
  }, [draft, onDraft]);
  return null;
}
