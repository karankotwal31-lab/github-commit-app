import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export interface SimpleChange {
  path: string;
  action: "update" | "create";
  content: string;
  originalContent: string;
}

export interface SimpleModeResult {
  explanation: string;
  changes: SimpleChange[];
}

/** Simple Mode — a plain-English, no-code view of the same Ask Aria flow.
 *  Hides the file tree and code view, explains changes in plain language,
 *  and still requires a human to review and stage before anything commits. */
export function SimpleModePanel({
  instruction,
  setInstruction,
  loading,
  error,
  result,
  onAsk,
  onStage,
  onStageAll,
  onExit,
}: {
  instruction: string;
  setInstruction: (v: string) => void;
  loading: boolean;
  error: string | null;
  result: SimpleModeResult | null;
  onAsk: () => void;
  onStage: (change: SimpleChange) => void;
  onStageAll: () => void;
  onExit: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-background">
      <div className="w-full max-w-2xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              Simple mode
            </h2>
            <p className="mt-1 text-sm leading-6 text-neutral-500">
              No file tree, no code view. Describe what you want changed in
              plain English and Aria proposes the edits — a developer still
              reviews and approves each one before anything is committed.
            </p>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="shrink-0 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
          >
            Exit simple
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe the change in plain English — for example: “Make the checkout button say ‘Buy now’ and send a confirmation email after payment.”"
            rows={4}
            spellCheck={false}
            className="w-full resize-none rounded-md border border-neutral-200 bg-background p-3 font-mono text-sm leading-6 text-neutral-900 outline-none focus:border-neutral-400"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!loading && instruction.trim()) onAsk();
              }
            }}
          />
          <Button
            type="button"
            className="h-9 w-full gap-1.5"
            onClick={onAsk}
            disabled={loading || !instruction.trim()}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {loading ? "Thinking…" : "What will change?"}
          </Button>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}
          {result && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-neutral-200 p-4">
                <p className="text-[15px] leading-7 text-neutral-800">
                  {result.explanation}
                </p>
              </div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                Files this will touch
              </p>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                {result.changes.map((change) => (
                  <li key={change.path} className="flex items-center gap-2 p-3">
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
                      onClick={() => onStage(change)}
                    >
                      <Plus className="size-3" />
                      Approve
                    </Button>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                className="h-9 w-full gap-1.5"
                onClick={onStageAll}
              >
                <CheckCircle2 className="size-4" />
                Approve all {result.changes.length} change
                {result.changes.length > 1 ? "s" : ""}
              </Button>
              <p className="flex items-start gap-1.5 text-xs leading-5 text-neutral-400">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                Approving stages the edit in the working tree — nothing is
                committed until the commit box is used, so a developer always
                gets a final look.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
