import type { EditorCursor } from "@/components/CodeEditor";

// Cross-device continuity: the editor writes the caret here as the user types,
// and the Dashboard reads it when persisting the workspace (and writes the
// saved caret here when restoring on another device). A plain module singleton
// keeps the two sides decoupled without threading props through every caller.
let stored: EditorCursor | null = null;

export function getCursorSync(): EditorCursor | null {
  return stored;
}

export function setCursorSync(cursor: EditorCursor | null): void {
  stored = cursor;
}
