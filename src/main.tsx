import "@vly-ai/integrations";
import { InstrumentationProvider } from "./instrumentation";
import { Toaster } from "@/components/ui/sonner";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "@fontsource-variable/inter";
import "./index.css";

async function importWithRetry<T>(loader: () => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await loader();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw lastError;
}

const Landing = lazy(() => importWithRetry(() => import("./pages/Landing.tsx")));
const AuthPage = lazy(() => importWithRetry(() => import("./pages/Auth.tsx")));
const Dashboard = lazy(() => importWithRetry(() => import("./pages/Dashboard.tsx")));
const NotFound = lazy(() => importWithRetry(() => import("./pages/NotFound.tsx")));
const Privacy = lazy(() => importWithRetry(() => import("./pages/Privacy.tsx")));
const Terms = lazy(() => importWithRetry(() => import("./pages/Terms.tsx")));

function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Aria] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Aria hit an unexpected error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {import.meta.env.DEV && this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Reload Aria
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function createConvexClient(): ConvexReactClient | null {
  const value = import.meta.env.VITE_CONVEX_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1"
    ) {
      return null;
    }
    return new ConvexReactClient(value);
  } catch {
    return null;
  }
}

const convex = createConvexClient();

function ConfigurationError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-lg text-center">
        <p className="text-base font-semibold">Aria is not configured yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The deployment is missing a valid VITE_CONVEX_URL. Configure the
          production Convex URL and rebuild the frontend.
        </p>
      </div>
    </div>
  );
}

function parentOrigin(): string | null {
  if (window.parent === window || !document.referrer) return null;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}

function RouteSyncer() {
  const location = useLocation();

  useEffect(() => {
    const targetOrigin = parentOrigin();
    if (!targetOrigin) return;
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      targetOrigin,
    );
  }, [location.pathname]);

  useEffect(() => {
    const targetOrigin = parentOrigin();
    if (!targetOrigin) return;

    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent || event.origin !== targetOrigin) return;
      if (event.data?.type !== "navigate") return;
      if (event.data.direction === "back") window.history.back();
      if (event.data.direction === "forward") window.history.forward();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (location.hostname.endsWith(".vly.sh")) return;
    const local =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!window.isSecureContext && !local) return;

    const flag = import.meta.env.PROD ? "?cache=1" : "";
    let cancelled = false;
    let attempts = 0;
    let retryTimer: number | undefined;

    const register = async (): Promise<void> => {
      if (cancelled) return;
      attempts += 1;
      try {
        const registration = await navigator.serviceWorker.register(`/sw.js${flag}`);
        if (!cancelled) void registration.update().catch(() => {});
      } catch (err) {
        if (!cancelled && attempts < 3) {
          retryTimer = window.setTimeout(() => void register(), 1000 * attempts * attempts);
        } else if (!cancelled) {
          console.warn("[PWA] Service worker registration failed:", err);
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => {
          if (registration) {
            void registration.update().catch(() => {});
            return;
          }
          attempts = 0;
          void register();
        })
        .catch(() => {});
    };

    const onLoad = () => void register();
    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}

function OAuthPopupBridge() {
  useEffect(() => {
    if (!window.opener) return;
    const status = new URLSearchParams(window.location.search).get("github");
    if (!status || !["connected", "config", "error"].includes(status)) return;
    window.opener.postMessage(
      { type: "aria-github-oauth", status },
      window.location.origin,
    );
    window.close();
  }, []);

  return null;
}

function shouldRenderBuilderToolbar(): boolean {
  return (
    import.meta.env.DEV ||
    location.hostname.endsWith(".vly.sh") ||
    location.hostname.includes("daytonaproxy")
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Aria root element is missing.");

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      {convex ? (
        <InstrumentationProvider>
          {shouldRenderBuilderToolbar() && (
            <ToolbarErrorBoundary>
              <VlyToolbar />
            </ToolbarErrorBoundary>
          )}
          <ConvexAuthProvider client={convex}>
            <BrowserRouter>
              <ServiceWorkerRegistrar />
              <RouteSyncer />
              <OAuthPopupBridge />
              <Suspense fallback={<RouteLoading />}>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route
                    path="/auth"
                    element={<AuthPage redirectAfterAuth="/dashboard" />}
                  />
                  <Route
                    path="/dashboard"
                    element={
                      <RequireAuth>
                        <Dashboard />
                      </RequireAuth>
                    }
                  />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
            <Toaster />
            <ConnectionBanner />
          </ConvexAuthProvider>
        </InstrumentationProvider>
      ) : (
        <ConfigurationError />
      )}
    </RootErrorBoundary>
  </StrictMode>,
);
