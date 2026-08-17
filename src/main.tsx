import '@vly-ai/integrations';
import { InstrumentationProvider } from "./instrumentation";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
// Load Inter Variable through the bundler (guaranteed to resolve + ship with
// the app), then the Tailwind theme that maps it to every font utility.
import "@fontsource-variable/inter";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Privacy = lazy(() => import("./pages/Privacy.tsx"));
const Terms = lazy(() => import("./pages/Terms.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
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

/** Hard guard so runtime errors never leave the preview as a blank page. */
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
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

/**
 * Registers the service worker. Always registered so web-push works; the
 * `?cache=1` flag (production builds only) tells the worker to also cache the
 * app shell so the app opens instantly on repeat visits.
 *
 * Self-repair: a transient registration failure (sandboxed iframe, storage
 * hiccup) is retried with backoff up to 3 times, and every time the tab
 * becomes visible again we nudge a waiting/outdated worker to update — and
 * re-register if the browser lost the registration entirely.
 */
function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const flag = import.meta.env.PROD ? "?cache=1" : "";
    let cancelled = false;
    let attempts = 0;
    let registered: ServiceWorkerRegistration | null = null;

    const register = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        registered = await navigator.serviceWorker.register(`/sw.js${flag}`);
      } catch (err) {
        if (!cancelled && attempts < 3) {
          setTimeout(register, 1000 * attempts * attempts);
        } else {
          console.warn("[PWA] Service worker registration failed:", err);
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (reg) {
            if (reg.waiting || reg.installing) void reg.update().catch(() => {});
          } else if (!cancelled && registered === null) {
            attempts = 0;
            void register();
          }
        })
        .catch(() => {});
    };

    const onLoad = () => {
      void register();
    };
    window.addEventListener("load", onLoad);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}

/**
 * GitHub OAuth popup bridge. The authorization flow runs in a popup because
 * GitHub refuses to render inside the preview iframe. When the Convex
 * callback redirects that popup back to the app (?github=connected|config|error),
 * this reports the outcome to the opener frame and closes the popup.
 */
function OAuthPopupBridge() {
  useEffect(() => {
    if (!window.opener) return;
    const status = new URLSearchParams(window.location.search).get("github");
    if (!status) return;
    window.opener.postMessage({ type: "aria-github-oauth", status }, "*");
    window.close();
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <InstrumentationProvider>
        <ToolbarErrorBoundary>
          <VlyToolbar />
        </ToolbarErrorBoundary>
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
        </ConvexAuthProvider>
      </InstrumentationProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
