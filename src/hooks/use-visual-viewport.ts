import { useEffect, useState } from "react";

/**
 * Visual viewport tracking for mobile keyboards.
 *
 * When the on-screen keyboard opens on a phone, the *layout* viewport
 * (window.innerHeight) does not shrink — only the *visual* viewport does.
 * A `h-screen` app therefore leaves its bottom third hidden behind the
 * keyboard. This hook reads `window.visualViewport` (resize/scroll events)
 * and exposes:
 *
 * - `height`            → visual viewport height (fallback: innerHeight)
 * - `keyboardInset`     → pixels covered at the bottom of the layout viewport
 * - `keyboardOpen`      → true once the inset is meaningful
 *
 * It also publishes `--vvh` on <html> so layout can be sized with
 * `h-[var(--vvh)]` and react immediately, without a re-render.
 */

export interface VisualViewportState {
  /** Visual viewport height in px (falls back to window.innerHeight). */
  height: number;
  /** Pixels of the layout viewport hidden at the bottom (keyboard/chrome). */
  keyboardInset: number;
  /** True when the visual viewport is meaningfully shorter than the layout one. */
  keyboardOpen: boolean;
}

/** Inset above which we assume the on-screen keyboard is actually covering UI. */
const KEYBOARD_INSET_THRESHOLD = 80;

function readState(): VisualViewportState {
  if (typeof window === "undefined") {
    return { height: 0, keyboardInset: 0, keyboardOpen: false };
  }
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight;
  if (!vv) {
    return { height: layoutHeight, keyboardInset: 0, keyboardOpen: false };
  }
  const height = Math.max(0, Math.round(vv.height || layoutHeight));
  const inset = Math.max(0, Math.round(layoutHeight - (vv.offsetTop + vv.height)));
  // Publish immediately (also on first render) so `h-[var(--vvh)]` never
  // flashes with an unset height before the effect below runs.
  try {
    document.documentElement.style.setProperty("--vvh", `${height}px`);
  } catch {
    // no DOM
  }
  return {
    height,
    keyboardInset: inset,
    keyboardOpen: inset > KEYBOARD_INSET_THRESHOLD,
  };
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(readState);

  useEffect(() => {
    const update = () => {
      const next = readState();
      setState(next);
      // Publish the height as a CSS custom property so any `h-[var(--vvh)]`
      // element resizes in the same frame, before React re-renders.
      try {
        document.documentElement.style.setProperty("--vvh", `${next.height}px`);
      } catch {
        // No DOM (SSR-ish environments) — state alone is fine.
      }
    };

    update();
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    } else {
      // Older browsers without the API: at least track window resizes.
      window.addEventListener("resize", update);
    }
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      } else {
        window.removeEventListener("resize", update);
      }
    };
  }, []);

  return state;
}
