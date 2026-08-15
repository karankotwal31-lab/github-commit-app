import { useEffect, useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import { formatSize } from "@/lib/github";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import "@/lib/monaco";
import { languageForPath } from "@/lib/monaco";
import { getCursorSync, setCursorSync } from "@/lib/cursorSync";
import { getScrollSync, setScrollSync } from "@/lib/scrollSync";
import { FileTabs } from "@/components/FileTabs";
import {
  notifyCursorMove,
  notifyFocus,
  setActiveEditor,
} from "@/lib/editorRegistry";

// The active-editor registry lives in @/lib/editorRegistry (type-only monaco
// import) so the workspace chrome can insert symbols / detect focus without
// pulling the Monaco runtime into the main bundle.

export interface EditorCursor {
  line: number;
  column: number;
}

/** A peer editing the same file right now (live collaboration). */
export interface EditorPeer {
  deviceId: string;
  label: string;
  line: number;
  column: number;
}

/** Files at or above this size open through the lightweight-preview gate
 *  instead of loading straight into Monaco. Monaco never mounts for these
 *  until the user explicitly asks for the full editor. */
const LARGE_FILE_BYTES = 1024 * 1024;
/** Lightweight preview shows the first N lines. */
const LARGE_FILE_PREVIEW_LINES = 8000;

function LargeFilePreview({
  path,
  content,
  onLoadFull,
}: {
  path: string;
  content: string;
  onLoadFull: () => void;
}) {
  const lines = content.split("\n");
  const showAll = lines.length <= LARGE_FILE_PREVIEW_LINES;
  const preview = showAll
    ? content
    : lines.slice(0, LARGE_FILE_PREVIEW_LINES).join("\n");
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2">
        <p className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <FileWarning className="size-3.5 text-amber-500" />
          Lightweight preview —{" "}
          {showAll
            ? "whole file"
            : `first ${LARGE_FILE_PREVIEW_LINES.toLocaleString()} lines of ${formatSize(content.length)}`}
        </p>
        {!showAll && (
          <button
            type="button"
            onClick={onLoadFull}
            className="text-[11px] font-medium text-neutral-700 hover:text-neutral-900"
          >
            Load full file
          </button>
        )}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre px-4 py-3 font-mono text-xs leading-5 text-neutral-800">
        {preview}
      </pre>
    </div>
  );
}

const PEER_COLORS = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
];

/**
 * The Aria code editor: Monaco with the app's turquoise "aria" theme and
 * per-file language detection. Mirrors the current file content via `value`
 * and reports edits through `onChange`, so the surrounding commit/stage
 * flows keep working exactly as before.
 *
 * Cross-device continuity: on mount the caret is restored from the shared
 * cursor store (set by the Dashboard when a workspace is restored), and every
 * caret move is written back to that store so the Dashboard can persist it.
 *
 * Live collaboration: `peers` renders each collaborator's cursor (same repo,
 * branch, and file) as a colored caret with a name tag, updated reactively.
 * This is presence-only — full concurrent editing of the same buffer is not
 * attempted; edits still flow through the draft/commit pipeline.
 */
