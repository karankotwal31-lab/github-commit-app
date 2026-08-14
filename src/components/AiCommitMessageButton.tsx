import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/github";
import { Loader2, MessageSquareText } from "lucide-react";

export interface StagedChange {
  path: string;
  action: "update" | "create";
  originalContent: string;
  content: string;
}

/**
 * AI commit message generator: turns the staged changes into a conventional
 * commit message and fills the commit box. Shares the Ask Aria quota (the
 * action enforces it server-side); this button only pre-checks for UX.
 */
export function AiCommitMessageButton({
  staged,
  onMessage,
}: {
  staged: StagedChange[];
  onMessage: (message: string) => void;
}) {
  const aiUsage = useQuery(api.aiUsage.getAiUsage);
  const generate = useAction(api.aiActions.aiCommitMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (staged.length === 0) return null;

  const run = async () => {
    if (aiUsage && aiUsage.quota !== null && aiUsage.used >= aiUsage.quota) {
      toast.error("You've used all your AI requests for this month.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await generate({
        changes: staged.map((f) => ({
          path: f.path,
          action: f.action,
          originalContent: f.originalContent,
          content: f.content,
        })),
      });
      onMessage(res.message);
      toast.success("Commit message generated — edit it if you like.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        onClick={run}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <MessageSquareText className="size-3.5" />
        )}
        Generate commit message from {staged.length} staged file
        {staged.length > 1 ? "s" : ""}
      </Button>
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-4 text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
