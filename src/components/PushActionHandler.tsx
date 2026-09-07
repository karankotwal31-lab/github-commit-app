import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  isPushReviewAction,
  parseGithubPullTarget,
  scrubPushActionParams,
} from "@/lib/pushActions";

/**
 * Performs PR actions (approve / comment / merge) triggered from a push
 * notification. Two paths:
 *  1. The app was already open — the service worker posts a message
 *     ({ type: "aria-push-action" }) and we act immediately.
 *  2. The app was opened BY an action tap — the SW opens
 *     `/dashboard?ariaAction=...&ariaUrl=...`; this handler consumes and then
 *     removes the one-shot parameters.
 * Comment opens the PR on GitHub (it needs a human's words); approve and
 * merge run server-side with the signed-in user's token.
 */
export function PushActionHandler() {
  const submitReview = useAction(api.githubActions.submitReview);
  const mergePullRequest = useAction(api.githubActions.mergePullRequest);
  const handling = useRef(false);

  async function perform(action: string, url: string) {
    if (handling.current || !isPushReviewAction(action)) return;
    const target = parseGithubPullTarget(url);
    if (!target) return;

    handling.current = true;
    try {
      const { owner, repo, number } = target;
      if (action === "approve") {
        const request = submitReview({ owner, repo, number, event: "approve" });
        toast.promise(request, {
          loading: "Approving pull request…",
          success: () => `Approved ${owner}/${repo}#${number} ✅`,
          error: (e) => (e instanceof Error ? e.message : "Approval failed."),
        });
        await request;
        return;
      }

      if (action === "merge") {
        if (!window.confirm(`Merge ${owner}/${repo}#${number}?`)) return;
        const request = mergePullRequest({ owner, repo, number });
        toast.promise(request, {
          loading: "Merging pull request…",
          success: () => `Merged ${owner}/${repo}#${number} 🔀`,
          error: (e) => (e instanceof Error ? e.message : "Merge failed."),
        });
        await request;
        return;
      }

      // A comment needs the human's actual words; open the verified PR URL.
      window.open(target.url, "_blank", "noopener");
    } catch {
      // toast.promise owns the user-facing error. Keeping this catch prevents
      // an unhandled rejection while preserving the original action failure.
    } finally {
      handling.current = false;
    }
  }

  // Path 2: boot-time URL params (app opened by an action tap).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("ariaAction");
    const url = params.get("ariaUrl");
    if (action && url) {
      window.history.replaceState(
        {},
        "",
        scrubPushActionParams(window.location.href),
      );
      void perform(action, url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Path 1: live message from the service worker.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        action?: string;
        url?: string;
      } | null;
      if (data?.type === "aria-push-action" && data.action && data.url) {
        void perform(data.action, data.url);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
