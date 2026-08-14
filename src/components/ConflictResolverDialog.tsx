import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  applyChoices,
  threeWayMerge,
  type MergeHunk,
} from "@/lib/merge3";
import {
  decodeText,
  encodeText,
  type ConflictFile,
} from "@/lib/localGit";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileCode2,
  GitMerge,
  Loader2,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";

type HunkChoice = "ours" | "theirs" | "base" | string[];

interface FileState {
  path: string;
  deleted: boolean;
  choices: HunkChoice[];
  saved: boolean;
  editing: boolean;
  customText: string;
}

const LINE_CLASS = "whitespace-pre-wrap break-all font-mono text-[11px] leading-5";

function HunkRow({
  lines,
  tone,
}: {
  lines: string[];
  tone: "base" | "ours" | "theirs";
}) {
  const tones: Record<typeof tone, string> = {
    base: "bg-neutral-50 text-neutral-500",
    ours: "bg-emerald-50/70 text-emerald-900",
    theirs: "bg-sky-50/70 text-sky-900",
  };
  const labels: Record<typeof tone, string> = {
    base: "base",
    ours: "ours",
    theirs: "theirs",
  };
  if (lines.length === 0) {
    return (
      <div
        className={cn(
          "border-b px-3 py-1 text-[10px] italic",
          tone === "base" ? "text-neutral-400" : tone === "ours" ? "text-emerald-600" : "text-sky-600",
        )}
      >
        {labels[tone]} · deleted
      </div>
    );
  }
  return (
    <div className={cn("border-b px-3 py-1", tones[tone])}>
      <div className="mb-0.5 text-[9px] font-medium uppercase tracking-[0.14em] opacity-60">
        {labels[tone]}
      </div>
      {lines.map((line, i) => (
        <div key={i} className={LINE_CLASS}>
          {line}
        </div>
      ))}
    </div>
  );
}

