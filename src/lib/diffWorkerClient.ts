/**
 * Client wrapper for the diff Web Worker.
 *
 * Small inputs are computed synchronously (a worker round-trip costs more
 * than the compute). Large inputs are sent to the worker so the UI thread
 * stays responsive; if workers are unavailable or stall, the computation
 * falls back to the main thread automatically — the result is identical.
 */
import { diffLines, type DiffLine } from "./diff";

/** Combined text length above which the worker is used. */
const WORKER_THRESHOLD = 200_000;
/** If the worker hasn't answered in this long, compute on the main thread. */
const WORKER_TIMEOUT_MS = 8_000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (lines: DiffLine[]) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker | null {
  if (worker !== null) return worker;
  try {
    const instance = new Worker(new URL("./diff.worker.ts", import.meta.url), {
      type: "module",
    });
    instance.onmessage = (
      event: MessageEvent<{ id: number; lines?: DiffLine[]; error?: string }>,
    ) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.error) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data.lines ?? []);
    };
    instance.onerror = () => {
      // Worker crashed — reject everything pending so callers fall back.
      const entries = [...pending.values()];
      pending.clear();
      worker = null;
      for (const entry of entries) {
        entry.reject(new Error("Diff worker crashed"));
      }
    };
    worker = instance;
  } catch {
    worker = null;
  }
  return worker;
}

export async function computeDiffLines(
  oldText: string,
  newText: string,
): Promise<DiffLine[]> {
  if (oldText.length + newText.length < WORKER_THRESHOLD) {
    return diffLines(oldText, newText);
  }
  const instance = getWorker();
  if (!instance) return diffLines(oldText, newText);

  const id = nextId++;
  return new Promise<DiffLine[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    instance.postMessage({ id, oldText, newText });
    // Safety net: if the worker stalls, fall back to the main thread.
    setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      try {
        resolve(diffLines(oldText, newText));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, WORKER_TIMEOUT_MS);
  });
}
