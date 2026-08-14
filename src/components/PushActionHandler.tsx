import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Performs PR actions (approve / comment / merge) triggered from a push
 * notification. Two paths:
 *  1. The app was already open — the service worker posts a message
 *     ({ type: "aria-push-action" }) and we act immediately.
 *  2. The app was opened BY an action tap — the SW opened
 *     `/?ariaAction=approve&ariaUrl=...` and we pick it up at boot, then
 *     scrub the query string so it doesn't linger.
 * Comment opens the PR on GitHub (it needs a human's words); approve and
 * merge run server-side with the signed-in user's token.
 */
export function PushActionHandler() {
  const submitReview = useAction(api.githubActions.submitReview);
  const mergePullRequest = useAction(api.githubActions.mergePullRequest);
  const handling = useRef(false);

  async function perform(action: string, url: string) {
    if (handling.current) return;
    handling.current = true;
    try {
      const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) {
        // Not a PR URL (or not github.com) — just open it.
        window.open(url, "_blank", "noopener");
        return;
      }
      const owner = match[1];
      const repo = match[2];
      const number = Number(match[3]);
      if (action === "approve") {
        toast.promise(submitReview({ owner, repo, number, event: "approve" }), {
          loading: "Approving pull request…",
          success: () => `Approved ${owner}/${repo}#${number} ✅`,
          error: (e) => e instanceof Error ? e.message : "Approval failed.",
        });
      } else if (action === "merge") {
        if (!window.confirm(`Merge ${owner}/${repo}#${number}?`)) return;
        toast.promise(mergePullRequest({ owner, repo, number }), {
          loading: "Merging pull request…",
          success: () => `Merged ${owner}/${repo}#${number} 🔀`,
          error: (e) => e instanceof Error ? e.message : "Merge failed.",
        });
      } else {
        // comment (or unknown): the human writes the words on GitHub.
        window.open(url, "_blank", "noopener");
      }
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
      // Scrub the params so refresh/re-share doesn't re-fire the action.
      const next = window.location.pathname + window.location.search
        .replace(/[?&]ariaAction=[^&]*/, "")
        .replace(/[?&]ariaUrl=[^&]*/, "");
      window.history.replaceState({}, "", next);
      void perform(action, url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Path 1: live message from the service worker.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; action?: string; url?: string } | null;
      if (data?.type === "aria-push-action" && data.action && data.url) {
        void perform(data.action, data.url);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
