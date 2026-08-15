import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Diff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Lock,
  MonitorSmartphone,
  Music2,
  Plus,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Link } from "react-router";
import { PLANS } from "@/lib/plans";

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
    icon: MonitorSmartphone,
    title: "Continue anywhere",
    body: "Start an edit on your desktop and finish it on your phone. Aria remembers the repo, branch, open file, unsaved changes, and cursor — wherever you left off.",
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
    message: "Resume the phone draft on the desk",
    file: "src/pages/Dashboard.tsx",
    when: "yesterday",
  },
];

const FAKE_REPOS = [
  { name: "chaperon", meta: "main · 2d", active: true },
  { name: "aria", meta: "main · 5h", active: false },
  { name: "ne-ha-rfp", meta: "prod · 3d", active: false },
];

const FAKE_FILES = [
  { name: "main.py", size: "9.4 KB" },
  { name: "init.sql", size: "2.1 KB" },
  { name: "Dockerfile", size: "712 B" },
  { name: "README.md", size: "3.8 KB" },
];

const HIGHLIGHTS = [
  { icon: Zap, label: "One GitHub connection", note: "No local git setup" },
  { icon: ShieldCheck, label: "Token never leaves the server", note: "Browser-safe by design" },
  { icon: MonitorSmartphone, label: "Cross-device resumes", note: "Desktop ⇄ phone" },
];

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.18)]">
        <Music2 className="size-3.5" strokeWidth={2.4} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Aria</span>
      <span className="text-[15px] font-semibold tracking-tight text-neutral-400">.</span>
    </Link>
  );
}

