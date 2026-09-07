import { useCallback, useEffect, useState } from "react";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import {
  BadgeCheck,
  Boxes,
  Check,
  Copy,
  Cpu,
  Globe,
  Laptop,
  Loader2,
  Plug,
  Rocket,
  Shield,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  Users,
} from "lucide-react";
import { errorMessage } from "@/lib/github";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  APPROVAL_ACTION_LABELS,
  APPROVAL_ACTIONS,
  detectConnection,
  detectDeviceClass,
  ORG_ROLES,
  type ApprovalAction,
  type OrgRole,
} from "@/lib/phase4";

/**
 * Phase 4 — Platform command center.
 *
 * Tabs: Organization (teams + RBAC), Approvals (configurable policies for
 * sensitive actions), Plugins (declarative registry — plugins never get
 * tokens), Runtime (device/capabilities/privacy), Release (controlled
 * release view with server-authoritative approval gate).
 */

const ROLE_OPTIONS: Array<{ value: OrgRole; label: string; hint: string }> = [
  { value: "owner", label: "Owner", hint: "Everything, plus ownership transfer" },
  { value: "admin", label: "Admin", hint: "Manage members, roles, and policies" },
  { value: "developer", label: "Developer", hint: "Edit code and run changes" },
  { value: "reviewer", label: "Reviewer", hint: "Review and approve, no code edits" },
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
];

const ACTION_OPTIONS: ApprovalAction[] = [
  APPROVAL_ACTIONS.DEPLOY,
  APPROVAL_ACTIONS.PROTECTED_BRANCH,
  APPROVAL_ACTIONS.DEPENDENCY_UPGRADE,
  APPROVAL_ACTIONS.DATABASE_MIGRATION,
  APPROVAL_ACTIONS.HIGH_RISK_AI,
];

const PLUGIN_CAP_OPTIONS = [
  { value: "editor", label: "Editor" },
  { value: "terminal", label: "Terminal" },
  { value: "preview", label: "Preview" },
  { value: "github.read", label: "GitHub read" },
  { value: "ai", label: "AI" },
  { value: "notifications", label: "Notifications" },
  { value: "network", label: "Network" },
  { value: "files", label: "Files" },
];

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Organization tab (A + B)
// ---------------------------------------------------------------------------

