import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { errorMessage, ownerOf, repoNameOf } from "@/lib/github";
import { DiffView } from "@/components/workspace-shared";
import { diffLines } from "@/lib/diff";
import { cn } from "@/lib/utils";
import {
  Check,
  CheckCircle2,
  GitBranch,
  GitMerge,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

interface CrossRepoProposal {
  owner: string;
  repo: string;
  branch: string;
  summary: string;
  changes: Array<{
    path: string;
    action: "update" | "create" | "delete";
    content: string;
    reason: string;
  }>;
  error?: string;
}

/**
 * Cross-repo AI edits (Team/Enterprise): describe one change in plain
 * English; Aria proposes concrete edits per affected repo, shown together on
 * one screen. Nothing is committed until the user approves each repo — and
 * even then each approved repo's edits are committed via the normal commit
 * path, one commit per repo. Server-side Team gate lives in the action.
 */
export function CrossRepoDialog({
  open,
  onOpenChange,
  repos,
  isTeam,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repos: Array<{ fullName: string; defaultBranch: string }>;
  isTeam: boolean;
}) {
  const planCrossRepo = useAction(api.aiActions.aiPlanCrossRepo);
  const commitChanges = useAction(api.githubActions.commitChanges);
  const [instruction, setInstruction] = useState("");
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<CrossRepoProposal[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState<string | null>(null);
  const [committed, setCommitted] = useState<Set<string>>(new Set());

  const repoTargets = useMemo(
    () =>
      repos.slice(0, 6).map((r) => ({
        fullName: r.fullName,
        owner: ownerOf(r.fullName),
        repo: repoNameOf(r.fullName),
        branch: r.defaultBranch,
      })),
    [repos],
  );

  const reset = () => {
    setInstruction("");
    setError(null);
    setProposals(null);
    setApproved(new Set());
    setCommitted(new Set());
    setExpanded(null);
  };

  const handlePlan = async () => {
    if (!instruction.trim()) return;
    setPlanning(true);
    setError(null);
    setProposals(null);
    setApproved(new Set());
    setCommitted(new Set());
    try {
      const result = await planCrossRepo({
        instruction: instruction.trim(),
        repos: repoTargets.map((r) => ({
          owner: r.owner,
          repo: r.repo,
          branch: r.branch,
        })),
      });
      setProposals(result.repos);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPlanning(false);
    }
  };

  const handleApprove = (key: string) => {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCommitRepo = async (proposal: CrossRepoProposal) => {
    const key = `${proposal.owner}/${proposal.repo}`;
    setCommitting(key);
    try {
      await commitChanges({
        owner: proposal.owner,
        repo: proposal.repo,
        branch: proposal.branch,
        message: `[Aria] ${instruction.trim().slice(0, 100)}`,
        files: proposal.changes.map((c) => ({
          path: c.path,
          action: c.action,
          ...(c.action !== "delete" ? { content: c.content } : {}),
        })),
      });
      setCommitted((prev) => new Set(prev).add(key));
      toast.success(`Committed to ${key} — check the repo for the new commit.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCommitting(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="size-4 text-neutral-500" />
            Cross-repo AI edits
            {isTeam && (
              <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Team
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {!isTeam ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
            Cross-repo AI edits are a Team feature — upgrade to plan changes
            across multiple repositories from one description.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Describe the change in plain English. For example: “Rename the login endpoint from /signin to /auth in every service” or “Add a retry with backoff to all HTTP clients.”"
              rows={3}
              spellCheck={false}
              className="w-full resize-none rounded-md border border-neutral-200 bg-background p-3 font-mono text-sm leading-6 text-neutral-900 outline-none focus:border-neutral-400"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-xs text-neutral-400">
                Will propose edits for {repoTargets.length} repo
                {repoTargets.length > 1 ? "s" : ""} — review each before
                anything is committed.
              </p>
              <Button
                type="button"
                className="shrink-0 gap-1.5"
                onClick={() => void handlePlan()}
                disabled={planning || !instruction.trim()}
              >
                {planning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {planning ? "Planning…" : "Plan edits"}
              </Button>
            </div>

            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              {planning && !proposals ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
                  <Loader2 className="size-4 animate-spin" />
                  Reading repos and planning edits…
                </div>
              ) : proposals ? (
                <div className="flex flex-col gap-3">
                  {proposals.map((p) => {
                    const key = `${p.owner}/${p.repo}`;
                    const isApproved = approved.has(key);
                    const isCommitted = committed.has(key);
                    const isExpanded = expanded === key;
                    return (
                      <div
                        key={key}
                        className="overflow-hidden rounded-lg border border-neutral-200"
                      >
                        <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50/60 px-3 py-2">
                          <GitBranch className="size-3.5 shrink-0 text-neutral-400" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-neutral-800">
                            {key}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-neutral-400">
                            {p.branch}
                          </span>
                          {isCommitted ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              <CheckCircle2 className="size-3" />
                              Committed
                            </span>
                          ) : p.error ? (
                            <span className="shrink-0 text-[10px] text-red-500">
                              failed
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleApprove(key)}
                              className={cn(
                                "shrink-0 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                                isApproved
                                  ? "bg-neutral-900 text-white"
                                  : "border border-neutral-200 hover:bg-neutral-100",
                              )}
                            >
                              {isApproved ? "Approved" : "Approve"}
                            </button>
                          )}
                        </div>
                        {p.error ? (
                          <p className="px-3 py-3 text-xs text-red-600">
                            {p.error}
                          </p>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded(isExpanded ? null : key)
                              }
                              className="w-full px-3 py-2 text-left text-xs leading-5 text-neutral-700 hover:bg-neutral-50"
                            >
                              {p.summary || "No proposed changes for this repo."}
                            </button>
                            {isExpanded && p.changes.length > 0 && (
                              <div className="border-t border-neutral-100">
                                {p.changes.map((c) => (
                                  <div
                                    key={c.path}
                                    className="border-b border-neutral-100 last:border-b-0"
                                  >
                                    <p className="flex items-center gap-2 px-3 pt-2 font-mono text-[11px] text-neutral-700">
                                      <span
                                        className={cn(
                                          "shrink-0 rounded px-1 font-mono text-[10px] font-semibold",
                                          c.action === "create"
                                            ? "bg-emerald-50 text-emerald-900"
                                            : c.action === "delete"
                                              ? "bg-red-50 text-red-900"
                                              : "bg-amber-50 text-amber-900",
                                        )}
                                      >
                                        {c.action === "create"
                                          ? "A"
                                          : c.action === "delete"
                                            ? "D"
                                            : "M"}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate">
                                        {c.path}
                                      </span>
                                    </p>
                                    {c.reason && (
                                      <p className="px-3 pt-1 text-[11px] leading-4 text-neutral-500">
                                        {c.reason}
                                      </p>
                                    )}
                                    {c.action !== "delete" && (
                                      <div className="max-h-56 overflow-auto px-3 pb-2 pt-1.5">
                                        <DiffView
                                          lines={diffLines("", c.content)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {isApproved && !isCommitted && (
                              <div className="flex items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50/60 px-3 py-2">
                                <p className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
                                  Committing {p.changes.length} file
                                  {p.changes.length > 1 ? "s" : ""} on {p.branch}.
                                </p>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-7 shrink-0 gap-1 text-[11px]"
                                  disabled={committing === key}
                                  onClick={() => void handleCommitRepo(p)}
                                >
                                  {committing === key ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <Check className="size-3" />
                                  )}
                                  Commit to {p.branch}
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-neutral-200 p-6 text-center">
                  <Sparkles className="mx-auto mb-2 size-5 text-neutral-300" />
                  <p className="text-xs leading-5 text-neutral-400">
                    Describe the change, then plan. Each repo gets a proposal
                    you review — approve the ones you want, and Aria commits
                    each repo's approved edits as its own commit. Nothing is
                    ever applied without your review.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
