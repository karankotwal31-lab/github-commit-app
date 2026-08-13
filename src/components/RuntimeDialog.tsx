import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getRuntimeProfile, type RuntimeProfile } from "@/lib/runtime";
import {
  ARIA_PLUGINS,
  autoInstallCore,
  getPluginStates,
  installPlugin,
  optionalAvailableCount,
  type PluginStatusRow,
} from "@/lib/pluginManager";
import {
  CheckCircle2,
  Cpu,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Tablet,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";

function DeviceIcon({ profile }: { profile: RuntimeProfile }) {
  if (profile.deviceType === "mobile") {
    return <Smartphone className="size-4 text-neutral-500" />;
  }
  if (profile.deviceType === "tablet") {
    return <Tablet className="size-4 text-neutral-500" />;
  }
  return <Monitor className="size-4 text-neutral-500" />;
}

function deviceLabel(profile: RuntimeProfile): string {
  if (profile.deviceType === "mobile") return "Mobile";
  if (profile.deviceType === "tablet") return "Tablet";
  return "Desktop";
}

function deviceNote(profile: RuntimeProfile): string {
  if (profile.deviceType === "mobile") {
    return "Touch-first layout active — the workspace shows one pane at a time, like a native app.";
  }
  if (profile.deviceType === "tablet") {
    return "Hybrid layout active — panes adapt to your screen width.";
  }
  return "Full three-pane layout active — repositories, files, and editor side by side.";
}

const STATUS_META: Record<
  PluginStatusRow["status"],
  { label: string; cls: string }
> = {
  active: { label: "Active", cls: "bg-emerald-50 text-emerald-700" },
  available: { label: "Available", cls: "bg-neutral-100 text-neutral-600" },
  unsupported: {
    label: "Not supported on this device",
    cls: "bg-neutral-100 text-neutral-400",
  },
  blocked: {
    label: "Unavailable in preview",
    cls: "bg-amber-50 text-amber-700",
  },
};

export function RuntimeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const profile = useMemo(() => getRuntimeProfile(), []);
  // Rows initialize from the detector (localStorage-backed, idempotent) and
  // refresh after installs — no effect needed to keep them current.
  const [rows, setRows] = useState<PluginStatusRow[] | null>(() =>
    getPluginStates(),
  );
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setRows(getPluginStates());
  }, []);

  // First-run prompt: after the workspace loads, auto-install the bundled
  // core plugins and tell the user what was activated (exactly once per
  // page load — autoInstallCore guards against StrictMode double-mounts).
  useEffect(() => {
    const results = autoInstallCore();
    if (!results) return;
    const installed = results.filter((r) => r.installed);
    const optional = optionalAvailableCount();
    const device = deviceLabel(profile);
    toast("Aria checked this device", {
      description:
        `${device} · ${profile.os} · ${profile.browser} · ${
          profile.online ? "online" : "offline"
        }. ` +
        `Installed: ${installed.map((r) => r.name).join(", ")}. ` +
        `${optional} optional device plugins are ready when you want them.`,
      action: {
        label: "View plugins",
        onClick: () => onOpenChange(true),
      },
    });
    // Refresh the plugin list one tick later so the mount finishes first.
    const id = window.setTimeout(() => setRows(getPluginStates()), 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstall = async (id: string) => {
    const plugin = ARIA_PLUGINS.find((p) => p.id === id);
    if (!plugin) return;
    setBusy(id);
    const result = await installPlugin(id);
    setBusy(null);
    refresh();
    if (result.ok) {
      if (id === "pwa") {
        toast.success("Install as App is ready", {
          description:
            "Use your browser's “Install app” / “Add to Home Screen” option to launch Aria full-screen.",
        });
      } else {
        toast.success(`${plugin.name} installed`, {
          description: plugin.privacy,
        });
      }
    } else {
      toast.error(result.error ?? `${plugin.name} couldn't be installed.`, {
        description: plugin.privacy,
      });
    }
  };

  const connectionLabel = profile.online
    ? profile.connection.effectiveType
      ? `${profile.connection.effectiveType.toUpperCase()} · ${
          profile.connection.downlink ?? "?"
        } Mbps`
      : "online"
    : "offline";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="size-4 text-neutral-500" />
            Runtime &amp; Plugins
          </DialogTitle>
          <DialogDescription>
            Aria senses where it's running and activates only what it needs.
            Every plugin ships inside Aria's own code — nothing is downloaded
            from third parties and no plugin can spy on you.
          </DialogDescription>
        </DialogHeader>

        {/* Device card */}
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center gap-2">
            <DeviceIcon profile={profile} />
            <p className="text-sm font-medium text-neutral-800">
              {deviceLabel(profile)} · {profile.os} · {profile.browser}
            </p>
            {profile.online ? (
              <span className="ml-auto flex items-center gap-1 text-xs text-emerald-700">
                <Wifi className="size-3" /> {connectionLabel}
              </span>
            ) : (
              <span className="ml-auto flex items-center gap-1 text-xs text-amber-700">
                <WifiOff className="size-3" /> offline
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {profile.screen.width}×{profile.screen.height} ·{" "}
            {profile.screen.dpr.toFixed(1)}× display
            {profile.screen.touch ? " · touch" : ""}
            {profile.standalone ? " · running as an installed app" : ""}
          </p>
          <p className="mt-2 text-xs leading-5 text-neutral-600">
            {deviceNote(profile)}
          </p>
          {profile.inPreview && (
            <p className="mt-2 text-xs leading-5 text-amber-700">
              Running in the hosted preview — “Install as App” becomes
              available once Aria is deployed.
            </p>
          )}
        </div>

        {/* Plugin list */}
        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
            Plugins
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={refresh}
          >
            <RefreshCw className="size-3" /> Re-scan
          </Button>
        </div>
        <div className="-mx-1 max-h-64 space-y-2 overflow-y-auto px-1">
          {(rows ?? []).map(({ plugin, status, installed }) => {
            const meta = STATUS_META[status];
            const installable =
              status === "available" && !installed && busy !== plugin.id;
            return (
              <div
                key={plugin.id}
                className="rounded-lg border border-neutral-200 p-3"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-neutral-800">
                    {plugin.name}
                  </p>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    {plugin.category === "core" ? "Bundled" : "Device"}
                  </span>
                  <span
                    className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}
                  >
                    {busy === plugin.id ? "Installing…" : meta.label}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  {plugin.description}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <p className="flex items-start gap-1 text-[11px] leading-4 text-emerald-700">
                    <ShieldCheck className="mt-0.5 size-3 shrink-0" />
                    {plugin.privacy}
                  </p>
                  {installable && (
                    <Button
                      type="button"
                      size="sm"
                      className="ml-auto h-7 shrink-0 px-2.5 text-xs"
                      onClick={() => handleInstall(plugin.id)}
                    >
                      Install
                    </Button>
                  )}
                  {busy === plugin.id && (
                    <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-neutral-400" />
                  )}
                  {installed && (
                    <CheckCircle2 className="ml-auto size-3.5 shrink-0 text-emerald-600" />
                  )}
                  {(status === "unsupported" || status === "blocked") && (
                    <XCircle className="ml-auto size-3.5 shrink-0 text-neutral-300" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Trust footer */}
        <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
          <p className="flex items-start gap-1.5 text-[11px] leading-4 text-neutral-500">
            <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-600" />
            Spyware-free by construction: plugins never fetch third-party code,
            never read other apps' data, and make no network calls of their
            own. Your GitHub token never leaves the Convex backend.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