export function ConflictResolverDialog({
  open,
  onOpenChange,
  kind,
  files,
  busy,
  onSaveFile,
  onFinish,
  onAbort,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "merge" | "rebase" | "cherry-pick" | null;
  files: ConflictFile[];
  busy: boolean;
  onSaveFile: (path: string, content: Uint8Array | null) => Promise<void>;
  onFinish: () => Promise<void>;
  onAbort: () => Promise<void>;
}) {
  const [fileStates, setFileStates] = useState<FileState[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [currentHunk, setCurrentHunk] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [aborting, setAborting] = useState(false);

  // Reset local state whenever a new conflict set arrives.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setFileStates(
        files.map((f) => ({
          path: f.path,
          deleted: false,
          choices: [],
          saved: false,
          editing: false,
          customText: "",
        })),
      );
      setActiveFile(files[0]?.path ?? null);
      setCurrentHunk(0);
    }, 0);
    return () => clearTimeout(timer);
  }, [open, files]);

  const chunksByFile = useMemo(() => {
    const map = new Map<string, MergeHunk[]>();
    for (const f of files) {
      if (f.binary) {
        map.set(f.path, []);
        continue;
      }
      const merged = threeWayMerge(
        f.base === null ? "" : decodeText(f.base),
        f.ours === null ? "" : decodeText(f.ours),
        f.theirs === null ? "" : decodeText(f.theirs),
      );
      map.set(f.path, merged.chunks.filter((c) => c.kind === "conflict"));
    }
    return map;
  }, [files]);

  const activeChunks = activeFile ? (chunksByFile.get(activeFile) ?? []) : [];

  const setChoice = useCallback(
    (path: string, hunkIndex: number, choice: HunkChoice) => {
      setFileStates((prev) =>
        prev.map((fs) => {
          if (fs.path !== path) return fs;
          const choices = [...fs.choices];
          choices[hunkIndex] = choice;
          const deleted = choices.some((c, i) => {
            const ch = chunksByFile.get(path)?.[i];
            if (!ch) return false;
            return (
              (c === "ours" && ch.ours.length === 0) ||
              (c === "theirs" && ch.theirs.length === 0)
            );
          });
          return { ...fs, choices, deleted };
        }),
      );
    },
    [chunksByFile],
  );

  function resolveChunk(chunk: MergeHunk, choice: HunkChoice | undefined): string[] {
    if (choice === "theirs") return chunk.theirs;
    if (choice === "base") return chunk.base;
    if (Array.isArray(choice)) return choice;
    return chunk.ours; // default: ours
  }

  const fileDeleted = (path: string) =>
    fileStates.find((f) => f.path === path)?.deleted ?? false;

  const handleSave = async (path: string) => {
    if (saving) return;
    setSaving(path);
    try {
      if (fileDeleted(path)) {
        await onSaveFile(path, null);
      } else {
        const fs = fileStates.find((f) => f.path === path);
        const content = fs?.editing ? fs.customText : currentPreviewFor(path);
        await onSaveFile(path, encodeText(content ?? ""));
      }
      setFileStates((prev) =>
        prev.map((f) => (f.path === path ? { ...f, saved: true } : f)),
      );
      // Advance to the next unresolved file.
      const next = files.find(
        (f) =>
          f.path !== path &&
          !fileStates.find((s) => s.path === f.path)?.saved,
      );
      if (next) {
        setActiveFile(next.path);
        setCurrentHunk(0);
      }
    } finally {
      setSaving(null);
    }
  };

  function currentPreviewFor(path: string): string {
    const fs = fileStates.find((f) => f.path === path);
    if (!fs) return "";
    const file = files.find((f) => f.path === path);
    if (!file || file.binary) return "";
    if (fs.editing) return fs.customText;
    const full = threeWayMerge(
      file.base === null ? "" : decodeText(file.base),
      file.ours === null ? "" : decodeText(file.ours),
      file.theirs === null ? "" : decodeText(file.theirs),
    );
    let conflictIndex = 0;
    const flat: MergeHunk[] = [];
    for (const chunk of full.chunks) {
      if (chunk.kind === "conflict") {
        flat.push({
          kind: "common",
          base: resolveChunk(chunk, fs.choices[conflictIndex] ?? "ours"),
          ours: [],
          theirs: [],
        });
        conflictIndex++;
      } else {
        flat.push(chunk);
      }
    }
    return applyChoices(flat, () => "base");
  }

  const allSaved = files.length > 0 && files.every((f) =>
    fileStates.find((s) => s.path === f.path)?.saved,
  );

  // Keyboard shortcuts: a = accept ours, t = accept theirs, j/k = hunk nav,
  // s = save file, n = next file.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!activeFile) return;
      const key = e.key.toLowerCase();
      if (key === "a") {
        e.preventDefault();
        const chunk = activeChunks[currentHunk];
        if (chunk) setChoice(activeFile, currentHunk, "ours");
      } else if (key === "t") {
        e.preventDefault();
        const chunk = activeChunks[currentHunk];
        if (chunk) setChoice(activeFile, currentHunk, "theirs");
      } else if (key === "j") {
        e.preventDefault();
        setCurrentHunk((h) => Math.min(h + 1, Math.max(activeChunks.length - 1, 0)));
      } else if (key === "k") {
        e.preventDefault();
        setCurrentHunk((h) => Math.max(h - 1, 0));
      } else if (key === "s") {
        e.preventDefault();
        void handleSave(activeFile);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, activeFile, activeChunks, currentHunk, setChoice, handleSave]);

  const activeState = fileStates.find((f) => f.path === activeFile);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="size-4 text-amber-600" />
            Resolve conflicts
            {kind && (
              <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                {kind}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex gap-4">
            {/* File list */}
            <div className="w-56 shrink-0">
              <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                Conflicted files
              </p>
              <ul className="space-y-1">
                {files.map((f) => {
                  const state = fileStates.find((s) => s.path === f.path);
                  const active = activeFile === f.path;
                  return (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFile(f.path);
                          setCurrentHunk(0);
                        }}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs",
                          active
                            ? "bg-neutral-900 text-white"
                            : "text-neutral-700 hover:bg-neutral-100",
                        )}
                      >
                        {state?.saved ? (
                          <Check className="size-3 shrink-0 text-emerald-500" />
                        ) : (
                          <AlertTriangle
                            className={cn(
                              "size-3 shrink-0",
                              active ? "text-amber-400" : "text-amber-500",
                            )}
                          />
                        )}
                        <span className="truncate font-mono">{f.path}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[10px] leading-4 text-neutral-500">
                <span className="font-medium text-neutral-600">Shortcuts</span>
                <br />
                <Kbd>a</Kbd> ours · <Kbd>t</Kbd> theirs
                <br />
                <Kbd>j</Kbd>/<Kbd>k</Kbd> hunk · <Kbd>s</Kbd> save file
              </div>
            </div>

            {/* Hunk resolution */}
            <div className="min-w-0 flex-1">
              {!activeFile ? (
                <p className="py-8 text-center text-xs text-neutral-400">
                  Select a file to resolve.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-neutral-200">
                  <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                    <p className="truncate font-mono text-xs font-medium text-neutral-800">
                      {activeFile}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          setFileStates((prev) =>
                            prev.map((f) =>
                              f.path === activeFile
                                ? {
                                    ...f,
                                    choices: activeChunks.map(() => "ours"),
                                  }
                                : f,
                            ),
                          )
                        }
                      >
                        All ours
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          setFileStates((prev) =>
                            prev.map((f) =>
                              f.path === activeFile
                                ? {
                                    ...f,
                                    choices: activeChunks.map(() => "theirs"),
                                  }
                                : f,
                            ),
                          )
                        }
                      >
                        All theirs
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          setFileStates((prev) =>
                            prev.map((f) =>
                              f.path === activeFile
                                ? {
                                    ...f,
                                    editing: !f.editing,
                                    customText:
                                      f.customText ||
                                      (files.find((x) => x.path === activeFile)
                                        ?.binary
                                        ? ""
                                        : currentPreviewFor(activeFile)),
                                  }
                                : f,
                            ),
                          )
                        }
                        title="Edit the resolved file manually"
                      >
                        <Pencil className="mr-1 size-3" />
                        Manual
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={saving === activeFile}
                        onClick={() => void handleSave(activeFile)}
                      >
                        {saving === activeFile ? (
                          <Loader2 className="mr-1 size-3 animate-spin" />
                        ) : (
                          <Check className="mr-1 size-3" />
                        )}
                        Save file
                      </Button>
                    </div>
                  </div>

                  {activeState?.editing ? (
                    <textarea
                      value={activeState.customText}
                      onChange={(e) =>
                        setFileStates((prev) =>
                          prev.map((f) =>
                            f.path === activeFile
                              ? { ...f, customText: e.target.value }
                              : f,
                          ),
                        )
                      }
                      className="h-72 w-full resize-none bg-white p-3 font-mono text-[11px] leading-5 text-neutral-800 outline-none"
                      spellCheck={false}
                    />
                  ) : activeChunks.length === 0 ? (
                    <div className="p-6 text-center text-xs text-neutral-500">
                      <FileCode2 className="mx-auto mb-2 size-5 text-neutral-300" />
                      {(() => {
                        const file = files.find((f) => f.path === activeFile);
                        return file?.binary
                          ? "Binary file — use one whole side below."
                          : "No conflict hunks.";
                      })()}
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-auto">
                      {activeChunks.map((chunk, index) => (
                        <div
                          key={index}
                          className={cn(
                            "border-b border-neutral-200",
                            index === currentHunk && "bg-amber-50/50",
                          )}
                        >
                          <div className="flex items-center justify-between bg-neutral-50 px-3 py-1.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                              Conflict {index + 1} / {activeChunks.length}
                            </p>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-6 px-2 text-[10px]",
                                  (fileStates.find((f) => f.path === activeFile)
                                    ?.choices[index]) === "ours" &&
                                    "bg-emerald-100 text-emerald-800",
                                )}
                                onClick={() =>
                                  setChoice(activeFile, index, "ours")
                                }
                              >
                                {chunk.ours.length === 0 ? "Ours (delete)" : "Ours"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-6 px-2 text-[10px]",
                                  (fileStates.find((f) => f.path === activeFile)
                                    ?.choices[index]) === "theirs" &&
                                    "bg-sky-100 text-sky-800",
                                )}
                                onClick={() =>
                                  setChoice(activeFile, index, "theirs")
                                }
                              >
                                {chunk.theirs.length === 0
                                  ? "Theirs (delete)"
                                  : "Theirs"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-6 px-2 text-[10px]",
                                  (fileStates.find((f) => f.path === activeFile)
                                    ?.choices[index]) === "base" &&
                                    "bg-neutral-200 text-neutral-700",
                                )}
                                onClick={() =>
                                  setChoice(activeFile, index, "base")
                                }
                              >
                                Base
                              </Button>
                            </div>
                          </div>
                          <HunkRow lines={chunk.base} tone="base" />
                          <HunkRow lines={chunk.ours} tone="ours" />
                          <HunkRow lines={chunk.theirs} tone="theirs" />
                        </div>
                      ))}
                    </div>
                  )}

                  {activeState?.deleted && (
                    <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                      <X className="mr-1 inline size-3" />
                      This file will be deleted when you save.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={aborting || busy}
            onClick={() => {
              setAborting(true);
              void onAbort().finally(() => setAborting(false));
            }}
          >
            <RotateCcw className="mr-1.5 size-3.5" />
            Abort
          </Button>
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-neutral-400">
              {files.filter((f) =>
                fileStates.find((s) => s.path === f.path)?.saved,
              ).length}{" "}
              / {files.length} resolved
            </p>
            <Button
              type="button"
              size="sm"
              disabled={!allSaved || busy || finishing}
              onClick={() => {
                setFinishing(true);
                void onFinish().finally(() => setFinishing(false));
              }}
            >
              {finishing ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 size-3.5" />
              )}
              {kind === "rebase" ? "Continue rebase" : "Finish"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-neutral-300 bg-white px-1 py-0.5 font-mono text-[9px] text-neutral-600">
      {children}
    </kbd>
  );
}
