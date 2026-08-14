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
import { PLANS, type PlanId } from "@/lib/plans";
import {
  ArrowUpRight,
  Check,
  Crown,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
} from "lucide-react";

const TIER_ORDER: PlanId[] = ["free", "pro", "pro_plus", "team", "enterprise"];

export function BillingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const plan = useQuery(api.billing.plan);
  const aiUsage = useQuery(api.aiUsage.getAiUsage);
  const createCheckout = useAction(api.billingActions.createCheckout);
  const createPortal = useAction(api.billingActions.createPortal);
  const [busy, setBusy] = useState<{ tier: PlanId } | "manage" | null>(null);
  const [seats, setSeats] = useState(5);

  const configured = plan?.configured ?? false;
  const current: PlanId = plan?.plan ?? "free";
  const quota = aiUsage?.quota ?? null;
  const used = aiUsage?.used ?? 0;

  const handleUpgrade = async (tier: "pro" | "pro_plus" | "team") => {
    setBusy({ tier });
    try {
      const { url } = await createCheckout(
        tier === "team" ? { tier, seats } : { tier },
      );
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

  const usagePct = quota && quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const exhausted = quota !== null && used >= quota;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="size-4 text-amber-600" />
            Aria plans
          </DialogTitle>
          <DialogDescription>
            Pick the tier that matches how you work. Billing runs through
            Stripe — your payment details never touch Aria.
          </DialogDescription>
        </DialogHeader>

        {/* Current plan + AI usage meter */}
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-neutral-800">
                Current plan —{" "}
                <span className="capitalize">{current.replace(/_/g, " ")}</span>
              </p>
              {plan?.currentPeriodEnd ? (
                <p className="mt-0.5 text-xs text-neutral-500">
                  Renews{" "}
                  {new Date(plan.currentPeriodEnd).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {configured
                    ? "Free plan — includes a monthly taste of Ask Aria."
                    : "Billing isn't configured yet — everything runs unlocked."}
                </p>
              )}
            </div>
            {current !== "free" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleManage}
                disabled={busy !== null}
              >
                {busy === "manage" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUpRight className="size-3.5" />
                )}
                Manage
              </Button>
            )}
          </div>

          {/* Ask Aria usage this month */}
          <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-neutral-700">
                Ask Aria this month
              </span>
              {quota === null ? (
                <span className="text-neutral-500">Unlimited</span>
              ) : (
                <span
                  className={
                    exhausted
                      ? "font-medium text-rose-600"
                      : "text-neutral-500"
                  }
                >
                  {used.toLocaleString()} of {quota.toLocaleString()} used
                </span>
              )}
            </div>
            {quota !== null && (
              <>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className={`h-full rounded-full transition-all ${
                      exhausted ? "bg-rose-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
                {exhausted && (
                  <p className="mt-1.5 text-[11px] leading-4 text-rose-600">
                    Limit reached this month — upgrade for a bigger quota, or
                    wait for the next billing cycle.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Tier ladder */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TIER_ORDER.map((id) => {
            const tier = PLANS.find((p) => p.id === id)!;
            const isCurrent = current === id;
            const rank = TIER_ORDER.indexOf(id);
            const currentRank = TIER_ORDER.indexOf(current);
            const canUpgrade = configured && tier.checkout && rank > currentRank;
            const isTeam = id === "team";
            return (
              <div
                key={id}
                className={`flex flex-col rounded-lg border p-4 ${
                  tier.highlighted
                    ? "border-amber-200 bg-amber-50/40"
                    : "border-neutral-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p
                    className={`text-xs font-medium uppercase tracking-wide ${
                      tier.highlighted ? "text-amber-700" : "text-neutral-500"
                    }`}
                  >
                    {tier.name}
                  </p>
                  {isCurrent && (
                    <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-2xl font-semibold tracking-tight text-neutral-900">
                  {tier.priceLabel}
                  {tier.monthlyPrice !== undefined && tier.monthlyPrice > 0 && (
                    <span className="text-sm font-normal text-neutral-500">
                      {" "}
                      /mo
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs leading-4 text-neutral-500">
                  {tier.tagline}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {tier.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-1.5 text-xs leading-4 text-neutral-600"
                    >
                      <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex-1" />

                {isTeam && (
                  <div className="mb-2 flex items-center justify-between rounded-md border border-neutral-200 bg-white px-2 py-1.5">
                    <span className="text-xs text-neutral-500">Seats</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Fewer seats"
                        onClick={() => setSeats((s) => Math.max(1, s - 1))}
                        className="flex size-6 items-center justify-center rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-100"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium tabular-nums">
                        {seats}
                      </span>
                      <button
                        type="button"
                        aria-label="More seats"
                        onClick={() => setSeats((s) => Math.min(100, s + 1))}
                        className="flex size-6 items-center justify-center rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-100"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                  </div>
                )}

                {id === "enterprise" ? (
                  <a
                    href="mailto:karankotwal31@gmail.com?subject=Aria%20Enterprise"
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-neutral-300 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                  >
                    Contact sales
                  </a>
                ) : isCurrent ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleManage}
                    disabled={busy !== null}
                  >
                    Manage subscription
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="w-full gap-1.5"
                    onClick={() => {
                      if (
                        canUpgrade &&
                        (id === "pro" || id === "pro_plus" || id === "team")
                      ) {
                        handleUpgrade(id);
                      } else {
                        toast.info(
                          "Billing isn't configured yet — once the STRIPE_* keys are set, checkout activates here.",
                        );
                      }
                    }}
                    disabled={busy !== null || (!configured && tier.checkout)}
                  >
                    {busy !== null &&
                    busy !== "manage" &&
                    busy.tier === id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Crown className="size-4" />
                    )}
                    {!configured && tier.checkout
                      ? "Setup pending"
                      : canUpgrade
                        ? `Upgrade to ${tier.name}`
                        : "Choose"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {!configured && (
          <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-[11px] leading-4 text-neutral-500">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-600" />
              Billing isn't configured yet — the app runs fully unlocked. Add
              the STRIPE_* keys (and one price id per tier) to activate
              checkout.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
