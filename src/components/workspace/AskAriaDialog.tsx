import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AiUsageMeter } from "@/components/AiUsageMeter";
import { AiCommitMessageButton } from "@/components/AiCommitMessageButton";
import { DiffView } from "@/components/workspace-shared";
import { diffLines } from "@/lib/diff";
import type { WorkspaceViewProps } from "./types";
import { Loader2, Plus, Sparkles } from "lucide-react";

type AskAriaDialogProps = Pick<
  WorkspaceViewProps,
  | "staged"
  | "setCommitMessage"
  | "aiOpen"
  | "setAiOpen"
  | "aiHistory"
  | "setAiHistory"
  | "aiInstruction"
  | "setAiInstruction"
  | "aiLoading"
  | "aiError"
  | "aiResult"
  | "setAiResult"
  | "setAiError"
  | "handleAiAsk"
  | "stageAiChange"
  | "stageAllAiChanges"
  | "openFile"
  | "isNewFile"
  | "setBillingOpen"
>;

/** Ask Aria — the grounded AI assistant. */
export function AskAriaDialog(props: AskAriaDialogProps) {
  const {
    staged,
    setCommitMessage,
    aiOpen,
    setAiOpen,
    aiHistory,
    setAiHistory,
    aiInstruction,
    setAiInstruction,
    aiLoading,
    aiError,
    aiResult,
    setAiResult,
    setAiError,
    handleAiAsk,
    stageAiChange,
    stageAllAiChanges,
    openFile,
    isNewFile,
    setBillingOpen,
  } = props;

  return (
    <Dialog open={aiOpen} onOpenChange={setAiOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ask Aria</DialogTitle>
        </DialogHeader>
        <AiUsageMeter onUpgrade={() => setBillingOpen(true)} />
        <AiCommitMessageButton
          staged={staged}
          onMessage={(msg) => setCommitMessage(msg)}
        />
        {aiHistory.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                Conversation
              </p>
              <button
                type="button"
                onClick={() => {
                  setAiHistory([]);
                  setAiResult(null);
                  setAiError(null);
                }}
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                New conversation
              </button>
            </div>
            <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-neutral-200 p-3">
              {aiHistory.map((turn, i) =>
                turn.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] rounded-lg bg-neutral-900 px-3 py-1.5 text-xs leading-5 text-white">
                      {turn.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <p className="max-w-[85%] rounded-lg border border-neutral-200 px-3 py-1.5 text-xs leading-5 text-neutral-700">
                      {turn.content}
                    </p>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3">
          <textarea
            value={aiInstruction}
            onChange={(e) => setAiInstruction(e.target.value)}
            placeholder="What should I change? For example: “Add input validation to the signup form” or “Fix the race condition in the file loader.”"
            rows={3}
            spellCheck={false}
            className="w-full resize-none rounded-md border border-neutral-200 bg-background p-3 font-mono text-sm leading-6 text-neutral-900 outline-none focus:border-neutral-400"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!aiLoading && aiInstruction.trim()) handleAiAsk();
              }
            }}
          />
          <p className="text-xs leading-5 text-neutral-400">
            Aria reads the current branch and{" "}
            {openFile && !isNewFile ? (
              <span className="font-mono text-neutral-500">
                {openFile.path}
              </span>
            ) : (
              "no open file"
            )}
            . It proposes changes you review and stage — nothing is committed
            automatically. Follow-ups build on this conversation.
          </p>
          <Button
            type="button"
            className="h-9 w-full gap-1.5"
            onClick={handleAiAsk}
            disabled={aiLoading || !aiInstruction.trim()}
          >
            {aiLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {aiLoading ? "Thinking…" : "Propose changes"}
          </Button>
          {aiError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {aiError}
            </p>
          )}
          {aiResult && (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-6 text-neutral-700">
                {aiResult.explanation}
              </p>
              <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
                <ul className="divide-y divide-neutral-100">
                  {aiResult.changes.map((change) => (
                    <li key={change.path} className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`shrink-0 rounded px-1 font-mono text-[10px] font-semibold ${
                            change.action === "create"
                              ? "bg-emerald-50 text-emerald-900"
                              : "bg-amber-50 text-amber-900"
                          }`}
                        >
                          {change.action === "create" ? "A" : "M"}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-neutral-800">
                          {change.path}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 gap-1 text-xs"
                          onClick={() => stageAiChange(change)}
                        >
                          <Plus className="size-3" />
                          Stage
                        </Button>
                      </div>
                      <div className="mt-2 max-h-48 overflow-auto rounded border border-neutral-100">
                        <DiffView
                          lines={diffLines(
                            change.originalContent,
                            change.content,
                          )}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                type="button"
                className="h-9 w-full gap-1.5"
                onClick={stageAllAiChanges}
              >
                <Plus className="size-4" />
                Stage all {aiResult.changes.length} change
                {aiResult.changes.length > 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
