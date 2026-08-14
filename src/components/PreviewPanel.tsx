import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Rocket,
} from "lucide-react";

/** Latest deployment for the branch (shape returned by api.deployments.getDeploymentStatus). */
export interface DeploymentInfo {
  id: number;
  environment: string;
  state: string;
  targetUrl: string | null;
  description: string | null;
  creator: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * PreviewPanel — the "Live App Preview" tab next to Monaco.
 *
 * Shows the latest GitHub deployment for the current branch (whatever
 * platform created it — Vercel, Netlify, Actions, …) and embeds the live
 * site in an iframe so edits can be tested without leaving Aria. Polling is
 * the parent's job (workspace refresh every ~30s); this component renders
 * whatever status it's given.
 *
 * iframe caveat: some hosts send `X-Frame-Options: DENY` / CSP frame-ancestors
 * and refuse to render inside an iframe. The panel keeps the status chip,
 * the environment, and an "Open live site" link first-class so previewing
 * still works on those hosts — one tap out.
 */
export function PreviewPanel({
  deployment,
  loading,
  error,
  onRefresh,
}: {
  deployment: DeploymentInfo | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const state = deployment?.state ?? "none";
  const chip =
    state === "success"
      ? { dot: "bg-emerald-500", label: "Live", cls: "text-emerald-700" }
      : state === "failure" || state === "error"
        ? { dot: "bg-red-500", label: "Failed", cls: "text-red-600" }
        : state === "pending" || state === "in_progress"
          ? { dot: "bg-amber-500 animate-pulse", label: "Deploying", cls: "text-amber-700" }
          : state === "inactive"
            ? { dot: "bg-neutral-300", label: "Inactive", cls: "text-neutral-400" }
            : { dot: "bg-neutral-300", label: "No deployment", cls: "text-neutral-400" };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Status bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-200 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs">
          {loading ? (
            <Loader2 className="size-3 animate-spin text-neutral-400" />
          ) : (
            <span className={`size-1.5 rounded-full ${chip.dot}`} />
          )}
          <span className={cn("font-medium", chip.cls)}>{chip.label}</span>
        </span>
        {deployment && (
          <>
            <span className="flex items-center gap-1 text-xs text-neutral-500">
              <Globe className="size-3" />
              {deployment.environment}
            </span>
            {deployment.updatedAt && (
              <span className="hidden text-xs text-neutral-400 sm:inline">
                {new Date(deployment.updatedAt).toLocaleString()}
              </span>
            )}
            {deployment.creator && (
              <span className="hidden text-xs text-neutral-400 sm:inline">
                by @{deployment.creator}
              </span>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {deployment?.targetUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              asChild
            >
              <a
                href={deployment.targetUrl}
                target="_blank"
                rel="noreferrer"
                title="Open the live site in a new tab (some hosts refuse iframes)"
              >
                <ExternalLink className="size-3" />
                Open live site
              </a>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-neutral-500"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh deployment status"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        {loading && !deployment ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-4 animate-spin text-neutral-400" />
          </div>
        ) : deployment?.targetUrl ? (
          <iframe
            key={deployment.targetUrl}
            src={deployment.targetUrl}
            title={`Live preview — ${deployment.environment}`}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-sm">
              <Rocket className="size-4 text-neutral-500" />
            </div>
            <p className="mt-4 text-sm font-medium text-neutral-800">
              {deployment ? "No live URL on this deployment yet" : "No live preview yet"}
            </p>
            <p className="mt-1.5 max-w-sm text-xs leading-5 text-neutral-500">
              {error ??
                "Push a commit to this branch and your deploy platform (Vercel, Netlify, GitHub Actions, …) will register a deployment here with its preview URL."}
            </p>
            {deployment?.targetUrl === null && deployment?.description && (
              <p className="mt-1.5 max-w-sm font-mono text-[11px] leading-5 text-neutral-400">
                {deployment.description}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
