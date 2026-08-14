import { useRef } from "react";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import "@/lib/monaco";
import { languageForPath } from "@/lib/monaco";
import { getCursorSync, setCursorSync } from "@/lib/cursorSync";

export interface EditorCursor {
  line: number;
  column: number;
}

// ---------------------------------------------------------------------------
// Active-editor registry
//
// The mobile coding accessory bar (symbol insertion, focus detection) works
// through this module registry instead of prop-drilling the editor instance
// through the whole workspace layout. Only one editor is mounted at a time
// (the workspace keys it by path), so a single slot is enough.
// ---------------------------------------------------------------------------

let activeEditor: MonacoEditor.IStandaloneCodeEditor | null = null;

/** Insert `text` at the cursor of the currently focused editor (no-op → false). */
export function insertTextAtCursor(text: string): boolean {
  const editor = activeEditor;
  if (!editor) return false;
  editor.trigger("keyboard", "type", { text });
  editor.focus();
  return true;
}

const focusListeners = new Set<(focused: boolean) => void>();

/** Subscribe to text-focus changes of the active editor; returns unsubscribe. */
export function onActiveEditorFocus(
  listener: (focused: boolean) => void,
): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

function notifyFocus(focused: boolean) {
  for (const listener of focusListeners) listener(focused);
}

/**
 * The Aria code editor: Monaco with the app's turquoise "aria" theme and
 * per-file language detection. Mirrors the current file content via `value`
 * and reports edits through `onChange`, so the surrounding commit/stage
 * flows keep working exactly as before.
 *
 * Cross-device continuity: on mount the caret is restored from the shared
 * cursor store (set by the Dashboard when a workspace is restored), and every
 * caret move is written back to that store so the Dashboard can persist it.
 */
export function CodeEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  return (
    <Editor
      language={languageForPath(path)}
      value={value}
      onChange={(next) => onChange(next ?? "")}
      theme="aria"
      onMount={(editor) => {
        editorRef.current = editor;
        activeEditor = editor;
        editor.onDidFocusEditorText(() => notifyFocus(true));
        editor.onDidBlurEditorText(() => notifyFocus(false));
        editor.onDidDispose(() => {
          if (activeEditor === editor) {
            activeEditor = null;
            notifyFocus(false);
          }
        });
        editor.onDidChangeCursorPosition((e) => {
          setCursorSync({
            line: e.position.lineNumber,
            column: e.position.column,
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
  );
}
