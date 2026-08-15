/**
 * Diff Web Worker — computes line diffs off the main thread so opening a
 * large commit diff never freezes the editor UI. Falls back to the main
 * thread automatically in the client wrapper when workers are unavailable.
 */
import { diffLines, type DiffLine } from "./diff";

interface DiffRequest {
  id: number;
  oldText: string;
  newText: string;
}

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<DiffRequest>) => void) | null;
  postMessage: (message: { id: number; lines?: DiffLine[]; error?: string }) => void;
};

ctx.onmessage = (event: MessageEvent<DiffRequest>) => {
  const { id, oldText, newText } = event.data;
  try {
    ctx.postMessage({ id, lines: diffLines(oldText, newText) });
  } catch (error) {
    ctx.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
