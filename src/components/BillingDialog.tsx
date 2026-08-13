import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { errorMessage } from "@/lib/github";
import { ArrowUpRight, Check, Crown, Loader2, ShieldCheck } from "lucide-react";

const FREE_FEATURES = [
  "Browse, edit, stage & commit to any repo",
  "Branches, pull requests, merge & revert",
  "CI status, PR review, code search, issues",
  "Draft vault + cross-device continuity",
  "Live presence + runtime plugins",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Ask Aria — the grounded AI assistant",
  "Priority model access as new models ship",
];

export function BillingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const plan = useQuery(api.billing.plan);
  const createCheckout = useAction(api.billingActions.createCheckout);
  const createPortal = useAction(api.billingActions.createPortal);
  const [busy, setBusy] = useState<"upgrade" | "manage" | null>(null);

  const configured = plan?.configured ?? false;
  const isPro = plan?.plan === "pro";

  const handleUpgrade = async () => {
    setBusy("upgrade");
    try {
      const { url } = await createCheckout();
      // Hosted Stripe Checkout — full-tab navigation is fine (it returns here).
      window.location.href = url;
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  const handleManage = async () => {
    setBusy("manage");
    try {
      const { url } = await createPortal();
      window.location.href = url;
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="size-4 text-amber-600" />
            Aria Pro
          </DialogTitle>
          <DialogDescription>
            One subscription, every feature. Billing runs through Stripe — your
            payment details never touch Aria.
          </DialogDescription>
        </DialogHeader>

        {/* Current plan */}
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-800">
              Current plan
            </p>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                isPro
                  ? "bg-amber-50 text-amber-700"
                  : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {isPro ? "Pro" : "Free"}
            </span>
          </div>
          {isPro && plan?.currentPeriodEnd ? (
            <p className="mt-1 text-xs text-neutral-500">
              Renews{" "}
              {new Date(plan.currentPeriodEnd).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">
              Free plan — everything except the AI assistant.
            </p>
          )}
        </div>

        {/* Feature comparison */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-neutral-200 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Free
            </p>
            <ul className="mt-2 space-y-1.5">
              {FREE_FEATURES.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-1.5 text-xs leading-4 text-neutral-600"
                >
                  <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-amber-700">
              <Crown className="size-3" /> Pro
            </p>
            <ul className="mt-2 space-y-1.5">
              {PRO_FEATURES.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-1.5 text-xs leading-4 text-neutral-700"
                >
                  <Check className="mt-0.5 size-3 shrink-0 text-amber-600" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Action */}
        {!configured ? (
          <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-[11px] leading-4 text-neutral-500">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-600" />
              Billing isn't configured yet — the app runs fully unlocked. Add
              the STRIPE_* keys to activate the Pro tier.
            </p>
          </div>
        ) : isPro ? (
          <Button
            type="button"
            className="w-full gap-2"
            onClick={handleManage}
            disabled={busy !== null}
          >
            {busy === "manage" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUpRight className="size-4" />
            )}
            Manage subscription
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full gap-2"
            onClick={handleUpgrade}
            disabled={busy !== null}
          >
            {busy === "upgrade" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Crown className="size-4" />
            )}
            Upgrade to Pro
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
