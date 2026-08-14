import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { useEffect, useState } from "react";
import {
  Bot,
  Bug,
  CheckCircle2,
  CreditCard,
  FileCode2,
  GitPullRequest,
  History,
  Inbox,
  MessageSquare,
  PlusCircle,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

/**
 * ⌘K command palette — jump anywhere in the workspace with the keyboard.
 * Every action maps to an existing surface (dialogs owned by WorkspaceView);
 * nothing new is invented here.
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

  // ⌘K / Ctrl+K toggles the palette; Esc closes it (cmdk handles Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
            <CommandShortcut>Pro</CommandShortcut>
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
          </CommandItem>
          <CommandItem onSelect={run(onHistory)}>
            <History className="size-4" />
            Commit history
          </CommandItem>
          <CommandItem onSelect={run(onCodeSearch)}>
            <Search className="size-4" />
            Search code
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
      </CommandList>
    </CommandDialog>
  );
}