function OrgTab() {
  const orgs = useQuery(api.organizations.myOrgs);
  const createOrg = useMutation(api.organizations.createOrg);

  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeOrg = orgs?.find((o) => String(o._id) === selected) ?? null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="rounded-md border border-neutral-200 p-3">
        <p className="text-xs font-medium text-neutral-700">Create an organization</p>
        <p className="mt-1 text-xs text-neutral-500">
          Teams share approval policies and roles. Server-side membership checks
          keep each org&apos;s data isolated.
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Organization name"
            className="h-8 flex-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                run("create", async () => {
                  const id = await createOrg({ name });
                  setSelected(String(id));
                  setName("");
                });
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!name.trim() || busy === "create"}
            onClick={() =>
              run("create", async () => {
                const id = await createOrg({ name });
                setSelected(String(id));
                setName("");
              })
            }
          >
            {busy === "create" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Users className="size-3.5" />
            )}
            Create
          </Button>
        </div>
      </div>

      {orgs && orgs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-700">
            Your organizations ({orgs.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {orgs.map((o) => (
              <button
                key={String(o._id)}
                type="button"
                onClick={() => setSelected(String(o._id))}
                className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                  selected === String(o._id)
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                <span className="font-medium">{o.name}</span>
                <span className={`ml-1.5 ${selected === String(o._id) ? "text-neutral-300" : "text-neutral-400"}`}>
                  {o.role} · {o.memberCount}
                </span>
              </button>
            ))}
          </div>

          {activeOrg && (
            <OrgMembersView
              orgId={selected as never}
              myRole={activeOrg.role}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Org member management — mounted only when an org is selected. */
function OrgMembersView({
  orgId,
  myRole,
}: {
  orgId: string;
  myRole: OrgRole;
}) {
  const members = useQuery(api.organizations.orgMembers, {
    orgId: orgId as never,
  }) as unknown as
    | Array<{
        _id: unknown;
        login: string | null;
        email: string | null;
        role: OrgRole;
      }>
    | undefined;
  const invite = useMutation(api.organizations.inviteMember);
  const setRole = useMutation(api.organizations.updateMemberRole);
  const removeMember = useMutation(api.organizations.removeMember);
  const leave = useMutation(api.organizations.leaveOrg);
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-neutral-200 p-3">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-700">Members</p>
        {myRole !== "viewer" && myRole !== "reviewer" && (
          <button
            type="button"
            onClick={() => run("leave", () => leave({ orgId: orgId as never }))}
            className="text-[11px] text-red-500 hover:text-red-700"
          >
            Leave org
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {members?.map((m) => (
          <div
            key={String(m._id)}
            className="flex items-center gap-2 rounded border border-neutral-100 bg-neutral-50/50 px-2 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-800">
              {m.login ?? m.email ?? "member"}
            </span>
            <Select
              value={m.role}
              disabled={myRole !== "owner" && myRole !== "admin"}
              onValueChange={(role) =>
                run("role", () =>
                  setRole({
                    orgId: orgId as never,
                    memberId: m._id as never,
                    role: role as OrgRole,
                  }),
                )
              }
            >
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(myRole === "owner" || myRole === "admin") && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-red-500 hover:text-red-700"
                onClick={() =>
                  run("remove", () =>
                    removeMember({
                      orgId: orgId as never,
                      memberId: m._id as never,
                    }),
                  )
                }
              >
                Remove
              </Button>
            )}
          </div>
        )) ?? (
          <p className="px-2 py-1 text-xs text-neutral-400">Loading members…</p>
        )}
      </div>
      {(myRole === "owner" || myRole === "admin") && (
        <div className="flex gap-2 pt-1">
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="GitHub login or email"
            className="h-8 flex-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && login.trim()) {
                run("invite", () =>
                  invite({ orgId: orgId as never, loginOrEmail: login }),
                ).then(() => setLogin(""));
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!login.trim() || busy === "invite"}
            onClick={() =>
              run("invite", () =>
                invite({ orgId: orgId as never, loginOrEmail: login }),
              ).then(() => setLogin(""))
            }
          >
            {busy === "invite" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "Invite"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approvals tab (C)
// ---------------------------------------------------------------------------

function ApprovalsTab({
  repo,
  branch,
  commit,
  orgId,
}: {
  repo: string;
  branch: string;
  commit: string | null;
  orgId: string | null;
}) {
  if (!orgId) {
    return (
      <p className="py-6 text-center text-xs text-neutral-400">
        Create or select an organization to manage approval policies.
      </p>
    );
  }
  return <ApprovalsOrg repo={repo} branch={branch} commit={commit} orgId={orgId} />;
}

/** Approval-policy management — mounted only when an org is selected. */
function ApprovalsOrg({
  repo,
  branch,
  commit,
  orgId,
}: {
  repo: string;
  branch: string;
  commit: string | null;
  orgId: string;
}) {
  const policies = useQuery(api.organizations.policiesForOrg, {
    orgId: orgId as never,
  }) as unknown as
    | Array<{
        _id: unknown;
        action: ApprovalAction;
        branchGlob: string;
        minRole: OrgRole;
        minApprovers: number;
        pathGlobs: string[];
      }>
    | undefined;
  const upsert = useMutation(api.organizations.upsertApprovalPolicy);
  const remove = useMutation(api.organizations.deleteApprovalPolicy);
  const approve = useMutation(api.organizations.approveAction);
  // Release approvals are scoped to the exact commit currently shown in the
  // workspace. Falling back to a branch key keeps the policy editor useful
  // before the first commit has been loaded, but never lets an approval for a
  // previous tip authorize a newer release.
  const changeKey = /^[a-f0-9]{40}$/i.test(commit ?? "")
    ? (commit as string)
    : `branch:${repo}:${branch}`;

  const status = useQuery(api.organizations.approvalStatus, {
    orgId: orgId as never,
    action: APPROVAL_ACTIONS.DEPLOY,
    branch,
    repo,
    changeKey,
  }) as unknown as {
    policy: {
      minRole: OrgRole;
      minApprovers: number;
      branchGlob: string;
    } | null;
    approvalCount: number;
    satisfied: boolean;
    canApprove: boolean;
    actorRole: OrgRole;
  } | undefined;
  const pending = useQuery(api.organizations.pendingApprovals, {
    orgId: orgId as never,
    repo,
  }) as unknown as
    | Array<{
        _id: unknown;
        branch: string;
        changeKey: string;
        commit: string;
        paths: string[];
        expiresAt: number;
      }>
    | undefined;

  const [action, setAction] = useState<ApprovalAction>(APPROVAL_ACTIONS.DEPLOY);
  const [branchGlob, setBranchGlob] = useState("");
  const [minRole, setMinRole] = useState<OrgRole>(ORG_ROLES.ADMIN);
  const [minApprovers, setMinApprovers] = useState("1");
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <p className="text-xs leading-5 text-neutral-500">
        Sensitive actions are gated <span className="font-medium text-neutral-700">server-side</span> —
        a matched policy blocks the action until the minimum role and approval
        count are met. Enforced at the commit gate and the release center.
      </p>

      {status && (
        <div className="rounded-md border border-neutral-200 p-3">
          <p className="text-xs font-medium text-neutral-700">
            Current branch: <span className="font-mono">{branch}</span>
          </p>
          {status.policy ? (
            <>
              <p className="mt-1 text-xs text-neutral-500">
                Deploy policy: <span className="font-mono">{status.policy.branchGlob || "*"}</span>{" "}
                needs {status.policy.minRole}+ and {status.policy.minApprovers}{" "}
                approval(s) · {status.approvalCount} recorded
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Badge
                  className={
                    status.satisfied
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }
                >
                  {status.satisfied ? "Satisfied" : "Needs approval"}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={!status.canApprove || busy === "approve"}
                  onClick={() =>
                    run("approve", () =>
                      approve({
                        orgId: orgId as never,
                        action: APPROVAL_ACTIONS.DEPLOY,
                        branch,
                        repo,
                        changeKey,
                      }),
                    )
                  }
                >
                  {busy === "approve" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <BadgeCheck className="size-3.5" />
                  )}
                  Approve deploy ({status.actorRole})
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-neutral-400">
              No deploy policy matches this branch — nothing to approve.
            </p>
          )}
        </div>
      )}

      {pending && pending.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-xs font-medium text-amber-900">Pending protected-branch changes</p>
          <p className="mt-1 text-[11px] text-amber-800">
            Review the exact commit and approve it before the author retries the push.
          </p>
          <div className="mt-2 space-y-1.5">
            {pending.map((request) => (
              <div key={String(request._id)} className="flex items-center gap-2 rounded border border-amber-200 bg-white px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-700">
                  <span className="font-mono">{request.branch}</span> · {request.commit.slice(0, 12)} · {request.paths.length} path{request.paths.length === 1 ? "" : "s"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={busy === `approve-${String(request._id)}`}
                  onClick={() =>
                    run(`approve-${String(request._id)}`, () =>
                      approve({
                        orgId: orgId as never,
                        action: APPROVAL_ACTIONS.PROTECTED_BRANCH,
                        branch: request.branch,
                        repo,
                        changeKey: request.changeKey,
                        paths: request.paths,
                        requestId: request._id as never,
                      }),
                    )
                  }
                >
                  {busy === `approve-${String(request._id)}` ? <Loader2 className="size-3.5 animate-spin" /> : <BadgeCheck className="size-3.5" />}
                  Approve
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-md border border-neutral-200 p-3">
        <p className="text-xs font-medium text-neutral-700">Add a policy</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Label className="text-[11px] text-neutral-500">
            Action
            <Select
              value={action}
              onValueChange={(a) => setAction(a as ApprovalAction)}
            >
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {APPROVAL_ACTION_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="text-[11px] text-neutral-500">
            Branch pattern (empty = all)
            <Input
              value={branchGlob}
              onChange={(e) => setBranchGlob(e.target.value)}
              placeholder="main, release/*, …"
              className="mt-1 h-8 font-mono text-xs"
            />
          </Label>
          <Label className="text-[11px] text-neutral-500">
            Minimum role
            <Select value={minRole} onValueChange={(r) => setMinRole(r as OrgRole)}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="text-[11px] text-neutral-500">
            Required approvals
            <Input
              value={minApprovers}
              onChange={(e) => setMinApprovers(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="mt-1 h-8 text-xs"
            />
          </Label>
          <div className="col-span-2">
            <Label className="text-[11px] text-neutral-500">
              File patterns (comma-separated; empty = all files)
            </Label>
            <Input
              value={paths}
              onChange={(e) => setPaths(e.target.value)}
              placeholder="db/**, config/*"
              className="mt-1 h-8 font-mono text-xs"
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          className="mt-3 h-8"
          disabled={busy === "policy"}
          onClick={() =>
            run("policy", () =>
              upsert({
                orgId: orgId as never,
                action,
                branchGlob,
                minRole,
                minApprovers: Math.max(1, Number(minApprovers) || 1),
                pathGlobs: paths
                  .split(",")
                  .map((p) => p.trim())
                  .filter(Boolean),
              }),
            )
          }
        >
          {busy === "policy" && <Loader2 className="size-3.5 animate-spin" />}
          Save policy
        </Button>
      </div>

      {policies && policies.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-neutral-700">
            Policies ({policies.length})
          </p>
          {policies.map((p) => (
            <div
              key={String(p._id)}
              className="flex items-center gap-2 rounded border border-neutral-100 bg-neutral-50/50 px-2 py-1.5"
            >
              <Shield className="size-3.5 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-700">
                {APPROVAL_ACTION_LABELS[p.action]}
                <span className="ml-1.5 font-mono text-neutral-400">
                  {p.branchGlob || "*"} · {p.minRole}+ · {p.minApprovers} approval
                  {p.minApprovers > 1 ? "s" : ""}
                  {p.pathGlobs.length > 0 ? ` · ${p.pathGlobs.join(", ")}` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => run("del", () => remove({ orgId: orgId as never, policyId: p._id as never }))}
                className="shrink-0 text-[11px] text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugins tab (J)
// ---------------------------------------------------------------------------

function PluginsTab() {
  const plugins = useQuery(api.plugins.myPlugins) as unknown as
    | Array<{
        _id: unknown;
        slug: string;
        name: string;
        version: string;
        description: string;
        author: string;
        declaredCapabilities: string[];
        grantedCapabilities: string[];
        privacyStatement: string;
        status: string;
      }>
    | undefined;
  const install = useMutation(api.plugins.installPlugin);
  const update = useMutation(api.plugins.updatePlugin);
  const uninstall = useMutation(api.plugins.uninstallPlugin);

  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [declared, setDeclared] = useState<string[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
        Plugins are declarative: they declare capabilities, you grant a subset,
        and the runtime gates every capability server-side. Plugins never receive
        GitHub tokens, secrets, or private-repo data — those are not capabilities.
      </div>

      <div className="rounded-md border border-neutral-200 p-3">
        <p className="text-xs font-medium text-neutral-700">Install a plugin</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Label className="text-[11px] text-neutral-500">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My plugin"
              className="mt-1 h-8 text-xs"
            />
          </Label>
          <Label className="text-[11px] text-neutral-500">
            Version
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="mt-1 h-8 text-xs"
            />
          </Label>
          <div className="col-span-2">
            <Label className="text-[11px] text-neutral-500">
              Description
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this plugin does"
                className="mt-1 h-8 text-xs"
              />
            </Label>
          </div>
          <Label className="text-[11px] text-neutral-500">
            Author
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="mt-1 h-8 text-xs"
            />
          </Label>
          <div className="col-span-2">
            <Label className="text-[11px] text-neutral-500">
              Privacy statement (required before install)
              <Textarea
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value)}
                placeholder="What data does this plugin access and why?"
                className="mt-1 min-h-16 text-xs"
              />
            </Label>
          </div>
        </div>
        <p className="mt-3 text-[11px] font-medium text-neutral-500">
          Declared capabilities
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {PLUGIN_CAP_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => toggle(declared, setDeclared, c.value)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                declared.includes(c.value)
                  ? "border-neutral-800 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] font-medium text-neutral-500">
          Granted capabilities (subset of declared — you approve each)
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {declared.length === 0 ? (
            <span className="text-[11px] text-neutral-400">
              Declare capabilities first.
            </span>
          ) : (
            PLUGIN_CAP_OPTIONS.filter((c) => declared.includes(c.value)).map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => toggle(requested, setRequested, c.value)}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  requested.includes(c.value)
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
                }`}
              >
                {c.label}
              </button>
            ))
          )}
        </div>
        <Button
          type="button"
          size="sm"
          className="mt-3 h-8"
          disabled={
            !name.trim() || !privacy.trim() || busy === "install"
          }
          onClick={() =>
            run("install", () =>
              install({
                slug: name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")
                  .slice(0, 40),
                name,
                version,
                description,
                author,
                declaredCapabilities: declared,
                requestedCapabilities: requested,
                privacyStatement: privacy,
              }),
            ).then(() => {
              setName("");
              setDescription("");
              setPrivacy("");
              setDeclared([]);
              setRequested([]);
            })
          }
        >
          {busy === "install" && <Loader2 className="size-3.5 animate-spin" />}
          <Plug className="size-3.5" />
          Install
        </Button>
      </div>

      {plugins && plugins.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-neutral-700">
            Installed plugins ({plugins.length})
          </p>
          {plugins.map((p) => (
            <div
              key={String(p._id)}
              className="rounded border border-neutral-100 bg-neutral-50/50 px-2 py-2"
            >
              <div className="flex items-center gap-2">
                <Plug className="size-3.5 shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800">
                  {p.name} <span className="font-normal text-neutral-400">v{p.version}</span>
                </span>
                <Badge
                  className={
                    p.status === "installed"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-neutral-200 text-neutral-600"
                  }
                >
                  {p.status}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={() =>
                    run("toggle", () =>
                      update({
                        pluginId: p._id as never,
                        enabled: p.status !== "installed",
                      }),
                    )
                  }
                >
                  {p.status === "installed" ? "Disable" : "Enable"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-red-500 hover:text-red-700"
                  onClick={() =>
                    run("uninstall", () =>
                      uninstall({ pluginId: p._id as never }),
                    )
                  }
                >
                  Uninstall
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">{p.description}</p>
              <p className="mt-1 text-[11px] text-neutral-400">
                Granted: {p.grantedCapabilities.join(", ") || "none"}
                {p.grantedCapabilities.length > 0 &&
                  p.grantedCapabilities.every((c) =>
                    ["github.read", "network", "files"].includes(c),
                  ) && " (sensitive — granted explicitly)"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime tab (I)
// ---------------------------------------------------------------------------

function RuntimeTab() {
  const prefs = useQuery(api.pushSubscriptions.myNotificationPrefs) as unknown as
    | { email: boolean; push: boolean; categories: string[] }
    | null
    | undefined;
  const savePrefs = useMutation(api.pushSubscriptions.saveNotificationPrefs);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefNote, setPrefNote] = useState<string | null>(null);

  const persistPrefs = async (
    next: { email: boolean; push: boolean; categories: string[] },
  ) => {
    setSavingPrefs(true);
    setPrefNote(null);
    try {
      await savePrefs(next);
      setPrefNote("Saved — notifications now follow these preferences.");
    } catch (e) {
      setPrefNote(e instanceof Error ? e.message : "Couldn't save preferences.");
    } finally {
      setSavingPrefs(false);
    }
  };
  const [state, setState] = useState<{
    width: number;
    pointer: boolean;
    touch: number;
    os: string;
    browser: string;
    connection: string;
  } | null>(null);

  const health = useQuery(api.health.recentHealthChecks) as unknown as
    | Array<{ check: string; ok: boolean }>
    | undefined;

  useEffect(() => {
    const nav = navigator as Navigator & {
      connection?: {
        effectiveType?: string;
        downlink?: number;
        rtt?: number;
        saveData?: boolean;
      };
    };
    const ua = navigator.userAgent;
    const os = /Mac/.test(ua)
      ? "macOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Android/.test(ua)
          ? "Android"
          : /iPhone|iPad/.test(ua)
            ? "iOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown";
    const browser = /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Unknown";
    setState({
      width: window.innerWidth,
      pointer: window.matchMedia("(pointer: fine)").matches,
      touch: navigator.maxTouchPoints,
      os,
      browser,
      connection: detectConnection(nav.connection ?? null),
    });
  }, []);

  const deviceClass = state
    ? detectDeviceClass(state.width, state.pointer, state.touch)
    : null;
  const deviceIcon =
    deviceClass === "mobile" ? (
      <Smartphone className="size-4" />
    ) : deviceClass === "tablet" ? (
      <Tablet className="size-4" />
    ) : (
      <Laptop className="size-4" />
    );

  const githubOk = health?.find((h) => h.check === "github")?.ok;
  const aiOk = health?.find((h) => h.check === "ai")?.ok;
  const authOk = health?.find((h) => h.check === "auth")?.ok;

  const capabilities: Array<{ label: string; ok: boolean; note: string }> = [
    { label: "Editor", ok: true, note: "Monaco in the browser" },
    { label: "Terminal", ok: true, note: "Integrated command center" },
    { label: "Preview", ok: true, note: "Live app preview" },
    { label: "GitHub", ok: githubOk === true, note: githubOk === undefined ? "Probe pending" : githubOk ? "API reachable" : "Probe failing" },
    { label: "AI", ok: aiOk === true, note: aiOk === undefined ? "Probe pending" : aiOk ? "Provider reachable" : "Probe failing" },
    { label: "Notifications", ok: true, note: "In-app + push + email" },
    { label: "Plugins", ok: true, note: "Declarative, capability-gated" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-200 p-3">
        <p className="text-xs font-medium text-neutral-700">Device</p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-neutral-600">
            {deviceIcon}
            <span>
              {deviceClass ?? "…"} · {state?.os ?? "…"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-neutral-600">
            <Globe className="size-3.5 text-neutral-400" />
            <span>
              {state?.browser ?? "…"} · {state?.connection ?? "…"}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 p-3">
        <p className="text-xs font-medium text-neutral-700">Active capabilities</p>
        <div className="mt-2 space-y-1.5">
          {capabilities.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-xs">
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  c.ok ? "bg-emerald-500" : "bg-neutral-300"
                }`}
              />
              <span className="w-28 shrink-0 text-neutral-700">{c.label}</span>
              <span className="truncate text-neutral-400">{c.note}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 p-3">
        <p className="text-xs font-medium text-neutral-700">Notification preferences</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-700">
          {(
            [
              { key: "email", label: "Email digests" },
              { key: "push", label: "Web push" },
            ] as const
          ).map((opt) => (
            <label key={opt.key} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={prefs ? prefs[opt.key] : true}
                disabled={!prefs || savingPrefs}
                onChange={(e) => {
                  if (!prefs) return;
                  void persistPrefs({
                    ...prefs,
                    [opt.key]: e.target.checked,
                  });
                }}
                className="size-3.5 accent-neutral-900"
              />
              {opt.label}
            </label>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["review", "assign", "security", "ci", "mission"].map((cat) => (
            <button
              key={cat}
              type="button"
              disabled={!prefs || savingPrefs}
              onClick={() => {
                if (!prefs) return;
                const cats = prefs.categories ?? [];
                const next = cats.includes(cat)
                  ? cats.filter((c) => c !== cat)
                  : [...cats, cat];
                void persistPrefs({ ...prefs, categories: next });
              }}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                (prefs?.categories ?? []).length === 0 ||
                (prefs?.categories ?? []).includes(cat)
                  ? "border-neutral-800 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-400"
              }`}
            >
              {cat}
            </button>
          ))}
          <span className="self-center text-[11px] text-neutral-400">
            {savingPrefs ? "Saving…" : "Empty = all categories"}
          </span>
        </div>
        {prefNote && <p className="mt-1.5 text-[11px] text-neutral-500">{prefNote}</p>}
      </div>

      <div className="rounded-md border border-neutral-200 p-3">
        <p className="text-xs font-medium text-neutral-700">Privacy</p>
        <p className="mt-1.5 text-xs leading-5 text-neutral-500">
          Capabilities are granted per session and per plugin. GitHub tokens are
          stored server-side and never shipped to the browser; AI prompts are
          sent only to the configured provider; telemetry is limited to product
          events (no file contents, no private keys); audit records store
          actions and paths — never secret values.
        </p>
      </div>

      {authOk === false && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The health probe reports an auth check failure — review the Admin
          console error log.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Release tab (N)
// ---------------------------------------------------------------------------

function ReleaseTab({
  owner,
  repo,
  branch,
  commit,
  orgId,
}: {
  owner: string;
  repo: string;
  branch: string;
  commit: string | null;
  orgId: string | null;
}) {
  if (!orgId) {
    return (
      <p className="py-6 text-center text-xs text-neutral-400">
        Create or select an organization to use the release gate.
      </p>
    );
  }
  return <ReleaseOrg owner={owner} repo={repo} branch={branch} commit={commit} orgId={orgId} />;
}

/** Release command center — mounted only when an org is selected. */
function ReleaseOrg({
  owner,
  repo,
  branch,
  commit,
  orgId,
}: {
  owner: string;
  repo: string;
  branch: string;
  commit: string | null;
  orgId: string;
}) {
  const fullName = `${owner}/${repo}`;
  const changeKey = /^[a-f0-9]{40}$/i.test(commit ?? "")
    ? (commit as string)
    : `branch:${fullName}:${branch}`;
  const status = useQuery(api.organizations.approvalStatus, {
    orgId: orgId as never,
    action: APPROVAL_ACTIONS.DEPLOY,
    branch,
    repo: fullName,
    changeKey,
  }) as unknown as {
    policy: { minRole: OrgRole; minApprovers: number } | null;
    approvalCount: number;
    satisfied: boolean;
    canApprove: boolean;
    actorRole: OrgRole;
  } | undefined;

  const securityCount = useQuery(
    api.securityCenter.listSecurityFindings,
    { repo: fullName },
  ) as unknown as Array<unknown> | undefined;
  const deps = useQuery(api.securityCenter.listDependencyReports, {
    repo: fullName,
  }) as unknown as Array<{ status: string }> | undefined;

  const recordRelease = useMutation(api.organizations.recordRelease);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deploy = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await recordRelease({
        orgId: orgId as never,
        repo: `${owner}/${repo}`,
        branch,
        commit: commit ?? "",
        action: APPROVAL_ACTIONS.DEPLOY,
      });
      setResult(
        `Deploy recorded (approval policy ${res.policyRequired ? "required and satisfied" : "not configured"}).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deploy was not recorded.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const vulnCount = deps?.filter((d) => d.status === "vulnerable").length ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Rocket className="size-4 text-neutral-400" />
        <p className="text-sm font-medium text-neutral-800">
          {owner}/{repo}
          <span className="ml-2 font-mono text-xs text-neutral-500">{branch}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-neutral-200 p-2.5">
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Security findings</p>
          <p className="mt-0.5 text-lg font-semibold text-neutral-800">
            {securityCount === undefined ? "…" : securityCount.length}
          </p>
        </div>
        <div className="rounded-md border border-neutral-200 p-2.5">
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Vulnerable deps</p>
          <p className="mt-0.5 text-lg font-semibold text-neutral-800">
            {vulnCount === null ? "…" : vulnCount}
          </p>
        </div>
      </div>

      {status?.policy ? (
        <div className="rounded-md border border-neutral-200 p-3">
          <p className="text-xs font-medium text-neutral-700">Deploy gate</p>
          <p className="mt-1 text-xs text-neutral-500">
            Policy requires {status.policy.minRole}+ and{" "}
            {status.policy.minApprovers} approval(s);{" "}
            {status.approvalCount} recorded.
          </p>
          <Badge
            className={`mt-2 ${
              status.satisfied
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {status.satisfied ? "Gate satisfied" : "Gate not satisfied"}
          </Badge>
        </div>
      ) : (
        <p className="text-xs text-neutral-400">
          No deploy policy is configured — a deploy would be recorded with no
          approval requirement.
        </p>
      )}

      {result && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {result}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {!confirming ? (
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5"
          disabled={
            !orgId ||
            busy ||
            !/^[a-f0-9]{40}$/i.test(commit ?? "") ||
            (status?.policy ? !status.satisfied : false)
          }
          onClick={() => setConfirming(true)}
          title={
            !orgId
              ? "Create/select an organization first"
              : !/^[a-f0-9]{40}$/i.test(commit ?? "")
                ? "Load a branch commit before recording a release"
                : status?.policy && !status.satisfied
                ? "Approve the deploy gate first"
                : "Record a controlled release"
          }
        >
          <Rocket className="size-3.5" />
          Deploy {branch}
        </Button>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex-1 text-xs text-amber-800">
            Deploy to production? This records a server-authoritative release
            entry in the audit log. Actual deployment to a hosting platform is
            an external dependency.
          </p>
          <Button
            type="button"
            size="sm"
            className="h-8 bg-red-600 text-white hover:bg-red-700"
            disabled={busy}
            onClick={deploy}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Confirm
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      )}
      <p className="text-[11px] leading-4 text-neutral-400">
        {!/^[a-f0-9]{40}$/i.test(commit ?? "") &&
          "Open or refresh a committed branch tip before recording a release. "}
        The release view reflects live scans (security findings, dependency
        reports) and the server-authoritative approval gate. It never fabricates
        a deployment.
      </p>
    </div>
  );
}

// CLI & API tab — personal access tokens for the Aria CLI (and future
// integrations). Tokens are scoped to the signed-in user, hashed at rest
// (plaintext shown exactly once), and revocable instantly. The CLI never
// sees the GitHub OAuth token.
function CliTab() {
  const tokens = useQuery(api.cli.listCliTokens);
  const create = useMutation(api.cli.createCliToken);
  const revoke = useMutation(api.cli.revokeCliToken);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; label: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await create({ label });
      setCreated(result);
      setLabel("");
      setCopied(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: Id<"cliTokens">) => {
    setBusy(true);
    setError(null);
    try {
      await revoke({ tokenId: id });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
        Personal access tokens let the{" "}
        <span className="font-medium text-neutral-700">Aria CLI</span> talk to
        the same backend you use in the browser —{" "}
        <code className="font-mono">whoami</code>, <code className="font-mono">repos</code>,{" "}
        <code className="font-mono">inbox</code>. Tokens are hashed at rest,
        scoped to your account, and never touch GitHub credentials.
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {created && (
        <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
          <p className="mb-1 text-[11px] font-medium text-emerald-800">
            Token created — copy it now. It is shown only once.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-[11px] text-emerald-900">
              {created.token}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 text-[11px]"
              onClick={() => {
                void navigator.clipboard.writeText(created.token);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-emerald-700">
            Save it with:{" "}
            <code className="font-mono">bun run cli -- login --token &lt;paste&gt;</code>
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. work laptop)"
          className="h-9 flex-1 text-sm"
        />
        <Button type="button" onClick={() => void handleCreate()} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <Terminal className="mr-1.5 size-3.5" />
          )}
          Create token
        </Button>
      </div>

      {tokens === undefined ? (
        <p className="text-xs text-neutral-400">Loading tokens…</p>
      ) : tokens.length === 0 ? (
        <p className="py-4 text-center text-xs text-neutral-400">
          No tokens yet — create one to use the CLI.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
          {tokens.map((t) => (
            <li key={String(t._id)} className="flex items-center gap-2 px-3 py-2">
              <Terminal className="size-3.5 shrink-0 text-neutral-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-neutral-800">
                  {t.label}
                </p>
                <p className="text-[10px] text-neutral-400">
                  {t.prefix} · created {new Date(t.createdAt).toLocaleDateString()}
                  {t.lastUsedAt
                    ? ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : " · never used"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 text-[11px] text-red-600 hover:bg-red-50"
                disabled={busy}
                onClick={() => void handleRevoke(t._id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Copy a string to the clipboard, with a fallback for sandboxed iframes. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** One provider row: status dot, env-var name with copy button, model. */
function ProviderRow({
  label,
  keyName,
  model,
  configured,
}: {
  label: string;
  keyName: string;
  model: string;
  configured: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={`size-2 shrink-0 rounded-full ${
          configured ? "bg-emerald-500" : "bg-neutral-300"
        }`}
        title={configured ? "Configured" : "Not configured"}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-neutral-800">
          {label}
          {!configured && (
            <span className="ml-1.5 text-[11px] font-normal text-neutral-400">
              not configured
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-[11px] text-neutral-500">
          {keyName}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[11px] text-neutral-400">
        {model}
      </span>
      <button
        type="button"
        onClick={async () => {
          const ok = await copyText(keyName);
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }
        }}
        className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        title={`Copy ${keyName}`}
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </li>
  );
}

/**
 * AI tab — live provider status + the exact keys to paste into the project's
 * Keys UI. Booleans and model names only; keys never leave the server.
 */
function AiTab() {
  const ai = useQuery(api.aiStatus.status);
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-[11px] leading-5 text-neutral-600">
        Aria's AI runs through providers configured with{" "}
        <span className="font-medium text-neutral-700">project keys</span> —
        they are read server-side and never exposed to the browser. Paste the
        key for any provider below into Freebuff's{" "}
        <span className="font-medium text-neutral-700">Keys</span> panel, then
        reload. The first configured provider wins (order:{" "}
        <code className="font-mono">AI_PROVIDER_ORDER</code>).
      </div>

      {ai === undefined ? (
        <div className="flex items-center gap-2 py-4 text-[11px] text-neutral-400">
          <Loader2 className="size-3.5 animate-spin" />
          Checking provider status…
        </div>
      ) : ai.configured ? (
        <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-[11px] text-emerald-800">
          An AI provider is configured — Aria is ready to use.
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-800">
          No AI provider is configured yet. Ask Aria, AI reviews, and the
          other AI features will show a setup error until you add one of the
          keys below.
        </div>
      )}

      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {(ai?.providers ?? []).map((p) => (
          <ProviderRow
            key={p.id}
            label={p.label}
            keyName={p.key}
            model={p.model}
            configured={p.configured}
          />
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2.5">
        <p className="text-[11px] text-neutral-500">
          Provider priority (comma list, first configured wins)
        </p>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyText("AI_PROVIDER_ORDER");
            if (ok) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }
          }}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <code className="font-mono">AI_PROVIDER_ORDER</code>
          {copied ? (
            <Check className="size-3.5 text-emerald-600" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

export function PlatformDialog({
  open,
  onOpenChange,
  owner,
  repo,
  branch,
  commit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  branch: string;
  commit: string | null;
}) {
  const orgs = useQuery(api.organizations.myOrgs);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tab, setTab] = useState("org");
  // Derive this from props so switching repositories while the dialog is
  // mounted never leaves approval/security queries pointed at the old repo.
  const currentRepo = `${owner}/${repo}`;

  const selectFirstOrg = useCallback(() => {
    if (orgs && orgs.length > 0 && !orgId) {
      setOrgId(String(orgs[0]._id));
    }
  }, [orgs, orgId]);

  useEffect(() => {
    if (open) selectFirstOrg();
  }, [open, selectFirstOrg]);

  const orgPicker = orgs && orgs.length > 1 ? (
    <div className="mb-3 flex items-center gap-2">
      <Boxes className="size-3.5 text-neutral-400" />
      <Select
        value={orgId ?? undefined}
        onValueChange={(v) => setOrgId(v)}
      >
        <SelectTrigger className="h-8 w-56 text-xs">
          <SelectValue placeholder="Select organization" />
        </SelectTrigger>
        <SelectContent>
          {orgs.map((o) => (
            <SelectItem key={String(o._id)} value={String(o._id)}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="size-4" />
            Platform
          </DialogTitle>
          <DialogDescription>
            Organizations, approvals, plugins, runtime, and releases. Everything
            here is enforced server-side.
          </DialogDescription>
        </DialogHeader>

        {orgPicker}

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="flex w-full flex-wrap justify-start">
            <TabsTrigger value="org">
              <Users className="mr-1.5 size-3.5" /> Org
            </TabsTrigger>
            <TabsTrigger value="approvals">
              <Shield className="mr-1.5 size-3.5" /> Approvals
            </TabsTrigger>
            <TabsTrigger value="plugins">
              <Plug className="mr-1.5 size-3.5" /> Plugins
            </TabsTrigger>
            <TabsTrigger value="runtime">
              <Cpu className="mr-1.5 size-3.5" /> Runtime
            </TabsTrigger>
            <TabsTrigger value="release">
              <Rocket className="mr-1.5 size-3.5" /> Release
            </TabsTrigger>
            <TabsTrigger value="cli">
              <Terminal className="mr-1.5 size-3.5" /> CLI & API
            </TabsTrigger>
            <TabsTrigger value="ai">
              <Sparkles className="mr-1.5 size-3.5" /> AI
            </TabsTrigger>
          </TabsList>

          <TabsContent value="org" className="mt-3">
            <OrgTab />
          </TabsContent>
          <TabsContent value="approvals" className="mt-3">
            <ApprovalsTab repo={currentRepo} branch={branch} commit={commit} orgId={orgId} />
          </TabsContent>
          <TabsContent value="plugins" className="mt-3">
            <PluginsTab />
          </TabsContent>
          <TabsContent value="runtime" className="mt-3">
            <RuntimeTab />
          </TabsContent>
          <TabsContent value="release" className="mt-3">
            <ReleaseTab
              owner={owner || currentRepo.split("/")[0] || ""}
              repo={repo || currentRepo.split("/")[1] || ""}
              branch={branch}
              commit={commit}
              orgId={orgId}
            />
          </TabsContent>
          <TabsContent value="cli" className="mt-3">
            <CliTab />
          </TabsContent>
          <TabsContent value="ai" className="mt-3">
            <AiTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
