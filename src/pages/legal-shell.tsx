import { Link } from "react-router";
import { Wordmark } from "@/components/workspace-shared";
import { type ReactNode } from "react";

/**
 * Shared shell for public legal pages (Privacy / Terms). Minimalist, in the
 * sea-glass theme, with a back link to the landing page and simple prose
 * typography. No auth, no backend calls — pages render for anyone.
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-6">
          <Link to="/" aria-label="Back to Aria">
            <Wordmark />
          </Link>
          <Link
            to="/"
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            ← Back to Aria
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
          Legal
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-neutral-400">Last updated: {updated}</p>

        <div className="mt-10 space-y-8 text-[15px] leading-7 text-neutral-700">
          {children}
        </div>
      </main>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-6">
          <Wordmark />
          <p className="text-xs text-neutral-400">
            © {new Date().getFullYear()} Aria. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight text-neutral-900">
        {heading}
      </h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
