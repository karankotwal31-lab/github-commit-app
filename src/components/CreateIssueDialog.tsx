import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/github";
import { CircleDot, Loader2 } from "lucide-react";

/**
 * Create an issue in the current repository, then open it on GitHub. A small
 * but expected workflow that competitors have and the workspace lacked.
 */
export function CreateIssueDialog({
  open,
  onOpenChange,
  owner,
  repo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
}) {
  const createIssue = useAction(api.githubActions.createIssue);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createIssue({
        owner,
        repo,
        title: title.trim(),
        body: body.trim() || undefined,
      });
      toast.success(`Issue #${result.number} opened`);
      setTitle("");
      setBody("");
      onOpenChange(false);
      window.open(result.htmlUrl, "_blank");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDot className="size-4 text-neutral-500" />
            New issue
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">
              {owner}/{repo}
            </span>{" "}
            — the issue opens on GitHub when created.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Issue title"
            spellCheck={false}
            className="w-full rounded-md border border-neutral-200 bg-background px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe the problem or request… (optional)"
            rows={5}
            spellCheck={false}
            className="w-full resize-none rounded-md border border-neutral-200 bg-background p-3 text-sm leading-6 text-neutral-900 outline-none focus:border-neutral-400"
          />
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}
          <Button
            type="button"
            className="w-full gap-1.5"
            onClick={submit}
            disabled={busy || !title.trim()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CircleDot className="size-4" />
            )}
            {busy ? "Opening…" : "Create issue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
