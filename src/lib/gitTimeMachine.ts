import * as git from "isomorphic-git";
import {
  abortSession,
  cherryPickCommit,
  clearActiveSession,
  cloneRepo,
  getActiveSession,
  mergeBranch,
  readTreeFiles,
  repoCtx,
  startRebase,
  type GitBackend,
  type GitPerson,
} from "./localGit";

export type TimeMachineOperation = "merge" | "rebase" | "cherry-pick" | "revert";

export interface TimeMachineResult {
  operation: TimeMachineOperation;
  safeToAttempt: boolean;
  outcome: "clean" | "conflicts" | "blocked" | "plan";
  summary: string;
  conflicts: string[];
  details: string[];
  shadowOnly: true;
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || "repo";
}

function readonlyBackend(real: GitBackend, realOwner: string, realRepo: string): GitBackend {
  const rewrite = <T extends object>(args: T): T & { owner: string; repo: string } => ({
    ...args,
    owner: realOwner,
    repo: realRepo,
  });
  const refuse = async (): Promise<never> => {
    throw new Error("Time Machine is read-only and cannot write to the remote repository.");
  };
  return {
    listBranches: (args) => real.listBranches(rewrite(args)),
    getCommitDetails: (args) => real.getCommitDetails(rewrite(args)),
    getTree: (args) => real.getTree(rewrite(args)),
    getBlob: (args) => real.getBlob(rewrite(args)),
    getBlobs: (args) => real.getBlobs(rewrite(args)),
    commitChanges: refuse,
    pushCommits: refuse,
    beginBlobUpload: refuse,
    uploadBlobChunk: refuse,
  };
}

async function removeTree(pathOwner: string, pathRepo: string): Promise<void> {
  try {
    const { pfs, dir } = await repoCtx(pathOwner, pathRepo);
    const walk = async (path: string): Promise<void> => {
      let names: string[];
      try {
        names = await pfs.readdir(path);
      } catch {
        return;
      }
      for (const name of names) {
        const child = `${path}/${name}`;
        try {
          const stat = await pfs.stat(child);
          if (stat.isDirectory()) {
            await walk(child);
            await pfs.rmdir(child).catch(() => {});
          } else {
            await pfs.unlink(child).catch(() => {});
          }
        } catch {
          // Best-effort cleanup of an isolated shadow only.
        }
      }
    };
    await walk(dir);
    await pfs.rmdir(dir).catch(() => {});
  } catch {
    // An absent shadow is already clean.
  }
}

async function materializeBranch(owner: string, repo: string, branch: string): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  let oid: string;
  try {
    oid = await git.resolveRef({ fs, dir, gitdir, ref: `refs/remotes/origin/${branch}` });
  } catch {
    throw new Error(`Branch ${branch} is not present in the shadow clone.`);
  }
  await git.writeRef({ fs, dir, gitdir, ref: `refs/heads/${branch}`, value: oid, force: true });
}

async function currentHead(owner: string, repo: string): Promise<string> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  return git.resolveRef({ fs, dir, gitdir, ref: "HEAD" });
}

async function changedPathsBetween(owner: string, repo: string, a: string, b: string): Promise<string[]> {
  const [aTree, bTree] = await Promise.all([
    readTreeFiles(owner, repo, a),
    readTreeFiles(owner, repo, b),
  ]);
  const paths = new Set([...aTree.keys(), ...bTree.keys()]);
  return [...paths].filter((path) => {
    const left = aTree.get(path);
    const right = bTree.get(path);
    return left?.oid !== right?.oid || left?.mode !== right?.mode;
  }).sort();
}

async function simulateRevert(
  backend: GitBackend,
  realOwner: string,
  realRepo: string,
  shadowOwner: string,
  shadowRepo: string,
  oid: string,
): Promise<TimeMachineResult> {
  const detail = await backend.getCommitDetails({ owner: realOwner, repo: realRepo, sha: oid });
  const parent = detail.parents[0];
  if (!parent) {
    return {
      operation: "revert",
      safeToAttempt: false,
      outcome: "blocked",
      summary: "Root commits are not simulated as automatic reverts.",
      conflicts: [],
      details: ["A root commit has no parent tree to restore."],
      shadowOnly: true,
    };
  }
  const current = await currentHead(shadowOwner, shadowRepo);
  const [parentDetail, currentDetail] = await Promise.all([
    backend.getCommitDetails({ owner: realOwner, repo: realRepo, sha: parent }),
    backend.getCommitDetails({ owner: realOwner, repo: realRepo, sha: current }),
  ]);
  if (!detail.treeSha || !parentDetail.treeSha || !currentDetail.treeSha) {
    throw new Error("Time Machine could not resolve the commit trees required for revert analysis.");
  }
  const [before, target, now] = await Promise.all([
    readTreeFiles(shadowOwner, shadowRepo, parentDetail.treeSha),
    readTreeFiles(shadowOwner, shadowRepo, detail.treeSha),
    readTreeFiles(shadowOwner, shadowRepo, currentDetail.treeSha),
  ]);
  const paths = new Set([...before.keys(), ...target.keys()]);
  const touched = [...paths].filter((path) => {
    const a = before.get(path);
    const b = target.get(path);
    return a?.oid !== b?.oid || a?.mode !== b?.mode;
  });
  const conflicts = touched.filter((path) => {
    const targetEntry = target.get(path);
    const currentEntry = now.get(path);
    return targetEntry?.oid !== currentEntry?.oid || targetEntry?.mode !== currentEntry?.mode;
  });
  return {
    operation: "revert",
    safeToAttempt: conflicts.length === 0,
    outcome: conflicts.length ? "conflicts" : "clean",
    summary: conflicts.length
      ? `Revert would overlap ${conflicts.length} path(s) changed since the target commit.`
      : `Revert is structurally clean across ${touched.length} affected path(s).`,
    conflicts: conflicts.sort(),
    details: [`target: ${oid}`, `parent: ${parent}`, `${touched.length} path(s) changed by target commit`],
    shadowOnly: true,
  };
}

