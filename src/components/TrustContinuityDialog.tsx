import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { WorkspaceViewProps } from "@/components/workspace/types";
import { errorMessage, ownerOf, repoNameOf } from "@/lib/github";
import { offlineStorageDurable } from "@/lib/offlineBuffer";
import { simulateGitOperation, type TimeMachineOperation, type TimeMachineResult } from "@/lib/gitTimeMachine";
import {
  CAPSULE_PREFIX,
  analyzeBlastRadius,
  approvalFirewall,
  buildDecisionGraph,
  buildHealthTimeline,
  buildProofReport,
  buildReleaseReadiness,
  buildRescuePlan,
  decodeCapsule,
  encodeCapsule,
  type BlastRadius,
  type WorkCapsule,
} from "@/lib/trustContinuity";
import type { GitBackend } from "@/lib/localGit";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  Archive,
  CheckCircle2,
  ClipboardCheck,
  GitCompareArrows,
  History,
  Loader2,
  Network,
  Radar,
  RefreshCw,
  ShieldCheck,
  Siren,
  WifiOff,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Tab =
  | "proof"
  | "firewall"
  | "capsules"
  | "blast"
  | "time"
  | "offline"
  | "decisions"
  | "release"
  | "rescue"
  | "health";

type TrustProps = Pick<
  WorkspaceViewProps,
  | "selectedRepo"
  | "currentBranch"
  | "path"
  | "openFile"
  | "dirty"
  | "editorContent"
  | "viewMode"
  | "focusMode"
  | "aiHistory"
  | "staged"
  | "checks"
  | "deployment"
  | "deploymentError"
  | "offline"
  | "lastCommit"
  | "branches"
  | "connection"
  | "loadChecks"
  | "loadDeployment"
>;

function levelClass(level: string): string {
  if (level === "critical" || level === "blocked" || level === "failure") return "text-red-700 bg-red-50 border-red-200";
  if (level === "high" || level === "needs_review" || level === "warning") return "text-amber-800 bg-amber-50 border-amber-200";
  if (level === "medium" || level === "partially_verified") return "text-yellow-800 bg-yellow-50 border-yellow-200";
  return "text-emerald-700 bg-emerald-50 border-emerald-200";
}

