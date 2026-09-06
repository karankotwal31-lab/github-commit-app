import { PushActionHandler } from "./PushActionHandler";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { setOfflineAccount } from "@/lib/offlineBuffer";
import { Navigate, useLocation } from "react-router";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return user ? <OfflineAccount key={user._id} userId={user._id}>{children}</OfflineAccount> : null;
}


function OfflineAccount({ userId, children }: { userId: string; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    setOfflineAccount(userId); setReady(true);
    return () => setOfflineAccount(null);
  }, [userId]);
  return ready ? <><PushActionHandler />{children}</> : null;
}