export async function simulateGitOperation(input: {
  backend: GitBackend;
  owner: string;
  repo: string;
  branch: string;
  operation: TimeMachineOperation;
  target: string;
  author: GitPerson;
  depth?: number;
  onProgress?: (phase: string, done: number, total: number) => void;
}): Promise<TimeMachineResult> {
  if (getActiveSession()) {
    return {
      operation: input.operation,
      safeToAttempt: false,
      outcome: "blocked",
      summary: "Time Machine is blocked while a real local Git conflict session is active.",
      conflicts: [],
      details: ["Resolve or abort the existing merge/rebase/cherry-pick before simulating another operation."],
      shadowOnly: true,
    };
  }

  const shadowOwner = `__aria_time_machine__${slug(input.owner)}`;
  const shadowRepo = `${slug(input.repo)}-${slug(input.branch)}`;
  const backend = readonlyBackend(input.backend, input.owner, input.repo);
  await removeTree(shadowOwner, shadowRepo);

  try {
    await cloneRepo(backend, {
      owner: shadowOwner,
      repo: shadowRepo,
      branch: input.branch,
      depth: Math.max(10, Math.min(input.depth ?? 50, 100)),
      author: input.author,
      onProgress: (p) => input.onProgress?.(p.phase, p.done, p.total),
    });

    if (input.operation === "merge") {
      await materializeBranch(shadowOwner, shadowRepo, input.target);
      const outcome = await mergeBranch(backend, {
        owner: shadowOwner,
        repo: shadowRepo,
        theirs: input.target,
        message: `[simulation] merge ${input.target}`,
        author: input.author,
        onProgress: (done, total) => input.onProgress?.("merge", done, total),
      });
      if (outcome.type === "conflicts") {
        const conflicts = outcome.files.map((f) => f.path).sort();
        return {
          operation: "merge",
          safeToAttempt: false,
          outcome: "conflicts",
          summary: `Merge simulation found ${conflicts.length} conflict(s).`,
          conflicts,
          details: ["No real branch, working tree, or remote ref was modified."],
          shadowOnly: true,
        };
      }
      return {
        operation: "merge",
        safeToAttempt: true,
        outcome: "clean",
        summary: outcome.alreadyMerged
          ? "Target is already merged."
          : outcome.fastForward
            ? "Merge can fast-forward cleanly."
            : "Merge produces a clean merge result.",
        conflicts: [],
        details: [outcome.oid ? `simulated result: ${outcome.oid}` : "clean merge", "shadow clone only"],
        shadowOnly: true,
      };
    }

    if (input.operation === "rebase") {
      await materializeBranch(shadowOwner, shadowRepo, input.target);
      const plan = await startRebase({ owner: shadowOwner, repo: shadowRepo, base: input.target });
      return {
        operation: "rebase",
        safeToAttempt: true,
        outcome: "plan",
        summary: `Rebase plan contains ${plan.todos.length} commit(s) to replay.`,
        conflicts: [],
        details: [
          `base: ${input.target}`,
          `${plan.todos.length} replay commit(s)`,
          `${plan.autoDroppedMerges} merge commit(s) auto-dropped from replay`,
          "Plan generation is read-only; no real branch changed.",
        ],
        shadowOnly: true,
      };
    }

    if (input.operation === "cherry-pick") {
      const outcome = await cherryPickCommit(backend, {
        owner: shadowOwner,
        repo: shadowRepo,
        oid: input.target,
      });
      if (outcome.conflict) {
        const conflicts = outcome.files.map((f) => f.path).sort();
        return {
          operation: "cherry-pick",
          safeToAttempt: false,
          outcome: "conflicts",
          summary: `Cherry-pick simulation found ${conflicts.length} conflict(s).`,
          conflicts,
          details: ["shadow clone only"],
          shadowOnly: true,
        };
      }
      return {
        operation: "cherry-pick",
        safeToAttempt: true,
        outcome: "clean",
        summary: "Cherry-pick applies cleanly in the shadow repository.",
        conflicts: [],
        details: [outcome.oid ? `simulated commit: ${outcome.oid}` : "commit already represented", "shadow clone only"],
        shadowOnly: true,
      };
    }

    return await simulateRevert(
      backend,
      input.owner,
      input.repo,
      shadowOwner,
      shadowRepo,
      input.target,
    );
  } finally {
    // A simulation may create localGit's global conflict session. It belongs
    // to the shadow repository only, but must never leak into the real dock.
    if (getActiveSession()) {
      await abortSession({ owner: shadowOwner, repo: shadowRepo }).catch(() => clearActiveSession());
    }
    await removeTree(shadowOwner, shadowRepo);
  }
}
