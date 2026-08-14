import { cn } from "@/lib/utils";
import { X } from "lucide-react";

/**
 * Coding Accessory Toolbar — the horizontal row of programming symbols that
 * sits above the mobile keyboard while the editor is focused, so typing
 * `{ } [ ] =>` on a phone doesn't require switching keyboard layouts.
 *
 * Rendered as a `position: fixed` bar anchored to the bottom of the *visual*
 * viewport: modern mobile browsers (Chrome Android, iOS 16+) anchor fixed
 * elements to the visual viewport, which already sits just above the
 * keyboard. The parent pads the editor by `keyboardInset` so Monaco's own
 * height matches.
 *
 * Accessibility: real buttons with 44px tap targets, `role="toolbar"`, and
 * per-key aria-labels. The trailing Focus toggle and close button let the
 * user get out of typing mode without hunting for chrome that focus mode
 * collapsed.
 */

export type AccessoryKey = string;

export interface CodingAccessoryBarProps {
  /** Insert `text` at the current editor cursor. */
  onInsert: (text: string) => void;
  /** Focus mode active — the button renders as pressed. */
  focusMode: boolean;
  onToggleFocusMode: () => void;
  /** Collapse the bar entirely (e.g. when the keyboard is hidden). */
  visible: boolean;
  onClose?: () => void;
  className?: string;
}

/** Symbol groups — separated visually but all one horizontal strip. */
const ACCESSORY_GROUPS: string[][] = [
  ["{", "}", "(", ")", "[", "]"],
  ["<", ">", "=>", "=", "===", "!=="],
  ["+", "-", "*", "/", "%"],
  ["&&", "||", "!", "?", ":"],
  [";", ",", ".", "'", '"', "`", "|"],
  ["&", "_", "#", "$", "@", "~", "^"],
];

function symbolLabel(symbol: string): string {
  const names: Record<string, string> = {
    "{": "open brace",
    "}": "close brace",
    "(": "open paren",
    ")": "close paren",
    "[": "open bracket",
    "]": "close bracket",
    "<": "less than",
    ">": "greater than",
    "=>": "arrow function",
    "=": "equals",
    "===": "strict equals",
    "!==": "strict not equals",
    "+": "plus",
    "-": "minus",
    "*": "asterisk",
    "/": "slash",
    "%": "percent",
    "&&": "and",
    "||": "or",
    "!": "bang",
    "?": "question mark",
    ":": "colon",
    ";": "semicolon",
    ",": "comma",
    ".": "period",
    "'": "single quote",
    '"': "double quote",
    "`": "backtick",
    "|": "pipe",
    "&": "ampersand",
    "_": "underscore",
    "#": "hash",
    "$": "dollar",
    "@": "at",
    "~": "tilde",
    "^": "caret",
  };
  return names[symbol] ?? symbol;
}

export function CodingAccessoryBar({
  onInsert,
  focusMode,
  onToggleFocusMode,
  visible,
  onClose,
  className,
}: CodingAccessoryBarProps) {
  if (!visible) return null;

  return (
    <div
      role="toolbar"
      aria-label="Code symbols"
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-neutral-200 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur",
        // Safe area (home indicator) on notched phones.
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5 py-1.5">
        {ACCESSORY_GROUPS.map((group, gi) => (
          <div key={gi} className="flex shrink-0 items-center gap-0.5">
            {gi > 0 && (
              <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-neutral-200" />
            )}
            {group.map((symbol) => (
              <button
                key={symbol}
                type="button"
                onPointerDown={(e) => {
                  // Prevent the editor from losing focus before the symbol lands.
                  e.preventDefault();
                }}
                onClick={() => onInsert(symbol)}
                aria-label={`Insert ${symbolLabel(symbol)}`}
                className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md font-mono text-[15px] text-neutral-800 transition-colors hover:bg-neutral-100 active:bg-neutral-200"
              >
                {symbol}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-neutral-200 px-1.5 py-1.5">
        <button
          type="button"
          onClick={onToggleFocusMode}
          aria-pressed={focusMode}
          aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
          title={focusMode ? "Exit focus mode" : "Focus mode — hide everything but the code"}
          className={cn(
            "flex h-11 shrink-0 items-center gap-1.5 rounded-md px-3 font-medium text-xs transition-colors",
            focusMode
              ? "bg-neutral-900 text-white"
              : "text-neutral-500 hover:bg-neutral-100",
          )}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", focusMode ? "bg-white" : "bg-neutral-300")} />
          Focus
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide coding toolbar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
