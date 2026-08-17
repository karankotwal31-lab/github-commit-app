import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Bug,
  CheckCircle2,
  CreditCard,
  FileCode2,
  GitPullRequest,
  History,
  Inbox,
  Keyboard,
  MessageSquare,
  PlusCircle,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

/** True when the key event came from an editable element (inputs, Monaco's
 *  hidden textarea, contenteditable) — global shortcuts must never hijack
 *  typing or editor keystrokes. */
function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
}

/**
 * ⌘K command palette — jump anywhere in the workspace with the keyboard.
 * Every action maps to an existing surface (dialogs owned by WorkspaceView);
 * nothing new is invented here.
 *
 * Also owns the workspace-wide shortcuts:
 *   ⌘K / Ctrl+K   open the palette
 *   ⌘A / Ctrl+A   Ask Aria (never fires while typing in an editor/input)
 *   ?             open the palette (help)
 *   g i / p / h / c / v / a / r / s — two-key chords (press g, then a key)
 */
export function CommandPalette({
  onInbox,
  onReview,
  onIssue,
  onAi,
  onBilling,
  onAdmin,
  onStress,
  onVault,
  onPrs,
  onHistory,
  onCodeSearch,
}: {
  onInbox: () => void;
  onReview: () => void;
  onIssue: () => void;
  onAi: () => void;
  onBilling: () => void;
  onAdmin: () => void;
  onStress: () => void;
  onVault: () => void;
  onPrs: () => void;
  onHistory: () => void;
  onCodeSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  // When the user pressed `g` (the two-key chord prefix) and is waiting for
  // the second key — timestamp of the press, or null when idle.
  const [gAt, setGAt] = useState<number | null>(null);

  // Callbacks live in a ref so the global key listeners stay stable across
  // renders (the WorkspaceView passes inline arrows that change identity).
  const actionsRef = useRef({
    onInbox,
    onReview,
    onIssue,
    onAi,
    onBilling,
    onAdmin,
    onStress,
    onVault,
    onPrs,
    onHistory,
    onCodeSearch,
  });
  actionsRef.current = {
    onInbox,
    onReview,
    onIssue,
    onAi,
    onBilling,
    onAdmin,
    onStress,
    onVault,
    onPrs,
    onHistory,
    onCodeSearch,
  };

  // ⌘K / Ctrl+K toggles the palette; Esc closes it (cmdk handles Esc).
  // ⌘A / Ctrl+A asks Aria (unless the focus is in an editor/input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (k === "a" && !isTypingTarget(e)) {
        e.preventDefault();
        actionsRef.current.onAi();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // `?` opens the palette (Shift+/), and the `g`-chords jump to surfaces —
  // g i inbox · g p pull requests · g h history · g c code search ·
  // g v draft vault · g a ask Aria · g r AI review · g s stress test.
  // Both are ignored while typing in any editable element.
  useEffect(() => {
    if (gAt === null) return;
    const timer = setTimeout(() => setGAt(null), 1600);
    return () => clearTimeout(timer);
  }, [gAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e)) return;
      const k = e.key.toLowerCase();
      if (k === "?") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (k === "g") {
        e.preventDefault();
        setGAt(Date.now());
        return;
      }
      if (gAt !== null) {
        const chords: Record<string, () => void> = {
          i: actionsRef.current.onInbox,
          p: actionsRef.current.onPrs,
          h: actionsRef.current.onHistory,
          c: actionsRef.current.onCodeSearch,
          v: actionsRef.current.onVault,
          a: actionsRef.current.onAi,
          r: actionsRef.current.onReview,
          s: actionsRef.current.onStress,
        };
        setGAt(null);
        const fn = chords[k];
        if (fn) {
          e.preventDefault();
          fn();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gAt]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Inbox & code">
          <CommandItem onSelect={run(onInbox)}>
            <Inbox className="size-4" />
            Open unified inbox
            <CommandShortcut>g i</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(onReview)}>
            <CheckCircle2 className="size-4" />
            AI review this branch
            <CommandShortcut>Pro+</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(onIssue)}>
            <PlusCircle className="size-4" />
            Create issue
          </CommandItem>
          <CommandItem onSelect={run(onPrs)}>
            <GitPullRequest className="size-4" />
            Pull requests
            <CommandShortcut>g p</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(onHistory)}>
            <History className="size-4" />
            Commit history
            <CommandShortcut>g h</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(onCodeSearch)}>
            <Search className="size-4" />
            Search code
            <CommandShortcut>g c</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="AI">
          <CommandItem onSelect={run(onAi)}>
            <Sparkles className="size-4" />
            Ask Aria
            <CommandShortcut>⌘A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(onReview)}>
            <Bot className="size-4" />
            Generate commit message
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Workspace">
          <CommandItem onSelect={run(onVault)}>
            <FileCode2 className="size-4" />
            Draft vault
            <CommandShortcut>g v</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(onBilling)}>
            <CreditCard className="size-4" />
            Plans & billing
          </CommandItem>
          <CommandItem onSelect={run(onAdmin)}>
            <ShieldCheck className="size-4" />
            Team admin console
            <CommandShortcut>Team</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(onStress)}>
            <TerminalSquare className="size-4" />
            Run stress test
            <CommandShortcut>g s</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Help">
          <CommandItem onSelect={run(onAi)}>
            <MessageSquare className="size-4" />
            Explain this code
          </CommandItem>
          <CommandItem disabled>
            <Bug className="size-4" />
            Report a bug
            <CommandShortcut>karankotwal31@gmail.com</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Keyboard shortcuts">
          <CommandItem disabled>
            <Keyboard className="size-4" />
            Open this palette
            <CommandShortcut>⌘K</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>
            <Keyboard className="size-4" />
            Jump to a file
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>
            <Keyboard className="size-4" />
            Ask Aria
            <CommandShortcut>⌘A</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>
            <Keyboard className="size-4" />
            Inbox · PRs · History
            <CommandShortcut>g i · p · h</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>
            <Keyboard className="size-4" />
            Code search · Vault · Review
            <CommandShortcut>g c · v · r</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>
            <Keyboard className="size-4" />
            Show this list
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
