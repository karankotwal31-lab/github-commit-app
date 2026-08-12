import { motion } from "framer-motion";
import { ArrowRight, GitCommitHorizontal } from "lucide-react";
import { Link } from "react-router";

const STEPS = [
  {
    n: "01",
    title: "Connect GitHub",
    body: "Authorize once with your personal GitHub account. Your token stays server-side — nothing touches the browser.",
  },
  {
    n: "02",
    title: "Browse repositories",
    body: "A quiet file browser over your repos. Folders, files, sizes — no cloning, no terminals, no tabs.",
  },
  {
    n: "03",
    title: "Edit and commit",
    body: "Change any text file and commit straight to the default branch. Write the message, press commit, done.",
  },
];

const SAMPLE_COMMITS = [
  {
    sha: "a1b2c3d",
    message: "Tone down the hero copy",
    file: "src/pages/Landing.tsx",
    when: "2 min ago",
  },
  {
    sha: "9e8f7a1",
    message: "Fix empty-state spacing",
    file: "src/pages/Dashboard.tsx",
    when: "1 hr ago",
  },
  {
    sha: "4c5d6e7",
    message: "Add branch badge to editor header",
    file: "src/components/editor.tsx",
    when: "yesterday",
  },
];

function Wordmark() {
  return (
    <Link to="/" className="flex items-baseline gap-1">
      <span className="text-[15px] font-semibold tracking-tight">commit</span>
      <span className="text-[15px] font-semibold tracking-tight text-neutral-400">
        .
      </span>
    </Link>
  );
}

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased">
      {/* Top bar */}
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <Wordmark />
          <nav className="flex items-center gap-6">
            <Link
              to="/auth"
              className="text-sm text-neutral-500 transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
            >
              Open the desk
              <ArrowRight className="size-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-28 sm:py-36">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mx-auto flex max-w-2xl flex-col items-center text-center"
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-400">
            A personal GitHub desk
          </p>
          <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Edit your GitHub files.
            <br />
            <span className="text-neutral-400">Commit from the browser.</span>
          </h1>
          <p className="mt-7 max-w-lg text-pretty text-base leading-7 text-neutral-500 sm:text-lg sm:leading-8">
            commit. is a quiet workspace that connects to your GitHub account,
            lets you browse any repository, and pushes changes straight to the
            default branch — without leaving the page.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <Link
              to="/dashboard"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-neutral-900 px-5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
            >
              Open the desk
              <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/auth"
              className="inline-flex h-10 items-center rounded-md border border-neutral-200 px-5 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:text-foreground"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-8 text-xs text-neutral-400">
            For your personal GitHub account · Single user · v1
          </p>
        </motion.div>
      </section>

      {/* Workflow */}
      <section className="border-t border-neutral-200">
        <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28">
          <div className="grid gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="flex flex-col gap-3 bg-background p-8 sm:p-10"
              >
                <span className="text-xs font-medium tabular-nums tracking-widest text-neutral-400">
                  {step.n}
                </span>
                <h3 className="text-base font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="text-sm leading-6 text-neutral-500">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Commit log sample */}
      <section className="border-t border-neutral-200">
        <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-xl">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-400">
              <GitCommitHorizontal className="size-3.5" />
              Recent activity
            </p>
            <div className="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
              {SAMPLE_COMMITS.map((commit) => (
                <div
                  key={commit.sha}
                  className="flex items-baseline justify-between gap-6 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-neutral-900">
                      {commit.message}
                    </p>
                    <p className="mt-1 truncate font-mono text-xs text-neutral-400">
                      {commit.file}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-xs text-neutral-500">
                      {commit.sha}
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-400">
                      {commit.when}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-8">
          <Wordmark />
          <p className="text-xs text-neutral-400">
            One desk. One GitHub. Nothing else.
          </p>
        </div>
      </footer>
    </div>
  );
}
