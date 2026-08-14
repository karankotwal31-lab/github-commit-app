import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAction, useMutation } from "convex/react";
import { errorMessage } from "@/lib/github";
import { Activity, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

interface PingResult {
  min: number;
  avg: number;
  max: number;
  p95: number;
}

interface RunResult {
  concurrency: number;
  pings: PingResult | null;
  githubMs: number | null;
  memory: {
    deviceGb: number | null;
    usedHeapMb: number | null;
  };
  largestJsMb: number;
  verdicts: Array<{ label: string; ok: boolean; detail: string }>;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * In-app stress test: fires a burst of concurrent Convex round-trips (the
 * "superior pressure" simulation), times the GitHub API, and reports memory
 * + bundle facts — so the app can be performance-checked from the running
 * product without external infra.
 */
export function StressTestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ping = useMutation(api.diagnostics.ping);
  const listRepos = useAction(api.githubActions.listRepositories);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      // 1. Convex burst: 24 concurrent round-trips.
      const CONCURRENCY = 24;
      const samples: number[] = [];
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          const t0 = performance.now();
          await ping();
          samples.push(performance.now() - t0);
        }),
      );
      const sorted = [...samples].sort((a, b) => a - b);
      const pings: PingResult = {
        min: sorted[0],
        avg: samples.reduce((a, b) => a + b, 0) / samples.length,
        max: sorted[sorted.length - 1],
        p95: pct(sorted, 95),
      };

      // 2. GitHub API latency (needs a connection — skip gracefully).
      let githubMs: number | null = null;
      let githubNote = "GitHub not connected — skipped";
      if (navigator.onLine) {
        try {
          const t0 = performance.now();
          await listRepos();
          githubMs = performance.now() - t0;
          githubNote = "";
        } catch {
          githubNote = "GitHub request failed — skipped";
        }
      }

      // 3. Memory + bundle facts from the browser.
      const nav = navigator as Navigator & {
        deviceMemory?: number;
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      };
      let largestJsMb = 0;
      for (const entry of performance.getEntriesByType("resource")) {
        const name = entry.name;
        if (name.includes(".js")) {
          const size = (entry as PerformanceResourceTiming).transferSize || 0;
          if (size > largestJsMb) largestJsMb = size;
        }
      }
      largestJsMb = largestJsMb / (1024 * 1024);

      // 4. Verdicts.
      const verdicts: RunResult["verdicts"] = [];
      verdicts.push({
        label: "Convex burst (24 parallel calls)",
        ok: pings.p95 < 400,
        detail: `p95 ${pings.p95.toFixed(0)}ms · avg ${pings.avg.toFixed(0)}ms · min ${pings.min.toFixed(0)}ms · max ${pings.max.toFixed(0)}ms`,
      });
      if (githubMs !== null) {
        verdicts.push({
          label: "GitHub API round-trip",
          ok: githubMs < 2000,
          detail: `${githubMs.toFixed(0)}ms`,
        });
      }
      if (nav.deviceMemory) {
        verdicts.push({
          label: "Device memory",
          ok: nav.deviceMemory >= 4,
          detail: `${nav.deviceMemory} GB`,
        });
      }
      if (nav.memory) {
        verdicts.push({
          label: "JS heap in use",
          ok: nav.memory.usedJSHeapSize < 512 * 1024 * 1024,
          detail: `${(nav.memory.usedJSHeapSize / (1024 * 1024)).toFixed(0)} MB of ${(
            nav.memory.jsHeapSizeLimit /
            (1024 * 1024)
          ).toFixed(0)} MB`,
        });
      }
      if (largestJsMb > 0) {
        verdicts.push({
          label: "Largest JS chunk",
          ok: largestJsMb < 3,
          detail: `${largestJsMb.toFixed(1)} MB transferred`,
        });
      }

      setResult({
        concurrency: CONCURRENCY,
        pings,
        githubMs,
        memory: {
          deviceGb: nav.deviceMemory ?? null,
          usedHeapMb: nav.memory
            ? nav.memory.usedJSHeapSize / (1024 * 1024)
            : null,
        },
        largestJsMb,
        verdicts,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="size-4 text-neutral-500" />
            Stress test
          </DialogTitle>
          <DialogDescription>
            Simulates load against this running instance — burst Convex calls,
            GitHub API latency, memory and bundle facts. Safe: nothing is
            written or committed.
          </DialogDescription>
        </DialogHeader>

        <Button
          type="button"
          className="w-full gap-1.5"
          onClick={run}
          disabled={running}
        >
          {running ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Activity className="size-4" />
          )}
          {running ? "Hammering the backend…" : "Run stress test"}
        </Button>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            {result.verdicts.map((v) => (
              <div
                key={v.label}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-800">
                    {v.label}
                  </p>
                  <p className="truncate text-xs text-neutral-400">{v.detail}</p>
                </div>
                {v.ok ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                ) : (
                  <TriangleAlert className="size-4 shrink-0 text-amber-500" />
                )}
              </div>
            ))}
            <p className="mt-1 text-xs leading-5 text-neutral-400">
              Thresholds are advisory (p95 &lt; 400ms for Convex bursts, GitHub
              &lt; 2s, heap &lt; 512MB). Run it a few times — the first run
              includes cold starts; later runs reflect steady state.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
