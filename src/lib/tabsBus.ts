/**
 * Tabs bus — the pub/sub bridge between Dashboard (which owns the tab list
 * and the open/switch/close logic) and WorkspaceView (which renders the tab
 * bar). A module singleton plus listeners, the same pattern as cursorSync and
 * editorRegistry: no prop drilling through the workspace's huge prop surface.
 *
 * Dashboard publishes the tab list + active path whenever they change, and
 * registers its switch/close handlers once. WorkspaceView subscribes and
 * renders; clicks call back through the bus.
 */

export interface OpenTab {
  path: string;
  isNewFile: boolean;
}

export interface TabsSnapshot {
  tabs: OpenTab[];
  activePath: string | null;
}

interface TabActions {
  switchTab: (path: string) => void;
  closeTab: (path: string) => void;
}

let snapshot: TabsSnapshot = { tabs: [], activePath: null };
let actions: TabActions | null = null;
const listeners = new Set<() => void>();

/** Dashboard → bus: publish the current tab list + active path. */
export function publishTabs(tabs: OpenTab[], activePath: string | null): void {
  snapshot = { tabs, activePath };
  for (const listener of listeners) listener();
}

/** Dashboard → bus: register the switch/close handlers (idempotent). */
export function registerTabActions(next: TabActions): void {
  actions = next;
}

/** WorkspaceView → bus: subscribe; returns unsubscribe. */
export function subscribeTabs(listener: () => void): () => void {
  listeners.add(listener);
  listener();
  return () => {
    listeners.delete(listener);
  };
}

export function getTabsSnapshot(): TabsSnapshot {
  return snapshot;
}

/** Tab-bar clicks → Dashboard. */
export function switchTab(path: string): void {
  actions?.switchTab(path);
}

export function closeTab(path: string): void {
  actions?.closeTab(path);
}
