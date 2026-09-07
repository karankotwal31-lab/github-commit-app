import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { errorMessage } from "@/lib/github";
import { cn } from "@/lib/utils";
import {
  Activity,
  Bot,
  BookOpen,
  CheckCircle2,
  FileText,
  Globe,
  GitBranch,
  History,
  Loader2,
  Lock,
  Mail,
  MonitorSmartphone,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Target,
  X,
  Zap,
} from "lucide-react";

type Tab =
  | "overview"
  | "security"
  | "dependencies"
  | "rules"
  | "memory"
  | "docs"
  | "missions"
  | "flight"
  | "sessions";

const TABS: Array<[Tab, string, typeof ShieldCheck]> = [
  ["overview", "Health", Activity],
  ["security", "Security", ShieldAlert],
  ["dependencies", "Dependencies", Zap],
  ["rules", "Rules", BookOpen],
  ["memory", "Memory", ScrollText],
  ["docs", "Docs", FileText],
  ["missions", "Missions", Target],
  ["flight", "Flight & audit", History],
  ["sessions", "Sessions", MonitorSmartphone],
];

interface SecurityFinding {
  _id: Id<"securityFindings">;
  kind: string;
  repo: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  evidence: string;
  file: string | null;
  remediation: string;
  createdAt: number;
}

interface DepReport {
  _id: Id<"dependencyReports">;
  repo: string;
  package: string;
  installed: string | null;
  latest: string | null;
  status:
    | "vulnerable"
    | "outdated_major"
    | "outdated_minor"
    | "current"
    | "unknown";
  majorDiff: number;
  fixedVersion: string | null;
  createdAt: number;
}

interface Mission {
  _id: Id<"missions">;
  repo: string;
  branch: string;
  title: string;
  objective: string;
  status: "active" | "awaiting_review" | "done" | "cancelled";
  tasks: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "done" | "blocked";
    detail?: string;
  }>;
  agents: Array<{
    role: string;
    permission: string;
    status: "idle" | "running" | "done" | "blocked";
    objective: string;
    files: string[];
    result?: string;
  }>;
  approvals: Array<{ by: string; at: number; kind: string; note?: string }>;
  updatedAt: number;
  createdAt: number;
}

const SEVERITY_STYLE: Record<SecurityFinding["severity"], string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-neutral-50 text-neutral-600 border-neutral-200",
};

function SeverityBadge({ severity }: { severity: SecurityFinding["severity"] }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        SEVERITY_STYLE[severity],
      )}
    >
      {severity}
    </span>
  );
}

const DEP_STATUS_STYLE: Record<DepReport["status"], string> = {
  vulnerable: "text-red-600",
  outdated_major: "text-amber-600",
  outdated_minor: "text-sky-600",
  current: "text-emerald-600",
  unknown: "text-neutral-400",
};

const ROLE_LABEL: Record<string, string> = {
  analyst: "Analyst",
  security: "Security agent",
  coding: "Coding agent",
  test: "Test agent",
  reviewer: "Reviewer",
};

const AGENT_STATUS_STYLE: Record<Mission["agents"][number]["status"], string> = {
  idle: "bg-neutral-100 text-neutral-500",
  running: "bg-sky-50 text-sky-700",
  done: "bg-emerald-50 text-emerald-700",
  blocked: "bg-red-50 text-red-700",
};

/**
 * Phase 3 — Security Command Center. One dialog for repo health, security
 * findings, dependency intelligence, the project constitution (rules),
 * project memory, documentation intelligence, missions (+ agents + reviewer),
 * and the flight recorder / audit trail.
 *
 * Server-side enforcement note: every write here is repo-scoped and verified
 * against `connectedRepos` in the backend — this UI only mirrors it.
 */