export function CodeEditor({
  path,
  value,
  onChange,
  peers = [],
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
  peers?: EditorPeer[];
}) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const widgetsRef = useRef<MonacoEditor.IContentWidget[]>([]);
  const [largeFileView, setLargeFileView] = useState<
    "pending" | "preview" | "full"
  >("pending");

  // The choice resets whenever the open file changes.
  useEffect(() => {
    setLargeFileView("pending");
  }, [path]);

  // GitHub truncates >1MB file contents, so this also catches `truncated`
  // files (their content length lands right at the cap).
  const isLargeFile = value.length >= LARGE_FILE_BYTES;

  // Re-render collaborator cursors whenever the peer set changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Remove the previous round of widgets.
    for (const widget of widgetsRef.current) {
      editor.removeContentWidget(widget);
    }
    widgetsRef.current = [];

    // Decorations: a colored caret block (left border) on the peer's line.
    const decor = editor.createDecorationsCollection(
      peers.map((peer, i) => ({
        range: {
          startLineNumber: Math.max(1, peer.line),
          startColumn: Math.max(1, peer.column),
          endLineNumber: Math.max(1, peer.line),
          endColumn: Math.max(1, peer.column + 1),
        },
        options: {
          isWholeLine: false,
          className: `aria-peer-cursor-${i % PEER_COLORS.length}`,
        },
      })),
    );

    // Content widgets: the name tag above each cursor.
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i];
      const domNode = document.createElement("div");
      domNode.className = "aria-peer-tag";
      domNode.style.backgroundColor = PEER_COLORS[i % PEER_COLORS.length];
      domNode.textContent = peer.label.slice(0, 12);
      const widget: MonacoEditor.IContentWidget = {
        getId: () => `aria-peer-${peer.deviceId}`,
        getDomNode: () => domNode,
        getPosition: () => ({
          position: {
            lineNumber: Math.max(1, peer.line),
            column: Math.max(1, peer.column),
          },
          preference: [1],
        }),
      };
      editor.addContentWidget(widget);
      widgetsRef.current.push(widget);
    }

    return () => {
      decor.clear();
      for (const widget of widgetsRef.current) {
        editor.removeContentWidget(widget);
      }
      widgetsRef.current = [];
    };
  }, [peers]);

  return (
    <div className="flex h-full flex-col">
      {/* Open-file tabs (Phase 1): renders only when 2+ files are open;
          switching/closing flushes the outgoing tab's content to the draft
          vault via the tabs bus. Lives here so the bar sits directly above
          the code, inside the editor column. */}
      <FileTabs />
      <div className="min-h-0 flex-1">
        {isLargeFile && largeFileView === "pending" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <FileWarning className="size-8 text-amber-500" />
            <p className="text-sm font-medium text-neutral-800">
              This file is large
            </p>
            <p className="max-w-sm text-xs leading-5 text-neutral-500">
              {path} is {formatSize(value.length)}. Loading it into the full
              editor can slow things down. Preview the first 8,000 lines
              instead.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLargeFileView("preview")}
                className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
              >
                Lightweight preview
              </button>
              <button
                type="button"
                onClick={() => setLargeFileView("full")}
                className="h-8 rounded-md bg-neutral-900 px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-neutral-700"
              >
                Open full file
              </button>
            </div>
          </div>
        ) : isLargeFile && largeFileView === "preview" ? (
          <LargeFilePreview
            path={path}
            content={value}
            onLoadFull={() => setLargeFileView("full")}
          />
        ) : (
        <Editor
          language={languageForPath(path)}
          value={value}
          onChange={(next) => onChange(next ?? "")}
          theme="aria"
          onMount={(editor) => {
            editorRef.current = editor;
            setActiveEditor(editor);
            editor.onDidFocusEditorText(() => notifyFocus(true));
            editor.onDidBlurEditorText(() => notifyFocus(false));
            editor.onDidDispose(() => {
              setActiveEditor(null);
              notifyFocus(false);
            });
            editor.onDidChangeCursorPosition((e) => {
              const cursor = {
                line: e.position.lineNumber,
                column: e.position.column,
              };
              setCursorSync(cursor);
              notifyCursorMove(cursor);
            });
            // Scroll position (Phase 1): mirror the caret — write on scroll for
            // the debounced workspace save, restore on mount so the file opens
            // exactly where it was left (cross-device via the saved state).
            editor.onDidScrollChange(() => {
              setScrollSync({
                top: editor.getScrollTop(),
                left: editor.getScrollLeft(),
              });
            });
            const restored = getCursorSync();
            if (restored) {
              editor.setPosition({
                lineNumber: Math.max(1, restored.line),
                column: Math.max(1, restored.column),
              });
              editor.revealLineInCenter(Math.max(1, restored.line));
            }
            const restoredScroll = getScrollSync();
            if (restoredScroll) {
              editor.setScrollTop(Math.max(0, restoredScroll.top));
              editor.setScrollLeft(Math.max(0, restoredScroll.left));
            }
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Code', monospace",
            lineHeight: 21,
            wordWrap: "off",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            renderWhitespace: "none",
            smoothScrolling: true,
            padding: { top: 16, bottom: 16 },
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            fixedOverflowWidgets: true,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
          }}
          />
        )}
      </div>
    </div>
  );
}
