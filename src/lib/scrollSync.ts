// Cross-device continuity: the editor writes its scroll offset here as the
// user scrolls, and the Dashboard reads it when persisting the workspace (and
// writes the saved offset here when restoring on another device). A plain
// module singleton keeps the two sides decoupled without threading props
// through every caller — the same pattern as cursorSync.

export interface EditorScroll {
  top: number;
  left: number;
}

let stored: EditorScroll | null = null;

export function getScrollSync(): EditorScroll | null {
  return stored;
}

export function setScrollSync(scroll: EditorScroll | null): void {
  stored = scroll;
}