export function SecurityCenterDialog({
  open,
  onOpenChange,
  owner,
  repo,
  branch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  branch: string;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const fullName = `${owner}/${repo}`;

  const findings = useQuery(api.securityCenter.listSecurityFindings, {
    repo: fullName,
  });
  const deps = useQuery(api.securityCenter.listDependencyReports, {
    repo: fullName,
  });
  const health = useQuery(api.securityCenter.getRepoHealth, { repo: fullName });
  const rules = useQuery(api.securityCenter.listRules, { repo: fullName });
  const memory = useQuery(api.securityCenter.listMemory, { repo: fullName });
  const missions = useQuery(api.securityCenter.listMissions, { repo: fullName });
  const flights = useQuery(api.securityCenter.listFlightRecords);
  const audit = useQuery(api.securityCenter.listAuditLogs);
  const loginHistory = useQuery(api.securityHardening.listLoginHistory);
  const sessions = useQuery(api.securityHardening.listSessions);
  const securityEvents = useQuery(api.securityHardening.listSecurityEvents);
  const emailStatus = useQuery(api.securityHardening.emailVerificationStatus);

  const scanRepo = useAction(api.securityScanner.scanRepo);
  const dismissFinding = useMutation(api.securityCenter.dismissSecurityFinding);
  const signOutAllSessions = useAction(api.securityHardening.signOutAllSessions);

  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTab("overview");
  }, [open]);

  const runScan = async () => {
    setScanning(true);
    setScanNote(null);
    try {
      const r = await scanRepo({ owner, repo });
      setScanNote(
        `Scanned ${fullName}: ${r.secrets} secret hit${r.secrets === 1 ? "" : "s"}, ${r.vulnerable} vulnerable dep${r.vulnerable === 1 ? "" : "s"}, ${r.outdated} outdated major${r.outdated === 1 ? "" : "s"}, ${r.docsFindings} docs finding${r.docsFindings === 1 ? "" : "s"}, ${r.healthCategories} health categories scored.`,
      );
    } catch (e) {
      setScanNote(errorMessage(e));
    } finally {
      setScanning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <DialogHeader className="px-6 pt-5">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-neutral-500" />
              Security command center
            </DialogTitle>
            <DialogDescription>
              {fullName} · {branch || "—"} — scans surface evidence, never
              auto-fix. Every write is verified server-side.
            </DialogDescription>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-200 px-4 py-2">
            {TABS.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  tab === key
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
            <div className="ml-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={runScan}
                disabled={scanning || !owner || !repo}
                title="Run the full security scan for this repo"
              >
                {scanning ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                Run scan
              </Button>
            </div>
          </div>
          {scanNote && (
            <div
              className={cn(
                "shrink-0 border-b border-neutral-100 px-6 py-2 text-xs",
                scanNote.startsWith("Scanned")
                  ? "text-neutral-500"
                  : "text-red-600",
              )}
            >
              {scanNote}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {tab === "overview" && (
              <OverviewTab
                health={health ?? null}
                findings={findings ?? []}
                deps={deps ?? []}
              />
            )}
            {tab === "security" && (
              <SecurityTab findings={findings ?? []} dismiss={dismissFinding} />
            )}
            {tab === "dependencies" && <DependenciesTab deps={deps ?? []} />}
            {tab === "rules" && (
              <RulesTab rules={rules ?? []} repo={fullName} />
            )}
            {tab === "memory" && (
              <MemoryTab memory={memory ?? []} repo={fullName} />
            )}
            {tab === "docs" && (
              <DocsTab findings={(findings ?? []).filter((f) => f.kind === "docs")} dismiss={dismissFinding} />
            )}
            {tab === "missions" && (
              <MissionsTab
                missions={missions ?? []}
                repo={fullName}
                branch={branch}
              />
            )}
            {tab === "flight" && (
              <FlightTab flights={flights ?? []} audit={audit ?? []} />
            )}
            {tab === "sessions" && (
              <SessionsTab
                loginHistory={loginHistory ?? []}
                sessions={sessions ?? []}
                securityEvents={securityEvents ?? []}
                emailStatus={emailStatus}
                onSignOutAll={() => signOutAllSessions({})}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Overview — explainable repo health
// ---------------------------------------------------------------------------

function OverviewTab({
  health,
  findings,
  deps,
}: {
  health: {
    repo: string;
    scores: Record<string, number>;
    evidence: Record<string, string[]>;
    updatedAt: number;
  } | null;
  findings: SecurityFinding[];
  deps: DepReport[];
}) {
  if (!health) {
    return (
      <EmptyState
        icon={Activity}
        title="No health score yet"
        body="Run the scan above to score architecture, security, testing, dependencies, documentation, CI/CD, and maintainability — every score carries the evidence behind it."
      />
    );
  }
  const categories = Object.entries(health.scores);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-5 text-neutral-500">
        Repo health for <span className="font-mono">{health.repo}</span> —
        last scored{" "}
        {new Date(health.updatedAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
        . Scores are weighted from real evidence; a category with no evidence
        simply isn't scored.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {categories.map(([category, score]) => (
          <div
            key={category}
            className="rounded-lg border border-neutral-200 p-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium capitalize text-neutral-800">
                {category}
              </p>
              <span
                className={cn(
                  "font-mono text-sm font-semibold tabular-nums",
                  score >= 70
                    ? "text-emerald-600"
                    : score >= 40
                      ? "text-amber-600"
                      : "text-red-600",
                )}
              >
                {score}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div
                className={cn(
                  "h-full rounded-full",
                  score >= 70
                    ? "bg-emerald-500"
                    : score >= 40
                      ? "bg-amber-500"
                      : "bg-red-500",
                )}
                style={{ width: `${Math.min(100, score)}%` }}
              />
            </div>
            <ul className="mt-2 space-y-1">
              {(health.evidence[category] ?? []).slice(0, 4).map((e, i) => (
                <li key={i} className="text-[11px] leading-4 text-neutral-500">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-500">
        Current totals: {findings.length} open security finding
        {findings.length === 1 ? "" : "s"} · {deps.filter((d) => d.status === "vulnerable").length}{" "}
        vulnerable dep{deps.filter((d) => d.status === "vulnerable").length === 1 ? "" : "s"} ·{" "}
        {deps.filter((d) => d.status === "outdated_major").length} outdated
        major{deps.filter((d) => d.status === "outdated_major").length === 1 ? "" : "s"}.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security — secret / config / ci findings
// ---------------------------------------------------------------------------

function SecurityTab({
  findings,
  dismiss,
}: {
  findings: SecurityFinding[];
  dismiss: (args: { id: Id<"securityFindings"> }) => Promise<unknown>;
}) {
  const relevant = findings.filter((f) => f.kind !== "docs");
  if (relevant.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No security findings"
        body="Run the scan to check for secrets, risky configuration, and CI problems. Findings show severity, evidence, and remediation — never the secret value."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {relevant.map((f) => (
        <FindingCard key={f._id} finding={f} dismiss={dismiss} />
      ))}
    </div>
  );
}

function DocsTab({
  findings,
  dismiss,
}: {
  findings: SecurityFinding[];
  dismiss: (args: { id: Id<"securityFindings"> }) => Promise<unknown>;
}) {
  if (findings.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Documentation looks covered"
        body="No docs findings. The scan checks for a README with setup/architecture sections, a changelog, a docs/ directory, and a stale README."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {findings.map((f) => (
        <FindingCard key={f._id} finding={f} dismiss={dismiss} />
      ))}
    </div>
  );
}

function FindingCard({
  finding,
  dismiss,
}: {
  finding: SecurityFinding;
  dismiss: (args: { id: Id<"securityFindings"> }) => Promise<unknown>;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex items-start gap-2">
        <SeverityBadge severity={finding.severity} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-800">{finding.title}</p>
          <p className="mt-0.5 text-xs leading-5 text-neutral-500">
            {finding.detail}
          </p>
          {finding.file && (
            <p className="mt-1 font-mono text-[11px] text-neutral-400">
              {finding.file}
            </p>
          )}
          <div className="mt-2 space-y-1 rounded-md bg-neutral-50 px-2.5 py-2">
            <p className="text-[11px] text-neutral-600">
              <span className="font-medium">Evidence:</span> {finding.evidence}
            </p>
            <p className="text-[11px] leading-4 text-neutral-600">
              <span className="font-medium">Fix:</span> {finding.remediation}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void dismiss({ id: finding._id })}
          className="shrink-0 rounded p-1 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700"
          title="Dismiss (already handled)"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

function DependenciesTab({ deps }: { deps: DepReport[] }) {
  if (deps.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="No dependency scan yet"
        body="Run the scan to compare installed versions against the npm registry and the OSV advisory feed. Vulnerable and outdated-major packages show up here with upgrade guidance."
      />
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {deps.map((d) => (
        <div
          key={d._id}
          className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-800">
              {d.package}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-neutral-400">
              {d.installed ?? "?"}
              {d.latest && d.latest !== d.installed && (
                <span className="text-neutral-300"> → {d.latest}</span>
              )}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn("shrink-0 font-mono", DEP_STATUS_STYLE[d.status])}
          >
            {d.status === "vulnerable"
              ? "Vulnerable"
              : d.status === "outdated_major"
                ? `+${d.majorDiff} majors`
                : d.status === "outdated_minor"
                  ? "Behind"
                  : d.status === "current"
                    ? "Current"
                    : "Unknown"}
          </Badge>
        </div>
      ))}
      <p className="mt-2 text-[11px] leading-4 text-neutral-400">
        Upgrades are proposals, not actions — plan them, run the project's
        tests, and commit through the normal review flow.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules (project constitution)
// ---------------------------------------------------------------------------

interface Rule {
  _id: Id<"projectRules">;
  repo: string;
  title: string;
  body: string;
  paths: string[];
  action: "block" | "require_review";
  updatedAt: number;
}

function RulesTab({ rules, repo }: { rules: Rule[]; repo: string }) {
  const createRule = useMutation(api.securityCenter.createRule);
  const updateRule = useMutation(api.securityCenter.updateRule);
  const deleteRule = useMutation(api.securityCenter.deleteRule);
  const [editing, setEditing] = useState<
    Id<"projectRules"> | "new" | null
  >(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [paths, setPaths] = useState("");
  const [action, setAction] = useState<"block" | "require_review">("block");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (r: Rule | null) => {
    setEditing(r ? r._id : "new");
    setTitle(r?.title ?? "");
    setBody(r?.body ?? "");
    setPaths(r?.paths.join(", ") ?? "");
    setAction(r?.action ?? "block");
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const specs = paths
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (editing === "new") {
        await createRule({ repo, title, body, paths: specs, action });
      } else if (editing) {
        await updateRule({ id: editing, title, body, paths: specs, action });
      }
      setEditing(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-5 text-neutral-500">
        The project constitution — files never to modify, conventions, testing
        or deployment requirements. <span className="font-medium">Block</span>{" "}
        rules refuse matching commits server-side;{" "}
        <span className="font-medium">require review</span> rules flag them in
        the audit trail. Paths support <code className="font-mono">src/</code>,{" "}
        <code className="font-mono">*.env</code>,{" "}
        <code className="font-mono">**/secrets/**</code>.
      </p>
      {rules.length === 0 && editing === null && (
        <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-400">
          No rules yet — add the first one below.
        </p>
      )}
      {rules.map((r) =>
        editing === r._id ? (
          <RuleForm
            key={r._id}
            title={title}
            body={body}
            paths={paths}
            action={action}
            busy={busy}
            error={error}
            setTitle={setTitle}
            setBody={setBody}
            setPaths={setPaths}
            setAction={setAction}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div
            key={r._id}
            className="rounded-lg border border-neutral-200 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-800">{r.title}</p>
              <Badge
                variant="outline"
                className={cn(
                  r.action === "block"
                    ? "border-red-200 text-red-600"
                    : "border-amber-200 text-amber-600",
                )}
              >
                {r.action === "block" ? "Block" : "Require review"}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-neutral-500">{r.body}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {r.paths.map((p) => (
                <span
                  key={p}
                  className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500"
                >
                  {p}
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => startEdit(r)}
                className="text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void deleteRule({ id: r._id })}
                className="text-[11px] text-red-500 underline underline-offset-2 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        ),
      )}
      {editing === null && (
        <Button type="button" variant="outline" size="sm" onClick={() => startEdit(null)}>
          + Add rule
        </Button>
      )}
    </div>
  );
}

function RuleForm({
  title,
  body,
  paths,
  action,
  busy,
  error,
  setTitle,
  setBody,
  setPaths,
  setAction,
  onSave,
  onCancel,
}: {
  title: string;
  body: string;
  paths: string;
  action: "block" | "require_review";
  busy: boolean;
  error: string | null;
  setTitle: (v: string) => void;
  setBody: (v: string) => void;
  setPaths: (v: string) => void;
  setAction: (v: "block" | "require_review") => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Rule title, e.g. Never touch production config"
        className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Explain the rule in plain language — why it exists and what to do instead."
        rows={2}
        className="resize-none rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
      />
      <input
        value={paths}
        onChange={(e) => setPaths(e.target.value)}
        placeholder="File paths, comma-separated: src/, *.env, config/**"
        className="rounded-md border border-neutral-200 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-neutral-400"
      />
      <div className="flex items-center justify-between gap-2">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as "block" | "require_review")}
          className="rounded-md border border-neutral-200 px-2 py-1.5 text-xs outline-none focus:border-neutral-400"
        >
          <option value="block">Block commits touching these files</option>
          <option value="require_review">Require review (flag in audit)</option>
        </select>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={busy}>
            {busy && <Loader2 className="size-3 animate-spin" />}
            Save rule
          </Button>
        </div>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

interface MemoryEntry {
  _id: Id<"projectMemory">;
  repo: string;
  title: string;
  body: string;
  updatedAt: number;
}

function MemoryTab({ memory, repo }: { memory: MemoryEntry[]; repo: string }) {
  const createMemory = useMutation(api.securityCenter.createMemory);
  const updateMemory = useMutation(api.securityCenter.updateMemory);
  const deleteMemory = useMutation(api.securityCenter.deleteMemory);
  const [editing, setEditing] = useState<
    Id<"projectMemory"> | "new" | null
  >(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (m: MemoryEntry | null) => {
    setEditing(m ? m._id : "new");
    setTitle(m?.title ?? "");
    setBody(m?.body ?? "");
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing === "new") {
        await createMemory({ repo, title, body });
      } else if (editing) {
        await updateMemory({ id: editing, title, body });
      }
      setEditing(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-5 text-neutral-500">
        Repo-scoped facts and instructions Aria should remember. Visible,
        editable, deletable — and secrets are rejected at write time. This is
        project knowledge, never hidden reasoning.
      </p>
      {memory.map((m) =>
        editing === m._id ? (
          <div key={m._id} className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What should Aria remember about this repo?"
              rows={3}
              className="resize-none rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={busy}>
                {busy && <Loader2 className="size-3 animate-spin" />}
                Save
              </Button>
            </div>
            {error && <p className="text-[11px] text-red-600">{error}</p>}
          </div>
        ) : (
          <div key={m._id} className="rounded-lg border border-neutral-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-800">{m.title}</p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(m)}
                  className="text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void deleteMemory({ id: m._id })}
                  className="text-[11px] text-red-500 underline underline-offset-2 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs leading-5 text-neutral-500">{m.body}</p>
          </div>
        ),
      )}
      {editing === null && (
        <Button type="button" variant="outline" size="sm" onClick={() => startEdit(null)}>
          + Add memory
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

function MissionsTab({
  missions,
  repo,
  branch,
}: {
  missions: Mission[];
  repo: string;
  branch: string;
}) {
  const createMission = useMutation(api.securityCenter.createMission);
  const approveMission = useMutation(api.securityCenter.approveMission);
  const cancelMission = useMutation(api.securityCenter.cancelMission);
  const updateTask = useMutation(api.securityCenter.updateMissionTask);
  const runAgent = useAction(api.securityScanner.runAgentStep);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [plan, setPlan] = useState("");
  const [files, setFiles] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openMission, setOpenMission] = useState<Id<"missions"> | null>(null);
  const [runningRole, setRunningRole] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const affectedFiles = files
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      const r = await createMission({
        repo,
        branch,
        title,
        objective,
        plan,
        affectedFiles,
      });
      setCreating(false);
      setTitle("");
      setObjective("");
      setPlan("");
      setFiles("");
      setOpenMission(r.id as Id<"missions">);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async (id: Id<"missions">, role: string) => {
    setRunningRole(`${id}:${role}`);
    try {
      await runAgent({ missionId: id, role });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunningRole(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-5 text-neutral-500">
        Resumable multi-step missions with bounded agents and an independent
        reviewer. Missions never silently commit, merge, or deploy — they
        prepare proposals you review, approve, and apply.
      </p>

      {creating ? (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mission title, e.g. Production readiness"
            className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Objective — what should the mission accomplish?"
            rows={2}
            className="resize-none rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
          <textarea
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            placeholder={"Plan — one step per line, e.g.\nArchitecture review\nDependency check\nSecurity scan\nTest plan\nCI/CD check\nDocumentation pass"}
            rows={5}
            className="resize-none rounded-md border border-neutral-200 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-neutral-400"
          />
          <input
            value={files}
            onChange={(e) => setFiles(e.target.value)}
            placeholder="Affected files (comma-separated) — claimed by the coding agent"
            className="rounded-md border border-neutral-200 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-neutral-400"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={start} disabled={busy}>
              {busy && <Loader2 className="size-3 animate-spin" />}
              Start mission
            </Button>
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setCreating(true)}
        >
          + New mission
        </Button>
      )}

      {missions.length === 0 && !creating && (
        <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-5 text-center text-xs text-neutral-400">
          No missions yet — missions are saved and resumable; pick up any step
          later from any device.
        </p>
      )}

      {missions.map((m) => {
        const expanded = openMission === m._id;
        const reviewerOk = m.approvals.some((a) => a.kind === "reviewer");
        const userOk = m.approvals.some((a) => a.kind === "user");
        return (
          <div key={m._id} className="rounded-lg border border-neutral-200">
            <button
              type="button"
              onClick={() => setOpenMission(expanded ? null : m._id)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-800">
                  {m.title}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-neutral-400">
                  {m.repo} · {m.branch}
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0",
                  m.status === "done"
                    ? "border-emerald-200 text-emerald-600"
                    : m.status === "awaiting_review"
                      ? "border-amber-200 text-amber-600"
                      : m.status === "cancelled"
                        ? "text-neutral-400"
                        : "border-sky-200 text-sky-600",
                )}
              >
                {m.status === "awaiting_review"
                  ? "Awaiting review"
                  : m.status}
              </Badge>
            </button>
            {expanded && (
              <div className="flex flex-col gap-3 border-t border-neutral-100 px-3 py-3">
                <p className="text-xs leading-5 text-neutral-600">{m.objective}</p>

                {/* Tasks */}
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-neutral-400">
                    Tasks
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {m.tasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void updateTask({
                              id: m._id,
                              taskId: t.id,
                              status: t.status === "done" ? "pending" : "done",
                            })
                          }
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded border",
                            t.status === "done"
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "border-neutral-300",
                          )}
                          title="Toggle done (you drive completion)"
                        >
                          {t.status === "done" && <CheckCircle2 className="size-2.5" />}
                        </button>
                        <span
                          className={cn(
                            "text-xs",
                            t.status === "done"
                              ? "text-neutral-400 line-through"
                              : "text-neutral-700",
                          )}
                        >
                          {t.label}
                        </span>
                        {t.detail && (
                          <span className="truncate text-[10px] text-neutral-400">
                            — {t.detail}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Agents */}
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-neutral-400">
                    Agents
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {m.agents.map((a) => (
                      <li key={a.role} className="rounded-md bg-neutral-50 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-700">
                            <Bot className="size-3.5 text-neutral-400" />
                            {ROLE_LABEL[a.role] ?? a.role}
                            <span className="font-mono text-[10px] text-neutral-400">
                              · {a.permission}
                            </span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                AGENT_STATUS_STYLE[a.status],
                              )}
                            >
                              {a.status}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 gap-1 px-2 text-[11px]"
                              disabled={
                                m.status === "done" ||
                                m.status === "cancelled" ||
                                a.status === "running" ||
                                runningRole === `${m._id}:${a.role}`
                              }
                              onClick={() => void run(m._id, a.role)}
                            >
                              {runningRole === `${m._id}:${a.role}` ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <GitBranch className="size-3" />
                              )}
                              Run
                            </Button>
                          </div>
                        </div>
                        {a.result && (
                          <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-neutral-500">
                            {a.result}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Approvals */}
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-neutral-400">
                    Approvals
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {m.approvals.length === 0 && (
                      <li className="text-xs text-neutral-400">
                        None yet — run the reviewer, then approve.
                      </li>
                    )}
                    {m.approvals.map((ap, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-xs text-neutral-600">
                        <span className="font-medium">
                          {ap.kind === "reviewer" ? "Reviewer" : ap.by}
                        </span>
                        <span className="text-neutral-400">
                          {new Date(ap.at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        {ap.note && (
                          <span className="min-w-0 truncate text-neutral-500">
                            — {ap.note}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {m.status !== "done" && m.status !== "cancelled" && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      disabled={busy}
                      onClick={() => void approveMission({ id: m._id })}
                      title={
                        reviewerOk
                          ? "Approve the mission (your approval closes it)"
                          : "Approve — the reviewer should run first for a clean gate"
                      }
                    >
                      <ShieldCheck className="size-3.5" />
                      {userOk ? "Approve again" : "Approve mission"}
                    </Button>
                    {!reviewerOk && (
                      <span className="self-center text-[11px] text-neutral-400">
                        Reviewer hasn't approved yet.
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-neutral-400"
                      onClick={() => void cancelMission({ id: m._id })}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                {m.status === "done" && (
                  <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
                    <CheckCircle2 className="size-3" />
                    Approved by reviewer + you. Nothing was pushed — apply the
                    proposal in the editor and commit through review.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flight recorder + audit
// ---------------------------------------------------------------------------

function FlightTab({
  flights,
  audit,
}: {
  flights: Array<{
    _id: Id<"flightRecords">;
    repo: string | null;
    missionId: Id<"missions"> | null;
    request: string;
    planSummary: string;
    filesInspected: string[];
    filesModified: string[];
    commands: string[];
    tests: string[];
    approvals: string[];
    result: string;
    createdAt: number;
  }>;
  audit: Array<{
    _id: Id<"auditLogs">;
    action: string;
    repo: string | null;
    branch: string | null;
    result: string | null;
    approval: boolean | null;
    missionId: Id<"missions"> | null;
    detail: string | null;
    createdAt: number;
  }>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
          <History className="size-3.5" /> Flight recorder
        </p>
        <p className="mt-1 text-[11px] leading-4 text-neutral-400">
          Significant AI operations — mission, request, plan, files inspected,
          result. Never chain-of-thought, never secrets.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {flights.length === 0 ? (
            <p className="px-1 py-1 text-xs text-neutral-400">
              No flights recorded yet — run a scan or a mission agent.
            </p>
          ) : (
            flights.map((f) => (
              <div key={f._id} className="rounded-lg border border-neutral-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-800">{f.request}</p>
                  <span className="shrink-0 font-mono text-[10px] text-neutral-400">
                    {new Date(f.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {f.repo && (
                  <p className="mt-0.5 font-mono text-[11px] text-neutral-400">{f.repo}</p>
                )}
                <p className="mt-1 text-xs leading-5 text-neutral-500">{f.result}</p>
                {f.filesInspected.length > 0 && (
                  <p className="mt-1.5 text-[10px] text-neutral-400">
                    <span className="font-medium">Inspected:</span>{" "}
                    {f.filesInspected.slice(0, 8).join(", ")}
                    {f.filesInspected.length > 8
                      ? ` +${f.filesInspected.length - 8} more`
                      : ""}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
          <Lock className="size-3.5" /> Audit trail
        </p>
        <p className="mt-1 text-[11px] leading-4 text-neutral-400">
          Who did what, when, and with what result — including secret-guard
          overrides (recorded without the secret) and rule-review flags.
        </p>
        <ul className="mt-2 divide-y divide-neutral-100">
          {audit.length === 0 ? (
            <li className="py-1 text-xs text-neutral-400">
              No audit entries yet.
            </li>
          ) : (
            audit.map((a) => (
              <li key={a._id} className="flex items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-neutral-700">
                    <span className="font-medium">{a.action}</span>
                    {a.repo && <span className="text-neutral-400"> · {a.repo}</span>}
                    {a.branch && (
                      <span className="text-neutral-400"> · {a.branch}</span>
                    )}
                  </p>
                  {a.detail && (
                    <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                      {a.detail}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.result && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-mono",
                        a.result === "ok" || a.result === "approved"
                          ? "border-emerald-200 text-emerald-600"
                          : a.result === "overridden"
                            ? "border-amber-200 text-amber-600"
                            : "text-neutral-500",
                      )}
                    >
                      {a.result}
                    </Badge>
                  )}
                  <span className="font-mono text-[10px] text-neutral-400">
                    {new Date(a.createdAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared empty state
// ---------------------------------------------------------------------------

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldAlert;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-sm">
        <Icon className="size-4 text-neutral-500" />
      </div>
      <p className="mt-3 text-sm font-medium text-neutral-800">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-neutral-500">{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions — login history, active devices, security events, email status
// ---------------------------------------------------------------------------

function SessionsTab({
  loginHistory,
  sessions,
  securityEvents,
  emailStatus,
  onSignOutAll,
}: {
  loginHistory: Array<{
    _id: Id<"loginActivity">;
    email: string;
    result: string;
    ip: string | null;
    userAgent: string | null;
    detail: string | null;
    createdAt: number;
  }>;
  sessions: Array<{
    _id: Id<"liveSessions">;
    deviceId: string;
    label: string;
    repo: string | null;
    branch: string | null;
    path: string | null;
    lastSeen: number;
    active: boolean;
  }>;
  securityEvents: Array<{
    _id: Id<"securityEvents">;
    kind: string;
    title: string;
    detail: string;
    sentAt: number;
  }>;
  emailStatus: {
    email: string | null;
    verified: boolean;
    verifiedAt: number | null;
  } | null | undefined;
  onSignOutAll: () => void;
}) {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const now = Date.now();

  const RESULT_STYLE: Record<string, string> = {
    success: "text-emerald-600",
    failed_otp: "text-red-600",
    locked_out: "text-red-600",
    rate_limited: "text-amber-600",
  };

  const EVENT_STYLE: Record<string, string> = {
    new_device: "text-sky-600",
    lockout: "text-red-600",
    sign_out_all: "text-amber-600",
    token_revoked: "text-red-600",
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Email verification status */}
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
          <Mail className="size-3.5" /> Email verification
        </p>
        {emailStatus ? (
          <div className="mt-2 rounded-lg border border-neutral-200 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-neutral-700">
                <span className="font-mono text-xs text-neutral-500">{emailStatus.email ?? "—"}</span>
              </p>
              <Badge
                variant="outline"
                className={cn(
                  emailStatus.verified
                    ? "border-emerald-200 text-emerald-600"
                    : "border-amber-200 text-amber-600",
                )}
              >
                {emailStatus.verified ? "Verified" : "Unverified"}
              </Badge>
            </div>
            {emailStatus.verifiedAt && (
              <p className="mt-1 text-[11px] text-neutral-400">
                Verified {new Date(emailStatus.verifiedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-neutral-400">Loading...</p>
        )}
      </div>

      {/* Active sessions */}
      <div>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
            <MonitorSmartphone className="size-3.5" /> Active sessions
          </p>
          {sessions.length > 0 && (
            <>
              {confirmSignOut ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-red-500">Sign out all?</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      onSignOutAll();
                      setConfirmSignOut(false);
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setConfirmSignOut(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setConfirmSignOut(true)}
                >
                  Sign out all
                </Button>
              )}
            </>
          )}
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {sessions.length === 0 ? (
            <p className="text-xs text-neutral-400">No active sessions.</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s._id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-700">{s.label}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    {s.repo ?? "—"}
                    {s.path && <span className="text-neutral-300"> · {s.path}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      s.active ? "bg-emerald-500" : "bg-neutral-300",
                    )}
                  />
                  <span className="text-[10px] text-neutral-400">
                    {Math.floor((now - s.lastSeen) / 60_000)}m ago
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Security events */}
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
          <ShieldAlert className="size-3.5" /> Security events
        </p>
        <ul className="mt-2 divide-y divide-neutral-100">
          {securityEvents.length === 0 ? (
            <li className="py-1 text-xs text-neutral-400">No security events recorded.</li>
          ) : (
            securityEvents.map((e) => (
              <li key={e._id} className="flex items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-neutral-700">
                    <span className={cn("font-medium", EVENT_STYLE[e.kind] ?? "text-neutral-600")}>
                      {e.title}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-neutral-400">{e.detail}</p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-neutral-400">
                  {new Date(e.sentAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>

      {/* Login history */}
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
          <Globe className="size-3.5" /> Login history
        </p>
        <ul className="mt-2 divide-y divide-neutral-100">
          {loginHistory.length === 0 ? (
            <li className="py-1 text-xs text-neutral-400">No login attempts recorded yet.</li>
          ) : (
            loginHistory.map((l) => (
              <li key={l._id} className="flex items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-neutral-700">
                    <span className={cn("font-medium", RESULT_STYLE[l.result] ?? "text-neutral-600")}>
                      {l.result === "success" ? "Signed in" : l.result === "failed_otp" ? "Failed attempt" : l.result === "locked_out" ? "Locked out" : "Rate limited"}
                    </span>
                    <span className="text-neutral-400"> · {l.email}</span>
                  </p>
                  {l.detail && (
                    <p className="mt-0.5 truncate text-[11px] text-neutral-400">{l.detail}</p>
                  )}
                  {l.ip && (
                    <p className="mt-0.5 font-mono text-[10px] text-neutral-400">
                      IP: {l.ip}{l.userAgent && <span> · {l.userAgent.slice(0, 60)}</span>}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[10px] text-neutral-400">
                  {new Date(l.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

