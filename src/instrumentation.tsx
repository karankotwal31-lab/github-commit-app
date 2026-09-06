import { Dialog } from "@radix-ui/react-dialog";
import { AlertTriangle, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function isDevelopmentSurface(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof location === "undefined") return false;
  return (
    location.hostname.endsWith(".vly.sh") ||
    location.hostname.includes("daytonaproxy")
  );
}

function repairLocalState(): string[] {
  const removed: string[] = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("aria.")) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        JSON.parse(raw);
      } catch {
        localStorage.removeItem(key);
        removed.push(key);
      }
    }
  } catch {
    // Storage can be blocked by browser policy; local repair is best-effort.
  }
  return removed;
}

async function repairAndReload(): Promise<void> {
  repairLocalState();
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
  } catch {
    // Unregister is best-effort.
  }
  window.location.reload();
}

type GenericError = {
  error: string;
  stack: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  componentStack?: string;
};

function normalizeError(value: unknown): GenericError {
  if (value instanceof Error) {
    return {
      error: value.message || "Unknown runtime error",
      stack: value.stack || "",
    };
  }
  if (typeof value === "string") {
    return { error: value || "Unknown runtime error", stack: "" };
  }
  if (value && typeof value === "object") {
    const candidate = value as {
      message?: unknown;
      error?: unknown;
      stack?: unknown;
    };
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.error === "string"
          ? candidate.error
          : "";
    return {
      error: message || "Unknown runtime error",
      stack: typeof candidate.stack === "string" ? candidate.stack : "",
    };
  }
  return {
    error: value == null ? "Unknown runtime error" : String(value),
    stack: "",
  };
}

async function reportErrorToVly(errorData: {
  error: string;
  stackTrace?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}) {
  const appId = import.meta.env.VITE_VLY_APP_ID;
  const monitoringUrl = import.meta.env.VITE_VLY_MONITORING_URL;
  if (!appId || !monitoringUrl) return;

  let endpoint: URL;
  try {
    endpoint = new URL(monitoringUrl);
  } catch {
    return;
  }
  if (endpoint.protocol !== "https:") return;

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...errorData,
        // Never send query strings or fragments; they can contain transient
        // OAuth/billing state and are not required for crash grouping.
        url: `${window.location.origin}${window.location.pathname}`,
        projectSemanticIdentifier: appId,
      }),
    });
  } catch (error) {
    if (isDevelopmentSurface()) {
      console.error("Failed to report error to Vly:", error);
    }
  }
}

function ErrorDialog({
  error,
  setError,
}: {
  error: GenericError;
  setError: (error: GenericError | null) => void;
}) {
  const devSurface = isDevelopmentSurface();
  const technicalDetails = devSurface
    ? [
        error.filename &&
          `Source: ${error.filename}${error.lineno ? `:${error.lineno}` : ""}${error.colno ? `:${error.colno}` : ""}`,
        error.stack && `Stack trace:\n${error.stack}`,
        error.componentStack && `Component stack:\n${error.componentStack}`,
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  const appId = import.meta.env.VITE_VLY_APP_ID;

  return (
    <Dialog
      defaultOpen={true}
      onOpenChange={(open) => {
        if (!open) setError(null);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100 sm:max-w-lg">
        <DialogHeader className="pr-8">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/10">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
            </div>
            <div>
              <DialogTitle className="text-base">Runtime error</DialogTitle>
              <DialogDescription className="mt-1 text-zinc-400">
                {devSurface
                  ? "The preview stopped while rendering. Repair and reload, or open the editor to inspect it."
                  : "Aria encountered an unexpected error. You can repair local state and reload safely."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200/70">
            Error message
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
            {error.error}
          </p>
        </div>

        {technicalDetails && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-100"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Show technical details
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
                {technicalDetails}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        <DialogFooter className="gap-3 sm:items-center">
          {devSurface && (
            <span className="text-xs text-zinc-500">
              Technical details are available only on development surfaces.
            </span>
          )}
          <Button
            variant="outline"
            className="border-zinc-700 text-zinc-200 hover:bg-zinc-800"
            onClick={() => void repairAndReload()}
            title="Clears corrupted local data and reloads — repository data stays on GitHub/Convex."
          >
            <RefreshCw className="h-4 w-4" /> Repair & reload
          </Button>
          {devSurface && appId && (
            <a
              href={`https://freebuff.com/project/${encodeURIComponent(appId)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button className="bg-zinc-100 text-zinc-900 hover:bg-white">
                <ExternalLink className="h-4 w-4" /> Open editor
              </Button>
            </a>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ErrorBoundaryState = {
  hasError: boolean;
  error: GenericError | null;
};

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error: normalizeError(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const normalizedError = normalizeError(error);
    const componentStack = info.componentStack?.trim();
    void reportErrorToVly({
      error: normalizedError.error,
      stackTrace: [normalizedError.stack, componentStack]
        .filter(Boolean)
        .join("\n\n"),
    });
    this.setState((state) => ({
      hasError: true,
      error: {
        ...(state.error ?? normalizedError),
        componentStack,
      },
    }));
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorDialog
          error={this.state.error}
          setError={(error) => {
            if (error === null) this.setState({ hasError: false, error: null });
          }}
        />
      );
    }
    return this.props.children;
  }
}

export function InstrumentationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [error, setError] = useState<GenericError | null>(null);

  useEffect(() => {
    repairLocalState();

    const handleError = async (event: ErrorEvent) => {
      try {
        event.preventDefault();
        const normalizedError = normalizeError(event.error ?? event.message);
        const capturedError = {
          ...normalizedError,
          filename: event.filename || undefined,
          lineno: event.lineno || undefined,
          colno: event.colno || undefined,
        };
        setError(capturedError);
        await reportErrorToVly({
          error: normalizedError.error,
          stackTrace: normalizedError.stack,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      } catch (error) {
        if (isDevelopmentSurface()) console.error("Error in handleError:", error);
      }
    };

    const handleRejection = async (event: PromiseRejectionEvent) => {
      try {
        const normalizedError = normalizeError(event.reason);
        if (isDevelopmentSurface()) {
          console.error("[Aria runtime error]", normalizedError.error);
        }
        setError(normalizedError);
        await reportErrorToVly({
          error: normalizedError.error,
          stackTrace: normalizedError.stack,
        });
      } catch (error) {
        if (isDevelopmentSurface()) {
          console.error("Error in handleRejection:", error);
        }
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return (
    <>
      <ErrorBoundary>{children}</ErrorBoundary>
      {error && <ErrorDialog error={error} setError={setError} />}
    </>
  );
}
