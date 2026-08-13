import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { errorMessage } from "@/lib/github";
import {
  Check,
  Copy,
  GitBranch,
  Loader2,
  LogIn,
  Share2,
  Users,
} from "lucide-react";

export interface SharedWorkspaceRow {
  code: string;
  repo: string;
  branch: string;
  label: string | null;
  createdAt: number;
}

export function ShareWorkspaceDialog({
  open,
  onOpenChange,
  repo,
  branch,
  onJoin,
  myShared,
  createSharedWorkspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repo: string | null;
  branch: string | null;
  onJoin: (code: string) => Promise<boolean>;
  myShared: SharedWorkspaceRow[] | undefined;
  createSharedWorkspace: (args: {
    repo: string;
    branch: string;
    label?: string;
  }) => Promise<string>;
}) {
  const [code, setCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copy = async (text: string, codeToMark: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked — the code is still visible to copy by hand.
    }
    setCopiedCode(codeToMark);
    window.setTimeout(() => setCopiedCode(null), 1500);
  };

  const handleCreate = async () => {
    if (!repo || !branch) return;
    setShareBusy(true);
    try {
      const newCode = await createSharedWorkspace({ repo, branch });
      setLastCode(newCode);
      await copy(newCode, newCode);
      toast.success(`Workspace code: ${newCode} (copied)`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setShareBusy(false);
    }
  };

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setJoinBusy(true);
    try {
      const ok = await onJoin(trimmed);
      if (ok) {
        setCode("");
        setLastCode(null);
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-neutral-500" />
            Team workspaces
          </DialogTitle>
          <DialogDescription>
            Share the current repo + branch with teammates using a short code.
            Everyone joins with their own GitHub connection — drafts and live
            presence stay private to each user.
          </DialogDescription>
        </DialogHeader>

        {/* Share current workspace */}
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center gap-2">
            <GitBranch className="size-3.5 text-neutral-400" />
            <p className="truncate font-mono text-xs text-neutral-700">
              {repo ? `${repo} · ${branch ?? ""}` : "Open a repo first"}
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={handleCreate}
              disabled={!repo || !branch || shareBusy}
            >
              {shareBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Share2 className="size-3.5" />
              )}
              {lastCode ? "New code" : "Share this workspace"}
            </Button>
            {lastCode && (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <code className="truncate rounded bg-neutral-100 px-2 py-1 font-mono text-xs font-medium tracking-wide text-neutral-800">
                  {lastCode}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => copy(lastCode, lastCode)}
                  title="Copy code"
                >
                  {copiedCode === lastCode ? (
                    <Check className="size-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Join a workspace */}
        <div className="rounded-lg border border-neutral-200 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
            Join a workspace
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ARIA-XXXXX"
              spellCheck={false}
              autoCapitalize="characters"
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim() && !joinBusy) {
                  handleJoin();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={handleJoin}
              disabled={!code.trim() || joinBusy}
            >
              {joinBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogIn className="size-3.5" />
              )}
              Join
            </Button>
          </div>
        </div>

        {/* Codes I created */}
        {myShared && myShared.length > 0 && (
          <div>
            <p className="px-1 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
              Your codes
            </p>
            <div className="mt-1.5 space-y-1">
              {myShared.map((row) => (
                <button
                  key={row.code}
                  type="button"
                  onClick={() => copy(row.code, row.code)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100"
                  title="Click to copy"
                >
                  <code className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-700">
                    {row.code}
                  </code>
                  <span className="truncate font-mono text-[11px] text-neutral-500">
                    {row.repo} · {row.branch}
                  </span>
                  {copiedCode === row.code ? (
                    <Check className="ml-auto size-3 text-emerald-600" />
                  ) : (
                    <Copy className="ml-auto size-3 text-neutral-300" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
