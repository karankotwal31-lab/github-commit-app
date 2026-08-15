import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  closeTab,
  getTabsSnapshot,
  subscribeTabs,
  switchTab,
} from "@/lib/tabsBus";

/**
 * Open-file tabs bar (Phase 1). Fully self-contained: it subscribes to the
 * tabs bus (Dashboard owns the tab list + switch/close logic), so the only
 * contract with the workspace layout is that this component is rendered in
 * the editor column. Each tab's unsaved content lives in the draft vault, so
 * closing or switching tabs never loses work.
 */
export function FileTabs() {
  const [tabState, setTabState] = useState(() => getTabsSnapshot());

  useEffect(() => subscribeTabs(() => setTabState(getTabsSnapshot())), []);

  if (tabState.tabs.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-neutral-200 bg-neutral-50 px-2 pt-1"
    >
      {tabState.tabs.map((tab) => {
        const active = tab.path === tabState.activePath;
        const name = tab.path.split("/").pop() ?? tab.path;
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={active}
            onClick={() => switchTab(tab.path)}
            title={tab.path}
            className={cn(
              "group flex max-w-48 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5 text-xs transition-colors",
              active
                ? "border-neutral-200 bg-white text-neutral-900"
                : "border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800",
            )}
          >
            <span className="truncate">{name}</span>
            {tab.isNewFile && <span className="text-neutral-400">+</span>}
            <button
              type="button"
              aria-label={`Close ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.path);
              }}
              className="rounded-sm p-0.5 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-700 focus:opacity-100 group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
