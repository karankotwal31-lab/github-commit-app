import { Wordmark } from "@/components/workspace-shared";
import { RepoUsageBadge } from "@/components/RepoUsageBadge";
import { PushNotificationsToggle } from "@/components/PushNotificationsToggle";
import { PLAN_BY_ID } from "@/lib/plans";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { WorkspaceViewProps } from "./types";
import {
  Activity,
  Bell,
  CircleDot,
  Crown,
  Cpu,
  Focus,
  GitBranch,
  GitMerge,
  Layers,
  Loader2,
  LogOut,
  Rocket,
  ScanSearch,
  ShieldCheck,
  TerminalSquare,
  Unplug,
  Users,
  Wand2,
  WifiOff,
} from "lucide-react";

interface WorkspaceHeaderProps {
  connection: WorkspaceViewProps["connection"];
  billing: WorkspaceViewProps["billing"];
  liveSessions: WorkspaceViewProps["liveSessions"];
  offline: WorkspaceViewProps["offline"];
  focusMode: boolean;
  isMobile: boolean;
  simpleMode: boolean;
  selectedRepo: WorkspaceViewProps["selectedRepo"];
  currentBranch: WorkspaceViewProps["currentBranch"];
  crossRepoAllowed: boolean;
  setSimpleMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  setFocusMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  onOpenLocal: () => void;
  onOpenStack: () => void;
  onOpenDock: () => void;
  onOpenRuntime: () => void;
  onOpenShare: () => void;
  onOpenCrossRepo: () => void;
  onOpenInbox: () => void;
  onOpenReview: () => void;
  onOpenAdmin: () => void;
  onOpenIssue: () => void;
  onOpenStress: () => void;
  onOpenBilling: () => void;
  onLivePreview: () => void;
  handleDisconnect: () => void;
  handleSignOut: () => void;
}

