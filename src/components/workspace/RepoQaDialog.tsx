import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { errorMessage } from "@/lib/github";
import { FileCode2, Loader2, MessageSquareCode } from "lucide-react";

/**
 * "Ask about this repo" — semantic Q&A against the repository.
 *
 * Reads the current branch's file list, grounds the answer in the most
 * relevant files, and returns clickable file references. Read-only: it never
 * proposes edits (that's what Ask Aria does).
 */
export function RepoQaDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  branch: string;
  onOpenFile: (path: string) => void;
}) {
  const { open, onOpenChange, owner, repo, branch, onOpenFile } = props;
  const askRepo = useAction(api.aiActions.aiAskRepo);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{
    answer: string;
    files: string[];
  } | null>(null);

  const run = async () => {
    if (loading || !question.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await askRepo({ owner, repo, branch, question });
      setAnswer(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setQuestion("");
    setAnswer(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ask about this repo</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-5 text-neutral-400">
          Ask how this repository works — where the auth lives, how the
          deploy pipeline fits together, what a file is for. Answers are
          grounded in the actual files on{" "}
          <span className="font-mono text-neutral-500">{branch}</span>.
          This mode never proposes edits.
        </p>
        <div className="flex flex-col gap-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="For example: “Where is the login flow implemented, and how does the token get refreshed?”"
            rows={3}
            spellCheck={false}
            className="w-full resize-none rounded-md border border-neutral-200 bg-background p-3 font-mono text-sm leading-6 text-neutral-900 outline-none focus:border-neutral-400"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void run();
              }
            }}
          />
          <Button
            type="button"
            className="h-9 w-full gap-1.5"
            onClick={() => void run()}
            disabled={loading || !question.trim()}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquareCode className="size-4" />
            )}
            {loading ? "Reading the repo…" : "Ask"}
          </Button>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}
          {answer && (
            <div className="flex flex-col gap-3">
              <p className="rounded-lg border border-neutral-200 p-4 text-sm leading-6 text-neutral-700">
                {answer.answer}
              </p>
              {answer.files.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                    Referenced files
                  </p>
                  <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                    {answer.files.map((path) => (
                      <li key={path}>
                        <button
                          type="button"
                          onClick={() => onOpenFile(path)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                        >
                          <FileCode2 className="size-3.5 shrink-0 text-neutral-400" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-800">
                            {path}
                          </span>
                          <span className="shrink-0 text-[10px] text-neutral-400">
                            Open
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={reset}
              >
                New question
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