function Pill({ children, level }: { children: React.ReactNode; level: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${levelClass(level)}`}>{children}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

export function TrustContinuityDialog({
  open,
  onOpenChange,
  ...props
}: TrustProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("proof");
  const fullName = props.selectedRepo?.fullName ?? "";
  const branch = props.currentBranch ?? "";
  const owner = fullName ? ownerOf(fullName) : "";
  const repo = fullName ? repoNameOf(fullName) : "";

  const audit = useQuery(api.securityCenter.listAuditLogs) ?? [];
  const flights = useQuery(api.securityCenter.listFlightRecords) ?? [];
  const findings = useQuery(
    api.securityCenter.listSecurityFindings,
    fullName ? { repo: fullName } : "skip",
  ) ?? [];
  const memories = useQuery(
    api.securityCenter.listMemory,
    fullName ? { repo: fullName } : "skip",
  ) ?? [];
  const missions = useQuery(
    api.securityCenter.listMissions,
    fullName ? { repo: fullName } : "skip",
  ) ?? [];
  const repoHealth = useQuery(
    api.securityCenter.getRepoHealth,
    fullName ? { repo: fullName } : "skip",
  );
  const createMemory = useMutation(api.securityCenter.createMemory);
  const deleteMemory = useMutation(api.securityCenter.deleteMemory);
  const searchCode = useAction(api.githubActions.searchCode);

  const listBranches = useAction(api.githubActions.listBranches);
  const getCommitDetails = useAction(api.githubActions.getCommitDetails);
  const getTree = useAction(api.githubActions.getTree);
  const getBlob = useAction(api.githubActions.getBlob);
  const getBlobs = useAction(api.githubActions.getBlobs);

  const backend: GitBackend = useMemo(
    () => ({
      listBranches: (args) => listBranches(args),
      getCommitDetails: (args) => getCommitDetails(args),
      getTree: (args) => getTree(args),
      getBlob: (args) => getBlob(args),
      getBlobs: (args) => getBlobs(args),
      commitChanges: async () => { throw new Error("Trust Center simulation backend is read-only."); },
      pushCommits: async () => { throw new Error("Trust Center simulation backend is read-only."); },
      beginBlobUpload: async () => { throw new Error("Trust Center simulation backend cannot upload blobs."); },
      uploadBlobChunk: async () => { throw new Error("Trust Center simulation backend cannot upload blobs."); },
    }),
    [listBranches, getCommitDetails, getTree, getBlob, getBlobs],
  );

  const currentChanges = useMemo(() => {
    if (props.staged.length > 0) {
      return props.staged.map((f) => ({ path: f.path, action: f.action, content: f.content }));
    }
    if (props.openFile && props.dirty) {
      return [{ path: props.openFile.path, action: "update" as const, content: props.editorContent }];
    }
    return [];
  }, [props.staged, props.openFile, props.dirty, props.editorContent]);

  const firewall = useMemo(
    () => approvalFirewall({
      files: currentChanges,
      operation: "commit",
      branch,
      defaultBranch: props.selectedRepo?.defaultBranch ?? null,
    }),
    [currentChanges, branch, props.selectedRepo?.defaultBranch],
  );

  const repoAudit = useMemo(() => audit.filter((a) => !a.repo || a.repo === fullName), [audit, fullName]);
  const repoFlights = useMemo(() => flights.filter((f) => !f.repo || f.repo === fullName), [flights, fullName]);

  const proof = useMemo(
    () => buildProofReport({
      repo: fullName,
      branch,
      commit: props.lastCommit?.sha ?? props.checks?.sha ?? null,
      changedFiles: currentChanges.map((f) => f.path),
      ci: props.checks
        ? {
            overall: props.checks.overall,
            sha: props.checks.sha,
            names: [
              ...props.checks.checkRuns.map((c) => `${c.name}: ${c.conclusion ?? c.status}`),
              ...props.checks.statusContexts.map((c) => `${c.context}: ${c.state}`),
            ],
          }
        : null,
      deployment: props.deployment
        ? {
            state: props.deployment.state,
            environment: props.deployment.environment,
            targetUrl: props.deployment.targetUrl,
          }
        : null,
      offlinePending: props.offline.pending,
      auditEvidence: repoAudit.slice(0, 6).map((a) => `${a.action}${a.result ? ` · ${a.result}` : ""}`),
      flightEvidence: repoFlights.slice(0, 4).map((f) => `${f.request} · ${f.result}`),
    }),
    [fullName, branch, props.lastCommit?.sha, props.checks, props.deployment, props.offline.pending, currentChanges, repoAudit, repoFlights],
  );

  const highFindings = findings.filter((f) => f.severity === "high").length;
  const release = useMemo(
    () => buildReleaseReadiness({
      proof,
      risk: approvalFirewall({
        files: currentChanges,
        operation: "deploy",
        branch,
        defaultBranch: props.selectedRepo?.defaultBranch ?? null,
      }),
      highSecurityFindings: highFindings,
      deploymentState: props.deployment?.state ?? null,
    }),
    [proof, currentChanges, branch, props.selectedRepo?.defaultBranch, highFindings, props.deployment?.state],
  );

  const graph = useMemo(
    () => buildDecisionGraph({
      audit: repoAudit.map((a) => ({ action: a.action, result: a.result, detail: a.detail, createdAt: a.createdAt })),
      flights: repoFlights.map((f) => ({
        request: f.request,
        planSummary: f.planSummary,
        filesModified: f.filesModified,
        tests: f.tests,
        approvals: f.approvals,
        result: f.result,
        createdAt: f.createdAt,
      })),
    }),
    [repoAudit, repoFlights],
  );

  const timeline = useMemo(
    () => buildHealthTimeline({
      audit: repoAudit.map((a) => ({ action: a.action, result: a.result, detail: a.detail, createdAt: a.createdAt })),
      findings: findings.map((f) => ({ severity: f.severity, title: f.title, createdAt: f.createdAt })),
    }),
    [repoAudit, findings],
  );

  const failedChecks = useMemo(() => {
    if (!props.checks) return [];
    return [
      ...props.checks.checkRuns.filter((c) => c.conclusion && c.conclusion !== "success" && c.conclusion !== "neutral" && c.conclusion !== "skipped").map((c) => `${c.name}: ${c.conclusion}`),
      ...props.checks.statusContexts.filter((c) => c.state === "failure" || c.state === "error").map((c) => `${c.context}: ${c.state}`),
    ];
  }, [props.checks]);

  const rescue = useMemo(
    () => buildRescuePlan({
      failedChecks,
      deploymentError: props.deploymentError,
      changedFiles: currentChanges.map((f) => f.path),
      lastKnownGood: props.checks?.overall === "success" ? props.checks.sha : null,
    }),
    [failedChecks, props.deploymentError, currentChanges, props.checks],
  );

  const capsules = useMemo(
    () => memories
      .filter((m) => m.title.startsWith(CAPSULE_PREFIX))
      .map((m) => ({ memory: m, capsule: decodeCapsule(m.body) }))
      .filter((x): x is { memory: (typeof memories)[number]; capsule: WorkCapsule } => x.capsule !== null),
    [memories],
  );

  const [capsuleName, setCapsuleName] = useState("");
  const [capsuleBusy, setCapsuleBusy] = useState(false);
  const saveCapsule = async () => {
    if (!fullName || !branch) return;
    const name = capsuleName.trim() || `${repo} · ${branch}`;
    const capsule: WorkCapsule = {
      version: 1,
      name,
      repo: fullName,
      branch,
      path: props.path,
      openPath: props.openFile?.path ?? null,
      viewMode: props.viewMode,
      focusMode: props.focusMode,
      aiContext: props.aiHistory.slice(-4).map((t) => `${t.role}: ${t.content.slice(0, 180)}`),
      createdAt: Date.now(),
    };
    setCapsuleBusy(true);
    try {
      await createMemory({ repo: fullName, title: `${CAPSULE_PREFIX}${name}`.slice(0, 120), body: encodeCapsule(capsule) });
      setCapsuleName("");
      toast.success("Work Capsule saved across devices.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCapsuleBusy(false);
    }
  };

  const restoreCapsule = (capsule: WorkCapsule) => {
    try {
      sessionStorage.setItem("aria:restore-capsule", JSON.stringify(capsule));
    } catch {
      // Deep-link restore still works without sessionStorage; layout may use defaults.
    }
    const query = new URLSearchParams({ repo: capsule.repo, branch: capsule.branch });
    if (capsule.openPath) query.set("path", capsule.openPath);
    window.location.assign(`/dashboard?${query.toString()}`);
  };

  const [blast, setBlast] = useState<BlastRadius | null>(null);
  const [blastBusy, setBlastBusy] = useState(false);
  const runBlastRadius = async () => {
    if (!fullName || currentChanges.length === 0) return;
    setBlastBusy(true);
    try {
      const references = new Set<string>();
      for (const file of currentChanges.slice(0, 5)) {
        const basename = file.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
        if (basename.length < 3) continue;
        const results = await searchCode({ owner, repo, query: basename });
        for (const hit of results.slice(0, 20)) references.add(hit.path);
      }
      setBlast(analyzeBlastRadius({ files: currentChanges, referencePaths: [...references] }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBlastBusy(false);
    }
  };

  const [timeOperation, setTimeOperation] = useState<TimeMachineOperation>("merge");
  const [timeTarget, setTimeTarget] = useState("");
  const [timeResult, setTimeResult] = useState<TimeMachineResult | null>(null);
  const [timeBusy, setTimeBusy] = useState(false);
  const [timeProgress, setTimeProgress] = useState("");
  const runTimeMachine = async () => {
    if (!owner || !repo || !branch || !timeTarget.trim()) return;
    setTimeBusy(true);
    setTimeResult(null);
    try {
      const result = await simulateGitOperation({
        backend,
        owner,
        repo,
        branch,
        operation: timeOperation,
        target: timeTarget.trim(),
        author: {
          name: props.connection.name ?? props.connection.login ?? "Aria",
          email: props.connection.login ? `${props.connection.login}@users.noreply.github.com` : "aria@users.noreply.github.com",
          date: null,
        },
        depth: 60,
        onProgress: (phase, done, total) => setTimeProgress(`${phase}${total >= 0 ? ` ${done}/${total}` : ` ${done}`}`),
      });
      setTimeResult(result);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTimeBusy(false);
      setTimeProgress("");
    }
  };

  const copyProof = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(proof, null, 2));
      toast.success("Proof bundle copied.");
    } catch {
      toast.error("Clipboard access is unavailable.");
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "proof", label: "Proof", icon: <ClipboardCheck className="size-3.5" /> },
    { id: "firewall", label: "Firewall", icon: <ShieldCheck className="size-3.5" /> },
    { id: "capsules", label: "Capsules", icon: <Archive className="size-3.5" /> },
    { id: "blast", label: "Blast", icon: <Radar className="size-3.5" /> },
    { id: "time", label: "Time Machine", icon: <History className="size-3.5" /> },
    { id: "offline", label: "Offline", icon: <WifiOff className="size-3.5" /> },
    { id: "decisions", label: "Decisions", icon: <Network className="size-3.5" /> },
    { id: "release", label: "Release", icon: <CheckCircle2 className="size-3.5" /> },
    { id: "rescue", label: "Rescue", icon: <Siren className="size-3.5" /> },
    { id: "health", label: "Health", icon: <Activity className="size-3.5" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-neutral-200 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" /> Trust & Continuity Center
          </DialogTitle>
          <p className="text-xs text-neutral-500">Evidence-first engineering controls for {fullName || "the current repository"}{branch ? ` · ${branch}` : ""}. Nothing here silently writes to GitHub.</p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-200 p-2 md:w-40 md:flex-col md:border-b-0 md:border-r">
            {tabs.map((item) => (
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${tab === item.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                {item.icon}{item.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50 p-4">
            {tab === "proof" && (
              <div className="space-y-3">
                <Section title="Proof Mode">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Pill level={proof.verdict}>{proof.verdict.replace("_", " ")}</Pill>
                    <span className="text-xs text-neutral-500">confidence: {proof.confidence}</span>
                    <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={copyProof}>Copy evidence JSON</Button>
                  </div>
                  <div className="space-y-2">
                    {proof.claims.map((claim) => (
                      <div key={claim.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-2.5">
                        <div className="flex items-center gap-2"><Pill level={claim.state}>{claim.state}</Pill><span className="text-sm font-medium">{claim.label}</span></div>
                        <ul className="mt-1.5 list-disc pl-5 text-xs text-neutral-600">{claim.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                      </div>
                    ))}
                  </div>
                  {proof.unresolved.length > 0 && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Unresolved: {proof.unresolved.join(" · ")}</div>}
                </Section>
              </div>
            )}

            {tab === "firewall" && (
              <div className="space-y-3">
                <Section title="Approval Firewall">
                  <div className="flex items-center gap-2"><Pill level={firewall.level}>{firewall.level} risk</Pill><span className="text-xs text-neutral-500">score {firewall.score}</span></div>
                  <p className="mt-2 text-sm text-neutral-700">{firewall.requiresIndependentApproval ? "Independent approval is required before a critical operation should proceed." : firewall.requiresHumanApproval ? "Explicit human approval is required before the operation should proceed." : "The current change does not require an extra approval beyond Aria's existing server-side gates."}</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div><p className="text-xs font-medium text-neutral-500">Reasons</p><ul className="mt-1 list-disc pl-5 text-xs text-neutral-700">{firewall.reasons.length ? firewall.reasons.map((r, i) => <li key={i}>{r}</li>) : <li>No elevated-risk indicators detected.</li>}</ul></div>
                    <div><p className="text-xs font-medium text-neutral-500">Sensitive areas</p><p className="mt-1 text-xs text-neutral-700">{firewall.sensitiveAreas.join(", ") || "none detected"}</p></div>
                  </div>
                  <p className="mt-3 text-[11px] text-neutral-500">This is an additional client-side safety layer. Existing constitution rules and organization approval policies remain enforced server-side.</p>
                </Section>
              </div>
            )}

            {tab === "capsules" && (
              <div className="space-y-3">
                <Section title="Work Capsules">
                  <div className="flex gap-2"><Input value={capsuleName} onChange={(e) => setCapsuleName(e.target.value)} placeholder="Name this working state" /><Button onClick={saveCapsule} disabled={capsuleBusy || !fullName}>{capsuleBusy ? <Loader2 className="size-4 animate-spin" /> : "Save capsule"}</Button></div>
                  <p className="mt-2 text-[11px] text-neutral-500">Capsules store bounded metadata only. File contents remain in the existing draft vault; the server rejects secret-shaped project memory.</p>
                </Section>
                <Section title="Saved across devices">
                  <div className="space-y-2">
                    {capsules.length === 0 && <p className="text-xs text-neutral-500">No Work Capsules yet.</p>}
                    {capsules.map(({ memory, capsule }) => (
                      <div key={String(memory._id)} className="flex items-center gap-2 rounded-md border border-neutral-200 p-2.5">
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{capsule.name}</p><p className="truncate text-xs text-neutral-500">{capsule.repo} · {capsule.branch}{capsule.openPath ? ` · ${capsule.openPath}` : ""}</p></div>
                        <Button size="sm" variant="outline" onClick={() => restoreCapsule(capsule)}>Resume</Button>
                        <Button size="sm" variant="ghost" onClick={() => void deleteMemory({ id: memory._id }).catch((e) => toast.error(errorMessage(e)))}>Delete</Button>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            )}

            {tab === "blast" && (
              <div className="space-y-3">
                <Section title="Pre-Merge Blast Radius">
                  <div className="flex items-center gap-2"><Button onClick={runBlastRadius} disabled={blastBusy || currentChanges.length === 0}>{blastBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <GitCompareArrows className="mr-2 size-4" />}Analyze references</Button><span className="text-xs text-neutral-500">bounded code search; read-only</span></div>
                  {currentChanges.length === 0 && <p className="mt-2 text-xs text-neutral-500">Stage or edit a file to create a blast-radius analysis.</p>}
                </Section>
                {blast && <Section title="Impact model"><div className="flex gap-2"><Pill level={blast.level}>{blast.level}</Pill><span className="text-xs text-neutral-500">score {blast.score} · {blast.referencedBy.length} reference path(s)</span></div><p className="mt-2 text-xs text-neutral-700">Areas: {blast.affectedAreas.join(", ") || "localized source change"}</p><ul className="mt-2 list-disc pl-5 text-xs text-neutral-700">{blast.recommendedVerification.map((v, i) => <li key={i}>{v}</li>)}</ul>{blast.referencedBy.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-600">Referenced paths</summary><div className="mt-1 font-mono text-[11px] text-neutral-600">{blast.referencedBy.slice(0, 30).join("\n")}</div></details>}</Section>}
              </div>
            )}

            {tab === "time" && (
              <div className="space-y-3">
                <Section title="Git Time Machine">
                  <div className="grid gap-2 md:grid-cols-[160px_1fr_auto]">
                    <select value={timeOperation} onChange={(e) => setTimeOperation(e.target.value as TimeMachineOperation)} className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"><option value="merge">Merge</option><option value="rebase">Rebase plan</option><option value="cherry-pick">Cherry-pick</option><option value="revert">Revert</option></select>
                    <Input value={timeTarget} onChange={(e) => setTimeTarget(e.target.value)} placeholder={timeOperation === "merge" || timeOperation === "rebase" ? "target branch" : "commit SHA"} />
                    <Button onClick={runTimeMachine} disabled={timeBusy || !timeTarget.trim()}>{timeBusy ? <Loader2 className="size-4 animate-spin" /> : "Simulate"}</Button>
                  </div>
                  {timeProgress && <p className="mt-2 text-xs text-neutral-500">{timeProgress}</p>}
                  <p className="mt-2 text-[11px] text-neutral-500">Simulation clones into an isolated shadow LightningFS repository. Remote write methods are disabled and the shadow is discarded afterward.</p>
                </Section>
                {timeResult && <Section title="Simulation result"><div className="flex gap-2"><Pill level={timeResult.safeToAttempt ? "low" : "blocked"}>{timeResult.outcome}</Pill><span className="text-sm font-medium">{timeResult.summary}</span></div>{timeResult.conflicts.length > 0 && <p className="mt-2 font-mono text-xs text-red-700">{timeResult.conflicts.join("\n")}</p>}<ul className="mt-2 list-disc pl-5 text-xs text-neutral-600">{timeResult.details.map((d, i) => <li key={i}>{d}</li>)}</ul></Section>}
              </div>
            )}

            {tab === "offline" && (
              <div className="space-y-3">
                <Section title="Offline Development Queue">
                  <div className="flex flex-wrap gap-2"><Pill level={props.offline.pending > 0 ? "warning" : "low"}>{props.offline.pending} pending</Pill><Pill level={props.offline.online ? "low" : "warning"}>{props.offline.online ? "online" : "offline"}</Pill><Pill level={offlineStorageDurable() ? "low" : "warning"}>{offlineStorageDurable() ? "durable local storage" : "memory-only fallback"}</Pill></div>
                  <p className="mt-3 text-sm text-neutral-700">Drafts and already-approved commit payloads reconcile through Aria's existing recency/conflict-safe queue. Merge, rebase, deploy and other high-impact actions are deliberately <strong>not</strong> auto-queued for later execution.</p>
                  <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-600">{props.offline.syncing ? "Reconciliation is running…" : props.offline.pending ? "Pending work stays queued until connectivity returns and the normal server-side gates accept it." : "No offline work is waiting to sync."}</div>
                </Section>
              </div>
            )}

            {tab === "decisions" && (
              <div className="space-y-3"><Section title="Engineering Decision Graph"><p className="mb-2 text-xs text-neutral-500">Derived from Aria's existing flight recorder and audit trail; it does not invent missing decisions.</p><div className="space-y-1.5">{graph.nodes.length === 0 && <p className="text-xs text-neutral-500">No recorded engineering decisions for this repository yet.</p>}{graph.nodes.slice(-30).map((node, i) => <div key={node.id} className="flex gap-2"><div className="mt-1.5 size-2 shrink-0 rounded-full bg-neutral-400" /><div className="min-w-0"><p className="text-[11px] uppercase text-neutral-400">{node.type} · {new Date(node.at).toLocaleString()}</p><p className="break-words text-xs text-neutral-700">{node.label}</p>{i < graph.nodes.slice(-30).length - 1 && <div className="ml-0.5 h-3 border-l border-neutral-200" />}</div></div>)}</div></Section></div>
            )}

            {tab === "release" && (
              <div className="space-y-3">
                <Section title="Release Cockpit"><div className="flex flex-wrap items-center gap-2"><Pill level={release.state}>{release.state.replace("_", " ")}</Pill><span className="text-sm font-medium">Readiness {release.score}/100</span><Button size="sm" variant="outline" className="ml-auto" onClick={() => { props.loadChecks(); props.loadDeployment(); }}><RefreshCw className="mr-1.5 size-3.5" />Refresh evidence</Button></div><div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="text-xs font-medium text-neutral-500">Blockers</p><ul className="mt-1 list-disc pl-5 text-xs text-red-700">{release.blockers.length ? release.blockers.map((x, i) => <li key={i}>{x}</li>) : <li className="text-neutral-500">none</li>}</ul></div><div><p className="text-xs font-medium text-neutral-500">Warnings / approvals</p><ul className="mt-1 list-disc pl-5 text-xs text-amber-800">{release.warnings.length ? release.warnings.map((x, i) => <li key={i}>{x}</li>) : <li className="text-neutral-500">none</li>}</ul></div></div><p className="mt-3 text-[11px] text-neutral-500">The cockpit does not expose a blind “Ship” button. Existing deployment and approval paths remain authoritative; this view tells you whether evidence supports proceeding.</p></Section>
              </div>
            )}

            {tab === "rescue" && (
              <div className="space-y-3"><Section title="Aria Rescue Mode"><p className="mb-3 text-xs text-neutral-500">Evidence-ranked recovery hypotheses. Rescue Mode prepares reversible actions; it never patches production or bypasses CI.</p><div className="space-y-2">{rescue.map((step) => <div key={step.rank} className="rounded-md border border-neutral-200 bg-neutral-50 p-2.5"><p className="text-sm font-medium">#{step.rank} {step.hypothesis}</p><p className="mt-1 text-xs text-neutral-600">Evidence: {step.evidence.join(" · ")}</p><p className="mt-1 text-xs text-neutral-700"><strong>Reversible next step:</strong> {step.reversibleAction}</p></div>)}</div></Section></div>
            )}

            {tab === "health" && (
              <div className="space-y-3">
                <Section title="Repository Health Timeline"><div className="flex flex-wrap gap-2">{repoHealth ? Object.entries(repoHealth.scores).map(([key, value]) => <Pill key={key} level={Number(value) >= 80 ? "low" : Number(value) >= 60 ? "medium" : "high"}>{key}: {String(value)}</Pill>) : <span className="text-xs text-neutral-500">No repository health snapshot yet.</span>}<span className="text-xs text-neutral-500">{missions.length} mission(s) recorded</span></div></Section>
                <Section title="Recent health events"><div className="space-y-2">{timeline.length === 0 && <p className="text-xs text-neutral-500">No health events recorded yet.</p>}{timeline.map((event, i) => <div key={`${event.at}-${i}`} className="flex items-start gap-2"><Pill level={event.kind}>{event.kind}</Pill><div><p className="text-xs text-neutral-700">{event.label}</p><p className="text-[10px] text-neutral-400">{new Date(event.at).toLocaleString()}</p></div></div>)}</div></Section>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