/** Top bar — hidden in mobile focus mode for maximum code space. */
export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const {
    connection,
    billing,
    liveSessions,
    offline,
    focusMode,
    isMobile,
    simpleMode,
    selectedRepo,
    currentBranch,
    crossRepoAllowed,
    setSimpleMode,
    setFocusMode,
    onOpenLocal,
    onOpenStack,
    onOpenDock,
    onOpenRuntime,
    onOpenShare,
    onOpenCrossRepo,
    onOpenInbox,
    onOpenReview,
    onOpenAdmin,
    onOpenIssue,
    onOpenStress,
    onOpenBilling,
    onLivePreview,
    handleDisconnect,
    handleSignOut,
  } = props;

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-4",
        focusMode && isMobile && "hidden",
      )}
    >
      <Wordmark />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSimpleMode((v) => !v)}
          disabled={!selectedRepo}
          aria-pressed={simpleMode}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${
            simpleMode
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-200 hover:bg-neutral-100"
          }`}
          title="Simple mode — describe changes in plain English, no file tree or code view"
        >
          <Wand2
            className={`size-3.5 ${simpleMode ? "text-white" : "text-neutral-500"}`}
          />
          <span
            className={`hidden text-xs sm:inline ${
              simpleMode ? "text-white" : "text-neutral-500"
            }`}
          >
            {simpleMode ? "Exit simple" : "Simple"}
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenLocal}
          disabled={!selectedRepo}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Local git — clone into the browser, merge, rebase, stash, graph"
        >
          <GitBranch className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Local
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenStack}
          disabled={!selectedRepo}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Stacked PRs — review branches on top of each other, not main"
        >
          <Layers className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Stack
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenDock}
          disabled={!selectedRepo}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Engineering command center — terminal, test lab, time machine, impact, CI, git ops, PRs"
        >
          <TerminalSquare className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Engineer
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenRuntime}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
          title="Runtime & plugins — what Aria detected on this device"
        >
          <Cpu className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Runtime
          </span>
        </button>
        <button
          type="button"
          onClick={onLivePreview}
          disabled={!selectedRepo}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Live deployment preview — test the app without leaving Aria"
        >
          <Rocket className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Live
          </span>
        </button>
        <button
          type="button"
          onClick={() => setFocusMode((f) => !f)}
          aria-pressed={focusMode}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors ${
            focusMode
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-200 hover:bg-neutral-100"
          }`}
          title={
            focusMode
              ? "Exit focus mode"
              : "Focus mode — hide everything but the code"
          }
        >
          <Focus className="size-3.5" />
          <span className="hidden text-xs sm:inline">
            {focusMode ? "Exit focus" : "Focus"}
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenShare}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
          title="Team workspaces — share the current repo with a code"
        >
          <Users className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Share
          </span>
        </button>
        {crossRepoAllowed && (
          <button
            type="button"
            onClick={onOpenCrossRepo}
            disabled={!selectedRepo}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Cross-repo AI edits — describe one change across many repos"
          >
            <GitMerge className="size-3.5 text-neutral-500" />
            <span className="hidden text-xs text-neutral-500 sm:inline">
              Cross-repo
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={onOpenInbox}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
          title="Unified inbox — PRs, issues, and Aria's findings across all your repos"
        >
          <Bell className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Inbox
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenReview}
          disabled={!selectedRepo || !currentBranch}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:opacity-40"
          title="AI review — review the branch before you push"
        >
          <ScanSearch className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Review
          </span>
        </button>
        {billing?.configured &&
          (billing.plan === "team" || billing.plan === "enterprise") && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
              title="Admin console — seats, usage, audit"
            >
              <ShieldCheck className="size-3.5 text-neutral-500" />
              <span className="hidden text-xs text-neutral-500 sm:inline">
                Admin
              </span>
            </button>
          )}
        <RepoUsageBadge onUpgrade={onOpenBilling} />
        <PushNotificationsToggle />
        <button
          type="button"
          onClick={onOpenIssue}
          disabled={!selectedRepo}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100 disabled:opacity-40"
          title="Create an issue in this repository"
        >
          <CircleDot className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Issue
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenStress}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
          title="Stress test — measure this instance under load"
        >
          <Activity className="size-3.5 text-neutral-500" />
          <span className="hidden text-xs text-neutral-500 sm:inline">
            Test
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenBilling}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors ${
            billing?.configured && billing.plan !== "free"
              ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-neutral-200 hover:bg-neutral-100"
          }`}
          title={
            billing?.configured && billing.plan === "free"
              ? "Upgrade to Aria Pro"
              : billing?.configured
                ? `Aria ${PLAN_BY_ID[billing.plan].name}`
                : "Aria plans"
          }
        >
          <Crown className="size-3.5 text-amber-600" />
          <span className="hidden text-xs font-medium sm:inline">
            {billing?.configured && billing.plan === "free"
              ? "Upgrade"
              : billing?.configured
                ? PLAN_BY_ID[billing.plan].name
                : "Plans"}
          </span>
        </button>
        {/* Offline sync safeguard indicator */}
        {(offline.pending > 0 || !offline.online) && (
          <span
            className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700"
            title={
              !offline.online
                ? "You're offline — edits are saved on this device and sync when you're back."
                : `${offline.pending} unsaved edit${offline.pending > 1 ? "s" : ""} queued — syncing when online.`
            }
          >
            <WifiOff className="size-3" />
            <span className="hidden sm:inline">
              {!offline.online
                ? "Offline"
                : `${offline.pending} queued`}
            </span>
            {offline.syncing && <Loader2 className="size-3 animate-spin" />}
          </span>
        )}
        {liveSessions && liveSessions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
                title="Devices in this workspace"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <span className="hidden text-xs text-neutral-500 sm:inline">
                  {liveSessions.length} other
                  {liveSessions.length > 1 ? "s" : ""}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                  Live now
                </p>
              </div>
              {liveSessions.map((s) => (
                <div key={s.deviceId} className="px-3 pb-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-800">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    {s.label}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">
                    {s.repo
                      ? `${s.repo} · ${s.branch ?? ""}${s.path ? ` · ${s.path}` : ""}`
                      : "Browsing repositories"}
                  </p>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100"
            >
              {connection.avatar ? (
                <img
                  src={connection.avatar}
                  alt=""
                  className="size-6 rounded-full border border-neutral-200"
                />
              ) : (
                <span className="flex size-6 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-medium text-white">
                  {(connection.login ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="font-medium text-neutral-800">
                @{connection.login ?? "github"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={handleDisconnect}
            >
              <Unplug className="mr-2 size-4" />
              Disconnect GitHub
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