function FadeIn({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function DeskPreview() {
  return (
    <div className="mx-auto mt-16 w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_50px_140px_-40px_rgba(0,43,45,0.45)]">
      {/* window bar */}
      <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50/60 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-300" />
          <span className="size-2.5 rounded-full bg-amber-300" />
          <span className="size-2.5 rounded-full bg-emerald-300" />
        </div>
        <span className="font-mono text-[11px] text-neutral-400">
          aria — personal desk
        </span>
        <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
          <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5">
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
                className={`rounded-md px-2 py-1.5 transition-colors ${
                  repo.active ? "bg-neutral-900 shadow-sm" : "hover:bg-neutral-50"
                }`}
              >
                <p
                  className={`truncate font-mono text-[11px] ${
                    repo.active ? "text-white" : "text-neutral-700"
                  }`}
                >
                  {repo.name}
                </p>
                <p className="truncate font-mono text-[9px] text-neutral-400">
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
                  i === 0 ? "bg-primary/10" : "hover:bg-neutral-50"
                }`}
              >
                <span
                  className={`truncate font-mono text-[11px] ${
                    i === 0 ? "text-primary" : "text-neutral-600"
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
              <motion.div
                key={i}
                initial={{ width: 0 }}
                animate={{ width: `${w}%` }}
                transition={{ duration: 0.6, delay: 0.4 + i * 0.08, ease: "easeOut" }}
                className="h-1.5 rounded-full bg-neutral-200"
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-1.5 border-t border-neutral-100 pt-2.5">
            <span className="flex-1 rounded-md border border-neutral-200 px-2 py-1 font-mono text-[9px] text-neutral-400">
              Commit message…
            </span>
            <span className="rounded-md bg-primary px-2 py-1 font-mono text-[9px] text-primary-foreground shadow-sm">
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
      {/* Top bar — sticky with a soft glass blur */}
      <header className="sticky top-0 z-50 border-b border-neutral-200/70 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Wordmark />
          <nav className="flex items-center gap-2 sm:gap-6">
            <a
              href="#how"
              className="hidden text-sm text-neutral-500 transition-colors hover:text-foreground sm:inline"
            >
              How it works
            </a>
            <a
              href="#features"
              className="hidden text-sm text-neutral-500 transition-colors hover:text-foreground sm:inline"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="hidden text-sm text-neutral-500 transition-colors hover:text-foreground sm:inline"
            >
              Pricing
            </a>
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
        {/* ambient glows */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(58%_58%_at_50%_0%,rgba(0,107,104,0.10),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 top-32 size-96 rounded-full bg-primary/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 top-64 size-96 rounded-full bg-[#2A9D8F]/10 blur-3xl"
        />

        <div className="relative mx-auto flex w-full max-w-6xl flex-col px-6 pb-24 pt-16 sm:pb-32 sm:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="mx-auto flex max-w-2xl flex-col items-center text-center"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/70 px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm backdrop-blur">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
              A personal GitHub desk
            </span>
            <h1 className="mt-7 text-balance text-5xl font-semibold leading-[1.03] tracking-tighter sm:text-7xl">
              Edit your GitHub files.
              <br />
              <span className="bg-gradient-to-r from-primary via-[#0E7C78] to-[#2A9D8F] bg-clip-text text-transparent">
                Commit from anywhere.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-pretty text-lg leading-7 text-neutral-500 sm:text-xl sm:leading-8">
              Aria is a quiet workspace for your GitHub — browse any
              repository, switch branches, create, rename, and delete files,
              review the diff, and push changes or open a pull request without
              ever leaving the page.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <Link
                to="/dashboard"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[0_10px_30px_-10px_rgba(0,107,104,0.55)] transition-all hover:bg-primary/90 hover:shadow-[0_12px_36px_-10px_rgba(0,107,104,0.65)] active:scale-[0.98]"
              >
                Open the desk
                <ArrowRight className="size-4" />
              </Link>
              <Link
                to="/auth"
                className="inline-flex h-11 items-center rounded-lg border border-neutral-300 bg-white/70 px-6 text-sm font-medium text-neutral-700 backdrop-blur transition-colors hover:border-neutral-400 hover:text-foreground"
              >
                Sign in
              </Link>
            </div>

            {/* Trust strip — honest, product-true highlights */}
            <div className="mt-14 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
              {HIGHLIGHTS.map((h) => (
                <div
                  key={h.label}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200/80 bg-white/60 px-4 py-3 text-left backdrop-blur"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <h.icon className="size-4" />
                  </span>
                  <span>
                    <span className="block text-xs font-semibold text-neutral-800">
                      {h.label}
                    </span>
                    <span className="block text-[11px] text-neutral-400">
                      {h.note}
                    </span>
                  </span>
                </div>
              ))}
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
      <section id="how" className="border-t border-neutral-200">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <FadeIn>
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
                  <Sparkles className="size-3.5" />
                  How it works
                </p>
                <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  Three steps from repo to push.
                </h2>
              </div>
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
              >
                Try it now
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </FadeIn>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <FadeIn key={step.n} delay={i * 0.08}>
                <div className="group relative flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white/60 p-7 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_20px_50px_-24px_rgba(0,43,45,0.3)]">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold tabular-nums tracking-widest text-primary">
                      {step.n}
                    </span>
                    {i < STEPS.length - 1 && (
                      <ArrowRight className="size-4 text-neutral-300" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight">
                    {step.title}
                  </h3>
                  <p className="text-[15px] leading-7 text-neutral-500">
                    {step.body}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-neutral-200 bg-white/40">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <FadeIn>
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
                What the desk can do
              </p>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Everything you need. Nothing you don&apos;t.
              </h2>
              <p className="mt-4 text-pretty text-base leading-7 text-neutral-500">
                Every feature is a real workflow — no bloat, no surprises.
                Each one is a click away in the workspace.
              </p>
            </div>
          </FadeIn>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, i) => (
              <FadeIn key={feature.title} delay={(i % 3) * 0.07}>
                <div className="group flex h-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_24px_56px_-28px_rgba(0,43,45,0.35)]">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <feature.icon className="size-4" />
                  </span>
                  <h3 className="text-base font-semibold tracking-tight">
                    {feature.title}
                  </h3>
                  <p className="text-[15px] leading-7 text-neutral-500">
                    {feature.body}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Recent activity */}
      <section className="border-t border-neutral-200">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-5 lg:gap-16">
            <FadeIn>
              <div className="lg:col-span-2">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
                  <GitCommitHorizontal className="size-3.5" />
                  Recent activity
                </p>
                <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  Your work, in one quiet feed.
                </h2>
                <p className="mt-4 text-base leading-7 text-neutral-500">
                  Commits, reviews, security findings, and mission updates land
                  in a single inbox — prioritized, plain-language, and never
                  auto-fixed without you.
                </p>
                <Link
                  to="/auth"
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
                >
                  See your inbox
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </FadeIn>
            <FadeIn delay={0.1}>
              <div className="lg:col-span-3">
                <div className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white shadow-[0_24px_60px_-32px_rgba(0,43,45,0.35)]">
                  {SAMPLE_COMMITS.map((commit) => (
                    <div
                      key={commit.sha}
                      className="flex items-baseline justify-between gap-6 px-6 py-4 transition-colors hover:bg-neutral-50/60"
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
                        <p className="mt-1 text-xs text-neutral-400">
                          {commit.when}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-neutral-200 bg-white/40">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <FadeIn>
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
                Pricing
              </p>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                One desk, every pace of work.
              </h2>
              <p className="mt-4 text-pretty text-base leading-7 text-neutral-500">
                The core desk is free forever. AI requests reset each month,
                and every upgrade activates instantly through Stripe.
              </p>
            </div>
          </FadeIn>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PLANS.map((tier, i) => (
              <FadeIn key={tier.id} delay={i * 0.07}>
                <div
                  className={`relative flex h-full flex-col rounded-2xl border p-7 transition-all hover:-translate-y-0.5 ${
                    tier.highlighted
                      ? "border-neutral-900 bg-neutral-900 text-white shadow-[0_30px_70px_-30px_rgba(0,20,22,0.6)]"
                      : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-[0_20px_50px_-28px_rgba(0,43,45,0.3)]"
                  }`}
                >
                  {tier.highlighted && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-sm">
                      Most popular
                    </span>
                  )}
                  <p
                    className={`text-xs font-medium uppercase tracking-[0.18em] ${
                      tier.highlighted ? "text-neutral-400" : "text-neutral-400"
                    }`}
                  >
                    {tier.name}
                  </p>
                  <p className="mt-3 text-4xl font-semibold tracking-tight">
                    {tier.priceLabel}
                    {tier.monthlyPrice !== undefined && tier.monthlyPrice > 0 && (
                      <span
                        className={`text-sm font-normal ${
                          tier.highlighted ? "text-neutral-400" : "text-neutral-500"
                        }`}
                      >
                        {" "}
                        /mo
                      </span>
                    )}
                  </p>
                  <p
                    className={`mt-2 text-sm leading-6 ${
                      tier.highlighted ? "text-neutral-300" : "text-neutral-500"
                    }`}
                  >
                    {tier.tagline}
                  </p>
                  <ul className="mt-6 space-y-2.5">
                    {tier.features.slice(0, 4).map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm leading-5">
                        <span
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                            tier.highlighted
                              ? "bg-primary/30 text-primary-foreground"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          <Check className="size-2.5" strokeWidth={3} />
                        </span>
                        <span
                          className={
                            tier.highlighted ? "text-neutral-200" : "text-neutral-600"
                          }
                        >
                          {f}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-7 flex-1" />
                  {tier.id === "enterprise" ? (
                    <a
                      href="mailto:karankotwal31@gmail.com?subject=Aria%20Enterprise"
                      className={`inline-flex h-10 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                        tier.highlighted
                          ? "border-neutral-700 text-neutral-200 hover:border-neutral-500"
                          : "border-neutral-300 text-neutral-700 hover:border-neutral-500"
                      }`}
                    >
                      Contact sales
                    </a>
                  ) : (
                    <Link
                      to="/auth"
                      className={`inline-flex h-10 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                        tier.highlighted
                          ? "bg-white text-neutral-900 hover:bg-neutral-200"
                          : "bg-neutral-900 text-white hover:bg-neutral-700"
                      }`}
                    >
                      {tier.monthlyPrice === 0 ? "Start free" : "Get started"}
                    </Link>
                  )}
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA band */}
      <section className="border-t border-neutral-200">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
          <FadeIn>
            <div className="relative overflow-hidden rounded-3xl bg-neutral-900 px-8 py-16 text-center text-white sm:px-16 sm:py-20">
              <div
                aria-hidden
                className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-primary/40 blur-3xl"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-24 -right-24 size-72 rounded-full bg-[#2A9D8F]/30 blur-3xl"
              />
              <div className="relative">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
                  Ready when you are
                </p>
                <h2 className="mx-auto mt-5 max-w-xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                  Your GitHub, without the friction.
                </h2>
                <p className="mx-auto mt-5 max-w-md text-base leading-7 text-neutral-400">
                  Connect once, work from any device, and keep your edits,
                  diffs, and reviews in one place.
                </p>
                <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
                  <Link
                    to="/dashboard"
                    className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-6 text-sm font-medium text-neutral-900 shadow-[0_10px_30px_-10px_rgba(255,255,255,0.4)] transition-all hover:bg-neutral-200 active:scale-[0.98]"
                  >
                    Open the desk
                    <ArrowRight className="size-4" />
                  </Link>
                  <Link
                    to="/auth"
                    className="inline-flex h-11 items-center rounded-lg border border-neutral-700 px-6 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white"
                  >
                    Sign in
                  </Link>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-neutral-400">
            <Link to="/privacy" className="transition-colors hover:text-neutral-700">
              Privacy
            </Link>
            <Link to="/terms" className="transition-colors hover:text-neutral-700">
              Terms
            </Link>
            <span className="hidden sm:inline">One desk. One GitHub. Nothing else.</span>
            <span>© 2026 Aria Labs · All rights reserved</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
