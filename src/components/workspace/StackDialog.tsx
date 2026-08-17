import { useCallback, useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import {
  GitBranch,
  GitPullRequest,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";

interface Branch {
  name: string;
  sha: string;
}

/**
 * Stacked PRs in the browser.
 *
 * A stack is a chain of branches: feature/one → feature/two → main. Each
 * branch's PR targets its parent branch, not main, so reviews stay small.
 *
 * This panel computes the stack from real git ancestry (branch A is an
 * ancestor of B when A's tip commit appears in B's history), then gives you
 * the primitives: create a stacked branch off the current one, and open a PR
 * whose base is the parent branch. Rebasing a branch onto its parent's new
 * tip is done in the Local Git dock (interactive rebase + push).
 */
export function StackDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  currentBranch: string;
  defaultBranch: string;
  onOpenLocal: () => void;
}) {
  const { open, onOpenChange, owner, repo, currentBranch, defaultBranch, onOpenLocal } = props;
  const listBranches = useAction(api.githubActions.listBranches);
  const getCommitDetails = useAction(api.githubActions.getCommitDetails);
  const createBranch = useAction(api.githubActions.createBranch);
  const createPullRequest = useAction(api.githubActions.createPullRequest);

  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ancestors, setAncestors] = useState<Record<string, string[]>>({});
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [prTarget, setPrTarget] = useState<string | null>(null); // branch name
  const [prBase, setPrBase] = useState<string | null>(null); // branch name
  const [prBusy, setPrBusy] = useState(false);
  const [prResult, setPrResult] = useState<{ number: number; htmlUrl: string } | null>(null);

  const load = useCallback(async () => {
    if (!open || !owner || !repo) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listBranches({ owner, repo });
      setBranches(data);
      // Compute ancestry: for each branch, walk first-parent history and
      // record every ancestor sha. Memoized per sha so shared history is
      // only fetched once.
      const detailCache = new Map<string, string[]>();
      const getLineage = async (sha: string): Promise<string[]> => {
        const cached = detailCache.get(sha);
        if (cached) return cached;
        detailCache.set(sha, []); // guard against cycles
        const lineage: string[] = [sha];
        try {
          const detail = await getCommitDetails({ owner, repo, sha });
          const parent = detail.parents[0];
          if (parent) {
            lineage.push(...(await getLineage(parent)));
          }
        } catch {
          // shallow boundary / deleted commit — stop this line
        }
        detailCache.set(sha, lineage);
        return lineage;
      };
      const map: Record<string, string[]> = {};
      for (const b of data.slice(0, 40)) {
        try {
          map[b.name] = await getLineage(b.sha);
        } catch {
          map[b.name] = [b.sha];
        }
      }
      setAncestors(map);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [open, owner, repo, listBranches, getCommitDetails]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const rows = useMemo(() => {
    if (!branches) return [];
    const tipOf = (name: string) => branches.find((b) => b.name === name)?.sha ?? "";
    return branches
      .map((branch) => {
        const myLineage = ancestors[branch.name] ?? [branch.sha];
        // A branch P is a parent of B when P's tip is in B's history. The
        // direct parent is the one whose tip sits closest to B's tip.
        const parents = branches
          .filter((p) => p.name !== branch.name)
          .filter((p) => myLineage.includes(tipOf(p.name)))
          .sort(
            (a, b) =>
              myLineage.indexOf(tipOf(a.name)) -
              myLineage.indexOf(tipOf(b.name)),
          );
        const directParent = parents[0]?.name ?? null;
        // Children of B = branches that have B's tip in their history.
        const children = branches.filter(
          (c) =>
            c.name !== branch.name &&
            (ancestors[c.name] ?? []).includes(tipOf(branch.name)),
        );
        return { ...branch, directParent, children };
      })
      .sort((a, b) => {
        const depth = (r: { directParent: string | null }) =>
          r.directParent === null ? 0 : 1;
        if (depth(a) !== depth(b)) return depth(a) - depth(b);
        return a.name.localeCompare(b.name);
      });
  }, [branches, ancestors]);

  const createStacked = async () => {
    const name = newName.trim().replace(/\s+/g, "-");
    if (!name || !prTarget || creating) return;
    setCreating(true);
    try {
      await createBranch({ owner, repo, name, base: prTarget });
      setNewName("");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const openStackedPr = async () => {
    if (!prTarget || !prBase || prBusy) return;
    setPrBusy(true);
    setPrResult(null);
    try {
      const result = await createPullRequest({
        owner,
        repo,
        title: `Stacked: ${prTarget} → ${prBase}`,
        head: prTarget,
        base: prBase,
        body: `Stacked PR from **${prTarget}** into **${prBase}**.

This branch sits on top of ${prBase} — merge ${prBase} first (or review this diff against it) before merging this one.`,
      });
      setPrResult({ number: result.number, htmlUrl: result.htmlUrl });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPrBusy(false);
    }
  };

  const reset = () => {
    setError(null);
    setPrResult(null);
    setPrTarget(null);
    setPrBase(null);
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
          <DialogTitle>Stacked PRs</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-5 text-neutral-400">
          A stack is a chain of branches, each reviewed on top of the
          previous one instead of main. Aria computes the stack from real git
          ancestry — branch A is a parent of B when A's tip appears in B's
          history.
        </p>

        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
            Branches
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}

        <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
          {loading && !branches ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              Reading branch ancestry…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-400">
              No branches found.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {rows.map((row) => (
                <li key={row.name} className="p-3">
                  <div className="flex items-center gap-2">
                    <Layers
                      className={cn(
                        "size-3.5 shrink-0",
                        row.name === currentBranch
                          ? "text-neutral-900"
                          : "text-neutral-300",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate font-mono text-sm",
                        row.name === currentBranch
                          ? "font-semibold text-neutral-900"
                          : "text-neutral-700",
                      )}
                    >
                      {row.name}
                      {row.name === currentBranch && (
                        <span className="ml-2 rounded bg-neutral-900 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-white">
                          current
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-neutral-400">
                      {row.sha.slice(0, 7)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 pl-5">
                    <span className="text-[11px] text-neutral-400">
                      {row.directParent ? (
                        <>
                          base:{" "}
                          <span className="font-mono text-neutral-600">
                            {row.directParent}
                          </span>
                        </>
                      ) : row.name === defaultBranch ? (
                        "default branch"
                      ) : (
                        "no parent detected"
                      )}
                    </span>
                    {row.children.length > 0 && (
                      <span className="text-[11px] text-neutral-300">
                        · {row.children.length} stacked on it
                      </span>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPrTarget(row.name);
                          setPrBase(row.directParent ?? defaultBranch);
                          setPrResult(null);
                        }}
                        className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
                        title={`Open a PR from ${row.name}`}
                      >
                        <GitPullRequest className="size-3" />
                        PR
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPrTarget(row.name);
                          setNewName("");
                          setError(null);
                        }}
                        className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
                        title={`Stack a new branch on ${row.name}`}
                      >
                        <GitBranch className="size-3" />
                        Stack
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {prTarget && (
          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
            <p className="text-xs text-neutral-600">
              Open a PR for{" "}
              <span className="font-mono font-medium text-neutral-900">
                {prTarget}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={prBase ?? ""}
                onChange={(e) => setPrBase(e.target.value)}
                className="h-8 flex-1 rounded-md border border-neutral-200 bg-background px-2 font-mono text-xs text-neutral-800 outline-none focus:border-neutral-400"
                title="Base branch — the parent in the stack"
              >
                {branches?.map((b) => (
                  <option key={b.name} value={b.name}>
                    base: {b.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => void openStackedPr()}
                disabled={prBusy || !prBase}
              >
                {prBusy ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <GitPullRequest className="size-3" />
                )}
                Open PR
              </Button>
            </div>
            {prResult && (
              <a
                href={prResult.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
              >
                <GitPullRequest className="size-3" />
                PR #{prResult.number} opened — view it
              </a>
            )}
          </div>
        )}

        {prTarget && (
          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
            <p className="text-xs text-neutral-600">
              Stack a new branch on{" "}
              <span className="font-mono font-medium text-neutral-900">
                {prTarget}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="feature/next-step"
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-background px-2 font-mono text-xs text-neutral-800 outline-none focus:border-neutral-400"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createStacked();
                }}
              />
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => void createStacked()}
                disabled={creating || !newName.trim()}
              >
                {creating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Plus className="size-3" />
                )}
                Create
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs leading-5 text-neutral-400">
          To rebase a branch onto its parent's updated tip (after the parent
          PR merges), use the{" "}
          <button
            type="button"
            onClick={onOpenLocal}
            className="text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
          >
            Local Git dock
          </button>{" "}
          — rebase locally, then push.
        </p>
      </DialogContent>
    </Dialog>
  );
}
