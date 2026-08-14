import type { editor as MonacoEditor } from "monaco-editor";

/**
 * Active-editor registry — extracted from CodeEditor so the Monaco runtime
 * can be lazy-loaded: modules that only need symbol insertion or focus
 * detection (the mobile accessory bar, the workspace chrome) import this tiny
 * file instead of pulling the whole editor into the main bundle. The Monaco
 * import here is type-only, so it costs nothing at runtime.
 *
 * Only one editor is mounted at a time (the workspace keys it by path), so a
 * single slot is enough.
 */

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

/** Subscribe to focus changes of the active editor; returns unsubscribe. */
export function onActiveEditorFocus(
  listener: (focused: boolean) => void,
): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/** Called by CodeEditor when the mounted editor gains/loses focus. */
export function notifyFocus(focused: boolean) {
  for (const listener of focusListeners) listener(focused);
}

/** Called by CodeEditor on mount/dispose to (un)register the active editor. */
export function setActiveEditor(
  editor: MonacoEditor.IStandaloneCodeEditor | null,
) {
  activeEditor = editor;
}
