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
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { errorMessage } from "@/lib/github";
import {
  Activity,
  AlertTriangle,
  Bot,
  GitPullRequest,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";

interface FeatureFlags {
  aiBackgroundChecker: boolean;
  liveCollaboration: boolean;
  crossRepoEdits: boolean;
}

const FEATURE_LABELS: Record<keyof FeatureFlags, { label: string; hint: string }> = {
  aiBackgroundChecker: {
    label: "Background AI checker",
    hint: "Scheduled scans of dependencies, stale PRs, config changes, and failing CI.",
  },
  liveCollaboration: {
    label: "Live collaboration",
    hint: "See teammates' cursors and presence in the workspace in real time.",
  },
  crossRepoEdits: {
    label: "Cross-repo AI edits",
    hint: "Describe one change and have Aria propose edits across multiple repos.",
  },
};

interface HealthChecks {
  authorized: boolean;
  latestRun?: number | null;
  checks?: Record<string, { ok: boolean; detail: string | null; checkedAt: number }>;
}

interface ErrorLog {
  authorized: boolean;
  errors?: Array<{ source: string; message: string; detail: string | null; createdAt: number }>;
}

interface Overview {
  authorized: boolean;
  plan?: string;
  seats?: number | null;
  totalUsed?: number;
  usageTrend?: Array<{ period: string; count: number }>;
  recentAudit?: Array<{
    action: string;
    repo: string | null;
    detail: string | null;
    createdAt: number;
  }>;
}

const ACTION_LABELS: Record<string, string> = {
  "ai.ask": "Ask Aria",
  "ai.review": "AI review",
};

/**
 * Team/Enterprise admin console: seat count (prorated via Stripe), AI usage
 * analytics by month, and the audit trail — who did what, when. Gated
 * server-side; non-Team plans get an empty, unauthenticated state.
 */
export function AdminDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const overview = useQuery(api.aiUsage.adminOverview);
  const updateSeats = useAction(api.billingActions.updateTeamSeats);
  const flags = useQuery(api.security.getFeatureFlags);
  const setFlag = useMutation(api.security.setFeatureFlag);
  const health = useQuery(api.health.recentHealthChecks);
  const errorLog = useQuery(api.security.recentErrors);
  const [seats, setSeats] = useState(5);
  const [saving, setSaving] = useState(false);
  const [flagSaving, setFlagSaving] = useState<keyof FeatureFlags | null>(null);

  const isAdmin = overview?.authorized === true;

  const toggleFlag = async (key: keyof FeatureFlags, enabled: boolean) => {
    setFlagSaving(key);
    try {
      await setFlag({ key, enabled });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(errorMessage(e));
    } finally {
      setFlagSaving(null);
    }
  };
  const trend = overview?.usageTrend ?? [];
  const maxCount = Math.max(1, ...trend.map((t) => t.count));

  // Sync the seat stepper with the stored seat count once it loads.
  useEffect(() => {
    if (overview?.authorized && overview.seats != null) {
      setSeats(overview.seats);
    }
  }, [overview]);

  const saveSeats = async (next: number) => {
    setSaving(true);
    try {
      await updateSeats({ seats: next });
      setSeats(next);
    } catch (e) {
      // Surfaced via the dialog; seats revert on next open.
      // eslint-disable-next-line no-console
      console.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-neutral-500" />
            Admin console
          </DialogTitle>
          <DialogDescription>
            Seats, usage analytics, and the audit trail for your workspace.
          </DialogDescription>
        </DialogHeader>

        {!isAdmin ? (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
            The admin console is a Team feature — upgrade to manage seats, see
            usage analytics, and audit activity.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Seats */}
            <div className="rounded-lg border border-neutral-200 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                <Users className="size-4 text-neutral-500" /> Seats
              </p>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Fewer seats"
                    onClick={() => saveSeats(Math.max(1, seats - 1))}
                    disabled={saving || seats <= 1}
                    className="flex size-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-10 text-center text-lg font-semibold tabular-nums">
                    {seats}
                  </span>
                  <button
                    type="button"
                    aria-label="More seats"
                    onClick={() => saveSeats(Math.min(100, seats + 1))}
                    disabled={saving || seats >= 100}
                    className="flex size-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                {saving ? (
                  <Loader2 className="size-4 animate-spin text-neutral-400" />
                ) : (
                  <span className="text-xs text-neutral-400">
                    ${((overview?.seats ?? 5) * 45).toLocaleString()}/mo
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs leading-4 text-neutral-400">
                Seat changes are prorated automatically by Stripe — adding
                bills the difference for the rest of the period.
              </p>
            </div>

            {/* Usage analytics */}
            <div className="rounded-lg border border-neutral-200 p-4">
              <p className="text-sm font-medium text-neutral-800">
                AI usage — {overview?.totalUsed?.toLocaleString() ?? 0} total
                requests
              </p>
              <div className="mt-3 flex h-24 items-end gap-2">
                {trend.map((t) => (
                  <div
                    key={t.period}
                    className="flex flex-1 flex-col items-center gap-1"
                  >
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t bg-neutral-900/80"
                        style={{
                          height: `${Math.max(4, (t.count / maxCount) * 100)}%`,
                        }}
                        title={`${t.count} requests`}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-neutral-400">
                      {t.period.slice(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Feature switches (Part D kill switches) */}
            <div className="rounded-lg border border-neutral-200 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                <ShieldCheck className="size-4 text-neutral-500" /> Feature switches
              </p>
              <p className="mt-1 text-xs leading-4 text-neutral-400">
                Turn a risky feature off instantly if it misbehaves — takes
                effect server-side on the next request, no redeploy needed.
              </p>
              <ul className="mt-3 divide-y divide-neutral-100">
                {(Object.keys(FEATURE_LABELS) as Array<keyof FeatureFlags>).map(
                  (key) => (
                    <li key={key} className="flex items-start justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-neutral-800">
                          {FEATURE_LABELS[key].label}
                        </p>
                        <p className="mt-0.5 text-xs leading-4 text-neutral-400">
                          {FEATURE_LABELS[key].hint}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {flagSaving === key && (
                          <Loader2 className="size-3.5 animate-spin text-neutral-400" />
                        )}
                        <Switch
                          checked={flags?.[key] ?? true}
                          onCheckedChange={(checked) => toggleFlag(key, checked)}
                          disabled={flagSaving !== null}
                          aria-label={`Toggle ${FEATURE_LABELS[key].label}`}
                        />
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </div>

            {/* Health checks (Part D) */}
            <div className="rounded-lg border border-neutral-200 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                <Activity className="size-4 text-neutral-500" /> Health checks
              </p>
              <p className="mt-1 text-xs leading-4 text-neutral-400">
                Probes run automatically every hour. Results still need a human
                to read — this only records them.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {health?.authorized !== true ? null : (
                  <>
                    {health.latestRun && (
                      <p className="text-xs text-neutral-400">
                        Last run:{" "}
                        {new Date(health.latestRun).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                    {(Object.keys(health.checks ?? {}) as string[]).map((name) => {
                      const check = health.checks?.[name];
                      if (!check) return null;
                      return (
                        <div
                          key={name}
                          className="flex items-start justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-neutral-700">
                              {name === "auth"
                                ? "Login / auth"
                                : name === "github"
                                  ? "GitHub connection"
                                  : "AI connection"}
                            </p>
                            {check.detail && (
                              <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                                {check.detail}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant={check.ok ? "secondary" : "destructive"}
                            className="shrink-0"
                          >
                            {check.ok ? "OK" : "FAIL"}
                          </Badge>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* Error log (Part D) */}
            <div className="rounded-lg border border-neutral-200 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                <AlertTriangle className="size-4 text-neutral-500" /> Error log
              </p>
              <p className="mt-1 text-xs leading-4 text-neutral-400">
                Server-side failures worth reviewing. Logged automatically —
                someone still has to read and act on them.
              </p>
              <ul className="mt-3 divide-y divide-neutral-100">
                {(errorLog?.authorized === true
                  ? (errorLog.errors ?? [])
                  : []
                ).length === 0 ? (
                  <li className="py-2 text-xs text-neutral-400">
                    No logged errors — clean bill of health.
                  </li>
                ) : (
                  (errorLog?.authorized === true
                    ? (errorLog.errors ?? [])
                    : []
                  ).map((entry, i) => (
                    <li
                      key={`${entry.createdAt}-${i}`}
                      className="flex items-baseline justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs text-neutral-700">
                          <span className="font-medium">{entry.source}</span>
                          {" · "}
                          {entry.message}
                        </p>
                        {entry.detail && (
                          <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                            {entry.detail}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-neutral-400">
                        {new Date(entry.createdAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            {/* Audit trail */}
            <div className="rounded-lg border border-neutral-200 p-4">
              <p className="text-sm font-medium text-neutral-800">
                Recent activity
              </p>
              <ul className="mt-2 divide-y divide-neutral-100">
                {(overview.recentAudit ?? []).length === 0 ? (
                  <li className="py-2 text-xs text-neutral-400">
                    No activity recorded yet — it fills in as you work.
                  </li>
                ) : (
                  (overview.recentAudit ?? []).map((entry) => (
                    <li
                      key={`${entry.createdAt}-${entry.action}`}
                      className="flex items-baseline justify-between gap-4 py-2"
                    >
                      <span className="min-w-0 truncate text-xs text-neutral-700">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                        {entry.repo && (
                          <span className="text-neutral-400"> · {entry.repo}</span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-neutral-400">
                        {new Date(entry.createdAt).toLocaleString(undefined, {
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
        )}

        {!isAdmin && (
          <Button
            type="button"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            View plans
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
