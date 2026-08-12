import { motion } from "framer-motion";
import {
  ArrowRight,
  Diff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Lock,
  Plus,
} from "lucide-react";
import { Link } from "react-router";

const STEPS = [
  {
    n: "01",
    title: "Connect GitHub",
    body: "Authorize once with your personal account. The token lives server-side — nothing touches the browser.",
  },
  {
    n: "02",
    title: "Pick a repo and a branch",
    body: "Browse any repository, switch branches in a click, or create a fresh one to work in.",
  },
  {
    n: "03",
    title: "Edit, review, commit",
    body: "Change, create, rename, or delete files — see the diff first, then commit or open a pull request without leaving the page.",
  },
];

const FEATURES = [
  {
    icon: GitBranch,
    title: "Branches, without the terminal",
    body: "Switch and create branches from the file browser. Work safely on a branch, then merge when you're ready.",
  },
  {
    icon: Diff,
    title: "Diff before you commit",
    body: "A quiet green-and-red review of exactly what changed — line by line, before anything is pushed.",
  },
  {
    icon: Plus,
    title: "Create, rename, delete",
    body: "Full file operations, not just edits. Add new files, move them, or remove them with a single commit.",
  },
  {
    icon: GitPullRequest,
    title: "Pull requests in one click",
    body: "Commit on a branch and open a PR straight from the desk — title filled in, link ready.",
  },
  {
    icon: GitCommitHorizontal,
    title: "One quiet workspace",
    body: "No cloning, no terminals, no tabs. Every repository you own or collaborate on, in one place.",
  },
  {
    icon: Lock,
    title: "Your token stays server-side",
    body: "The OAuth token never leaves the backend. The browser only ever sees the files you're working on.",
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
    message: "Add diff toggle to the editor",
    file: "src/pages/Dashboard.tsx",
    when: "1 hr ago",
  },
  {
    sha: "4c5d6e7",
    message: "Allow creating branches from the picker",
    file: "src/pages/Dashboard.tsx",
    when: "yesterday",
  },
];

const FAKE_REPOS = [
  { name: "chaperon", meta: "main · 2d", active: true },
  { name: "commit.", meta: "main · 5h", active: false },
  { name: "ne-ha-rfp", meta: "prod · 3d", active: false },
];

const FAKE_FILES = [
  { name: "main.py", size: "9.4 KB" },
  { name: "init.sql", size: "2.1 KB" },
  { name: "Dockerfile", size: "712 B" },
  { name: "README.md", size: "3.8 KB" },
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

function DeskPreview() {
  return (
    <div className="mx-auto mt-16 w-full max-w-3xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_40px_120px_-48px_rgba(0,0,0,0.35)]">
      {/* window bar */}
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-neutral-200" />
          <span className="size-2 rounded-full bg-neutral-200" />
          <span className="size-2 rounded-full bg-neutral-200" />
        </div>
        <span className="font-mono text-[11px] text-neutral-400">
          commit. — personal desk
        </span>
        <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3" />
            main
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-neutral-100">
        {/* repos */}
        <div className="p-3">
          <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
            Repositories
          </p>
          <div className="space-y-1">
            {FAKE_REPOS.map((repo) => (
              <div
                key={repo.name}
                className={`rounded-md px-2 py-1.5 ${
                  repo.active ? "bg-neutral-900" : ""
                }`}
              >
                <p
                  className={`truncate font-mono text-[11px] ${
                    repo.active ? "text-white" : "text-neutral-700"
                  }`}
                >
                  {repo.name}
                </p>
                <p
                  className={`truncate font-mono text-[9px] ${
                    repo.active ? "text-neutral-400" : "text-neutral-400"
                  }`}
                >
                  {repo.meta}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* files */}
        <div className="p-3">
          <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
            Files
          </p>
          <div className="space-y-0.5">
            {FAKE_FILES.map((file, i) => (
              <div
                key={file.name}
                className={`flex items-center justify-between rounded-md px-2 py-1 ${
                  i === 0 ? "bg-neutral-100" : ""
                }`}
              >
                <span
                  className={`truncate font-mono text-[11px] ${
                    i === 0 ? "text-neutral-900" : "text-neutral-600"
                  }`}
                >
                  {file.name}
                </span>
                <span className="font-mono text-[9px] text-neutral-400">
                  {file.size}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* editor */}
        <div className="flex flex-col p-3">
          <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
            Editor
          </p>
          <div className="flex-1 space-y-1.5 px-1">
            {[92, 68, 80, 40, 74, 56].map((w, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full bg-neutral-200"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-1.5 border-t border-neutral-100 pt-2.5">
            <span className="flex-1 rounded-md border border-neutral-200 px-2 py-1 font-mono text-[9px] text-neutral-400">
              Commit message…
            </span>
            <span className="rounded-md bg-neutral-900 px-2 py-1 font-mono text-[9px] text-white">
              Commit
            </span>
          </div>
        </div>
      </div>
    </div>
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
      <section className="relative overflow-hidden">
        {/* soft ambient glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(0,0,0,0.045),transparent)]"
        />

        <div className="relative mx-auto flex w-full max-w-5xl flex-col px-6 pb-24 pt-20 sm:pb-32 sm:pt-28">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="mx-auto flex max-w-2xl flex-col items-center text-center"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-400">
              A personal GitHub desk
            </p>
            <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Edit your GitHub files.
              <br />
              <span className="text-neutral-400">Commit from anywhere.</span>
            </h1>
            <p className="mt-7 max-w-lg text-pretty text-base leading-7 text-neutral-500 sm:text-lg sm:leading-8">
              commit. is a quiet workspace for your GitHub — browse any
              repository, switch branches, create, rename, and delete files,
              review the diff, and push changes or open a pull request without
              ever leaving the page.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <Link
                to="/dashboard"
                className="inline-flex h-10 items-center gap-2 rounded-md bg-neutral-900 px-5 text-sm font-medium text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] transition-all hover:bg-neutral-700 hover:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.55)]"
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
          >
            <DeskPreview />
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-neutral-200">
        <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-400">
            How it works
          </p>
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 sm:grid-cols-3">
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

      {/* Features */}
      <section className="border-t border-neutral-200">
        <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-400">
            What the desk can do
          </p>
          <div className="mt-8 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex flex-col gap-2.5">
                <feature.icon className="size-4 text-neutral-500" />
                <h3 className="text-sm font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="text-sm leading-6 text-neutral-500">
                  {feature.body}
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
